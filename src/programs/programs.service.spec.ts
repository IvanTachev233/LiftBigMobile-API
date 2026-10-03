import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProgramsService } from './programs.service';
import { Program } from './entities/program.entity';
import { ProgramExercise } from './entities/program-exercise.entity';
import { Exercise } from '../workouts/entities/exercise.entity';
import { User } from '../auth/user.entity';
import { visibleExerciseWhere } from '../workouts/exercise-visibility.util';

describe('ProgramsService', () => {
  let service: ProgramsService;
  let program: Program;
  const programRepo = {
    findOne: jest.fn(),
    save: jest.fn((p: Program) => Promise.resolve(p)),
    create: jest.fn((data: Partial<Program>) => ({ ...data }) as Program),
  };
  const programExerciseRepo = {
    create: jest.fn((data: Partial<ProgramExercise>) => ({ ...data })),
    save: jest.fn((rows: ProgramExercise[]) => Promise.resolve(rows)),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  // Every exercise is visible by default; tests for the 400 path override it
  const exerciseRepo = {
    count: jest.fn(() => Promise.resolve(1)),
  };
  const userRepo = {
    findOne: jest.fn(),
  };

  const row = (id: string, made: boolean | null, order: number) =>
    ({
      id,
      programId: 'program-1',
      exerciseId: 'squat',
      reps: 5,
      weight: 100,
      notes: 'belt',
      order,
      made,
    }) as ProgramExercise;

  beforeEach(async () => {
    jest.clearAllMocks();
    exerciseRepo.count.mockResolvedValue(1);
    program = {
      id: 'program-1',
      coachId: 'coach-1',
      exercises: [row('set-1', true, 1), row('set-2', false, 2)],
    } as Program;
    programRepo.findOne.mockResolvedValue(program);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgramsService,
        { provide: getRepositoryToken(Program), useValue: programRepo },
        {
          provide: getRepositoryToken(ProgramExercise),
          useValue: programExerciseRepo,
        },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<ProgramsService>(ProgramsService);
  });

  describe('update', () => {
    it('keeps made on sets the coach did not remove', async () => {
      const result = await service.update(
        'program-1',
        {
          exercises: [
            {
              id: 'set-1',
              exerciseId: 'squat',
              reps: 5,
              weight: 105,
              order: 1,
            },
            {
              id: 'set-2',
              exerciseId: 'squat',
              reps: 3,
              weight: 110,
              order: 2,
            },
          ],
        },
        'coach-1',
      );

      expect(result.exercises.map((e) => [e.id, e.made])).toEqual([
        ['set-1', true],
        ['set-2', false],
      ]);
      expect(result.exercises[0].weight).toBe(105);
      expect(result.exercises[1].reps).toBe(3);
      expect(programExerciseRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes removed sets and creates new ones with no result', async () => {
      const result = await service.update(
        'program-1',
        {
          exercises: [
            { id: 'set-2', exerciseId: 'squat', reps: 3, order: 1 },
            { exerciseId: 'bench', reps: 8, order: 2 },
          ],
        },
        'coach-1',
      );

      expect(programExerciseRepo.delete).toHaveBeenCalledWith(['set-1']);
      expect(result.exercises).toHaveLength(2);
      expect(result.exercises[0]).toMatchObject({ id: 'set-2', made: false });
      expect(result.exercises[1]).toMatchObject({
        programId: 'program-1',
        exerciseId: 'bench',
        reps: 8,
      });
      expect(result.exercises[1].made ?? null).toBeNull();
    });

    it('clears weight and notes the coach emptied on a kept set', async () => {
      const result = await service.update(
        'program-1',
        {
          exercises: [
            { id: 'set-1', exerciseId: 'squat', reps: 5, order: 1 },
            { id: 'set-2', exerciseId: 'squat', reps: 3, order: 2 },
          ],
        },
        'coach-1',
      );

      expect(result.exercises[0].weight).toBeNull();
      expect(result.exercises[0].notes).toBeNull();
    });

    it('treats an id from another program as a new set', async () => {
      const result = await service.update(
        'program-1',
        {
          exercises: [
            { id: 'set-1', exerciseId: 'squat', reps: 5, order: 1 },
            { id: 'set-2', exerciseId: 'squat', reps: 3, order: 2 },
            { id: 'foreign-set', exerciseId: 'squat', reps: 1, order: 3 },
          ],
        },
        'coach-1',
      );

      expect(result.exercises[2].id).toBeUndefined();
      expect(result.exercises[2].programId).toBe('program-1');
    });

    it('rejects an exerciseId not visible to the coach', async () => {
      exerciseRepo.count.mockResolvedValue(0);
      await expect(
        service.update(
          'program-1',
          {
            exercises: [
              { id: 'set-1', exerciseId: 'other-coach-ex', reps: 5, order: 1 },
            ],
          },
          'coach-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
    });

    it('saves supersetGroup on kept and new sets', async () => {
      const result = await service.update(
        'program-1',
        {
          exercises: [
            {
              id: 'set-1',
              exerciseId: 'squat',
              reps: 5,
              order: 1,
              supersetGroup: 'group-1',
            },
            {
              exerciseId: 'bench',
              reps: 8,
              order: 2,
              supersetGroup: 'group-1',
            },
          ],
        },
        'coach-1',
      );

      expect(result.exercises.every((e) => e.supersetGroup === 'group-1')).toBe(
        true,
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      userRepo.findOne.mockResolvedValue({
        id: 'client-1',
        coachId: 'coach-1',
      });
      programRepo.save.mockImplementation((p: Program) => Promise.resolve(p));
    });

    it('rejects an exerciseId not visible to the coach', async () => {
      exerciseRepo.count.mockResolvedValue(0);
      await expect(
        service.create(
          {
            clientId: 'client-1',
            name: 'New program',
            scheduledDate: '2026-01-01',
            exercises: [{ exerciseId: 'other-coach-ex', reps: 5, order: 1 }],
          },
          'coach-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows a global or own exerciseId', async () => {
      await expect(
        service.create(
          {
            clientId: 'client-1',
            name: 'New program',
            scheduledDate: '2026-01-01',
            exercises: [{ exerciseId: 'squat', reps: 5, order: 1 }],
          },
          'coach-1',
        ),
      ).resolves.toBeDefined();
    });

    it('still rejects a client not assigned to the coach', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(
          {
            clientId: 'client-1',
            name: 'New program',
            scheduledDate: '2026-01-01',
            exercises: [{ exerciseId: 'squat', reps: 5, order: 1 }],
          },
          'coach-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('addExerciseSet', () => {
    const dto = { exerciseId: 'coach-ex', reps: 5, weight: 100 };

    it("rejects another coach's private exercise with 400", async () => {
      exerciseRepo.count.mockResolvedValue(0);
      await expect(
        service.addExerciseSet(
          'program-1',
          { ...dto, exerciseId: 'other-coach-ex' },
          'client-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
    });

    it("allows a global or the program coach's exercise", async () => {
      const result = await service.addExerciseSet('program-1', dto, 'client-1');
      expect(result).toMatchObject({
        programId: 'program-1',
        exerciseId: 'coach-ex',
        order: 3,
      });
    });

    it("checks visibility as global + the program's coach", async () => {
      await service.addExerciseSet('program-1', dto, 'client-1');
      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', clientId: 'client-1' },
        }),
      );
      expect(exerciseRepo.count).toHaveBeenCalledWith({
        where: visibleExerciseWhere('coach-1', { id: 'coach-ex' }),
      });
    });
  });
});
