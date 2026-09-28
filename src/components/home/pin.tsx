'use client';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import type { Tool, ToolId } from '@/lib/catalog/schema';
import { isPinned } from '@/lib/home/prefs';
import { noteUse, pinTool, useHome } from './use-home';

/*
 * "Keep handy": pinning, in Hyphy's words. On a tool page it's a quiet button beside Share; on
 * cards it appears when a pointer rests on the card (and stays, filled, once kept), so the
 * marketplace never turns into a wall of stars.
 */

function usePin(tool: Pick<Tool, 'id' | 'name'>) {
  const home = useHome();
  const toast = useToast();
  const on = isPinned(home, tool.id);
  const toggle = () => {
    pinTool(tool.id, !on);
    toast(
      on
        ? { title: `${tool.name} is off your tools`, icon: 'pin' }
        : {
            title: `${tool.name} is in your tools`,
            description: 'It’s first on your home.',
            icon: 'pin',
          },
    );
  };
  return { on, toggle, ready: home !== null };
}

/** The small round button on a card. */
export function PinButton({
  tool,
  always = false,
  className,
}: {
  tool: Pick<Tool, 'id' | 'name'>;
  /** Show it without a hover (lists where pinning is the point). */
  always?: boolean;
  className?: string;
}) {
  const { on, toggle, ready } = usePin(tool);
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!ready}
      aria-pressed={on}
      aria-label={on ? `Take ${tool.name} off your tools` : `Keep ${tool.name} handy`}
      title={on ? 'Kept handy' : 'Keep handy'}
      className={cn(
        'pin-button grid size-9 place-items-center rounded-full transition-[opacity,transform,background-color] duration-200 active:scale-90',
        on
          ? 'bg-[rgb(18_17_13/.82)] text-white'
          : 'bg-[rgb(18_17_13/.55)] text-white/90 hover:bg-[rgb(18_17_13/.8)]',
        !on && !always && 'pin-hover',
        className,
      )}
    >
      <Icon name="pin" size={15} strokeWidth={on ? 2.6 : 2} className={cn(on && 'fill-current')} />
    </button>
  );
}

/** A card with a "Keep handy" button in its corner (never nested inside the card's link). */
export function Pinnable({
  tool,
  children,
  always,
  className,
}: {
  tool: Pick<Tool, 'id' | 'name'>;
  children: ReactNode;
  always?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('pinnable relative min-w-0', className)}>
      {children}
      <PinButton tool={tool} always={always} className="absolute top-2.5 right-2.5 z-10" />
    </div>
  );
}

/**
 * On a tool page: notes that the tool was opened today (for the home's own shelf and "Recent";
 * nothing leaves the browser), and offers "Keep handy".
 */
export function KeepHandy({ tool }: { tool: Pick<Tool, 'id' | 'name'> }) {
  const { on, toggle, ready } = usePin(tool);
  const id: ToolId = tool.id;
  useEffect(() => {
    noteUse(id);
  }, [id]);
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!ready}
      aria-pressed={on}
      aria-label={on ? `Take ${tool.name} off your tools` : `Keep ${tool.name} handy`}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors',
        on ? 'bg-ink/[.08] text-ink' : 'text-muted hover:bg-ink/[.06] hover:text-ink',
      )}
    >
      <Icon name="pin" size={14} strokeWidth={on ? 2.6 : 2} className={cn(on && 'fill-current')} />
      <span className="max-sm:sr-only">{on ? 'Kept handy' : 'Keep handy'}</span>
    </button>
  );
}
