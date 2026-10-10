import { DataSource, EntityMetadata, EntityTarget } from 'typeorm';
import { User } from '../../auth/user.entity';
import { WeightUnit } from '../../common/weight-unit';
import { RepMaxEntry } from '../../lifts/entities/rep-max-entry.entity';
import { UserBestLift } from '../../lifts/entities/user-best-lift.entity';
import { Exercise } from '../../workouts/entities/exercise.entity';
import { WorkoutExercise } from '../../workouts/entities/workout-exercise.entity';
import { WorkoutSet } from '../../workouts/entities/workout-set.entity';
import { Workout } from '../../workouts/entities/workout.entity';
import { programEntities } from '.';
import { ProgramEnrollment } from './program-enrollment.entity';
import { ProgramTemplateExercise } from './program-template-exercise.entity';
import { ProgramTemplateSession } from './program-template-session.entity';
import { ProgramTemplate } from './program-template.entity';
import { SportRequiredLift } from './sport-required-lift.entity';
import { Sport } from './sport.entity';

// Builds entity metadata without connecting to a database.
async function buildMetadata(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    entities: [
      Workout,
      WorkoutExercise,
      WorkoutSet,
      Exercise,
      User,
      ...programEntities,
      UserBestLift,
      RepMaxEntry,
    ],
  });
  await (
    dataSource as unknown as { buildMetadatas(): Promise<void> }
  ).buildMetadatas();
  return dataSource;
}

function column(metadata: EntityMetadata, propertyName: string) {
  const found = metadata.columns.find((c) => c.propertyName === propertyName);
  if (!found) throw new Error(`no column ${propertyName}`);
  return found;
}

function foreignKey(metadata: EntityMetadata, columnName: string) {
  const found = metadata.foreignKeys.find((fk) =>
    fk.columnNames.includes(columnName),
  );
  if (!found) throw new Error(`no foreign key on ${columnName}`);
  return {
    table: found.referencedEntityMetadata.tableName,
    onDelete: found.onDelete,
  };
}

function uniqueColumnSets(metadata: EntityMetadata): string[][] {
  return metadata.uniques.map((u) =>
    u.columns.map((c) => c.propertyName).sort(),
  );
}

