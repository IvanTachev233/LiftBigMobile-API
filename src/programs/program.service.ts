import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { Exercise } from '../workouts/entities/exercise.entity';
import { validateProgram } from './domain/validation';
import { ProgramTemplateExercise } from './entities/program-template-exercise.entity';
import { ProgramTemplateSession } from './entities/program-template-session.entity';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from './entities/program-template.entity';
import { Sport } from './entities/sport.entity';
import { ProgramActor } from './program-actor';
import { ProgramAuthoringPolicy } from './program-authoring.policy';

export interface ProgramExerciseInput {
  exerciseId: string;
  sets: number;
  reps: number;
  percentOf1RM?: number | null;
  referenceExerciseId?: string | null;
  notes?: string | null;
}

export interface ProgramSessionInput {
  week: number;
  sessionIndex: number;
  dayOffset: number;
  title: string;
  notes?: string | null;
  exercises: ProgramExerciseInput[];
}

export interface ProgramTemplateInput {
  sportId: string;
  name: string;
  description?: string | null;
  durationWeeks: number;
  sessionsPerWeek: number;
  sessions: ProgramSessionInput[];
}

// Postgres error codes raised by draft writes.
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

// The only writer of program templates. Every method checks the actor
// against ProgramAuthoringPolicy and runs in one transaction.
@Injectable()
export class ProgramService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly policy: ProgramAuthoringPolicy,
  ) {}

  // Version 1 of a new lineage, as a DRAFT.
  async createDraft(
    actor: ProgramActor,
    input: ProgramTemplateInput,
    lineageId: string = randomUUID(),
  ): Promise<ProgramTemplate> {
    this.assertCanAuthor(actor);
    return this.dataSource.transaction(async (manager) => {
      if (await manager.exists(ProgramTemplate, { where: { lineageId } })) {
        throw new ConflictException(`Program lineage ${lineageId} exists`);
      }
      const { id } = await saveDraft(
        manager,
        manager.create(ProgramTemplate, {
          ...templateFields(input),
          lineageId,
          version: 1,
          status: ProgramTemplateStatus.DRAFT,
          authorId: actor.kind === 'user' ? actor.user.id : null,
          sessions: toSessions(manager, input.sessions),
        }),
      );
      return loadProgram(manager, id);
    });
  }

  // Replaces a draft's fields and sessions.
  async updateDraft(
    actor: ProgramActor,
    programId: string,
    input: ProgramTemplateInput,
  ): Promise<ProgramTemplate> {
    this.assertCanAuthor(actor);
    return this.dataSource.transaction(async (manager) => {
      const program = await lockProgram(manager, programId);
      assertStatus(program, ProgramTemplateStatus.DRAFT, 'edited');
      await manager.delete(ProgramTemplateSession, { programId });
      await saveDraft(
        manager,
        manager.create(ProgramTemplate, {
          ...program,
          ...templateFields(input),
          sessions: toSessions(manager, input.sessions),
        }),
      );
      return loadProgram(manager, programId);
    });
  }

  // Publishes a valid draft and archives the lineage's published version.
  // An invalid draft gets a 400 listing every failure and stays a DRAFT.
  async publish(
    actor: ProgramActor,
    programId: string,
  ): Promise<ProgramTemplate> {
    this.assertCanAuthor(actor);
    return this.dataSource.transaction(async (manager) => {
      const locked = await lockProgram(manager, programId);
      assertStatus(locked, ProgramTemplateStatus.DRAFT, 'published');
      const program = await loadProgram(manager, programId);
      const sport = await manager.findOneOrFail(Sport, {
        where: { id: program.sportId },
        relations: { requiredLifts: true },
      });
      const referenced = program.sessions.flatMap((s) =>
        s.exercises.flatMap((e) => [e.exerciseId, e.referenceExerciseId]),
      );
      const exercises = await manager.find(Exercise, {
        select: { id: true },
        where: { id: In(unique(referenced)) },
      });

      const errors = validateProgram(program, sport, exercises);
      if (errors.length > 0) {
        throw new BadRequestException({
          message: 'Program is not valid',
          errors,
        });
      }

      await manager.update(
        ProgramTemplate,
        {
          lineageId: program.lineageId,
          status: ProgramTemplateStatus.PUBLISHED,
        },
        { status: ProgramTemplateStatus.ARCHIVED },
      );
      await manager.update(
        ProgramTemplate,
        { id: programId },
        { status: ProgramTemplateStatus.PUBLISHED },
      );
      return loadProgram(manager, programId);
    });
  }

  // Copies a published version into a new DRAFT, version + 1, same lineage.
  async revise(
    actor: ProgramActor,
    programId: string,
  ): Promise<ProgramTemplate> {
    this.assertCanAuthor(actor);
    return this.dataSource.transaction(async (manager) => {
      const locked = await lockProgram(manager, programId);
      assertStatus(locked, ProgramTemplateStatus.PUBLISHED, 'revised');
      const pendingDraft = await manager.exists(ProgramTemplate, {
        where: {
          lineageId: locked.lineageId,
          status: ProgramTemplateStatus.DRAFT,
        },
      });
      if (pendingDraft) {
        throw new ConflictException('This program already has a draft');
      }

      const source = await loadProgram(manager, programId);
      const latest = await manager.maximum(ProgramTemplate, 'version', {
        lineageId: source.lineageId,
      });
      const { id } = await saveDraft(
        manager,
        manager.create(ProgramTemplate, {
          ...templateFields(source),
          lineageId: source.lineageId,
          version: (latest ?? source.version) + 1,
          status: ProgramTemplateStatus.DRAFT,
          authorId: source.authorId,
          sessions: toSessions(manager, source.sessions),
        }),
      );
      return loadProgram(manager, id);
    });
  }

  // Withdraws a published version from the catalog.
  async archive(
    actor: ProgramActor,
    programId: string,
  ): Promise<ProgramTemplate> {
    this.assertCanAuthor(actor);
    return this.dataSource.transaction(async (manager) => {
      const program = await lockProgram(manager, programId);
      assertStatus(program, ProgramTemplateStatus.PUBLISHED, 'archived');
      await manager.update(
        ProgramTemplate,
        { id: programId },
        { status: ProgramTemplateStatus.ARCHIVED },
      );
      return loadProgram(manager, programId);
    });
  }

  private assertCanAuthor(actor: ProgramActor): void {
    if (!this.policy.canAuthor(actor)) {
      throw new ForbiddenException('You cannot author programs');
    }
  }
}

