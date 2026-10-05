import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CoachWorkoutsController } from './coach-workouts.controller';
import { CoachWorkoutsService } from './coach-workouts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const WORKOUT = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e01';
const CARD = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e02';
const SET = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e03';
const EXERCISE = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e04';
const CLIENT = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e05';

// Real RolesGuard and the app's ValidationPipe; only the JWT check is faked,
// taking the caller from test headers.
describe('CoachWorkoutsController (HTTP)', () => {
  let app: INestApplication<App>;
  const service = {
    findForClient: jest.fn(() => Promise.resolve([])),
    createForClient: jest.fn(() => Promise.resolve({ id: WORKOUT })),
    findOne: jest.fn(() => Promise.resolve({ id: WORKOUT })),
    update: jest.fn(() => Promise.resolve({ id: WORKOUT })),
    remove: jest.fn(() => Promise.resolve()),
  };

  const asUser = (role: string, id = 'user-1') => ({
    'x-role': role,
    'x-user-id': id,
  });

  const card = {
    id: CARD,
    exerciseId: EXERCISE,
    order: 1,
    supersetGroup: null,
    sets: [{ id: SET, reps: 5, weight: 100, notes: null, order: 1 }],
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CoachWorkoutsController],
      providers: [{ provide: CoachWorkoutsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{
            headers: Record<string, string>;
            user: unknown;
          }>();
          req.user = {
            id: req.headers['x-user-id'],
            role: req.headers['x-role'],
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  // Every row has a body slot; a missing third value would make jest pass
  // its done callback in its place.
  const routes: [string, string, object | null][] = [
    ['get', `/coach/clients/${CLIENT}/workouts`, null],
    [
      'post',
      `/coach/clients/${CLIENT}/workouts`,
      { name: 'W', date: '2030-01-01', exercises: [] },
    ],
    ['get', `/coach/workouts/${WORKOUT}`, null],
    ['put', `/coach/workouts/${WORKOUT}`, { name: 'W' }],
    ['delete', `/coach/workouts/${WORKOUT}`, null],
  ];

  it.each(routes)('403s a CLIENT on %s %s', async (method, url, body) => {
    const agent = request(app.getHttpServer());
    const req = (agent[method as 'get'](url) as request.Test).set(
      asUser('CLIENT'),
    );
    await (body ? req.send(body) : req).expect(403);
    for (const fn of Object.values(service)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('lists the client workouts for the calling coach', async () => {
    await request(app.getHttpServer())
      .get(`/coach/clients/${CLIENT}/workouts`)
      .set(asUser('COACH', 'coach-1'))
      .expect(200);
    expect(service.findForClient).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({ id: 'coach-1' }),
    );
  });

  it('201s a coach creating a workout with nested planned cards', async () => {
    const newCard = { ...card, id: undefined, sets: [{ reps: 5 }] };
    await request(app.getHttpServer())
      .post(`/coach/clients/${CLIENT}/workouts`)
      .set(asUser('COACH', 'coach-1'))
      .send({
        name: 'Week 1',
        date: '2030-10-05',
        exercises: [newCard, newCard],
      })
      .expect(201);
    const [clientId, dto] = service.createForClient.mock
      .calls[0] as unknown as [string, { exercises: unknown[] }];
    expect(clientId).toBe(CLIENT);
    expect(dto.exercises).toHaveLength(2);
  });

  it('passes nested card and set ids through on PUT', async () => {
    await request(app.getHttpServer())
      .put(`/coach/workouts/${WORKOUT}`)
      .set(asUser('COACH', 'coach-1'))
      .send({ exercises: [card] })
      .expect(200);
    expect(service.update).toHaveBeenCalledWith(
      WORKOUT,
      { exercises: [card] },
      expect.objectContaining({ id: 'coach-1' }),
    );
  });

  it.each([
    ['made', { made: true }],
    ['made null', { made: null }],
    ['actualReps', { actualReps: 3 }],
    ['actualWeight', { actualWeight: 100 }],
  ])('400s a PUT whose set carries %s', async (_label, extra) => {
    await request(app.getHttpServer())
      .put(`/coach/workouts/${WORKOUT}`)
      .set(asUser('COACH'))
      .send({ exercises: [{ ...card, sets: [{ ...card.sets[0], ...extra }] }] })
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
  });

  it('400s a PUT or POST that sets the status', async () => {
    await request(app.getHttpServer())
      .put(`/coach/workouts/${WORKOUT}`)
      .set(asUser('COACH'))
      .send({ status: 'COMPLETED' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/coach/clients/${CLIENT}/workouts`)
      .set(asUser('COACH'))
      .send({ name: 'W', date: '2030-01-01', exercises: [], status: 'PLANNED' })
      .expect(400);
    expect(service.update).not.toHaveBeenCalled();
    expect(service.createForClient).not.toHaveBeenCalled();
  });

  it('400s a non-uuid supersetGroup, a non-uuid set id or a missing sets array', async () => {
    const bad = [
      { ...card, supersetGroup: 'group-1' },
      { ...card, sets: [{ ...card.sets[0], id: 'set-1' }] },
      { ...card, sets: undefined },
    ];
    for (const c of bad) {
      await request(app.getHttpServer())
        .put(`/coach/workouts/${WORKOUT}`)
        .set(asUser('COACH'))
        .send({ exercises: [c] })
        .expect(400);
    }
    expect(service.update).not.toHaveBeenCalled();
  });

  it('400s non-uuid path ids', async () => {
    await request(app.getHttpServer())
      .get('/coach/clients/not-a-uuid/workouts')
      .set(asUser('COACH'))
      .expect(400);
    await request(app.getHttpServer())
      .delete('/coach/workouts/not-a-uuid')
      .set(asUser('COACH'))
      .expect(400);
    expect(service.findForClient).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('maps the service 403 and 404 through', async () => {
    service.findOne.mockRejectedValueOnce(new ForbiddenException());
    await request(app.getHttpServer())
      .get(`/coach/workouts/${WORKOUT}`)
      .set(asUser('COACH'))
      .expect(403);
    service.remove.mockRejectedValueOnce(new NotFoundException());
    await request(app.getHttpServer())
      .delete(`/coach/workouts/${WORKOUT}`)
      .set(asUser('COACH'))
      .expect(404);
  });
});
