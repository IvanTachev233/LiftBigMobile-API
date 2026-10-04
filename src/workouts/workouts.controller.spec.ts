import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { UpdateWorkoutDto } from './dto/workout.dto';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsService } from './workouts.service';
import { ROLES_KEY } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth-user.interface';

describe('WorkoutsController', () => {
  let controller: WorkoutsController;
  const workoutsService = {
    findAllExercises: jest.fn(),
    createExercise: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkoutsController],
      providers: [{ provide: WorkoutsService, useValue: workoutsService }],
    }).compile();

    controller = module.get<WorkoutsController>(WorkoutsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('restricts POST /workouts/exercises to COACH via @Roles metadata', () => {
    const reflector = new Reflector();
    // Read via the descriptor; the handler is only a metadata target
    const handler = Object.getOwnPropertyDescriptor(
      WorkoutsController.prototype,
      'createExercise',
    )?.value as (...args: unknown[]) => unknown;
    const roles = reflector.get<string[]>(ROLES_KEY, handler);
    expect(roles).toEqual(['COACH']);
  });

  describe('POST /workouts/exercises guards', () => {
    const reflector = new Reflector();
    // Read via the descriptor; the handler is only a metadata target
    const createExerciseHandler = Object.getOwnPropertyDescriptor(
      WorkoutsController.prototype,
      'createExercise',
    )?.value as (...args: unknown[]) => unknown;

    const contextFor = (role: string): ExecutionContext =>
      ({
        getHandler: () => createExerciseHandler,
        getClass: () => WorkoutsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { id: 'user-1', role } }),
        }),
      }) as unknown as ExecutionContext;

    it('applies JwtAuthGuard on the controller and RolesGuard on the handler', () => {
      const classGuards =
        reflector.get<unknown[]>(GUARDS_METADATA, WorkoutsController) ?? [];
      const handlerGuards =
        reflector.get<unknown[]>(GUARDS_METADATA, createExerciseHandler) ?? [];
      expect(classGuards).toContain(JwtAuthGuard);
      expect(handlerGuards).toContain(RolesGuard);
    });

    it('real RolesGuard rejects a CLIENT with 403', () => {
      const guard = new RolesGuard(reflector);
      expect(() => guard.canActivate(contextFor('CLIENT'))).toThrow(
        ForbiddenException,
      );
    });

    it('real RolesGuard lets a COACH through', () => {
      const guard = new RolesGuard(reflector);
      expect(guard.canActivate(contextFor('COACH'))).toBe(true);
    });
  });

  it('forwards the caller to findAllExercises for visibility filtering', () => {
    const user = { id: 'coach-1', role: 'COACH' } as AuthUser;
    void controller.findAllExercises({ user } as never);
    expect(workoutsService.findAllExercises).toHaveBeenCalledWith(user);
  });

  it('sets createdById via the caller on createExercise', () => {
    const user = { id: 'coach-1', role: 'COACH' } as AuthUser;
    const dto = { name: 'Lunge' };
    void controller.createExercise(dto, { user } as never);
    expect(workoutsService.createExercise).toHaveBeenCalledWith(dto, user);
  });

  describe('PATCH /workouts/:id body', () => {
    // Same options as the global pipe in main.ts
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    const transform = (body: unknown) =>
      pipe.transform(body, { type: 'body', metatype: UpdateWorkoutDto });
    const card = {
      id: '33333333-3333-4333-8333-333333333333',
      exerciseId: '11111111-1111-4111-8111-111111111111',
      order: 1,
      supersetGroup: null,
      sets: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          reps: 5,
          weight: 100,
          order: 1,
          isCompleted: false,
        },
      ],
    };

    it('400s on a non-uuid supersetGroup', async () => {
      await expect(
        transform({ exercises: [{ ...card, supersetGroup: 'group-1' }] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('keeps card and set ids and strips the old flat sets', async () => {
      const dto = (await transform({
        exercises: [card],
        sets: [{ exerciseId: card.exerciseId, reps: 5, weight: 100 }],
      })) as UpdateWorkoutDto;
      expect(dto.exercises).toEqual([card]);
      expect(dto).not.toHaveProperty('sets');
    });

    it('forwards the body and caller to the service', () => {
      const user = { id: 'coach-1', role: 'COACH' } as AuthUser;
      const dto = { exercises: [] };
      void controller.update('workout-1', dto, { user } as never);
      expect(workoutsService.update).toHaveBeenCalledWith(
        'workout-1',
        dto,
        user,
      );
    });
  });

  it('describes the nested card and set DTOs in Swagger', async () => {
    const module = await Test.createTestingModule({
      controllers: [WorkoutsController],
      providers: [{ provide: WorkoutsService, useValue: workoutsService }],
    }).compile();
    const app = module.createNestApplication();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    await app.close();
    const schemas = document.components?.schemas as Record<
      string,
      {
        properties: Record<string, Record<string, unknown>>;
        required?: string[];
      }
    >;

    expect(schemas.UpdateWorkoutDto.properties.exercises).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/WorkoutExerciseInput' },
    });
    const cardSchema = schemas.WorkoutExerciseInput;
    expect(cardSchema.properties.sets).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/WorkoutSetInput' },
    });
    expect(cardSchema.properties.supersetGroup).toMatchObject({
      nullable: true,
    });
    expect(cardSchema.required).toEqual(
      expect.arrayContaining(['exerciseId', 'order', 'sets']),
    );
    expect(Object.keys(schemas.WorkoutSetInput.properties).sort()).toEqual([
      'id',
      'isCompleted',
      'order',
      'reps',
      'weight',
    ]);
  });
});
