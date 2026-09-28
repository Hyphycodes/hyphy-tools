'use client';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';

/*
 * The paper of the PDF tool: a page as it really looks (its own shape, turned the way it's set),
 * a document as a little stack, the result fanned out with a stamp on it, and the bar that keeps
 * the next step under the thumb. Written against tokens and the world's accent, so it reads as
 * warm paper in the public world and stays itself inside a Space.
 */

/** Paper on a desk: a hairline edge and a soft shadow under it. */
export const PAPER =
  'bg-white shadow-[0_0_0_1px_rgb(42_37_33/.09),0_10px_22px_-12px_rgb(42_37_33/.5)]';

/** The motion every physical change in the tool shares: the world's paper ease. */
export const SETTLE: CSSProperties = {
  transitionDuration: 'var(--motion-dur, 260ms)',
  transitionTimingFunction: 'var(--motion-ease, cubic-bezier(.2,.9,.25,1.04))',
};

/**
 * One page, as it looks: the thumbnail in its own shape, centered in a square cell so it can be
 * turned a quarter without spilling out. A blank sheet (or its number) until it's drawn.
 */
export function PageSheet({
  src,
  turn = 0,
  label,
  dim = false,
  className,
  children,
}: {
  src?: string | null;
  /** Degrees, any number: the sheet turns the short way round from where it was. */
  turn?: number;
  label?: ReactNode;
  dim?: boolean;
  className?: string;
  /** On top of the sheet: marks, badges. */
  children?: ReactNode;
}) {
  return (
    <span className={cn('relative grid aspect-square place-items-center', className)}>
      <span
        className={cn(
          'absolute inset-[5%] flex items-center justify-center transition-[transform,opacity] motion-reduce:transition-none',
          dim && 'opacity-35',
        )}
        style={{ ...SETTLE, transform: `rotate(${turn}deg)` }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            draggable={false}
            className={cn('block max-h-full max-w-full rounded-[3px] object-contain', PAPER)}
          />
        ) : (
          <span
            className={cn(
              'relative grid aspect-[8.5/11] h-full place-items-center rounded-[3px]',
              PAPER,
            )}
          >
            {src === null ? (
              <span className="px-2 text-center text-[11px] text-[#8c8177]">Can’t preview</span>
            ) : label ? (
              <span className="mono-num text-[13px] text-[#8c8177]">{label}</span>
            ) : (
              <span className="skeleton absolute inset-[12%]" />
            )}
          </span>
        )}
      </span>
      {children}
    </span>
  );
}

/**
 * The round number on a page or a document (where it lands in the new PDF), which is also its
 * handle: a finger on the number picks the thing up at once, and the arrow keys move it.
 */
export function GrabNumber({
  children,
  label,
  handle,
  className,
}: {
  children: ReactNode;
  label: string;
  /** From useSortable's `handle(key)`. */
  handle: Record<string, unknown>;
  className?: string;
}) {
  return (
    <button
      type="button"
      {...handle}
      aria-label={label}
      title="Drag to move, or use the arrow keys"
      className={cn(
        'group/grab absolute top-0 left-0 z-[1] grid size-11 cursor-grab place-items-center rounded-full active:cursor-grabbing',
        className,
      )}
    >
      <span className="mono-num grid h-7 min-w-7 place-items-center rounded-full bg-ink px-1.5 text-[12.5px] font-semibold text-on-ink shadow-lift transition-transform group-hover/grab:scale-110">
        {children}
      </span>
    </button>
  );
}

/** A small round button on the corner of a sheet (remove). */
export function CornerButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      data-no-drag=""
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="group/corner absolute top-0 right-0 z-[1] grid size-11 place-items-center rounded-full disabled:opacity-30"
    >
      <span className="grid size-7 place-items-center rounded-full bg-surface text-ink-2 shadow-[0_0_0_1px_var(--color-line),0_4px_10px_-6px_rgb(42_37_33/.4)] transition-colors group-hover/corner:bg-critical-soft group-hover/corner:text-critical">
        <Icon name={icon} size={14} strokeWidth={2.4} />
      </span>
    </button>
  );
}

