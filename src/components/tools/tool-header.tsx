import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { statusLabel, type ToolDefinition } from '@/lib/platform/tools';

/**
 * The top of every tool: its color world, what it does and where the work happens. Kept slim so
 * the tool itself starts above the fold, especially on a phone.
 */
export function ToolHeader({
  tool,
  name,
  actions,
  note,
}: {
  tool: ToolDefinition;
  name?: string;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <header
      className="relative mb-5 overflow-hidden rounded-[22px] px-4 py-3.5 sm:px-5 sm:py-4 lg:mb-7"
      style={{
        background: `linear-gradient(100deg, color-mix(in oklab, ${tool.color} 30%, white), color-mix(in oklab, ${tool.color} 14%, white) 70%)`,
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-20 right-10 size-48 rounded-full opacity-50 blur-3xl"
        style={{ background: tool.color }}
      />
      <div className="relative flex items-center gap-3.5 sm:gap-4">
        <ToolGlyph tool={tool} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="display truncate text-[24px] sm:text-[28px]">{name ?? tool.name}</h1>
            {tool.status !== 'available' && (
              <Badge
                tone={tool.status === 'beta' ? 'signal' : 'outline'}
                dot
                className="bg-white/70"
              >
                {statusLabel[tool.status]}
              </Badge>
            )}
          </div>
          <p className="truncate text-[14px] text-ink/65">
            {tool.tagline}
            {tool.privacy && (
              <span className="hidden md:inline">
                <span className="mx-2 text-ink/25">·</span>
                <Icon name="lock" size={12.5} className="-mt-0.5 mr-1 inline" />
                {tool.privacy}
              </span>
            )}
          </p>
        </div>
        {actions && <div className="hidden shrink-0 flex-wrap gap-2 sm:flex">{actions}</div>}
      </div>
      {note && (
        <p className="relative mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink/60">
          {note}
        </p>
      )}
      {actions && <div className="relative mt-3 flex gap-2 sm:hidden [&>*]:flex-1">{actions}</div>}
    </header>
  );
}
