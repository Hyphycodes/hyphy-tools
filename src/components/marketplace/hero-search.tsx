'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { toolHref, type Tool } from '@/lib/catalog';
import { EXAMPLES, ResultList, useResultKeys, useToolSearch } from '@/components/world/search';

/** Jumps for the most common jobs, straight to the tool. */
const INTENTS: { label: string; slug: string }[] = [
  { label: 'Split a check', slug: 'split' },
  { label: 'Find a time', slug: 'when' },
  { label: 'Make a QR code', slug: 'qr' },
  { label: 'Resize photos', slug: 'resize' },
  { label: 'Merge PDFs', slug: 'pdf' },
  { label: 'Crop for Instagram', slug: 'social-crop' },
];

/** The examples type themselves into an empty box, one after another, until you start. */
function useTypedExample(active: boolean) {
  const [text, setText] = useState(EXAMPLES[0]);
  useEffect(() => {
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let index = Math.max(0, EXAMPLES.indexOf(text));
    let length = EXAMPLES[index].length;
    let phase: 'hold' | 'delete' | 'type' = 'hold';
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (phase === 'hold') phase = 'delete';
      if (phase === 'delete') {
        length -= 1;
        setText(EXAMPLES[index].slice(0, Math.max(0, length)));
        if (length > 0) timer = setTimeout(step, 26);
        else {
          phase = 'type';
          index = (index + 1) % EXAMPLES.length;
          timer = setTimeout(step, 320);
        }
        return;
      }
      length += 1;
      setText(EXAMPLES[index].slice(0, length));
      if (length < EXAMPLES[index].length) timer = setTimeout(step, 60);
      else {
        phase = 'hold';
        timer = setTimeout(step, 2200);
      }
    };
    timer = setTimeout(step, 2400);
    return () => {
      clearTimeout(timer);
      // Paused (you're typing): leave a whole example behind, not half a word.
      setText(EXAMPLES[index]);
    };
    // Restarts only when it starts or stops; `text` is read once to resume where it was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return text;
}

/**
 * The marketplace's centerpiece: say what you're trying to do, in your words. Results appear as
 * you type; Enter opens the best one.
 */
export function HeroSearch() {
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const results = useToolSearch(query);
  const open = useCallback((tool: Tool) => router.push(toolHref(tool)), [router]);
  const keys = useResultKeys(results, open);
  const typing = query.trim().length > 0;
  const example = useTypedExample(!typing && !focused);

  return (
    <div className="w-full max-w-[760px]">
      <label htmlFor={`${listId}-input`} className="label mb-3 block !text-ink-2">
        What are you trying to do?
      </label>
      <div
        className={cn(
          'relative flex items-center gap-3 rounded-[22px] bg-[rgb(26_26_23/.78)] px-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/.1),0_30px_80px_-40px_rgb(0_0_0/.9)] backdrop-blur-xl transition-shadow duration-300 sm:gap-4 sm:px-5',
          focused &&
            'shadow-[inset_0_0_0_1.5px_rgb(185_190_255/.55),0_0_0_6px_rgb(106_116_255/.12),0_30px_80px_-40px_rgb(0_0_0/.9)]',
        )}
      >
        <Icon name="search" size={22} className="shrink-0 text-muted" />
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
            className="h-16 w-full bg-transparent text-[18px] text-ink outline-none sm:h-[72px] sm:text-[21px]"
          />
          {!typing && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[18px] text-faint sm:text-[21px]"
            >
              {example}
              {!focused && (
                <span className="ml-0.5 inline-block h-[1.1em] w-[2px] animate-pulse bg-faint/80" />
              )}
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
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-ink"
            aria-label="Clear search"
          >
            <Icon name="x" size={18} />
          </button>
        ) : (
          <span className="hidden shrink-0 rounded-full bg-white/[.06] px-3 py-1.5 text-[12px] text-muted sm:block">
            Try “{EXAMPLES[1]}”
          </span>
        )}
      </div>
      <p id={`${listId}-hint`} className="sr-only">
        Results appear as you type. Use the arrow keys to choose and Enter to open.
      </p>

      {typing ? (
        <div className="mt-3 rounded-[22px] bg-[rgb(21_21_19/.86)] p-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] backdrop-blur-xl">
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
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Popular jobs">
          {INTENTS.map((intent) => (
            <li key={intent.slug}>
              <Link
                href={`/tools/${intent.slug}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[.055] px-3.5 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.07)] transition-colors hover:bg-white/[.1] hover:text-ink"
              >
                {intent.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
