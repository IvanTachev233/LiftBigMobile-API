import { BodyPart } from '../../workouts/entities/exercise.entity';
import { ProgramTemplateInput } from '../program.service';

// Global exercises the sports and sample programs use.
export const SEED_EXERCISES: { name: string; bodyPart: BodyPart }[] = [
  { name: 'Back Squat', bodyPart: BodyPart.LEGS },
  { name: 'Front Squat', bodyPart: BodyPart.LEGS },
  { name: 'Pause Squat', bodyPart: BodyPart.LEGS },
  { name: 'Clean', bodyPart: BodyPart.FULL_BODY },
  { name: 'Jerk', bodyPart: BodyPart.FULL_BODY },
  { name: 'Clean and Jerk', bodyPart: BodyPart.FULL_BODY },
  { name: 'Power Clean', bodyPart: BodyPart.FULL_BODY },
  { name: 'Power Jerk', bodyPart: BodyPart.FULL_BODY },
  { name: 'Snatch', bodyPart: BodyPart.FULL_BODY },
  { name: 'Power Snatch', bodyPart: BodyPart.FULL_BODY },
  { name: 'Clean Pull', bodyPart: BodyPart.LEGS },
  { name: 'Snatch Pull', bodyPart: BodyPart.LEGS },
  { name: 'Push Press', bodyPart: BodyPart.SHOULDERS },
  { name: 'Bench Press', bodyPart: BodyPart.CHEST },
  { name: 'Close-Grip Bench Press', bodyPart: BodyPart.CHEST },
  { name: 'Deadlift', bodyPart: BodyPart.BACK },
  { name: 'Barbell Row', bodyPart: BodyPart.BACK },
];

// Sports in tab order; each lift is [label, exercise name].
export const SEED_SPORTS: { name: string; lifts: [string, string][] }[] = [
  {
    name: 'Olympic Weightlifting',
    lifts: [
      ['Back Squat', 'Back Squat'],
      ['Front Squat', 'Front Squat'],
      ['Clean', 'Clean'],
      ['Jerk', 'Jerk'],
      ['Clean & Jerk', 'Clean and Jerk'],
      ['Power Clean', 'Power Clean'],
      ['Power Jerk', 'Power Jerk'],
      ['Snatch', 'Snatch'],
      ['Power Snatch', 'Power Snatch'],
      ['Push Press', 'Push Press'],
    ],
  },
  {
    name: 'Powerlifting',
    lifts: [
      ['Squat', 'Back Squat'],
      ['Bench Press', 'Bench Press'],
      ['Deadlift', 'Deadlift'],
    ],
  },
];

// Main-lift intensity and volume per week; week 4 is a deload.
const WEEKS = [
  { percent: 70, sets: 5, reps: 5 },
  { percent: 75, sets: 5, reps: 4 },
  { percent: 80, sets: 5, reps: 3 },
  { percent: 65, sets: 3, reps: 5 },
];
const DAY_OFFSETS = [0, 2, 4];

type Line = [
  exercise: string,
  sets: number,
  reps: number,
  percent: number | null,
  reference: string | null,
];
type Week = (typeof WEEKS)[number];

// A sample program. lineageId ties it to its rows across restarts.
function sample(
  lineageId: string,
  sport: string,
  name: string,
  description: string,
  days: { title: string; lines: (week: Week) => Line[] }[],
) {
  return {
    sport,
    lineageId,
    build: (
      sportId: string,
      exerciseId: (name: string) => string,
    ): ProgramTemplateInput => ({
      sportId,
      name,
      description,
      durationWeeks: WEEKS.length,
      sessionsPerWeek: days.length,
      sessions: WEEKS.flatMap((week, w) =>
        days.map((day, d) => ({
          week: w + 1,
          sessionIndex: d + 1,
          dayOffset: DAY_OFFSETS[d],
          title: day.title,
          exercises: day
            .lines(week)
            .map(([exercise, sets, reps, percent, reference]) => ({
              exerciseId: exerciseId(exercise),
              sets,
              reps,
              percentOf1RM: percent,
              referenceExerciseId:
                reference === null ? null : exerciseId(reference),
            })),
        })),
      ),
    }),
  };
}

export const SAMPLE_PROGRAMS = [
  sample(
    'dcce6f39-8a42-45f5-82e3-40a4c69ce822',
    'Olympic Weightlifting',
    'Sample Weightlifting Program',
    'A 4-week sample from LiftBig: three sessions a week building the snatch, the clean and jerk and squat strength, with a lighter final week.',
    [
      {
        title: 'Snatch and Back Squat',
        lines: (w) => [
          ['Snatch', 5, 2, w.percent, 'Snatch'],
          ['Snatch Pull', 3, 3, w.percent + 20, 'Snatch'],
          ['Back Squat', w.sets, w.reps, w.percent, 'Back Squat'],
        ],
      },
      {
        title: 'Clean and Jerk and Push Press',
        lines: (w) => [
          ['Clean and Jerk', 5, 1, w.percent, 'Clean and Jerk'],
          ['Clean Pull', 3, 3, w.percent + 20, 'Clean'],
          ['Push Press', 4, 4, w.percent, 'Push Press'],
        ],
      },
      {
        title: 'Power Variations and Front Squat',
        lines: (w) => [
          ['Power Snatch', 4, 2, w.percent, 'Power Snatch'],
          ['Power Clean', 4, 2, w.percent, 'Power Clean'],
          ['Front Squat', 4, 3, w.percent, 'Front Squat'],
        ],
      },
    ],
  ),
  sample(
    'ae57b5e2-fba3-4858-8ab1-88163e02772c',
    'Powerlifting',
    'Sample Powerlifting Program',
    'A 4-week sample from LiftBig: a squat, a bench and a deadlift day each week with rising intensity, then a lighter final week.',
    [
      {
        title: 'Squat Day',
        lines: (w) => [
          ['Back Squat', w.sets, w.reps, w.percent, 'Back Squat'],
          ['Pause Squat', 3, 3, w.percent - 15, 'Back Squat'],
          ['Bench Press', 3, 5, w.percent - 10, 'Bench Press'],
        ],
      },
      {
        title: 'Bench Day',
        lines: (w) => [
          ['Bench Press', w.sets, w.reps, w.percent, 'Bench Press'],
          ['Close-Grip Bench Press', 3, 6, w.percent - 15, 'Bench Press'],
          ['Barbell Row', 3, 8, null, null],
        ],
      },
      {
        title: 'Deadlift Day',
        lines: (w) => [
          ['Deadlift', 3, w.reps, w.percent, 'Deadlift'],
          ['Back Squat', 3, 5, w.percent - 10, 'Back Squat'],
        ],
      },
    ],
  ),
];
