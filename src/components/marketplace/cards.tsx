import Link from 'next/link';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { getCategory, getFamily, toolHref, type Tool } from '@/lib/catalog';
import { ToolArt } from './art';
import { PrivacyPill, StatusPill } from './badges';
import { ToolMark } from './tool-mark';

/*
 * Three ways a tool appears, so the marketplace never becomes a wall of identical boxes:
 * a tile (artwork first, words beneath, no box), a feature (the artwork is the stage and the
 * words sit inside it) and a row (a mark and a line, for the index).
 */

/** Artwork with the words underneath: galleries, families, filtered views. */
export function ToolTile({
  tool,
  className,
  context,
  order = 0,
  reveal = true,
  wide = false,
}: {
  tool: Tool;
  className?: string;
  /** A small line above the name: the family or category it's shown in. */
  context?: 'family' | 'category';
  order?: number;
  /** Rise into view on scroll (server-rendered sections); off where it's drawn on demand. */
  reveal?: boolean;
  /** Spans two columns: a wider, shorter picture. */
  wide?: boolean;
}) {
  const eyebrow =
    context === 'family' && tool.family
      ? getFamily(tool.family).name
      : context === 'category'
        ? getCategory(tool.category).name
        : null;
  return (
    <Link
      href={toolHref(tool)}
      data-reveal={reveal || undefined}
      style={{ '--reveal-order': order } as React.CSSProperties}
      className={cn('group block min-w-0 rounded-[22px] outline-offset-4', className)}
    >
      <div
        className="relative overflow-hidden rounded-[20px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-y-1 group-hover:shadow-[0_0_0_1px_var(--tile-accent),0_24px_60px_-28px_var(--tile-accent)]"
        style={
          {
            '--tile-accent': `color-mix(in oklab, ${tool.accent} 55%, transparent)`,
          } as React.CSSProperties
        }
      >
        <ToolArt
          tool={tool}
          className={cn('w-full', wide ? 'aspect-[16/11] sm:aspect-[2.2/1]' : 'aspect-[16/11]')}
        />
        {tool.status !== 'available' && (
          <StatusPill tool={tool} className="absolute top-3 left-3 !bg-black/50 backdrop-blur" />
        )}
        {tool.fresh && tool.status === 'available' && (
          <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-ink backdrop-blur">
            New
          </span>
        )}
      </div>
      <div className="px-1 pt-3.5">
        {eyebrow && <p className="label mb-1.5 !text-[10px]">{eyebrow}</p>}
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
            {tool.name}
          </h3>
          <Icon
            name="arrow-right"
            size={16}
            className="-translate-x-1 text-muted opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
          />
        </div>
        <p className="mt-0.5 text-[14px] leading-snug text-ink-2/85">{tool.tagline}</p>
      </div>
    </Link>
  );
}

/** The artwork is the stage and the words sit inside it: editorial moments. */
export function FeatureCard({
  tool,
  kicker,
  size = 'lg',
  className,
  order = 0,
}: {
  tool: Tool;
  kicker?: string;
  size?: 'lg' | 'md';
  className?: string;
  order?: number;
}) {
  return (
    <Link
      href={toolHref(tool)}
      data-reveal
      style={{ '--reveal-order': order } as React.CSSProperties}
      className={cn(
        'group relative isolate flex min-w-0 flex-col justify-end overflow-hidden rounded-[28px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] outline-offset-4',
        className,
      )}
    >
      <ToolArt tool={tool} fill align={size === 'lg' ? 'top' : 'side'} />
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0b0b0a] via-[#0b0b0a]/70 to-transparent',
          size === 'lg'
            ? 'h-[52%]'
            : 'h-[55%] sm:inset-y-0 sm:right-auto sm:h-auto sm:w-[60%] sm:bg-gradient-to-r',
        )}
      />
      <div className={cn('relative', size === 'lg' ? 'p-6 sm:p-8' : 'p-5 sm:max-w-[54%] sm:p-6')}>
        <div className="flex flex-wrap items-center gap-2">
          {kicker && <span className="label !text-ink-2">{kicker}</span>}
          <StatusPill tool={tool} />
        </div>
        <h3
          className={cn(
            'mt-2 font-display font-bold tracking-[-0.03em] text-ink',
            size === 'lg' ? 'text-[34px] sm:text-[44px]' : 'text-[26px] sm:text-[30px]',
          )}
          style={{ fontVariationSettings: "'wdth' 110", lineHeight: 1 }}
        >
          {tool.name}
        </h3>
        <p
          className={cn(
            'mt-2 max-w-[34ch] text-ink-2',
            size === 'lg' ? 'text-[16px] sm:text-[17px]' : 'text-[14.5px]',
          )}
        >
          {tool.tagline}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-[#12110d] transition-transform duration-300 group-hover:translate-x-0.5"
            style={{ background: tool.accent }}
          >
            Open {tool.name} <Icon name="arrow-right" size={16} />
          </span>
          <PrivacyPill tool={tool} short className="!h-10 !px-3.5 !text-[12.5px]" />
        </div>
      </div>
    </Link>
  );
}

/** A mark and a line: the index of everything. */
export function ToolRow({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <Link
      href={toolHref(tool)}
      className={cn(
        'group flex min-w-0 items-center gap-3.5 rounded-[16px] px-3 py-3 transition-colors hover:bg-white/[.045]',
        className,
      )}
    >
      <ToolMark tool={tool} size="md" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-ink">{tool.name}</span>
          <StatusPill tool={tool} className="!h-5 !px-2 !text-[10.5px]" />
        </span>
        <span className="block truncate text-[13.5px] text-muted">{tool.tagline}</span>
      </span>
      <Icon
        name="arrow-right"
        size={16}
        className="shrink-0 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-ink"
      />
    </Link>
  );
}
