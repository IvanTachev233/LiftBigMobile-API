import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProgramsService } from './programs.service';
import { Program } from './entities/program.entity';
import { ProgramExercise } from './entities/program-exercise.entity';
import { User } from '../auth/user.entity';

describe('ProgramsService', () => {
  let service: ProgramsService;
  let program: Program;
  const programRepo = {
    findOne: jest.fn(),
    save: jest.fn((p: Program) => Promise.resolve(p)),
  };
  const programExerciseRepo = {
    create: jest.fn((data: Partial<ProgramExercise>) => ({ ...data })),
    save: jest.fn((rows: ProgramExercise[]) => Promise.resolve(rows)),
    delete: jest.fn(() => Promise.resolve({ affected: 1 })),
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
        { provide: getRepositoryToken(User), useValue: {} },
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
  });
});
