import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { EmailCodeService } from '../email-codes/email-code.service';
import { MailService } from '../mail/mail.service';
import { OLD_PUBLIC_JWT_SECRET, jwtSecret } from './jwt-secret';
import { JwtStrategy } from './jwt.strategy';
import { User } from './user.entity';

const config = (env: Record<string, string>) =>
  ({ get: (key: string) => env[key] }) as unknown as ConfigService;

describe('jwtSecret', () => {
  it('stops every environment without a secret', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      for (const JWT_SECRET of [undefined, '', '  ']) {
        const env = {
          ...(NODE_ENV && { NODE_ENV }),
          ...(JWT_SECRET !== undefined && { JWT_SECRET }),
        };
        expect(() => jwtSecret(config(env))).toThrow(
          'JWT_SECRET must be set (e.g. openssl rand -base64 48 in .env)',
        );
      }
    }
  });

  it('uses a set value as it is', () => {
    expect(jwtSecret(config({ JWT_SECRET: 'local-secret' }))).toBe(
      'local-secret',
    );
    expect(
      jwtSecret(
        config({ NODE_ENV: 'production', JWT_SECRET: 'prod-secret\n' }),
      ),
    ).toBe('prod-secret\n');
  });

  it('stops production with the old public value, without echoing it', () => {
    for (const JWT_SECRET of [
      OLD_PUBLIC_JWT_SECRET,
      ` ${OLD_PUBLIC_JWT_SECRET}\n`,
    ]) {
      expect(() =>
        jwtSecret(config({ NODE_ENV: 'production', JWT_SECRET })),
      ).toThrow(
        'JWT_SECRET must not be the old public default when NODE_ENV=production',
      );
    }
  });

  it('accepts the old public value outside production', () => {
    expect(
      jwtSecret(
        config({ NODE_ENV: 'development', JWT_SECRET: OLD_PUBLIC_JWT_SECRET }),
      ),
    ).toBe(OLD_PUBLIC_JWT_SECRET);
  });
});

describe('at startup without JWT_SECRET', () => {
  const unset = config({ NODE_ENV: 'development' });

  it('the token check throws', () => {
    expect(() => new JwtStrategy(unset, {} as Repository<User>)).toThrow(
      /JWT_SECRET/,
    );
  });

  it('the email code service throws', () => {
    expect(
      () => new EmailCodeService({} as DataSource, {} as MailService, unset),
    ).toThrow(/JWT_SECRET/);
  });
});
