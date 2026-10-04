import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProgramsService } from './programs.service';
import { Program } from './entities/program.entity';
import { ProgramExercise } from './entities/program-exercise.entity';
import { ProgramSet } from './entities/program-set.entity';
import { Exercise } from '../workouts/entities/exercise.entity';
import { User } from '../auth/user.entity';
import { visibleExerciseWhere } from '../workouts/exercise-visibility.util';
import { UpdateProgramExerciseDto } from './dto/program.dto';

type SavedCard = Partial<ProgramExercise>;
type SavedSet = Partial<ProgramSet>;

const CARD_SET_ORDER = {
  exercises: { order: 'ASC', sets: { order: 'ASC' } },
};

describe('ProgramsService', () => {
  let service: ProgramsService;
  let program: Program;
  let newIds: number;
  // Whether each write ran inside the transaction callback
  let inTransaction = false;
  const writes: { name: string; inTransaction: boolean }[] = [];
  const track =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      writes.push({ name, inTransaction });
      return fn(...args);
    };
  const programRepo = {
    findOne: jest.fn(),
    find: jest.fn(() => Promise.resolve([])),
    save: jest.fn(track('program.save', (p: Program) => Promise.resolve(p))),
    create: jest.fn((data: Partial<Program>) => ({ ...data }) as Program),
    manager: {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<unknown>) => {
        inTransaction = true;
        try {
          return await cb(manager);
        } finally {
          inTransaction = false;
        }
      }),
    },
  };
  // Like TypeORM, save() writes generated ids onto the rows it was given
  const withIds = <T extends { id?: string }>(rows: T[]) => {
    for (const r of rows) r.id ??= `new-${++newIds}`;
    return rows;
  };
  const programExerciseRepo = {
    create: jest.fn((data: SavedCard) => ({ ...data })),
    save: jest.fn(
      track('card.save', (rows: SavedCard[]) => Promise.resolve(withIds(rows))),
    ),
    delete: jest.fn(
      track('card.delete', () => Promise.resolve({ affected: 1 })),
    ),
    findOne: jest.fn(),
    count: jest.fn(() => Promise.resolve(0)),
  };
  const programSetRepo = {
    create: jest.fn((data: SavedSet) => ({ ...data })),
    save: jest.fn(
      track('set.save', (rows: SavedSet | SavedSet[]) =>
        Promise.resolve(Array.isArray(rows) ? withIds(rows) : rows),
      ),
    ),
    delete: jest.fn(
      track('set.delete', () => Promise.resolve({ affected: 1 })),
    ),
    findOne: jest.fn(),
    count: jest.fn(() => Promise.resolve(0)),
  };
  // Every exercise is visible by default; tests for the 400 path override it
  const exerciseRepo = {
    count: jest.fn(() => Promise.resolve(1)),
  };
  const userRepo = {
    findOne: jest.fn(),
  };
  const manager = {
    getRepository: jest.fn((entity: unknown): unknown => {
      if (entity === Program) return programRepo;
      if (entity === ProgramExercise) return programExerciseRepo;
      if (entity === ProgramSet) return programSetRepo;
      throw new Error('unexpected repository');
    }),
  };

  const set = (id: string, made: boolean | null, order: number) =>
    ({
      id,
      reps: 5,
      weight: 100,
      notes: 'belt',
      order,
      made,
    }) as ProgramSet;

  const savedCards = (): SavedCard[] =>
    programExerciseRepo.save.mock.calls.flatMap((c) => c[0]);
  const savedSets = (): SavedSet[] =>
    programSetRepo.save.mock.calls.flatMap((c) => c[0] as SavedSet[]);
  const savedSet = (id: string) => savedSets().find((s) => s.id === id);

  // The coach editor sends back the program as it loaded it
  const unchangedCards = (): UpdateProgramExerciseDto[] => [
    {
      id: 'card-1',
      exerciseId: 'squat',
      order: 1,
      sets: [
        { id: 'set-1', reps: 5, weight: 100, notes: 'belt', order: 1 },
        { id: 'set-2', reps: 5, weight: 100, notes: 'belt', order: 2 },
      ],
    },
    {
      id: 'card-2',
      exerciseId: 'bench',
      order: 2,
      sets: [{ id: 'set-3', reps: 5, weight: 100, order: 1 }],
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    newIds = 0;
    writes.length = 0;
    inTransaction = false;
    exerciseRepo.count.mockResolvedValue(1);
    programExerciseRepo.count.mockResolvedValue(0);
    programSetRepo.count.mockResolvedValue(0);
    program = {
      id: 'program-1',
      coachId: 'coach-1',
      clientId: 'client-1',
      exercises: [
        {
          id: 'card-1',
          programId: 'program-1',
          exerciseId: 'squat',
          order: 1,
          supersetGroup: null,
          sets: [set('set-1', true, 1), set('set-2', false, 2)],
        },
        {
          id: 'card-2',
          programId: 'program-1',
          exerciseId: 'bench',
          order: 2,
          supersetGroup: null,
          sets: [set('set-3', null, 1)],
        },
      ],
    } as unknown as Program;
    programRepo.findOne.mockResolvedValue(program);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgramsService,
        { provide: getRepositoryToken(Program), useValue: programRepo },
        {
          provide: getRepositoryToken(ProgramExercise),
          useValue: programExerciseRepo,
        },
        {
          provide: getRepositoryToken(ProgramSet),
          useValue: programSetRepo,
        },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<ProgramsService>(ProgramsService);
  });

  describe('reads', () => {
    it('findOne loads cards sorted by order, then sets by order', async () => {
      await service.findOne('program-1', 'client-1', 'CLIENT');
      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', clientId: 'client-1' },
          relations: expect.arrayContaining([
            'exercises',
            'exercises.exercise',
            'exercises.sets',
          ]) as unknown,
          order: CARD_SET_ORDER,
        }),
      );
    });

    it('findOne scopes a coach to their own programs', async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(
        service.findOne('program-1', 'coach-2', 'COACH'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', coachId: 'coach-2' },
        }),
      );
    });

    it('findByClient and findUpcoming sort cards and sets', async () => {
      await service.findByClient('client-1', 'coach-1');
      await service.findUpcoming('client-1');
      expect(programRepo.find).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { clientId: 'client-1', coachId: 'coach-1' },
          order: { scheduledDate: 'DESC', ...CARD_SET_ORDER },
        }),
      );
      expect(programRepo.find).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          order: { scheduledDate: 'ASC', ...CARD_SET_ORDER },
        }),
      );
    });
  });

  describe('update', () => {
    it('keeps made on unchanged sets and updates their values in place', async () => {
      const cards = unchangedCards();
      cards[0].sets[0].weight = 105;
      cards[0].sets[1].reps = 3;

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedCards().map((c) => c.id)).toEqual(['card-1', 'card-2']);
      expect(savedSet('set-1')).toMatchObject({
        programExerciseId: 'card-1',
        weight: 105,
        made: true,
      });
      expect(savedSet('set-2')).toMatchObject({ reps: 3, made: false });
      expect(savedSet('set-3')).toMatchObject({ made: null });
      expect(programExerciseRepo.delete).not.toHaveBeenCalled();
      expect(programSetRepo.delete).not.toHaveBeenCalled();
    });

    it('keeps made on the sets of a card whose exercise changed', async () => {
      const cards = unchangedCards();
      cards[0].exerciseId = 'deadlift';

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedCards()[0]).toMatchObject({
        id: 'card-1',
        exerciseId: 'deadlift',
      });
      expect(savedSet('set-1')).toMatchObject({
        programExerciseId: 'card-1',
        made: true,
      });
      expect(savedSet('set-2')).toMatchObject({ made: false });
    });

    it('keeps made on a set moved to another card of the same program', async () => {
      const cards = unchangedCards();
      const moved = cards[0].sets.pop()!;
      cards[1].sets.push({ ...moved, order: 2 });

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedSet('set-2')).toMatchObject({
        programExerciseId: 'card-2',
        order: 2,
        made: false,
      });
      expect(programSetRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes removed cards and sets and creates new ones with no result', async () => {
      const cards = unchangedCards();
      cards[0].sets = [cards[0].sets[0]];
      cards[1] = {
        exerciseId: 'row',
        order: 2,
        sets: [{ reps: 8, order: 1 }],
      };

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(programSetRepo.delete).toHaveBeenCalledWith(['set-2', 'set-3']);
      expect(programExerciseRepo.delete).toHaveBeenCalledWith(['card-2']);
      const newCard = savedCards()[1];
      expect(newCard).toMatchObject({
        id: 'new-1',
        programId: 'program-1',
        exerciseId: 'row',
        order: 2,
      });
      const newSet = savedSets().find((s) => s.programExerciseId === 'new-1');
      expect(newSet).toMatchObject({ reps: 8, order: 1, made: null });
    });

    it('saves sets after cards and deletes removed rows after that', async () => {
      const cards = unchangedCards();
      cards.pop();

      await service.update('program-1', { exercises: cards }, 'coach-1');

      const cardSave = programExerciseRepo.save.mock.invocationCallOrder[0];
      const setSave = programSetRepo.save.mock.invocationCallOrder[0];
      const cardDelete = programExerciseRepo.delete.mock.invocationCallOrder[0];
      expect(cardSave).toBeLessThan(setSave);
      expect(setSave).toBeLessThan(cardDelete);
    });

    it('runs every write of the update inside one transaction', async () => {
      const cards = unchangedCards();
      cards.pop();

      await service.update(
        'program-1',
        { name: 'Renamed', exercises: cards },
        'coach-1',
      );

      expect(programRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(writes.map((w) => w.name)).toEqual([
        'card.save',
        'set.save',
        'set.delete',
        'card.delete',
        'program.save',
      ]);
      expect(writes.every((w) => w.inTransaction)).toBe(true);
    });

    it('rejects and stops writing when a write fails inside the transaction', async () => {
      programSetRepo.save.mockRejectedValueOnce(new Error('db down'));
      const cards = unchangedCards();
      cards.pop();

      await expect(
        service.update(
          'program-1',
          { name: 'Renamed', exercises: cards },
          'coach-1',
        ),
      ).rejects.toThrow('db down');

      expect(programRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(programSetRepo.delete).not.toHaveBeenCalled();
      expect(programExerciseRepo.delete).not.toHaveBeenCalled();
      expect(programRepo.save).not.toHaveBeenCalled();
    });

    it('checks ids and visibility before opening the transaction', async () => {
      programSetRepo.count.mockResolvedValue(1);
      const cards = unchangedCards();
      cards[0].sets[0].id = 'foreign-set';

      await expect(
        service.update('program-1', { exercises: cards }, 'coach-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programRepo.manager.transaction).not.toHaveBeenCalled();

      programSetRepo.count.mockResolvedValue(0);
      exerciseRepo.count.mockResolvedValue(0);
      await expect(
        service.update('program-1', { exercises: unchangedCards() }, 'coach-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('does not cascade sets through the card save', async () => {
      await service.update(
        'program-1',
        { exercises: unchangedCards() },
        'coach-1',
      );
      expect(savedCards().every((c) => c.sets === undefined)).toBe(true);
    });

    it('clears weight and notes the coach emptied on a kept set', async () => {
      const cards = unchangedCards();
      cards[0].sets[0] = { id: 'set-1', reps: 5, order: 1 };

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedSet('set-1')).toMatchObject({ weight: null, notes: null });
    });

    it('round-trips 2 cards with the same exercise as separate cards', async () => {
      const cards = unchangedCards();
      cards[1] = {
        exerciseId: 'squat',
        order: 2,
        sets: [{ reps: 3, order: 1 }],
      };

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedCards().map((c) => [c.id, c.exerciseId, c.order])).toEqual([
        ['card-1', 'squat', 1],
        ['new-1', 'squat', 2],
      ]);
      expect(savedSets().map((s) => [s.programExerciseId, s.order])).toEqual([
        ['card-1', 1],
        ['card-1', 2],
        ['new-1', 1],
      ]);
    });

    it('rejects a set id that belongs to another program and moves nothing', async () => {
      programSetRepo.count.mockResolvedValue(1);
      const cards = unchangedCards();
      cards[1].sets.push({
        id: '0b9a37f2-6c55-4f1e-9a3c-8e4a3b4f3b11',
        reps: 1,
        order: 2,
      });

      await expect(
        service.update('program-1', { exercises: cards }, 'coach-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programSetRepo.save).not.toHaveBeenCalled();
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
      expect(programSetRepo.delete).not.toHaveBeenCalled();
    });

    it('rejects a card id that belongs to another program and moves nothing', async () => {
      programExerciseRepo.count.mockResolvedValue(1);
      const cards = unchangedCards();
      cards.push({
        id: 'foreign-card',
        exerciseId: 'squat',
        order: 3,
        sets: [],
      });

      await expect(
        service.update('program-1', { exercises: cards }, 'coach-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
    });

    it('creates rows for ids that exist nowhere', async () => {
      const cards = unchangedCards();
      cards.push({
        id: 'unknown-card',
        exerciseId: 'squat',
        order: 3,
        sets: [{ id: 'unknown-set', reps: 1, order: 1 }],
      });

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedCards()[2]).toMatchObject({
        id: 'new-1',
        programId: 'program-1',
      });
      const newSet = savedSets().find((s) => s.programExerciseId === 'new-1');
      expect(newSet).toMatchObject({ reps: 1, made: null });
      expect(newSet?.id).not.toBe('unknown-set');
    });

    it("rejects another coach's private exercise and saves nothing", async () => {
      exerciseRepo.count.mockResolvedValue(0);
      const cards = unchangedCards();
      cards[0].exerciseId = 'other-coach-ex';

      await expect(
        service.update('program-1', { exercises: cards }, 'coach-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });

    it('saves supersetGroup on kept and new cards', async () => {
      const cards = unchangedCards();
      cards[0].supersetGroup = 'group-1';
      cards[1] = {
        exerciseId: 'row',
        order: 2,
        supersetGroup: 'group-1',
        sets: [{ reps: 8, order: 1 }],
      };

      await service.update('program-1', { exercises: cards }, 'coach-1');

      expect(savedCards().map((c) => c.supersetGroup)).toEqual([
        'group-1',
        'group-1',
      ]);
    });

    it('updates name and date alone without touching the cards', async () => {
      await service.update(
        'program-1',
        { name: 'Renamed', scheduledDate: '2026-02-01' },
        'coach-1',
      );

      expect(programRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed' }),
      );
      expect(programExerciseRepo.save).not.toHaveBeenCalled();
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });

    it("404s on another coach's program", async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(
        service.update('program-1', { exercises: unchangedCards() }, 'coach-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', coachId: 'coach-2' },
        }),
      );
    });
  });

  describe('create', () => {
    const base = {
      clientId: 'client-1',
      name: 'New program',
      scheduledDate: '2026-01-01',
    };

    beforeEach(() => {
      userRepo.findOne.mockResolvedValue({
        id: 'client-1',
        coachId: 'coach-1',
      });
      programRepo.save.mockImplementation((p: Program) =>
        Promise.resolve({ ...p, id: 'program-1' }),
      );
    });

    it("rejects another coach's private exercise", async () => {
      exerciseRepo.count.mockResolvedValue(0);
      await expect(
        service.create(
          {
            ...base,
            exercises: [
              {
                exerciseId: 'other-coach-ex',
                order: 1,
                sets: [{ reps: 5, order: 1 }],
              },
            ],
          },
          'coach-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(programRepo.save).not.toHaveBeenCalled();
    });

    it('checks visibility as global + the coach', async () => {
      await service.create(
        {
          ...base,
          exercises: [
            { exerciseId: 'squat', order: 1, sets: [{ reps: 5, order: 1 }] },
          ],
        },
        'coach-1',
      );
      expect(exerciseRepo.count).toHaveBeenCalledWith({
        where: visibleExerciseWhere('coach-1', { id: 'squat' }),
      });
    });

    it('stores 2 cards with the same exercise separately, with their sets', async () => {
      await service.create(
        {
          ...base,
          exercises: [
            {
              exerciseId: 'squat',
              order: 1,
              supersetGroup: 'group-1',
              sets: [
                { reps: 5, weight: 100, order: 1 },
                { reps: 3, order: 2 },
              ],
            },
            {
              exerciseId: 'squat',
              order: 2,
              supersetGroup: 'group-1',
              sets: [{ reps: 8, notes: 'pause', order: 1 }],
            },
          ],
        },
        'coach-1',
      );

      const created = programRepo.save.mock.calls[0][0];
      expect(created).toMatchObject({
        clientId: 'client-1',
        coachId: 'coach-1',
        exercises: [
          {
            exerciseId: 'squat',
            order: 1,
            supersetGroup: 'group-1',
            sets: [
              { reps: 5, weight: 100, notes: null, order: 1, made: null },
              { reps: 3, weight: null, order: 2 },
            ],
          },
          {
            exerciseId: 'squat',
            order: 2,
            supersetGroup: 'group-1',
            sets: [{ reps: 8, notes: 'pause', order: 1 }],
          },
        ],
      });
      // Responds with the reloaded, sorted program
      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', coachId: 'coach-1' },
          order: CARD_SET_ORDER,
        }),
      );
    });

    it('still rejects a client not assigned to the coach', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(
        service.create(
          {
            ...base,
            exercises: [
              { exerciseId: 'squat', order: 1, sets: [{ reps: 5, order: 1 }] },
            ],
          },
          'coach-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('addSet', () => {
    const dto = { reps: 5, weight: 100, made: true };

    beforeEach(() => {
      programExerciseRepo.findOne.mockResolvedValue(program.exercises[0]);
    });

    it("adds a set after the card's last set on the client's own program", async () => {
      const result = await service.addSet(
        'program-1',
        'card-1',
        dto,
        'client-1',
      );

      expect(programRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'program-1', clientId: 'client-1' },
        }),
      );
      expect(programExerciseRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'card-1', programId: 'program-1' },
        }),
      );
      expect(result).toMatchObject({
        programExerciseId: 'card-1',
        reps: 5,
        weight: 100,
        notes: null,
        order: 3,
        made: true,
      });
    });

    it("404s on another client's program and saves nothing", async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addSet('program-1', 'card-1', dto, 'client-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });

    it('404s on a card that is not in the program', async () => {
      programExerciseRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addSet('program-1', 'card-x', dto, 'client-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateSet', () => {
    beforeEach(() => {
      programSetRepo.findOne.mockResolvedValue(set('set-1', null, 1));
    });

    it("marks a result on a set of the client's own program", async () => {
      const result = await service.updateSet(
        'program-1',
        'set-1',
        { made: false, reps: 4 },
        'client-1',
      );

      expect(programSetRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'set-1', programExercise: { programId: 'program-1' } },
        }),
      );
      expect(result).toMatchObject({
        id: 'set-1',
        made: false,
        reps: 4,
        weight: 100,
      });
    });

    it('clears weight and made when sent null', async () => {
      const result = await service.updateSet(
        'program-1',
        'set-1',
        { weight: null, made: null },
        'client-1',
      );
      expect(result).toMatchObject({ weight: null, made: null });
    });

    it("404s on another client's program", async () => {
      programRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSet('program-1', 'set-1', { made: true }, 'client-2'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });

    it('404s on a set that is not in the program', async () => {
      programSetRepo.findOne.mockResolvedValue(null);
      await expect(
        service.updateSet('program-1', 'set-x', { made: true }, 'client-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(programSetRepo.save).not.toHaveBeenCalled();
    });
  });
});
