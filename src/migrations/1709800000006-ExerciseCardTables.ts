import { MigrationInterface, QueryRunner } from 'typeorm';

// Constraint names match what TypeORM's naming strategy derives for the
// entities, so synchronize finds nothing to rename afterwards.
const WORKOUT_EXERCISE_PK = 'PK_9598996a913c5f5114f9e6403b6';
const WORKOUT_EXERCISE_WORKOUT_FK = 'FK_35fe273716366d768fba9964813';
const WORKOUT_EXERCISE_EXERCISE_FK = 'FK_a2ac7d92eeb9bd5fc2bb9896611';
const WORKOUT_SET_CARD_FK = 'FK_03a3bdfb65d662cfdc38cf584f6';
const PROGRAM_EXERCISE_PK = 'PK_1493583cb51c1f75b80a6496a33';
const PROGRAM_EXERCISE_PROGRAM_FK = 'FK_08d80ae2ccb6412cad0a52c4789';
const PROGRAM_EXERCISE_EXERCISE_FK = 'FK_635b7738c7cbfe9b8811c0f5cbf';
const PROGRAM_SET_PK = 'PK_3674f4ae03ae8f09d37efe31168';
const PROGRAM_SET_CARD_FK = 'FK_30533c8ee0973bab38762942f92';
// Names the flat set tables had before this migration.
const OLD_WORKOUT_SET_WORKOUT_FK = 'FK_603e7d27f2ae3370584e6fc7679';
const OLD_WORKOUT_SET_EXERCISE_FK = 'FK_befb8b09c61cbed72c5187243cf';

// Holds each set's original "order" so down() restores it exactly; set
// order is renumbered per card in up(). Sync ignores tables with no entity.
const ORDER_BACKUP_TABLE = 'exercise_card_migration_set_order';

/**
 * Moves exercise order and superset from every set row onto card rows:
 * workout_set rows are grouped into workout_exercise cards, and the old
 * program_exercise set rows become program_set rows grouped into new
 * program_exercise cards. A database without the old tables is skipped,
 * since synchronize creates the new schema there. down() always restores
 * the nullable "supersetGroup" column on the flat tables, even when up()
 * had to add it.
 */
