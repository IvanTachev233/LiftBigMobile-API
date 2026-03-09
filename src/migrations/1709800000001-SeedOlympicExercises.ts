import { MigrationInterface, QueryRunner } from 'typeorm';
import { BodyPart } from '../workouts/entities/exercise.entity';

export class SeedOlympicExercises1709800000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const exercises = [
      { name: 'Clean', bodyPart: BodyPart.FULL_BODY },
      { name: 'Jerk', bodyPart: BodyPart.FULL_BODY },
      { name: 'Clean and Jerk', bodyPart: BodyPart.FULL_BODY },
      { name: 'Power Clean', bodyPart: BodyPart.FULL_BODY },
      { name: 'Power Jerk', bodyPart: BodyPart.FULL_BODY },
      { name: 'Power Clean and Jerk', bodyPart: BodyPart.FULL_BODY },
      { name: 'Power Clean and Power Jerk', bodyPart: BodyPart.FULL_BODY },
      { name: 'Snatch', bodyPart: BodyPart.FULL_BODY },
      { name: 'Power Snatch', bodyPart: BodyPart.FULL_BODY },
      { name: 'Clean Pull', bodyPart: BodyPart.LEGS },
      { name: 'Snatch Pull', bodyPart: BodyPart.LEGS },
      { name: 'Back Squat', bodyPart: BodyPart.LEGS },
      { name: 'Front Squat', bodyPart: BodyPart.LEGS },
    ];

    for (const ex of exercises) {
      await queryRunner.query(
        `INSERT INTO "exercise" ("id", "name", "bodyPart") 
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT ("name") DO NOTHING;`,
        [ex.name, ex.bodyPart],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const names = [
      'Clean',
      'Jerk',
      'Clean and Jerk',
      'Power Clean',
      'Power Jerk',
      'Power Clean and Jerk',
      'Power Clean and Power Jerk',
      'Snatch',
      'Power Snatch',
      'Clean Pull',
      'Snatch Pull',
      'Back Squat',
      'Front Squat',
    ]
      .map((n) => `'${n}'`)
      .join(', ');

    await queryRunner.query(
      `DELETE FROM "exercise" WHERE "name" IN (${names});`,
    );
  }
}
