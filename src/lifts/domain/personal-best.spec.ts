import { LiftRecordSource } from '../entities/lift-record-source';
import {
  isPb,
  isQualifyingSet,
  PbEntry,
  planReconcile,
  qualifyingLift,
  recomputeBest,
} from './personal-best';

const set = (overrides: Record<string, unknown> = {}) => ({
  made: true,
  reps: 1,
  actualReps: null,
  weight: 100,
  actualWeight: null,
  ...overrides,
});

let seq = 0;
function entry(
  reps: number,
  weightKg: number,
  achievedOn: string,
  overrides: Partial<PbEntry> = {},
): PbEntry {
  seq++;
  return {
    id: `entry-${seq}`,
    reps,
    weightKg,
    achievedOn,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)),
    seq,
    removedAt: null,
    source: LiftRecordSource.LOGGED_SET,
    ...overrides,
  };
}

describe('isQualifyingSet', () => {
  it('accepts a made set of 1-3 reps with a weight on a trackable exercise', () => {
    expect(isQualifyingSet(set(), true)).toBe(true);
    expect(isQualifyingSet(set({ reps: 3 }), true)).toBe(true);
  });

  it('rejects 4 reps, unmade or unlogged sets, no weight and untracked exercises', () => {
    expect(isQualifyingSet(set({ reps: 4 }), true)).toBe(false);
    expect(isQualifyingSet(set({ made: false }), true)).toBe(false);
    expect(isQualifyingSet(set({ made: null }), true)).toBe(false);
    expect(isQualifyingSet(set({ weight: 0 }), true)).toBe(false);
    expect(isQualifyingSet(set({ weight: null }), true)).toBe(false);
    expect(isQualifyingSet(set(), false)).toBe(false);
  });

  it('uses the actual reps and weight over the planned ones', () => {
    expect(isQualifyingSet(set({ reps: 5, actualReps: 2 }), true)).toBe(true);
    expect(isQualifyingSet(set({ reps: 1, actualReps: 4 }), true)).toBe(false);
    expect(isQualifyingSet(set({ actualWeight: 0 }), true)).toBe(false);
    expect(
      qualifyingLift(set({ reps: 5, actualReps: 2, actualWeight: 110 }), true),
    ).toEqual({ reps: 2, weightKg: 110 });
    expect(qualifyingLift(set({ made: false }), true)).toBeNull();
  });
});

describe('isPb', () => {
  const candidate = (weightKg: number, achievedOn = '2026-10-05') => ({
    reps: 1,
    weightKg,
    achievedOn,
  });

  it('is a PB when there are no entries of that rep count', () => {
    expect(isPb(candidate(100), [entry(3, 200, '2026-10-01')])).toBe(true);
  });

  it('is not a PB at the same weight as an earlier entry', () => {
    expect(isPb(candidate(100), [entry(1, 100, '2026-10-01')])).toBe(false);
    expect(isPb(candidate(100), [entry(1, 100, '2026-10-05')])).toBe(false);
  });

  it('is a PB when heavier than earlier entries but lighter than a later one', () => {
    expect(
      isPb(candidate(105), [
        entry(1, 100, '2026-10-01'),
        entry(1, 120, '2026-10-09'),
      ]),
    ).toBe(true);
  });

  it('ignores removed entries', () => {
    expect(
      isPb(candidate(100), [
        entry(1, 150, '2026-10-01', { removedAt: new Date() }),
      ]),
    ).toBe(true);
  });

  it('compares an existing entry with entries before it only, never itself', () => {
    const first = entry(1, 100, '2026-10-05');
    const second = entry(1, 100, '2026-10-05');
    const entries = [first, second];
    expect(isPb(first, entries)).toBe(true);
    expect(isPb(second, entries)).toBe(false);
  });

  it('orders entries with the same date and createdAt by insertion', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1));
    const a = entry(1, 90, '2026-10-05', { createdAt });
    const b = entry(1, 95, '2026-10-05', { createdAt });
    const c = entry(1, 100, '2026-10-05', { createdAt });
    const entries = [c, b, a];
    expect(isPb({ ...b, weightKg: 85 }, entries)).toBe(false);
    expect(isPb(b, entries)).toBe(true);
    expect(isPb(a, entries)).toBe(true);
  });

  it('compares weights at 2 decimals', () => {
    expect(isPb(candidate(100.004), [entry(1, 100, '2026-10-01')])).toBe(false);
    expect(isPb(candidate(100.01), [entry(1, 100, '2026-10-01')])).toBe(true);
  });
});

