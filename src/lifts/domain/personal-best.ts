import { LiftRecordSource } from '../entities/lift-record-source';
import { compareEntries } from './best-lift';

export const MAX_PB_REPS = 3;

export interface SetResult {
  made: boolean | null;
  reps: number;
  actualReps: number | null;
  weight: number | null;
  actualWeight: number | null;
}

export interface Lift {
  reps: number;
  weightKg: number;
}

export interface PbCandidate extends Lift {
  achievedOn: string;
  // Absent for a set without an entry: it comes after every entry.
  id?: string;
  createdAt?: Date;
  seq?: number;
}

export interface PbEntry extends Lift {
  id: string;
  achievedOn: string;
  createdAt: Date;
  seq: number;
  removedAt: Date | null;
  source: LiftRecordSource;
}

// Kilograms compared at the stored precision (2 decimals).
const toCents = (kg: number) => Math.round(kg * 100);

// The reps and weight a set counts with (actual over planned) when it is
// made, has 1-3 reps and a weight, on a max-trackable exercise.
export function qualifyingLift(
  set: SetResult,
  isMaxTrackable: boolean,
): Lift | null {
  if (!isMaxTrackable || set.made !== true) return null;
  const reps = set.actualReps ?? set.reps;
  const weightKg = Number(set.actualWeight ?? set.weight ?? 0);
  if (reps < 1 || reps > MAX_PB_REPS || toCents(weightKg) <= 0) return null;
  return { reps, weightKg };
}

export function isQualifyingSet(
  set: SetResult,
  isMaxTrackable: boolean,
): boolean {
  return qualifyingLift(set, isMaxTrackable) !== null;
}

function isEarlier(entry: PbEntry, candidate: PbCandidate): boolean {
  if (!candidate.createdAt || candidate.seq === undefined) {
    return entry.achievedOn <= candidate.achievedOn;
  }
  return (
    compareEntries(entry, {
      achievedOn: candidate.achievedOn,
      createdAt: candidate.createdAt,
      seq: candidate.seq,
    }) < 0
  );
}

// Strictly heavier than every non-removed entry of the same rep count
// before it (compareEntries).
export function isPb(candidate: PbCandidate, entries: PbEntry[]): boolean {
  const weight = toCents(candidate.weightKg);
  return entries.every(
    (entry) =>
      entry.id === candidate.id ||
      entry.removedAt !== null ||
      entry.reps !== candidate.reps ||
      !isEarlier(entry, candidate) ||
      toCents(entry.weightKg) < weight,
  );
}

// The heaviest non-removed 1-rep entry, the earliest on ties, or null.
export function recomputeBest<T extends PbEntry>(entries: T[]): T | null {
  let best: T | null = null;
  for (const entry of entries) {
    if (entry.reps !== 1 || entry.removedAt !== null) continue;
    if (
      !best ||
      toCents(entry.weightKg) > toCents(best.weightKg) ||
      (toCents(entry.weightKg) === toCents(best.weightKg) &&
        compareEntries(entry, best) < 0)
    ) {
      best = entry;
    }
  }
  return best;
}

export interface LinkedEntry extends PbEntry {
  exerciseId: string;
  workoutSetId: string | null;
}

// A set of the workout being reconciled, with its qualifying lift (or null).
export interface ReconcileSet {
  setId: string;
  exerciseId: string;
  lift: Lift | null;
}

export type ReconcileAction =
  | { type: 'delete'; entryId: string; exerciseId: string }
  | ({ type: 'follow'; entryId: string; exerciseId: string } & Lift & {
        achievedOn: string;
      })
  | ({ type: 'record'; setId: string; exerciseId: string } & Lift & {
        achievedOn: string;
      });

// Planned records sort after every existing entry, in record order.
const NEW_ENTRY_TIME = new Date(8.64e15);
const NEW_ENTRY_SEQ = Number.MAX_SAFE_INTEGER / 2;

// What one workout's sets (dated achievedOn) do to the user's entries.
// Existing set entries are settled first, oldest first: an unchanged one
// stays, a changed one follows its set while it is still a PB and is
// deleted otherwise. Entries of removed sets have already cascaded. Then
// sets without an entry are recorded, in set order, when they are a PB
// against what is left. An entry's check only counts entries created
// before it, and records only add entries created after every existing
// one, so one pass settles the workout.
export function planReconcile(
  sets: ReconcileSet[],
  entries: LinkedEntry[],
  achievedOn: string,
): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  let current = entries.map((entry) => ({ ...entry }));
  const ofExercise = (exerciseId: string) =>
    current.filter((e) => e.exerciseId === exerciseId);
  const setById = new Map(sets.map((set) => [set.setId, set]));

  const linked = current
    .filter((e) => e.workoutSetId !== null && setById.has(e.workoutSetId))
    .sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.seq - b.seq,
    );
  for (const entry of linked) {
    if (entry.removedAt) continue;
    const { lift, exerciseId } = setById.get(entry.workoutSetId!)!;
    const kept = lift !== null && exerciseId === entry.exerciseId;
    if (
      kept &&
      entry.reps === lift.reps &&
      toCents(entry.weightKg) === toCents(lift.weightKg) &&
      entry.achievedOn === achievedOn
    ) {
      continue;
    }
    if (
      kept &&
      isPb(
        {
          ...lift,
          achievedOn,
          id: entry.id,
          createdAt: entry.createdAt,
          seq: entry.seq,
        },
        ofExercise(exerciseId),
      )
    ) {
      actions.push({
        type: 'follow',
        entryId: entry.id,
        exerciseId,
        ...lift,
        achievedOn,
      });
      Object.assign(entry, { ...lift, achievedOn });
      continue;
    }
    actions.push({
      type: 'delete',
      entryId: entry.id,
      exerciseId: entry.exerciseId,
    });
    current = current.filter((e) => e !== entry);
  }

  const withEntry = new Set(current.map((e) => e.workoutSetId));
  for (const { setId, exerciseId, lift } of sets) {
    if (!lift || withEntry.has(setId)) continue;
    if (!isPb({ ...lift, achievedOn }, ofExercise(exerciseId))) continue;
    actions.push({ type: 'record', setId, exerciseId, ...lift, achievedOn });
    current.push({
      id: `new:${setId}`,
      exerciseId,
      workoutSetId: setId,
      ...lift,
      achievedOn,
      createdAt: NEW_ENTRY_TIME,
      seq: NEW_ENTRY_SEQ + actions.length,
      removedAt: null,
      source: LiftRecordSource.LOGGED_SET,
    });
  }
  return actions;
}
