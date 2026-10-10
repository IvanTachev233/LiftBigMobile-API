import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CoachWorkoutsService } from './coach-workouts.service';
import { CoachCardInput, CreateCoachWorkoutDto } from './dto/coach-workout.dto';
import { Workout, WorkoutStatus } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { AuthUser } from '../auth/auth-user.interface';
import { LiftRecordsService } from '../lifts/lift-records.service';
import {
  createFakeWorkoutDb,
  liftRecordsStub,
  FakeWorkoutDb,
  workoutFixture,
} from '../../test/fake-workout-db';

const user = (
  id: string,
  role: 'COACH' | 'CLIENT',
  coachId: string | null = null,
): AuthUser => ({
  id,
  email: `${id}@example.com`,
  name: `${id} name`,
  role,
  coachId,
});

const RESULT_KEYS = ['made', 'actualReps', 'actualWeight'];

describe('CoachWorkoutsService', () => {
  let service: CoachWorkoutsService;
  let fake: FakeWorkoutDb;

  const exercises = [
    { id: 'global-1', name: 'Bench Press', createdById: null },
    { id: 'coach1-ex', name: 'Coach1 Special', createdById: 'coach-1' },
    { id: 'coach2-ex', name: 'Coach2 Special', createdById: 'coach-2' },
  ] as Exercise[];

  // Visible = global, or owned by the coach the check is made for.
  const exerciseRepo = {
    count: jest.fn((opts: { where: { id: string; createdById: unknown }[] }) =>
      Promise.resolve(
        exercises.filter((e) =>
          opts.where.some(
            (clause) =>
              clause.id === e.id &&
              (clause.createdById instanceof Object
                ? e.createdById === null
                : clause.createdById === e.createdById),
          ),
        ).length,
      ),
    ),
  };

  const coach1 = user('coach-1', 'COACH');
  const coach2 = user('coach-2', 'COACH');
  // client-1 is coach-1's client. former-1 moved to coach-2 after coach-1
  // assigned them a workout.
  const client1 = user('client-1', 'CLIENT', 'coach-1');
  const former1 = user('former-1', 'CLIENT', 'coach-2');

  beforeEach(async () => {
    jest.clearAllMocks();
    const assigned = workoutFixture({
      id: 'assigned-1',
      userId: 'client-1',
      assignedById: 'coach-1',
      status: WorkoutStatus.IN_PROGRESS,
    });
    const ofOtherCoach = workoutFixture({
      id: 'coach2-w',
      userId: 'client-1',
      assignedById: 'coach-2',
    });
    const self = workoutFixture({ id: 'self-1', userId: 'client-1' });
    const formerAssigned = workoutFixture({
      id: 'former-w',
      userId: 'former-1',
      assignedById: 'coach-1',
    });
    const all = [assigned, ofOtherCoach, self, formerAssigned];
    fake = createFakeWorkoutDb(
      {
        workouts: all.flatMap((f) => f.workouts),
        cards: all.flatMap((f) => f.cards),
        sets: all.flatMap((f) => f.sets),
        users: [coach1, coach2, client1, former1].map((u) => ({ ...u })),
        exercises,
      },
      exerciseRepo,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoachWorkoutsService,
        { provide: getRepositoryToken(Workout), useValue: fake.workoutRepo },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: LiftRecordsService, useValue: liftRecordsStub() },
      ],
    }).compile();

    service = module.get(CoachWorkoutsService);
  });

  const noWrites = () => expect(fake.writes).toEqual([]);

  const expectLockedFirst = (where: Record<string, unknown>) => {
    expect(fake.reads[0]).toEqual({
      entity: 'Workout',
      where,
      lock: { mode: 'pessimistic_write' },
      relations: undefined,
    });
  };

  // The coach editor sends the whole plan back with every id.
  const currentPlan = (): CoachCardInput[] => [
    {
      id: 'assigned-1-card-a',
      exerciseId: 'global-1',
      order: 1,
      sets: [{ id: 'assigned-1-set-a1', reps: 5, weight: 100, order: 1 }],
    },
    {
      id: 'assigned-1-card-b',
      exerciseId: 'coach1-ex',
      order: 2,
      sets: [
        { id: 'assigned-1-set-b1', reps: 8, weight: 10, order: 1 },
        { id: 'assigned-1-set-b2', reps: 8, weight: 20, order: 2 },
      ],
    },
  ];

  const setUpdates = () =>
    fake.writes.filter((w) => w.entity === 'WorkoutSet' && w.op === 'update');

  describe('findForClient', () => {
    it('lists only the workouts this coach assigned to the client, cards sorted', async () => {
      const workouts = await service.findForClient('client-1', coach1);
      expect(workouts.map((w) => w.id)).toEqual(['assigned-1']);
      expect(workouts[0].exercises.map((c) => c.order)).toEqual([1, 2]);
      expect(workouts[0].exercises[1].sets.map((s) => s.order)).toEqual([1, 2]);
      expect(workouts[0].assignedBy).toEqual({
        id: 'coach-1',
        name: 'coach-1 name',
      });
      expect(fake.workoutRepo.find.mock.calls[0][0]).toMatchObject({
        where: { userId: 'client-1', assignedById: 'coach-1' },
      });
    });

    it('403s for someone who is not a client of the caller now', async () => {
      await expect(
        service.findForClient('former-1', coach1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.findForClient('client-1', coach2),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.findForClient('coach-2', coach1),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createForClient', () => {
    const body = (
      overrides: Partial<CreateCoachWorkoutDto> = {},
    ): CreateCoachWorkoutDto => ({
      name: 'Week 1',
      date: '2030-03-01',
      exercises: [
        {
          exerciseId: 'global-1',
          order: 1,
          sets: [
            { reps: 5, weight: 100, order: 1 },
            { reps: 5, weight: null, notes: 'pause', order: 2 },
          ],
        },
        {
          exerciseId: 'global-1',
          order: 2,
          supersetGroup: 'group-1',
          sets: [{ reps: 3 }],
        },
      ],
      ...overrides,
    });

    it('creates a planned workout owned by the client and assigned by the caller', async () => {
      const result = await service.createForClient('client-1', body(), coach1);
      expect(result).toMatchObject({
        userId: 'client-1',
        assignedById: 'coach-1',
        status: WorkoutStatus.PLANNED,
        name: 'Week 1',
        totalWeightLifted: 0,
      });
      expect(result.date).toEqual(new Date('2030-03-01'));
      // 2 cards with the same exercise stay separate, sets in order
      expect(
        result.exercises.map((c) => ({
          exerciseId: c.exerciseId,
          supersetGroup: c.supersetGroup,
          sets: c.sets.map((s) => [s.order, s.reps, s.weight, s.notes, s.made]),
        })),
      ).toEqual([
        {
          exerciseId: 'global-1',
          supersetGroup: null,
          sets: [
            [1, 5, 100, null, null],
            [2, 5, null, 'pause', null],
          ],
        },
        {
          exerciseId: 'global-1',
          supersetGroup: 'group-1',
          sets: [[1, 3, null, null, null]],
        },
      ]);
      expect(fake.manager.transaction).toHaveBeenCalledTimes(1);
    });

    it('403s for a client not assigned to the caller and writes nothing', async () => {
      await expect(
        service.createForClient('former-1', body(), coach1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      noWrites();
    });

    it("400s on another coach's private exercise and writes nothing", async () => {
      await expect(
        service.createForClient(
          'client-1',
          body({
            exercises: [{ exerciseId: 'coach2-ex', order: 1, sets: [] }],
          }),
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      noWrites();
    });

    it("accepts the coach's own exercise, checking visibility as global + the coach", async () => {
      await service.createForClient(
        'client-1',
        body({ exercises: [{ exerciseId: 'coach1-ex', order: 1, sets: [] }] }),
        coach1,
      );
      expect(exerciseRepo.count).toHaveBeenCalledWith({
        where: [
          { id: 'coach1-ex', createdById: IsNull() },
          { id: 'coach1-ex', createdById: 'coach-1' },
        ],
      });
    });

    it('400s on card or set ids in a new workout', async () => {
      await expect(
        service.createForClient(
          'client-1',
          body({
            exercises: [
              {
                id: 'assigned-1-card-a',
                exerciseId: 'global-1',
                order: 1,
                sets: [],
              },
            ],
          }),
          coach1,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      noWrites();
    });
  });

  describe('findOne', () => {
    it('returns an own assigned workout with the trimmed coach', async () => {
      const workout = await service.findOne('assigned-1', coach1);
      expect(workout.id).toBe('assigned-1');
      expect(workout.assignedBy).toEqual({
        id: 'coach-1',
        name: 'coach-1 name',
      });
    });

    it("404s on another coach's assignment or a client's own workout", async () => {
      await expect(service.findOne('coach2-w', coach1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findOne('self-1', coach1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("403s on a former client's workout", async () => {
      await expect(service.findOne('former-w', coach1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('updates planned values in place and keeps the results of kept sets', async () => {
      const plan = currentPlan();
      plan[1].sets[0] = { ...plan[1].sets[0], reps: 6, weight: 15 };
      await service.update('assigned-1', { exercises: plan }, coach1);

      expect(fake.set('assigned-1-set-b1')).toMatchObject({
        reps: 6,
        weight: 15,
        made: true,
        actualReps: 6,
        actualWeight: 12.5,
      });
      for (const write of setUpdates()) {
        expect(Object.keys(write.values ?? {})).toEqual(
          expect.not.arrayContaining(RESULT_KEYS),
        );
      }
    });

    it('keeps the results on the sets of a card whose exercise changed', async () => {
      const plan = currentPlan();
      plan[1] = { ...plan[1], exerciseId: 'global-1' };
      await service.update('assigned-1', { exercises: plan }, coach1);
      expect(fake.cardsOf('assigned-1')).toContainEqual(
        expect.objectContaining({
          id: 'assigned-1-card-b',
          exerciseId: 'global-1',
        }),
      );
      expect(fake.set('assigned-1-set-b1')?.made).toBe(true);
    });

    it('keeps the results on a set moved to another card of the workout', async () => {
      const plan = currentPlan();
      const [moved, ...rest] = plan[1].sets;
      plan[0].sets.push({ ...moved, order: 2 });
      plan[1].sets = rest;
      await service.update('assigned-1', { exercises: plan }, coach1);
      expect(fake.set('assigned-1-set-b1')).toMatchObject({
        workoutExerciseId: 'assigned-1-card-a',
        order: 2,
        made: true,
        actualReps: 6,
      });
    });

    it('keeps the results on a set moved to a new card', async () => {
      const plan = currentPlan();
      const [moved, ...rest] = plan[1].sets;
      plan[1].sets = rest;
      plan.push({ exerciseId: 'global-1', order: 3, sets: [moved] });
      await service.update('assigned-1', { exercises: plan }, coach1);
      const set = fake.set('assigned-1-set-b1');
      expect(set?.workoutExerciseId).toMatch(/^gen-WorkoutExercise/);
      expect(set?.made).toBe(true);
    });

    it('deletes removed cards and sets and creates new ones with no result', async () => {
      await service.update(
        'assigned-1',
        {
          exercises: [
            {
              id: 'assigned-1-card-b',
              exerciseId: 'coach1-ex',
              order: 1,
              sets: [
                { id: 'assigned-1-set-b1', reps: 8, weight: 10, order: 1 },
                { reps: 2, weight: 50, order: 2 },
              ],
            },
            { exerciseId: 'coach1-ex', order: 2, sets: [{ reps: 1 }] },
          ],
        },
        coach1,
      );
      expect(fake.cardsOf('assigned-1').map((c) => c.id)).toEqual([
        'assigned-1-card-b',
        expect.stringMatching(/^gen-WorkoutExercise/),
      ]);
      expect(fake.set('assigned-1-set-a1')).toBeUndefined();
      expect(fake.set('assigned-1-set-b2')).toBeUndefined();
      const inserted = fake.writes.filter(
        (w) => w.entity === 'WorkoutSet' && w.op === 'insert',
      );
      expect(inserted).toHaveLength(2);
      for (const write of inserted) {
        expect(write.values).toMatchObject({
          made: null,
          actualReps: null,
          actualWeight: null,
        });
      }
    });

    it('writes cards, then sets, then deletes removed sets, then removed cards', async () => {
      const plan = currentPlan().slice(1);
      plan[0].sets = plan[0].sets.slice(0, 1);
      await service.update('assigned-1', { exercises: plan }, coach1);
      const order = fake.writes.map((w) => `${w.op}:${w.entity}`);
      expect(order).toEqual([
        'update:WorkoutExercise',
        'update:WorkoutSet',
        'delete:WorkoutSet',
        'delete:WorkoutExercise',
        'update:Workout',
      ]);
    });

    it('runs every write in one transaction after locking the bare workout row', async () => {
      await service.update('assigned-1', { exercises: currentPlan() }, coach1);
      expect(fake.manager.transaction).toHaveBeenCalledTimes(1);
      expectLockedFirst({ id: 'assigned-1', assignedById: 'coach-1' });
    });

    it('rolls back every write when one fails inside the transaction', async () => {
      fake.manager.delete.mockRejectedValueOnce(new Error('db down'));
      const plan = currentPlan().slice(1);
      plan[0].sets[0] = { ...plan[0].sets[0], reps: 1 };
      await expect(
        service.update('assigned-1', { exercises: plan }, coach1),
      ).rejects.toThrow('db down');
      expect(fake.set('assigned-1-set-b1')?.reps).toBe(8);
      expect(fake.cardsOf('assigned-1')).toHaveLength(2);
    });

    it('clears weight and notes the coach emptied on a kept set', async () => {
      fake.set('assigned-1-set-a1')!.notes = 'old note';
      const plan = currentPlan();
      plan[0].sets[0] = { id: 'assigned-1-set-a1', reps: 5, order: 1 };
      await service.update('assigned-1', { exercises: plan }, coach1);
      expect(fake.set('assigned-1-set-a1')).toMatchObject({
        weight: null,
        notes: null,
      });
    });

    it('keeps adjacent cards with the same exercise apart across save and reload', async () => {
      const plan = currentPlan();
      plan[1] = { ...plan[1], exerciseId: 'global-1' };
      const result = await service.update(
        'assigned-1',
        { exercises: plan },
        coach1,
      );
      expect(result.exercises.map((c) => [c.id, c.exerciseId])).toEqual([
        ['assigned-1-card-a', 'global-1'],
        ['assigned-1-card-b', 'global-1'],
      ]);
      const reloaded = await service.findOne('assigned-1', coach1);
      expect(reloaded.exercises).toHaveLength(2);
    });

    it.each([
      [
        'a set id from another workout',
        (plan: CoachCardInput[]) =>
          plan[0].sets.push({ id: 'self-1-set-a1', reps: 1 }),
      ],
      [
        'a card id from another workout',
        (plan: CoachCardInput[]) =>
          plan.push({
            id: 'coach2-w-card-a',
            exerciseId: 'global-1',
            order: 3,
            sets: [],
          }),
      ],
      [
        'an id that exists nowhere',
        (plan: CoachCardInput[]) =>
          plan[0].sets.push({
            id: '55555555-5555-4555-8555-555555555555',
            reps: 1,
          }),
      ],
    ])('400s on %s and writes nothing', async (_label, mutate) => {
      const plan = currentPlan();
      mutate(plan);
      await expect(
        service.update('assigned-1', { exercises: plan }, coach1),
      ).rejects.toBeInstanceOf(BadRequestException);
      noWrites();
    });

    it("400s on another coach's private exercise and writes nothing", async () => {
      const plan = currentPlan();
      plan[0] = { ...plan[0], exerciseId: 'coach2-ex' };
      await expect(
        service.update('assigned-1', { exercises: plan }, coach1),
      ).rejects.toBeInstanceOf(BadRequestException);
      noWrites();
    });

    it('saves supersetGroup on kept and new cards', async () => {
      const plan = currentPlan();
      plan[0] = { ...plan[0], supersetGroup: 'group-1' };
      plan.push({
        exerciseId: 'global-1',
        order: 3,
        supersetGroup: 'group-1',
        sets: [],
      });
      const result = await service.update(
        'assigned-1',
        { exercises: plan },
        coach1,
      );
      expect(result.exercises.map((c) => c.supersetGroup)).toEqual([
        'group-1',
        null,
        'group-1',
      ]);
    });

    it('updates name, date and notes alone without touching cards or status', async () => {
      const result = await service.update(
        'assigned-1',
        { name: 'Renamed', date: '2030-04-01', notes: 'Deload' },
        coach1,
      );
      expect(result).toMatchObject({
        name: 'Renamed',
        notes: 'Deload',
        status: WorkoutStatus.IN_PROGRESS,
      });
      expect(result.date).toEqual(new Date('2030-04-01'));
      expect(fake.writes).toEqual([
        expect.objectContaining({ op: 'update', entity: 'Workout' }),
      ]);
    });

    it('recomputes the total from the kept results', async () => {
      const plan = currentPlan();
      plan[1].sets[0] = { ...plan[1].sets[0], weight: 40 };
      const result = await service.update(
        'assigned-1',
        { exercises: plan },
        coach1,
      );
      // set-b1 is made with actual 6 × 12.5, so the planned weight is ignored
      expect(result.totalWeightLifted).toBe(75);
      expect(result.status).toBe(WorkoutStatus.IN_PROGRESS);
    });

    it("404s on another coach's assignment and 403s on a former client's", async () => {
      await expect(
        service.update('coach2-w', { name: 'x' }, coach1),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.update('former-w', { name: 'x' }, coach1),
      ).rejects.toBeInstanceOf(ForbiddenException);
      noWrites();
    });
  });

  describe('remove', () => {
    it('deletes an own assigned workout under the row lock', async () => {
      await service.remove('assigned-1', coach1);
      expect(fake.workout('assigned-1')).toBeUndefined();
      expect(fake.cardsOf('assigned-1')).toEqual([]);
      expectLockedFirst({ id: 'assigned-1', assignedById: 'coach-1' });
    });

    it("404s on another coach's assignment and 403s on a former client's", async () => {
      await expect(service.remove('coach2-w', coach1)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.remove('former-w', coach1)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      noWrites();
    });
  });
});
