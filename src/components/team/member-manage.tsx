'use client';
import { useState } from 'react';
import {
  leaveSpace,
  removeMember,
  setMemberRole,
  transferOwnership,
} from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Sheet } from '@/components/ui/sheet';
import { roles } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';
import { useTeamAction } from './use-team-action';

/**
 * Role & access, on a person's page, for the people who manage the team. Change the role, remove
 * them from the business, or — for the owner — hand the business over. Every step is checked by
 * the database; this only offers what the viewer may do.
 */
export function MemberManage({
  slug,
  spaceName,
  personId,
  firstName,
  role,
  grantable,
  canManage,
  canTransfer,
}: {
  slug: string;
  spaceName: string;
  personId: string;
  firstName: string;
  role: Role;
  grantable: Role[];
  canManage: boolean;
  canTransfer: boolean;
}) {
  const { pending, run } = useTeamAction();
  const [removing, setRemoving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const options = Array.from(new Set<Role>([role, ...grantable]));

  return (
    <Panel className="mb-5">
      <PanelHeader title="Role & access" />
      <div className="grid gap-4 px-4 pb-4">
        {canManage && (
          <div
            role="radiogroup"
            aria-label={`${firstName}’s role`}
            className="grid gap-2 sm:grid-cols-2"
          >
            {options.map((option) => {
              const selected = option === role;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={pending}
                  onClick={() => !selected && run(() => setMemberRole(slug, personId, option))}
                  className={cn(
                    'flex gap-3 rounded-[14px] px-3.5 py-3 text-left transition-all',
                    selected
                      ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                      : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
                      selected ? 'border-signal bg-signal' : 'border-line-strong',
                    )}
                  >
                    {selected && <span className="size-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold text-ink">
                      {roles[option].label}
                    </span>
                    <span className="block text-[13px] leading-snug text-muted">
                      {roles[option].summary}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {canTransfer && (
            <Button onClick={() => setTransferring(true)} disabled={pending}>
              <Icon name="key" size={15} /> Transfer ownership
            </Button>
          )}
          {canManage && (
            <Button variant="danger" onClick={() => setRemoving(true)} disabled={pending}>
              Remove from business
            </Button>
          )}
        </div>
      </div>

      <Sheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={`Remove ${firstName} from ${spaceName}?`}
        description="They lose access right away. Their Hyphy account and Personal Space stay theirs, and everything they made here stays here, with their name on it."
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () => removeMember(slug, personId),
                  () => setRemoving(false),
                )
              }
            >
              Remove from business
            </Button>
          </div>
        }
      >
        <span />
      </Sheet>

      <Sheet
        open={transferring}
        onClose={() => setTransferring(false)}
        title={`Transfer ${spaceName} to ${firstName}?`}
        description={`${firstName} will become the owner, including the plan and who owns the business. You’ll become an admin. Only ${firstName} can transfer it back.`}
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTransferring(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={
                pending || confirmName.trim().toLowerCase() !== spaceName.trim().toLowerCase()
              }
              onClick={() =>
                run(
                  () => transferOwnership(slug, personId, confirmName),
                  () => setTransferring(false),
                )
              }
            >
              Transfer ownership
            </Button>
          </div>
        }
      >
        <Field label={`Type ${spaceName} to confirm`} htmlFor="transfer-confirm">
          <Input
            id="transfer-confirm"
            value={confirmName}
            onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off"
            placeholder={spaceName}
            data-autofocus
          />
        </Field>
      </Sheet>
    </Panel>
  );
}

/** Leave a business you don't own. Owners transfer first. */
export function LeaveBusiness({ slug, spaceName }: { slug: string; spaceName: string }) {
  const { pending, run } = useTeamAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-critical">
        Leave
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={`Leave ${spaceName}?`}
        description="You’ll lose access right away. What you made there stays with the business. To come back, someone there can invite you again."
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Stay
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => run(() => leaveSpace(slug))}>
              Leave business
            </Button>
          </div>
        }
      >
        <span />
      </Sheet>
    </>
  );
}
