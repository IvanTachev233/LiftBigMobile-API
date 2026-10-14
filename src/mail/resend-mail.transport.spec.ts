import { Logger } from '@nestjs/common';
import { ResendMailTransport } from './resend-mail.transport';

const KEY = 're_test_secret_key';
const FROM = 'LiftBig <codes@liftbig.app>';
const message = {
  to: 'lifter@example.com',
  subject: 'Your code',
  text: 'Code 123456',
  html: '<p>Code 123456</p>',
};

function respond(status: number, body: unknown) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function logged(spy: jest.SpyInstance): string {
  return JSON.stringify(spy.mock.calls);
}

describe('ResendMailTransport', () => {
  const transport = new ResendMailTransport(KEY, FROM);
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the mail to the Resend emails endpoint', async () => {
    const fetchMock = respond(200, { id: 'abc' });
    await transport.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: FROM,
      to: ['lifter@example.com'],
      subject: 'Your code',
      html: '<p>Code 123456</p>',
      text: 'Code 123456',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 403, 422, 429, 500, 503])(
    'fails on a %i response and logs the status without the key',
    async (status) => {
      respond(status, { name: 'error', message: 'Provider said no' });
      await expect(transport.send(message)).rejects.toThrow();
      const log = logged(errorLog);
      expect(log).toContain(String(status));
      expect(log).toContain('Provider said no');
      expect(log).not.toContain(KEY);
    },
  );

  it('fails when the request itself fails, without logging the key', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(transport.send(message)).rejects.toThrow();
    const log = logged(errorLog);
    expect(log).toContain('fetch failed');
    expect(log).not.toContain(KEY);
  });

  it('fails on an error response whose body is not JSON', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Bad gateway', { status: 502 }));
    await expect(transport.send(message)).rejects.toThrow();
    expect(logged(errorLog)).toContain('502');
  });
});
