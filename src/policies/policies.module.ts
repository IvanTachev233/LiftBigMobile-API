import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentEvent } from './consent-event.entity';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { PolicyAcceptance } from './policy-acceptance.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PolicyAcceptance, ConsentEvent])],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
