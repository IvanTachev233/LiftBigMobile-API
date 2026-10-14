import { Logger } from '@nestjs/common';
import { MailtrapMailTransport } from './mailtrap-mail.transport';

const TOKEN = 'mailtrap_test_secret_token';
const INBOX = '1234567';
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

describe('MailtrapMailTransport', () => {
  const transport = new MailtrapMailTransport(
    TOKEN,
    INBOX,
    'LiftBig <codes@liftbig.test>',
  );
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the mail to the sandbox inbox', async () => {
    const fetchMock = respond(200, { success: true, message_ids: ['1'] });
    await transport.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.mailtrap.io/api/send/1234567');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'liftbig-api',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: { email: 'codes@liftbig.test', name: 'LiftBig' },
      to: [{ email: 'lifter@example.com' }],
      subject: 'Your code',
      text: 'Code 123456',
      html: '<p>Code 123456</p>',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts a bare sender address', async () => {
    const fetchMock = respond(200, { success: true });
    await new MailtrapMailTransport(TOKEN, INBOX, 'codes@liftbig.test').send(
      message,
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { from: unknown };
    expect(body.from).toEqual({
      email: 'codes@liftbig.test',
    });
  });

  it.each([400, 401, 403, 429, 500])(
    'fails on a %i response and logs the status without the token',
    async (status) => {
      respond(status, { success: false, errors: ['Inbox said no'] });
      await expect(transport.send(message)).rejects.toThrow();
      const log = logged(errorLog);
      expect(log).toContain(String(status));
      expect(log).toContain('Inbox said no');
      expect(log).not.toContain(TOKEN);
    },
  );

  it('fails when the request itself fails, without logging the token', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new TypeError('fetch failed'));
    await expect(transport.send(message)).rejects.toThrow();
    const log = logged(errorLog);
    expect(log).toContain('fetch failed');
    expect(log).not.toContain(TOKEN);
  });
});
