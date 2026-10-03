import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExerciseDto, UpdateWorkoutDto } from './workout.dto';

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

describe('UpdateWorkoutDto sets[].supersetGroup', () => {
  it('accepts a uuid supersetGroup', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [
        {
          exerciseId: '11111111-1111-4111-8111-111111111111',
          weight: 100,
          reps: 5,
          supersetGroup: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a non-uuid supersetGroup', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [
        {
          exerciseId: '11111111-1111-4111-8111-111111111111',
          weight: 100,
          reps: 5,
          supersetGroup: 'not-a-uuid',
        },
      ],
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateWorkoutDto sets[].exercise (legacy reference)', () => {
  const set = (exercise: unknown) => ({ exercise, weight: 100, reps: 5 });

  it('accepts and keeps a uuid exercise.id under whitelist', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [set({ id: '11111111-1111-4111-8111-111111111111' })],
    });
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toHaveLength(0);
    expect(dto.sets?.[0].exercise?.id).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('rejects a malformed exercise.id', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [set({ id: 'not-a-uuid' })],
    });
    const errors = await validate(dto, { whitelist: true });
    const exerciseError = errors[0]?.children?.[0]?.children?.find(
      (e) => e.property === 'exercise',
    );
    expect(exerciseError?.children?.[0]).toMatchObject({
      property: 'id',
      constraints: { isUuid: expect.any(String) as string },
    });
  });

  it('rejects a non-object exercise', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, { sets: [set('abc')] });
    expect((await validate(dto, { whitelist: true })).length).toBeGreaterThan(
      0,
    );
  });

  it('still allows exercise to be omitted', async () => {
    const dto = plainToInstance(UpdateWorkoutDto, {
      sets: [
        {
          exerciseId: '11111111-1111-4111-8111-111111111111',
          weight: 100,
          reps: 5,
        },
      ],
    });
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
  });
});
