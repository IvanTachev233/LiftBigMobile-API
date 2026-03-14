import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMadeToProgramExercise1709800000004
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "program_exercise" ADD "made" boolean DEFAULT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "program_exercise" DROP COLUMN "made"`,
    );
  }
}
