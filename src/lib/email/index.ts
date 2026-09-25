import 'server-only';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { emailProviderName } from './choose';

/**
 * Sending email, behind one small interface so membership code never knows who delivers it.
 *
 *   HYPHY_EMAIL=capture   Write each message to HYPHY_MAIL_DIR (default `.hyphy-mail/`) as .html
 *                         and .json instead of sending it: the development preview. The default
 *                         outside production.
 *   HYPHY_EMAIL=resend    Send through Resend (RESEND_API_KEY, HYPHY_EMAIL_FROM). Server only.
 *   unset in production   Nothing is sent; callers are told so (invitations can still be shared
 *                         by link from People).
 *
 * Message bodies can carry secrets (an invitation link): they're never logged.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** What kind of message, for the provider's analytics and the capture file name. */
  tag: 'invitation';
};

export type SendResult = { delivered: boolean; provider: string };

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

const capture: EmailProvider = {
  name: 'capture',
  async send(message) {
    const dir = path.resolve(process.env.HYPHY_MAIL_DIR || '.hyphy-mail');
    await mkdir(dir, { recursive: true });
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${message.tag}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    await writeFile(path.join(dir, `${stamp}.html`), message.html);
    await writeFile(path.join(dir, `${stamp}.json`), JSON.stringify(message, null, 2));
    return { delivered: true, provider: 'capture' };
  },
};

const resend: EmailProvider = {
  name: 'resend',
  async send(message) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.HYPHY_EMAIL_FROM;
    if (!key || !from) throw new Error('Resend needs RESEND_API_KEY and HYPHY_EMAIL_FROM.');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: 'kind', value: message.tag }],
      }),
    });
    if (!response.ok) throw new Error(`Email provider answered ${response.status}.`);
    return { delivered: true, provider: 'resend' };
  },
};

const none: EmailProvider = {
  name: 'none',
  async send() {
    return { delivered: false, provider: 'none' };
  },
};

export function emailProvider(): EmailProvider {
  return { capture, resend, none }[emailProviderName()];
}

/** Sends, and never lets a delivery problem undo the change that caused it. */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const provider = emailProvider();
  try {
    return await provider.send(message);
  } catch (error) {
    // The reason, never the message (it may hold a link).
    console.warn(
      `[email] ${provider.name} couldn’t send a ${message.tag}:`,
      (error as Error).message,
    );
    return { delivered: false, provider: provider.name };
  }
}