describe('recomputeBest', () => {
  it('is the heaviest non-removed 1-rep entry', () => {
    const top = entry(1, 120, '2026-10-02');
    expect(
      recomputeBest([
        entry(1, 100, '2026-10-01'),
        top,
        entry(3, 150, '2026-10-03'),
      ]),
    ).toBe(top);
  });

  it('takes the earliest of equal weights', () => {
    const earliest = entry(1, 100, '2026-10-01');
    expect(
      recomputeBest([
        entry(1, 100, '2026-10-03'),
        earliest,
        entry(1, 100, '2026-10-01'),
      ]),
    ).toBe(earliest);
  });

  it('takes the first inserted of equal weights with the same date and createdAt', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1));
    const first = entry(1, 100, '2026-10-01', { createdAt });
    const second = entry(1, 100, '2026-10-01', { createdAt });
    expect(recomputeBest([second, first])).toBe(first);
  });

  it('returns the next heaviest after the top entry is removed', () => {
    const next = entry(1, 110, '2026-10-01');
    expect(
      recomputeBest([
        next,
        entry(1, 120, '2026-10-02', { removedAt: new Date() }),
      ]),
    ).toBe(next);
  });

  it('is null when no 1-rep entry is left', () => {
    expect(
      recomputeBest([
        entry(1, 120, '2026-10-02', { removedAt: new Date() }),
        entry(2, 110, '2026-10-01'),
      ]),
    ).toBeNull();
    expect(recomputeBest([])).toBeNull();
  });
});

describe('planReconcile', () => {
  const day = '2026-09-10';
  const linked = (
    setId: string,
    weightKg: number,
    overrides: Partial<PbEntry> = {},
  ) => ({
    ...entry(1, weightKg, day, overrides),
    exerciseId: 'squat',
    workoutSetId: setId,
  });
  const earlier = () => ({
    ...entry(1, 80, '2026-09-01', { source: LiftRecordSource.PROGRAM_SETUP }),
    exerciseId: 'squat',
    workoutSetId: null,
  });
  const set = (setId: string, weightKg: number | null) => ({
    setId,
    exerciseId: 'squat',
    lift: weightKg === null ? null : { reps: 1, weightKg },
  });

  it('records a set that becomes a PB once a heavier entry of the same workout is deleted', () => {
    const e2 = linked('s2', 110);
    expect(
      planReconcile([set('s1', 100), set('s2', null)], [earlier(), e2], day),
    ).toEqual([
      { type: 'delete', entryId: e2.id, exerciseId: 'squat' },
      {
        type: 'record',
        setId: 's1',
        exerciseId: 'squat',
        reps: 1,
        weightKg: 100,
        achievedOn: day,
      },
    ]);
  });

  it('settles existing entries oldest first, whatever the set order', () => {
    const eA = linked('a', 120);
    const eB = linked('b', 125);
    expect(
      planReconcile([set('b', 110), set('a', null)], [earlier(), eA, eB], day),
    ).toEqual([
      { type: 'delete', entryId: eA.id, exerciseId: 'squat' },
      {
        type: 'follow',
        entryId: eB.id,
        exerciseId: 'squat',
        reps: 1,
        weightKg: 110,
        achievedOn: day,
      },
    ]);
  });

  it('keeps an earned entry when a heavier set is added', () => {
    const eA = linked('a', 100);
    expect(planReconcile([set('a', 100), set('b', 120)], [eA], day)).toEqual([
      {
        type: 'record',
        setId: 'b',
        exerciseId: 'squat',
        reps: 1,
        weightKg: 120,
        achievedOn: day,
      },
    ]);
  });

  it('deletes the entry of a set whose card changed exercise and records it on the new one', () => {
    const eA = linked('a', 100);
    expect(
      planReconcile(
        [{ setId: 'a', exerciseId: 'bench', lift: { reps: 1, weightKg: 100 } }],
        [eA],
        day,
      ),
    ).toEqual([
      { type: 'delete', entryId: eA.id, exerciseId: 'squat' },
      {
        type: 'record',
        setId: 'a',
        exerciseId: 'bench',
        reps: 1,
        weightKg: 100,
        achievedOn: day,
      },
    ]);
  });

  it('settles entries with the same createdAt by insertion order', () => {
    const createdAt = new Date(Date.UTC(2026, 0, 1));
    const eA = linked('a', 90, { createdAt });
    const eB = linked('b', 95, { createdAt });
    const eC = linked('c', 100, { createdAt });
    expect(
      planReconcile(
        [set('a', 90), set('b', 85), set('c', 100)],
        [eC, eB, eA],
        day,
      ),
    ).toEqual([{ type: 'delete', entryId: eB.id, exerciseId: 'squat' }]);
  });

  it('leaves sets with a removed entry alone', () => {
    const removed = linked('a', 100, { removedAt: new Date() });
    expect(planReconcile([set('a', 130)], [removed], day)).toEqual([]);
  });

  it('records only the first of equal new sets', () => {
    const plan = planReconcile([set('a', 100), set('b', 100)], [], day);
    expect(plan.map((a) => a.type === 'record' && a.setId)).toEqual(['a']);
  });
});
