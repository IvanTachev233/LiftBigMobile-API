import { BadRequestException } from '@nestjs/common';
import { EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { Exercise } from './entities/exercise.entity';
import { User } from '../auth/user.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { isExerciseVisible } from './exercise-visibility.util';

export const CARD_RELATIONS = [
  'exercises',
  'exercises.exercise',
  'exercises.sets',
  'assignedBy',
];

export interface SetInput {
  id?: string;
  reps: number;
  weight?: number | null;
  order?: number;
  notes?: string | null;
  made?: boolean | null;
  actualReps?: number | null;
  actualWeight?: number | null;
}

export interface CardInput {
  id?: string;
  exerciseId: string;
  order: number;
  supersetGroup?: string | null;
  sets: SetInput[];
}

// 'self' writes planned values and any results the body sends; a set keeps
// its card. 'planned' writes planned values and notes only, never results;
// a set may move to another card of the same workout.
export type CardWriteMode = 'self' | 'planned';

export type WorkoutSource = 'manual' | 'coach' | 'program';

export type WorkoutView = Workout & {
  source: WorkoutSource;
  program: { enrollmentId: string; name: string } | null;
};

// Coach-assigned and program workouts: the user logs results, adds sets and
// sets the status, but can't change the plan or delete the workout.
export function isPlanLocked(
  workout: Pick<Workout, 'assignedById' | 'programEnrollmentId'>,
): boolean {
  return Boolean(workout.assignedById) || Boolean(workout.programEnrollmentId);
}

export function workoutSource(
  workout: Pick<Workout, 'assignedById' | 'programEnrollmentId'>,
): WorkoutSource {
  if (workout.programEnrollmentId) return 'program';
  if (workout.assignedById) return 'coach';
  return 'manual';
}

// Program name by enrollment id for the program workouts among workouts.
export async function programNamesOf(
  manager: EntityManager,
  workouts: Workout[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      workouts.flatMap((w) =>
        w.programEnrollmentId ? [w.programEnrollmentId] : [],
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const enrollments = await manager.find(ProgramEnrollment, {
    where: { id: In(ids) },
    relations: { program: true },
  });
  return new Map(enrollments.map((e) => [e.id, e.program.name]));
}

// Cards by order, then each card's sets by order; the assigning coach is
// trimmed to id and name; source and program name are added.
export function toWorkoutView(
  workout: Workout,
  programNames: Map<string, string> = new Map(),
): WorkoutView {
  workout.exercises?.sort((a, b) => a.order - b.order);
  for (const card of workout.exercises ?? []) {
    card.sets?.sort((a, b) => a.order - b.order);
  }
  const coach = workout.assignedBy;
  workout.assignedBy = coach
    ? ({ id: coach.id, name: coach.name } as User)
    : null;
  const enrollmentId = workout.programEnrollmentId;
  return Object.assign(workout, {
    source: workoutSource(workout),
    program: enrollmentId
      ? { enrollmentId, name: programNames.get(enrollmentId) ?? '' }
      : null,
  });
}

// Locks the bare workout row until the transaction ends. Relations are not
// joined, since Postgres can't lock the nullable side of an outer join.
export function lockWorkout(
  manager: EntityManager,
  where: FindOptionsWhere<Workout>,
): Promise<Workout | null> {
  return manager.findOne(Workout, {
    where,
    lock: { mode: 'pessimistic_write' },
  });
}

export function loadCards(
  manager: EntityManager,
  workoutId: string,
): Promise<WorkoutExercise[]> {
  return manager.find(WorkoutExercise, {
    where: { workoutId },
    relations: { sets: true },
  });
}

export async function assertExercisesVisible(
  exerciseRepo: Repository<Exercise>,
  exerciseIds: string[],
  ownerId: string | null,
): Promise<void> {
  for (const exerciseId of new Set(exerciseIds)) {
    const visible = await isExerciseVisible(exerciseRepo, exerciseId, ownerId);
    if (!visible) {
      throw new BadRequestException(
        `Exercise "${exerciseId}" is not visible to you`,
      );
    }
  }
}

// Every card id must be a card of this workout and every set id a set of
// it, each used once. In 'self' mode a set id must also stay on its card.
export function assertOwnIds(
  existing: WorkoutExercise[],
  cards: CardInput[],
  mode: CardWriteMode,
): void {
  const ownCardIds = new Set(existing.map((card) => card.id));
  const cardOfSet = new Map(
    existing.flatMap((card) => card.sets.map((set) => [set.id, card.id])),
  );
  const seenCardIds = new Set<string>();
  const seenSetIds = new Set<string>();

  for (const card of cards) {
    if (card.id && (!ownCardIds.has(card.id) || seenCardIds.has(card.id))) {
      throw new BadRequestException(
        `Card "${card.id}" is not a card of this workout`,
      );
    }
    if (card.id) seenCardIds.add(card.id);

    for (const set of card.sets) {
      if (!set.id) continue;
      const ownCard = cardOfSet.get(set.id);
      const misplaced = mode === 'self' && ownCard !== card.id;
      if (!ownCard || misplaced || seenSetIds.has(set.id)) {
        throw new BadRequestException(
          `Set "${set.id}" is not a set of this ${mode === 'self' ? 'card' : 'workout'}`,
        );
      }
      seenSetIds.add(set.id);
    }
  }
}

function definedResults(set: SetInput): Partial<WorkoutSet> {
  const results: Partial<WorkoutSet> = {};
  if (set.made !== undefined) results.made = set.made;
  if (set.actualReps !== undefined) results.actualReps = set.actualReps;
  if (set.actualWeight !== undefined) results.actualWeight = set.actualWeight;
  return results;
}

// Updates kept cards and sets by id, creates rows without an id and deletes
// rows left out. Ids must have passed assertOwnIds.
export async function saveCardsInPlace(
  manager: EntityManager,
  workoutId: string,
  existing: WorkoutExercise[],
  cards: CardInput[],
  mode: CardWriteMode,
): Promise<void> {
  const cardIds: string[] = [];
  for (const card of cards) {
    const values = {
      exerciseId: card.exerciseId,
      order: card.order,
      supersetGroup: card.supersetGroup ?? null,
    };
    if (card.id) {
      await manager.update(WorkoutExercise, { id: card.id }, values);
      cardIds.push(card.id);
    } else {
      const { identifiers } = await manager.insert(WorkoutExercise, {
        workoutId,
        ...values,
      });
      cardIds.push(identifiers[0].id as string);
    }
  }

  const keptSetIds = new Set<string>();
  for (const [i, card] of cards.entries()) {
    for (const [j, set] of card.sets.entries()) {
      const planned: Partial<WorkoutSet> = {
        workoutExerciseId: cardIds[i],
        reps: set.reps,
        weight: set.weight ?? null,
        order: set.order ?? j + 1,
      };
      if (mode === 'planned') planned.notes = set.notes ?? null;
      const results = mode === 'self' ? definedResults(set) : {};

      if (set.id) {
        await manager.update(
          WorkoutSet,
          { id: set.id },
          { ...planned, ...results },
        );
        keptSetIds.add(set.id);
      } else {
        await manager.insert(WorkoutSet, {
          notes: null,
          made: null,
          actualReps: null,
          actualWeight: null,
          ...planned,
          ...results,
        });
      }
    }
  }

  // Kept sets already sit on their new card, so deleting a card only
  // cascades to sets that were left out.
  const removedSetIds = existing
    .flatMap((card) => card.sets.map((set) => set.id))
    .filter((id) => !keptSetIds.has(id));
  if (removedSetIds.length > 0) {
    await manager.delete(WorkoutSet, removedSetIds);
  }
  const keptCardIds = new Set(cardIds);
  const removedCardIds = existing
    .map((card) => card.id)
    .filter((id) => !keptCardIds.has(id));
  if (removedCardIds.length > 0) {
    await manager.delete(WorkoutExercise, removedCardIds);
  }
}

// Volume over made sets: (actual ?? planned weight) × (actual ?? planned reps).
export async function refreshTotal(
  manager: EntityManager,
  workoutId: string,
): Promise<void> {
  const cards = await loadCards(manager, workoutId);
  const total = cards
    .flatMap((card) => card.sets)
    .filter((set) => set.made === true)
    .reduce(
      (sum, set) =>
        sum +
        Number(set.actualWeight ?? set.weight ?? 0) *
          Number(set.actualReps ?? set.reps),
      0,
    );
  await manager.update(
    Workout,
    { id: workoutId },
    { totalWeightLifted: total },
  );
}

// The first logged result moves a planned workout to in progress.
export async function markStarted(
  manager: EntityManager,
  workout: Workout,
): Promise<void> {
  if (workout.status === WorkoutStatus.PLANNED) {
    await manager.update(
      Workout,
      { id: workout.id },
      { status: WorkoutStatus.IN_PROGRESS },
    );
  }
}
