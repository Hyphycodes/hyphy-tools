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
        tool.status === 'beta' ? 'bg-signal-soft text-signal-ink' : 'bg-white/[.07] text-muted',
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
        'group flex min-h-[68px] min-w-0 items-center gap-3.5 rounded-[16px] px-2.5 py-2.5 transition-colors hover:bg-white/[.045] active:bg-white/[.06]',
        className,
      )}
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
        <span className="hidden h-8 shrink-0 items-center rounded-full bg-white/[.07] px-3.5 text-[13px] font-semibold text-ink transition-colors group-hover:bg-white/[.12] min-[380px]:inline-flex">
          Open
        </span>
      ) : (
        <Icon name="chevron-right" size={16} className="shrink-0 text-faint" />
      )}
    </IntentLink>
  );
}
