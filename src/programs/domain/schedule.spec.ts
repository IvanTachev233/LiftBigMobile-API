import { ScheduledSessionShape, buildSchedule, sessionDate } from './schedule';

describe('sessionDate', () => {
  it('puts week 1 offset 0 on the start date', () => {
    expect(sessionDate('2026-10-14', 1, 0)).toBe('2026-10-14');
  });

  it('adds (week - 1) x 7 + dayOffset days', () => {
    expect(sessionDate('2026-10-14', 2, 3)).toBe('2026-10-24');
  });

  it('rolls over months and years', () => {
    expect(sessionDate('2026-10-30', 1, 3)).toBe('2026-11-02');
    expect(sessionDate('2026-12-29', 2, 3)).toBe('2027-01-08');
    expect(sessionDate('2028-02-27', 1, 2)).toBe('2028-02-29');
  });

  it('ignores DST changes', () => {
    // Clocks change on 2026-10-25 (Europe) and 2026-11-01 (US).
    expect(sessionDate('2026-10-24', 1, 1)).toBe('2026-10-25');
    expect(sessionDate('2026-10-24', 1, 2)).toBe('2026-10-26');
    expect(sessionDate('2026-10-31', 2, 0)).toBe('2026-11-07');
  });

  it('rejects anything but a YYYY-MM-DD date', () => {
    expect(() => sessionDate('2026-10-14T00:00:00Z', 1, 0)).toThrow();
    expect(() => sessionDate('2026-02-30', 1, 0)).toThrow();
  });
});

describe('buildSchedule', () => {
  it('dates every session of a 4 x 3 template in order', () => {
    const sessions: ScheduledSessionShape[] = [];
    for (let week = 4; week >= 1; week--) {
      for (const [sessionIndex, dayOffset] of [
        [3, 4],
        [1, 0],
        [2, 2],
      ]) {
        sessions.push({ week, sessionIndex, dayOffset });
      }
    }

    const schedule = buildSchedule({ sessions }, '2026-10-14');

    expect(schedule.map((s) => s.date)).toEqual([
      '2026-10-14',
      '2026-10-16',
      '2026-10-18',
      '2026-10-21',
      '2026-10-23',
      '2026-10-25',
      '2026-10-28',
      '2026-10-30',
      '2026-11-01',
      '2026-11-04',
      '2026-11-06',
      '2026-11-08',
    ]);
    expect(
      schedule.map((s) => [s.session.week, s.session.sessionIndex]),
    ).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
      [3, 1],
      [3, 2],
      [3, 3],
      [4, 1],
      [4, 2],
      [4, 3],
    ]);
  });
});
