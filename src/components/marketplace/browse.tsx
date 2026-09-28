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
  isReady,
  type CategoryId,
  type Tool,
} from '@/lib/catalog';
import { ToolCard } from './cards';

type Filter = 'all' | 'drops' | CategoryId;

/** The chips: everything, then each thing people come to do that has a tool open today. */
const CHIPS: { id: Filter; name: string }[] = [
  { id: 'all', name: 'All' },
  ...categories
    .filter((category) => inCategory(category.id).some(isReady))
    .map((category) => ({ id: category.id as Filter, name: category.name })),
];

/** Addresses that still open filtered, though they have no chip (older shared links). */
const KNOWN: Filter[] = [...categories.map((category) => category.id as Filter), 'drops'];

function parse(value: string | null): Filter {
  return value && KNOWN.includes(value as Filter) ? (value as Filter) : 'all';
}

function toolsFor(filter: Exclude<Filter, 'all'>): Tool[] {
  const tools = filter === 'drops' ? drops : inCategory(filter);
  // Open ones first.
  return [...tools].sort((a, b) => Number(isReady(b)) - Number(isReady(a)));
}

/** The row of filters. Static on first paint, live once the page knows its address. */
export function FilterBar({ value, onPick }: { value: Filter; onPick?: (filter: Filter) => void }) {
  return (
    <div className="sticky top-16 z-30 border-y border-line bg-[rgb(11_11_10/.94)]">
      <div
        role="toolbar"
        aria-label="Filter tools by what they help with"
        className="scrollbar-none mx-auto flex max-w-[1320px] gap-1.5 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8"
      >
        {CHIPS.map((filter) => {
          const on = filter.id === value;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick?.(filter.id)}
              className={cn(
                'inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] font-medium transition-colors',
                on
                  ? 'bg-ink text-on-ink'
                  : 'bg-white/[.05] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] hover:bg-white/[.09] hover:text-ink',
              )}
            >
              {filter.name}
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
  if (top < 0 || top > window.innerHeight * 0.7) grid?.scrollIntoView({ block: 'start' });
}

/** The filter bar, pinned under the header while you browse. */
export function LiveFilterBar() {
  return <FilterBar value={useFilter()} onPick={pick} />;
}

/**
 * Filter the marketplace by what a tool helps with. "All" is the editorial page; any other filter
 * swaps it for just those tools.
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
      className="mx-auto min-h-[70vh] max-w-[1320px] scroll-mt-32 px-4 pt-8 pb-8 sm:px-6 sm:pt-12 lg:px-8"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="t-h3 !text-[26px] sm:!text-[32px]">{category?.name ?? 'Drops'}</h2>
          <p className="mt-1 text-[14.5px] text-muted">
            {category?.line ?? 'Small, seasonal releases.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => pick('all')}
          aria-label="Show everything"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/[.06] px-3.5 text-[14px] text-ink-2 hover:bg-white/10 hover:text-ink"
        >
          <Icon name="x" size={15} /> All
        </button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 sm:mt-8 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-9 lg:grid-cols-4">
        {shown.map((tool, index) => (
          <div
            key={tool.id}
            style={{ animation: `rise .4s var(--ease-out) ${Math.min(index, 6) * 35}ms both` }}
          >
            <ToolCard tool={tool} />
          </div>
        ))}
      </div>
    </section>
  );
}
