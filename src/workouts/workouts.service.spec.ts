import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkoutsService } from './workouts.service';
import { Workout } from './entities/workout.entity';
import { Exercise } from './entities/exercise.entity';
import { WorkoutSet } from './entities/workout-set.entity';

describe('WorkoutsService', () => {
  let service: WorkoutsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutsService,
        { provide: getRepositoryToken(Workout), useValue: {} },
        { provide: getRepositoryToken(Exercise), useValue: {} },
        { provide: getRepositoryToken(WorkoutSet), useValue: {} },
      ],
    }).compile();

    service = module.get<WorkoutsService>(WorkoutsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
