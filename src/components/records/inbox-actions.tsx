'use client';
import { useTransition, type MouseEvent } from 'react';
import { resolveInboxItem } from '@/app/(app)/[space]/actions';
import { useCreate, type EditTarget } from '@/components/create/create-context';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';

/** Clears a notification. It tints and slides away at once; if the server says no, it comes back. */
export function DoneButton({ slug, id, label }: { slug: string; id: string; label: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const act = (event: MouseEvent<HTMLElement>) => {
    const row = event.currentTarget.closest<HTMLElement>('[data-inbox-item]');
    row?.setAttribute('data-leaving', 'done');
    start(async () => {
      const result = await resolveInboxItem(slug, id);
      if (!result.ok) row?.removeAttribute('data-leaving');
      toast(
        result.ok
          ? { title: result.message ?? 'Done', description: label, icon: 'check' }
          : { title: result.error, icon: 'alert' },
      );
    });
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title="Mark as done"
      className="!h-7 !gap-1 !rounded-full !px-2.5 !text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:!bg-positive-soft hover:text-positive hover:shadow-[inset_0_0_0_1px_transparent]"
      onClick={act}
    >
      <Icon name="check" size={13} strokeWidth={2.2} />
      Done
    </Button>
  );
}

/**
 * For the person something came back to (or who left a draft): the fix, right there. "Leave it"
 * sets a return aside without resending it — some returns are simply the answer.
 */
export function FixActions({
  slug,
  inboxId,
  edit,
  returned,
}: {
  slug: string;
  inboxId: string;
  edit: EditTarget;
  returned: boolean;
}) {
  const create = useCreate();
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <div className="flex shrink-0 gap-1.5">
      {returned && (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={(event) => {
            const row = event.currentTarget.closest<HTMLElement>('[data-inbox-item]');
            row?.setAttribute('data-leaving', 'done');
            start(async () => {
              const result = await resolveInboxItem(slug, inboxId);
              if (!result.ok) row?.removeAttribute('data-leaving');
              toast(
                result.ok ? { title: 'Left as returned' } : { title: result.error, icon: 'alert' },
              );
            });
          }}
        >
          Leave it
        </Button>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={() => create.start({ id: edit.kind === 'receipt' ? 'receipt' : 'mileage', edit })}
      >
        <Icon name="pencil" size={14} />
        {returned ? 'Edit & resubmit' : 'Finish'}
      </Button>
    </div>
  );
}
