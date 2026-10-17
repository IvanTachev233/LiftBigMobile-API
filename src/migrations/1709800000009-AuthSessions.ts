import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the auth_session table exactly as synchronize would for the
// AuthSession entity (same constraint and index names), so sync finds
// nothing to change afterwards. A database without the user table, or one
// where sync already created auth_session, is skipped.
export class AuthSessions1709800000009 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;
    if (await queryRunner.hasTable('auth_session')) return;
    await queryRunner.query(
      `CREATE TABLE "auth_session" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" character varying NOT NULL,
        "previousHash" character varying,
        "rotatedAt" TIMESTAMP,
        "tokenVersion" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL,
        "lastUsedAt" TIMESTAMP NOT NULL,
        "idleExpiresAt" TIMESTAMP NOT NULL,
        "absoluteExpiresAt" TIMESTAMP NOT NULL,
        "revokedAt" TIMESTAMP,
        CONSTRAINT "PK_19354ed146424a728c1112a8cbf" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c072b729d71697f959bde66ade" ON "auth_session" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_91b0ea197ef5e65be48c624aae" ON "auth_session" ("tokenHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_79479d08ea0f7a335991a846fa" ON "auth_session" ("previousHash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth_session" ADD CONSTRAINT "FK_c072b729d71697f959bde66ade0" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_session"`);
  }
}
