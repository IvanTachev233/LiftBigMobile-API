import { createHash } from 'node:crypto';
import {
  REFRESH_GRACE_MS,
  hashRefreshToken,
  newRefreshToken,
  refreshOutcome,
} from './refresh-token';

describe('newRefreshToken', () => {
  it('is 32 random bytes as base64url', () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(newRefreshToken()).not.toBe(token);
  });
});

describe('hashRefreshToken', () => {
  it('is the SHA-256 hex of the token', () => {
    const token = newRefreshToken();
    expect(hashRefreshToken(token)).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
  });
});

describe('refreshOutcome', () => {
  const now = Date.UTC(2026, 9, 17, 12, 0, 0);
  const session = (changes: object = {}) => ({
    tokenHash: 'current',
    previousHash: 'previous',
    rotatedAt: new Date(now - 10_000),
    revokedAt: null,
    idleExpiresAt: new Date(now + 1000),
    absoluteExpiresAt: new Date(now + 1000),
    ...changes,
  });

  it('rotates the current token', () => {
    expect(refreshOutcome(session(), 'current', now)).toBe('rotate');
  });

  it('rotates the previous token again within the grace after its rotation', () => {
    const rotatedAt = new Date(now - REFRESH_GRACE_MS + 1);
    expect(refreshOutcome(session({ rotatedAt }), 'previous', now)).toBe(
      'retry',
    );
  });

  it('counts the previous token as reuse once the grace is over', () => {
    const rotatedAt = new Date(now - REFRESH_GRACE_MS);
    expect(refreshOutcome(session({ rotatedAt }), 'previous', now)).toBe(
      'reuse',
    );
  });

  it('ends a revoked session for either token', () => {
    const revoked = session({ revokedAt: new Date(now - 1) });
    expect(refreshOutcome(revoked, 'current', now)).toBe('ended');
    expect(refreshOutcome(revoked, 'previous', now)).toBe('ended');
  });

  it('ends a session at its idle expiry', () => {
    const idle = session({ idleExpiresAt: new Date(now) });
    expect(refreshOutcome(idle, 'current', now)).toBe('ended');
  });

  it('ends a session at its absolute expiry', () => {
    const old = session({ absoluteExpiresAt: new Date(now) });
    expect(refreshOutcome(old, 'current', now)).toBe('ended');
  });
});
