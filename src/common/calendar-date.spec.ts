import { wallClockDateOf } from './calendar-date';

describe('wallClockDateOf', () => {
  it('is the date of the wall-clock value in the server zone', () => {
    expect(wallClockDateOf(new Date(2026, 8, 10, 0, 0, 0))).toBe('2026-09-10');
    expect(wallClockDateOf(new Date(2026, 8, 10, 23, 59, 59))).toBe(
      '2026-09-10',
    );
    expect(wallClockDateOf(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
