import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { WorkoutsModule } from './workouts/workouts.module';
import { ProgramsModule } from './programs/programs.module';
import { LiftsModule } from './lifts/lifts.module';
import { PbBackfillModule } from './lifts/pb-backfill.module';
import { UsersModule } from './users/users.module';
import { PublicPagesModule } from './public-pages/public-pages.module';
import { AppConfigModule } from './app-config/app-config.module';
import { PoliciesModule } from './policies/policies.module';
import { databaseConfig } from './config/database.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRoot(databaseConfig),
    AuthModule,
    WorkoutsModule,
    ProgramsModule,
    LiftsModule,
    PbBackfillModule,
    UsersModule,
    PublicPagesModule,
    AppConfigModule,
    PoliciesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
