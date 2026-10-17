import { accessTokenTtl, sessionDays } from './session-config';

describe('accessTokenTtl', () => {
  it('defaults to 15 minutes', () => {
    expect(accessTokenTtl(undefined)).toBe('15m');
    expect(accessTokenTtl('')).toBe('15m');
  });

  it('reads a bare number as seconds', () => {
    expect(accessTokenTtl('900')).toBe(900);
  });

  it('passes a duration through', () => {
    expect(accessTokenTtl('20s')).toBe('20s');
    expect(accessTokenTtl('1h')).toBe('1h');
  });

  it('rejects anything else at startup', () => {
    expect(() => accessTokenTtl('soon')).toThrow(/JWT_ACCESS_TTL/);
    expect(() => accessTokenTtl('0')).toThrow(/JWT_ACCESS_TTL/);
  });
});

describe('sessionDays', () => {
  it('uses the default when unset', () => {
    expect(sessionDays(undefined, 30, 'REFRESH_IDLE_DAYS')).toBe(30);
    expect(sessionDays('', 90, 'REFRESH_ABSOLUTE_DAYS')).toBe(90);
  });

  it('reads a positive number of days', () => {
    expect(sessionDays('7', 30, 'REFRESH_IDLE_DAYS')).toBe(7);
    expect(sessionDays('0.5', 30, 'REFRESH_IDLE_DAYS')).toBe(0.5);
  });

  it('rejects anything else at startup', () => {
    expect(() => sessionDays('0', 30, 'REFRESH_IDLE_DAYS')).toThrow(
      /REFRESH_IDLE_DAYS/,
    );
    expect(() => sessionDays('-1', 30, 'REFRESH_IDLE_DAYS')).toThrow(
      /REFRESH_IDLE_DAYS/,
    );
    expect(() => sessionDays('a week', 90, 'REFRESH_ABSOLUTE_DAYS')).toThrow(
      /REFRESH_ABSOLUTE_DAYS/,
    );
  });
});
