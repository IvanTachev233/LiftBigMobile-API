import { MigrationInterface, QueryRunner } from 'typeorm';

export class MockUser1709800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Precomputed bcrypt hash of a shared demo password. DisableSeedAccounts
    // (1709800000011) makes it unusable.
    const passwordHash =
      '$2b$10$1Y.A9.u8o4/1S.aO1lZ7eucI0U0BvJzN1k5mK0o/Q8s1s2F2w1OWe';

    await queryRunner.query(
      `INSERT INTO "user" ("id", "email", "passwordHash", "role") 
       VALUES (gen_random_uuid(), 'mockuser@liftbig.com', $1, 'CLIENT')
       ON CONFLICT DO NOTHING;`,
      [passwordHash],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user" WHERE "email" = 'mockuser@liftbig.com';`,
    );
  }
}
