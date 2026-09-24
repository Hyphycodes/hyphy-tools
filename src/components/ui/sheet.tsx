'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icon';

/**
 * The product's one overlay: a bottom sheet on phones, a floating drawer on larger screens.
 * Built on the native <dialog> for focus trapping, Escape and an inert background for free.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  leading,
  width = 'md',
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  leading?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'fixed m-0 hidden max-w-none flex-col overflow-hidden open:flex bg-surface p-0 text-ink shadow-pop outline-none',
        'inset-x-0 top-auto bottom-0 max-h-[94dvh] w-full rounded-t-[24px] animate-sheet-up',
        'lg:top-2 lg:right-2 lg:bottom-2 lg:left-auto lg:h-[calc(100dvh-16px)] lg:max-h-none lg:rounded-[20px] lg:animate-sheet-in',
        width === 'sm' && 'lg:w-[400px]',
        width === 'md' && 'lg:w-[480px]',
        width === 'lg' && 'lg:w-[640px]',
        className,
      )}
    >
      {open && (
        <>
          <div
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/15 lg:hidden"
            aria-hidden="true"
          />
          <header className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3 lg:px-6 lg:pt-5">
            {leading}
            <div className="min-w-0 flex-1">
              <h2
                id={titleId}
                className="text-[18px] font-semibold tracking-[-0.015em] text-ink lg:text-[17px]"
              >
                {title}
              </h2>
              {description && (
                <p className="mt-0.5 text-[14px] text-muted lg:text-[13.5px]">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mt-1 -mr-2 grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-ink/5 hover:text-ink lg:size-8"
              aria-label="Close"
            >
              <Icon name="x" size={18} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 lg:px-6">
            {children}
          </div>
          {footer && (
            <footer className="safe-bottom shrink-0 border-t border-line bg-surface px-5 pt-3 pb-3 lg:px-6">
              <div className="flex items-center justify-end gap-2 pb-1">{footer}</div>
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}
