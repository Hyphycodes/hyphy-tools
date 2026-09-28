import type { CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { isReady, statusLabel, toolHref, type Tool } from '@/lib/catalog';
import { IntentLink } from './intent-link';
import { ToolMini } from './minis';
import { ToolMark } from './tool-mark';
import { worlds } from './worlds';

/*
 * Three sizes, so the marketplace scans fast without becoming a wall of identical boxes:
 * a feature (the artwork is the stage, for one or two editorial moments), a card (artwork and a
 * line, two across on a phone) and a row (the tool's mark and a line, like an app listing).
 * Every one of them opens the tool with a single tap.
 */

/** The small word on a tool that isn't fully open yet: "Beta", "Soon". */
function StatusTag({ tool, className }: { tool: Tool; className?: string }) {
  if (tool.status === 'available') return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-semibold tracking-wide uppercase',
        tool.status === 'beta' ? 'bg-signal-soft text-signal-ink' : 'bg-ink/[.07] text-muted',
        className,
      )}
    >
      {tool.status === 'soon' ? 'Soon' : statusLabel[tool.status]}
    </span>
  );
}

/** A card that is the tool's world: its room, its ink, a miniature of the tool in it. */
function worldCard(tool: Tool): CSSProperties {
  const world = worlds[tool.id];
  const ready = isReady(tool) && world.surface === 'light';
  return {
    '--card-canvas': ready ? world.canvas : '#141412',
    '--card-ink': ready ? world.ink : '#ece8df',
    '--card-accent': tool.accent,
    '--card-on-accent': tool.accentInk === 'light' ? '#fff' : '#12110d',
    background: 'var(--card-canvas)',
    color: 'var(--card-ink)',
  } as CSSProperties;
}

/** The featured moments: a big miniature of the tool and the job on its button. */
export function FeatureCard({
  tool,
  kicker,
  action,
  className,
}: {
  tool: Tool;
  kicker?: string;
  /** What the button says: the job, not the product ("Split a check"). */
  action?: string;
  className?: string;
}) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative isolate flex min-w-0 flex-col overflow-hidden rounded-[28px] outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1',
        className,
      )}
      style={worldCard(tool)}
    >
      <ToolMini tool={tool} className="min-h-0 w-full flex-1" />
      <div className="relative px-5 pt-1 pb-5 sm:px-7 sm:pb-7">
        {kicker && (
          <p className="mb-1.5 font-mono text-[11px] font-semibold tracking-[.1em] uppercase opacity-60">
            {kicker}
          </p>
        )}
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h3
              className="font-display text-[30px] font-bold tracking-[-0.03em] sm:text-[38px]"
              style={{ fontVariationSettings: "'wdth' 110", lineHeight: 1 }}
            >
              {tool.name}
            </h3>
            <p className="mt-1.5 max-w-[34ch] text-[14.5px] leading-snug opacity-70 sm:text-[15.5px]">
              {tool.tagline}
            </p>
          </div>
          <span
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[15px] font-semibold transition-transform duration-300 group-hover:translate-x-0.5 max-sm:hidden"
            style={{ background: 'var(--card-accent)', color: 'var(--card-on-accent)' }}
          >
            {action ?? `Open ${tool.name}`} <Icon name="arrow-right" size={16} />
          </span>
        </div>
        <span
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold sm:hidden"
          style={{ background: 'var(--card-accent)', color: 'var(--card-on-accent)' }}
        >
          {action ?? `Open ${tool.name}`} <Icon name="arrow-right" size={16} />
        </span>
      </div>
    </IntentLink>
  );
}

/** A miniature with a name and a line beneath: filtered views, two across on a phone. */
export function ToolCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn('group block min-w-0 rounded-[20px] outline-offset-4', className)}
    >
      <div className="relative overflow-hidden rounded-[20px] transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-y-1">
        <ToolMini tool={tool} className="aspect-[4/3] w-full" />
        <StatusTag tool={tool} className="absolute top-2.5 left-2.5 !bg-black/55 !text-white" />
      </div>
      <div className="px-0.5 pt-2.5">
        <h3 className="truncate text-[15.5px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">
          {tool.name}
        </h3>
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted sm:text-[14px]">
          {tool.tagline}
        </p>
      </div>
    </IntentLink>
  );
}

/**
 * A quick action: the job in words, with the tool's miniature above it. The first thing on the
 * marketplace: "What do you want to do?"
 */
