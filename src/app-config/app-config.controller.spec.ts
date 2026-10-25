import { AppConfigController } from './app-config.controller';

describe('AppConfigController', () => {
  const saved = process.env.APP_MIN_VERSION_CODE;

  afterEach(() => {
    if (saved === undefined) delete process.env.APP_MIN_VERSION_CODE;
    else process.env.APP_MIN_VERSION_CODE = saved;
  });

  it('stops the API at startup on a value it cannot read', () => {
    process.env.APP_MIN_VERSION_CODE = 'three';

    expect(() => new AppConfigController()).toThrow(/APP_MIN_VERSION_CODE/);
  });

  it('answers with the current env on each request', () => {
    delete process.env.APP_MIN_VERSION_CODE;
    const controller = new AppConfigController();

    process.env.APP_MIN_VERSION_CODE = '7';

    expect(controller.appConfig().minVersionCode).toBe(7);
  });
});
