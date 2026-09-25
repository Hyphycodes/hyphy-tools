import { formatRelativeInline, plural } from '@/lib/platform/format';
import type { Invitation } from './types';

/** "Sent yesterday · link works 6 more days": an invitation's state, for People. */
export function describeInvitation(invitation: Invitation, timezone: string, now = Date.now()) {
  const days = Math.ceil((new Date(invitation.expiresAt).getTime() - now) / 86_400_000);
  return `Sent ${formatRelativeInline(invitation.sentAt, timezone, now)} · ${
    days > 0 ? `link works ${plural(days, 'more day')}` : 'link expired'
  }`;
}
