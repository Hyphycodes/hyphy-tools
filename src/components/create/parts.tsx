'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';

/** The sticky action row at the bottom of a create sheet. */
export function FormFooter({
  children,
  error,
  note,
}: {
  children: ReactNode;
  error?: string;
  note?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-5 mt-6 -mb-5 border-t border-line bg-surface/95 px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur lg:-mx-6 lg:px-6">
      {error && (
        <p
          role="alert"
          className="mb-3 flex items-center gap-2 rounded-[10px] bg-critical-soft px-3 py-2 text-[13.5px] text-critical"
        >
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        {note && <p className="mr-auto hidden text-[12.5px] text-muted sm:block">{note}</p>}
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
          {children}
        </div>
      </div>
    </div>
  );
}

export function SubmitButton({
  pending,
  children,
  form,
}: {
  pending: boolean;
  children: ReactNode;
  form?: string;
}) {
  return (
    <Button type="submit" form={form} variant="primary" disabled={pending}>
      {pending ? (
        <>
          <span
            className="size-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white"
            aria-hidden="true"
          />
          Saving…
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Pill choices that scroll sideways on phones. */
export function ChoiceChips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-all lg:h-8 lg:px-3 lg:text-[13px]',
              selected
                ? 'bg-ink text-white shadow-[0_4px_12px_-6px_rgb(22_21_15/.6)]'
                : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
            )}
          >
            {option.icon && <Icon name={option.icon} size={15} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-[12px] bg-subtle px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <span>
        <span className="block text-[14px] font-medium text-ink">{label}</span>
        {description && <span className="block text-[12.5px] text-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-7 w-12 shrink-0 rounded-full bg-ink/15 transition-colors peer-checked:bg-signal peer-focus-visible:outline-2 peer-focus-visible:outline-signal after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <fieldset className="mt-6 flex min-w-0 flex-col gap-4 first:mt-2">
      {title && <legend className="label mb-3">{title}</legend>}
      {children}
    </fieldset>
  );
}

/** Today's date as yyyy-mm-dd in the given timezone, for date inputs. */
export function todayInput(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
