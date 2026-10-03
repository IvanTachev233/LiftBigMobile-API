import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
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
});
