'use client';
import { useState } from 'react';
import {
  resendInvitation,
  revokeInvitation,
  setInvitationRole,
  shareInvitationLink,
} from '@/app/(app)/[space]/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { menuItemClass, Popover } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/sheet';
import { roles } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';
import type { Invitation } from '@/lib/teams/types';
import { useTeamAction } from './use-team-action';

/**
 * Open invitations, in People: who was asked, as what, and whether the link still works.
 * Resend (a new link, emailed), copy a new link, change the role before they accept, or revoke.
 * The email itself never changes — revoke and invite again.
 */
export function InvitationList({
  slug,
  invitations,
  grantable,
  when,
}: {
  slug: string;
  invitations: Invitation[];
  grantable: Role[];
  /** "Sent 2 days ago" etc., formatted on the server. */
  when: Record<string, string>;
}) {
  return (
    <ul className="row-divide">
      {invitations.map((invitation) => (
        <InvitationRow
          key={invitation.id}
          slug={slug}
          invitation={invitation}
          grantable={grantable}
          when={when[invitation.id]}
        />
      ))}
    </ul>
  );
}

function InvitationRow({
  slug,
  invitation,
  grantable,
  when,
}: {
  slug: string;
  invitation: Invitation;
  grantable: Role[];
  when?: string;
}) {
  const { pending, run } = useTeamAction();
  const [revoking, setRevoking] = useState(false);
  const expired = invitation.status === 'expired';
  const copy = () =>
    run(
      () => shareInvitationLink(slug, invitation.id),
      (result) => {
        if (result.link) void navigator.clipboard?.writeText(result.link).catch(() => {});
      },
    );
  return (
    <li
      className={cn('flex items-center gap-3 px-4 py-3', pending && 'opacity-60')}
      data-invitation={invitation.email}
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-well text-muted shadow-[inset_0_0_0_1px_var(--color-line)]"
      >
        <Icon name="mail" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">
          {invitation.name || invitation.email}
        </span>
        <span className="block truncate text-[12.5px] text-muted">
          {invitation.name ? `${invitation.email} · ` : ''}
          {expired ? 'Link expired' : when}
        </span>
      </span>
      <Badge tone={expired ? 'caution' : 'outline'}>
        {expired ? 'Expired' : roles[invitation.role].label}
      </Badge>
      <Popover
        title={invitation.email}
        align="end"
        width={260}
        trigger={({ toggle, ...aria }) => (
          <button
            type="button"
            onClick={toggle}
            {...aria}
            disabled={pending}
            aria-label={`Manage the invitation for ${invitation.email}`}
            className="grid size-9 shrink-0 place-items-center rounded-[9px] text-muted hover:bg-ink/5 hover:text-ink"
          >
            <Icon name="more" size={17} />
          </button>
        )}
      >
        {(close) => (
          <div className="grid gap-0.5">
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                close();
                run(() => resendInvitation(slug, invitation.id));
              }}
            >
              <Icon name="refresh" size={16} className="text-muted" />
              {expired ? 'Renew and resend' : 'Resend'}
            </button>
            <button
              type="button"
              className={menuItemClass}
              onClick={() => {
                close();
                copy();
              }}
            >
              <Icon name="copy" size={16} className="text-muted" /> Copy a new link
            </button>
            {grantable.length > 0 && (
              <>
                <p className="label px-3 pt-2 pb-1 lg:px-2.5">Join as</p>
                {grantable.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={menuItemClass}
                    aria-pressed={invitation.role === role}
                    onClick={() => {
                      close();
                      if (role !== invitation.role)
                        run(() => setInvitationRole(slug, invitation.id, role));
                    }}
                  >
                    <span className="flex-1">{roles[role].label}</span>
                    {invitation.role === role && (
                      <Icon name="check" size={15} className="text-signal" />
                    )}
                  </button>
                ))}
              </>
            )}
            <div className="mt-1 border-t border-line pt-1">
              <button
                type="button"
                className={cn(menuItemClass, 'text-critical')}
                onClick={() => {
                  close();
                  setRevoking(true);
                }}
              >
                <Icon name="x" size={16} /> Revoke invitation
              </button>
            </div>
          </div>
        )}
      </Popover>
      <Sheet
        open={revoking}
        onClose={() => setRevoking(false)}
        title="Revoke this invitation?"
        description={`The link sent to ${invitation.email} stops working. You can invite them again later.`}
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRevoking(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () => revokeInvitation(slug, invitation.id),
                  () => setRevoking(false),
                )
              }
            >
              Revoke invitation
            </Button>
          </div>
        }
      >
        <span />
      </Sheet>
    </li>
  );
}
