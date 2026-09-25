import 'server-only';
import { asPerson, db } from '@/lib/data/supabase/db';
import { translate } from '@/lib/data/supabase/source';
import { identityMode } from '@/lib/identity/mode';
import type { Role } from '@/lib/platform/types';
import { INVITE_TOKEN } from './token';
import type { AcceptOutcome, InvitationPreview } from './types';

/**
 * What an invitation link shows. Anyone holding the link may see it — before they sign in, that's
 * how they learn who invited them and with which address — so the lookup is by the link's secret
 * alone, through the one database function the app's own role may call for it. Null for a link
 * that doesn't exist (or when real accounts are off).
 */
export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  if (identityMode() !== 'supabase' || !INVITE_TOKEN.test(token)) return null;
  const [row] = await db()`select * from private.invitation_preview(${token})`.catch(translate);
  if (!row) return null;
  return {
    id: String(row.invitation_id),
    spaceId: String(row.space_id),
    spaceName: String(row.space_name),
    brand: (row.space_brand as InvitationPreview['brand']) ?? {
      color: '#3240FF',
      ink: 'light',
      monogram: 'H',
    },
    email: String(row.email),
    role: row.role as Role,
    title: String(row.title ?? ''),
    note: row.note ? String(row.note) : undefined,
    inviterName: String(row.inviter_name ?? ''),
    status: row.status as InvitationPreview['status'],
    expiresAt: new Date(row.expires_at as string).toISOString(),
  };
}

/**
 * Accepting, as the verified person. The database checks the link, its state, and that this
 * person's confirmed Supabase Auth email is the invited one; then makes the membership, once.
 */
export async function acceptInvitation(
  personId: string,
  token: string,
): Promise<{ outcome: AcceptOutcome; slug?: string }> {
  if (!INVITE_TOKEN.test(token)) return { outcome: 'invalid' };
  const [row] = await asPerson(
    personId,
    (tx) => tx`select * from public.accept_invitation(${token})`,
  ).catch(translate);
  return {
    outcome: String(row?.outcome ?? 'invalid') as AcceptOutcome,
    slug: row?.space_slug ? String(row.space_slug) : undefined,
  };
}
