import { Logger } from '@nestjs/common';
import { createMailTransport } from './mail-transport.factory';
import { InMemoryMailTransport } from './in-memory-mail.transport';
import { LogMailTransport } from './log-mail.transport';
import { ResendMailTransport } from './resend-mail.transport';

const env =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    values[name];

describe('createMailTransport', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses Resend when MAIL_PROVIDER_KEY is set', () => {
    const transport = createMailTransport(
      env({ MAIL_PROVIDER_KEY: 're_x', MAIL_FROM: 'LiftBig <a@b.c>' }),
    );
    expect(transport).toBeInstanceOf(ResendMailTransport);
  });

  it('writes mails to the log without a key', () => {
    expect(createMailTransport(env({}))).toBeInstanceOf(LogMailTransport);
    expect(
      createMailTransport(env({ MAIL_PROVIDER_KEY: '', MAIL_FROM: 'a@b.c' })),
    ).toBeInstanceOf(LogMailTransport);
  });

  it('refuses a key without MAIL_FROM', () => {
    expect(() =>
      createMailTransport(env({ MAIL_PROVIDER_KEY: 're_x' })),
    ).toThrow(/MAIL_FROM/);
  });

  it('the log transport logs the recipient, subject and text', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    await new LogMailTransport().send({
      to: 'a@example.com',
      subject: 'Hello',
      text: 'Code 123456',
      html: '<p>Code 123456</p>',
    });
    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain('a@example.com');
    expect(output).toContain('Hello');
    expect(output).toContain('Code 123456');
  });

  it('the in-memory transport keeps every mail in order', async () => {
    const transport = new InMemoryMailTransport();
    const mail = { to: 'a@example.com', subject: 's', text: 't', html: 'h' };
    await transport.send(mail);
    await transport.send({ ...mail, to: 'b@example.com' });
    expect(transport.sent.map((m) => m.to)).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
    expect(transport.lastTo('a@example.com')).toEqual(mail);
    transport.clear();
    expect(transport.sent).toEqual([]);
  });
});
