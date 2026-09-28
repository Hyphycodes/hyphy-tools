'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  categories,
  drops,
  getCategory,
  inCategory,
  listedTools,
  type CategoryId,
  type Tool,
} from '@/lib/catalog';
import { ToolTile } from './cards';

type Filter = 'all' | 'drops' | CategoryId;

const FILTERS: { id: Filter; name: string }[] = [
  { id: 'all', name: 'Everything' },
  ...categories.map((category) => ({ id: category.id as Filter, name: category.name })),
  { id: 'drops', name: 'Drops' },
];

function parse(value: string | null): Filter {
  return FILTERS.some((filter) => filter.id === value) ? (value as Filter) : 'all';
}

function toolsFor(filter: Filter): Tool[] {
  if (filter === 'all') return listedTools;
  if (filter === 'drops') return drops;
  return inCategory(filter);
}

/** The row of filters. Static on first paint, live once the page knows its address. */
export function FilterBar({ value, onPick }: { value: Filter; onPick?: (filter: Filter) => void }) {
  return (
    <div className="sticky top-16 z-30 border-y border-line bg-[rgb(11_11_10/.78)] backdrop-blur-xl">
      <div
        role="toolbar"
        aria-label="Filter tools by what they help with"
        className="scrollbar-none mx-auto flex max-w-[1320px] gap-1.5 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8"
      >
        {FILTERS.map((filter) => {
          const on = filter.id === value;
          const count = filter.id === 'all' ? null : toolsFor(filter.id).length;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick?.(filter.id)}
              className={cn(
                'inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition-colors',
                on
                  ? 'bg-ink text-on-ink'
                  : 'bg-white/[.05] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] hover:bg-white/[.09] hover:text-ink',
              )}
            >
              {filter.name}
              {count !== null && (
                <span className={cn('mono-num text-[11px]', on ? 'text-on-ink/60' : 'text-faint')}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The address says which filter is on (`?c=money`), so a filtered view can be shared. */
function useFilter() {
  return parse(useSearchParams().get('c'));
}

function pick(next: Filter) {
  // The page itself doesn't change: update the address without asking the server.
  const search = next === 'all' ? '' : `?c=${next}`;
  // `null` state: Next.js picks up the new address and useSearchParams follows it.
  window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  const grid = document.getElementById('browse');
  const top = grid?.getBoundingClientRect().top ?? 0;
  if (next !== 'all' && (top < 0 || top > window.innerHeight * 0.7))
    grid?.scrollIntoView({ block: 'start' });
}

/** The filter bar, pinned under the header while you browse. */
export function LiveFilterBar() {
  return <FilterBar value={useFilter()} onPick={pick} />;
}

/**
 * Filter the marketplace by what a tool helps with. "Everything" is the editorial page; any other
 * filter swaps it for just those tools.
 */
export function FilteredTools() {
  const value = useFilter();

  useEffect(() => {
    const root = document.documentElement;
    if (value === 'all') delete root.dataset.filtering;
    else root.dataset.filtering = value;
    return () => {
      delete root.dataset.filtering;
    };
  }, [value]);

  if (value === 'all') return <div id="browse" className="scroll-mt-32" />;
  const shown = toolsFor(value);
  const category = value !== 'drops' ? getCategory(value) : null;

  return (
    <section
      id="browse"
      aria-live="polite"
      aria-label={category?.name ?? 'Drops'}
      className="mx-auto max-w-[1320px] scroll-mt-32 px-4 pt-12 pb-8 sm:px-6 lg:px-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="t-h2">{category?.name ?? 'Drops'}</h2>
          <p className="t-lead mt-3">
            {category?.line ?? 'Small, seasonal releases. Useful now, fun always.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => pick('all')}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white/[.06] px-4 text-[14px] text-ink-2 hover:bg-white/10 hover:text-ink"
        >
          <Icon name="x" size={15} /> Show everything
        </button>
      </div>
      <div className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((tool, index) => (
          <div key={tool.id} style={{ animation: `rise .5s var(--ease-out) ${index * 45}ms both` }}>
            <ToolTile
              tool={tool}
              context={value === 'drops' ? 'category' : 'family'}
              reveal={false}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
