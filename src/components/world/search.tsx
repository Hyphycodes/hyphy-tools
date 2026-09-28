'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ToolMark } from '@/components/marketplace/tool-mark';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { listedTools, privacyFacts, statusLabel, toolHref, type Tool } from '@/lib/catalog';
import { searchTools, type SearchResult } from '@/lib/catalog/search';

/*
 * Search, everywhere in the public world: the big box on the marketplace and ⌘K / "/" from any
 * page. Both read the same registry and the same people-language search.
 */

const OPEN_EVENT = 'hyphy:search';

/** Opens the search palette from anywhere (a header button, an empty state). */
export function openSearch(query = '') {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: query }));
}

export const EXAMPLES = [
  'split dinner',
  'resize photos',
  'make a QR',
  'find a time',
  'clean some files',
  'instagram size',
  'who’s bringing what',
  'merge PDFs',
];

export function useToolSearch(query: string) {
  const deferred = useDeferredValue(query);
  return useMemo(() => searchTools(deferred, listedTools, 8), [deferred]);
}

/**
 * The shared result list: keyboard-driven (↑ ↓ Enter), with the reason a tool matched when its
 * name alone wouldn't explain it.
 */
export function ResultList({
  id,
  results,
  active,
  onActive,
  onPick,
  className,
}: {
  id: string;
  results: SearchResult[];
  active: number;
  onActive: (index: number) => void;
  onPick: (tool: Tool) => void;
  className?: string;
}) {
  return (
    <ul id={id} role="listbox" aria-label="Matching tools" className={cn('grid gap-1', className)}>
      {results.map((result, index) => {
        const { tool } = result;
        const selected = index === active;
        return (
          <li
            key={tool.id}
            id={`${id}-${tool.id}`}
            role="option"
            aria-selected={selected}
            onMouseMove={() => !selected && onActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(tool)}
            className={cn(
              'group flex cursor-pointer items-center gap-3.5 rounded-[14px] px-3 py-2.5 transition-colors',
              selected ? 'bg-white/[.07]' : 'hover:bg-white/[.04]',
            )}
            style={{ animation: `rise .32s var(--ease-out) ${index * 28}ms both` }}
          >
            <ToolMark tool={tool} size="md" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[15.5px] font-semibold text-ink">{tool.name}</span>
                <span className="text-[12.5px] text-muted">{tool.kind}</span>
                {tool.status !== 'available' && (
                  <span className="label !text-[9.5px] !text-signal-ink">
                    {statusLabel[tool.status]}
                  </span>
                )}
              </span>
              <span className="block truncate text-[13.5px] text-ink-2/80">
                {result.because ? (
                  <>
                    For <span className="text-ink">“{result.because}”</span> · {tool.tagline}
                  </>
                ) : (
                  tool.tagline
                )}
              </span>
            </span>
            <span className="hidden shrink-0 items-center gap-1.5 text-[11.5px] text-muted sm:flex">
              {privacyFacts(tool).local && (
                <>
                  <Icon name="lock" size={12} /> On device
                </>
              )}
            </span>
            <Icon
              name="arrow-right"
              size={16}
              className={cn(
                'shrink-0 transition-all',
                selected ? 'translate-x-0 text-ink' : '-translate-x-1 text-transparent',
              )}
            />
          </li>
        );
      })}
    </ul>
  );
}

/** Keyboard handling shared by both search boxes. */
export function useResultKeys(results: SearchResult[], onPick: (tool: Tool) => void) {
  const [active, setActive] = useState(0);
  const count = results.length;
  const safeActive = count ? Math.min(active, count - 1) : 0;
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (!count) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActive((safeActive + 1) % count);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActive((safeActive - 1 + count) % count);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        onPick(results[safeActive].tool);
      }
    },
    [count, safeActive, results, onPick],
  );
  return { active: safeActive, setActive, onKeyDown };
}

/** ⌘K from anywhere in the public world. */
export function SearchPalette() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const results = useToolSearch(query);
  const pick = useCallback(
    (tool: Tool) => {
      dialog.current?.close();
      router.push(toolHref(tool));
    },
    [router],
  );
  const keys = useResultKeys(results, pick);
  const picks = useMemo(() => listedTools.filter((tool) => tool.featured).slice(0, 5), []);

  useEffect(() => {
    const open = (initial = '') => {
      const element = dialog.current;
      if (!element || element.open) return;
      setQuery(initial);
      keys.setActive(0);
      element.showModal();
      requestAnimationFrame(() => input.current?.focus());
    };
    const onOpen = (event: Event) => open((event as CustomEvent<string>).detail ?? '');
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? ''));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      } else if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener('keydown', onKey);
    };
    // `keys.setActive` is a state setter: stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label="Search tools"
      onClick={(event) => event.target === dialog.current && dialog.current?.close()}
      className="m-0 mx-auto mt-0 h-dvh max-h-none w-full max-w-none bg-transparent p-0 backdrop:backdrop-blur-sm sm:mt-[12vh] sm:h-auto sm:max-w-[640px] sm:px-4"
    >
      <div className="glass flex h-full animate-pop flex-col overflow-hidden sm:h-auto sm:max-h-[72vh] sm:rounded-[22px]">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <Icon name="search" size={20} className="text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              keys.setActive(0);
            }}
            onKeyDown={keys.onKeyDown}
            placeholder="What are you trying to do?"
            aria-label="Search tools"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-activedescendant={
              results[keys.active] ? `${listId}-${results[keys.active].tool.id}` : undefined
            }
            autoComplete="off"
            spellCheck={false}
            className="h-12 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded-[9px] px-2 py-1 text-[12.5px] text-muted hover:bg-white/5 hover:text-ink"
          >
            <span className="hidden sm:inline">Esc</span>
            <span className="sm:hidden">Close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-2.5">
          {query.trim() && results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[15px] font-medium text-ink">Nothing for “{query.trim()}” yet.</p>
              <p className="mt-1 text-[13.5px] text-muted">
                Try the job instead of a name: “split a check”, “crop a photo”.
              </p>
            </div>
          ) : query.trim() ? (
            <ResultList
              id={listId}
              results={results}
              active={keys.active}
              onActive={keys.setActive}
              onPick={pick}
            />
          ) : (
            <div className="grid gap-4 p-2">
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.slice(0, 6).map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setQuery(example);
                      input.current?.focus();
                    }}
                    className="rounded-full bg-white/[.06] px-3 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-white/[.1] hover:text-ink"
                  >
                    {example}
                  </button>
                ))}
              </div>
              <div>
                <p className="label mb-1.5 px-1">Start here</p>
                <ResultList
                  id={listId}
                  results={picks.map((tool) => ({ tool, score: 0 }))}
                  active={-1}
                  onActive={() => {}}
                  onPick={pick}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
