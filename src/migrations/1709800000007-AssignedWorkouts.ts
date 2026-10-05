import { MigrationInterface, QueryRunner } from 'typeorm';

// Constraint names match what TypeORM's naming strategy derives for the
// entities, so synchronize finds nothing to rename afterwards.
const WORKOUT_ASSIGNED_BY_FK = 'FK_2f1cdaf76f3ed6ba6f769f107ec';
// Names the program tables had before this migration; down() reuses them.
const PROGRAM_PK = 'PK_3bade5945afbafefdd26a3a29fb';
const PROGRAM_CLIENT_FK = 'FK_93cbad45a6ed8b908e0be576b31';
const PROGRAM_COACH_FK = 'FK_f3da3fbdc7189fd3c3765761f04';
const PROGRAM_EXERCISE_PK = 'PK_1493583cb51c1f75b80a6496a33';
const PROGRAM_EXERCISE_PROGRAM_FK = 'FK_08d80ae2ccb6412cad0a52c4789';
const PROGRAM_EXERCISE_EXERCISE_FK = 'FK_635b7738c7cbfe9b8811c0f5cbf';
const PROGRAM_SET_PK = 'PK_3674f4ae03ae8f09d37efe31168';
const PROGRAM_SET_CARD_FK = 'FK_30533c8ee0973bab38762942f92';
const WEIGHT_MODE_ENUM = 'workout_set_weightmode_enum';

// Hold the values up() drops, so down() restores them exactly. Sync ignores
// tables with no entity.
const SET_BACKUP_TABLE = 'assigned_workout_migration_sets';
const WORKOUT_BACKUP_TABLE = 'assigned_workout_migration_workouts';
const PROGRAM_BACKUP_TABLE = 'assigned_workout_migration_programs';

/**
 * Turns every program into a workout assigned by its coach
 * ("assignedById"), keeping program, card and set ids, and drops the
 * program tables. Set rows switch to planned reps/weight plus a nullable
 * "made": self sets get made = true where they were completed, program sets
 * keep theirs. Every workout total is recomputed from its made sets. A
 * database without the program table is skipped, since synchronize creates
 * the new schema there. down() moves workouts that have a coach back into
 * the program tables.
 */
