import { MigrationInterface, QueryRunner } from 'typeorm';

// Creates the policy_acceptance and consent_event tables exactly as
// synchronize would for the PolicyAcceptance and ConsentEvent entities (same
// constraint and index names), so sync finds nothing to change afterwards.
// Additive only. A database without the user table is skipped, and so is
// each table sync already created.
export class PolicyRecords1709800000010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('user'))) return;

    if (!(await queryRunner.hasTable('policy_acceptance'))) {
      await queryRunner.query(
        `CREATE TABLE "policy_acceptance" (
          "id" SERIAL NOT NULL,
          "userId" uuid NOT NULL,
          "document" character varying NOT NULL,
          "version" character varying NOT NULL,
          "acceptedAt" TIMESTAMP NOT NULL,
          "source" character varying NOT NULL,
          "appVersionCode" integer,
          CONSTRAINT "PK_f1cade691bebad842497ce27c34" PRIMARY KEY ("id")
        )`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_9f4bc360bf0a095ab39282faac" ON "policy_acceptance" ("userId")`,
      );
      await queryRunner.query(
        `ALTER TABLE "policy_acceptance" ADD CONSTRAINT "FK_9f4bc360bf0a095ab39282faac3" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }

    if (!(await queryRunner.hasTable('consent_event'))) {
      await queryRunner.query(
        `CREATE TABLE "consent_event" (
          "id" SERIAL NOT NULL,
          "userId" uuid NOT NULL,
          "purpose" character varying NOT NULL,
          "granted" boolean NOT NULL,
          "textVersion" character varying NOT NULL,
          "createdAt" TIMESTAMP NOT NULL,
          "source" character varying NOT NULL,
          CONSTRAINT "PK_da129f04a16b45855a0ebb5ed68" PRIMARY KEY ("id")
        )`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_4d5a51cd2e1b0324ea4abff71c" ON "consent_event" ("userId")`,
      );
      await queryRunner.query(
        `ALTER TABLE "consent_event" ADD CONSTRAINT "FK_4d5a51cd2e1b0324ea4abff71c6" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "consent_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "policy_acceptance"`);
  }
}
