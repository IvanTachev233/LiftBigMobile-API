import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from './entities/program-template.entity';
import { Sport } from './entities/sport.entity';

export interface ReferenceLift {
  exerciseId: string;
  label: string;
}

// Shown as the author of system programs.
const SYSTEM_AUTHOR_NAME = 'LiftBig';

const authorName = (program: ProgramTemplate) =>
  program.author?.name ?? SYSTEM_AUTHOR_NAME;

function programSummary(program: ProgramTemplate) {
  return {
    id: program.id,
    name: program.name,
    description: program.description,
    authorName: authorName(program),
    durationWeeks: program.durationWeeks,
    sessionsPerWeek: program.sessionsPerWeek,
  };
}

// The lifts a program takes percentages of, in the sport's order and with
// the sport's labels. Publishing ensures each is a lift of the sport.
export function referenceLifts(
  program: ProgramTemplate,
  sport: Sport,
): ReferenceLift[] {
  const ids = new Set(
    program.sessions.flatMap((s) =>
      s.exercises.flatMap((e) =>
        e.referenceExerciseId ? [e.referenceExerciseId] : [],
      ),
    ),
  );
  return sport.requiredLifts
    .filter((lift) => ids.has(lift.exerciseId))
    .map((lift) => ({ exerciseId: lift.exerciseId, label: lift.label }));
}

// Loads a program with its sessions, exercises and sport; 404 when it is
// missing or, with publishedOnly, not PUBLISHED.
export async function loadProgramWithSport(
  manager: EntityManager,
  id: string,
  { publishedOnly }: { publishedOnly: boolean },
): Promise<{ program: ProgramTemplate; sport: Sport }> {
  const program = await manager.findOne(ProgramTemplate, {
    where: publishedOnly
      ? { id, status: ProgramTemplateStatus.PUBLISHED }
      : { id },
    relations: {
      author: true,
      sessions: { exercises: { exercise: true, referenceExercise: true } },
    },
    order: {
      sessions: {
        week: 'ASC',
        sessionIndex: 'ASC',
        exercises: { order: 'ASC' },
      },
    },
  });
  if (!program) throw new NotFoundException(`Program "${id}" not found`);
  const sport = await manager.findOneOrFail(Sport, {
    where: { id: program.sportId },
    relations: { requiredLifts: true },
    order: { requiredLifts: { displayOrder: 'ASC' } },
  });
  return { program, sport };
}

// Read-only views of sports and published programs.
@Injectable()
export class ProgramCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async listSports() {
    const sports = await this.dataSource.getRepository(Sport).find({
      relations: { requiredLifts: { exercise: true } },
      order: {
        displayOrder: 'ASC',
        name: 'ASC',
        requiredLifts: { displayOrder: 'ASC' },
      },
    });
    return sports.map((sport) => ({
      id: sport.id,
      name: sport.name,
      displayOrder: sport.displayOrder,
      requiredLifts: sport.requiredLifts.map((lift) => ({
        exerciseId: lift.exerciseId,
        exerciseName: lift.exercise.name,
        label: lift.label,
        displayOrder: lift.displayOrder,
      })),
    }));
  }

  async listPrograms(sportId: string) {
    const exists = await this.dataSource
      .getRepository(Sport)
      .existsBy({ id: sportId });
    if (!exists) throw new NotFoundException(`Sport "${sportId}" not found`);
    const programs = await this.dataSource.getRepository(ProgramTemplate).find({
      where: { sportId, status: ProgramTemplateStatus.PUBLISHED },
      relations: { author: true },
      order: { name: 'ASC' },
    });
    return programs.map(programSummary);
  }

  async getProgram(id: string) {
    const { program, sport } = await loadProgramWithSport(
      this.dataSource.manager,
      id,
      { publishedOnly: true },
    );
    const labels = new Map(
      sport.requiredLifts.map((lift) => [lift.exerciseId, lift.label]),
    );
    return {
      ...programSummary(program),
      version: program.version,
      sport: { id: sport.id, name: sport.name },
      referenceLifts: referenceLifts(program, sport),
      sessions: program.sessions.map((session) => ({
        id: session.id,
        week: session.week,
        sessionIndex: session.sessionIndex,
        dayOffset: session.dayOffset,
        title: session.title,
        notes: session.notes,
        exercises: session.exercises.map((exercise) => ({
          id: exercise.id,
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exercise.name,
          order: exercise.order,
          sets: exercise.sets,
          reps: exercise.reps,
          percentOf1RM: exercise.percentOf1RM,
          referenceExerciseId: exercise.referenceExerciseId,
          referenceLabel: exercise.referenceExercise
            ? (labels.get(exercise.referenceExercise.id) ??
              exercise.referenceExercise.name)
            : null,
          notes: exercise.notes,
        })),
      })),
    };
  }
}
