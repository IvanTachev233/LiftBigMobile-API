import type { ConfigService } from '@nestjs/config';

// A publicly known value; production refuses it
export const OLD_PUBLIC_JWT_SECRET = 'super-secret-key';

/**
 * The secret that signs access tokens and email codes, from JWT_SECRET; the
 * only place that reads it. Missing or blank stops the API at startup in
 * every environment, and so does the old public value with
 * NODE_ENV=production. A set value is used exactly as given.
 */
export function jwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  const trimmed = secret?.trim();
  if (!secret || !trimmed) {
    throw new Error(
      'JWT_SECRET must be set (e.g. openssl rand -base64 48 in .env)',
    );
  }
  if (
    trimmed === OLD_PUBLIC_JWT_SECRET &&
    config.get<string>('NODE_ENV') === 'production'
  ) {
    throw new Error(
      'JWT_SECRET must not be the old public default when NODE_ENV=production',
    );
  }
  return secret;
}
