'use client';
import { useRouter } from 'next/navigation';
import { IntentLink } from '@/components/marketplace/intent-link';
import { ToolMark } from '@/components/marketplace/tool-mark';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { getTool, toolHref } from '@/lib/catalog';
import type { ToolId } from '@/lib/catalog/schema';
import { carry } from '@/lib/share/carry';

/*
 * What to do next, from what just happened: "Frame it for social" once a photo is resized,
 * "Add a receipt" once a drive is logged. Quiet, one line, only where the relationship is real;
 * never "you may also like". A step can carry a file to the next tool (lib/share/carry).
 */

export type Step = {
  tool: ToolId;
  /** The outcome in words: "Frame it for social". */
  label: string;
  /** A file to hand the next tool, so nothing is chosen twice. */
  file?: File;
};

export function NextSteps({
  from,
  steps,
  title = 'Next',
  className,
}: {
  from: ToolId;
  steps: Step[];
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  if (!steps.length) return null;
  return (
    <nav
      aria-label="What to do next"
      className={cn('fx-rise flex flex-wrap items-center gap-x-2 gap-y-2', className)}
    >
      <span className="mr-1 text-[13px] font-semibold text-muted">{title}</span>
      {steps.map((step) => {
        const tool = getTool(step.tool);
        const inside = (
          <>
            <ToolMark tool={tool} size="sm" className="!size-7 !rounded-[8px]" />
            <span>{step.label}</span>
            <Icon name="arrow-right" size={14} className="text-muted" />
          </>
        );
        const look =
          'inline-flex h-11 items-center gap-2 rounded-full bg-ink/[.06] pr-3.5 pl-2 text-[14px] font-semibold text-ink transition-colors hover:bg-ink/[.1]';
        return step.file ? (
          <button
            key={step.tool}
            type="button"
            className={look}
            onClick={() => {
              carry(step.file!, from, step.tool);
              router.push(toolHref(tool));
            }}
          >
            {inside}
          </button>
        ) : (
          <IntentLink key={step.tool} href={toolHref(tool)} className={look}>
            {inside}
          </IntentLink>
        );
      })}
    </nav>
  );
}