export function QuickAction({
  tool,
  label,
  className,
  style,
}: {
  tool: Tool;
  label: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <IntentLink
      href={toolHref(tool)}
      aria-label={`${label} — ${tool.name}`}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-[22px] outline-offset-4 transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 active:scale-[.97]',
        className,
      )}
      style={{ ...worldCard(tool), ...style }}
    >
      <ToolMini tool={tool} className="aspect-[16/9] w-full sm:aspect-[16/10]" />
      <span className="flex items-center justify-between gap-2 px-3.5 pt-0.5 pb-3 sm:px-4 sm:pb-3.5">
        <span className="truncate text-[15px] font-semibold tracking-[-0.01em] sm:text-[16px]">
          {label}
        </span>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover:translate-x-0.5 max-sm:hidden"
          style={{ background: 'var(--card-accent)', color: 'var(--card-on-accent)' }}
        >
          <Icon name="arrow-right" size={14} />
        </span>
      </span>
    </IntentLink>
  );
}

/** A mark and a line, like an app listing: the fastest way to scan many tools. */
export function ToolRow({ tool, className }: { tool: Tool; className?: string }) {
  const ready = isReady(tool);
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group flex min-h-[68px] min-w-0 items-center gap-3.5 rounded-[16px] px-2.5 py-2.5 transition-colors hover:bg-[var(--row-tint)] active:bg-[var(--row-tint)]',
        className,
      )}
      style={
        {
          '--row-tint': `color-mix(in srgb, ${tool.accent} 9%, transparent)`,
        } as React.CSSProperties
      }
    >
      <ToolMark tool={tool} size="lg" className={cn(!ready && 'opacity-60 saturate-50')} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={cn(
              'truncate text-[15.5px] font-semibold',
              ready ? 'text-ink' : 'text-ink-2',
            )}
          >
            {tool.name}
          </span>
          <StatusTag tool={tool} />
        </span>
        <span className="block truncate text-[13.5px] text-muted">{tool.tagline}</span>
      </span>
      {ready ? (
        <span className="hidden h-8 shrink-0 items-center rounded-full bg-ink/[.07] px-3.5 text-[13px] font-semibold text-ink transition-colors group-hover:bg-ink/[.12] min-[380px]:inline-flex">
          Open
        </span>
      ) : (
        <Icon name="chevron-right" size={16} className="shrink-0 text-faint" />
      )}
    </IntentLink>
  );
}

/*
 * The shelves: every card is its tool's world with a miniature of the tool in it, in three shapes
 * for three moods — a print (creative tools), a wide card (plans with people) and a tile
 * (everyday helpers).
 */

/** A tall print: the miniature on top, the name beneath, all in the tool's world. */
export function PosterCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-[24px] outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1',
        className,
      )}
      style={worldCard(tool)}
    >
      <ToolMini tool={tool} className="aspect-[4/3.4] w-full" />
      <div className="relative flex flex-1 flex-col px-4 pt-1 pb-4 sm:px-5 sm:pb-5">
        <span className="flex items-center justify-between gap-2">
          <span
            className="font-display text-[21px] leading-none font-bold tracking-[-0.03em] sm:text-[24px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            {tool.name}
          </span>
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full transition-transform duration-300 group-hover:translate-x-0.5"
            style={{ background: 'var(--card-accent)', color: 'var(--card-on-accent)' }}
          >
            <Icon name="arrow-right" size={15} />
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug opacity-65">
          {tool.tagline}
        </span>
      </div>
    </IntentLink>
  );
}

/** A wide card: the words to one side, the miniature to the other. */
export function WashCard({
  tool,
  action,
  className,
}: {
  tool: Tool;
  action?: string;
  className?: string;
}) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative isolate flex min-h-[220px] min-w-0 overflow-hidden rounded-[26px] outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 sm:min-h-[260px]',
        className,
      )}
      style={worldCard(tool)}
    >
      <ToolMini tool={tool} fill className="!left-[34%]" />
      <div className="relative flex max-w-[44%] flex-col justify-end p-5 sm:p-6">
        <span
          className="font-display text-[26px] leading-none font-bold tracking-[-0.03em] sm:text-[30px]"
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          {tool.name}
        </span>
        <span className="mt-1.5 line-clamp-3 text-[13.5px] leading-snug opacity-70 sm:text-[14.5px]">
          {tool.tagline}
        </span>
        <span
          className="mt-4 inline-flex h-10 w-fit items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ background: 'var(--card-accent)', color: 'var(--card-on-accent)' }}
        >
          {action ?? 'Open'} <Icon name="arrow-right" size={15} />
        </span>
      </div>
    </IntentLink>
  );
}

/** A small tile: the miniature, the name, a line. */
export function TileCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative isolate flex min-w-0 flex-col overflow-hidden rounded-[22px] outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1',
        className,
      )}
      style={worldCard(tool)}
    >
      <ToolMini tool={tool} className="aspect-[4/3] w-full" />
      <span className="px-3.5 pt-0.5 pb-3.5 sm:px-4 sm:pb-4">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15.5px] font-semibold tracking-[-0.01em] sm:text-[16.5px]">
            {tool.name}
          </span>
          <StatusTag tool={tool} />
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug opacity-65 sm:text-[13px]">
          {tool.tagline}
        </span>
      </span>
    </IntentLink>
  );
}
