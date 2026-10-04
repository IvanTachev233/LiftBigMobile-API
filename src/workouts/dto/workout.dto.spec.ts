import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateExerciseDto,
  UpdateWorkoutDto,
  WorkoutExerciseInput,
  WorkoutSetInput,
} from './workout.dto';

describe('CreateExerciseDto', () => {
  it('trims the name', async () => {
    const dto = plainToInstance(CreateExerciseDto, { name: '  Lunge  ' });
    expect(dto.name).toBe('Lunge');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a whitespace-only name as 400-worthy (empty after trim)', async () => {
    const dto = plainToInstance(CreateExerciseDto, { name: '   ' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a name over 100 chars after trim', async () => {
    const dto = plainToInstance(CreateExerciseDto, {
      name: `  ${'a'.repeat(101)}  `,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('accepts a name at the 100 char boundary', async () => {
    const dto = plainToInstance(CreateExerciseDto, { name: 'a'.repeat(100) });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a description over 2000 chars', async () => {
    const dto = plainToInstance(CreateExerciseDto, {
      name: 'Lunge',
      description: 'a'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'description')).toBe(true);
  });

  it('accepts an https videoUrl', async () => {
    const dto = plainToInstance(CreateExerciseDto, {
      name: 'Lunge',
      videoUrl: 'https://youtube.com/watch?v=abc',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an http videoUrl', async () => {
    const dto = plainToInstance(CreateExerciseDto, {
      name: 'Lunge',
      videoUrl: 'http://youtube.com/watch?v=abc',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'videoUrl')).toBe(true);
  });

  it('rejects a javascript: videoUrl', async () => {
    const dto = plainToInstance(CreateExerciseDto, {
      name: 'Lunge',
      videoUrl: 'javascript:alert(1)',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'videoUrl')).toBe(true);
  });
});

const EXERCISE_ID = '11111111-1111-4111-8111-111111111111';
const GROUP_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';
const SET_ID = '44444444-4444-4444-8444-444444444444';

const card = (overrides: Record<string, unknown> = {}) => ({
  exerciseId: EXERCISE_ID,
  order: 1,
  sets: [{ reps: 5, weight: 100 }],
  ...overrides,
});

const strict = { whitelist: true, forbidNonWhitelisted: true };

describe('UpdateWorkoutDto exercises (cards)', () => {
  it('accepts nested cards and keeps every field, ids included, under whitelist', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      exercises: [
        card({
          id: CARD_ID,
          supersetGroup: GROUP_ID,
          sets: [
            { id: SET_ID, reps: 5, weight: 100, order: 1, isCompleted: true },
          ],
        }),
      ],
    });
    expect(await validate(dto, strict)).toHaveLength(0);
    expect(dto.exercises?.[0]).toBeInstanceOf(WorkoutExerciseInput);
    expect(dto.exercises?.[0].sets[0]).toBeInstanceOf(WorkoutSetInput);
    expect(dto.exercises?.[0]).toMatchObject({
      id: CARD_ID,
      exerciseId: EXERCISE_ID,
      order: 1,
      supersetGroup: GROUP_ID,
    });
    expect(dto.exercises?.[0].sets[0]).toMatchObject({
      id: SET_ID,
      reps: 5,
      weight: 100,
      order: 1,
      isCompleted: true,
    });
  });

  it('accepts a null supersetGroup and an omitted one', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      exercises: [card({ supersetGroup: null }), card({ order: 2 })],
    });
    expect(await validate(dto, strict)).toHaveLength(0);
  });

  it('accepts a name-only body with no exercises', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, { name: 'Leg day' });
    expect(await validate(dto, strict)).toHaveLength(0);
    expect(dto.exercises).toBeUndefined();
  });

  it('rejects a non-uuid supersetGroup', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      exercises: [card({ supersetGroup: 'not-a-uuid' })],
    });
    const errors = await validate(dto, { whitelist: true });
    const cardErrors = errors[0]?.children?.[0]?.children ?? [];
    expect(
      cardErrors.find((e) => e.property === 'supersetGroup'),
    ).toMatchObject({ constraints: { isUuid: expect.any(String) as string } });
  });

  it.each([
    ['exerciseId', { exerciseId: 'not-a-uuid' }],
    ['exerciseId', { exerciseId: undefined }],
    ['id', { id: 'not-a-uuid' }],
    ['order', { order: 1.5 }],
    ['order', { order: undefined }],
    ['sets', { sets: undefined }],
    ['sets', { sets: 'abc' }],
  ])('rejects a card with a bad %s', async (property, overrides) => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      exercises: [card(overrides)],
    });
    const errors = await validate(dto, { whitelist: true });
    const cardErrors = errors[0]?.children?.[0]?.children ?? [];
    expect(cardErrors.map((e) => e.property)).toContain(property);
  });

  it.each([
    ['id', { id: 'not-a-uuid', reps: 5, weight: 100 }],
    ['reps', { reps: 'five', weight: 100 }],
    ['reps', { reps: 2.5, weight: 100 }],
    ['weight', { reps: 5 }],
    ['order', { reps: 5, weight: 100, order: 'x' }],
    ['isCompleted', { reps: 5, weight: 100, isCompleted: 'yes' }],
  ])('rejects a set with a bad %s', async (property, set) => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      exercises: [card({ sets: [set] })],
    });
    const errors = await validate(dto, { whitelist: true });
    const setErrors =
      errors[0]?.children?.[0]?.children?.[0]?.children?.[0]?.children ?? [];
    expect(setErrors.map((e) => e.property)).toContain(property);
  });

  it('rejects exercises that is not an array', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, { exercises: card() });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('exercises');
  });

  it('no longer accepts the flat sets body or the exercise reference form', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [{ exerciseId: EXERCISE_ID, weight: 100, reps: 5 }],
    });
    const errors = await validate(dto, strict);
    expect(errors.map((e) => e.property)).toContain('sets');

    const cardDto = plainToInstance(UpdateWorkoutDto, {
      exercises: [card({ exercise: { id: EXERCISE_ID } })],
    });
    const cardErrors = (await validate(cardDto, strict))[0]?.children?.[0]
      ?.children;
    expect(cardErrors?.map((e) => e.property)).toContain('exercise');
  });
});
