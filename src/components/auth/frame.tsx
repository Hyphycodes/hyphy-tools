import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';

/** Hyphy Tools' mark: the spark on ink, and the name. */
export function HyphyMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-[10px] bg-ink text-white shadow-[inset_0_1px_0_rgb(255_255_255/.14)]"
      >
        <Icon name="spark" size={15} />
      </span>
      <span className="display text-[17px] tracking-[-0.02em]">Hyphy Tools</span>
    </span>
  );
}

/**
 * The account pages: paper, the mark, one calm column. On phones the column starts high so the
 * keyboard never covers the button, and respects the notch and home indicator.
 */
export function AuthFrame({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
  return (
    <div className="safe-top flex min-h-dvh flex-col">
      {notice}
      <header className="flex items-center justify-between px-5 pt-5 pb-2 sm:px-8 sm:pt-7">
        <Link href="/" aria-label="Hyphy Tools" className="rounded-[10px]">
          <HyphyMark />
        </Link>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-6 pb-10 sm:justify-center sm:px-6 sm:pt-4 sm:pb-24">
        {children}
      </main>
      <footer className="safe-bottom px-6 pb-5 text-center text-[12px] text-faint">
        Personal and business tools, one calm place.
      </footer>
    </div>
  );
}

/** The page's column: narrow for a form, wider for choosing what to do. */
export function AuthColumn({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('w-full animate-rise', wide ? 'max-w-[640px]' : 'max-w-[404px]')}>
      {children}
    </div>
  );
}

/** The heading block above a form. */
export function AuthHeading({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 px-1 sm:mb-7', className)}>
      {eyebrow && <p className="label mb-3">{eyebrow}</p>}
      <h1 className="display text-[32px] text-ink sm:text-[36px]">{title}</h1>
      {children && (
        <p className="mt-2.5 text-[15px] leading-relaxed text-muted sm:text-[14.5px]">{children}</p>
      )}
    </div>
  );
}

/** The white sheet a form sits on. */
export function AuthCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[20px] bg-surface p-5 shadow-card sm:p-7', className)}>
      {children}
    </section>
  );
}

/** One quiet line under the card: the other way in. */
export function AuthAside({ children }: { children: ReactNode }) {
  return <p className="mt-6 text-center text-[14px] text-muted">{children}</p>;
}

export const inlineLink =
  'font-medium text-ink underline decoration-line-strong decoration-1 underline-offset-[3px] transition-colors hover:decoration-ink';

/** Shown on the account pages while Demo Mode is the identity: they're a preview. */
export function PreviewNotice() {
  return (
    <div className="border-b border-caution/15 bg-caution-soft/70 px-4 py-2.5 text-center text-[13px] text-caution">
      <span className="font-medium">Preview.</span> Sign-in isn’t switched on yet —{' '}
      <Link href="/" className="font-medium underline underline-offset-2">
        open Hyphy Tools in Demo Mode
      </Link>
      .
    </div>
  );
}
