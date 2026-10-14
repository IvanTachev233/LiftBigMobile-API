// Exercise categories in picker order
export const EXERCISE_CATEGORIES = [
  'Olympic',
  'Squat',
  'Press',
  'Pull',
] as const;
export type ExerciseCategory = (typeof EXERCISE_CATEGORIES)[number];
