'use client';
import { useEffect, useRef } from 'react';
import { useCreate } from '@/components/create/create-context';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { ToolGlyph } from '@/components/ui/marks';
import { Sheet } from '@/components/ui/sheet';
import { useIsDesktop } from '@/components/ui/use-media-query';
import { useWorkspace } from './workspace-context';

export const CREATE_TRIGGER_ID = 'create-trigger';

/**
 * Universal Create's menu. A flyout beside the sidebar on desktop (numbers pick an action), a
 * sheet of large tiles on phones.
 */
export function CreateMenu({ variant }: { variant: 'desktop' | 'mobile' }) {
  const { actions, space } = useWorkspace();
  const create = useCreate();
  const desktop = useIsDesktop();
  const panel = useRef<HTMLDivElement>(null);
  const open = create.menuOpen;
  const close = () => create.setMenuOpen(false);

  useEffect(() => {
    if (!open || !desktop || variant !== 'desktop') return;
    panel.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') create.setMenuOpen(false);
      const index = Number(event.key) - 1;
      if (index >= 0 && index < Math.min(actions.length, 9)) {
        event.preventDefault();
        create.start(actions[index].id);
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
  }, [open, desktop, variant, actions, create]);

  if (!actions.length || desktop !== (variant === 'desktop')) return null;

  if (!desktop)
    return (
      <Sheet open={open} onClose={close} title="Create" description={`In ${space.name}`}>
        <div className="grid grid-cols-2 gap-2.5 pt-1 pb-2">
          {actions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              onClick={() => create.start(action.id)}
              className="flex animate-rise flex-col items-start gap-3 rounded-[18px] bg-subtle p-3.5 text-left shadow-[inset_0_0_0_1px_var(--color-line)] transition-transform active:scale-[.97]"
              style={{ animationDelay: `${index * 25}ms` }}
            >
              <ToolGlyph
                tool={{ color: action.color, ink: action.ink, icon: action.icon }}
                size="lg"
              />
              <span>
                <span className="block text-[15px] leading-tight font-semibold text-ink">
                  {action.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">
                  {action.hint}
                </span>
              </span>
            </button>
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
      className="absolute top-[-8px] left-[calc(100%+14px)] z-50 w-[440px] animate-pop rounded-[18px] bg-surface p-2 shadow-pop"
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
        <p className="text-[13px] font-semibold text-ink">
          Create <span className="font-normal text-muted">in {space.name}</span>
        </p>
        <Kbd>C</Kbd>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {actions.map((action, index) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            onClick={() => create.start(action.id)}
            className={cn(
              'group flex items-center gap-3 rounded-[12px] p-2 text-left transition-colors',
              'hover:bg-ink/[.045] focus-visible:bg-ink/[.045] focus-visible:outline-none',
            )}
          >
            <ToolGlyph
              tool={{ color: action.color, ink: action.ink, icon: action.icon }}
              size="md"
              className="transition-transform group-hover:scale-[1.06]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {action.label}
              </span>
              <span className="block truncate text-[12px] text-muted">{action.hint}</span>
            </span>
            {index < 9 && (
              <span className="mono-num pr-1 text-[10.5px] text-faint opacity-0 group-hover:opacity-100">
                {index + 1}
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-1 flex items-center gap-1.5 border-t border-line px-2.5 pt-2 pb-1 text-[11.5px] text-faint">
        <Icon name="sparkles" size={12} /> Shown for your role in this Space
      </p>
    </div>
  );
}
