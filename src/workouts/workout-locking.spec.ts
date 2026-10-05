import { DataSource } from 'typeorm';
import { Workout } from './entities/workout.entity';
import { WorkoutExercise } from './entities/workout-exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';
import { Exercise } from './entities/exercise.entity';
import { User } from '../auth/user.entity';
import { AuthUser } from '../auth/auth-user.interface';
import { WorkoutsService } from './workouts.service';
import { CoachWorkoutsService } from './coach-workouts.service';
import { CoachCardInput } from './dto/coach-workout.dto';
import { lockWorkout } from './workout-cards';

// Runs only against a scratch Postgres database named in
// WORKOUT_LOCK_SPEC_DB; the schema is dropped and recreated from the
// entities, so the main database is refused.
const DB_NAME = process.env.WORKOUT_LOCK_SPEC_DB;
const describeDb = DB_NAME ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeDb('workout writes on Postgres', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let workouts: WorkoutsService;
  let coachWorkouts: CoachWorkoutsService;
  let coach: AuthUser;
  let client: AuthUser;
  let exerciseId: string;

  beforeAll(async () => {
    if (DB_NAME === 'liftbig_db') {
      throw new Error('WORKOUT_LOCK_SPEC_DB must name a scratch database');
    }
    ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5433', 10),
      username: process.env.DB_USERNAME || 'liftbig',
      password: process.env.DB_PASSWORD || 'password123',
      database: DB_NAME,
      entities: [Workout, WorkoutExercise, WorkoutSet, Exercise, User],
      synchronize: true,
      dropSchema: true,
    });
    await ds.initialize();
    workouts = new WorkoutsService(
      ds.getRepository(Workout),
      ds.getRepository(Exercise),
    );
    coachWorkouts = new CoachWorkoutsService(
      ds.getRepository(Workout),
      ds.getRepository(Exercise),
    );

    const users = ds.getRepository(User);
    const coachRow = await users.save({
      email: 'lock-coach@example.com',
      name: 'Coach',
      passwordHash: 'x',
      role: 'COACH',
    });
    const clientRow = await users.save({
      email: 'lock-client@example.com',
      name: 'Client',
      passwordHash: 'x',
      role: 'CLIENT',
      coachId: coachRow.id,
    });
    coach = { ...coachRow, coachId: null } as AuthUser;
    client = { ...clientRow } as AuthUser;
    const exercise = await ds
      .getRepository(Exercise)
      .save({ name: 'Lock Squat', createdById: null });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const twoCards = () => [
    {
      exerciseId,
      order: 1,
      sets: [1, 2, 3].map((order) => ({ reps: 5, weight: 100, order })),
    },
    {
      exerciseId,
      order: 2,
      sets: [1, 2, 3].map((order) => ({ reps: 8, weight: 50, order })),
    },
  ];

  const planOf = (workout: Workout, weight: number): CoachCardInput[] =>
    workout.exercises.map((card) => ({
      id: card.id,
      exerciseId: card.exerciseId,
      order: card.order,
      sets: card.sets.map((set) => ({
        id: set.id,
        reps: set.reps,
        weight,
        order: set.order,
      })),
    }));

  it('loses no result and duplicates no card over 20 interleaved coach PUTs and client result PATCHes', async () => {
    const created = await coachWorkouts.createForClient(
      client.id,
      { name: 'Race', date: '2030-01-01', exercises: twoCards() },
      coach,
    );
    const setIds = created.exercises.flatMap((c) => c.sets.map((s) => s.id));
    const sent = new Map<string, number[]>();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => {
        if (i % 2 === 0) {
          return coachWorkouts.update(
            created.id,
            { exercises: planOf(created, 100 + i) },
            coach,
          );
        }
        const setId = setIds[i % setIds.length];
        sent.set(setId, [...(sent.get(setId) ?? []), i]);
        return workouts.updateSetResult(
          created.id,
          setId,
          { made: true, actualReps: i },
          client,
        );
      }),
    );

    const after = await workouts.findOne(created.id, client);
    expect(after.exercises.map((c) => c.id)).toEqual(
      created.exercises.map((c) => c.id),
    );
    const sets = after.exercises.flatMap((c) => c.sets);
    expect(sets.map((s) => s.id)).toEqual(setIds);
    for (const set of sets) {
      const values = sent.get(set.id);
      if (values) {
        expect(set.made).toBe(true);
        expect(values).toContain(set.actualReps);
      } else {
        expect(set.made).toBeNull();
      }
    }
    const expectedTotal = sets
      .filter((s) => s.made === true)
      .reduce(
        (sum, s) =>
          sum + (s.actualWeight ?? s.weight ?? 0) * (s.actualReps ?? s.reps),
        0,
      );
    expect(after.totalWeightLifted).toBe(expectedTotal);
    expect(after.status).toBe('IN_PROGRESS');
  });

  it('keeps one card per id over 10 concurrent self PATCHes', async () => {
    const own = await workouts.create(
      { name: 'Self race', date: '2030-01-02' },
      client,
    );
    const first = await workouts.update(
      own.id,
      { exercises: twoCards() },
      client,
    );
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        workouts.update(
          own.id,
          {
            exercises: first.exercises.map((card) => ({
              id: card.id,
              exerciseId: card.exerciseId,
              order: card.order,
              sets: card.sets.map((set) => ({
                id: set.id,
                reps: set.reps,
                weight: set.weight,
                order: set.order,
                made: i % 2 === 0 ? true : null,
              })),
            })),
          },
          client,
        ),
      ),
    );
    const cards = await ds
      .getRepository(WorkoutExercise)
      .find({ where: { workoutId: own.id }, relations: { sets: true } });
    expect(cards).toHaveLength(2);
    expect(cards.flatMap((c) => c.sets)).toHaveLength(6);
  });

  it('makes a result PATCH wait for a transaction holding the workout lock', async () => {
    const created = await coachWorkouts.createForClient(
      client.id,
      { name: 'Wait', date: '2030-01-03', exercises: twoCards() },
      coach,
    );
    const setId = created.exercises[0].sets[0].id;
    const finished: string[] = [];

    const holder = ds.transaction(async (manager) => {
      await lockWorkout(manager, { id: created.id });
      await sleep(400);
      finished.push('holder');
    });
    await sleep(50);
    const patch = workouts
      .updateSetResult(created.id, setId, { made: false }, client)
      .then(() => finished.push('patch'));
    await Promise.all([holder, patch]);

    expect(finished).toEqual(['holder', 'patch']);
  });
});
