import { EntityManager } from 'typeorm';
import { AuthSession } from '../auth/auth-session.entity';
import { Invite } from '../auth/invite.entity';
import { User } from '../auth/user.entity';
import { EmailCode } from '../email-codes/email-code.entity';
import { RepMaxEntry } from '../lifts/entities/rep-max-entry.entity';
import { UserBestLift } from '../lifts/entities/user-best-lift.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { WorkoutExercise } from '../workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../workouts/entities/workout-set.entity';
import { Workout } from '../workouts/entities/workout.entity';

// Matches no password: bcrypt hashes are 60 characters starting with $2
const UNUSABLE_PASSWORD_HASH = '!deleted';

export function deletedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * Removes an account inside the caller's transaction. A client's row goes
 * with everything they own. A coach's row stays, anonymised, because their
 * exercises and the workouts they assigned remain in clients' history; their
 * own data and invites go, their clients are unlinked, and the row can no
 * longer sign in. Every earlier token stops working either way.
 */
export async function removeAccount(
  manager: EntityManager,
  user: Pick<User, 'id' | 'email' | 'role' | 'tokenVersion'>,
): Promise<void> {
  await deleteOwnData(manager, user);

  if (user.role !== 'COACH') {
    await manager.delete(User, { id: user.id });
    return;
  }
  await manager.update(User, { coachId: user.id }, { coachId: null });
  await manager.update(User, user.id, {
    email: deletedEmail(user.id),
    name: null,
    passwordHash: UNUSABLE_PASSWORD_HASH,
    tokenVersion: user.tokenVersion + 1,
    failedPasswordAttempts: 0,
    passwordLockedUntil: null,
    emailVerifiedAt: null,
    coachId: null,
  });
}

// Lift records, own workouts (self-made, assigned or from a program) with
// their cards and sets, enrollments, email codes, sessions, and invites sent
// by or to the user. Children go before parents, so no cascade is relied on.
async function deleteOwnData(
  manager: EntityManager,
  user: Pick<User, 'id' | 'email'>,
): Promise<void> {
  const userId = user.id;
  await manager.delete(RepMaxEntry, { userId });
  await manager.delete(UserBestLift, { userId });

  const ownWorkouts = manager
    .createQueryBuilder()
    .subQuery()
    .select('workout.id')
    .from(Workout, 'workout')
    .where('workout.userId = :userId')
    .getQuery();
  const ownCards = manager
    .createQueryBuilder()
    .subQuery()
    .select('card.id')
    .from(WorkoutExercise, 'card')
    .where(`card.workoutId IN ${ownWorkouts}`)
    .getQuery();
  await manager
    .createQueryBuilder()
    .delete()
    .from(WorkoutSet)
    .where(`"workoutExerciseId" IN ${ownCards}`, { userId })
    .execute();
  await manager
    .createQueryBuilder()
    .delete()
    .from(WorkoutExercise)
    .where(`"workoutId" IN ${ownWorkouts}`, { userId })
    .execute();
  await manager.delete(Workout, { userId });

  await manager.delete(ProgramEnrollment, { userId });
  await manager.delete(EmailCode, { userId });
  await manager.delete(AuthSession, { userId });
  await manager.delete(Invite, { coachId: userId });
  await manager.delete(Invite, { clientEmail: user.email });
}