const unique = (ids: (string | null)[]): string[] => [
  ...new Set(ids.filter((id): id is string => id !== null)),
];

function templateFields(input: ProgramTemplateInput) {
  return {
    sportId: input.sportId,
    name: input.name,
    description: input.description ?? null,
    durationWeeks: input.durationWeeks,
    sessionsPerWeek: input.sessionsPerWeek,
  };
}

// New session and exercise rows; exercises are ordered as given.
function toSessions(
  manager: EntityManager,
  sessions: ProgramSessionInput[],
): ProgramTemplateSession[] {
  return sessions.map((session) =>
    manager.create(ProgramTemplateSession, {
      week: session.week,
      sessionIndex: session.sessionIndex,
      dayOffset: session.dayOffset,
      title: session.title,
      notes: session.notes ?? null,
      exercises: session.exercises.map((exercise, i) =>
        manager.create(ProgramTemplateExercise, {
          exerciseId: exercise.exerciseId,
          order: i + 1,
          sets: exercise.sets,
          reps: exercise.reps,
          percentOf1RM: exercise.percentOf1RM ?? null,
          referenceExerciseId: exercise.referenceExerciseId ?? null,
          notes: exercise.notes ?? null,
        }),
      ),
    }),
  );
}

// Saves a template with its sessions; constraint violations become 400s.
async function saveDraft(
  manager: EntityManager,
  program: ProgramTemplate,
): Promise<ProgramTemplate> {
  try {
    return await manager.save(program);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === FOREIGN_KEY_VIOLATION) {
      throw new BadRequestException('Unknown sport or exercise');
    }
    if (code === UNIQUE_VIOLATION) {
      throw new BadRequestException('A week and session appear twice');
    }
    if (code === CHECK_VIOLATION) {
      throw new BadRequestException(
        'percentOf1RM and referenceExerciseId must be set together',
      );
    }
    throw error;
  }
}

async function lockProgram(
  manager: EntityManager,
  id: string,
): Promise<ProgramTemplate> {
  const program = await manager.findOne(ProgramTemplate, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!program) throw new NotFoundException(`Program "${id}" not found`);
  return program;
}

function assertStatus(
  program: ProgramTemplate,
  status: ProgramTemplateStatus,
  action: string,
): void {
  if (program.status !== status) {
    throw new ConflictException(
      `A ${program.status} program cannot be ${action}`,
    );
  }
}

// A template with its sessions by week and index, exercises by order.
export function loadProgram(
  manager: EntityManager,
  id: string,
): Promise<ProgramTemplate> {
  return manager.findOneOrFail(ProgramTemplate, {
    where: { id },
    relations: { sessions: { exercises: true } },
    order: {
      sessions: {
        week: 'ASC',
        sessionIndex: 'ASC',
        exercises: { order: 'ASC' },
      },
    },
  });
}