export class ExerciseCardTables1709800000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const migrateWorkouts =
      (await queryRunner.hasTable('workout_set')) &&
      !(await queryRunner.hasColumn('workout_set', 'workoutExerciseId'));
    const migratePrograms =
      (await queryRunner.hasTable('program_exercise')) &&
      !(await queryRunner.hasTable('program_set'));

    if (migrateWorkouts || migratePrograms) {
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "${ORDER_BACKUP_TABLE}" ("setId" uuid PRIMARY KEY, "order" integer NOT NULL)`,
      );
    }
    if (migrateWorkouts) await this.upWorkouts(queryRunner);
    if (migratePrograms) await this.upPrograms(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasBackup = await queryRunner.hasTable(ORDER_BACKUP_TABLE);
    if (await queryRunner.hasColumn('workout_set', 'workoutExerciseId')) {
      await this.downWorkouts(queryRunner, hasBackup);
    }
    if (await queryRunner.hasTable('program_set')) {
      await this.downPrograms(queryRunner, hasBackup);
    }
    if (hasBackup) {
      await queryRunner.query(`DROP TABLE "${ORDER_BACKUP_TABLE}"`);
    }
  }

  private async upWorkouts(queryRunner: QueryRunner): Promise<void> {
    // Databases that never had supersets lack the column; all sets then
    // group with a null superset.
    await queryRunner.query(
      `ALTER TABLE "workout_set" ADD COLUMN IF NOT EXISTS "supersetGroup" uuid`,
    );
    await queryRunner.query(
      `INSERT INTO "${ORDER_BACKUP_TABLE}" ("setId", "order") SELECT "id", "order" FROM "workout_set"`,
    );
    await queryRunner.query(
      `CREATE TABLE "workout_exercise" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workoutId" uuid NOT NULL,
        "exerciseId" uuid NOT NULL,
        "order" integer NOT NULL,
        "supersetGroup" uuid,
        CONSTRAINT "${WORKOUT_EXERCISE_PK}" PRIMARY KEY ("id")
      )`,
    );
    // One card per (workout, exercise, superset); NULL supersets group
    // together. Cards are ranked by their first set, ties by exercise id.
    await queryRunner.query(
      `INSERT INTO "workout_exercise" ("workoutId", "exerciseId", "order", "supersetGroup")
      SELECT "workoutId", "exerciseId",
        ROW_NUMBER() OVER (
          PARTITION BY "workoutId"
          ORDER BY MIN("order"), "exerciseId", "supersetGroup" NULLS FIRST
        ),
        "supersetGroup"
      FROM "workout_set"
      GROUP BY "workoutId", "exerciseId", "supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" ADD "workoutExerciseId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "workout_set" s SET "workoutExerciseId" = c."id"
      FROM "workout_exercise" c
      WHERE c."workoutId" = s."workoutId"
        AND c."exerciseId" = s."exerciseId"
        AND c."supersetGroup" IS NOT DISTINCT FROM s."supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" ALTER COLUMN "workoutExerciseId" SET NOT NULL`,
    );
    await this.renumberSets(queryRunner, 'workout_set', 'workoutExerciseId');
    await queryRunner.query(
      `ALTER TABLE "workout_set" DROP COLUMN "workoutId", DROP COLUMN "exerciseId", DROP COLUMN "supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_exercise"
        ADD CONSTRAINT "${WORKOUT_EXERCISE_WORKOUT_FK}" FOREIGN KEY ("workoutId") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT "${WORKOUT_EXERCISE_EXERCISE_FK}" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" ADD CONSTRAINT "${WORKOUT_SET_CARD_FK}" FOREIGN KEY ("workoutExerciseId") REFERENCES "workout_exercise"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  private async upPrograms(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "program_exercise" ADD COLUMN IF NOT EXISTS "supersetGroup" uuid`,
    );
    await queryRunner.query(
      `INSERT INTO "${ORDER_BACKUP_TABLE}" ("setId", "order") SELECT "id", "order" FROM "program_exercise"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_exercise" RENAME TO "program_set"`,
    );
    // The renamed table keeps the card table's primary key name; free it.
    const [pk] = (await queryRunner.query(
      `SELECT conname FROM pg_constraint WHERE conrelid = '"program_set"'::regclass AND contype = 'p'`,
    )) as { conname: string }[];
    await queryRunner.query(
      `ALTER TABLE "program_set" RENAME CONSTRAINT "${pk.conname}" TO "${PROGRAM_SET_PK}"`,
    );
    await queryRunner.query(
      `CREATE TABLE "program_exercise" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "programId" uuid NOT NULL,
        "exerciseId" uuid NOT NULL,
        "order" integer NOT NULL,
        "supersetGroup" uuid,
        CONSTRAINT "${PROGRAM_EXERCISE_PK}" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `INSERT INTO "program_exercise" ("programId", "exerciseId", "order", "supersetGroup")
      SELECT "programId", "exerciseId",
        ROW_NUMBER() OVER (
          PARTITION BY "programId"
          ORDER BY MIN("order"), "exerciseId", "supersetGroup" NULLS FIRST
        ),
        "supersetGroup"
      FROM "program_set"
      GROUP BY "programId", "exerciseId", "supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" ADD "programExerciseId" uuid`,
    );
    await queryRunner.query(
      `UPDATE "program_set" s SET "programExerciseId" = c."id"
      FROM "program_exercise" c
      WHERE c."programId" = s."programId"
        AND c."exerciseId" = s."exerciseId"
        AND c."supersetGroup" IS NOT DISTINCT FROM s."supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" ALTER COLUMN "programExerciseId" SET NOT NULL`,
    );
    await this.renumberSets(queryRunner, 'program_set', 'programExerciseId');
    // Dropping the columns also drops their inherited foreign keys.
    await queryRunner.query(
      `ALTER TABLE "program_set" DROP COLUMN "programId", DROP COLUMN "exerciseId", DROP COLUMN "supersetGroup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_exercise"
        ADD CONSTRAINT "${PROGRAM_EXERCISE_PROGRAM_FK}" FOREIGN KEY ("programId") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT "${PROGRAM_EXERCISE_EXERCISE_FK}" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" ADD CONSTRAINT "${PROGRAM_SET_CARD_FK}" FOREIGN KEY ("programExerciseId") REFERENCES "program_exercise"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  private async downWorkouts(
    queryRunner: QueryRunner,
    hasBackup: boolean,
  ): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workout_set" ADD "workoutId" uuid, ADD "exerciseId" uuid, ADD "supersetGroup" uuid`,
    );
    await queryRunner.query(
      `UPDATE "workout_set" s
      SET "workoutId" = c."workoutId", "exerciseId" = c."exerciseId", "supersetGroup" = c."supersetGroup"
      FROM "workout_exercise" c
      WHERE c."id" = s."workoutExerciseId"`,
    );
    await this.restoreFlatOrder(
      queryRunner,
      hasBackup,
      'workout_set',
      'workout_exercise',
      'workoutExerciseId',
      'workoutId',
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" ALTER COLUMN "workoutId" SET NOT NULL, ALTER COLUMN "exerciseId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" DROP COLUMN "workoutExerciseId"`,
    );
    await queryRunner.query(`DROP TABLE "workout_exercise"`);
    await queryRunner.query(
      `ALTER TABLE "workout_set"
        ADD CONSTRAINT "${OLD_WORKOUT_SET_WORKOUT_FK}" FOREIGN KEY ("workoutId") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT "${OLD_WORKOUT_SET_EXERCISE_FK}" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  private async downPrograms(
    queryRunner: QueryRunner,
    hasBackup: boolean,
  ): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "program_set" ADD "programId" uuid, ADD "exerciseId" uuid, ADD "supersetGroup" uuid`,
    );
    await queryRunner.query(
      `UPDATE "program_set" s
      SET "programId" = c."programId", "exerciseId" = c."exerciseId", "supersetGroup" = c."supersetGroup"
      FROM "program_exercise" c
      WHERE c."id" = s."programExerciseId"`,
    );
    await this.restoreFlatOrder(
      queryRunner,
      hasBackup,
      'program_set',
      'program_exercise',
      'programExerciseId',
      'programId',
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" ALTER COLUMN "programId" SET NOT NULL, ALTER COLUMN "exerciseId" SET NOT NULL`,
    );
    // Drops the card FK, then the card table, freeing its constraint names.
    await queryRunner.query(
      `ALTER TABLE "program_set" DROP COLUMN "programExerciseId"`,
    );
    await queryRunner.query(`DROP TABLE "program_exercise"`);
    await queryRunner.query(
      `ALTER TABLE "program_set" RENAME CONSTRAINT "${PROGRAM_SET_PK}" TO "${PROGRAM_EXERCISE_PK}"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" RENAME TO "program_exercise"`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_exercise"
        ADD CONSTRAINT "${PROGRAM_EXERCISE_PROGRAM_FK}" FOREIGN KEY ("programId") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT "${PROGRAM_EXERCISE_EXERCISE_FK}" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  // Set order = rank inside its card by old order, then id.
  private async renumberSets(
    queryRunner: QueryRunner,
    setTable: string,
    cardColumn: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE "${setTable}" s SET "order" = r."rank"
      FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "${cardColumn}" ORDER BY "order", "id") AS "rank"
        FROM "${setTable}"
      ) r
      WHERE r."id" = s."id"`,
    );
  }

  // Puts back each set's original order; sets created after up() get their
  // position across the whole workout/program (card order, then set order).
  private async restoreFlatOrder(
    queryRunner: QueryRunner,
    hasBackup: boolean,
    setTable: string,
    cardTable: string,
    cardColumn: string,
    parentColumn: string,
  ): Promise<void> {
    await queryRunner.query(
      `UPDATE "${setTable}" s SET "order" = r."rank"
      FROM (
        SELECT s2."id", ROW_NUMBER() OVER (
          PARTITION BY c."${parentColumn}" ORDER BY c."order", s2."order", s2."id"
        ) AS "rank"
        FROM "${setTable}" s2
        JOIN "${cardTable}" c ON c."id" = s2."${cardColumn}"
      ) r
      WHERE r."id" = s."id"`,
    );
    if (hasBackup) {
      await queryRunner.query(
        `UPDATE "${setTable}" s SET "order" = b."order"
        FROM "${ORDER_BACKUP_TABLE}" b
        WHERE b."setId" = s."id"`,
      );
    }
  }
}
