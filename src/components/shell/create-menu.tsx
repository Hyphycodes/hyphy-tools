'use client';
import { useEffect, useRef } from 'react';
import { useCreate } from '@/components/create/create-context';
import { cn } from '@/components/ui/cn';
import { Kbd } from '@/components/ui/kbd';
import { ToolGlyph } from '@/components/ui/marks';
import { Sheet } from '@/components/ui/sheet';
import { useIsDesktop } from '@/components/ui/use-media-query';
import { groupActions } from '@/lib/platform/actions';
import { useWorkspace } from './workspace-context';

export const CREATE_TRIGGER_ID = 'create-trigger';

/** Moves focus to the nearest item in a direction, so arrows work across the two columns. */
function moveFocus(panel: HTMLElement, dx: number, dy: number) {
  const items = [...panel.querySelectorAll<HTMLElement>('[data-create-item]')];
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) return items[0]?.focus();
  const from = current.getBoundingClientRect();
  let best: HTMLElement | undefined;
  let bestScore = Infinity;
  for (const item of items) {
    if (item === current) continue;
    const to = item.getBoundingClientRect();
    const x = to.left + to.width / 2 - (from.left + from.width / 2);
    const y = to.top + to.height / 2 - (from.top + from.height / 2);
    const along = dx ? x * dx : y * dy;
    const across = dx ? Math.abs(y) : Math.abs(x);
    if (along < 4) continue;
    const score = along + across * 3;
    if (score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  best?.focus();
}

/**
 * Universal Create's menu, grouped into Capture, Set up and Make. A flyout beside the sidebar on
 * desktop (numbers and arrows pick an action), a sheet of large targets on phones.
 */
export function CreateMenu({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { actions, space } = useWorkspace();
  const create = useCreate();
  const desktop = useIsDesktop();
  const panel = useRef<HTMLDivElement>(null);
  const open = create.menuOpen;
  const close = () => create.setMenuOpen(false);
  const groups = groupActions(actions);
  const ordered = groups.flatMap((group) => group.actions);

  useEffect(() => {
    if (!open || !desktop || variant !== 'desktop') return;
    panel.current?.querySelector<HTMLElement>('[data-create-item]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        create.setMenuOpen(false);
        document.getElementById(CREATE_TRIGGER_ID)?.focus();
        return;
      }
      const arrows: Record<string, [number, number]> = {
        ArrowDown: [0, 1],
        ArrowUp: [0, -1],
        ArrowRight: [1, 0],
        ArrowLeft: [-1, 0],
      };
      if (arrows[event.key] && panel.current) {
        event.preventDefault();
        moveFocus(panel.current, ...arrows[event.key]);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < Math.min(ordered.length, 9)) {
        event.preventDefault();
        create.start(ordered[index].id);
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !document.getElementById(CREATE_TRIGGER_ID)?.contains(target)
      )
        create.setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, desktop, variant, ordered, create]);

  if (!actions.length || desktop !== (variant === 'desktop')) return null;

  if (!desktop)
    return (
      <Sheet open={open} onClose={close} title="Create" description={`In ${space.name}`}>
        <div className="grid gap-5 pt-1 pb-2">
          {groups.map((group, groupIndex) => (
            <section key={group.id} aria-label={group.label}>
              {groups.length > 1 && <p className="label mb-2 px-0.5">{group.label}</p>}
              <div className="grid grid-cols-2 gap-2.5">
                {group.actions.map((action) => {
                  const delay = ordered.indexOf(action) * 22;
                  // The first group gets big tiles; the rest stay compact so the sheet stays short.
                  return groupIndex === 0 ? (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => create.start(action.id)}
                      className="flex min-h-[124px] animate-rise flex-col items-start justify-between gap-3 rounded-[18px] bg-subtle p-3.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform active:scale-[.97]"
                      style={{ animationDelay: `${delay}ms` }}
                    >
                      <ToolGlyph
                        tool={{ color: action.color, ink: action.ink, icon: action.icon }}
                        size="lg"
                      />
                      <span>
                        <span className="block text-[15.5px] leading-tight font-semibold text-ink">
                          {action.label}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                          {action.hint}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => create.start(action.id)}
                      className="flex min-h-14 animate-rise items-center gap-3 rounded-[16px] bg-subtle p-2.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform active:scale-[.97]"
                      style={{ animationDelay: `${delay}ms` }}
                    >
                      <ToolGlyph
                        tool={{ color: action.color, ink: action.ink, icon: action.icon }}
                        size="md"
                      />
                      <span className="min-w-0 text-[14.5px] leading-tight font-semibold text-ink">
                        {action.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </Sheet>
    );

  if (!open) return null;
  // Rendered inside the sidebar's Create wrapper, so it sits beside the button with no measuring.
  return (
    <div
      ref={panel}
      role="menu"
      aria-label="Create"
      className="absolute top-[-8px] left-[calc(100%+14px)] z-50 w-[492px] origin-top-left animate-pop rounded-[20px] bg-surface p-2 shadow-pop"
    >
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <p className="text-[13.5px] font-semibold text-ink">
          Create <span className="font-normal text-muted">in {space.name}</span>
        </p>
        <Kbd>C</Kbd>
      </div>
      {groups.map((group) => (
        <div key={group.id} role="group" aria-label={group.label} className="mt-1">
          <p className="label px-3 pt-2 pb-1.5 !text-[10px] !text-faint">{group.label}</p>
          <div className="grid grid-cols-2 gap-0.5">
            {group.actions.map((action) => {
              const index = ordered.indexOf(action);
              return (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  data-create-item
                  onClick={() => create.start(action.id)}
                  className={cn(
                    'group flex items-center gap-3 rounded-[13px] p-2 text-left transition-colors',
                    'hover:bg-ink/[.045] focus-visible:bg-ink/[.055] focus-visible:outline-none',
                  )}
                >
                  <ToolGlyph
                    tool={{ color: action.color, ink: action.ink, icon: action.icon }}
                    size="md"
                    className="transition-transform duration-200 group-hover:scale-[1.06] group-focus-visible:scale-[1.06]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {action.label}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{action.hint}</span>
                  </span>
                  {index < 9 && (
                    <span className="mono-num grid size-5 place-items-center rounded-[5px] text-[10.5px] text-faint transition-colors group-hover:bg-ink/[.06] group-hover:text-ink-2 group-focus-visible:bg-ink/[.06] group-focus-visible:text-ink-2">
                      {index + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="mt-1.5 flex items-center gap-3 border-t border-line px-3 pt-2.5 pb-1.5 text-[11.5px] text-faint">
        <span>Picked for your role here</span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>1</Kbd>–<Kbd>9</Kbd> pick
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
      </p>
    </div>
  );
}
