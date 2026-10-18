import type { JwtSignOptions } from '@nestjs/jwt';

export const DEFAULT_ACCESS_TTL = '15m';
export const DEFAULT_REFRESH_IDLE_DAYS = 30;
export const DEFAULT_REFRESH_ABSOLUTE_DAYS = 90;

/**
 * The access token lifetime from JWT_ACCESS_TTL: a duration such as "15m" or
 * "20s", or a bare number of seconds (jsonwebtoken would read a bare number
 * string as milliseconds). A value it can't read stops the API at startup.
 */
export function accessTokenTtl(
  value: string | undefined,
): NonNullable<JwtSignOptions['expiresIn']> {
  if (!value) return DEFAULT_ACCESS_TTL;
  if (/^\d+$/.test(value) && Number(value) > 0) return Number(value);
  if (/^\d+(\.\d+)?(ms|s|m|h|d|w|y)$/.test(value) && parseFloat(value) > 0) {
    return value as NonNullable<JwtSignOptions['expiresIn']>;
  }
  throw new Error(
    `JWT_ACCESS_TTL must be seconds or a duration like 15m, not "${value}"`,
  );
}

// A positive number of days from an env variable, or the default when unset
export function sessionDays(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) return fallback;
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(
      `${name} must be a positive number of days, not "${value}"`,
    );
  }
  return days;
}
