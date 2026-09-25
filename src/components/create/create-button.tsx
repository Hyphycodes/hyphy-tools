'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { useWorkspace } from '@/components/shell/workspace-context';
import type { CreateActionId } from '@/lib/platform/actions';
import { useCreate, type CreateRequest } from './create-context';

/** A button anywhere in the product that starts a registered Create action — if this person has it. */
export function CreateButton({
  request,
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
}: {
  request: CreateActionId | CreateRequest;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'accent';
  size?: 'sm' | 'md';
  icon?: IconName;
  className?: string;
}) {
  const create = useCreate();
  const { actions } = useWorkspace();
  const id = typeof request === 'string' ? request : request.id;
  if (!actions.some((action) => action.id === id)) return null;
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => create.start(request)}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </Button>
  );
}

/** The dashboard's quick actions, straight from the Create registry. */
export function QuickActions({
  count = 5,
  big = false,
  variant = 'tiles',
}: {
  count?: number;
  big?: boolean;
  /** `inline`: a few small buttons beside a page title. */
  variant?: 'tiles' | 'inline';
}) {
  const create = useCreate();
  const { actions } = useWorkspace();
  const shown = actions.slice(0, count);
  if (!shown.length) return null;

  if (variant === 'inline')
    return (
      <div className="flex items-center gap-1.5">
        {shown.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => create.start(action.id)}
            className="group flex h-9 items-center gap-2 rounded-full bg-surface py-1 pr-3.5 pl-1 text-[13px] font-medium text-ink shadow-card transition-all hover:shadow-lift active:scale-[.97]"
          >
            <ToolGlyph
              tool={{ color: action.color, ink: action.ink, icon: action.icon }}
              size="sm"
              className="!rounded-full transition-transform group-hover:scale-105"
            />
            {action.label}
          </button>
        ))}
      </div>
    );

  if (big)
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {shown.map((action, index) => (
          <button
            key={action.id}
            type="button"
            onClick={() => create.start(action.id)}
            className="group flex min-h-[112px] animate-rise flex-col justify-between rounded-[20px] bg-surface p-4 text-left shadow-card transition-all hover:shadow-lift active:scale-[.98]"
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <ToolGlyph
              tool={{ color: action.color, ink: action.ink, icon: action.icon }}
              size="lg"
              className="transition-transform group-hover:scale-105"
            />
            <span className="text-[16px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5">
      {shown.map((action, index) => (
        <button
          key={action.id}
          type="button"
          onClick={() => create.start(action.id)}
          className={cn(
            'group flex shrink-0 animate-rise items-center gap-3 rounded-[16px] bg-surface py-2.5 pr-4 pl-2.5 text-left shadow-card transition-all hover:shadow-lift active:scale-[.98]',
            'lg:bg-subtle lg:shadow-[inset_0_0_0_1px_var(--color-line)] lg:hover:bg-surface lg:hover:shadow-lift',
          )}
          style={{ animationDelay: `${index * 35}ms` }}
        >
          <ToolGlyph
            tool={{ color: action.color, ink: action.ink, icon: action.icon }}
            size="md"
            className="transition-transform group-hover:scale-105"
          />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-medium whitespace-nowrap text-ink">
              {action.label}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
