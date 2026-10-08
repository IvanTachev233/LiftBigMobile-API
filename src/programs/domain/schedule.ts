const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Parses a YYYY-MM-DD calendar date as UTC midnight, so day arithmetic
// never crosses a DST change.
function parseDate(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  if (formatDate(time) !== date) throw new Error(`Invalid date "${date}"`);
  return time;
}

function formatDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

// startDate + (week - 1) x 7 + dayOffset, as YYYY-MM-DD.
export function sessionDate(
  startDate: string,
  week: number,
  dayOffset: number,
): string {
  const days = (week - 1) * 7 + dayOffset;
  return formatDate(parseDate(startDate) + days * DAY_MS);
}

export interface ScheduledSessionShape {
  week: number;
  sessionIndex: number;
  dayOffset: number;
}

// Every session of the template with its date, ordered by week then
// sessionIndex.
export function buildSchedule<T extends ScheduledSessionShape>(
  template: { sessions: T[] },
  startDate: string,
): { session: T; date: string }[] {
  return [...template.sessions]
    .sort((a, b) => a.week - b.week || a.sessionIndex - b.sessionIndex)
    .map((session) => ({
      session,
      date: sessionDate(startDate, session.week, session.dayOffset),
    }));
}
