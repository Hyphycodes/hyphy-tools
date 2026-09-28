import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { isReady, statusLabel, toolHref, type Tool } from '@/lib/catalog';
import { ToolArt } from './art';
import { IntentLink } from './intent-link';
import { ToolMark } from './tool-mark';

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

/** Artwork is the stage and the words sit inside it: the featured moments. */
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
        'group relative isolate flex min-w-0 flex-col justify-end overflow-hidden rounded-[26px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] outline-offset-4',
        className,
      )}
    >
      <div className="absolute inset-0 bg-[#121211]">
        <ToolArt tool={tool} className="h-[64%] w-full sm:h-[70%]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-[#0b0b0a] via-[#0b0b0a]/80 to-transparent" />
      <div className="relative p-5 sm:p-7">
        {kicker && <p className="label mb-2 !text-ink-2">{kicker}</p>}
        <h3
          className="font-display text-[32px] font-bold tracking-[-0.03em] text-ink sm:text-[40px]"
          style={{ fontVariationSettings: "'wdth' 110", lineHeight: 1 }}
        >
          {tool.name}
        </h3>
        <p className="mt-2 max-w-[34ch] text-[15px] leading-snug text-ink-2 sm:text-[16px]">
          {tool.tagline}
        </p>
        <span
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-[#12110d] transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ background: tool.accent }}
        >
          {action ?? `Open ${tool.name}`} <Icon name="arrow-right" size={16} />
        </span>
      </div>
    </IntentLink>
  );
}

/** Artwork with a name and a line beneath: two across on a phone. */
export function ToolCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn('group block min-w-0 rounded-[20px] outline-offset-4', className)}
    >
      <div
        className="relative overflow-hidden rounded-[18px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:-translate-y-1 group-hover:shadow-[0_0_0_1px_var(--tile-accent),0_24px_60px_-28px_var(--tile-accent)]"
        style={
          {
            '--tile-accent': `color-mix(in oklab, ${tool.accent} 55%, transparent)`,
          } as React.CSSProperties
        }
      >
        <ToolArt tool={tool} className="aspect-[4/3] w-full" />
        <StatusTag tool={tool} className="absolute top-2.5 left-2.5 !bg-black/55" />
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
 * The expressive shelves: cards that wear their tool's color instead of all sitting on the same
 * charcoal. A poster (creative tools), a wide colored card (plans with people) and a lit tile
 * (everyday helpers) — different shapes for different moods, one family.
 */

/** A tall print: the picture on top, a band of the tool's color with its name below. */
export function PosterCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-[24px] shadow-[0_0_0_1px_rgb(255_255_255/.07)] outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1',
        className,
      )}
    >
      <ToolArt tool={tool} className="aspect-[4/3.3] w-full" />
      <div
        className="relative flex flex-1 flex-col px-4 pt-3.5 pb-4 text-[#12110d] sm:px-5 sm:pb-5"
        style={{
          background: `linear-gradient(170deg, color-mix(in oklab, ${tool.accent}, white 16%), ${tool.accent})`,
        }}
      >
        <span className="flex items-center justify-between gap-2">
          <span
            className="font-display text-[23px] leading-none font-bold tracking-[-0.03em] sm:text-[26px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            {tool.name}
          </span>
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#12110d]/10 transition-transform duration-300 group-hover:translate-x-0.5">
            <Icon name="arrow-right" size={15} />
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-[#12110d]/70">
          {tool.tagline}
        </span>
      </div>
    </IntentLink>
  );
}

/** A wide card washed in the tool's color, the picture to the side. */
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
        'group relative isolate flex min-h-[200px] min-w-0 overflow-hidden rounded-[24px] shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] outline-offset-4 sm:min-h-[240px]',
        className,
      )}
      style={{
        background: `radial-gradient(90% 120% at 100% 0%, color-mix(in oklab, ${tool.accent} 34%, transparent), transparent 70%), linear-gradient(135deg, color-mix(in oklab, ${tool.accent} 14%, #141412), #121211)`,
      }}
    >
      <div className="absolute inset-y-0 right-0 w-[56%] [mask-image:linear-gradient(90deg,transparent,black_35%)]">
        <ToolArt tool={tool} quiet className="h-full w-full !bg-transparent" />
      </div>
      <div className="relative flex max-w-[60%] flex-col justify-end p-5 sm:p-6">
        <ToolMark tool={tool} size="md" />
        <span
          className="mt-3 font-display text-[26px] leading-none font-bold tracking-[-0.03em] text-ink sm:text-[30px]"
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          {tool.name}
        </span>
        <span className="mt-1.5 line-clamp-3 text-[13.5px] leading-snug text-ink-2 sm:text-[14.5px]">
          {tool.tagline}
        </span>
        <span
          className="mt-4 inline-flex h-10 w-fit items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold text-[#12110d] transition-transform duration-300 group-hover:translate-x-0.5"
          style={{ background: tool.accent }}
        >
          {action ?? 'Open'} <Icon name="arrow-right" size={15} />
        </span>
      </div>
    </IntentLink>
  );
}

/** A small lit tile: the mark, the name, a line, and the tool's light in the corner. */
export function TileCard({ tool, className }: { tool: Tool; className?: string }) {
  return (
    <IntentLink
      href={toolHref(tool)}
      className={cn(
        'group relative isolate flex min-h-[168px] min-w-0 flex-col overflow-hidden rounded-[22px] p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] outline-offset-4 transition-[transform,box-shadow] duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 hover:shadow-[inset_0_0_0_1px_var(--tile-accent)] sm:min-h-[184px] sm:p-5',
        className,
      )}
      style={
        {
          '--tile-accent': `color-mix(in oklab, ${tool.accent} 55%, transparent)`,
          background: `radial-gradient(80% 70% at 0% 0%, color-mix(in oklab, ${tool.accent} 22%, transparent), transparent 70%), #121211`,
        } as React.CSSProperties
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -bottom-7 -z-10 opacity-[.1] transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-6"
        style={{ color: tool.accent }}
      >
        <Icon name={tool.icon} size={120} strokeWidth={1.2} />
      </span>
      <ToolMark tool={tool} size="md" />
      <span className="mt-auto pt-4">
        <span className="flex items-center gap-2">
          <span className="truncate text-[16px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">
            {tool.name}
          </span>
          <StatusTag tool={tool} />
        </span>
        <span className="mt-1 line-clamp-2 block text-[13px] leading-snug text-muted sm:text-[13.5px]">
          {tool.tagline}
        </span>
      </span>
    </IntentLink>
  );
}