export class AssignedWorkouts1709800000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('program'))) return;

    await this.assertMigratable(queryRunner);

    await queryRunner.query(
      `CREATE TABLE "${SET_BACKUP_TABLE}" (
        "id" uuid PRIMARY KEY,
        "isCompleted" boolean NOT NULL,
        "weightMode" varchar NOT NULL,
        "expectedWeight" numeric,
        "actualWeight" numeric
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "${WORKOUT_BACKUP_TABLE}" ("id" uuid PRIMARY KEY, "totalWeightLifted" numeric NOT NULL)`,
    );
    await queryRunner.query(
      `CREATE TABLE "${PROGRAM_BACKUP_TABLE}" (
        "id" uuid PRIMARY KEY,
        "createdAt" timestamp NOT NULL,
        "updatedAt" timestamp NOT NULL
      )`,
    );
    await queryRunner.query(
      `INSERT INTO "${SET_BACKUP_TABLE}" ("id", "isCompleted", "weightMode", "expectedWeight", "actualWeight")
      SELECT "id", "isCompleted", "weightMode"::text, "expectedWeight", "actualWeight" FROM "workout_set"`,
    );
    await queryRunner.query(
      `INSERT INTO "${WORKOUT_BACKUP_TABLE}" ("id", "totalWeightLifted")
      SELECT "id", "totalWeightLifted" FROM "workout"`,
    );
    await queryRunner.query(
      `INSERT INTO "${PROGRAM_BACKUP_TABLE}" ("id", "createdAt", "updatedAt")
      SELECT "id", "createdAt", "updatedAt" FROM "program"`,
    );

    await queryRunner.query(
      `ALTER TABLE "workout_set"
        ADD "made" boolean DEFAULT NULL,
        ADD "notes" character varying,
        ALTER COLUMN "weight" TYPE numeric(6,2),
        ALTER COLUMN "weight" DROP NOT NULL,
        ALTER COLUMN "actualWeight" TYPE numeric(6,2)`,
    );
    await queryRunner.query(
      `UPDATE "workout_set" SET "made" = true WHERE "isCompleted"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set" DROP COLUMN "isCompleted", DROP COLUMN "weightMode", DROP COLUMN "expectedWeight"`,
    );
    await queryRunner.query(`DROP TYPE "${WEIGHT_MODE_ENUM}"`);

    await queryRunner.query(`ALTER TABLE "workout" ADD "assignedById" uuid`);
    // Status: COMPLETED when every set is logged, IN_PROGRESS when some are.
    await queryRunner.query(
      `INSERT INTO "workout" ("id", "userId", "assignedById", "date", "name", "notes", "isTemplate", "totalWeightLifted", "status")
      SELECT p."id", p."clientId", p."coachId", p."scheduledDate"::timestamp, p."name", NULL, false, 0,
        (CASE
          WHEN COUNT(s."id") > 0 AND COUNT(s."made") = COUNT(s."id") THEN 'COMPLETED'
          WHEN COUNT(s."made") > 0 THEN 'IN_PROGRESS'
          ELSE 'PLANNED'
        END)::"workout_status_enum"
      FROM "program" p
      LEFT JOIN "program_exercise" c ON c."programId" = p."id"
      LEFT JOIN "program_set" s ON s."programExerciseId" = c."id"
      GROUP BY p."id"`,
    );
    await queryRunner.query(
      `INSERT INTO "workout_exercise" ("id", "workoutId", "exerciseId", "order", "supersetGroup")
      SELECT "id", "programId", "exerciseId", "order", "supersetGroup" FROM "program_exercise"`,
    );
    await queryRunner.query(
      `INSERT INTO "workout_set" ("id", "workoutExerciseId", "reps", "weight", "notes", "order", "made")
      SELECT "id", "programExerciseId", "reps", "weight", "notes", "order", "made" FROM "program_set"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout" ADD CONSTRAINT "${WORKOUT_ASSIGNED_BY_FK}" FOREIGN KEY ("assignedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Volume counts made sets only, using actual values over planned ones.
    // Totals that are numerically unchanged are left as stored.
    await queryRunner.query(
      `UPDATE "workout" w SET "totalWeightLifted" = t."total"
      FROM (
        SELECT w2."id", COALESCE(SUM(
          COALESCE(s."actualWeight", s."weight", 0) * COALESCE(s."actualReps", s."reps")
        ) FILTER (WHERE s."made"), 0) AS "total"
        FROM "workout" w2
        LEFT JOIN "workout_exercise" c ON c."workoutId" = w2."id"
        LEFT JOIN "workout_set" s ON s."workoutExerciseId" = c."id"
        GROUP BY w2."id"
      ) t
      WHERE t."id" = w."id" AND w."totalWeightLifted" <> t."total"`,
    );

    await queryRunner.query(`DROP TABLE "program_set"`);
    await queryRunner.query(`DROP TABLE "program_exercise"`);
    await queryRunner.query(`DROP TABLE "program"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(PROGRAM_BACKUP_TABLE))) return;

    await queryRunner.query(
      `CREATE TABLE "program" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "clientId" uuid NOT NULL,
        "coachId" uuid NOT NULL,
        "name" character varying NOT NULL,
        "scheduledDate" date NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "${PROGRAM_PK}" PRIMARY KEY ("id")
      )`,
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
      `CREATE TABLE "program_set" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reps" integer NOT NULL,
        "weight" numeric(6,2),
        "notes" character varying,
        "order" integer NOT NULL,
        "made" boolean DEFAULT NULL,
        "programExerciseId" uuid NOT NULL,
        CONSTRAINT "${PROGRAM_SET_PK}" PRIMARY KEY ("id")
      )`,
    );
    // Workouts assigned after up() get the current time as createdAt and
    // updatedAt.
    await queryRunner.query(
      `INSERT INTO "program" ("id", "clientId", "coachId", "name", "scheduledDate", "createdAt", "updatedAt")
      SELECT w."id", w."userId", w."assignedById", w."name", w."date"::date,
        COALESCE(b."createdAt", now()), COALESCE(b."updatedAt", now())
      FROM "workout" w
      LEFT JOIN "${PROGRAM_BACKUP_TABLE}" b ON b."id" = w."id"
      WHERE w."assignedById" IS NOT NULL`,
    );
    await queryRunner.query(
      `INSERT INTO "program_exercise" ("id", "programId", "exerciseId", "order", "supersetGroup")
      SELECT c."id", c."workoutId", c."exerciseId", c."order", c."supersetGroup"
      FROM "workout_exercise" c
      JOIN "program" p ON p."id" = c."workoutId"`,
    );
    await queryRunner.query(
      `INSERT INTO "program_set" ("id", "programExerciseId", "reps", "weight", "notes", "order", "made")
      SELECT s."id", s."workoutExerciseId", s."reps", s."weight", s."notes", s."order", s."made"
      FROM "workout_set" s
      JOIN "program_exercise" c ON c."id" = s."workoutExerciseId"`,
    );
    // Cascades to their cards and sets.
    await queryRunner.query(
      `DELETE FROM "workout" WHERE "assignedById" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "program"
        ADD CONSTRAINT "${PROGRAM_CLIENT_FK}" FOREIGN KEY ("clientId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        ADD CONSTRAINT "${PROGRAM_COACH_FK}" FOREIGN KEY ("coachId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_exercise"
        ADD CONSTRAINT "${PROGRAM_EXERCISE_PROGRAM_FK}" FOREIGN KEY ("programId") REFERENCES "program"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        ADD CONSTRAINT "${PROGRAM_EXERCISE_EXERCISE_FK}" FOREIGN KEY ("exerciseId") REFERENCES "exercise"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "program_set" ADD CONSTRAINT "${PROGRAM_SET_CARD_FK}" FOREIGN KEY ("programExerciseId") REFERENCES "program_exercise"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "workout" DROP CONSTRAINT "${WORKOUT_ASSIGNED_BY_FK}"`,
    );
    await queryRunner.query(`ALTER TABLE "workout" DROP COLUMN "assignedById"`);

    await queryRunner.query(
      `CREATE TYPE "${WEIGHT_MODE_ENUM}" AS ENUM('EX', 'PC', 'RP')`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set"
        ADD "weightMode" "${WEIGHT_MODE_ENUM}" NOT NULL DEFAULT 'EX',
        ADD "expectedWeight" numeric,
        ADD "isCompleted" boolean NOT NULL DEFAULT false,
        ALTER COLUMN "actualWeight" TYPE numeric`,
    );
    // made = true is exactly the old isCompleted for sets unchanged since
    // up(); sets ticked or unticked since then keep their current state.
    await queryRunner.query(
      `UPDATE "workout_set" SET "isCompleted" = true WHERE "made"`,
    );
    // A backed-up actualWeight is put back only while the current value
    // still equals it rounded, i.e. it wasn't edited after up().
    await queryRunner.query(
      `UPDATE "workout_set" s SET
        "weightMode" = b."weightMode"::"${WEIGHT_MODE_ENUM}",
        "expectedWeight" = b."expectedWeight",
        "actualWeight" = CASE
          WHEN s."actualWeight" = ROUND(b."actualWeight", 2) THEN b."actualWeight"
          ELSE s."actualWeight"
        END
      FROM "${SET_BACKUP_TABLE}" b
      WHERE b."id" = s."id"`,
    );
    // The old column has no room for a missing weight.
    await queryRunner.query(
      `UPDATE "workout_set" SET "weight" = 0 WHERE "weight" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "workout_set"
        ALTER COLUMN "weight" TYPE numeric(5,2),
        ALTER COLUMN "weight" SET NOT NULL,
        DROP COLUMN "made",
        DROP COLUMN "notes"`,
    );
    await queryRunner.query(
      `UPDATE "workout" w SET "totalWeightLifted" = b."totalWeightLifted"
      FROM "${WORKOUT_BACKUP_TABLE}" b
      WHERE b."id" = w."id"`,
    );

    await queryRunner.query(`DROP TABLE "${SET_BACKUP_TABLE}"`);
    await queryRunner.query(`DROP TABLE "${WORKOUT_BACKUP_TABLE}"`);
    await queryRunner.query(`DROP TABLE "${PROGRAM_BACKUP_TABLE}"`);
  }

  // Program, card and set ids are kept, so none may already be in use by
  // a workout, card or set; and every actualWeight must fit numeric(6,2).
  private async assertMigratable(queryRunner: QueryRunner): Promise<void> {
    const [counts] = (await queryRunner.query(
      `SELECT
        (SELECT COUNT(*) FROM "program" p JOIN "workout" w ON w."id" = p."id")::int AS "workouts",
        (SELECT COUNT(*) FROM "program_exercise" pc JOIN "workout_exercise" wc ON wc."id" = pc."id")::int AS "cards",
        (SELECT COUNT(*) FROM "program_set" ps JOIN "workout_set" ws ON ws."id" = ps."id")::int AS "sets",
        (SELECT COUNT(*) FROM "workout_set" WHERE ABS("actualWeight") >= 10000)::int AS "oversized"`,
    )) as {
      workouts: number;
      cards: number;
      sets: number;
      oversized: number;
    }[];
    if (counts.workouts > 0 || counts.cards > 0 || counts.sets > 0) {
      throw new Error(
        `Program ids collide with existing workout ids (workouts: ${counts.workouts}, cards: ${counts.cards}, sets: ${counts.sets}); nothing was migrated.`,
      );
    }
    if (counts.oversized > 0) {
      throw new Error(
        `${counts.oversized} workout sets have an actualWeight of 10000 or more, which numeric(6,2) can't hold; nothing was migrated.`,
      );
    }
  }
}
