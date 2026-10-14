import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { AuthService } from '../auth/auth.service';
import {
  MAX_PASSWORD_ATTEMPTS,
  PASSWORD_LOCK_MINUTES,
} from '../common/password-limits';
import { User } from '../auth/user.entity';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly auth: AuthService,
  ) {}

  async me(user: AuthUser) {
    const { id, email, name, role, weightUnit, restSeconds } =
      await this.users.findOneByOrFail({ id: user.id });
    return { id, email, name, role, weightUnit, restSeconds };
  }

  /** Saves the fields sent; a body with none of them is rejected */
  async updateMe(user: AuthUser, dto: UpdateMeDto) {
    const changes: Partial<Pick<User, 'name' | 'weightUnit' | 'restSeconds'>> =
      {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.weightUnit !== undefined) changes.weightUnit = dto.weightUnit;
    if (dto.restSeconds !== undefined) changes.restSeconds = dto.restSeconds;
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Send name, weightUnit or restSeconds');
    }
    await this.users.update({ id: user.id }, changes);
    return this.me(user);
  }

  /**
   * Replaces the password when the current one matches and returns a new
   * token; every earlier token stops working. Three wrong current passwords
   * lock this for 15 minutes (429); a wrong one before that is a 403.
   */
  async changePassword(
    user: AuthUser,
    dto: ChangePasswordDto,
  ): Promise<{ access_token: string }> {
    const outcome = await this.users.manager.transaction(async (manager) => {
      const row = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .addSelect([
          'user.passwordHash',
          'user.tokenVersion',
          'user.failedPasswordAttempts',
          'user.passwordLockedUntil',
        ])
        .where('user.id = :id', { id: user.id })
        .setLock('pessimistic_write')
        .getOneOrFail();
      const now = Date.now();
      const lockedUntil = row.passwordLockedUntil?.getTime() ?? 0;
      if (lockedUntil > now) {
        return { locked: Math.ceil((lockedUntil - now) / 60000) } as const;
      }
      // A lock that ran out starts a fresh count
      const failed = lockedUntil ? 0 : row.failedPasswordAttempts;

      if (!(await bcrypt.compare(dto.currentPassword, row.passwordHash))) {
        const attempts = failed + 1;
        if (attempts >= MAX_PASSWORD_ATTEMPTS) {
          await manager.update(User, user.id, {
            failedPasswordAttempts: 0,
            passwordLockedUntil: new Date(now + PASSWORD_LOCK_MINUTES * 60000),
          });
          return { locked: PASSWORD_LOCK_MINUTES } as const;
        }
        await manager.update(User, user.id, {
          failedPasswordAttempts: attempts,
          passwordLockedUntil: null,
        });
        return { attemptsLeft: MAX_PASSWORD_ATTEMPTS - attempts } as const;
      }

      const salt = await bcrypt.genSalt();
      const tokenVersion = row.tokenVersion + 1;
      await manager.update(User, user.id, {
        passwordHash: await bcrypt.hash(dto.newPassword, salt),
        tokenVersion,
        failedPasswordAttempts: 0,
        passwordLockedUntil: null,
      });
      return { user: { ...row, tokenVersion } } as const;
    });

    if ('locked' in outcome) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Too many wrong passwords. Try again in ${outcome.locked} min.`,
          retryAfterMinutes: outcome.locked,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if ('attemptsLeft' in outcome) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'Current password is incorrect',
        attemptsLeft: outcome.attemptsLeft,
      });
    }
    return { access_token: this.auth.signToken(outcome.user) };
  }
}
