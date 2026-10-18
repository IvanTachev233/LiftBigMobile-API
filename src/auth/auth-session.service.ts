import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuthSession } from './auth-session.entity';
import {
  hashRefreshToken,
  newRefreshToken,
  refreshOutcome,
} from './refresh-token';
import {
  DEFAULT_REFRESH_ABSOLUTE_DAYS,
  DEFAULT_REFRESH_IDLE_DAYS,
  sessionDays,
} from './session-config';
import { User } from './user.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

// The user columns an access token is signed from
export type SignableUser = Pick<
  User,
  'id' | 'email' | 'name' | 'role' | 'coachId' | 'tokenVersion'
>;

type RotateOutcome =
  | { ended: true }
  | { user: SignableUser; refreshToken: string };

@Injectable()
export class AuthSessionService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService,
  ) {
    this.idleMs =
      sessionDays(
        config.get<string>('REFRESH_IDLE_DAYS'),
        DEFAULT_REFRESH_IDLE_DAYS,
        'REFRESH_IDLE_DAYS',
      ) * DAY_MS;
    this.absoluteMs =
      sessionDays(
        config.get<string>('REFRESH_ABSOLUTE_DAYS'),
        DEFAULT_REFRESH_ABSOLUTE_DAYS,
        'REFRESH_ABSOLUTE_DAYS',
      ) * DAY_MS;
  }

  /**
   * Starts a session for a device that just signed in and returns its
   * refresh token. The user's ended sessions go first: revoked, expired, or
   * from before a token version raise.
   */
  async start(user: Pick<User, 'id' | 'tokenVersion'>): Promise<string> {
    const now = new Date(Date.now());
    await this.dataSource
      .createQueryBuilder()
      .delete()
      .from(AuthSession)
      .where('"userId" = :userId', { userId: user.id })
      .andWhere(
        `("revokedAt" IS NOT NULL OR "idleExpiresAt" <= :now
          OR "absoluteExpiresAt" <= :now OR "tokenVersion" < :version)`,
        { now, version: user.tokenVersion },
      )
      .execute();

    const token = newRefreshToken();
    await this.dataSource.getRepository(AuthSession).insert({
      userId: user.id,
      tokenHash: hashRefreshToken(token),
      previousHash: null,
      rotatedAt: null,
      tokenVersion: user.tokenVersion,
      createdAt: now,
      lastUsedAt: now,
      idleExpiresAt: new Date(now.getTime() + this.idleMs),
      absoluteExpiresAt: new Date(now.getTime() + this.absoluteMs),
      revokedAt: null,
    });
    return token;
  }

  /**
   * Swaps the token for a new one and returns it with the current user row.
   * The token the session replaced last still works for 60 s after that
   * rotation (the client may have lost the answer); after that it revokes
   * the session. Unknown, revoked and expired tokens, a raised token version
   * and a deleted user are a 401.
   */
  async refresh(
    token: string,
  ): Promise<{ user: SignableUser; refreshToken: string }> {
    const hash = hashRefreshToken(token);
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<RotateOutcome> => {
        // Serialises refreshes of one session, so a token rotates once
        const session = await manager.findOne(AuthSession, {
          where: [{ tokenHash: hash }, { previousHash: hash }],
          lock: { mode: 'pessimistic_write' },
        });
        if (!session) return { ended: true };

        const now = Date.now();
        const decision = refreshOutcome(session, hash, now);
        if (decision === 'reuse') {
          // Returned rather than thrown, so the revocation commits
          await manager.update(AuthSession, session.id, {
            revokedAt: new Date(now),
          });
          return { ended: true };
        }
        if (decision === 'ended') return { ended: true };

        const user = await manager.findOne(User, {
          where: { id: session.userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            coachId: true,
            tokenVersion: true,
          },
        });
        if (!user || user.tokenVersion !== session.tokenVersion) {
          return { ended: true };
        }

        const refreshToken = newRefreshToken();
        await manager.update(AuthSession, session.id, {
          tokenHash: hashRefreshToken(refreshToken),
          previousHash: hash,
          // A retry keeps the first rotation's time, so the grace never grows
          rotatedAt: decision === 'rotate' ? new Date(now) : session.rotatedAt,
          lastUsedAt: new Date(now),
          idleExpiresAt: new Date(now + this.idleMs),
        });
        return { user, refreshToken };
      },
    );

    if ('ended' in outcome) throw new UnauthorizedException();
    return outcome;
  }

  // Ends the session holding this token (current or previous), if any
  async revoke(token: string): Promise<void> {
    const hash = hashRefreshToken(token);
    await this.dataSource
      .createQueryBuilder()
      .update(AuthSession)
      .set({ revokedAt: new Date(Date.now()) })
      .where('("tokenHash" = :hash OR "previousHash" = :hash)', { hash })
      .andWhere('"revokedAt" IS NULL')
      .execute();
  }
}