describe('program and lift entity metadata', () => {
  let dataSource: DataSource;
  const meta = (target: EntityTarget<unknown>) =>
    dataSource.getMetadata(target);

  beforeAll(async () => {
    dataSource = await buildMetadata();
  });

  it('uses the new table names, none of them a legacy program table', () => {
    const tables = [
      Sport,
      SportRequiredLift,
      ProgramTemplate,
      ProgramTemplateSession,
      ProgramTemplateExercise,
      ProgramEnrollment,
      UserBestLift,
      RepMaxEntry,
    ].map((target) => meta(target).tableName);

    expect(tables).toEqual([
      'sport',
      'sport_required_lift',
      'program_template',
      'program_template_session',
      'program_template_exercise',
      'program_enrollment',
      'user_best_lift',
      'rep_max_entry',
    ]);
    const allTables = dataSource.entityMetadatas.map((m) => m.tableName);
    for (const legacy of ['program', 'program_exercise', 'program_set']) {
      expect(allTables).not.toContain(legacy);
    }
  });

  describe('sport', () => {
    it('has a unique name and a displayOrder', () => {
      const sport = meta(Sport);
      expect(uniqueColumnSets(sport)).toContainEqual(['name']);
      expect(column(sport, 'displayOrder').type).toBe('integer');
    });

    it('maps required lifts to exercises once per sport, with a label', () => {
      const lift = meta(SportRequiredLift);
      expect(uniqueColumnSets(lift)).toContainEqual(['exerciseId', 'sportId']);
      expect(foreignKey(lift, 'sportId')).toEqual({
        table: 'sport',
        onDelete: 'CASCADE',
      });
      expect(foreignKey(lift, 'exerciseId')).toEqual({
        table: 'exercise',
        onDelete: 'RESTRICT',
      });
      expect(column(lift, 'label').isNullable).toBe(false);
      expect(column(lift, 'displayOrder').type).toBe('integer');
    });
  });

  describe('program templates', () => {
    it('keeps one row per (lineageId, version) with a status enum', () => {
      const template = meta(ProgramTemplate);
      expect(uniqueColumnSets(template)).toContainEqual([
        'lineageId',
        'version',
      ]);
      expect(column(template, 'lineageId').type).toBe('uuid');
      const status = column(template, 'status');
      expect(status.type).toBe('enum');
      expect(status.enum).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
      expect(status.default).toBe('DRAFT');
      expect(column(template, 'description').isNullable).toBe(true);
      expect(meta(ProgramTemplate).createDateColumn?.propertyName).toBe(
        'createdAt',
      );
      expect(meta(ProgramTemplate).updateDateColumn?.propertyName).toBe(
        'updatedAt',
      );
    });

    it('has a nullable author (null = system) and a required sport', () => {
      const template = meta(ProgramTemplate);
      expect(column(template, 'authorId').isNullable).toBe(true);
      expect(foreignKey(template, 'authorId')).toEqual({
        table: 'user',
        onDelete: 'RESTRICT',
      });
      expect(column(template, 'sportId').isNullable).toBe(false);
      expect(foreignKey(template, 'sportId')).toEqual({
        table: 'sport',
        onDelete: 'RESTRICT',
      });
    });

    it('keys sessions by (programId, week, sessionIndex), deleted with the template', () => {
      const session = meta(ProgramTemplateSession);
      expect(uniqueColumnSets(session)).toContainEqual([
        'programId',
        'sessionIndex',
        'week',
      ]);
      expect(foreignKey(session, 'programId')).toEqual({
        table: 'program_template',
        onDelete: 'CASCADE',
      });
      expect(column(session, 'dayOffset').type).toBe('integer');
      expect(column(session, 'notes').isNullable).toBe(true);
    });

    it('stores exercises with an optional percent and reference lift', () => {
      const exercise = meta(ProgramTemplateExercise);
      expect(foreignKey(exercise, 'sessionId')).toEqual({
        table: 'program_template_session',
        onDelete: 'CASCADE',
      });
      expect(foreignKey(exercise, 'exerciseId')).toEqual({
        table: 'exercise',
        onDelete: 'RESTRICT',
      });
      expect(foreignKey(exercise, 'referenceExerciseId')).toEqual({
        table: 'exercise',
        onDelete: 'RESTRICT',
      });
      const percent = column(exercise, 'percentOf1RM');
      expect(percent.isNullable).toBe(true);
      expect(percent.type).toBe('decimal');
      expect([percent.precision, percent.scale]).toEqual([5, 2]);
      expect(column(exercise, 'referenceExerciseId').isNullable).toBe(true);
      expect(column(exercise, 'sets').isNullable).toBe(false);
      expect(column(exercise, 'reps').isNullable).toBe(false);
      expect(exercise.checks.map((c) => c.expression)).toEqual([
        '("percentOf1RM" IS NULL) = ("referenceExerciseId" IS NULL)',
      ]);
    });
  });

  describe('program_enrollment', () => {
    it('allows one ACTIVE enrollment per user through a partial unique index', () => {
      const enrollment = meta(ProgramEnrollment);
      const active = enrollment.indices.filter((i) => i.isUnique);
      expect(active).toHaveLength(1);
      expect(active[0].columns.map((c) => c.propertyName)).toEqual(['userId']);
      expect(active[0].where).toBe(`"status" = 'ACTIVE'`);
    });

    it('pins the exact template version with a date start and a jsonb snapshot', () => {
      const enrollment = meta(ProgramEnrollment);
      expect(foreignKey(enrollment, 'programId')).toEqual({
        table: 'program_template',
        onDelete: 'RESTRICT',
      });
      expect(foreignKey(enrollment, 'userId')).toEqual({
        table: 'user',
        onDelete: 'CASCADE',
      });
      expect(column(enrollment, 'programVersion').type).toBe('integer');
      expect(column(enrollment, 'startDate').type).toBe('date');
      expect(column(enrollment, 'maxesSnapshot').type).toBe('jsonb');
      const status = column(enrollment, 'status');
      expect(status.enum).toEqual(['ACTIVE', 'COMPLETED', 'ABANDONED']);
      expect(status.default).toBe('ACTIVE');
    });
  });

  describe('lift records', () => {
    it('keeps one best lift per user and exercise', () => {
      const best = meta(UserBestLift);
      expect(uniqueColumnSets(best)).toContainEqual(['exerciseId', 'userId']);
      expect(foreignKey(best, 'userId').onDelete).toBe('CASCADE');
      expect(foreignKey(best, 'exerciseId')).toEqual({
        table: 'exercise',
        onDelete: 'RESTRICT',
      });
      const weight = column(best, 'weightKg');
      expect([weight.type, weight.precision, weight.scale]).toEqual([
        'decimal',
        6,
        2,
      ]);
      expect(column(best, 'achievedOn').type).toBe('date');
      expect(column(best, 'unit').enum).toEqual(['kg', 'lb']);
      expect(column(best, 'source').enum).toEqual([
        'MANUAL',
        'LOGGED_SET',
        'PROGRAM_SETUP',
      ]);
    });

    it('links a rep max to at most one set, deleted with the set', () => {
      const entry = meta(RepMaxEntry);
      expect(uniqueColumnSets(entry)).toContainEqual(['workoutSetId']);
      expect(column(entry, 'workoutSetId').isNullable).toBe(true);
      expect(foreignKey(entry, 'workoutSetId')).toEqual({
        table: 'workout_set',
        onDelete: 'CASCADE',
      });
      expect(foreignKey(entry, 'userId').onDelete).toBe('CASCADE');
      expect(foreignKey(entry, 'exerciseId').onDelete).toBe('RESTRICT');
      expect(column(entry, 'reps').type).toBe('integer');
      expect(entry.checks.map((c) => c.expression)).toEqual(['"reps" >= 1']);
      expect(entry.createDateColumn?.propertyName).toBe('createdAt');
    });

    it('numbers rep maxes in insertion order with a generated bigint seq', () => {
      const seq = column(meta(RepMaxEntry), 'seq');
      expect(seq.type).toBe('bigint');
      expect(seq.isGenerated).toBe(true);
      expect(seq.generationStrategy).toBe('increment');
      expect(seq.isNullable).toBe(false);
    });

    it('marks a removed rep max with a nullable removedAt timestamp', () => {
      const removedAt = column(meta(RepMaxEntry), 'removedAt');
      expect(removedAt.isNullable).toBe(true);
      expect(removedAt.type).toBe('timestamp');
      expect(removedAt.default).toBeUndefined();
    });
  });

  describe('additive columns on existing tables', () => {
    it('adds exercise.isMaxTrackable, default false', () => {
      const flag = column(meta(Exercise), 'isMaxTrackable');
      expect(flag.type).toBe('boolean');
      expect(flag.isNullable).toBe(false);
      expect(flag.default).toBe(false);
    });

    it('links a workout to its enrollment and session, set to null on delete', () => {
      const workout = meta(Workout);
      for (const name of ['programEnrollmentId', 'programSessionId']) {
        expect(column(workout, name).isNullable).toBe(true);
        expect(column(workout, name).type).toBe('uuid');
      }
      expect(foreignKey(workout, 'programEnrollmentId')).toEqual({
        table: 'program_enrollment',
        onDelete: 'SET NULL',
      });
      expect(foreignKey(workout, 'programSessionId')).toEqual({
        table: 'program_template_session',
        onDelete: 'SET NULL',
      });
    });

    it('adds a nullable prescribed percent and reference exercise to workout_set', () => {
      const set = meta(WorkoutSet);
      const percent = column(set, 'prescribedPercent');
      expect(percent.isNullable).toBe(true);
      expect([percent.type, percent.precision, percent.scale]).toEqual([
        'decimal',
        5,
        2,
      ]);
      expect(column(set, 'referenceExerciseId').isNullable).toBe(true);
      expect(foreignKey(set, 'referenceExerciseId')).toEqual({
        table: 'exercise',
        onDelete: 'RESTRICT',
      });
    });

    it('adds user.weightUnit, kg by default', () => {
      const unit = column(meta(User), 'weightUnit');
      expect(unit.type).toBe('enum');
      expect(unit.enum).toEqual(['kg', 'lb']);
      expect(unit.default).toBe(WeightUnit.KG);
      expect(unit.isNullable).toBe(false);
    });
  });
});
