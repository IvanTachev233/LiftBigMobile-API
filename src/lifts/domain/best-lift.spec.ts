import { LiftRecordSource } from '../entities/lift-record-source';
import { BestLift, latestByReps, nextBest, setupEntries } from './best-lift';

const best: BestLift = {
  weightKg: 100,
  achievedOn: '2026-09-01',
  source: LiftRecordSource.MANUAL,
};

function entry(reps: number, weightKg: number) {
  return {
    reps,
    weightKg,
    achievedOn: '2026-10-08',
    source: LiftRecordSource.LOGGED_SET,
  };
}

describe('nextBest', () => {
  it('sets the first 1RM as best', () => {
    expect(nextBest(null, entry(1, 80))).toEqual({
      weightKg: 80,
      achievedOn: '2026-10-08',
      source: LiftRecordSource.LOGGED_SET,
    });
  });

  it('replaces the best with a heavier 1RM, taking its date and source', () => {
    expect(nextBest(best, entry(1, 102.5))).toEqual({
      weightKg: 102.5,
      achievedOn: '2026-10-08',
      source: LiftRecordSource.LOGGED_SET,
    });
  });

  it('keeps the best for an equal or lighter 1RM', () => {
    expect(nextBest(best, entry(1, 100))).toBe(best);
    expect(nextBest(best, entry(1, 90))).toBe(best);
  });

  it('never changes the best for a 2RM or 3RM', () => {
    expect(nextBest(best, entry(2, 120))).toBe(best);
    expect(nextBest(best, entry(3, 150))).toBe(best);
    expect(nextBest(null, entry(3, 150))).toBeNull();
  });
});

describe('setupEntries', () => {
  const bests = [
    { exerciseId: 'squat', weightKg: 140 },
    { exerciseId: 'bench', weightKg: 102.06 },
  ];

  it('records only entered maxes that differ from the best or have none', () => {
    const entered = [
      { exerciseId: 'squat', weightKg: 140 },
      { exerciseId: 'bench', weightKg: 100 },
      { exerciseId: 'deadlift', weightKg: 180 },
    ];
    expect(setupEntries(entered, bests)).toEqual([
      { exerciseId: 'bench', weightKg: 100 },
      { exerciseId: 'deadlift', weightKg: 180 },
    ]);
  });

  it('treats values equal to 2 decimals as the same', () => {
    // 225 lb converted to kg
    const entered = [{ exerciseId: 'bench', weightKg: 102.0582370675 }];
    expect(setupEntries(entered, bests)).toEqual([]);
  });

  it('records a lower value too', () => {
    const entered = [{ exerciseId: 'squat', weightKg: 130 }];
    expect(setupEntries(entered, bests)).toEqual(entered);
  });
});

describe('latestByReps', () => {
  const at = (reps: number, achievedOn: string, createdAt: string) => ({
    id: `${reps}-${achievedOn}-${createdAt}`,
    reps,
    achievedOn,
    createdAt: new Date(createdAt),
  });

  it('picks the newest entry per rep count', () => {
    const entries = [
      at(1, '2026-09-01', '2026-09-01T10:00:00Z'),
      at(1, '2026-10-01', '2026-10-01T10:00:00Z'),
      at(1, '2026-08-01', '2026-10-05T10:00:00Z'),
      at(3, '2026-09-15', '2026-09-15T10:00:00Z'),
      at(4, '2026-10-07', '2026-10-07T10:00:00Z'),
    ];

    expect(latestByReps(entries, [1, 2, 3])).toEqual([
      { reps: 1, entry: entries[1] },
      { reps: 2, entry: null },
      { reps: 3, entry: entries[3] },
    ]);
  });

  it('breaks a date tie by createdAt', () => {
    const entries = [
      at(2, '2026-10-01', '2026-10-01T12:00:00Z'),
      at(2, '2026-10-01', '2026-10-02T08:00:00Z'),
      at(2, '2026-10-01', '2026-10-01T09:00:00Z'),
    ];
    expect(latestByReps(entries, [2])).toEqual([
      { reps: 2, entry: entries[1] },
    ]);
  });
});
