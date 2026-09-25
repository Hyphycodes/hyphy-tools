'use client';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import type { AuthProblem } from '@/lib/auth/errors';
import type { AuthFormState } from '@/lib/auth/form';

/**
 * Account form parts. Real labels, the right `autocomplete` for password managers, 16px inputs on
 * phones, one problem at a time announced to screen readers and tied to the field it's about, and
 * a submit button that says what it's doing and can't be pressed twice.
 */

export function useProblemFocus(
  state: AuthFormState,
  form: React.RefObject<HTMLFormElement | null>,
) {
  useEffect(() => {
    const field = state.problem?.field;
    if (!field || !form.current) return;
    const input = form.current.querySelector<HTMLInputElement>(`[name="${field}"]`);
    input?.focus();
    input?.select?.();
  }, [state.at, state.problem?.field, form]);
}

export function Problem({ problem, id }: { problem?: AuthProblem; id: string }) {
  return (
    <div id={id} role="alert" aria-live="assertive" className="empty:hidden">
      {problem && (
        <p
          className={cn(
            'mb-4 flex gap-2.5 rounded-[12px] px-3.5 py-3 text-[14px] leading-snug animate-pop',
            problem.notice ? 'bg-caution-soft text-caution' : 'bg-critical-soft text-critical',
          )}
        >
          <Icon name={problem.notice ? 'eye' : 'alert'} size={17} className="mt-px" />
          <span>{problem.message}</span>
        </p>
      )}
    </div>
  );
}

type FieldProps = Omit<ComponentProps<'input'>, 'id'> & {
  label: string;
  hint?: ReactNode;
  /** The form's problem, if it's about this field. */
  invalid?: boolean;
  problemId?: string;
  trailing?: ReactNode;
};

export function AuthField({
  label,
  hint,
  invalid,
  problemId,
  trailing,
  className,
  ...input
}: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13.5px] font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={cn(invalid && problemId, Boolean(hint) && hintId) || undefined}
          className={cn(
            inputClass,
            'lg:h-11 lg:text-[15px]',
            Boolean(trailing) && 'pr-12',
            invalid &&
              'shadow-[inset_0_0_0_1.5px_var(--color-critical)] hover:shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
          )}
          {...input}
        />
        {trailing}
      </div>
      {hint && (
        <p id={hintId} className="text-[12.5px] leading-snug text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [shown, setShown] = useState(false);
  return (
    <AuthField
      {...props}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-1 grid size-10 -translate-y-1/2 place-items-center rounded-[9px] text-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          <Icon name={shown ? 'eye-off' : 'eye'} size={18} />
        </button>
      }
    />
  );
}

export function Submit({
  pending,
  children,
  pendingLabel,
  className,
  variant = 'primary',
}: {
  pending: boolean;
  children: ReactNode;
  pendingLabel: string;
  className?: string;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={buttonClass({
        variant,
        size: 'lg',
        className: cn('w-full disabled:opacity-100', pending && 'cursor-progress', className),
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

/** A form bound to an action, with a ref for focusing the field a problem is about. */
export function useFormRef() {
  return useRef<HTMLFormElement>(null);
}
