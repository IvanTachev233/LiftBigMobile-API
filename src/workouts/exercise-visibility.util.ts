import {
  FindOperator,
  FindOptionsWhere,
  IsNull,
  Raw,
  Repository,
} from 'typeorm';
import { Exercise } from './entities/exercise.entity';

// An exercise is visible if it is global (createdById null) or owned by the
// caller's coach: the caller themself for a COACH, their coach for a CLIENT.
// A client with no coach sees global exercises only.
export function ownerIdForVisibility(user: {
  role: string;
  id: string;
  coachId: string | null;
}): string | null {
  return user.role === 'COACH' ? user.id : user.coachId;
}

export function visibleExerciseWhere(
  ownerId: string | null,
  extra: Partial<FindOptionsWhere<Exercise>> = {},
): FindOptionsWhere<Exercise>[] {
  const clauses: FindOptionsWhere<Exercise>[] = [
    { ...extra, createdById: IsNull() },
  ];
  if (ownerId) {
    clauses.push({ ...extra, createdById: ownerId });
  }
  return clauses;
}

// Exact, case-insensitive name match; the name is a bound parameter, so
// `%` and `_` are literal characters
export const EXERCISE_NAME_PARAM = 'exerciseName';

export function nameEqualsIgnoringCase(name: string): FindOperator<string> {
  // Raw() is typed FindOperator<any>; the column it compares is a string.
  return Raw((alias) => `LOWER(${alias}) = LOWER(:${EXERCISE_NAME_PARAM})`, {
    [EXERCISE_NAME_PARAM]: name,
  }) as FindOperator<string>;
}

export async function isExerciseVisible(
  exerciseRepo: Repository<Exercise>,
  exerciseId: string,
  ownerId: string | null,
): Promise<boolean> {
  const count = await exerciseRepo.count({
    where: visibleExerciseWhere(ownerId, { id: exerciseId }),
  });
  return count > 0;
}
