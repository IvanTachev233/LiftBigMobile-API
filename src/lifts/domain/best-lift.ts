import { LiftRecordSource } from '../entities/lift-record-source';

export interface BestLift {
  weightKg: number;
  achievedOn: string;
  source: LiftRecordSource;
}

export interface LiftEntry extends BestLift {
  reps: number;
}

// Kilograms compared at the stored precision (2 decimals).
const toCents = (kg: number) => Math.round(kg * 100);

// The best after recording entry. Only a 1-rep entry heavier than the
// current best (or the first one) replaces it; otherwise current is
// returned as is.
export function nextBest(
  current: BestLift | null,
  entry: LiftEntry,
): BestLift | null {
  if (entry.reps !== 1) return current;
  if (current && toCents(entry.weightKg) <= toCents(current.weightKg)) {
    return current;
  }
  return {
    weightKg: entry.weightKg,
    achievedOn: entry.achievedOn,
    source: entry.source,
  };
}

export interface EnteredMax {
  exerciseId: string;
  weightKg: number;
}

// The maxes entered at program setup that become 1-rep entries: those with
// no best yet or a different value from it.
export function setupEntries<T extends EnteredMax>(
  entered: T[],
  bests: EnteredMax[],
): T[] {
  const bestKg = new Map(bests.map((b) => [b.exerciseId, b.weightKg]));
  return entered.filter((max) => {
    const current = bestKg.get(max.exerciseId);
    return current === undefined || toCents(current) !== toCents(max.weightKg);
  });
}

export interface DatedEntry {
  reps: number;
  achievedOn: string;
  createdAt: Date;
}

// The newest entry for each rep count (by achievedOn, then createdAt),
// null where there is none.
export function latestByReps<T extends DatedEntry>(
  entries: T[],
  repCounts: number[],
): { reps: number; entry: T | null }[] {
  const isNewer = (a: T, b: T) =>
    a.achievedOn !== b.achievedOn
      ? a.achievedOn > b.achievedOn
      : a.createdAt.getTime() > b.createdAt.getTime();

  return repCounts.map((reps) => {
    let latest: T | null = null;
    for (const entry of entries) {
      if (entry.reps === reps && (!latest || isNewer(entry, latest))) {
        latest = entry;
      }
    }
    return { reps, entry: latest };
  });
}
