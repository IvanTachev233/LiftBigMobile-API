// Calendar dates as YYYY-MM-DD strings. Arithmetic runs on UTC midnight, so
// it never crosses a DST change.
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parse(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  if (format(time) !== date) throw new Error(`Invalid date "${date}"`);
  return time;
}

function format(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return format(parse(date) + days * DAY_MS);
}

// Today's date in UTC, the server's calendar.
export function todayUtc(now: Date = new Date()): string {
  return format(now.getTime());
}

// The UTC calendar date of a timestamp.
export function dateOf(timestamp: Date): string {
  return format(timestamp.getTime());
}

// The calendar date of a timestamp column without a time zone (such as
// workout.date). The driver reads its wall-clock value in the server's
// zone, so the local date is the stored one.
export function wallClockDateOf(timestamp: Date): string {
  return format(
    Date.UTC(
      timestamp.getFullYear(),
      timestamp.getMonth(),
      timestamp.getDate(),
    ),
  );
}
