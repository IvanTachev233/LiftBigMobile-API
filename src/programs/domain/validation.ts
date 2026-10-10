export const PERCENT_OF_1RM_BOUNDS = { min: 10, max: 110 };

export interface ExerciseDraft {
  exerciseId: string;
  sets: number;
  reps: number;
  percentOf1RM: number | null;
  referenceExerciseId: string | null;
}

export interface SessionDraft {
  week: number;
  sessionIndex: number;
  dayOffset: number;
  exercises: ExerciseDraft[];
}

export interface ProgramDraft {
  durationWeeks: number;
  sessionsPerWeek: number;
  sessions: SessionDraft[];
}

export interface ProgramValidationError {
  rule: 1 | 2 | 3 | 4 | 5 | 6;
  message: string;
}

const isPositiveInteger = (value: number) =>
  Number.isInteger(value) && value >= 1;

// Publish rules for a program template. Returns every failure, ordered by
// rule; an empty list means the template can be published.
export function validateProgram(
  template: ProgramDraft,
  sport: { requiredLifts: { exerciseId: string }[] },
  exercises: { id: string }[],
): ProgramValidationError[] {
  const errors: ProgramValidationError[] = [
    ...checkStructure(template),
    ...checkOffsets(template),
    ...checkExercises(template, sport, exercises),
  ];
  return errors.sort((a, b) => a.rule - b.rule);
}

// Rule 3: weeks 1..durationWeeks, each with sessions 1..sessionsPerWeek.
function checkStructure(template: ProgramDraft): ProgramValidationError[] {
  const { durationWeeks, sessionsPerWeek, sessions } = template;
  const errors: ProgramValidationError[] = [];
  const fail = (message: string) => errors.push({ rule: 3, message });

  if (!isPositiveInteger(durationWeeks)) {
    fail('Duration must be at least 1 week');
  }
  if (!isPositiveInteger(sessionsPerWeek)) {
    fail('Sessions per week must be at least 1');
  }

  const seen = new Set<string>();
  for (const { week, sessionIndex } of sessions) {
    const key = `${week}/${sessionIndex}`;
    if (seen.has(key)) {
      fail(`Week ${week} session ${sessionIndex} appears more than once`);
    } else if (
      !Number.isInteger(week) ||
      week < 1 ||
      week > durationWeeks ||
      !Number.isInteger(sessionIndex) ||
      sessionIndex < 1 ||
      sessionIndex > sessionsPerWeek
    ) {
      fail(`Week ${week} session ${sessionIndex} is outside the program`);
    }
    seen.add(key);
  }

  for (let week = 1; week <= durationWeeks; week++) {
    const missing: number[] = [];
    for (let index = 1; index <= sessionsPerWeek; index++) {
      if (!seen.has(`${week}/${index}`)) missing.push(index);
    }
    if (missing.length === sessionsPerWeek) {
      fail(`Week ${week} has no sessions`);
    } else if (missing.length > 0) {
      fail(`Week ${week} is missing session ${missing.join(', ')}`);
    }
  }
  return errors;
}

// Rule 4: offsets 0..6, strictly increasing by sessionIndex within a week;
// week 1 session 1 is on offset 0.
function checkOffsets(template: ProgramDraft): ProgramValidationError[] {
  const errors: ProgramValidationError[] = [];
  const fail = (message: string) => errors.push({ rule: 4, message });

  const weeks = new Map<number, Map<number, number>>();
  for (const { week, sessionIndex, dayOffset } of template.sessions) {
    if (!Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > 6) {
      fail(
        `Week ${week} session ${sessionIndex} has day offset ${dayOffset}; it must be 0-6`,
      );
    }
    const offsets = weeks.get(week) ?? new Map<number, number>();
    if (!offsets.has(sessionIndex)) offsets.set(sessionIndex, dayOffset);
    weeks.set(week, offsets);
  }

  const firstOffset = weeks.get(1)?.get(1);
  if (firstOffset !== undefined && firstOffset !== 0) {
    fail('Week 1 session 1 must have day offset 0');
  }

  for (const [week, offsets] of weeks) {
    const ordered = [...offsets].sort(([a], [b]) => a - b);
    for (let i = 1; i < ordered.length; i++) {
      const [prevIndex, prevOffset] = ordered[i - 1];
      const [index, offset] = ordered[i];
      if (offset <= prevOffset) {
        fail(
          `Week ${week} session ${index} must come after session ${prevIndex} (day offset ${offset} <= ${prevOffset})`,
        );
      }
    }
  }
  return errors;
}

// Rules 1, 2, 5 and 6, per session and exercise.
function checkExercises(
  template: ProgramDraft,
  sport: { requiredLifts: { exerciseId: string }[] },
  exercises: { id: string }[],
): ProgramValidationError[] {
  const errors: ProgramValidationError[] = [];
  const known = new Set(exercises.map((e) => e.id));
  const sportLifts = new Set(sport.requiredLifts.map((l) => l.exerciseId));
  const { min, max } = PERCENT_OF_1RM_BOUNDS;

  for (const session of template.sessions) {
    const where = `Week ${session.week} session ${session.sessionIndex}`;
    if (session.exercises.length === 0) {
      errors.push({ rule: 6, message: `${where} has no exercises` });
    }

    session.exercises.forEach((exercise, i) => {
      const at = `${where}, exercise ${i + 1}`;
      const { exerciseId, referenceExerciseId, percentOf1RM } = exercise;

      if (!known.has(exerciseId)) {
        errors.push({
          rule: 1,
          message: `${at}: unknown exercise ${exerciseId}`,
        });
      }
      if (referenceExerciseId !== null && !known.has(referenceExerciseId)) {
        errors.push({
          rule: 1,
          message: `${at}: unknown reference exercise ${referenceExerciseId}`,
        });
      }

      if (percentOf1RM !== null && (percentOf1RM < min || percentOf1RM > max)) {
        errors.push({
          rule: 2,
          message: `${at}: ${percentOf1RM}% is outside ${min}-${max}%`,
        });
      }
      if ((percentOf1RM === null) !== (referenceExerciseId === null)) {
        errors.push({
          rule: 2,
          message: `${at}: a percent needs a reference lift and the other way round`,
        });
      }

      if (
        referenceExerciseId !== null &&
        known.has(referenceExerciseId) &&
        !sportLifts.has(referenceExerciseId)
      ) {
        errors.push({
          rule: 5,
          message: `${at}: reference ${referenceExerciseId} is not a lift of this sport`,
        });
      }

      if (!isPositiveInteger(exercise.sets)) {
        errors.push({ rule: 6, message: `${at}: sets must be at least 1` });
      }
      if (!isPositiveInteger(exercise.reps)) {
        errors.push({ rule: 6, message: `${at}: reps must be at least 1` });
      }
    });
  }
  return errors;
}
