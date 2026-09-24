'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Sheet } from './sheet';
import { useIsDesktop } from './use-media-query';

type TriggerProps = {
  open: boolean;
  toggle: () => void;
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'menu' | 'dialog';
};

/**
 * A menu anchored to its trigger on desktop, and a bottom sheet on phones — the same content,
 * shaped for the device.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  side = 'bottom',
  title,
  className,
  width = 280,
}: {
  trigger: (props: TriggerProps) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  /** Heading shown when it opens as a sheet. */
  title: string;
  className?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open || !desktop) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    const first = root.current?.querySelector<HTMLElement>(
      '[data-autofocus], a, button:not([aria-expanded])',
    );
    first?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, desktop]);

  return (
    <div ref={root} className="relative">
      {trigger({
        open,
        toggle: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'menu',
      })}
      {desktop ? (
        open && (
          <div
            id={id}
            className={cn(
              'absolute z-50 rounded-[14px] bg-surface p-1.5 shadow-pop animate-pop',
              side === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
              align === 'start' ? 'left-0' : 'right-0',
              className,
            )}
            style={{ width }}
          >
            {children(close)}
          </div>
        )
      ) : (
        <Sheet open={open} onClose={close} title={title}>
          <div id={id} className="-mx-2">
            {children(close)}
          </div>
        </Sheet>
      )}
    </div>
  );
}

export const menuItemClass = cn(
  'flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[15px] text-ink transition-colors lg:gap-2.5 lg:px-2.5 lg:py-2 lg:text-[13.5px]',
  'hover:bg-ink/[.05] focus-visible:bg-ink/[.05] focus-visible:outline-none',
);

/** A row inside a Popover menu. Larger on phones. */
export function MenuItem({
  children,
  className,
  active,
  ...props
}: React.ComponentProps<'button'> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(menuItemClass, active && 'bg-ink/[.05]', className)}
      {...props}
    >
      {children}
    </button>
  );
}
