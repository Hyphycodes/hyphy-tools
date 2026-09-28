import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/** Everyone at the table gets one: light fills that dark initials read on. */
export const COLORS = [
  '#b8f35a',
  '#8f9bff',
  '#ff8ad8',
  '#ffc53d',
  '#7ce0c3',
  '#ff9e7a',
  '#c7b5ff',
  '#7fd4ff',
];
export const colorOf = (index: number) => COLORS[index % COLORS.length];

/*
 * Split's look: a slip of warm cream receipt paper with torn edges, printed in the world's ink,
 * and everyone at the table in their own color. The paper is the tool: every step happens on it.
 */

/** Cream receipt paper, a touch warmer than the world's own paper. */
export const PAPER = 'color-mix(in oklab, var(--w-paper, #fffbf1) 90%, var(--glow, #f1a54a) 10%)';
export const PAPER_INK = 'var(--w-ink, #221e16)';

/** Torn (zigzag) edges, as a mask: `bottom`, `top` or both. */
export function torn(edges: 'bottom' | 'top' | 'both' = 'bottom', tooth = 12): CSSProperties {
  const bottom = `conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / ${tooth}px 51% repeat-x`;
  const top = `conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / ${tooth}px 51% repeat-x`;
  const full = 'linear-gradient(#000, #000) center / 100% 50% no-repeat';
  const mask =
    edges === 'both'
      ? `${top}, ${bottom}`
      : edges === 'bottom'
        ? `${full.replace('center', 'top')}, ${bottom}`
        : `${top}, ${full.replace('center', 'bottom')}`;
  return { mask, WebkitMask: mask };
}

/**
 * A slip of receipt paper lying on the table: torn edges, a soft shadow underneath (drawn on a
 * wrapper, since the torn mask would cut a shadow of its own away).
 */
export function Paper({
  children,
  edges = 'both',
  tooth = 14,
  tint,
  className,
  outerClassName,
  style,
}: {
  children: ReactNode;
  edges?: 'bottom' | 'top' | 'both';
  tooth?: number;
  /** A person's color, mixed into the paper. */
  tint?: string;
  className?: string;
  outerClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn('relative min-w-0', outerClassName)}
      style={{
        filter:
          'drop-shadow(0 1px 1px color-mix(in srgb, var(--color-ink) 9%, transparent)) drop-shadow(0 16px 22px color-mix(in srgb, var(--color-ink) 13%, transparent))',
      }}
    >
      <div
        className={cn('relative', className)}
        style={{
          background: tint ? `color-mix(in oklab, ${tint} 26%, ${PAPER})` : PAPER,
          color: PAPER_INK,
          ...torn(edges, tooth),
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** "Ana" → A, "Person 3" → 3. */
export function initialOf(name: string) {
  const numbered = /^Person (\d+)$/.exec(name);
  if (numbered) return numbered[1];
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

export function Avatar({
  index,
  name,
  size = 32,
  className,
  style,
}: {
  index: number;
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold text-[var(--on-accent,#12110d)] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: colorOf(index),
        ...style,
      }}
    >
      {initialOf(name)}
    </span>
  );
}

/**
 * What goes on the empty receipt: faint printed lines, each getting a person's dot, one after
 * another. The promise, without a word.
 */
export function ReceiptGhost() {
  const lines = [
    { width: 58, price: '14.00', person: 1 },
    { width: 44, price: '22.50', person: 0 },
    { width: 66, price: '9.00', person: 2 },
    { width: 50, price: '18.00', person: 1 },
  ];
  return (
    <div aria-hidden="true" className="mx-auto w-full max-w-[290px] text-left">
      <div className="mx-auto h-2.5 w-28 rounded-full bg-current opacity-25" />
      <div className="mx-auto mt-2 mb-3 h-1.5 w-16 rounded-full bg-current opacity-[.12]" />
      {lines.map((line, index) => (
        <div
          key={index}
          className="flex items-center gap-2.5 border-b border-dashed border-current/15 py-[9px]"
        >
          <span
            className="fx-pop size-3 shrink-0 rounded-full"
            style={{ background: colorOf(line.person), animationDelay: `${380 + index * 140}ms` }}
          />
          <span
            className="h-2 rounded-full bg-current opacity-[.14]"
            style={{ width: `${line.width}%` }}
          />
          <span className="mono-num ml-auto text-[11.5px] opacity-45">{line.price}</span>
        </div>
      ))}
      <div className="mt-2.5 flex items-center justify-between">
        <span className="h-2 w-12 rounded-full bg-current opacity-30" />
        <span className="mono-num text-[12.5px] font-bold opacity-70">$63.50</span>
      </div>
    </div>
  );
}
