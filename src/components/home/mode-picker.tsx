'use client';
import { ToolMark } from '@/components/marketplace/tool-mark';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { EVERYTHING, modes, starterTools, type Lens } from '@/lib/catalog/modes';
import { chooseLens } from './use-home';

/**
 * The first visit asks one thing, once: what are you here for? One tap, nothing else. Each
 * choice is a small window into its mode (its colors, a few of its tools); "Show me everything"
 * keeps the whole catalog. It can be changed any time from the home.
 */
export function ModePicker({ onPicked }: { onPicked?: (lens: Lens) => void }) {
  const pick = (lens: Lens) => {
    chooseLens(lens);
    onPicked?.(lens);
    window.scrollTo({ top: 0 });
  };
  return (
    <div>
      <ul className="grid gap-2.5 sm:grid-cols-3 sm:gap-4" aria-label="Modes">
        {modes.map((mode, index) => (
          <li
            key={mode.id}
            className="animate-rise"
            style={{ animationDelay: `${80 + index * 60}ms` }}
          >
            <button
              type="button"
              onClick={() => pick(mode.id)}
              data-preview={mode.id}
              className={cn(
                'mode-preview group relative isolate flex w-full items-center gap-4 overflow-hidden rounded-[24px] p-4 text-left outline-offset-4 transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] hover:-translate-y-1 active:scale-[.98] sm:min-h-[240px] sm:flex-col sm:items-start sm:justify-between sm:p-6',
              )}
            >
              <span className="flex shrink-0 -space-x-2.5 sm:order-last">
                {starterTools(mode.id, 3).map((tool) => (
                  <ToolMark
                    key={tool.id}
                    tool={tool}
                    size="md"
                    className="ring-2 ring-[var(--preview-bg)] transition-transform duration-500 group-hover:-translate-y-0.5 sm:!size-12"
                  />
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block font-display text-[26px] leading-none font-bold tracking-[-0.03em] sm:text-[40px]"
                  style={{ fontVariationSettings: "'wdth' 112" }}
                >
                  {mode.name}
                </span>
                <span className="mt-1.5 block text-[14px] leading-snug opacity-75 sm:text-[15.5px]">
                  {mode.line}
                </span>
              </span>
              <Icon
                name="arrow-right"
                size={18}
                className="shrink-0 opacity-60 transition-transform duration-300 group-hover:translate-x-1 sm:absolute sm:top-6 sm:right-6"
              />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => pick('all')}
        className="mt-3 inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-colors hover:bg-ink/[.06] hover:text-ink sm:mt-4"
      >
        <Icon name="grid" size={17} /> Show me everything
        <span className="sr-only">: {EVERYTHING.line}</span>
      </button>
    </div>
  );
}
