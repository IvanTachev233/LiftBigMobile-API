import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const PROGRAM = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e01';
const CARD = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e02';
const SET = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e03';
const EXERCISE = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e04';
const CLIENT = '2f1c1f4e-0a3b-4c55-9f0e-6b1f3c2d4e05';

// Real RolesGuard and the app's ValidationPipe; only the JWT check is faked,
// taking the caller from test headers.
describe('ProgramsController (HTTP)', () => {
  let app: INestApplication<App>;
  const programsService = {
    create: jest.fn(() => Promise.resolve({ id: PROGRAM })),
    update: jest.fn(() => Promise.resolve({ id: PROGRAM })),
    addSet: jest.fn(() => Promise.resolve({ id: SET })),
    updateSet: jest.fn(() => Promise.resolve({ id: SET })),
  };

  const asUser = (role: string, id = 'user-1') => ({
    'x-role': role,
    'x-user-id': id,
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ProgramsController],
      providers: [{ provide: ProgramsService, useValue: programsService }],
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

  describe('POST /programs/:id/exercises/:cardId/sets', () => {
    const url = `/programs/${PROGRAM}/exercises/${CARD}/sets`;

    it('201 for a client adding a set', async () => {
      await request(app.getHttpServer())
        .post(url)
        .set(asUser('CLIENT', 'client-1'))
        .send({ reps: 5, weight: null, notes: null, made: true })
        .expect(201);
      expect(programsService.addSet).toHaveBeenCalledWith(
        PROGRAM,
        CARD,
        { reps: 5, weight: null, notes: null, made: true },
        'client-1',
      );
    });

    it("404 when the service finds no such card on the client's program", async () => {
      programsService.addSet.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .post(url)
        .set(asUser('CLIENT', 'client-2'))
        .send({ reps: 5 })
        .expect(404);
    });

    it('403 for a coach', async () => {
      await request(app.getHttpServer())
        .post(url)
        .set(asUser('COACH'))
        .send({ reps: 5 })
        .expect(403);
      expect(programsService.addSet).not.toHaveBeenCalled();
    });

    it('400 for a non-uuid card id or a bad body', async () => {
      await request(app.getHttpServer())
        .post(`/programs/${PROGRAM}/exercises/not-a-uuid/sets`)
        .set(asUser('CLIENT'))
        .send({ reps: 5 })
        .expect(400);
      await request(app.getHttpServer())
        .post(url)
        .set(asUser('CLIENT'))
        .send({ reps: 'five' })
        .expect(400);
      expect(programsService.addSet).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /programs/:id/sets/:setId', () => {
    const url = `/programs/${PROGRAM}/sets/${SET}`;

    it('200 for a client marking a result', async () => {
      await request(app.getHttpServer())
        .patch(url)
        .set(asUser('CLIENT', 'client-1'))
        .send({ made: false })
        .expect(200);
      expect(programsService.updateSet).toHaveBeenCalledWith(
        PROGRAM,
        SET,
        { made: false },
        'client-1',
      );
    });

    it('403 for a coach', async () => {
      await request(app.getHttpServer())
        .patch(url)
        .set(asUser('COACH', 'coach-2'))
        .send({ made: true })
        .expect(403);
      expect(programsService.updateSet).not.toHaveBeenCalled();
    });

    it('404 when the set is not in the program', async () => {
      programsService.updateSet.mockRejectedValueOnce(new NotFoundException());
      await request(app.getHttpServer())
        .patch(url)
        .set(asUser('CLIENT'))
        .send({ made: true })
        .expect(404);
    });
  });

  it('removes the old flat-row client routes', async () => {
    await request(app.getHttpServer())
      .post(`/programs/${PROGRAM}/exercises`)
      .set(asUser('CLIENT'))
      .send({ exerciseId: EXERCISE, reps: 5 })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/programs/${PROGRAM}/exercises/${CARD}`)
      .set(asUser('CLIENT'))
      .send({ made: true })
      .expect(404);
  });

  describe('POST /programs and PUT /programs/:id', () => {
    const card = {
      id: CARD,
      exerciseId: EXERCISE,
      order: 1,
      supersetGroup: null,
      sets: [{ id: SET, reps: 5, weight: 100, order: 1, made: true }],
    };

    it('passes nested card and set ids through and strips made from coach sets', async () => {
      await request(app.getHttpServer())
        .put(`/programs/${PROGRAM}`)
        .set(asUser('COACH', 'coach-1'))
        .send({ exercises: [card] })
        .expect(200);
      expect(programsService.update).toHaveBeenCalledWith(
        PROGRAM,
        {
          exercises: [
            {
              id: CARD,
              exerciseId: EXERCISE,
              order: 1,
              supersetGroup: null,
              sets: [{ id: SET, reps: 5, weight: 100, order: 1 }],
            },
          ],
        },
        'coach-1',
      );
    });

    it('201 for a coach creating a program with nested cards', async () => {
      // JSON drops the undefined id, so this is a new card
      const newCard = { ...card, id: undefined };
      await request(app.getHttpServer())
        .post('/programs')
        .set(asUser('COACH', 'coach-1'))
        .send({
          clientId: CLIENT,
          name: 'Week 1',
          scheduledDate: '2026-10-05',
          exercises: [newCard, newCard],
        })
        .expect(201);
      const [dto] = programsService.create.mock.calls[0] as unknown as [
        { exercises: unknown[] },
      ];
      expect(dto.exercises).toHaveLength(2);
    });

    it('400 for a non-uuid supersetGroup, a non-uuid set id or a missing sets array', async () => {
      const bad = [
        { ...card, supersetGroup: 'group-1' },
        { ...card, sets: [{ ...card.sets[0], id: 'set-1' }] },
        { ...card, sets: undefined },
      ];
      for (const c of bad) {
        await request(app.getHttpServer())
          .put(`/programs/${PROGRAM}`)
          .set(asUser('COACH'))
          .send({ exercises: [c] })
          .expect(400);
      }
      expect(programsService.update).not.toHaveBeenCalled();
    });

    it('403 for a client', async () => {
      await request(app.getHttpServer())
        .put(`/programs/${PROGRAM}`)
        .set(asUser('CLIENT'))
        .send({ exercises: [card] })
        .expect(403);
      expect(programsService.update).not.toHaveBeenCalled();
    });
  });
});
