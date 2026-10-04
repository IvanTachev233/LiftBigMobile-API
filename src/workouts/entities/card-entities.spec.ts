import { DataSource, EntityMetadata } from 'typeorm';
import { Workout } from './workout.entity';
import { WorkoutExercise } from './workout-exercise.entity';
import { WorkoutSet } from './workout-set.entity';
import { Exercise } from './exercise.entity';
import { Program } from '../../programs/entities/program.entity';
import { ProgramExercise } from '../../programs/entities/program-exercise.entity';
import { ProgramSet } from '../../programs/entities/program-set.entity';
import { User } from '../../auth/user.entity';

// Builds entity metadata without connecting to a database, so the FK /
// column shape of the card entities can be asserted directly.
async function buildMetadata(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [
      Workout,
      WorkoutExercise,
      WorkoutSet,
      Exercise,
      Program,
      ProgramExercise,
      ProgramSet,
      User,
    ],
  });
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
}

function findForeignKeyTo(
  metadata: EntityMetadata,
  columnName: string,
): { onDelete?: string | null } | undefined {
  return metadata.foreignKeys.find((fk) => fk.columnNames.includes(columnName));
}

describe('card entity metadata', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await buildMetadata();
  });

  it('gives workout_exercise and workout_set their table names', () => {
    expect(dataSource.getMetadata(WorkoutExercise).tableName).toBe(
      'workout_exercise',
    );
    expect(dataSource.getMetadata(WorkoutSet).tableName).toBe('workout_set');
  });

  it('gives program_exercise and program_set their table names', () => {
    expect(dataSource.getMetadata(ProgramExercise).tableName).toBe(
      'program_exercise',
    );
    expect(dataSource.getMetadata(ProgramSet).tableName).toBe('program_set');
  });

  it('cascades workout -> workout_exercise -> workout_set on delete', () => {
    const workoutExerciseMeta = dataSource.getMetadata(WorkoutExercise);
    const workoutFk = findForeignKeyTo(workoutExerciseMeta, 'workoutId');
    expect(workoutFk?.onDelete).toBe('CASCADE');

    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const workoutExerciseFk = findForeignKeyTo(
      workoutSetMeta,
      'workoutExerciseId',
    );
    expect(workoutExerciseFk?.onDelete).toBe('CASCADE');
  });

  it('cascades program -> program_exercise -> program_set on delete', () => {
    const programExerciseMeta = dataSource.getMetadata(ProgramExercise);
    const programFk = findForeignKeyTo(programExerciseMeta, 'programId');
    expect(programFk?.onDelete).toBe('CASCADE');

    const programSetMeta = dataSource.getMetadata(ProgramSet);
    const programExerciseFk = findForeignKeyTo(
      programSetMeta,
      'programExerciseId',
    );
    expect(programExerciseFk?.onDelete).toBe('CASCADE');
  });

  it('requires workoutExerciseId and programExerciseId (NOT NULL)', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const workoutExerciseIdCol = workoutSetMeta.columns.find(
      (c) => c.propertyName === 'workoutExerciseId',
    );
    expect(workoutExerciseIdCol?.isNullable).toBe(false);

    const programSetMeta = dataSource.getMetadata(ProgramSet);
    const programExerciseIdCol = programSetMeta.columns.find(
      (c) => c.propertyName === 'programExerciseId',
    );
    expect(programExerciseIdCol?.isNullable).toBe(false);
  });

  it('makes supersetGroup a nullable uuid column on both card entities', () => {
    const workoutExerciseMeta = dataSource.getMetadata(WorkoutExercise);
    const workoutCardSupersetGroup = workoutExerciseMeta.columns.find(
      (c) => c.propertyName === 'supersetGroup',
    );
    expect(workoutCardSupersetGroup?.isNullable).toBe(true);
    expect(workoutCardSupersetGroup?.type).toBe('uuid');

    const programExerciseMeta = dataSource.getMetadata(ProgramExercise);
    const programCardSupersetGroup = programExerciseMeta.columns.find(
      (c) => c.propertyName === 'supersetGroup',
    );
    expect(programCardSupersetGroup?.isNullable).toBe(true);
    expect(programCardSupersetGroup?.type).toBe('uuid');
  });

  it('drops exerciseId, supersetGroup and workoutId from workout_set', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const propertyNames = workoutSetMeta.columns.map((c) => c.propertyName);
    expect(propertyNames).not.toContain('exerciseId');
    expect(propertyNames).not.toContain('supersetGroup');
    expect(propertyNames).not.toContain('workoutId');
  });

  it('drops programId, exerciseId and supersetGroup from program_set', () => {
    const programSetMeta = dataSource.getMetadata(ProgramSet);
    const propertyNames = programSetMeta.columns.map((c) => c.propertyName);
    expect(propertyNames).not.toContain('programId');
    expect(propertyNames).not.toContain('exerciseId');
    expect(propertyNames).not.toContain('supersetGroup');
  });

  it('holds workout cards on Workout.exercises and program cards on Program.exercises', () => {
    const workoutMeta = dataSource.getMetadata(Workout);
    const exercisesRelation = workoutMeta.relations.find(
      (r) => r.propertyName === 'exercises',
    );
    expect(exercisesRelation?.inverseEntityMetadata.target).toBe(
      WorkoutExercise,
    );

    const programMeta = dataSource.getMetadata(Program);
    const programExercisesRelation = programMeta.relations.find(
      (r) => r.propertyName === 'exercises',
    );
    expect(programExercisesRelation?.inverseEntityMetadata.target).toBe(
      ProgramExercise,
    );
  });
});
