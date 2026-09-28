import { IntentLink } from '@/components/marketplace/intent-link';
import { ToolMark } from '@/components/marketplace/tool-mark';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { getTool, toolHref } from '@/lib/catalog';
import type { Situation } from '@/lib/catalog/modes';

/**
 * A situation: a human moment ("Dinner with people") and the two to four tools it takes. When
 * there's a natural order the tools sit on a path (a line joins them, first to last); otherwise
 * they're simply the tools for it. Every step opens its tool at once, and no category is named.
 */
export function SituationCard({
  situation,
  className,
  style,
}: {
  situation: Situation;
  className?: string;
  style?: React.CSSProperties;
}) {
  const titleId = `situation-${situation.id}`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn('situation relative flex min-w-0 flex-col p-4 sm:p-5', className)}
      style={style}
    >
      <header className="flex items-start gap-3 px-1">
        <span className="situation-icon grid size-10 shrink-0 place-items-center rounded-full">
          <Icon name={situation.icon} size={18} />
        </span>
        <div className="min-w-0">
          <h3
            id={titleId}
            className="font-display text-[19px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[20px]"
            style={{ fontVariationSettings: "'wdth' 106" }}
          >
            {situation.title}
          </h3>
          <p className="mt-0.5 text-[13.5px] leading-snug text-muted">{situation.line}</p>
        </div>
      </header>
      <ol
        className={cn('relative mt-3.5 grid gap-0.5', situation.ordered && 'situation-path')}
        aria-label={situation.ordered ? `${situation.title}, step by step` : situation.title}
      >
        {situation.steps.map((step, index) => {
          const tool = getTool(step.tool);
          return (
            <li key={`${step.tool}-${index}`} className="relative">
              <IntentLink
                href={toolHref(tool)}
                className="group flex min-h-[52px] items-center gap-3 rounded-[16px] px-1 py-1.5 transition-colors hover:bg-ink/[.05] active:bg-ink/[.08]"
              >
                <ToolMark tool={tool} size="md" className="relative z-[1]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {step.label}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted">{tool.name}</span>
                </span>
                <Icon
                  name="arrow-right"
                  size={16}
                  className="mr-1.5 shrink-0 text-faint transition-[transform,color] duration-300 group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </IntentLink>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
