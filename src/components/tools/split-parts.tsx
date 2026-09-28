'use client';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import type { SplitBill, SplitResult } from '@/lib/tools/split';

/* The small parts every Split step shares. */

export type Money = (amount: number) => string;
export type Update = (patch: Partial<SplitBill>) => void;
export type Result = SplitResult;

export const ACCENT = 'var(--accent, var(--color-ink))';
export const TIPS = [15, 18, 20];

export const nameOf = (bill: SplitBill, index: number) =>
  bill.people[index]?.name.trim() || (index === 0 ? 'You' : `Person ${index + 1}`);

export function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-5 px-1">
      <h2
        className="font-display text-[28px] leading-[1.02] font-bold tracking-[-0.03em] text-balance text-ink sm:text-[34px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {children}
      </h2>
      {lead && <p className="mt-1.5 text-[15px] leading-snug text-muted">{lead}</p>}
    </div>
  );
}

/** The big thing to do next, pinned under the thumb while you work. */
export function NextBar({
  children,
  onClick,
  disabled,
  hint,
  aside,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  aside?: ReactNode;
  /** The whole name, when the words on the button are shorter ("Looks right"). */
  label?: string;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-3 mt-6 bg-gradient-to-t from-canvas from-60% to-transparent px-3 pt-7 pb-[max(12px,env(safe-area-inset-bottom))] sm:mx-0 sm:px-0">
      {aside}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[18px] text-[17px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent,transparent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none"
        style={{ background: ACCENT }}
      >
        {children}
      </button>
      {hint && <p className="mt-2 text-center text-[12.5px] text-muted">{hint}</p>}
    </div>
  );
}

export function TextLink({
  children,
  onClick,
  icon,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: IconName;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/[.06] hover:text-ink',
        className,
      )}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}

/** A button that opens the camera (phones) or the file picker. */
export function PhotoButton({
  label,
  icon,
  capture,
  variant = 'quiet',
  onFile,
  className,
  id,
}: {
  label: string;
  icon: IconName;
  capture?: boolean;
  /** `bare`: only the shape; the caller brings size and color. */
  variant?: 'primary' | 'quiet' | 'bare';
  onFile: (file: File) => void;
  className?: string;
  id?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer items-center justify-center gap-2.5 rounded-full transition-transform focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent-ink)] active:scale-[.975]',
        variant !== 'bare' && 'h-14 px-7 text-[17px] font-semibold',
        variant === 'primary' &&
          'text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent,transparent)]',
        variant === 'quiet' && 'bg-ink/[.06] text-ink hover:bg-ink/10',
        className,
      )}
      style={variant === 'primary' ? { background: ACCENT } : undefined}
    >
      <Icon name={icon} size={20} />
      {label}
      <input
        id={id}
        type="file"
        accept="image/*"
        aria-label={label}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

/** $ or %: how an amount is given. */
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: '$' | '%';
  onChange: (value: '$' | '%') => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[12px] bg-ink/[.06] p-1">
      {(['$', '%'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-9 w-10 rounded-[9px] text-[14px] font-semibold transition-colors',
            value === option ? 'bg-surface text-ink shadow-card' : 'text-muted',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function PercentInput({
  id,
  label,
  value,
  onChange,
  autoFocus,
  className,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('relative w-[100px]', className)}>
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value ? String(value) : ''}
        placeholder="0"
        onChange={(event) => {
          const next = Number(event.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
          if (Number.isFinite(next)) onChange(Math.min(100, next));
        }}
        className="num h-11 w-full rounded-[11px] bg-surface pr-8 pl-3 text-right text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--accent-ink)]"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-muted">
        %
      </span>
    </div>
  );
}
