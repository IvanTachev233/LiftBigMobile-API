import { MigrationInterface, QueryRunner } from 'typeorm';

// MockUser (0000), SeedUpcomingWorkout (0002) and SeedCoachAndProgram (0003)
// created these accounts with a published password hash, and 0008 marked
// them verified. This makes
// the password unusable (the same marker as a deleted coach account) and
// raises tokenVersion, which revokes their access tokens and refresh
// sessions. The rows stay: seeded data and the coach link point at them.
// A database without the user table is skipped.
export class DisableSeedAccounts1709800000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;

    await queryRunner.query(
      `UPDATE "user"
       SET "passwordHash" = $1, "tokenVersion" = "tokenVersion" + 1
       WHERE "email" IN ($2, $3, $4)`,
      [
        '!deleted',
        'mockuser@liftbig.com',
        'mockuser_specific@liftbig.com',
        'coach@liftbig.com',
      ],
    );
  }

  // The published password is not restored
  public async down(): Promise<void> {}
}
