import { Module } from '@nestjs/common';
import { ProgramsModule } from '../programs/programs.module';
import { LiftsModule } from './lifts.module';
import { PbBackfill } from './pb-backfill';

// Bootstrap hooks run deepest module first, so importing ProgramsModule
// makes the backfill run after the seeder has marked the lifts
// max-trackable.
@Module({
  imports: [LiftsModule, ProgramsModule],
  providers: [PbBackfill],
})
export class PbBackfillModule {}
