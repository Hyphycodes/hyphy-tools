'use client';
import { useTransition } from 'react';
import { resolveInboxItem, reviewItem } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
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

  const act = (work: () => ReturnType<typeof resolveInboxItem>) =>
    start(async () => {
      const result = await work();
      toast(
        result.ok
          ? { title: result.message ?? 'Done', description: subject.label }
          : { title: result.error, icon: 'alert' },
      );
    });

  if (reviewable) {
    const table = subject.type === 'receipt' ? 'receipts' : 'mileage';
    return (
      <div className="flex shrink-0 gap-1.5">
        <Button
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={() => act(() => reviewItem(slug, table, subject.id, 'rejected'))}
        >
          Return
        </Button>
        <Button
          size={size}
          variant="primary"
          disabled={pending}
          onClick={() => act(() => reviewItem(slug, table, subject.id, 'approved'))}
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
      onClick={() => act(() => resolveInboxItem(slug, id))}
    >
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
          ? { title: result.message ?? 'Done', description: label }
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
