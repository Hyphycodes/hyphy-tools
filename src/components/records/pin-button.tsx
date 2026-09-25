'use client';
import { useOptimistic, useTransition } from 'react';
import { setPinned } from '@/app/(app)/[space]/actions';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import type { PinTarget } from '@/lib/platform/types';

/**
 * Keep a tool or project within reach. Personal: only the person who pins it sees it, and it
 * shows up on their Home. Flips at once; the server confirms.
 */
export function PinButton({
  slug,
  target,
  pinned,
  label,
  variant = 'icon',
  className,
}: {
  slug: string;
  target: PinTarget;
  pinned: boolean;
  /** What's being pinned, for the accessible name: "Pin Oak Brook Remodel". */
  label: string;
  variant?: 'icon' | 'button';
  className?: string;
}) {
  const [on, setOn] = useOptimistic(pinned);
  const [, start] = useTransition();
  const toast = useToast();
  const toggle = () =>
    start(async () => {
      setOn(!on);
      const result = await setPinned(slug, target, !on);
      if (!result.ok) toast({ title: result.error, icon: 'alert' });
    });
  const name = `${on ? 'Unpin' : 'Pin'} ${label}`;
  if (variant === 'button')
    return (
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={name}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors',
          on
            ? 'bg-ink text-white hover:bg-ink-2'
            : 'bg-surface text-ink shadow-card hover:bg-subtle',
          className,
        )}
      >
        <Icon name="pin" size={14} className={cn(on && 'fill-current')} />
        {on ? 'Pinned' : 'Pin'}
      </button>
    );
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={name}
      title={name}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full transition-colors lg:size-8',
        on ? 'text-ink' : 'text-ink/35 hover:bg-ink/[.06] hover:text-ink',
        className,
      )}
    >
      <Icon name="pin" size={15} strokeWidth={2} className={cn(on && 'fill-current')} />
    </button>
  );
}
