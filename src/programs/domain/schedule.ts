import { addDays } from '../../common/calendar-date';

// startDate + (week - 1) x 7 + dayOffset, as YYYY-MM-DD.
export function sessionDate(
  startDate: string,
  week: number,
  dayOffset: number,
): string {
  return addDays(startDate, (week - 1) * 7 + dayOffset);
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
