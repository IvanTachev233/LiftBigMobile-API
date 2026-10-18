import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { User } from './user.entity';
import { Invite } from './invite.entity';
import { AuthSession } from './auth-session.entity';
import { AuthSessionService } from './auth-session.service';
import { accessTokenTtl } from './session-config';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { EmailCodesModule } from '../email-codes/email-codes.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Invite, AuthSession]),
    EmailCodesModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'super-secret-key',
        signOptions: {
          expiresIn: accessTokenTtl(
            configService.get<string>('JWT_ACCESS_TTL'),
          ),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthService, AuthSessionService, JwtStrategy, RolesGuard],
  controllers: [AuthController],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
