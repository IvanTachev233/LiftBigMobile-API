import { EntityManager, Not } from 'typeorm';
import { Workout, WorkoutStatus } from '../workouts/entities/workout.entity';
import {
  ProgramEnrollment,
  ProgramEnrollmentStatus,
} from './entities/program-enrollment.entity';

// Marks an ACTIVE enrollment COMPLETED once all of its workouts are. The
// enrollment row is locked so two last completions can't miss each other.
export async function completeEnrollmentIfDone(
  manager: EntityManager,
  enrollmentId: string,
): Promise<void> {
  const enrollment = await manager.findOne(ProgramEnrollment, {
    where: { id: enrollmentId },
    lock: { mode: 'pessimistic_write' },
  });
  if (enrollment?.status !== ProgramEnrollmentStatus.ACTIVE) return;
  const open = await manager.count(Workout, {
    where: {
      programEnrollmentId: enrollmentId,
      status: Not(WorkoutStatus.COMPLETED),
    },
  });
  if (open === 0) {
    await manager.update(
      ProgramEnrollment,
      { id: enrollmentId },
      { status: ProgramEnrollmentStatus.COMPLETED },
    );
  }
}
