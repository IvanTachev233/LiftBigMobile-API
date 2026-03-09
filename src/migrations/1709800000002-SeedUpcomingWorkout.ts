import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedUpcomingWorkout1709800000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const userId = '313f2ec4-e9a4-4384-9fc1-09e734815f9f';
    const workoutId = 'e2abf48f-3687-4d7a-bcef-34ab21d3cf12';
    const workoutSetId1 = 'f9a2b53f-48d6-44c1-aeef-bc93a9b9cf98';
    const workoutSetId2 = 'bdf2a823-1d61-46bb-9fe2-dfbfb40a33a3';

    // 1. Ensure the user exists so foreign key constraints pass
    // If the user already exists because the user created it through the app, ON CONFLICT DO NOTHING handles it for id constraint.
    const passwordHash =
      '$2b$10$CJNXU5gWtP1X7geaPdAWE.b0/yJsi3.VAMHRurccepu15AtiOxVwq'; // 'password123'
    await queryRunner.query(
      `INSERT INTO "user" ("id", "email", "passwordHash", "role") 
       VALUES ($1, 'mockuser_specific@liftbig.com', $2, 'CLIENT')
       ON CONFLICT ("id") DO NOTHING;`, // Note: if email constraint triggers we'd want to ignore, but ignoring by ID is safer.
      [userId, passwordHash],
    );

    // 2. Insert the upcoming workout (Date = tomorrow)
    await queryRunner.query(
      `INSERT INTO "workout" ("id", "userId", "name", "date", "status", "isTemplate", "totalWeightLifted")
       VALUES ($1, $2, 'Heavy Olympic Day', CURRENT_TIMESTAMP + interval '1 day', 'PLANNED', false, 0)
       ON CONFLICT DO NOTHING;`,
      [workoutId, userId],
    );

    // 3. Insert the sets querying the generated UUIDs from the exercise table
    await queryRunner.query(
      `INSERT INTO "workout_set" ("id", "workoutId", "exerciseId", "reps", "weight", "weightMode", "order", "isCompleted")
       SELECT $1, $2, id, 3, 85.0, 'EX', 1, false 
       FROM "exercise" WHERE name = 'Snatch' LIMIT 1;`,
      [workoutSetId1, workoutId],
    );

    await queryRunner.query(
      `INSERT INTO "workout_set" ("id", "workoutId", "exerciseId", "reps", "weight", "weightMode", "order", "isCompleted")
       SELECT $1, $2, id, 5, 140.0, 'EX', 2, false 
       FROM "exercise" WHERE name = 'Back Squat' LIMIT 1;`,
      [workoutSetId2, workoutId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const workoutId = 'e2abf48f-3687-4d7a-bcef-34ab21d3cf12';
    const userId = '313f2ec4-e9a4-4384-9fc1-09e734815f9f';
    await queryRunner.query(`DELETE FROM "workout" WHERE id = $1;`, [
      workoutId,
    ]);
    await queryRunner.query(`DELETE FROM "user" WHERE id = $1;`, [userId]);
  }
}
