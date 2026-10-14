import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PublicPagesController } from './public-pages.controller';

@Module({
  imports: [UsersModule],
  controllers: [PublicPagesController],
})
export class PublicPagesModule {}
