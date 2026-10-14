import { MailMessage } from '../mail/mail.service';
import { EmailCodePurpose } from './email-code.entity';

const SUBJECTS: Record<EmailCodePurpose, string> = {
  [EmailCodePurpose.VERIFY_EMAIL]: 'Your LiftBig verification code',
  [EmailCodePurpose.RESET_PASSWORD]: 'Your LiftBig password reset code',
};

const INTROS: Record<EmailCodePurpose, string> = {
  [EmailCodePurpose.VERIFY_EMAIL]: 'Your code to confirm your email is',
  [EmailCodePurpose.RESET_PASSWORD]: 'Your code to reset your password is',
};

const IGNORE = "If this wasn't you, ignore this email.";

// Plain text plus simple HTML, without links or images
export function emailCodeMail(
  to: string,
  purpose: EmailCodePurpose,
  code: string,
  validMinutes: number,
): MailMessage {
  const expiry = `It expires in ${validMinutes} minutes.`;
  return {
    to,
    subject: SUBJECTS[purpose],
    text: `${INTROS[purpose]} ${code}.\n\n${expiry}\n\n${IGNORE}\n`,
    html: [
      '<!doctype html><html><body style="font-family: sans-serif; color: #111;">',
      `<p>${INTROS[purpose]}</p>`,
      `<p style="font-size: 28px; font-weight: bold; letter-spacing: 6px;">${code}</p>`,
      `<p>${expiry}</p>`,
      `<p style="color: #666;">${IGNORE}</p>`,
      '</body></html>',
    ].join(''),
  };
}
