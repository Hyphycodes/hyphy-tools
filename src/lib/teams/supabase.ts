import 'server-only';
import { invitationEmail } from '@/lib/email/invitation';
import { sendEmail } from '@/lib/email';
import { asPerson, readAsPerson, uuidLiteral, type Tx } from '@/lib/data/supabase/db';
import { translate } from '@/lib/data/supabase/source';
import type { Workspace } from '@/lib/identity/types';
import type { Role } from '@/lib/platform/types';
import { inviteUrl, newInviteToken } from './token';
import type { Invitation, Team } from './types';

type Row = Record<string, unknown>;

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : '');

export function invitationFrom(row: Row): Invitation {
  const expiresAt = iso(row.expires_at);
  const status = String(row.status) as Invitation['status'];
  return {
    id: String(row.id),
    spaceId: String(row.space_id),
    email: String(row.email),
    name: String(row.name ?? ''),
    role: row.role as Role,
    title: String(row.title ?? ''),
    projectIds: (row.project_ids as string[] | null) ?? [],
    note: row.note ? String(row.note) : undefined,
    status: status === 'pending' && new Date(expiresAt).getTime() < Date.now() ? 'expired' : status,
    invitedBy: String(row.invited_by),
    createdAt: iso(row.created_at),
    sentAt: iso(row.sent_at),
    expiresAt,
  };
}

// Every column but the link's hash, which nobody reads.
const COLUMNS = `id, space_id, email, name, role, title, project_ids, note, status, invited_by,
                 created_at, sent_at, send_count, expires_at, accepted_at, accepted_by, revoked_at`;

/**
 * A real Business's team, run as the signed-in person: every call is one of the checked database
 * functions (create_invitation, set_member_role, …), so the database — not this file — decides
 * who may do what. Emails go through `lib/email`; a failed email never undoes the invitation.
 */
export function supabaseTeam(workspace: Workspace): Team {
  const { space, person } = workspace;
  const me = person.id;
  const run = <T>(work: (tx: Tx) => Promise<T>) => asPerson(me, work).catch(translate);

  async function one(tx: Tx, id: string) {
    const [row] = await tx.unsafe(`select ${COLUMNS} from space_invitations where id = $1`, [id]);
    if (!row) throw translate({ code: '42501', message: 'row-level security' });
    return invitationFrom(row);
  }

  async function email(invitation: Invitation, token: string) {
    const message = invitationEmail({
      to: invitation.email,
      spaceName: space.name,
      brand: space.brand,
      inviterName: person.name,
      role: invitation.role,
      note: invitation.note,
      link: await inviteUrl(token),
      expiresAt: invitation.expiresAt,
    });
    return (await sendEmail(message)).delivered;
  }

  return {
    real: true,
    async invitations() {
      const rows = await readAsPerson(
        me,
        `select ${COLUMNS} from space_invitations
         where space_id = ${uuidLiteral(space.id)} and status = 'pending'
         order by created_at desc`,
      ).catch(translate);
      return rows.map(invitationFrom);
    },
    async invite(input) {
      const token = newInviteToken();
      const invitation = await run(async (tx) => {
        const [row] = await tx`
          select public.create_invitation(${space.id}, ${input.email}, ${input.role},
            ${input.name ?? ''}, ${input.title ?? ''}, ${input.projectIds ?? []}::uuid[],
            ${input.note ?? null}, ${token}) as id`;
        return one(tx, String(row.id));
      });
      return { invitation, emailed: await email(invitation, token) };
    },
    async resend(invitationId) {
      const token = newInviteToken();
      const invitation = await run(async (tx) => {
        await tx`select public.renew_invitation(${invitationId}, ${token}, true)`;
        return one(tx, invitationId);
      });
      return { emailed: await email(invitation, token) };
    },
    async shareLink(invitationId) {
      const token = newInviteToken();
      await run((tx) => tx`select public.renew_invitation(${invitationId}, ${token}, false)`);
      return inviteUrl(token);
    },
    async revoke(invitationId) {
      await run((tx) => tx`select public.revoke_invitation(${invitationId})`);
    },
    async setInvitationRole(invitationId, role, projectIds) {
      await run(
        (tx) =>
          tx`select public.set_invitation_role(${invitationId}, ${role}, ${projectIds ?? null}::uuid[])`,
      );
    },
    async setMemberRole(personId, role) {
      await run((tx) => tx`select public.set_member_role(${space.id}, ${personId}, ${role})`);
    },
    async removeMember(personId) {
      await run((tx) => tx`select public.remove_member(${space.id}, ${personId})`);
    },
    async leave() {
      await run((tx) => tx`select public.leave_space(${space.id})`);
    },
    async transferOwnership(personId) {
      await run((tx) => tx`select public.transfer_ownership(${space.id}, ${personId})`);
    },
  };
}
