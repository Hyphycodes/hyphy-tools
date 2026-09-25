'use client';
import { useFormStatus } from 'react-dom';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';

/** The one button that accepts: says it's working, can't be pressed twice. */
export function PendingButton({
  children,
  pendingLabel,
  variant = 'primary',
}: {
  children: React.ReactNode;
  pendingLabel: string;
  variant?: 'primary' | 'secondary';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={buttonClass({
        variant,
        size: 'lg',
        className: cn('w-full disabled:opacity-100', pending && 'cursor-progress'),
      })}
    >
      {pending ? (
        <>
          <span
            aria-hidden="true"
            className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
