'use client';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useCreate } from '@/components/create/create-context';
import { previewAs } from '@/lib/demo/actions';
import type { SearchItem } from '@/lib/search';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';

type CommandValue = { open: () => void };
const CommandContext = createContext<CommandValue>({ open: () => {} });
export const useCommand = () => useContext(CommandContext);

const GROUP_ORDER: SearchItem['group'][] = [
  'Needs attention',
  'Actions',
  'Projects',
  'Vehicles',
  'People',
  'Receipts',
  'Files',
  'Tools',
  'Go to',
  'Spaces',
  'Preview as',
];

function words(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Every query word must start a word somewhere in the item; titles weigh most. */
function score(item: SearchItem, query: string[]) {
  const title = words(item.title);
  const rest = words(`${item.subtitle ?? ''} ${item.keywords ?? ''} ${item.group}`);
  let total = 0;
  for (const word of query) {
    if (title.some((part) => part === word)) total += 6;
    else if (title.some((part) => part.startsWith(word))) total += 4;
    else if (item.title.toLowerCase().includes(word)) total += 2;
    else if (rest.some((part) => part.startsWith(word))) total += 1;
    else return 0;
  }
  // A title that starts with what you typed beats one that merely contains it.
  const starts = item.title.toLowerCase().startsWith(query.join(' ')) ? 1 : 0;
  return total + starts + (item.boost ?? 0) + (item.group === 'Actions' ? 0.5 : 0);
}

function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, textarea, select, [contenteditable="true"]'));
}

export function CommandProvider({ items, children }: { items: SearchItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const create = useCreate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (document.querySelector('dialog[open]')) return;
      if (event.key === '/') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault();
        create.setMenuOpen(!create.menuOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [create]);

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <CommandContext.Provider value={value}>
      {children}
      <CommandPalette items={items} open={open} onClose={() => setOpen(false)} />
    </CommandContext.Provider>
  );
}

