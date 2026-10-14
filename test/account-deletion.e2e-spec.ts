import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { Invite, InviteStatus } from '../src/auth/invite.entity';
import { User } from '../src/auth/user.entity';
import {
  EmailCode,
  EmailCodePurpose,
} from '../src/email-codes/email-code.entity';
import { LiftRecordSource } from '../src/lifts/entities/lift-record-source';
import { RepMaxEntry } from '../src/lifts/entities/rep-max-entry.entity';
import { UserBestLift } from '../src/lifts/entities/user-best-lift.entity';
import { ProgramEnrollment } from '../src/programs/entities/program-enrollment.entity';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from '../src/programs/entities/program-template.entity';
import { Exercise } from '../src/workouts/entities/exercise.entity';
import { WorkoutExercise } from '../src/workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../src/workouts/entities/workout-set.entity';
import { Workout } from '../src/workouts/entities/workout.entity';
import { createE2eApp, E2eUser, registerAndLogin } from './e2e-app';
import { createSportWithExercises } from './e2e-fixtures';

describe('Account deletion (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let globalLift: Exercise;
  let programId: string;

  const server = () => app.getHttpServer();
  const deleteMe = (
    user: E2eUser,
    body: object = { password: user.password },
  ) =>
    request(server())
      .delete('/users/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send(body);
  const getMe = (user: E2eUser) =>
    request(server())
      .get('/users/me')
      .set('Authorization', `Bearer ${user.token}`);
  const login = (email: string, password: string) =>
    request(server()).post('/auth/login').send({ email, password });
  const registerAgain = (email: string, role: User['role'] = 'CLIENT') =>
    request(server())
      .post('/auth/register')
      .send({ name: 'Again', email, password: 'password123', role });
  const count = (entity: new () => object, where: object) =>
    dataSource.getRepository(entity).countBy(where);

  // A workout with one card of `exerciseId` and two sets
  const addWorkout = async (
    userId: string,
    exerciseId: string,
    extra: Partial<Workout> = {},
  ) => {
    const workout = await dataSource.getRepository(Workout).save({
      userId,
      name: `Workout ${randomUUID().slice(0, 6)}`,
      date: new Date('2026-10-01'),
      ...extra,
    });
    const card = await dataSource.getRepository(WorkoutExercise).save({
      workoutId: workout.id,
      exerciseId,
      order: 0,
    });
    const sets = await dataSource.getRepository(WorkoutSet).save([
      {
        workoutExerciseId: card.id,
        reps: 5,
        weight: 100,
        order: 0,
        made: true,
      },
      { workoutExerciseId: card.id, reps: 5, weight: 100, order: 1 },
    ]);
    return { workout, card, sets };
  };

  // A manual 1RM through the API (entry + best lift) and one entry recorded
  // from a logged set
  const addLiftRecords = async (user: E2eUser, setId: string) => {
    await request(server())
      .post('/lifts/rep-maxes')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        exerciseId: globalLift.id,
        reps: 1,
        weightKg: 120,
        achievedOn: '2026-09-01',
      })
      .expect(201);
    await dataSource.getRepository(RepMaxEntry).save({
      userId: user.id,
      exerciseId: globalLift.id,
      reps: 1,
      weightKg: 100,
      achievedOn: '2026-10-01',
      source: LiftRecordSource.LOGGED_SET,
      workoutSetId: setId,
    });
  };

  const addEnrollment = (userId: string) =>
    dataSource.getRepository(ProgramEnrollment).save({
      userId,
      programId,
      programVersion: 1,
      startDate: '2026-10-01',
      maxesSnapshot: {},
    });

  const addInvite = (
    coachId: string,
    clientEmail: string,
    status = InviteStatus.PENDING,
  ) =>
    dataSource.getRepository(Invite).save({
      coachId,
      clientEmail,
      token: randomUUID(),
      status,
      expiresAt: new Date(Date.now() + 86400000),
    });

  const addEmailCode = (userId: string) =>
    dataSource.getRepository(EmailCode).save({
      userId,
      purpose: EmailCodePurpose.RESET_PASSWORD,
      codeHash: 'x',
      expiresAt: new Date(Date.now() + 900000),
    });

  const linkTo = (client: E2eUser, coach: E2eUser) =>
    dataSource
      .getRepository(User)
      .update({ id: client.id }, { coachId: coach.id });

  const createCoachExercise = async (coach: E2eUser) =>
    (
      await request(server())
        .post('/workouts/exercises')
        .set('Authorization', `Bearer ${coach.token}`)
        .send({ name: `Coach Lift ${randomUUID().slice(0, 6)}` })
        .expect(201)
    ).body as Exercise;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    const { sport, exercises } = await createSportWithExercises(
      dataSource,
      ['Snatch'],
      1,
    );
    globalLift = exercises.Snatch;
    const program = await dataSource.getRepository(ProgramTemplate).save({
      lineageId: randomUUID(),
      version: 1,
      sportId: sport.id,
      name: 'Test Program',
      durationWeeks: 4,
      sessionsPerWeek: 3,
      authorId: null,
      status: ProgramTemplateStatus.PUBLISHED,
    });
    programId = program.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('needs a login', async () => {
    await request(server())
      .delete('/users/me')
      .send({ password: 'password123' })
      .expect(401);
  });

  describe('client', () => {
    let client: E2eUser;
    let coach: E2eUser;

    beforeEach(async () => {
      client = await registerAndLogin(app);
      coach = await registerAndLogin(app, 'COACH');
      await linkTo(client, coach);
    });

    it('deletes the user and everything they own, answering 204', async () => {
      const coachLift = await createCoachExercise(coach);
      const own = await addWorkout(client.id, globalLift.id);
      const assigned = await addWorkout(client.id, coachLift.id, {
        assignedById: coach.id,
      });
      const enrollment = await addEnrollment(client.id);
      const fromProgram = await addWorkout(client.id, globalLift.id, {
        programEnrollmentId: enrollment.id,
      });
      await addLiftRecords(client, own.sets[0].id);
      const otherCoach = await registerAndLogin(app, 'COACH');
      await addInvite(otherCoach.id, client.email);
      await addInvite(coach.id, client.email, InviteStatus.ACCEPTED);
      await addEmailCode(client.id);
      const workoutIds = [own, assigned, fromProgram].map((w) => w.workout.id);
      const cardIds = [own, assigned, fromProgram].map((w) => w.card.id);
      expect(await count(RepMaxEntry, { userId: client.id })).toBe(2);
      expect(await count(UserBestLift, { userId: client.id })).toBe(1);

      const res = await deleteMe(client).expect(204);
      expect(res.text).toBe('');

      expect(await count(User, { id: client.id })).toBe(0);
      for (const id of workoutIds) expect(await count(Workout, { id })).toBe(0);
      for (const workoutExerciseId of cardIds) {
        expect(await count(WorkoutExercise, { id: workoutExerciseId })).toBe(0);
        expect(await count(WorkoutSet, { workoutExerciseId })).toBe(0);
      }
      expect(await count(RepMaxEntry, { userId: client.id })).toBe(0);
      expect(await count(UserBestLift, { userId: client.id })).toBe(0);
      expect(await count(ProgramEnrollment, { userId: client.id })).toBe(0);
      expect(await count(Invite, { clientEmail: client.email })).toBe(0);
      expect(await count(EmailCode, { userId: client.id })).toBe(0);

      // The coach, their exercise and the program are untouched
      await getMe(coach).expect(200);
      expect(await count(Exercise, { id: coachLift.id })).toBe(1);
      expect(await count(ProgramTemplate, { id: programId })).toBe(1);
    });

    it('signs out every token of the account and frees the email', async () => {
      const otherDevice = (
        (await login(client.email, client.password).expect(201)).body as {
          access_token: string;
        }
      ).access_token;
      await deleteMe(client).expect(204);

      await getMe(client).expect(401);
      await getMe({ ...client, token: otherDevice }).expect(401);
      await request(server())
        .get('/workouts')
        .set('Authorization', `Bearer ${client.token}`)
        .expect(401);
      await login(client.email, client.password).expect(401);
      await registerAgain(client.email).expect(201);
    });

    it("leaves other users' data alone", async () => {
      const other = await registerAndLogin(app);
      const theirs = await addWorkout(other.id, globalLift.id);
      await addLiftRecords(other, theirs.sets[0].id);
      await addInvite(coach.id, other.email);

      await deleteMe(client).expect(204);

      await getMe(other).expect(200);
      expect(await count(Workout, { id: theirs.workout.id })).toBe(1);
      expect(
        await count(WorkoutSet, { workoutExerciseId: theirs.card.id }),
      ).toBe(2);
      expect(await count(RepMaxEntry, { userId: other.id })).toBe(2);
      expect(await count(UserBestLift, { userId: other.id })).toBe(1);
      expect(await count(Invite, { clientEmail: other.email })).toBe(1);
    });
  });

  describe('coach', () => {
    let coach: E2eUser;
    let clientA: E2eUser;
    let clientB: E2eUser;

    beforeEach(async () => {
      coach = await registerAndLogin(app, 'COACH');
      clientA = await registerAndLogin(app);
      clientB = await registerAndLogin(app);
      await linkTo(clientA, coach);
      await linkTo(clientB, coach);
    });

    it('anonymises the row, unlinks the clients and removes the invites and own data', async () => {
      const coachLift = await createCoachExercise(coach);
      const assigned = await addWorkout(clientA.id, coachLift.id, {
        assignedById: coach.id,
      });
      const own = await addWorkout(coach.id, coachLift.id);
      await addLiftRecords(coach, own.sets[0].id);
      await addEnrollment(coach.id);
      const pending = await addInvite(coach.id, 'someone@example.com');
      await addInvite(coach.id, clientA.email, InviteStatus.ACCEPTED);
      await addEmailCode(coach.id);
      const before = await dataSource
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.tokenVersion')
        .where('user.id = :id', { id: coach.id })
        .getOneOrFail();

      const res = await deleteMe(coach).expect(204);
      expect(res.text).toBe('');

      const row = await dataSource
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect([
          'user.passwordHash',
          'user.tokenVersion',
          'user.failedPasswordAttempts',
          'user.passwordLockedUntil',
        ])
        .where('user.id = :id', { id: coach.id })
        .getOneOrFail();
      expect(row).toMatchObject({
        email: `deleted-${coach.id}@deleted.invalid`,
        name: null,
        role: 'COACH',
        coachId: null,
        emailVerifiedAt: null,
        tokenVersion: before.tokenVersion + 1,
        failedPasswordAttempts: 0,
        passwordLockedUntil: null,
      });
      expect(await bcrypt.compare(coach.password, row.passwordHash)).toBe(
        false,
      );
      expect(row.passwordHash).not.toMatch(/^\$2/);

      for (const client of [clientA, clientB]) {
        const linked = await dataSource
          .getRepository(User)
          .findOneByOrFail({ id: client.id });
        expect(linked.coachId).toBeNull();
      }
      expect(await count(Invite, { coachId: coach.id })).toBe(0);
      expect(await count(Workout, { id: own.workout.id })).toBe(0);
      expect(await count(WorkoutExercise, { id: own.card.id })).toBe(0);
      expect(await count(WorkoutSet, { workoutExerciseId: own.card.id })).toBe(
        0,
      );
      expect(await count(RepMaxEntry, { userId: coach.id })).toBe(0);
      expect(await count(UserBestLift, { userId: coach.id })).toBe(0);
      expect(await count(ProgramEnrollment, { userId: coach.id })).toBe(0);
      expect(await count(EmailCode, { userId: coach.id })).toBe(0);

      // The exercise and the assigned workout stay with the client
      expect(await count(Exercise, { id: coachLift.id })).toBe(1);
      expect(await count(Workout, { id: assigned.workout.id })).toBe(1);

      // An invite that was still open can no longer be accepted
      await request(server())
        .post(`/auth/invites/${pending.token}/accept`)
        .set('Authorization', `Bearer ${clientB.token}`)
        .expect(404);
    });

    it('lets the clients still read their assigned workouts and the exercises in them', async () => {
      const coachLift = await createCoachExercise(coach);
      const assigned = await addWorkout(clientA.id, coachLift.id, {
        assignedById: coach.id,
      });
      await deleteMe(coach).expect(204);

      const relogin = (
        (await login(clientA.email, clientA.password).expect(201)).body as {
          access_token: string;
        }
      ).access_token;
      for (const token of [clientA.token, relogin]) {
        const workout = (
          await request(server())
            .get(`/workouts/${assigned.workout.id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body as {
          assignedBy: { id: string; name: string | null } | null;
          exercises: { exercise: { id: string; name: string }; sets: [] }[];
        };
        expect(workout.assignedBy).toEqual({ id: coach.id, name: null });
        expect(workout.exercises).toHaveLength(1);
        expect(workout.exercises[0].exercise).toMatchObject({
          id: coachLift.id,
          name: coachLift.name,
        });
        expect(workout.exercises[0].sets).toHaveLength(2);
        const list = (
          await request(server())
            .get('/workouts')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        ).body as { id: string }[];
        expect(list.map((w) => w.id)).toContain(assigned.workout.id);
      }
    });

    it('signs the coach out everywhere, blocks logins and frees the email', async () => {
      await deleteMe(coach).expect(204);

      await getMe(coach).expect(401);
      await request(server())
        .get('/auth/clients')
        .set('Authorization', `Bearer ${coach.token}`)
        .expect(401);
      await login(coach.email, coach.password).expect(401);
      await login(`deleted-${coach.id}@deleted.invalid`, coach.password).expect(
        401,
      );
      await registerAgain(coach.email, 'COACH').expect(201);
    });
  });

  describe('password', () => {
    let client: E2eUser;

    beforeEach(async () => {
      client = await registerAndLogin(app);
    });

    const changePassword = (currentPassword: string) =>
      request(server())
        .post('/users/me/password')
        .set('Authorization', `Bearer ${client.token}`)
        .send({ currentPassword, newPassword: 'new-secret' });

    it('refuses a wrong password with 403 and the tries left, deleting nothing', async () => {
      const res = await deleteMe(client, { password: 'wrong-password' }).expect(
        403,
      );
      expect(res.body).toMatchObject({ attemptsLeft: 2 });
      expect(res.text).not.toContain('$2');
      await getMe(client).expect(200);
      expect(await count(User, { id: client.id })).toBe(1);
    });

    it('locks on the third wrong password, also for the right one, sharing the Change password count', async () => {
      await changePassword('wrong-password').expect(403);
      await deleteMe(client, { password: 'wrong-password' }).expect(403);
      const locked = await deleteMe(client, {
        password: 'wrong-password',
      }).expect(429);
      expect(locked.body).toMatchObject({ retryAfterMinutes: 15 });

      const still = await deleteMe(client).expect(429);
      expect(
        (still.body as { retryAfterMinutes: number }).retryAfterMinutes,
      ).toBeGreaterThan(0);
      await changePassword(client.password).expect(429);
      await getMe(client).expect(200);
      expect(await count(User, { id: client.id })).toBe(1);
    });

    it('deletes once the lock has run out', async () => {
      for (let i = 0; i < 3; i++) {
        await deleteMe(client, { password: 'wrong-password' });
      }
      await dataSource.query(
        `UPDATE "user" SET "passwordLockedUntil" = now() - interval '1 second' WHERE "id" = $1`,
        [client.id],
      );
      await deleteMe(client).expect(204);
    });

    it('rejects a missing, blank or non-string password with 400 without counting it', async () => {
      for (const body of [{}, { password: '' }, { password: 123456 }]) {
        await deleteMe(client, body).expect(400);
      }
      for (let i = 0; i < 3; i++) {
        await deleteMe(client, { password: '' }).expect(400);
      }
      const res = await deleteMe(client, { password: 'wrong-password' }).expect(
        403,
      );
      expect(res.body).toMatchObject({ attemptsLeft: 2 });
      await getMe(client).expect(200);
    });
  });
});
