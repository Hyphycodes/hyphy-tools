'use client';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { handoffFrom, leaveForPlan, type Attachment, type Connected } from '@/lib/share/handoff';

/*
 * When a Plan opened this tool ("Find a time", "Choose a place"…), a slim line says so and takes
 * the result back: the tool's link and a one-line summary are left for the plan in this browser
 * (lib/share/handoff), and the plan opens with them in place.
 */

const noop = () => () => {};
const MEMORY = 'hyphy.handoff.here';

/**
 * The plan this page was opened for. The address says so first (`?plan=…&title=…`); tools that
 * rewrite their address as you go (Split's steps) keep it for the rest of the visit in this tab.
 */
function readHandoff() {
  const { pathname, search } = window.location;
  try {
    if (handoffFrom(search)) {
      window.sessionStorage.setItem(MEMORY, `${pathname}${search}`);
      return search;
    }
    const kept = window.sessionStorage.getItem(MEMORY) ?? '';
    const at = kept.indexOf('?');
    return at > 0 && kept.slice(0, at) === pathname ? kept.slice(at) : '';
  } catch {
    return search;
  }
}

/** The plan this page was opened for, once the page is interactive. */
export function usePlanHandoff() {
  const search = useSyncExternalStore(noop, readHandoff, () => '');
  return handoffFrom(search);
}

/** Back on the plan: the tool's visit is over. */
export function forgetHandoff() {
  try {
    window.sessionStorage.removeItem(MEMORY);
  } catch {
    // Nothing kept: nothing to forget.
  }
}

export function PlanReturn({
  tool,
  attachment,
  ready = true,
  className,
}: {
  tool: Connected;
  /** What goes back to the plan: made when the button is pressed, with the latest link. */
  attachment: () => Attachment | null | Promise<Attachment | null>;
  /** False while there's nothing worth taking back yet. */
  ready?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const handoff = usePlanHandoff();
  const [busy, setBusy] = useState(false);
  if (!handoff) return null;
  const back = async () => {
    setBusy(true);
    const result = await attachment();
    if (result) leaveForPlan(handoff.plan, tool, result);
    forgetHandoff();
    router.push(`/tools/plan?open=${handoff.plan}`);
  };
  return (
    <div
      className={cn(
        'fx-rise flex min-w-0 items-center gap-3 rounded-[18px] bg-surface py-2 pr-2 pl-3.5 shadow-card',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-[#4f7cff] text-white"
      >
        <Icon name="party" size={17} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[14px] text-ink-2">
        For <span className="font-semibold text-ink">{handoff.title || 'your plan'}</span>
      </p>
      <button
        type="button"
        onClick={() => void back()}
        disabled={busy}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink transition-opacity disabled:opacity-50"
      >
        {ready ? 'Add to the plan' : 'Back to the plan'} <Icon name="arrow-right" size={15} />
      </button>
    </div>
  );
}