function CommandPalette({
  items,
  open,
  onClose,
}: {
  items: SearchItem[];
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const create = useCreate();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setQuery('');
      setActive(0);
    }
    if (!open && element.open) element.close();
  }, [open]);

  const groups = useMemo(() => {
    const terms = words(deferred);
    let ranked: SearchItem[];
    if (!terms.length) {
      // Before you type: what needs you, what you'd make, the work in motion, where to go.
      ranked = [
        ...items.filter((item) => item.group === 'Needs attention'),
        ...items.filter((item) => item.group === 'Actions').slice(0, 4),
        ...items.filter((item) => item.group === 'Projects' && (item.boost ?? 0) > 0).slice(0, 3),
        ...items.filter((item) => item.group === 'Go to').slice(0, 6),
        ...items.filter((item) => item.group === 'Spaces'),
      ];
    } else {
      ranked = items
        .map((item) => ({ item, value: score(item, terms) }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((entry) => entry.item);
    }
    const map = new Map<SearchItem['group'], SearchItem[]>();
    for (const item of ranked) {
      const bucket = map.get(item.group) ?? [];
      if (bucket.length < (terms.length ? 6 : 8)) bucket.push(item);
      map.set(item.group, bucket);
    }
    const order = terms.length
      ? [...map.keys()].sort((a, b) => {
          const best = (group: SearchItem['group']) =>
            ranked.findIndex((item) => item.group === group);
          return best(a) - best(b);
        })
      : GROUP_ORDER.filter((group) => map.has(group));
    return order.map((group) => ({ group, items: map.get(group)! }));
  }, [items, deferred]);

  const flat = groups.flatMap((group) => group.items);
  const current = Math.min(active, Math.max(flat.length - 1, 0));

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = useCallback(
    (item: SearchItem) => {
      onClose();
      if (item.create) create.start(item.create);
      else if (item.preview) {
        const data = new FormData();
        data.set('personId', item.preview.personId);
        data.set('space', item.preview.space);
        void previewAs(data);
      } else if (item.href) router.push(item.href);
    },
    [create, onClose, router],
  );

  return (
    <dialog
      ref={dialog}
      aria-label="Search and commands"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => event.target === dialog.current && onClose()}
      className={cn(
        'fixed m-0 hidden max-w-none flex-col overflow-hidden bg-surface p-0 text-ink shadow-pop outline-none open:flex',
        'inset-0 h-dvh max-h-none w-full animate-fade',
        'sm:inset-x-0 sm:top-[11vh] sm:bottom-auto sm:mx-auto sm:h-auto sm:max-h-[min(620px,78vh)] sm:w-[min(660px,calc(100%-32px))] sm:rounded-[20px] sm:animate-pop',
      )}
    >
      <div className="safe-top flex items-center gap-3 border-b border-line px-4 sm:px-5">
        <Icon name="search" size={19} className="text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, flat.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter' && flat[current]) {
              event.preventDefault();
              run(flat[current]);
            }
          }}
          placeholder="Search projects, people, files, tools — or type an action"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={flat[current] ? `cmd-${flat[current].id}` : undefined}
          className="h-16 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-faint sm:h-[60px] sm:text-[16px]"
        />
        <button
          type="button"
          onClick={onClose}
          className="rounded-[8px] px-2 py-1 text-[13px] font-medium text-muted hover:bg-ink/5 sm:hidden"
        >
          Cancel
        </button>
        <Kbd className="hidden sm:inline-grid">esc</Kbd>
      </div>

      <div
        ref={list}
        id="command-results"
        role="listbox"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {flat.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-14 text-center">
            <span className="mb-4 grid size-11 place-items-center rounded-[13px] bg-well text-muted">
              <Icon name="search" size={20} />
            </span>
            <p className="text-[15px] font-medium">Nothing matches “{query}”.</p>
            <p className="mt-1 max-w-[40ch] text-[13.5px] text-muted">
              Search finds projects, people, vehicles, receipts, files and tools you can see here —
              or type what you want to do, like “log mileage”.
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.group} className="mb-1">
              <p className="label px-3 pt-2.5 pb-1.5">
                {deferred
                  ? group.group
                  : group.group === 'Actions'
                    ? 'Create'
                    : group.group === 'Projects'
                      ? 'In motion'
                      : group.group}
              </p>
              {group.items.map((item) => {
                const index = flat.indexOf(item);
                const selected = index === current;
                return (
                  <button
                    key={item.id}
                    id={`cmd-${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    onMouseMove={() => setActive(index)}
                    onClick={() => run(item)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition-colors',
                      selected ? 'bg-ink/[.055]' : 'hover:bg-ink/[.04]',
                    )}
                  >
                    <Visual visual={item.visual} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink sm:text-[14px]">
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className="block truncate text-[13px] text-muted sm:text-[12.5px]">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <Icon name="enter" size={15} className="hidden text-faint sm:block" />
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="hidden items-center gap-4 border-t border-line bg-subtle px-5 py-2.5 text-[12px] text-muted sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> move
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> open
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Kbd>C</Kbd> create anywhere
        </span>
      </div>
    </dialog>
  );
}

function Visual({ visual }: { visual: SearchItem['visual'] }) {
  const box = 'grid size-8 shrink-0 place-items-center';
  switch (visual.kind) {
    case 'tool':
      return (
        <span
          className={cn(box, 'rounded-[9px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.07)]')}
          style={{ background: visual.color, color: visual.ink === 'light' ? '#fff' : '#16150F' }}
        >
          <Icon name={visual.icon} size={16} strokeWidth={1.9} />
        </span>
      );
    case 'person':
      return (
        <span
          className={cn(box, 'rounded-full text-[11px] font-semibold text-white')}
          style={{ background: visual.hue }}
        >
          {visual.initials}
        </span>
      );
    case 'space':
      return (
        <span
          className={cn(
            box,
            'font-display text-[10.5px] font-bold',
            visual.round ? 'rounded-full' : 'rounded-[9px]',
          )}
          style={{ background: visual.color, color: visual.ink === 'light' ? '#fff' : '#16150F' }}
        >
          {visual.spark ? <Icon name="spark" size={14} /> : visual.monogram}
        </span>
      );
    default:
      return (
        <span
          className={cn(
            box,
            'rounded-[9px] bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]',
          )}
        >
          <Icon name={visual.icon} size={16} />
        </span>
      );
  }
}
