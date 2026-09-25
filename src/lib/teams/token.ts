import 'server-only';
import { randomBytes } from 'node:crypto';
import { appUrl } from '@/lib/site';

/**
 * An invitation link's secret: 32 random bytes, base64url. Only its SHA-256 is stored; the secret
 * exists in the email (and in a link the inviter chooses to copy). It locates an invitation — it
 * never proves who you are: accepting also needs the confirmed invited email.
 */
export function newInviteToken() {
  return randomBytes(32).toString('base64url');
}

export const INVITE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export function inviteUrl(token: string) {
  return appUrl(`/invite/${token}`);
}
