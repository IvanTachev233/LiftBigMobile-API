import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  MoreThanOrEqual,
  In,
  FindOptionsOrder,
  FindOptionsWhere,
  EntityManager,
} from 'typeorm';
import { Program } from './entities/program.entity';
import { ProgramExercise } from './entities/program-exercise.entity';
import { ProgramSet } from './entities/program-set.entity';
import { Exercise } from '../workouts/entities/exercise.entity';
import { User } from '../auth/user.entity';
import { isExerciseVisible } from '../workouts/exercise-visibility.util';
import {
  CreateProgramDto,
  UpdateProgramDto,
  UpdateProgramExerciseDto,
  AddProgramSetDto,
  PatchProgramSetDto,
} from './dto/program.dto';

const CARD_RELATIONS = ['exercises', 'exercises.exercise', 'exercises.sets'];

// Cards by position, then sets by set number
const CARD_SET_ORDER: FindOptionsOrder<Program> = {
  exercises: { order: 'ASC', sets: { order: 'ASC' } },
};

@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program)
    private programRepo: Repository<Program>,
    @InjectRepository(ProgramExercise)
    private programExerciseRepo: Repository<ProgramExercise>,
    @InjectRepository(ProgramSet)
    private programSetRepo: Repository<ProgramSet>,
    @InjectRepository(Exercise)
    private exerciseRepo: Repository<Exercise>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  // Program exercises must be global or created by the program's coach
  private async assertExercisesVisible(
    exerciseIds: string[],
    coachId: string,
  ): Promise<void> {
    const uniqueIds = [...new Set(exerciseIds)];
    for (const exerciseId of uniqueIds) {
      const visible = await isExerciseVisible(
        this.exerciseRepo,
        exerciseId,
        coachId,
      );
      if (!visible) {
        throw new BadRequestException(
          `Exercise "${exerciseId}" is not visible to you`,
        );
      }
    }
  }

  // Ids not on this program are created as new rows, unless they belong to
  // another program; those are rejected rather than moved
  private async assertNotForeign<T extends { id: string }>(
    repo: Repository<T>,
    ids: string[],
    label: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const count = await repo.count({
      where: { id: In(ids) } as FindOptionsWhere<T>,
    });
    if (count > 0) {
      throw new BadRequestException(`A ${label} belongs to another program`);
    }
  }

  async create(dto: CreateProgramDto, coachId: string): Promise<Program> {
    const client = await this.userRepo.findOne({
      where: { id: dto.clientId, coachId },
    });

    if (!client) {
      throw new ForbiddenException('Client not found or not assigned to you');
    }

    await this.assertExercisesVisible(
      dto.exercises.map((e) => e.exerciseId),
      coachId,
    );

    const program = this.programRepo.create({
      clientId: dto.clientId,
      coachId,
      name: dto.name,
      scheduledDate: new Date(dto.scheduledDate),
      exercises: dto.exercises.map((card) =>
        this.programExerciseRepo.create({
          exerciseId: card.exerciseId,
          order: card.order,
          supersetGroup: card.supersetGroup ?? null,
          sets: card.sets.map((s) =>
            this.programSetRepo.create({
              reps: s.reps,
              weight: s.weight ?? null,
              notes: s.notes ?? null,
              order: s.order,
              made: null,
            }),
          ),
        }),
      ),
    });

    const saved = await this.programRepo.save(program);
    return this.findOne(saved.id, coachId, 'COACH');
  }

  async findByClient(clientId: string, coachId: string): Promise<Program[]> {
    return this.programRepo.find({
      where: { clientId, coachId },
      relations: CARD_RELATIONS,
      order: { scheduledDate: 'DESC', ...CARD_SET_ORDER },
    });
  }

  async findUpcoming(clientId: string): Promise<Program[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.programRepo.find({
      where: {
        clientId,
        scheduledDate: MoreThanOrEqual(today),
      },
      relations: CARD_RELATIONS,
      order: { scheduledDate: 'ASC', ...CARD_SET_ORDER },
    });
  }

  async findOne(id: string, userId: string, role: string): Promise<Program> {
    const where =
      role === 'COACH' ? { id, coachId: userId } : { id, clientId: userId };

    const program = await this.programRepo.findOne({
      where,
      relations: [...CARD_RELATIONS, 'client', 'coach'],
      order: CARD_SET_ORDER,
    });

    if (!program) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }

    return program;
  }

  async update(
    id: string,
    dto: UpdateProgramDto,
    coachId: string,
  ): Promise<Program> {
    const program = await this.programRepo.findOne({
      where: { id, coachId },
      relations: ['exercises', 'exercises.sets'],
    });

    if (!program) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }

    // Scalars only; cards and sets are saved through their own repositories
    const { exercises: existingCards, ...fields } = program;
    if (dto.name !== undefined) fields.name = dto.name;
    if (dto.scheduledDate !== undefined)
      fields.scheduledDate = new Date(dto.scheduledDate);

    const cards = dto.exercises;
    const ownCards = new Map(existingCards.map((c) => [c.id, c]));
    const ownSets = new Map(
      existingCards.flatMap((c) => c.sets ?? []).map((s) => [s.id, s]),
    );

    // Checked before any write
    if (cards !== undefined) {
      await this.assertExercisesVisible(
        cards.map((c) => c.exerciseId),
        coachId,
      );
      await this.assertNotForeign(
        this.programExerciseRepo,
        cards.flatMap((c) => (c.id && !ownCards.has(c.id) ? [c.id] : [])),
        'card',
      );
      await this.assertNotForeign(
        this.programSetRepo,
        cards.flatMap((c) =>
          c.sets.flatMap((s) => (s.id && !ownSets.has(s.id) ? [s.id] : [])),
        ),
        'set',
      );
    }

    await this.programRepo.manager.transaction(async (manager) => {
      if (cards !== undefined) {
        await this.replaceCards(manager, id, ownCards, ownSets, cards);
      }
      await manager.getRepository(Program).save(fields as Program);
    });

    return this.findOne(id, coachId, 'COACH');
  }

  // Updates cards and sets in place by id so client-logged results (made)
  // survive a coach edit; rows left out are deleted.
  private async replaceCards(
    manager: EntityManager,
    programId: string,
    ownCards: Map<string, ProgramExercise>,
    ownSets: Map<string, ProgramSet>,
    cards: UpdateProgramExerciseDto[],
  ): Promise<void> {
    const cardRepo = manager.getRepository(ProgramExercise);
    const setRepo = manager.getRepository(ProgramSet);

    // An id sent twice matches once; the repeat becomes a new row
    const keptCardIds = new Set<string>();
    const cardRows = cards.map((c) => {
      const match =
        c.id && ownCards.has(c.id) && !keptCardIds.has(c.id) ? c.id : null;
      if (match) keptCardIds.add(match);
      return cardRepo.create({
        ...(match ? { id: match } : {}),
        programId,
        exerciseId: c.exerciseId,
        order: c.order,
        supersetGroup: c.supersetGroup ?? null,
      });
    });
    const savedCards = await cardRepo.save(cardRows);

    const keptSetIds = new Set<string>();
    const setRows = cards.flatMap((c, i) =>
      c.sets.map((s) => {
        const match =
          s.id && !keptSetIds.has(s.id) ? ownSets.get(s.id) : undefined;
        if (match) keptSetIds.add(match.id);
        return setRepo.create({
          ...(match ? { id: match.id } : {}),
          programExerciseId: savedCards[i].id,
          reps: s.reps,
          weight: s.weight ?? null,
          notes: s.notes ?? null,
          order: s.order,
          made: match ? match.made : null,
        });
      }),
    );
    if (setRows.length > 0) {
      await setRepo.save(setRows);
    }

    // Kept sets are already on their new card, so deleting a card only
    // cascades to sets that were left out
    const removedSetIds = [...ownSets.keys()].filter((k) => !keptSetIds.has(k));
    if (removedSetIds.length > 0) {
      await setRepo.delete(removedSetIds);
    }
    const removedCardIds = [...ownCards.keys()].filter(
      (k) => !keptCardIds.has(k),
    );
    if (removedCardIds.length > 0) {
      await cardRepo.delete(removedCardIds);
    }
  }

  private async findClientProgram(
    programId: string,
    clientId: string,
  ): Promise<Program> {
    const program = await this.programRepo.findOne({
      where: { id: programId, clientId },
    });
    if (!program) {
      throw new NotFoundException('Program not found or not assigned to you');
    }
    return program;
  }

  async addSet(
    programId: string,
    cardId: string,
    dto: AddProgramSetDto,
    clientId: string,
  ): Promise<ProgramSet> {
    await this.findClientProgram(programId, clientId);

    const card = await this.programExerciseRepo.findOne({
      where: { id: cardId, programId },
      relations: ['sets'],
    });
    if (!card) {
      throw new NotFoundException('Program exercise not found');
    }

    const maxOrder = (card.sets ?? []).reduce(
      (max, s) => Math.max(max, s.order),
      0,
    );

    const newSet = this.programSetRepo.create({
      programExerciseId: card.id,
      reps: dto.reps,
      weight: dto.weight ?? null,
      notes: dto.notes ?? null,
      order: maxOrder + 1,
      made: dto.made ?? null,
    });

    return this.programSetRepo.save(newSet);
  }

  async updateSet(
    programId: string,
    setId: string,
    dto: PatchProgramSetDto,
    clientId: string,
  ): Promise<ProgramSet> {
    await this.findClientProgram(programId, clientId);

    const set = await this.programSetRepo.findOne({
      where: { id: setId, programExercise: { programId } },
    });
    if (!set) {
      throw new NotFoundException('Program set not found');
    }

    if (dto.reps !== undefined) set.reps = dto.reps;
    if (dto.weight !== undefined) set.weight = dto.weight;
    if (dto.notes !== undefined) set.notes = dto.notes;
    if (dto.made !== undefined) set.made = dto.made;

    return this.programSetRepo.save(set);
  }

  async remove(id: string, coachId: string): Promise<void> {
    const result = await this.programRepo.delete({ id, coachId });
    if (result.affected === 0) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }
  }
}
