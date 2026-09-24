import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { statusLabel, type ToolDefinition } from '@/lib/platform/tools';

/** The top of every tool: its color world, what it does and where the work happens. */
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
      className="relative mb-6 overflow-hidden rounded-[24px] px-5 py-5 sm:px-7 sm:py-6 lg:mb-8"
      style={{ background: `color-mix(in oklab, ${tool.color} 34%, white)` }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 size-56 rounded-full opacity-60 blur-3xl"
        style={{ background: `color-mix(in oklab, ${tool.color} 70%, white)` }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <ToolGlyph tool={tool} size="xl" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="display text-[28px] sm:text-[34px]">{name ?? tool.name}</h1>
              <Badge
                tone={
                  tool.status === 'available'
                    ? 'positive'
                    : tool.status === 'beta'
                      ? 'signal'
                      : 'outline'
                }
                dot
                className="bg-white/70"
              >
                {statusLabel[tool.status]}
              </Badge>
            </div>
            <p className="text-[15px] text-ink/70">{tool.tagline}</p>
          </div>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {(tool.privacy || note) && (
        <p className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink/65">
          {tool.privacy && (
            <span className="flex items-center gap-1.5">
              <Icon name="lock" size={14} /> {tool.privacy}
            </span>
          )}
          {note}
        </p>
      )}
    </header>
  );
}