/** A whole document, as a little stack: its first page on top, more sheets under it. */
export function DocStack({
  src,
  pages,
  problem,
  className,
}: {
  src?: string;
  pages?: number;
  problem?: boolean;
  className?: string;
}) {
  const under = Math.min(2, Math.max(0, (pages ?? 1) - 1));
  return (
    <span className={cn('relative block aspect-[5/6]', className)}>
      {[...Array(under)].map((_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn('absolute inset-x-[16%] inset-y-[7%] rounded-[3px]', PAPER)}
          style={{
            transform: `rotate(${index ? -4 : 3.5}deg) translate(${index ? -4 : 5}px, 2px)`,
          }}
        />
      ))}
      <span className="absolute inset-x-[10%] inset-y-[4%] flex items-center justify-center">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            draggable={false}
            className={cn('block max-h-full max-w-full rounded-[3px] object-contain', PAPER)}
          />
        ) : (
          <span
            className={cn(
              'relative grid aspect-[8.5/11] h-full place-items-center rounded-[3px]',
              PAPER,
            )}
          >
            {problem ? (
              <span className="px-3 text-center text-[12px] leading-snug text-critical">
                Can’t open this one
              </span>
            ) : (
              <span className="skeleton absolute inset-[12%]" />
            )}
          </span>
        )}
      </span>
    </span>
  );
}

/** The mark that lands on a finished document. */
export function Stamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'fx-stamp pointer-events-none absolute z-10 inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1 font-display text-[17px] leading-none font-extrabold tracking-[.14em] text-[var(--accent-ink)] uppercase mix-blend-multiply sm:text-[20px]',
        className,
      )}
      style={{
        rotate: '-10deg',
        boxShadow: 'inset 0 0 0 2.5px var(--accent-ink), inset 0 0 0 5px transparent',
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        animationDelay: '160ms',
      }}
    >
      {children}
    </span>
  );
}

export type Cover = { src?: string; turn?: number };

/** The result, fanned out on the desk: first page on top, a count, and the stamp. */
export function ResultStack({
  covers,
  pages,
  stamp,
  size = 'lg',
  className,
}: {
  covers: Cover[];
  pages: number;
  stamp?: ReactNode;
  size?: 'lg' | 'sm';
  className?: string;
}) {
  const shown = (covers.length ? covers : [{}]).slice(0, 3);
  const fan = size === 'lg' ? [0, 16, -16] : [0, 8, -8];
  return (
    <div
      className={cn(
        'relative mx-auto',
        size === 'lg' ? 'h-[210px] w-[170px] sm:h-[250px] sm:w-[200px]' : 'h-[118px] w-[96px]',
        className,
      )}
    >
      {shown
        .map((cover, index) => ({ cover, index }))
        .reverse()
        .map(({ cover, index }) => (
          <span
            key={index}
            className="fx-settle absolute inset-0"
            style={
              {
                '--i': shown.length - index,
                transform: `translateX(${fan[index]}px) rotate(${[0, 5, -5][index]}deg)`,
              } as CSSProperties
            }
          >
            <PageSheet src={cover.src} turn={cover.turn} className="!aspect-auto h-full" />
          </span>
        ))}
      {pages > 0 && (
        <span
          className={cn(
            'mono-num absolute rounded-full bg-ink font-semibold text-on-ink shadow-lift',
            size === 'lg'
              ? '-right-4 -bottom-1 px-3 py-1.5 text-[13px]'
              : '-right-2 -bottom-1 px-2 py-0.5 text-[11px]',
          )}
        >
          {pages} {pages === 1 ? 'page' : 'pages'}
        </span>
      )}
      {stamp && (
        <Stamp className={size === 'lg' ? 'top-[38%] -left-5' : '!text-[11px] top-[36%] -left-3'}>
          {stamp}
        </Stamp>
      )}
    </div>
  );
}

/** What goes in: a small fan of pages, drawn, with the world's clay on the top sheet. */
export function PagesArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 120"
      aria-hidden="true"
      className={cn(
        'mx-auto h-[104px] w-[156px] overflow-visible sm:h-[120px] sm:w-[180px]',
        className,
      )}
    >
      <defs>
        <filter id="pdf-art-shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#2a2521" floodOpacity=".18" />
        </filter>
      </defs>
      <g filter="url(#pdf-art-shadow)">
        <rect
          x="30"
          y="16"
          width="66"
          height="88"
          rx="4"
          fill="#fff"
          transform="rotate(-9 63 60)"
        />
        <rect
          x="84"
          y="16"
          width="66"
          height="88"
          rx="4"
          fill="#fff"
          transform="rotate(8 117 60)"
        />
        <rect x="57" y="8" width="66" height="88" rx="4" fill="#fff" />
      </g>
      <rect x="57" y="8" width="66" height="7" rx="3" style={{ fill: 'var(--accent)' }} />
      {[28, 36, 44, 52, 60, 68].map((y, index) => (
        <rect
          key={y}
          x="66"
          y={y}
          width={index % 3 === 2 ? 30 : 48}
          height="3.2"
          rx="1.6"
          fill="#e4ddd2"
        />
      ))}
      <rect
        x="66"
        y="78"
        width="22"
        height="9"
        rx="2"
        style={{ fill: 'var(--accent)', opacity: 0.5 }}
      />
    </svg>
  );
}

