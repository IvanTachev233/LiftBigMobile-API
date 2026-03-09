import { MigrationInterface, QueryRunner } from 'typeorm';

export class MockUser1709800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Generate a secure mock password hash (e.g., bcrypt hash for 'password123')
    // We'll use a precomputed hash for simplicity: $2b$10$X... -> 'password123'
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
