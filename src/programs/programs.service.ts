import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Program } from './entities/program.entity';
import { ProgramExercise } from './entities/program-exercise.entity';
import { User } from '../auth/user.entity';
import {
  CreateProgramDto,
  UpdateProgramDto,
  PatchProgramExerciseDto,
  AddExerciseSetDto,
} from './dto/program.dto';

@Injectable()
export class ProgramsService {
  constructor(
    @InjectRepository(Program)
    private programRepo: Repository<Program>,
    @InjectRepository(ProgramExercise)
    private programExerciseRepo: Repository<ProgramExercise>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async create(dto: CreateProgramDto, coachId: string): Promise<Program> {
    const client = await this.userRepo.findOne({
      where: { id: dto.clientId, coachId },
    });

    if (!client) {
      throw new ForbiddenException(
        'Client not found or not assigned to you',
      );
    }

    const program = this.programRepo.create({
      clientId: dto.clientId,
      coachId,
      name: dto.name,
      scheduledDate: new Date(dto.scheduledDate),
      exercises: dto.exercises.map((e) =>
        this.programExerciseRepo.create({
          exerciseId: e.exerciseId,
          reps: e.reps,
          weight: e.weight,
          notes: e.notes,
          order: e.order,
        }),
      ),
    });

    return this.programRepo.save(program);
  }

  async findByClient(
    clientId: string,
    coachId: string,
  ): Promise<Program[]> {
    return this.programRepo.find({
      where: { clientId, coachId },
      relations: ['exercises', 'exercises.exercise'],
      order: { scheduledDate: 'DESC' },
    });
  }

  async findUpcoming(clientId: string): Promise<Program[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.programRepo.find({
      where: {
        clientId,
        scheduledDate: MoreThanOrEqual(today),
      },
      relations: ['exercises', 'exercises.exercise'],
      order: { scheduledDate: 'ASC' },
    });
  }

  async findOne(
    id: string,
    userId: string,
    role: string,
  ): Promise<Program> {
    const where =
      role === 'COACH' ? { id, coachId: userId } : { id, clientId: userId };

    const program = await this.programRepo.findOne({
      where,
      relations: ['exercises', 'exercises.exercise', 'client', 'coach'],
    });

    if (!program) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }

    return program;
  }

  async update(
    id: string,
    dto: UpdateProgramDto,
    coachId: string,
  ): Promise<Program> {
    const program = await this.programRepo.findOne({
      where: { id, coachId },
      relations: ['exercises'],
    });

    if (!program) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }

    if (dto.name !== undefined) program.name = dto.name;
    if (dto.scheduledDate !== undefined)
      program.scheduledDate = new Date(dto.scheduledDate);

    if (dto.exercises !== undefined) {
      await this.programExerciseRepo.delete({ programId: id });

      program.exercises = dto.exercises.map((e) =>
        this.programExerciseRepo.create({
          programId: id,
          exerciseId: e.exerciseId,
          reps: e.reps,
          weight: e.weight,
          notes: e.notes,
          order: e.order,
        }),
      );

      await this.programExerciseRepo.save(program.exercises);
    }

    return this.programRepo.save(program);
  }

  async patchExercise(
    programId: string,
    exerciseId: string,
    dto: PatchProgramExerciseDto,
    clientId: string,
  ): Promise<ProgramExercise> {
    const program = await this.programRepo.findOne({
      where: { id: programId, clientId },
    });

    if (!program) {
      throw new NotFoundException('Program not found or not assigned to you');
    }

    const programExercise = await this.programExerciseRepo.findOne({
      where: { id: exerciseId, programId },
    });

    if (!programExercise) {
      throw new NotFoundException('Program exercise not found');
    }

    if (dto.reps !== undefined) programExercise.reps = dto.reps;
    if (dto.weight !== undefined) programExercise.weight = dto.weight;
    if (dto.notes !== undefined) programExercise.notes = dto.notes;
    if (dto.made !== undefined) programExercise.made = dto.made;

    return this.programExerciseRepo.save(programExercise);
  }

  async addExerciseSet(
    programId: string,
    dto: AddExerciseSetDto,
    clientId: string,
  ): Promise<ProgramExercise> {
    const program = await this.programRepo.findOne({
      where: { id: programId, clientId },
      relations: ['exercises'],
    });

    if (!program) {
      throw new NotFoundException('Program not found or not assigned to you');
    }

    const maxOrder = program.exercises.reduce(
      (max, e) => Math.max(max, e.order),
      0,
    );

    const newExercise = this.programExerciseRepo.create({
      programId,
      exerciseId: dto.exerciseId,
      reps: dto.reps,
      weight: dto.weight,
      notes: dto.notes,
      made: dto.made ?? null,
      order: maxOrder + 1,
    });

    return this.programExerciseRepo.save(newExercise);
  }

  async remove(id: string, coachId: string): Promise<void> {
    const result = await this.programRepo.delete({ id, coachId });
    if (result.affected === 0) {
      throw new NotFoundException(`Program with ID "${id}" not found`);
    }
  }
}
