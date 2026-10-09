import { Module } from '@nestjs/common';
import { LiftsModule } from '../lifts/lifts.module';
import { CatalogController } from './catalog.controller';
import { EnrollmentService } from './enrollment.service';
import { ProgramEnrollmentsController } from './program-enrollments.controller';
import { ProgramAuthoringPolicy } from './program-authoring.policy';
import { ProgramCatalogService } from './program-catalog.service';
import { ProgramSeeder } from './program-seeder';
import { ProgramService } from './program.service';

@Module({
  imports: [LiftsModule],
  controllers: [CatalogController, ProgramEnrollmentsController],
  providers: [
    ProgramService,
    ProgramAuthoringPolicy,
    ProgramSeeder,
    ProgramCatalogService,
    EnrollmentService,
  ],
  exports: [ProgramService],
})
export class ProgramsModule {}
