import type { CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';

/*
 * Split's look: warm receipt paper with torn edges, and everyone at the table in their own color.
 * Inline CSS only; the paper stays light (and its ink dark) in any theme, like a real slip.
 */

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

export const PAPER = 'color-mix(in oklab, var(--glow, #f3e3b3) 34%, #fdfaf3)';
export const PAPER_INK = '#221e16';

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
        'grid shrink-0 place-items-center rounded-full font-bold text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
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

/** The promise, drawn: a receipt on the left becomes everyone's total on the right. */
export function StartArt() {
  const lines = [
    { width: 58, price: '14.00', person: 1 },
    { width: 44, price: '22.50', person: 0 },
    { width: 66, price: '9.00', person: 2 },
    { width: 50, price: '18.00', person: 1 },
  ];
  const people = [
    { name: 'Ana', total: '$24.10', index: 0, shift: 0 },
    { name: 'Ben', total: '$31.40', index: 1, shift: 14 },
    { name: 'Cleo', total: '$18.75', index: 2, shift: 4 },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto h-[158px] w-full max-w-[310px]">
      <div
        className="absolute top-1 left-1 w-[128px] rotate-[-6deg] px-3 pt-3 pb-5"
        style={{ background: PAPER, color: PAPER_INK, ...torn('bottom', 10) }}
      >
        <div className="mx-auto mb-2.5 h-1.5 w-12 rounded-full bg-current opacity-35" />
        {lines.map((line, index) => (
          <div key={index} className="mb-2 flex items-center gap-1.5">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: colorOf(line.person) }}
            />
            <span
              className="h-1.5 rounded-full bg-current opacity-20"
              style={{ width: `${line.width}%` }}
            />
            <span className="mono-num ml-auto text-[8.5px] opacity-60">{line.price}</span>
          </div>
        ))}
        <div className="mt-2.5 flex items-center justify-between border-t border-dashed border-current/30 pt-2">
          <span className="h-1.5 w-9 rounded-full bg-current opacity-45" />
          <span className="mono-num text-[9.5px] font-bold">$74.30</span>
        </div>
      </div>

      <svg
        viewBox="0 0 60 40"
        className="absolute top-[58px] left-[132px] h-10 w-[60px]"
        fill="none"
        stroke="var(--accent, currentColor)"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M4 26 C 20 6, 36 6, 50 18" strokeDasharray="1 6" />
        <path d="M44 12 L51 19 L42 22" strokeLinejoin="round" />
      </svg>

      <div className="absolute top-3 right-0 grid gap-2">
        {people.map((person, order) => (
          <span
            key={person.name}
            className="flex h-10 animate-rise items-center justify-self-end gap-2 rounded-full bg-well pr-3.5 pl-1.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),0_12px_24px_-16px_rgb(0_0_0/.9)]"
            style={{
              marginRight: person.shift,
              animationDelay: `${140 + order * 110}ms`,
            }}
          >
            <Avatar index={person.index} name={person.name} size={28} />
            <span className="text-[13px] font-medium text-ink-2">{person.name}</span>
            <span className="num ml-1 text-[14px] font-bold text-ink">{person.total}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
