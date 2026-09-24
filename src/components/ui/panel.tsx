import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icon';

/** A white sheet on the paper canvas. The main container for grouped content. */
export function Panel({
  children,
  className,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
  id?: string;
} & React.AriaAttributes) {
  return (
    <Tag className={cn('min-w-0 rounded-[16px] bg-surface shadow-card', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function PanelHeader({
  title,
  count,
  action,
  href,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  action?: string;
  href?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header
      className={cn('flex min-h-12 items-center justify-between gap-3 px-4 pt-3 pb-1.5', className)}
    >
      <h2 className="flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em] text-ink">
        {title}
        {count !== undefined && (
          <span className="mono-num text-[12px] font-normal text-faint">{count}</span>
        )}
      </h2>
      {children}
      {href && (
        <Link
          href={href}
          className="group -mr-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-muted transition-colors hover:text-ink"
        >
          {action ?? 'View all'}
          <Icon
            name="arrow-right"
            size={14}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </Link>
      )}
    </header>
  );
}
