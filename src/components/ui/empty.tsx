import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icon';

export function EmptyState({
  icon = 'circle',
  title,
  children,
  action,
  className,
  compact,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-6 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <span className="mb-4 grid size-11 place-items-center rounded-[13px] bg-well text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {children && (
        <div className="mt-1.5 max-w-[42ch] text-[14px] leading-relaxed text-muted">{children}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
