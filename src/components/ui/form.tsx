import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const inputClass = cn(
  'w-full rounded-[11px] bg-surface px-3.5 text-ink placeholder:text-faint',
  'h-12 text-[16px] lg:h-10 lg:rounded-[10px] lg:px-3 lg:text-[14px]',
  'shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-shadow duration-150',
  'hover:shadow-[inset_0_0_0_1px_rgb(22_21_15/.26)]',
  'focus:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_0_4px_rgb(50_64_255/.12)] focus:outline-none',
  'disabled:bg-subtle disabled:text-muted',
);

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  optional,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-baseline justify-between text-[13.5px] font-medium text-ink-2"
      >
        {label}
        {optional && <span className="text-[12px] font-normal text-faint">Optional</span>}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-critical">{error}</p>
      ) : (
        hint && <p className="text-[12.5px] leading-snug text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(inputClass, 'h-auto min-h-24 py-2.5 leading-relaxed lg:h-auto', className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select className={cn(inputClass, 'appearance-none pr-9', className)} {...props}>
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m7 10 5 5 5-5" />
      </svg>
    </div>
  );
}

/** A row of mutually exclusive choices, e.g. file access or a vehicle's fuel. */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  className,
}: {
  name: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      className={cn('grid auto-cols-fr grid-flow-col gap-1 rounded-[12px] bg-well p-1', className)}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            'relative flex h-10 items-center justify-center rounded-[9px] px-2 text-[14px] font-medium transition-all lg:h-8 lg:text-[13px]',
            value === option.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-muted hover:text-ink',
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
