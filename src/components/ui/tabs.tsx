import Link from 'next/link';
import { cn } from './cn';

/** Link-based tabs: every view has a URL, works without JavaScript and survives reloads. */
export function Tabs({
  items,
  active,
  className,
}: {
  items: { id: string; label: string; href: string; count?: number }[];
  active: string;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        'scrollbar-none -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0',
        className,
      )}
      aria-label="Views"
    >
      {items.map((item) => {
        const on = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            scroll={false}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'relative flex h-11 shrink-0 items-center gap-1.5 px-2.5 text-[14px] transition-colors lg:h-10 lg:text-[13.5px]',
              on ? 'font-medium text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className={cn('mono-num text-[11px]', on ? 'text-ink-2' : 'text-faint')}>
                {item.count}
              </span>
            )}
            {on && (
              <span
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink"
                aria-hidden="true"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Pill filters for lists. */
export function Chips({
  items,
  active,
}: {
  items: { id: string; label: string; href: string; count?: number }[];
  active: string;
}) {
  return (
    <div
      className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0"
      role="navigation"
      aria-label="Filters"
    >
      {items.map((item) => {
        const on = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            scroll={false}
            aria-current={on ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] transition-all lg:h-8 lg:px-3 lg:text-[13px]',
              on
                ? 'bg-ink font-medium text-white'
                : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span className={cn('mono-num text-[11px]', on ? 'text-white/65' : 'text-faint')}>
                {item.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