/** The jobs for one PDF, drawn small: what each does to the pages. */
export function JobArt({ job }: { job: 'arrange' | 'keep' | 'split' }) {
  const sheet = (x: number, y: number, key: string | number, dim = false, turn = 0) => (
    <rect
      key={key}
      x={x}
      y={y}
      width="11"
      height="14"
      rx="2"
      transform={turn ? `rotate(${turn} ${x + 5.5} ${y + 7})` : undefined}
      className={cn('fill-white stroke-[rgb(42_37_33/.3)]', dim && 'opacity-40')}
      strokeWidth="1"
    />
  );
  const fill = { fill: 'var(--accent)' };
  return (
    <svg
      viewBox="0 0 44 22"
      aria-hidden="true"
      className="h-[22px] w-[44px] shrink-0 overflow-visible"
    >
      {job === 'arrange' && (
        <>
          {sheet(2, 4, 'a')}
          <rect
            x="16"
            y="3"
            width="11"
            height="14"
            rx="2"
            transform="rotate(14 21.5 10)"
            style={fill}
          />
          {sheet(31, 4, 'c')}
          <path
            d="M6 21c6 2.5 12 2.5 17 0"
            className="fill-none stroke-[var(--accent-ink)]"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )}
      {job === 'keep' &&
        [0, 1, 2].map((index) =>
          index === 1 ? (
            sheet(index * 15 + 1, 4, index, true)
          ) : (
            <g key={index}>
              <rect x={index * 15 + 1} y="4" width="11" height="14" rx="2" style={fill} />
              <path
                d={`M${index * 15 + 3.5} 11l2.3 2.3 3.6-4.4`}
                className="fill-none stroke-[var(--on-accent,#12110d)]"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ),
        )}
      {job === 'split' && (
        <>
          {sheet(2, 4, 'a')}
          {sheet(14, 4, 'b')}
          <path
            d="M28 1v20"
            className="stroke-[var(--accent-ink)]"
            strokeWidth="1.6"
            strokeDasharray="2.4 2.4"
          />
          <rect
            x="32"
            y="4"
            width="11"
            height="14"
            rx="2"
            transform="rotate(8 37.5 11)"
            style={fill}
          />
        </>
      )}
    </svg>
  );
}

/**
 * The next step, under the thumb: a bar that sticks to the bottom of the screen while the pages
 * scroll, on every screen size (a long document shouldn't hide its button). Inside a Space the
 * bottom of a phone belongs to the tab bar, so there it simply sits in place.
 */
export function DeskBar({
  children,
  summary,
  fixed = true,
  className,
}: {
  children: ReactNode;
  summary?: ReactNode;
  fixed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'z-20 mt-5',
        fixed && 'sticky bottom-0 pb-[max(12px,env(safe-area-inset-bottom))] sm:bottom-3 sm:pb-0',
        className,
      )}
    >
      <div
        className={cn(
          'mx-auto flex max-w-[760px] flex-wrap items-center gap-2 rounded-[22px] bg-surface p-2 shadow-[0_0_0_1px_var(--color-line),0_18px_40px_-20px_rgb(42_37_33/.45)] sm:flex-nowrap sm:p-2.5',
        )}
      >
        {summary && (
          <div className="min-w-0 flex-1 basis-full px-2 text-[13.5px] text-muted sm:basis-auto">
            {summary}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The one big button in the bar, in clay. */
export function DeskButton({
  children,
  icon,
  onClick,
  disabled,
  busy,
  className,
}: {
  children: ReactNode;
  icon?: Parameters<typeof Icon>[0]['name'];
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'inline-flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[16px] px-5 text-[16.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-16px_var(--accent)] transition-[transform,opacity] active:scale-[.98] disabled:opacity-40 disabled:shadow-none sm:h-13 sm:flex-none sm:px-7 sm:text-[16px]',
        className,
      )}
      style={{ background: 'var(--accent)' }}
    >
      {(busy || icon) && (
        <Icon name={busy ? 'loader' : icon!} size={19} className={cn(busy && 'animate-spin')} />
      )}
      {children}
    </button>
  );
}

/** A quiet round button beside the big one: undo, start over. */
export function DeskIcon({
  icon,
  label,
  onClick,
  disabled,
  className,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid size-14 shrink-0 place-items-center rounded-[16px] bg-ink/[.05] text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-35 sm:size-13',
        className,
      )}
    >
      <Icon name={icon} size={19} />
    </button>
  );
}
