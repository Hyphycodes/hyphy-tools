'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ToolMark } from '@/components/marketplace/tool-mark';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useModalLock } from '@/components/ui/modal-lock';
import { getTool, toolHref } from '@/lib/catalog';
import { quickFor, type Lens } from '@/lib/catalog/modes';
import { useHome } from './use-home';

/*
 * The "+": one place to start anything — scan, upload, make, plan, track — in the order the
 * current mode reaches for them. Each choice opens its tool today; the groups are the seam where
 * a shared file ("Upload something", then where it goes) can arrive later without a redesign.
 */

const OPEN_EVENT = 'hyphy:quick';

export function openQuick() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The big round "+" (phones: in the dock) or a pill with words (the home's hero). */
export function QuickButton({
  variant = 'pill',
  className,
}: {
  variant?: 'pill' | 'round';
  className?: string;
}) {
  if (variant === 'round')
    return (
      <button
        type="button"
        onClick={openQuick}
        aria-label="Start something"
        aria-haspopup="dialog"
        className={cn(
          'quick-plus grid size-14 place-items-center rounded-full transition-transform duration-300 active:scale-90',
          className,
        )}
      >
        <Icon name="plus" size={26} strokeWidth={2.4} />
      </button>
    );
  return (
    <button
      type="button"
      onClick={openQuick}
      aria-haspopup="dialog"
      className={cn(
        'quick-plus inline-flex h-12 items-center gap-2 rounded-full pr-5 pl-4 text-[15px] font-semibold transition-transform duration-300 active:scale-95',
        className,
      )}
    >
      <Icon name="plus" size={19} strokeWidth={2.4} /> Start something
    </button>
  );
}

export function QuickSheet() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  useModalLock(dialog);
  const home = useHome();
  const lens: Lens | null = home?.lens ?? null;
  const [group, setGroup] = useState<string | null>(null);
  const groups = quickFor(lens);

  useEffect(() => {
    const open = () => {
      const element = dialog.current;
      if (!element || element.open) return;
      setGroup(null);
      element.showModal();
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const go = (href: string) => {
    dialog.current?.close();
    router.push(href);
  };

  return (
    <dialog
      ref={dialog}
      aria-label="Start something"
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
      className="quick-sheet m-0 mt-auto h-auto max-h-[88dvh] w-full max-w-none bg-transparent p-0 sm:m-auto sm:max-w-[560px] sm:px-4"
    >
      <div className="glass flex max-h-[88dvh] animate-sheet-up flex-col overflow-hidden rounded-t-[28px] sm:animate-pop sm:rounded-[28px]">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-2 sm:px-6">
          <h2
            className="font-display text-[26px] leading-none font-bold tracking-[-0.03em] text-ink"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            Start something
          </h2>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            aria-label="Close"
            className="grid size-10 place-items-center rounded-full bg-ink/[.07] text-ink-2 hover:bg-ink/[.12]"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <ul className="grid gap-1 overflow-y-auto px-3 pt-1 pb-[max(16px,env(safe-area-inset-bottom))] sm:px-4 sm:pb-5">
          {groups.map((entry) => {
            const open = group === entry.id;
            return (
              <li
                key={entry.id}
                className="rounded-[20px] transition-colors"
                data-open={open || undefined}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setGroup(open ? null : entry.id)}
                  className="flex min-h-[60px] w-full items-center gap-3.5 rounded-[20px] px-2.5 text-left transition-colors hover:bg-ink/[.05]"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink/[.07] text-ink">
                    <Icon name={entry.icon} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16.5px] font-semibold text-ink">
                      {entry.label}
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {entry.actions.map((action) => getTool(action.tool).name).join(' · ')}
                    </span>
                  </span>
                  <Icon
                    name="chevron-down"
                    size={18}
                    className={cn(
                      'shrink-0 text-muted transition-transform duration-300',
                      open && 'rotate-180',
                    )}
                  />
                </button>
                {open && (
                  <div className="grid animate-rise gap-1 pb-2 pl-[62px] pr-1">
                    {entry.actions.map((action) => {
                      const tool = getTool(action.tool);
                      return (
                        <button
                          key={action.tool}
                          type="button"
                          onClick={() => go(toolHref(tool))}
                          className="group flex min-h-[48px] items-center gap-3 rounded-[14px] px-2 text-left transition-colors hover:bg-ink/[.06]"
                        >
                          <ToolMark tool={tool} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-medium text-ink">
                              {action.label}
                            </span>
                            <span className="block text-[12px] text-muted">{tool.name}</span>
                          </span>
                          <Icon
                            name="arrow-right"
                            size={15}
                            className="shrink-0 text-faint group-hover:text-ink"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}
