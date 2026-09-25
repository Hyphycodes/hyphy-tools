import type { Space } from '@/lib/platform/types';
import { roles } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';
import type { EmailMessage } from './index';

/**
 * "Join ABC Construction": the invitation email. Calm and specific — who, where, which role, one
 * button — in the product's type and colors, with a plain-text twin. Every value is escaped.
 */
export type InvitationEmail = {
  to: string;
  spaceName: string;
  brand: Space['brand'];
  inviterName: string;
  role: Role;
  note?: string;
  link: string;
  expiresAt: string;
};

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export function invitationEmail(input: InvitationEmail): EmailMessage {
  const role = roles[input.role];
  const days = Math.max(
    1,
    Math.round((new Date(input.expiresAt).getTime() - Date.now()) / 86_400_000),
  );
  const first = input.inviterName.trim().split(/\s+/)[0] || 'Someone';
  const subject = `${first} invited you to ${input.spaceName} on Hyphy`;
  const e = {
    space: escape(input.spaceName),
    inviter: escape(input.inviterName || 'Someone'),
    role: escape(role.label),
    summary: escape(role.summary),
    note: input.note ? escape(input.note) : '',
    link: escape(input.link),
    to: escape(input.to),
    mark: escape(input.brand.monogram.slice(0, 2)),
    color: /^#[0-9a-f]{6}$/i.test(input.brand.color) ? input.brand.color : '#3240FF',
    ink: input.brand.ink === 'dark' ? '#16150F' : '#FFFFFF',
  };
  const font =
    "font-family:'Mona Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f1eb;${font};color:#16150f">
<div style="display:none;max-height:0;overflow:hidden">Join ${e.space} as ${e.role}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1eb">
<tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px">
<tr><td style="padding:0 4px 20px;font-size:14px;font-weight:700;letter-spacing:-0.01em">
<span style="display:inline-block;width:22px;height:22px;border-radius:7px;background:#16150f;color:#fff;text-align:center;line-height:22px;font-size:12px;vertical-align:middle">&#10035;</span>
<span style="vertical-align:middle;margin-left:6px">Hyphy Tools</span></td></tr>
<tr><td style="background:#ffffff;border-radius:20px;padding:32px 28px;box-shadow:0 0 0 1px rgba(22,21,15,0.06)">
<div style="width:48px;height:48px;border-radius:14px;background:${e.color};color:${e.ink};font-size:18px;font-weight:700;line-height:48px;text-align:center">${e.mark}</div>
<h1 style="margin:22px 0 8px;font-size:26px;line-height:1.15;letter-spacing:-0.02em;font-weight:750">Join ${e.space}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3d3b34">${e.inviter} invited you to work together in <b>${e.space}</b> on Hyphy Tools.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f3;border-radius:12px;margin:0 0 ${e.note ? '14px' : '24px'}">
<tr><td style="padding:14px 16px;font-size:14px;line-height:1.5">
<span style="font-family:ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;color:#6c685e">Your role</span><br>
<b>${e.role}</b> &middot; <span style="color:#6c685e">${e.summary}</span></td></tr></table>
${e.note ? `<p style="margin:0 0 24px;padding:0 0 0 12px;border-left:3px solid #e8e4da;font-size:14px;line-height:1.55;color:#3d3b34">&ldquo;${e.note}&rdquo;</p>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#16150f">
<a href="${e.link}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">Join ${e.space}</a>
</td></tr></table>
<p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#6c685e">This invitation is for <b style="color:#3d3b34">${e.to}</b> and works for ${days} ${days === 1 ? 'day' : 'days'}. Sign in or create your Hyphy account with this address to accept.</p>
</td></tr>
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.5;color:#a19c91">If you weren’t expecting this, you can ignore it — nothing happens unless you accept.<br>
Button not working? Paste this into your browser:<br><span style="word-break:break-all;color:#6c685e">${e.link}</span></td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `Join ${input.spaceName}`,
    '',
    `${input.inviterName || 'Someone'} invited you to ${input.spaceName} on Hyphy Tools.`,
    `Your role: ${role.label} — ${role.summary}`,
    input.note ? `\n“${input.note}”\n` : '',
    `Accept: ${input.link}`,
    '',
    `This invitation is for ${input.to} and works for ${days} ${days === 1 ? 'day' : 'days'}.`,
    'If you weren’t expecting it, ignore it — nothing happens unless you accept.',
  ].join('\n');
  return { to: input.to, subject, html, text, tag: 'invitation' };
}
