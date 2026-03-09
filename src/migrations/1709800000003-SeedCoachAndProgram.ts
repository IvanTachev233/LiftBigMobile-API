import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedCoachAndProgram1709800000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Precomputed bcrypt hash for 'password123'
    const passwordHash =
      '$2b$10$Qw/JkwEksWkWQ3WFok2w5.ViUItjFwWSmTSodDoHBMiOvSIXQ1cUa';

    // Create a mock coach user
    await queryRunner.query(
      `INSERT INTO "user" ("id", "email", "passwordHash", "role")
       VALUES (gen_random_uuid(), 'coach@liftbig.com', $1, 'COACH')
       ON CONFLICT DO NOTHING;`,
      [passwordHash],
    );

    // Assign existing mock client to the coach
    await queryRunner.query(
      `UPDATE "user" SET "coachId" = (
        SELECT "id" FROM "user" WHERE "email" = 'coach@liftbig.com'
      )
      WHERE "email" = 'mockuser@liftbig.com'
        AND "coachId" IS NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "user" SET "coachId" = NULL WHERE "email" = 'mockuser@liftbig.com';`,
    );
    await queryRunner.query(
      `DELETE FROM "user" WHERE "email" = 'coach@liftbig.com';`,
    );
  }
}
