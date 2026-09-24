import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icon';

/** Page title block. One per page, left-aligned, with actions on the right. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  back,
  leading,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  leading?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 lg:mb-8', className)}>
      {back && (
        <Link
          href={back.href}
          className="group mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-ink"
        >
          <Icon
            name="arrow-left"
            size={15}
            className="transition-transform group-hover:-translate-x-0.5"
          />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          {leading}
          <div className="min-w-0">
            {eyebrow && <p className="label mb-2">{eyebrow}</p>}
            <h1 className="display text-[30px] text-ink lg:text-[36px]">{title}</h1>
            {description && (
              <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted lg:text-[14.5px]">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Standard page width and padding inside the shell. */
export function Page({
  children,
  className,
  wide,
}: {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 pt-5 pb-28 sm:px-6 lg:px-10 lg:pt-9 lg:pb-16',
        wide ? 'max-w-[1400px]' : 'max-w-[1180px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
