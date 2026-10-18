import { createHash, randomBytes } from 'node:crypto';
import { AuthSession } from './auth-session.entity';

// How long after a rotation the replaced token still works, for a client
// that never received the answer
export const REFRESH_GRACE_MS = 60_000;

// An opaque refresh token: 32 random bytes as base64url
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// What the database stores instead of the token. The token is random, so a
// plain SHA-256 can't be reversed.
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * What a refresh with this token hash does to the session it matched:
 * rotate (current token), retry (previous token within the grace), reuse
 * (previous token later; the session must be revoked) or ended (revoked or
 * expired).
 */
export function refreshOutcome(
  session: Pick<
    AuthSession,
    | 'tokenHash'
    | 'rotatedAt'
    | 'revokedAt'
    | 'idleExpiresAt'
    | 'absoluteExpiresAt'
  >,
  presentedHash: string,
  now: number,
): 'rotate' | 'retry' | 'reuse' | 'ended' {
  if (
    session.revokedAt ||
    session.idleExpiresAt.getTime() <= now ||
    session.absoluteExpiresAt.getTime() <= now
  ) {
    return 'ended';
  }
  if (session.tokenHash === presentedHash) return 'rotate';
  const rotatedAt = session.rotatedAt?.getTime() ?? -Infinity;
  return now - rotatedAt < REFRESH_GRACE_MS ? 'retry' : 'reuse';
}
