import { DataSource, EntityMetadata } from 'typeorm';
import { Workout } from './workout.entity';
import { WorkoutExercise } from './workout-exercise.entity';
import { WorkoutSet } from './workout-set.entity';
import { Exercise } from './exercise.entity';
import { User } from '../../auth/user.entity';

// Builds entity metadata without connecting to a database, so the FK /
// column shape of the card entities can be asserted directly.
async function buildMetadata(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [Workout, WorkoutExercise, WorkoutSet, Exercise, User],
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

function column(metadata: EntityMetadata, propertyName: string) {
  return metadata.columns.find((c) => c.propertyName === propertyName);
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

  it('requires workoutExerciseId (NOT NULL)', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    expect(column(workoutSetMeta, 'workoutExerciseId')?.isNullable).toBe(false);
  });

  it('makes supersetGroup a nullable uuid column on the card entity', () => {
    const supersetGroup = column(
      dataSource.getMetadata(WorkoutExercise),
      'supersetGroup',
    );
    expect(supersetGroup?.isNullable).toBe(true);
    expect(supersetGroup?.type).toBe('uuid');
  });

  it('drops exerciseId, supersetGroup and workoutId from workout_set', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const propertyNames = workoutSetMeta.columns.map((c) => c.propertyName);
    expect(propertyNames).not.toContain('exerciseId');
    expect(propertyNames).not.toContain('supersetGroup');
    expect(propertyNames).not.toContain('workoutId');
  });

  it('holds workout cards on Workout.exercises', () => {
    const exercisesRelation = dataSource
      .getMetadata(Workout)
      .relations.find((r) => r.propertyName === 'exercises');
    expect(exercisesRelation?.inverseEntityMetadata.target).toBe(
      WorkoutExercise,
    );
  });

  it('adds a nullable uuid assignedById on workout, set to null when the coach is deleted', () => {
    const workoutMeta = dataSource.getMetadata(Workout);
    const assignedById = column(workoutMeta, 'assignedById');
    expect(assignedById?.isNullable).toBe(true);
    expect(assignedById?.type).toBe('uuid');

    const relation = workoutMeta.relations.find(
      (r) => r.propertyName === 'assignedBy',
    );
    expect(relation?.inverseEntityMetadata.target).toBe(User);
    expect(findForeignKeyTo(workoutMeta, 'assignedById')?.onDelete).toBe(
      'SET NULL',
    );
  });

  it('makes the planned weight nullable numeric(6,2)', () => {
    const weight = column(dataSource.getMetadata(WorkoutSet), 'weight');
    expect(weight?.isNullable).toBe(true);
    expect(weight?.type).toBe('decimal');
    expect(weight?.precision).toBe(6);
    expect(weight?.scale).toBe(2);
  });

  it('holds the logged values in nullable actualReps / actualWeight numeric(6,2)', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const actualReps = column(workoutSetMeta, 'actualReps');
    expect(actualReps?.isNullable).toBe(true);
    expect(actualReps?.type).toBe('integer');

    const actualWeight = column(workoutSetMeta, 'actualWeight');
    expect(actualWeight?.isNullable).toBe(true);
    expect(actualWeight?.type).toBe('decimal');
    expect(actualWeight?.precision).toBe(6);
    expect(actualWeight?.scale).toBe(2);
  });

  it('adds nullable made (boolean) and notes (varchar) to workout_set', () => {
    const workoutSetMeta = dataSource.getMetadata(WorkoutSet);
    const made = column(workoutSetMeta, 'made');
    expect(made?.isNullable).toBe(true);
    expect(made?.type).toBe('boolean');

    const notes = column(workoutSetMeta, 'notes');
    expect(notes?.isNullable).toBe(true);
    expect(notes?.type).toBe('varchar');
  });

  it('drops isCompleted, weightMode and expectedWeight from workout_set', () => {
    const propertyNames = dataSource
      .getMetadata(WorkoutSet)
      .columns.map((c) => c.propertyName);
    expect(propertyNames).not.toContain('isCompleted');
    expect(propertyNames).not.toContain('weightMode');
    expect(propertyNames).not.toContain('expectedWeight');
  });
});
