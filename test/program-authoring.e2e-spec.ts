import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  INestApplication,
} from '@nestjs/common';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { ProgramEnrollment } from '../src/programs/entities/program-enrollment.entity';
import {
  ProgramTemplate,
  ProgramTemplateStatus,
} from '../src/programs/entities/program-template.entity';
import { SYSTEM_ACTOR, userActor } from '../src/programs/program-actor';
import {
  ProgramService,
  ProgramTemplateInput,
} from '../src/programs/program.service';
import { createE2eApp, registerAndLogin } from './e2e-app';
import { createSportWithExercises, findUser } from './e2e-fixtures';

describe('ProgramService (e2e)', () => {
  let app: INestApplication<App>;
  let programs: ProgramService;
  let dataSource: DataSource;
  let template: () => ProgramTemplateInput;

  beforeAll(async () => {
    app = await createE2eApp();
    programs = app.get(ProgramService);
    dataSource = app.get(DataSource);
    const { sport, exercises } = await createSportWithExercises(
      dataSource,
      ['Squat', 'Pause Squat', 'Row'],
      1,
    );
    const session = (
      week: number,
      sessionIndex: number,
      dayOffset: number,
    ) => ({
      week,
      sessionIndex,
      dayOffset,
      title: `W${week} S${sessionIndex}`,
      exercises: [
        {
          exerciseId: exercises['Pause Squat'].id,
          sets: 3,
          reps: 3,
          percentOf1RM: 70,
          referenceExerciseId: exercises.Squat.id,
        },
        { exerciseId: exercises.Row.id, sets: 3, reps: 8 },
      ],
    });
    template = () => ({
      sportId: sport.id,
      name: 'Test Program',
      description: 'Two weeks',
      durationWeeks: 2,
      sessionsPerWeek: 2,
      sessions: [
        session(1, 1, 0),
        session(1, 2, 3),
        session(2, 1, 0),
        session(2, 2, 3),
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const statusOf = async (id: string) =>
    (await dataSource.getRepository(ProgramTemplate).findOneByOrFail({ id }))
      .status;

  // Sessions and exercises without ids or parent keys.
  const shape = (program: ProgramTemplate) =>
    program.sessions.map((s) => ({
      week: s.week,
      sessionIndex: s.sessionIndex,
      dayOffset: s.dayOffset,
      title: s.title,
      exercises: s.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        order: e.order,
        sets: e.sets,
        reps: e.reps,
        percentOf1RM: e.percentOf1RM,
        referenceExerciseId: e.referenceExerciseId,
      })),
    }));

  it('creates a system draft as version 1 of a new lineage', async () => {
    const draft = await programs.createDraft(SYSTEM_ACTOR, template());
    expect(draft).toMatchObject({
      version: 1,
      status: ProgramTemplateStatus.DRAFT,
      authorId: null,
      durationWeeks: 2,
    });
    expect(draft.sessions).toHaveLength(4);
    expect(draft.sessions[0].exercises.map((e) => e.order)).toEqual([1, 2]);
    expect(draft.sessions[0].exercises[0].percentOf1RM).toBe(70);
  });

  it('gives a user actor 403 on every authoring method', async () => {
    const user = await registerAndLogin(app, 'COACH');
    const actor = userActor(await findUser(dataSource, user.id));
    const draft = await programs.createDraft(SYSTEM_ACTOR, template());

    const calls = [
      () => programs.createDraft(actor, template()),
      () => programs.updateDraft(actor, draft.id, template()),
      () => programs.publish(actor, draft.id),
      () => programs.revise(actor, draft.id),
      () => programs.archive(actor, draft.id),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(await statusOf(draft.id)).toBe(ProgramTemplateStatus.DRAFT);
  });

  it('edits a draft, replacing its sessions', async () => {
    const draft = await programs.createDraft(SYSTEM_ACTOR, template());
    const input = template();
    input.name = 'Renamed';
    input.sessions[0].exercises[0].sets = 5;
    const updated = await programs.updateDraft(SYSTEM_ACTOR, draft.id, input);
    expect(updated.name).toBe('Renamed');
    expect(updated.sessions[0].exercises[0].sets).toBe(5);
    expect(updated.sessions).toHaveLength(4);
  });

  it('rejects edits to PUBLISHED and ARCHIVED rows', async () => {
    const draft = await programs.createDraft(SYSTEM_ACTOR, template());
    await programs.publish(SYSTEM_ACTOR, draft.id);
    await expect(
      programs.updateDraft(SYSTEM_ACTOR, draft.id, template()),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      programs.publish(SYSTEM_ACTOR, draft.id),
    ).rejects.toBeInstanceOf(ConflictException);

    await programs.archive(SYSTEM_ACTOR, draft.id);
    expect(await statusOf(draft.id)).toBe(ProgramTemplateStatus.ARCHIVED);
    await expect(
      programs.updateDraft(SYSTEM_ACTOR, draft.id, template()),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      programs.revise(SYSTEM_ACTOR, draft.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns 400 with every error for an invalid draft and keeps it DRAFT', async () => {
    const input = template();
    input.sessions = input.sessions.filter((s) => s.week === 1);
    input.sessions[0].exercises[0].percentOf1RM = 111;
    input.sessions[1].exercises[1].sets = 0;
    const draft = await programs.createDraft(SYSTEM_ACTOR, input);

    const error: unknown = await programs
      .publish(SYSTEM_ACTOR, draft.id)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as {
      errors: { rule: number; message: string }[];
    };
    expect(body.errors.map((e) => e.rule)).toEqual([2, 3, 6]);
    expect(await statusOf(draft.id)).toBe(ProgramTemplateStatus.DRAFT);
  });

  it('rejects a draft that names an unknown exercise with 400', async () => {
    const input = template();
    input.sessions[0].exercises[1].exerciseId =
      '00000000-0000-4000-8000-000000000000';
    await expect(
      programs.createDraft(SYSTEM_ACTOR, input),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('revises into v2 and archives v1 on publish, leaving v1 enrollments unchanged', async () => {
    const v1 = await programs.publish(
      SYSTEM_ACTOR,
      (await programs.createDraft(SYSTEM_ACTOR, template())).id,
    );
    const client = await registerAndLogin(app);
    const enrollment = await dataSource.getRepository(ProgramEnrollment).save({
      userId: client.id,
      programId: v1.id,
      programVersion: 1,
      startDate: '2026-10-14',
      maxesSnapshot: {},
    });

    const v2 = await programs.revise(SYSTEM_ACTOR, v1.id);
    expect(v2).toMatchObject({
      lineageId: v1.lineageId,
      version: 2,
      status: ProgramTemplateStatus.DRAFT,
    });
    expect(shape(v2)).toEqual(shape(v1));
    const v1SessionIds = new Set(v1.sessions.map((s) => s.id));
    expect(v2.sessions.some((s) => v1SessionIds.has(s.id))).toBe(false);
    await expect(programs.revise(SYSTEM_ACTOR, v1.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const input = template();
    input.sessions[0].exercises[0].percentOf1RM = 80;
    await programs.updateDraft(SYSTEM_ACTOR, v2.id, input);
    await programs.publish(SYSTEM_ACTOR, v2.id);

    expect(await statusOf(v1.id)).toBe(ProgramTemplateStatus.ARCHIVED);
    expect(await statusOf(v2.id)).toBe(ProgramTemplateStatus.PUBLISHED);
    const reloaded = await dataSource
      .getRepository(ProgramEnrollment)
      .findOneOrFail({
        where: { id: enrollment.id },
        relations: { program: { sessions: { exercises: true } } },
        order: {
          program: {
            sessions: {
              week: 'ASC',
              sessionIndex: 'ASC',
              exercises: { order: 'ASC' },
            },
          },
        },
      });
    expect(reloaded.program.id).toBe(v1.id);
    expect(shape(reloaded.program)).toEqual(shape(v1));
  });
});
