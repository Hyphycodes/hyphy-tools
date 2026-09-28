'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { toolHref, type Tool } from '@/lib/catalog';
import type { ModeId } from '@/lib/catalog/schema';
import { EXAMPLES, ResultList, useResultKeys, useToolSearch } from '@/components/world/search';

/**
 * An example of what to type, changing every few seconds while the box is empty and idle. One
 * render per example (a CSS fade does the rest): it used to type itself letter by letter, which
 * re-rendered the search box every 26–60ms for as long as the page was open.
 */
function useExample(active: boolean, examples: string[]) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((current) => current + 1), 3200);
    return () => clearInterval(timer);
  }, [active]);
  return examples[index % examples.length];
}

/**
 * The marketplace's centerpiece: say what you're trying to do, in your words. Results appear as
 * you type; Enter opens the best one. On a mode's home it leans toward that mode's tools and
 * rotates that mode's examples; it still searches every tool.
 */
export function HeroSearch({
  label = 'Or search every tool',
  mode = null,
  examples = EXAMPLES,
  compact = false,
}: {
  label?: string;
  mode?: ModeId | null;
  examples?: string[];
  compact?: boolean;
} = {}) {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const results = useToolSearch(query, mode);
  const open = useCallback((tool: Tool) => router.push(toolHref(tool)), [router]);
  const keys = useResultKeys(results, open);
  const typing = query.trim().length > 0;
  const example = useExample(!typing && !focused, examples);
  const size = compact ? 'text-[17px] sm:text-[18px]' : 'text-[18px] sm:text-[21px]';

  return (
    <div className="w-full max-w-[760px]">
      <label
        htmlFor={`${listId}-input`}
        className={cn('label mb-3 block !text-ink-2', compact && 'sr-only')}
      >
        {label}
      </label>
      <div
        className={cn(
          'hero-search relative flex items-center gap-3 rounded-[22px] px-4 backdrop-blur-xl transition-shadow duration-300 sm:gap-4 sm:px-5',
          focused && 'is-focused',
        )}
      >
        <Icon name="search" size={compact ? 20 : 22} className="shrink-0 text-muted" />
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            id={`${listId}-input`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              keys.setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
              keys.onKeyDown(event);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            role="combobox"
            aria-expanded={typing && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              typing && results[keys.active]
                ? `${listId}-${results[keys.active].tool.id}`
                : undefined
            }
            aria-describedby={`${listId}-hint`}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className={cn(
              'w-full bg-transparent text-ink outline-none',
              compact ? 'h-14 sm:h-[60px]' : 'h-16 sm:h-[72px]',
              size,
            )}
          />
          {!typing && (
            <span
              key={example}
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute inset-y-0 left-0 flex animate-fade items-center truncate text-faint',
                size,
              )}
            >
              {example}
            </span>
          )}
        </div>
        {typing ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/10 hover:text-ink"
            aria-label="Clear search"
          >
            <Icon name="x" size={18} />
          </button>
        ) : (
          <span className="hidden shrink-0 rounded-full bg-ink/[.06] px-3 py-1.5 text-[12px] text-muted sm:block">
            Try “{examples[1 % examples.length]}”
          </span>
        )}
      </div>
      <p id={`${listId}-hint`} className="sr-only">
        Results appear as you type. Use the arrow keys to choose and Enter to open.
      </p>

      {typing ? (
        <div className="hero-results mt-3 rounded-[22px] p-2 backdrop-blur-xl">
          {results.length ? (
            <ResultList
              id={listId}
              results={results.slice(0, 6)}
              active={keys.active}
              onActive={keys.setActive}
              onPick={open}
            />
          ) : (
            <p className="px-4 py-6 text-[14.5px] text-muted" role="status">
              Nothing for “{query.trim()}” yet. Try the job instead of a name: “split a check”,
              “crop a photo”, “rename files”.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
