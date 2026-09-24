import type { ReactNode } from 'react';
import { cn } from './cn';

export type Tone = 'neutral' | 'positive' | 'caution' | 'critical' | 'signal' | 'outline' | 'ink';

const tones: Record<Tone, string> = {
  neutral: 'bg-well text-ink-2',
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
  signal: 'bg-signal-soft text-signal-ink',
  outline: 'text-muted shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
  ink: 'bg-ink text-white',
};

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] leading-none font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** A number bubble for nav items and tabs. */
export function Count({ value, tone = 'neutral' }: { value: number; tone?: 'neutral' | 'signal' }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        'mono-num inline-grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[10.5px] font-medium',
        tone === 'signal' ? 'bg-signal text-white' : 'bg-ink/[.07] text-ink-2',
      )}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}
