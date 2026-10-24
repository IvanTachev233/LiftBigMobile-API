import { appConfigFromEnv } from './app-config';

describe('appConfigFromEnv', () => {
  it('has no minimum and no latest when unset', () => {
    expect(appConfigFromEnv({})).toEqual({
      minVersionCode: null,
      latestVersionCode: null,
    });
    expect(
      appConfigFromEnv({
        APP_MIN_VERSION_CODE: '',
        APP_LATEST_VERSION_CODE: '',
      }),
    ).toEqual({ minVersionCode: null, latestVersionCode: null });
  });

  it('reads positive whole version codes', () => {
    expect(
      appConfigFromEnv({
        APP_MIN_VERSION_CODE: '3',
        APP_LATEST_VERSION_CODE: ' 12 ',
      }),
    ).toEqual({ minVersionCode: 3, latestVersionCode: 12 });
  });

  it('rejects anything else, naming the variable', () => {
    for (const value of ['0', '-1', '2.5', 'three', '1e3']) {
      expect(() => appConfigFromEnv({ APP_MIN_VERSION_CODE: value })).toThrow(
        /APP_MIN_VERSION_CODE/,
      );
      expect(() =>
        appConfigFromEnv({ APP_LATEST_VERSION_CODE: value }),
      ).toThrow(/APP_LATEST_VERSION_CODE/);
    }
  });
});
