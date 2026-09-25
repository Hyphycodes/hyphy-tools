'use client';
import { useTransition, type MouseEvent } from 'react';
import { resolveInboxItem, reviewItem } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import type { InboxKind, ObjectRef } from '@/lib/platform/types';

/** Inline decisions for an inbox item. Approvals only render for people who can approve. */
export function InboxActions({
  slug,
  id,
  kind,
  subject,
  canApprove,
  size = 'sm',
}: {
  slug: string;
  id: string;
  kind: InboxKind;
  subject: Pick<ObjectRef, 'type' | 'id' | 'label'>;
  canApprove: boolean;
  size?: 'sm' | 'md';
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const reviewable =
    canApprove &&
    (kind === 'receipt-approval' || kind === 'mileage-review' || kind === 'unassigned-receipt') &&
    (subject.type === 'receipt' || subject.type === 'mileage');

  // The row marks itself as leaving right away, so the decision feels instant; the refreshed list
  // then drops it. If the server says no, it comes back.
  const act = (
    event: MouseEvent<HTMLElement>,
    outcome: 'approved' | 'rejected' | 'done',
    work: () => ReturnType<typeof resolveInboxItem>,
  ) => {
    const row = event.currentTarget.closest<HTMLElement>('[data-inbox-item]');
    row?.setAttribute('data-leaving', outcome);
    start(async () => {
      const result = await work();
      if (!result.ok) row?.removeAttribute('data-leaving');
      toast(
        result.ok
          ? {
              title: result.message ?? 'Done',
              description: subject.label,
              icon: outcome === 'rejected' ? 'arrow-left' : 'check',
            }
          : { title: result.error, icon: 'alert' },
      );
    });
  };

  if (reviewable) {
    const table = subject.type === 'receipt' ? 'receipts' : 'mileage';
    return (
      <div className="flex shrink-0 gap-1.5">
        <Button
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={(event) =>
            act(event, 'rejected', () => reviewItem(slug, table, subject.id, 'rejected'))
          }
        >
          Return
        </Button>
        <Button
          size={size}
          variant="primary"
          disabled={pending}
          onClick={(event) =>
            act(event, 'approved', () => reviewItem(slug, table, subject.id, 'approved'))
          }
        >
          Approve
        </Button>
      </div>
    );
  }
  return (
    <Button
      size={size}
      variant="ghost"
      disabled={pending}
      title="Mark as done"
      className="!h-7 !gap-1 !rounded-full !px-2.5 !text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:!bg-positive-soft hover:text-positive hover:shadow-[inset_0_0_0_1px_transparent]"
      onClick={(event) => act(event, 'done', () => resolveInboxItem(slug, id))}
    >
      <Icon name="check" size={13} strokeWidth={2.2} />
      Done
    </Button>
  );
}

/** Approve or return a single receipt or trip, wherever it's listed. */
export function ReviewButtons({
  slug,
  table,
  id,
  label,
}: {
  slug: string;
  table: 'receipts' | 'mileage';
  id: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const act = (decision: 'approved' | 'rejected') =>
    start(async () => {
      const result = await reviewItem(slug, table, id, decision);
      toast(
        result.ok
          ? {
              title: result.message ?? 'Done',
              description: label,
              icon: decision === 'rejected' ? 'arrow-left' : 'check',
            }
          : { title: result.error, icon: 'alert' },
      );
    });
  return (
    <div className="flex shrink-0 gap-1.5">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => act('rejected')}>
        Return
      </Button>
      <Button size="sm" variant="primary" disabled={pending} onClick={() => act('approved')}>
        Approve
      </Button>
    </div>
  );
}
