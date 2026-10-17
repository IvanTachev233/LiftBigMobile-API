import { MigrationInterface, QueryRunner } from 'typeorm';

// Accounts that exist when email confirmation ships count as verified. A
// database without the user table is skipped, since synchronize creates it.
export class EmailVerifiedAt1709800000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `UPDATE "user" SET "emailVerifiedAt" = now() WHERE "emailVerifiedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "emailVerifiedAt"`,
    );
  }
}
