import { Module } from '@nestjs/common';
import { LiftRecordsService } from './lift-records.service';
import { LiftsController } from './lifts.controller';

@Module({
  controllers: [LiftsController],
  providers: [LiftRecordsService],
  exports: [LiftRecordsService],
})
export class LiftsModule {}
