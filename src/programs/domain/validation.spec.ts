import {
  PERCENT_OF_1RM_BOUNDS,
  ProgramDraft,
  SessionDraft,
  validateProgram,
} from './validation';

const SQUAT = 'back-squat';
const PAUSE_SQUAT = 'pause-squat';
const BENCH = 'bench-press';
const ROW = 'barbell-row';

const sport = { requiredLifts: [{ exerciseId: SQUAT }, { exerciseId: BENCH }] };
const exercises = [SQUAT, PAUSE_SQUAT, BENCH, ROW].map((id) => ({ id }));

function session(
  week: number,
  sessionIndex: number,
  dayOffset: number,
): SessionDraft {
  return {
    week,
    sessionIndex,
    dayOffset,
    exercises: [
      {
        exerciseId: PAUSE_SQUAT,
        sets: 3,
        reps: 3,
        percentOf1RM: 70,
        referenceExerciseId: SQUAT,
      },
      {
        exerciseId: ROW,
        sets: 3,
        reps: 8,
        percentOf1RM: null,
        referenceExerciseId: null,
      },
    ],
  };
}

// 2 weeks x 2 sessions on days 0 and 3.
function validTemplate(): ProgramDraft {
  return {
    durationWeeks: 2,
    sessionsPerWeek: 2,
    sessions: [
      session(1, 1, 0),
      session(1, 2, 3),
      session(2, 1, 0),
      session(2, 2, 3),
    ],
  };
}

const rules = (template: ProgramDraft) =>
  validateProgram(template, sport, exercises).map((e) => e.rule);

describe('validateProgram', () => {
  it('accepts a valid template', () => {
    expect(validateProgram(validTemplate(), sport, exercises)).toEqual([]);
  });

  it('rule 1: rejects unknown exercises and reference exercises', () => {
    const template = validTemplate();
    template.sessions[0].exercises[1].exerciseId = 'missing';
    expect(rules(template)).toEqual([1]);

    const other = validTemplate();
    other.sessions[1].exercises[0].referenceExerciseId = 'missing';
    const errors = validateProgram(other, sport, exercises);
    expect(errors.map((e) => e.rule)).toEqual([1]);
    expect(errors[0].message).toContain('missing');
  });

  it('rule 2: keeps the percent within the bounds', () => {
    expect(PERCENT_OF_1RM_BOUNDS).toEqual({ min: 10, max: 110 });
    const template = validTemplate();
    template.sessions[0].exercises[0].percentOf1RM = 111;
    template.sessions[1].exercises[0].percentOf1RM = 9;
    expect(rules(template)).toEqual([2, 2]);

    const edges = validTemplate();
    edges.sessions[0].exercises[0].percentOf1RM = 110;
    edges.sessions[1].exercises[0].percentOf1RM = 10;
    expect(rules(edges)).toEqual([]);
  });

  it('rule 2: needs a percent and a reference lift together', () => {
    const template = validTemplate();
    template.sessions[0].exercises[0].referenceExerciseId = null;
    template.sessions[0].exercises[1].percentOf1RM = 60;
    expect(rules(template)).toEqual([2, 2]);
  });

  it('rule 3: reports a missing week', () => {
    const template = validTemplate();
    template.sessions = template.sessions.filter((s) => s.week !== 2);
    const errors = validateProgram(template, sport, exercises);
    expect(errors.map((e) => e.rule)).toEqual([3]);
    expect(errors[0].message).toContain('Week 2');
  });

  it('rule 3: reports a session gap and sessions out of range', () => {
    // Week 1 has sessions 1-3, week 2 only 1-2.
    const gap = validTemplate();
    gap.sessionsPerWeek = 3;
    gap.sessions.push(session(1, 3, 5));
    const errors = validateProgram(gap, sport, exercises);
    expect(errors.map((e) => e.rule)).toEqual([3]);
    expect(errors[0].message).toContain('Week 2');

    const extra = validTemplate();
    extra.sessions.push(session(3, 1, 0), session(1, 1, 0));
    expect(rules(extra)).toEqual([3, 3]);
  });

  it('rule 4: needs offsets 0-6 that increase within a week', () => {
    const notIncreasing = validTemplate();
    notIncreasing.sessions[3].dayOffset = 0;
    expect(rules(notIncreasing)).toEqual([4]);

    const outOfRange = validTemplate();
    outOfRange.sessions[3].dayOffset = 7;
    expect(rules(outOfRange)).toEqual([4]);
  });

  it('rule 4: starts week 1 on offset 0', () => {
    const template = validTemplate();
    template.sessions[0].dayOffset = 1;
    expect(rules(template)).toEqual([4]);
  });

  it('rule 5: needs every reference lift to be a lift of the sport', () => {
    const template = validTemplate();
    template.sessions[2].exercises[0].referenceExerciseId = ROW;
    expect(rules(template)).toEqual([5]);
  });

  it('rule 6: needs sets and reps of at least 1 and an exercise per session', () => {
    const sets = validTemplate();
    sets.sessions[0].exercises[0].sets = 0;
    expect(rules(sets)).toEqual([6]);

    const reps = validTemplate();
    reps.sessions[0].exercises[1].reps = 0;
    expect(rules(reps)).toEqual([6]);

    const empty = validTemplate();
    empty.sessions[2].exercises = [];
    expect(rules(empty)).toEqual([6]);
  });

  it('returns every failure', () => {
    const template = validTemplate();
    template.sessions[0].exercises[1].exerciseId = 'missing';
    template.sessions[1].exercises[0].percentOf1RM = 111;
    template.sessions[3].exercises[1].sets = 0;
    const errors = validateProgram(template, sport, exercises);
    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.rule)).toEqual([1, 2, 6]);
  });
});
