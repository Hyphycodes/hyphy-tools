'use client';
import {
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { downloadText } from '@/lib/files/download';
import { newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import { allocate, formatMoney, minorUnits } from '@/lib/tools/split';
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  changeCurrency,
  chargeAt,
  chargesPerYear,
  CURRENCIES,
  daysBetween,
  draftOf,
  emptyDraft,
  exportJson,
  formatDay,
  frequencyLabel,
  localToday,
  MAX_EVERY,
  MAX_ITEMS,
  mergeItems,
  monthlyCost,
  newList,
  nextCharge,
  nextCharges,
  parseDay,
  priceText,
  readDraft,
  readImport,
  relativeDay,
  sampleItems,
  scheduleOf,
  SOON_DAYS,
  SORTS,
  sortSubscriptions,
  subscriptionListSchema,
  summarize,
  toCsv,
  UNITS,
  unitWord,
  webLink,
  yearlyCost,
  type CategoryId,
  type Currency,
  type Draft,
  type DraftErrors,
  type Imported,
  type SortBy,
  type Subscription,
  type SubscriptionFields,
  type SubscriptionList,
  type Summary,
} from '@/lib/tools/subscriptions';
import { ActionButton, CountUp, Label, SampleButton } from './kit';
import { MoneyInput } from './money-input';

/*
 * Subscriptions: what you pay for, kept in this browser, and what it all really costs.
 *
 * The way in is a wall of tiles: tap what you pay for, and it arrives with a typical price that
 * steppers and chips adjust (typing is the fallback). The object is the ring and the year's
 * total, counting as things are added; the payoff is that number, what charges next, and the
 * things that could go, tapped to see what cutting them would save.
 */

const STORAGE_KEY = 'hyphy.subscriptions.v1';
const MAX_IMPORT_BYTES = 2_000_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACCENT = 'var(--accent, var(--color-ink))';
const GLOW = 'var(--glow, var(--accent, var(--color-ink)))';
const ON_ACCENT = 'text-[var(--on-accent,#12110d)]';
/** CountUp sets numbers in mono; the big ones keep the display face around them. */
const DISPLAY_NUM =
  '![font-family:inherit] ![font-variation-settings:inherit] ![letter-spacing:inherit]';

/** Each category's mark: an icon on a color, so the list reads at a glance (the name says it too). */
const LOOK: Record<CategoryId, { icon: IconName; color: string }> = {
  streaming: { icon: 'play', color: '#ff8ad8' },
  music: { icon: 'music', color: '#c7b5ff' },
  software: { icon: 'command', color: '#8f9bff' },
  cloud: { icon: 'archive', color: '#7fd4ff' },
  fitness: { icon: 'activity', color: '#b8f35a' },
  news: { icon: 'file-text', color: '#ffc53d' },
  shopping: { icon: 'basket', color: '#ff6f91' },
  food: { icon: 'utensils', color: '#ff9e7a' },
  utilities: { icon: 'home', color: '#7ce0c3' },
  other: { icon: 'tag', color: '#b9b4a8' },
};

/**
 * The kinds of things most people pay for: one tap to start one, with a typical price already in
 * (`price`, in US cents per `unit`) and a few common price points to tap instead of typing. They
 * are rough guesses for a first number, not anyone's real price list.
 */
type Preset = {
  id: string;
  name: string;
  category: CategoryId;
  icon: IconName;
  unit: 'week' | 'month' | 'year';
  price: number;
  points: number[];
};
const PRESETS: Preset[] = [
  {
    id: 'streaming',
    name: 'Streaming',
    category: 'streaming',
    icon: 'play',
    unit: 'month',
    price: 1549,
    points: [799, 1199, 1549, 2299],
  },
  {
    id: 'music',
    name: 'Music',
    category: 'music',
    icon: 'music',
    unit: 'month',
    price: 1099,
    points: [599, 1099, 1699, 1999],
  },
  {
    id: 'cloud',
    name: 'Cloud storage',
    category: 'cloud',
    icon: 'archive',
    unit: 'month',
    price: 299,
    points: [99, 299, 999, 1999],
  },
  {
    id: 'gym',
    name: 'Gym',
    category: 'fitness',
    icon: 'activity',
    unit: 'month',
    price: 3900,
    points: [1000, 2500, 3900, 6000],
  },
  {
    id: 'phone',
    name: 'Phone plan',
    category: 'utilities',
    icon: 'phone',
    unit: 'month',
    price: 4500,
    points: [2500, 3500, 4500, 6500],
  },
  {
    id: 'internet',
    name: 'Internet',
    category: 'utilities',
    icon: 'wifi',
    unit: 'month',
    price: 6000,
    points: [4000, 5000, 6000, 8000],
  },
  {
    id: 'news',
    name: 'News',
    category: 'news',
    icon: 'file-text',
    unit: 'month',
    price: 999,
    points: [499, 999, 1499, 1999],
  },
  {
    id: 'apps',
    name: 'Apps',
    category: 'software',
    icon: 'command',
    unit: 'month',
    price: 999,
    points: [299, 499, 999, 1999],
  },
  {
    id: 'games',
    name: 'Games',
    category: 'other',
    icon: 'dice',
    unit: 'month',
    price: 1499,
    points: [499, 999, 1499, 1999],
  },
  {
    id: 'meals',
    name: 'Meal kit',
    category: 'food',
    icon: 'utensils',
    unit: 'week',
    price: 6000,
    points: [4500, 6000, 7500, 9000],
  },
  {
    id: 'delivery',
    name: 'Delivery pass',
    category: 'shopping',
    icon: 'truck',
    unit: 'month',
    price: 999,
    points: [499, 799, 999, 1499],
  },
];

/** Roughly what a US price looks like in another currency, for a first guess only. */
const PRICE_FACTOR: Record<Currency, number> = {
  USD: 1,
  CAD: 1.35,
  EUR: 0.95,
  GBP: 0.8,
  AUD: 1.5,
  MXN: 18,
  JPY: 150,
};

/** A tidy price in minor units: "20.99", "280", "¥2,320". */
function tidy(major: number, currency: Currency) {
  const digits = minorUnits(currency);
  if (digits === 0) return Math.max(10, Math.round(major / 10) * 10);
  const scale = 10 ** digits;
  if (major >= 100) return Math.round(major / 10) * 10 * scale;
  return Math.max(1, Math.round(major)) * scale - 1;
}

/** A US-cents guess, in the list's currency. */
function localPrice(usCents: number, currency: Currency) {
  if (currency === 'USD') return usCents;
  return tidy((usCents / 100) * PRICE_FACTOR[currency], currency);
}

/** One tap of − or +: a whole unit of the currency (ten pesos, a hundred yen). */
const stepOf = (currency: Currency) =>
  minorUnits(currency) === 0 ? 100 : currency === 'MXN' ? 1000 : 100;

type Simple = 'week' | 'month' | 'year';
/** The same spend, charged on another simple cycle, tidied ($15.49 a month → $185.99 a year). */
function convert(cost: number, from: Simple, to: Simple, currency: Currency) {
  if (from === to || cost <= 0) return cost;
  const yearly = cost * chargesPerYear({ every: 1, unit: from });
  const next = yearly / chargesPerYear({ every: 1, unit: to });
  return tidy(next / 10 ** minorUnits(currency), currency);
}

const SORT_LABELS: Record<SortBy, string> = { next: 'Next charge', cost: 'Cost', name: 'Name' };

const simpleOf = (draft: Draft): Simple | null =>
  draft.frequency === 'week' || draft.frequency === 'month' || draft.frequency === 'year'
    ? draft.frequency
    : null;

const field =
  'h-11 w-full min-w-0 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_0_4px_color-mix(in_srgb,var(--color-signal)_18%,transparent)] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-critical)] lg:h-10 lg:text-[14.5px]';
const quietButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-well px-3.5 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-9 lg:text-[13.5px]';
const inkButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-ink px-4 text-[15px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40 lg:h-10 lg:text-[14px]';

// Today follows the clock, so a tab left open overnight moves on to the new day.
function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

/** The local calendar date, or '' while rendering on the server (which has no idea where you are). */
function useToday() {
  return useSyncExternalStore(subscribeToClock, localToday, () => '');
}

const percent = (share: number) =>
  share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;

/** "$1,284": the big numbers, without cents. */
function wholeMoney(amount: number, currency: Currency) {
  const digits = minorUnits(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount / 10 ** digits));
}

/** "Oct 3", with the year only when it isn't this one. */
const dayText = (date: string, today: string, weekday = false) =>
  formatDay(date, { weekday, year: date.slice(0, 4) !== today.slice(0, 4) });

/** A first guess for the next charge: one cycle from today. Changed under More options. */
function guessNext(draft: Draft, today: string) {
  const schedule = scheduleOf(draft);
  return schedule ? chargeAt({ next: today, ...schedule }, 1) : '';
}

function CategoryMark({
  category,
  icon,
  size = 'md',
  className,
}: {
  category: CategoryId;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const look = LOOK[category];
  return (
    <span
      aria-hidden="true"
      // The marks are always light pastels, so their ink is always dark.
      className={cn(
        'grid shrink-0 place-items-center text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
        size === 'lg' && 'size-12 rounded-[15px]',
        size === 'md' && 'size-10 rounded-[12px]',
        size === 'sm' && 'size-8 rounded-[10px]',
        className,
      )}
      style={{ background: look.color }}
    >
      <Icon name={icon ?? look.icon} size={size === 'lg' ? 21 : size === 'md' ? 18 : 15} />
    </span>
  );
}

export function SubscriptionsTool() {
  const id = useId();
  const toast = useToast();
  const today = useToday();
  const [list, setList, { loaded }] = useLocalState<SubscriptionList>(
    STORAGE_KEY,
    subscriptionListSchema,
    newList(),
  );
  const [addingChosen, setAdding] = useState(false);
  const [picked, setPicked] = useState<Preset | 'other' | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ item: Subscription; index: number } | null>(null);
  const [incoming, setIncoming] = useState<{ file: string; data: Imported } | null>(null);
  const [importError, setImportError] = useState('');
  // "What could go": tapped, not saved. The totals show the list without them.
  const [cut, setCut] = useState<Set<string>>(() => new Set());
  const [announce, setAnnounce] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const overviewRef = useRef<HTMLElement>(null);

  const ready = loaded && today !== '';
  const { items, currency } = list;
  const empty = items.length === 0;
  const adding = addingChosen || empty;
  const cutIds = useMemo(
    () => new Set(items.filter((item) => cut.has(item.id) && !item.paused).map((item) => item.id)),
    [items, cut],
  );
  const summary = useMemo(() => (ready ? summarize(items, today) : null), [ready, items, today]);
  const after = useMemo(
    () =>
      ready && cutIds.size
        ? summarize(
            items.map((item) => (cutIds.has(item.id) ? { ...item, paused: true } : item)),
            today,
          )
        : summary,
    [ready, items, today, cutIds, summary],
  );
  const sorted = useMemo(
    () => (ready ? sortSubscriptions(items, list.sort, today) : []),
    [ready, items, list.sort, today],
  );
  const samples = items.filter((item) => item.sample).length;
  const full = items.length >= MAX_ITEMS;

  const updateItems = (change: (current: Subscription[]) => Subscription[]) =>
    setList((current) => ({ ...current, items: change(current.items) }));

  const focusLater = (elementId: string) =>
    requestAnimationFrame(() => document.getElementById(elementId)?.focus());

  const pick = (choice: Preset | 'other') => {
    setPicked(choice);
    setFormKey((key) => key + 1);
  };

  const unpick = () => {
    const from = picked;
    setPicked(null);
    if (from) focusLater(`${id}-tile-${from === 'other' ? 'other' : from.id}`);
  };

  const add = (value: SubscriptionFields) => {
    const item: Subscription = { id: `s${newId(8)}`, ...value, paused: false };
    updateItems((current) => (current.length >= MAX_ITEMS ? current : [...current, item]));
    setRemoved(null);
    // Back to the tiles for the next one: most people add several in a row.
    setAdding(true);
    unpick();
    // The ring and the total counting up are the news; this says it for screen readers.
    setAnnounce(`Added ${item.name}, ${priceText(item, currency)}`);
  };

  const finishAdding = () => {
    setAdding(false);
    setPicked(null);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      overviewRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }),
    );
  };

  const save = (item: Subscription, value: SubscriptionFields, shownNext: string) => {
    // The form shows the upcoming charge. Left as it was (and on the same schedule), the original
    // anchor stays, so a Jan 31 charge still comes back to the 31st after a short month.
    const keepAnchor =
      value.next === shownNext && value.every === item.every && value.unit === item.unit;
    updateItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, ...value, next: keepAnchor ? entry.next : value.next, sample: false }
          : entry,
      ),
    );
    setEditing(null);
    setRemoved(null);
    toast({ title: `Saved ${value.name}` });
  };

  const remove = (item: Subscription) => {
    setRemoved({ item, index: items.findIndex((entry) => entry.id === item.id) });
    updateItems((current) => current.filter((entry) => entry.id !== item.id));
    setOpen(null);
    setEditing(null);
  };

  const undoRemove = () => {
    if (!removed) return;
    updateItems((current) => {
      if (current.some((entry) => entry.id === removed.item.id)) return current;
      const next = [...current];
      next.splice(Math.min(removed.index, next.length), 0, removed.item);
      return next;
    });
    setOpen(removed.item.id);
    setRemoved(null);
  };

  const togglePause = (item: Subscription) =>
    updateItems((current) =>
      current.map((entry) => (entry.id === item.id ? { ...entry, paused: !entry.paused } : entry)),
    );

  const toggleCut = (itemId: string) =>
    setCut((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const pauseCut = () => {
    if (!summary || !after) return;
    const saving = summary.yearly - after.yearly;
    const count = cutIds.size;
    updateItems((current) =>
      current.map((entry) => (cutIds.has(entry.id) ? { ...entry, paused: true } : entry)),
    );
    setCut(new Set());
    toast({
      title: `Paused ${count}`,
      description: `${wholeMoney(saving, currency)} a year back in your pocket`,
    });
  };

  const trySample = () => {
    updateItems(() => sampleItems(today));
    setAdding(false);
    setPicked(null);
    setRemoved(null);
    setCut(new Set());
  };

  const clearSample = () => {
    updateItems((current) => current.filter((item) => !item.sample));
    setOpen(null);
    setEditing(null);
    setRemoved(null);
    setCut(new Set());
  };

  const exportAs = (kind: 'csv' | 'json') => {
    if (kind === 'csv') downloadText(toCsv(list, today), `subscriptions-${today}.csv`, 'text/csv');
    else downloadText(exportJson(list, today), `subscriptions-${today}.json`, 'application/json');
    toast({
      title: `Exported ${items.length} ${items.length === 1 ? 'subscription' : 'subscriptions'}`,
      description: kind === 'csv' ? 'Opens in any spreadsheet app' : 'Restore it here any time',
      icon: 'download',
    });
  };

  const chooseImport = async (file: File) => {
    setImportError('');
    setIncoming(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError('That file is too big to be a Subscriptions backup. Nothing was added.');
      return;
    }
    const result = readImport(await file.text());
    if (!result.ok) {
      setImportError(result.error);
      return;
    }
    if (items.length === 0) applyImport('replace', result.data);
    else setIncoming({ file: file.name, data: result.data });
  };

  const applyImport = (mode: 'merge' | 'replace', data: Imported) => {
    const count = (value: number) => `${value} ${value === 1 ? 'subscription' : 'subscriptions'}`;
    if (mode === 'replace') {
      setList((current) => ({ ...current, currency: data.currency, items: data.items }));
      toast({ title: `Imported ${count(data.items.length)}`, icon: 'upload' });
    } else {
      const merged = mergeItems(items, data.items);
      setList((current) => ({ ...current, items: merged.items }));
      toast({
        title: `Added ${count(merged.added)}${merged.updated ? `, updated ${merged.updated}` : ''}`,
        description: merged.skipped
          ? `${merged.skipped} didn’t fit: a list holds ${MAX_ITEMS}`
          : undefined,
        icon: 'upload',
      });
    }
    setIncoming(null);
    setAdding(false);
    setPicked(null);
    setOpen(null);
    setEditing(null);
    setRemoved(null);
    setCut(new Set());
  };

  const clearAll = () => {
    if (
      !window.confirm('Clear your whole list? Download a backup first if you might want it back.')
    )
      return;
    setList(newList(currency));
    setAdding(false);
    setPicked(null);
    setOpen(null);
    setEditing(null);
    setRemoved(null);
    setIncoming(null);
    setCut(new Set());
  };

  if (!ready || !summary || !after)
    return (
      <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="skeleton h-[520px] !rounded-[26px]" />
        <div className="skeleton hidden h-[520px] !rounded-[26px] lg:block" />
      </div>
    );

  const currencyPicker = (
    <select
      aria-label="Currency for your whole list"
      value={currency}
      onChange={(event) => {
        const code = event.target.value as Currency;
        setList((current) => changeCurrency(current, code));
      }}
      className="h-11 shrink-0 rounded-[11px] bg-well px-2.5 text-[14px] text-ink-2 outline-none lg:h-9 lg:text-[13.5px]"
    >
      {CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );

  const addedNames = new Set(items.map((item) => item.name.trim().toLowerCase()));

  // The way in: tiles to tap, or the price card for the one that was tapped.
  const adder = full ? (
    <p className="text-[13.5px] text-muted">
      A list holds {MAX_ITEMS} subscriptions. Remove one to add another.
    </p>
  ) : picked ? (
    <SubscriptionForm
      key={formKey}
      variant={picked === 'other' ? 'full' : 'quick'}
      icon={picked === 'other' ? undefined : picked.icon}
      points={picked === 'other' ? undefined : { unit: picked.unit, values: picked.points }}
      initial={
        picked === 'other'
          ? emptyDraft()
          : {
              ...emptyDraft(),
              name: picked.name,
              category: picked.category,
              frequency: picked.unit,
              cost: localPrice(picked.price, currency),
            }
      }
      currency={currency}
      today={today}
      submitLabel={picked === 'other' ? 'Add it' : `Add ${picked.name}`}
      submitIcon="plus"
      autoFocus
      onSubmit={add}
      onCancel={unpick}
      cancelLabel="Back"
    />
  ) : (
    <TileGrid idPrefix={id} added={addedNames} currency={currency} onPick={pick} />
  );

  const backup = (
    // Backups are housekeeping, not the job: one folded line, opened when needed.
    <details className="group/data rounded-[20px] bg-surface px-4 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-5">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 text-[14.5px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="download" size={16} className="shrink-0 text-muted" />
        <span id={`${id}-data`} className="min-w-0 flex-1">
          Back up or move your list
        </span>
        <Icon
          name="chevron-right"
          size={15}
          className="shrink-0 text-muted transition-transform group-open/data:rotate-90"
        />
      </summary>
      <div className="grid gap-4 pt-1 pb-5">
        <p className="text-[13px] text-muted">Lives in this browser. A backup keeps it safe.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportAs('json')}
            disabled={!items.length}
            className={quietButton}
          >
            <Icon name="download" size={16} /> Download a backup
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} className={quietButton}>
            <Icon name="upload" size={16} /> Restore a backup
          </button>
          <button
            type="button"
            onClick={() => exportAs('csv')}
            disabled={!items.length}
            className={quietButton}
          >
            <Icon name="file-text" size={16} /> Spreadsheet (CSV)
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void chooseImport(file);
            }}
          />
        </div>
        {importError && (
          <p role="alert" className="flex items-start gap-2 text-[13.5px] text-critical">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" /> {importError}
          </p>
        )}
        {incoming && (
          <ImportChoice
            file={incoming.file}
            data={incoming.data}
            current={items.length}
            currency={currency}
            onChoose={(mode) => applyImport(mode, incoming.data)}
            onCancel={() => setIncoming(null)}
          />
        )}
        {items.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex min-h-11 items-center justify-self-start text-[13px] text-muted underline-offset-2 hover:text-critical hover:underline lg:min-h-0"
          >
            Clear the whole list
          </button>
        )}
      </div>
    </details>
  );

  const removedNote = (
    <>
      <p aria-live="polite" className="sr-only">
        {removed ? `Removed ${removed.item.name}. Undo is below the list.` : ''}
      </p>
      {removed && (
        <p className="flex min-h-12 flex-wrap items-center gap-x-3 rounded-[14px] bg-well px-4 text-[14px] text-ink-2 fx-rise">
          <Icon name="trash" size={15} className="text-muted" />
          <span>Removed {removed.item.name}</span>
          <button
            type="button"
            onClick={undoRemove}
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-ink underline underline-offset-2 lg:min-h-0"
          >
            Undo
          </button>
        </p>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6',
        // The phone's bottom bar (the running total, or Add) never covers the last row.
        'max-lg:pb-24',
      )}
    >
      {/* The object: the ring and the year's total, and what could go. */}
      <aside
        ref={overviewRef}
        aria-label="What it all costs"
        className={cn(
          'grid min-w-0 scroll-mt-24 gap-5 lg:sticky lg:top-24 lg:col-start-2 lg:row-start-1',
          // On a phone, adding keeps the tiles on top; otherwise the total leads.
          adding && 'order-last lg:order-none',
        )}
      >
        <Overview summary={summary} after={after} currency={currency} onSample={trySample} />
        {!empty && (
          <CutPlanner
            items={items}
            currency={currency}
            cut={cutIds}
            saving={summary.yearly - after.yearly}
            onToggle={toggleCut}
            onPause={pauseCut}
            onClear={() => setCut(new Set())}
          />
        )}
        {!empty && <Timeline summary={summary} items={items} today={today} currency={currency} />}
      </aside>

      <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-1">
        {samples > 0 && (
          <p className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[14px] bg-well px-4 py-2 text-[13.5px] text-ink-2">
            <Icon name="sparkles" size={15} className="text-[var(--accent-ink)]" />
            <span>{samples === items.length ? 'A sample list' : 'Includes samples'}, made up</span>
            <button
              type="button"
              onClick={clearSample}
              className="ml-auto inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 lg:min-h-0"
            >
              Clear the sample
            </button>
          </p>
        )}

        {adding ? (
          <section
            aria-labelledby={`${id}-add`}
            className="relative isolate grid min-w-0 gap-4 overflow-hidden rounded-[26px] bg-surface p-4 shadow-lift sm:p-6"
          >
            <div className="flex items-center justify-between gap-3">
              <h2
                id={`${id}-add`}
                className="font-display text-[26px] leading-[1.02] font-bold tracking-[-0.03em] text-ink sm:text-[30px]"
                style={{ fontVariationSettings: "'wdth' 108" }}
              >
                {picked ? 'What does it cost?' : empty ? 'What do you pay for?' : 'Tap to add more'}
              </h2>
              {!empty && !picked && (
                <button
                  type="button"
                  onClick={finishAdding}
                  className={cn(
                    'hidden h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-semibold transition-transform active:scale-[.97] lg:inline-flex lg:h-10 lg:text-[14px]',
                    ON_ACCENT,
                  )}
                  style={{ background: ACCENT }}
                >
                  <Icon name="check" size={16} /> Done
                </button>
              )}
            </div>
            <p aria-live="polite" className="sr-only">
              {announce}
            </p>
            {adder}
            {!picked && empty && (
              <p className="flex items-center justify-center gap-2 text-[13px] text-muted">
                Prices in {currencyPicker}
              </p>
            )}
          </section>
        ) : (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setPicked(null);
            }}
            className="flex h-14 items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong text-[15px] font-medium text-ink-2 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
          >
            <Icon name="plus" size={17} /> Add a subscription
          </button>
        )}

        {!empty && (
          <section
            aria-labelledby={`${id}-list`}
            className="grid min-w-0 gap-3 rounded-[26px] bg-surface p-4 shadow-card sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label id={`${id}-list`}>Your subscriptions · {items.length}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="radiogroup"
                  aria-label="Sort by"
                  className="flex rounded-[12px] bg-well p-0.5 lg:p-1"
                >
                  {SORTS.map((sort) => (
                    <button
                      key={sort}
                      type="button"
                      role="radio"
                      aria-checked={list.sort === sort}
                      onClick={() => setList((current) => ({ ...current, sort }))}
                      className={cn(
                        'h-11 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors lg:h-8 lg:rounded-[9px] lg:text-[13px]',
                        list.sort === sort
                          ? 'bg-surface text-ink shadow-card'
                          : 'text-muted hover:text-ink',
                      )}
                    >
                      {SORT_LABELS[sort]}
                    </button>
                  ))}
                </div>
                {currencyPicker}
              </div>
            </div>
            <ul className="grid gap-2">
              {sorted.map((item) => (
                <SubscriptionRow
                  key={item.id}
                  item={item}
                  today={today}
                  currency={currency}
                  cut={cutIds.has(item.id)}
                  expanded={open === item.id}
                  editing={editing === item.id}
                  onToggle={() => {
                    setOpen(open === item.id ? null : item.id);
                    setEditing(null);
                  }}
                  onEdit={() => setEditing(item.id)}
                  onCancelEdit={() => setEditing(null)}
                  onSave={(value, shownNext) => save(item, value, shownNext)}
                  onPause={() => togglePause(item)}
                  onRemove={() => remove(item)}
                />
              ))}
            </ul>
          </section>
        )}

        {removedNote}
        {backup}
      </div>

      {/* On a phone: the running total under the thumb while adding, or the way to add more. */}
      {!empty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-[0_-12px_30px_-20px_rgb(0_0_0/.25)] lg:hidden">
          <div className="mx-auto flex max-w-[640px] items-center gap-3">
            <Donut parts={after.categories} size={40} thin />
            <p className="min-w-0 flex-1 leading-tight">
              <span className="block font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
                <CountUp
                  value={after.yearly}
                  format={(n) => wholeMoney(n, currency)}
                  from={after.yearly}
                  className={DISPLAY_NUM}
                />
                <span className="ml-1 font-sans text-[13px] font-medium tracking-normal text-muted">
                  a year
                </span>
              </span>
              <span className="block text-[12.5px] text-muted">
                {after.active} {after.active === 1 ? 'subscription' : 'subscriptions'}
              </span>
            </p>
            {adding ? (
              <button
                type="button"
                onClick={finishAdding}
                className={cn(
                  'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-5 text-[15px] font-semibold active:scale-[.97]',
                  ON_ACCENT,
                )}
                style={{ background: ACCENT }}
              >
                <Icon name="check" size={17} /> Done
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setPicked(null);
                  requestAnimationFrame(() =>
                    document.getElementById(`${id}-add`)?.scrollIntoView({ block: 'start' }),
                  );
                }}
                className={cn(
                  'inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-5 text-[15px] font-semibold active:scale-[.97]',
                  ON_ACCENT,
                )}
                style={{ background: ACCENT }}
              >
                <Icon name="plus" size={17} /> Add
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- The way in ---------------- */

function TileGrid({
  idPrefix,
  added,
  currency,
  onPick,
}: {
  idPrefix: string;
  added: Set<string>;
  currency: Currency;
  onPick: (choice: Preset | 'other') => void;
}) {
  return (
    <div
      role="group"
      aria-label="What do you pay for?"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2.5"
    >
      {PRESETS.map((preset, index) => {
        const on = added.has(preset.name.toLowerCase());
        return (
          <button
            key={preset.id}
            id={`${idPrefix}-tile-${preset.id}`}
            type="button"
            onClick={() => onPick(preset)}
            className={cn(
              'fx-rise fx-move group relative flex min-h-[108px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-1.5 py-3 text-center hover:-translate-y-0.5 active:scale-[.96]',
              on
                ? 'bg-[color-mix(in_srgb,var(--glow,var(--color-signal))_18%,var(--color-surface))] shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--glow,var(--color-signal))_70%,transparent)]'
                : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-well',
            )}
            style={{ ['--i' as string]: index }}
          >
            <CategoryMark category={preset.category} icon={preset.icon} />
            <span className="text-[13.5px] leading-tight font-semibold text-ink">
              {preset.name}
            </span>
            <span className="mono-num text-[11.5px] leading-none text-muted">
              {formatMoney(localPrice(preset.price, currency), currency)}
              <span className="text-faint">/{preset.unit === 'week' ? 'wk' : 'mo'}</span>
            </span>
            {on && (
              <span
                className="fx-pop absolute top-2 right-2 grid size-5 place-items-center rounded-full text-[#12110d]"
                style={{ background: GLOW }}
              >
                <Icon name="check" size={12} strokeWidth={3} />
                <span className="sr-only">(on your list, tap to add another)</span>
              </span>
            )}
          </button>
        );
      })}
      <button
        id={`${idPrefix}-tile-other`}
        type="button"
        onClick={() => onPick('other')}
        className="fx-move flex min-h-[108px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong px-1.5 py-3 text-center hover:bg-ink/5 active:scale-[.96]"
      >
        <span
          aria-hidden="true"
          className={cn('grid size-10 place-items-center rounded-[12px]', ON_ACCENT)}
          style={{ background: ACCENT }}
        >
          <Icon name="plus" size={19} />
        </span>
        <span className="text-[13.5px] leading-tight font-semibold text-ink">Something else</span>
      </button>
    </div>
  );
}

/* ---------------- Adding and editing ---------------- */

function Row({
  label,
  htmlFor,
  error,
  hint,
  optional,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('grid min-w-0 content-start gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="flex items-baseline justify-between gap-2 text-[13.5px] font-medium text-ink-2"
      >
        {label}
        {optional && <span className="text-[12px] font-normal text-faint">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-note`} className="text-[12.5px] text-critical">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-note`} className="text-[12.5px] leading-snug text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Wires an input to its row's error or hint. */
const described = (fieldId: string, error?: string, hint?: unknown) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': error || hint ? `${fieldId}-note` : undefined,
});

const FIELD_ORDER = ['name', 'cost', 'every', 'next', 'trialEnds', 'cancelUrl'] as const;
const LATER_FIELDS: readonly string[] = ['next', 'trialEnds', 'cancelUrl'];

/** A big round − or + beside the price. */
function Stepper({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: 'minus' | 'plus';
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="fx-move grid size-12 shrink-0 place-items-center rounded-full bg-well text-ink-2 hover:bg-ink/10 hover:text-ink active:scale-90 disabled:opacity-30"
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

/**
 * One subscription's form. "quick" came from a tile: the name, kind and a typical price are
 * already in, so it's a price to nudge and a cycle to flip. "full" also asks the name and kind.
 * The next charge, free trial, cancel link and notes wait under More options.
 */
function SubscriptionForm({
  variant,
  icon,
  points,
  initial,
  currency,
  today,
  submitLabel,
  submitIcon,
  autoFocus,
  onSubmit,
  onCancel,
  cancelLabel = 'Cancel',
  contained = false,
}: {
  variant: 'quick' | 'full';
  icon?: IconName;
  /** Common prices to tap, in US cents per `unit`. */
  points?: { unit: Simple; values: number[] };
  initial: Draft;
  currency: Currency;
  today: string;
  submitLabel: string;
  submitIcon: IconName;
  autoFocus?: boolean;
  onSubmit: (value: SubscriptionFields) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Inside a list row: the sideways row of kinds stops at the row's edge. */
  contained?: boolean;
}) {
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [more, setMore] = useState(
    Boolean(initial.trialEnds || initial.cancelUrl || initial.notes),
  );
  // The price is a number to nudge; typing it is the fallback (and the start, with no guess).
  const [typing, setTyping] = useState(!(initial.cost > 0));
  // A saved price is the real one: flipping its cycle then fixes the cycle, not the price.
  const [typed, setTyped] = useState(variant === 'full' && initial.cost > 0);
  const [otherCycle, setOtherCycle] = useState(
    initial.frequency !== 'month' && initial.frequency !== 'year',
  );
  const quick = variant === 'quick';

  // Until a date is picked, the next charge is a guess one cycle out, and follows the cycle.
  const complete = (value: Draft): Draft => ({
    ...value,
    next: value.next || guessNext(value, today),
  });

  const change = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    // A free trial usually turns paid the day it ends: a good first guess for the next charge.
    if (patch.trialEnds && !draft.next && parseDay(patch.trialEnds)) next.next = patch.trialEnds;
    setDraft(next);
    // Errors already showing clear as they're fixed; nothing new lights up while typing.
    if (Object.keys(errors).length) {
      const result = readDraft(complete(next));
      const kept: DraftErrors = {};
      if (!result.ok)
        for (const key of FIELD_ORDER) if (errors[key]) kept[key] = result.errors[key];
      setErrors(kept);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = readDraft(complete(draft));
    if (result.ok) {
      onSubmit(result.value);
      return;
    }
    setErrors(result.errors);
    const first = FIELD_ORDER.find((key) => result.errors[key]);
    if (first === 'cost') setTyping(true);
    if (first === 'every') setOtherCycle(true);
    if (first && (LATER_FIELDS.includes(first) || (quick && first === 'name'))) setMore(true);
    requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
  };

  /** A simple cycle: a guessed price follows along ($15.49 a month → $185.99 a year). */
  const setSimple = (unit: Simple) => {
    const from = simpleOf(draft);
    change({
      frequency: unit,
      cost: from && !typed ? convert(draft.cost, from, unit, currency) : draft.cost,
    });
  };

  const setCustom = () =>
    change({
      frequency: 'custom',
      unit: draft.frequency === 'week' || draft.frequency === 'year' ? draft.frequency : 'month',
      every: draft.frequency === 'custom' || draft.frequency === 'months' ? draft.every : '3',
    });

  const schedule = scheduleOf(draft);
  const simple = simpleOf(draft);
  const shownNext = complete(draft).next;
  const past =
    schedule && parseDay(draft.next) && draft.next < today
      ? nextCharge({ next: draft.next, ...schedule }, today)
      : null;
  const errorCount = Object.keys(errors).length;
  const money = (amount: number) => formatMoney(amount, currency);
  const otherUnit = draft.frequency === 'months' ? 'month' : draft.unit;
  const step = stepOf(currency);
  const custom = draft.frequency === 'custom' || draft.frequency === 'months';

  // Common prices for this cycle, tidied: tap one instead of typing.
  const chips =
    points && simple
      ? [
          ...new Set(
            points.values.map((value) =>
              convert(localPrice(value, currency), points.unit, simple, currency),
            ),
          ),
        ]
      : [];

  // What that works out to: the satisfying bit while the price moves.
  const yearly = schedule && draft.cost > 0 ? yearlyCost({ cost: draft.cost, ...schedule }) : 0;

  const nameField = (
    <Row label="Name" htmlFor={`${id}-name`} error={errors.name}>
      <input
        id={`${id}-name`}
        value={draft.name}
        maxLength={80}
        autoFocus={autoFocus && !quick && !initial.name}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="next"
        placeholder="Music app"
        onChange={(event) => change({ name: event.target.value })}
        className={field}
        {...described(`${id}-name`, errors.name)}
      />
    </Row>
  );

  const categoryField = (
    <div className="grid min-w-0 gap-2">
      <p className="text-[13.5px] font-medium text-ink-2">Kind</p>
      <div
        role="radiogroup"
        aria-label="Kind"
        className={cn(
          'scroller -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0',
          contained && 'mx-0 px-0',
        )}
      >
        {CATEGORY_IDS.map((category) => {
          const on = draft.category === category;
          return (
            <button
              key={category}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => change({ category })}
              className={cn(
                'fx-move inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full pr-4 pl-1.5 text-[14px] font-medium active:scale-[.97] lg:min-h-10',
                on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
            >
              <CategoryMark category={category} size="sm" className="!size-7 !rounded-full" />
              <span className="whitespace-nowrap">{CATEGORY_LABELS[category]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const priceLabel = errors.cost
    ? `What one charge costs. ${errors.cost}`
    : 'What one charge costs';

  return (
    <form ref={form} onSubmit={submit} noValidate className="fx-pop grid gap-5">
      {quick ? (
        <div className="flex items-center gap-3">
          <CategoryMark category={draft.category} icon={icon} size="lg" />
          <p className="min-w-0 flex-1 truncate font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">
            {draft.name.trim() || 'Subscription'}
          </p>
        </div>
      ) : (
        nameField
      )}

      {/* The price: a number to nudge, chips to tap, typing when nothing fits. */}
      <div className="grid min-w-0 justify-items-center gap-3 rounded-[22px] bg-subtle px-3 py-5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <div className="flex w-full items-center justify-center gap-3">
          <Stepper
            icon="minus"
            label="Lower the price"
            disabled={draft.cost <= 0}
            onClick={() => change({ cost: Math.max(0, draft.cost - step) })}
          />
          <div className="min-w-0 flex-1 text-center">
            {typing ? (
              <MoneyInput
                id={`${id}-cost`}
                label={priceLabel}
                value={draft.cost}
                currency={currency}
                autoFocus={autoFocus && draft.cost === 0}
                onChange={(cost) => {
                  setTyped(true);
                  change({ cost });
                }}
                onEnter={() => form.current?.requestSubmit()}
                className="mx-auto max-w-[220px]"
                inputClassName={cn(
                  '!h-14 !bg-surface !text-center !text-[26px] font-bold',
                  errors.cost && '!shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
                )}
              />
            ) : (
              <button
                id={`${id}-cost`}
                type="button"
                aria-label={`${priceLabel}: ${money(draft.cost)}. Tap to type a price.`}
                onClick={() => setTyping(true)}
                className="group inline-flex min-h-14 max-w-full flex-col items-center rounded-[14px] px-2 hover:bg-ink/[.04]"
              >
                <span
                  key={draft.cost}
                  className="fx-pop mono-num block font-display text-[40px] leading-[1.1] font-extrabold tracking-[-0.04em] text-ink sm:text-[46px]"
                  style={{ fontVariationSettings: "'wdth' 110" }}
                >
                  {money(draft.cost)}
                </span>
                <span className="text-[12px] text-faint group-hover:text-muted">
                  <Icon name="pencil" size={11} className="mr-1 inline" />
                  tap to type
                </span>
              </button>
            )}
          </div>
          <Stepper
            icon="plus"
            label="Raise the price"
            onClick={() => change({ cost: draft.cost + step })}
          />
        </div>

        {chips.length > 0 && (
          <div
            role="radiogroup"
            aria-label="Common prices"
            className="flex flex-wrap justify-center gap-1.5"
          >
            {chips.map((value) => {
              const on = draft.cost === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => change({ cost: value })}
                  className={cn(
                    'fx-move mono-num inline-flex h-10 items-center rounded-full px-3.5 text-[14px] font-medium active:scale-[.96]',
                    on
                      ? cn('font-semibold', ON_ACCENT)
                      : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink',
                  )}
                  style={on ? { background: ACCENT } : undefined}
                >
                  {money(value)}
                </button>
              );
            })}
          </div>
        )}

        {/* How often: month or year, the rest one tap further. */}
        <div role="radiogroup" aria-label="How often" className="grid w-full max-w-[360px] gap-2">
          <div className="grid grid-cols-2 rounded-full bg-well p-1">
            {(['month', 'year'] as const).map((unit) => {
              const on = draft.frequency === unit;
              return (
                <button
                  key={unit}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setOtherCycle(false);
                    setSimple(unit);
                  }}
                  className={cn(
                    'fx-move h-11 rounded-full text-[15px] font-semibold',
                    on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                  )}
                >
                  {unit === 'month' ? 'Monthly' : 'Yearly'}
                </button>
              );
            })}
          </div>
          {otherCycle ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={draft.frequency === 'week'}
                onClick={() => setSimple('week')}
                className={cn(
                  'fx-move h-10 rounded-full px-4 text-[14px] font-medium',
                  draft.frequency === 'week'
                    ? 'bg-ink text-on-ink'
                    : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]',
                )}
              >
                Weekly
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={custom}
                onClick={setCustom}
                className={cn(
                  'fx-move h-10 rounded-full px-4 text-[14px] font-medium',
                  custom
                    ? 'bg-ink text-on-ink'
                    : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]',
                )}
              >
                Every few…
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setOtherCycle(true)}
              className="mx-auto inline-flex min-h-10 items-center text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Weekly or something else
            </button>
          )}
        </div>

        {custom && (
          <div className="fx-rise flex flex-wrap items-center justify-center gap-2 text-[14px] text-ink-2">
            <label htmlFor={`${id}-every`}>Every</label>
            <input
              id={`${id}-every`}
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              value={draft.every}
              maxLength={3}
              onChange={(event) => change({ every: event.target.value.replace(/\D/g, '') })}
              className={cn(field, 'num !w-20 text-center')}
              {...described(`${id}-every`, errors.every, true)}
            />
            <select
              aria-label="Days, weeks, months or years"
              value={otherUnit}
              onChange={(event) =>
                change({ frequency: 'custom', unit: event.target.value as Draft['unit'] })
              }
              className={cn(field, '!w-auto pr-8')}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitWord(unit, Number(draft.every) || 2)}
                </option>
              ))}
            </select>
            <p
              id={`${id}-every-note`}
              className={cn(
                'w-full text-center text-[12.5px]',
                errors.every ? 'text-critical' : 'text-muted',
              )}
            >
              {errors.every ?? (schedule ? '' : `A whole number from 1 to ${MAX_EVERY}.`)}
            </p>
          </div>
        )}

        <p
          aria-live="polite"
          className={cn(
            'min-h-[20px] text-center text-[14px]',
            errors.cost ? 'text-critical' : 'text-muted',
          )}
        >
          {errors.cost ??
            (yearly > 0 ? (
              <>
                {schedule && custom && <>{frequencyLabel(schedule.every, schedule.unit)} · </>}
                <span className="font-semibold text-ink">
                  <CountUp
                    value={yearly}
                    format={(n) => wholeMoney(n, currency)}
                    duration={400}
                    from={yearly}
                  />
                </span>{' '}
                a year
              </>
            ) : (
              'A close guess is fine.'
            ))}
        </p>
      </div>

      {!quick && categoryField}

      <div className="grid min-w-0">
        <button
          type="button"
          aria-expanded={more}
          aria-controls={`${id}-more`}
          onClick={() => setMore((value) => !value)}
          className="flex min-h-11 w-full items-center gap-2 rounded-[12px] text-left text-[14.5px] font-medium text-ink-2 transition-colors hover:text-ink"
        >
          <span
            aria-hidden="true"
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full bg-well transition-transform',
              more && 'rotate-45',
            )}
          >
            <Icon name="plus" size={15} />
          </span>
          <span className="min-w-0 flex-1">More options</span>
          {!more && parseDay(shownNext) && (
            <span className="truncate text-[13px] font-normal text-muted">
              Next charge {dayText(shownNext, today)}
            </span>
          )}
        </button>
        {more && (
          <div id={`${id}-more`} className="grid animate-fade gap-4 pt-3 sm:grid-cols-2">
            {quick && <div className="sm:col-span-2">{nameField}</div>}
            {quick && <div className="sm:col-span-2">{categoryField}</div>}
            <Row
              label="Next charge"
              htmlFor={`${id}-next`}
              error={errors.next}
              hint={
                past
                  ? `That’s past, so the next one is ${dayText(past, today)}.`
                  : draft.next
                    ? undefined
                    : 'A guess. Pick the real day if you know it.'
              }
            >
              <input
                id={`${id}-next`}
                type="date"
                value={shownNext}
                onChange={(event) => change({ next: event.target.value })}
                className={cn(field, 'text-left')}
                {...described(`${id}-next`, errors.next, true)}
              />
            </Row>
            <Row
              label="Free trial ends"
              htmlFor={`${id}-trialEnds`}
              error={errors.trialEnds}
              optional
            >
              <input
                id={`${id}-trialEnds`}
                type="date"
                value={draft.trialEnds}
                onChange={(event) => change({ trialEnds: event.target.value })}
                className={cn(field, 'text-left')}
                {...described(`${id}-trialEnds`, errors.trialEnds)}
              />
            </Row>
            <Row
              label="Where to cancel"
              htmlFor={`${id}-cancelUrl`}
              error={errors.cancelUrl}
              optional
            >
              <input
                id={`${id}-cancelUrl`}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={draft.cancelUrl}
                maxLength={2000}
                placeholder="example.com/account"
                onChange={(event) => change({ cancelUrl: event.target.value })}
                className={field}
                {...described(`${id}-cancelUrl`, errors.cancelUrl)}
              />
            </Row>
            <Row label="Notes" htmlFor={`${id}-notes`} optional>
              <textarea
                id={`${id}-notes`}
                value={draft.notes}
                maxLength={500}
                rows={2}
                placeholder="Shared with the family"
                onChange={(event) => change({ notes: event.target.value })}
                className={cn(field, '!h-auto min-h-11 py-2.5 leading-relaxed')}
              />
            </Row>
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <ActionButton type="submit" icon={submitIcon} className="sm:w-auto sm:min-w-[200px]">
          {submitLabel}
        </ActionButton>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center justify-center rounded-[11px] px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink"
          >
            {cancelLabel}
          </button>
        )}
        <p aria-live="polite" className="text-[13px] text-critical">
          {errorCount > 0 &&
            `Check ${errorCount === 1 ? 'the field' : `the ${errorCount} fields`} marked above.`}
        </p>
      </div>
    </form>
  );
}

/* ---------------- One subscription ---------------- */

function SubscriptionRow({
  item,
  today,
  currency,
  cut,
  expanded,
  editing,
  onToggle,
  onEdit,
  onCancelEdit,
  onSave,
  onPause,
  onRemove,
}: {
  item: Subscription;
  today: string;
  currency: Currency;
  /** Tapped under "What could go?". */
  cut: boolean;
  expanded: boolean;
  editing: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (value: SubscriptionFields, shownNext: string) => void;
  onPause: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const money = (amount: number) => formatMoney(amount, currency);
  const next = nextCharge(item, today);
  const trial = item.trialEnds && item.trialEnds >= today ? item.trialEnds : '';
  const cancel = item.cancelUrl ? webLink(item.cancelUrl) : null;
  const perMonth = item.every === 1 && item.unit === 'month';
  const color = LOOK[item.category].color;
  const dim = item.paused || cut;

  return (
    <li
      className={cn(
        'fx-move relative min-w-0 overflow-hidden rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
        expanded && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', dim && 'opacity-40')}
        style={{ background: color }}
      />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-details`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-3 pr-3 pl-3.5 text-left sm:pr-3.5 sm:pl-4"
      >
        <span className={cn('contents', dim && '[&>*]:opacity-55')}>
          <CategoryMark category={item.category} />
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                'block truncate text-[15px] font-medium text-ink',
                cut && 'line-through decoration-1',
              )}
            >
              {item.name}
            </span>
            {/* Short pieces that wrap between each other, never mid-phrase. */}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] leading-snug text-muted">
              {item.sample && (
                <span className="rounded-full bg-well px-1.5 text-[11px] leading-[18px] font-medium">
                  Sample
                </span>
              )}
              {item.paused ? (
                <span className="whitespace-nowrap">Paused · not counted</span>
              ) : trial ? (
                <span className="whitespace-nowrap">Free trial until {dayText(trial, today)}</span>
              ) : (
                <>
                  <span className="whitespace-nowrap">Next {dayText(next, today)},</span>
                  <span className="whitespace-nowrap">{relativeDay(today, next)}</span>
                </>
              )}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="mono-num block text-[15px] font-semibold text-ink">
              {money(item.cost)}
            </span>
            <span className="block text-[11.5px] text-muted">
              {item.every === 1
                ? `a ${unitWord(item.unit, 1)}`
                : `every ${item.every} ${unitWord(item.unit, item.every)}`}
            </span>
          </span>
        </span>
        <Icon
          name="chevron-down"
          size={15}
          className={cn('shrink-0 text-muted transition-transform', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div
          id={`${id}-details`}
          className="grid animate-fade gap-3 border-t border-line pt-3 pr-3 pb-3.5 pl-3.5 sm:pr-3.5 sm:pl-4"
        >
          {editing ? (
            <SubscriptionForm
              variant="full"
              contained
              initial={{ ...draftOf(item), next }}
              currency={currency}
              today={today}
              submitLabel="Save changes"
              submitIcon="check"
              autoFocus
              onSubmit={(value) => onSave(value, next)}
              onCancel={onCancelEdit}
            />
          ) : (
            <>
              <dl className="grid gap-x-4 gap-y-2 text-[13.5px] sm:grid-cols-2">
                <Detail term="Costs">
                  {perMonth ? (
                    <>
                      {money(item.cost)} a month · {money(Math.round(yearlyCost(item)))} a year
                    </>
                  ) : (
                    <>
                      {priceText(item, currency)} · about {money(Math.round(monthlyCost(item)))} a
                      month, {money(Math.round(yearlyCost(item)))} a year
                    </>
                  )}
                </Detail>
                <Detail term={item.paused ? 'Would charge next' : 'Next charges'}>
                  {nextCharges(item, today, 3)
                    .map((date) => dayText(date, today))
                    .join(', ')}
                </Detail>
                <Detail term="Kind">{CATEGORY_LABELS[item.category]}</Detail>
                {trial && (
                  <Detail term="Free trial ends">
                    {dayText(trial, today, true)} · {relativeDay(today, trial)}
                  </Detail>
                )}
                {item.notes && (
                  <Detail term="Notes" className="sm:col-span-2">
                    <span className="whitespace-pre-line">{item.notes}</span>
                  </Detail>
                )}
              </dl>
              {cancel && (
                <a
                  href={cancel}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-[var(--accent-ink)] underline-offset-2 hover:underline lg:min-h-0"
                >
                  How to cancel: {new URL(cancel).hostname.replace(/^www\./, '')}
                  <Icon name="external" size={14} />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onEdit} className={quietButton}>
                  <Icon name="pencil" size={15} /> Edit
                </button>
                <button type="button" onClick={onPause} className={quietButton}>
                  <Icon name={item.paused ? 'play' : 'minus'} size={15} />
                  {item.paused ? 'Resume' : 'Pause'}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  className={cn(quietButton, 'hover:bg-critical-soft hover:text-critical')}
                >
                  <Icon name="trash" size={15} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Detail({
  term,
  children,
  className,
}: {
  term: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="label">{term}</dt>
      <dd className="mt-0.5 text-ink-2">{children}</dd>
    </div>
  );
}

/* ---------------- Importing ---------------- */

function ImportChoice({
  file,
  data,
  current,
  currency,
  onChoose,
  onCancel,
}: {
  file: string;
  data: Imported;
  current: number;
  currency: Currency;
  onChoose: (mode: 'merge' | 'replace') => void;
  onCancel: () => void;
}) {
  const id = useId();
  const count = (value: number) => `${value} ${value === 1 ? 'subscription' : 'subscriptions'}`;
  const sameCurrency = data.currency === currency;
  return (
    <div
      role="group"
      aria-labelledby={`${id}-title`}
      className="grid animate-rise gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
    >
      <p id={`${id}-title`} className="text-[14.5px] text-ink">
        <span className="font-semibold break-all">{file}</span> has {count(data.items.length)}. What
        about your {count(current)}?
      </p>
      <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted">
        {sameCurrency ? (
          <li>
            <span className="font-medium text-ink-2">Add to my list</span> keeps yours; nothing is
            doubled.
          </li>
        ) : (
          <li>
            The file is in {data.currency}, your list in {currency}: it can only replace yours.
          </li>
        )}
        <li>
          <span className="font-medium text-ink-2">Replace my list</span> swaps yours for the
          file’s.
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {sameCurrency && (
          // The choice appears after the file picker closes: focus goes straight to it.
          <button type="button" autoFocus onClick={() => onChoose('merge')} className={inkButton}>
            Add to my list
          </button>
        )}
        <button
          type="button"
          autoFocus={!sameCurrency}
          onClick={() => onChoose('replace')}
          className={sameCurrency ? quietButton : inkButton}
        >
          Replace my list
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-11 items-center rounded-[11px] px-3.5 text-[14.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink lg:h-9 lg:text-[13.5px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------------- The overview ---------------- */

/** A ring of colors, one arc per part, drawn in SVG. The arcs glide as the parts change. */
function Donut({
  parts,
  size = 120,
  thin = false,
  children,
}: {
  parts: { id: CategoryId; share: number }[];
  size?: number;
  thin?: boolean;
  children?: ReactNode;
}) {
  const gap = parts.length > 1 ? 1.2 : 0;
  const width = thin ? 20 : 15;
  const starts = parts.map((_, index) =>
    parts.slice(0, index).reduce((sum, part) => sum + part.share * 100, 0),
  );
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" aria-hidden="true" className="size-full -rotate-90">
        <circle
          cx="60"
          cy="60"
          r="46"
          fill="none"
          strokeWidth={width}
          style={{ stroke: 'var(--color-well)' }}
        />
        {parts.map((part, index) => {
          const length = Math.max(0, part.share * 100 - gap);
          return (
            <circle
              key={part.id}
              cx="60"
              cy="60"
              r="46"
              fill="none"
              strokeWidth={width}
              pathLength={100}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-starts[index]}
              className="motion-safe:[transition:stroke-dasharray_var(--motion-dur)_var(--motion-ease),stroke-dashoffset_var(--motion-dur)_var(--motion-ease)]"
              style={{ stroke: LOOK[part.id].color }}
            />
          );
        })}
      </svg>
      {children && (
        <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
      )}
    </div>
  );
}

/** The object: the ring, and what it all really costs, huge. */
function Overview({
  summary,
  after,
  currency,
  onSample,
}: {
  summary: Summary;
  /** The same list without what's been tapped under "What could go?". */
  after: Summary;
  currency: Currency;
  onSample: () => void;
}) {
  const id = useId();
  const [period, setPeriod] = useState<'month' | 'year'>('year');
  const money = (amount: number) => formatMoney(amount, currency);
  const yearly = period === 'year';
  const shown = after;
  const cutting = after.yearly !== summary.yearly;
  const parts = yearly
    ? allocate(
        shown.yearly,
        shown.categories.map((part) => part.share),
      )
    : shown.categories.map((part) => part.monthly);
  const biggest = shown.biggest[0];
  const total = yearly ? shown.yearly : shown.monthly;
  const before = yearly ? summary.yearly : summary.monthly;
  const nothing = summary.active === 0 && summary.paused === 0;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="relative isolate grid gap-5 overflow-hidden rounded-[30px] bg-surface p-5 shadow-lift sm:p-7"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(70% 60% at 100% 0%, color-mix(in srgb, ${ACCENT} 22%, transparent), transparent 70%), radial-gradient(60% 50% at 0% 100%, color-mix(in srgb, ${GLOW} 16%, transparent), transparent 70%)`,
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="label flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: GLOW }} />
          It all costs
        </h2>
        {!nothing && (
          <div
            role="radiogroup"
            aria-label="Show the total"
            className="flex rounded-full bg-well p-1"
          >
            {(['year', 'month'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={period === value}
                onClick={() => setPeriod(value)}
                className={cn(
                  'fx-move h-9 rounded-full px-3.5 text-[13.5px] font-medium',
                  period === value
                    ? 'bg-surface text-ink shadow-card'
                    : 'text-muted hover:text-ink',
                )}
              >
                {value === 'month' ? 'Month' : 'Year'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        <Donut parts={shown.categories} size={168}>
          <span>
            <span className="num block font-display text-[30px] leading-none font-bold text-ink">
              {shown.active}
            </span>
            <span className="mt-1 block text-[12px] text-muted">
              {shown.active === 1 ? 'subscription' : 'subscriptions'}
            </span>
          </span>
        </Donut>
        <div aria-live="polite" aria-atomic="true" className="min-w-0 text-center sm:text-left">
          {cutting && (
            <p className="mono-num text-[18px] font-semibold text-muted line-through decoration-2">
              {wholeMoney(before, currency)}
            </p>
          )}
          <p
            className="font-display text-[56px] leading-[0.92] font-extrabold tracking-[-0.045em] text-ink sm:text-[64px]"
            style={{ fontVariationSettings: "'wdth' 112" }}
          >
            <CountUp
              value={total}
              format={(n) => wholeMoney(n, currency)}
              className={DISPLAY_NUM}
            />
          </p>
          <p className="mt-1.5 text-[18px] font-semibold text-[var(--accent-ink)]">a {period}</p>
          {!nothing && (
            <p className="mono-num mt-1.5 text-[13.5px] text-muted">
              {money(yearly ? shown.monthly : shown.yearly)} a {yearly ? 'month' : 'year'}
              {summary.paused > 0 && ` · ${summary.paused} paused`}
            </p>
          )}
        </div>
      </div>

      {nothing ? (
        <div className="grid justify-items-center gap-1 text-center">
          <p className="text-[14.5px] text-muted">Tap what you pay for. It adds up here.</p>
          <SampleButton onClick={onSample}>See it with a sample list</SampleButton>
        </div>
      ) : shown.categories.length > 0 ? (
        <ul aria-label="Where it goes" className="flex flex-wrap gap-1.5">
          {shown.categories.map((part, index) => (
            <li
              key={part.id}
              className="flex min-h-9 items-center gap-2 rounded-full bg-well py-1 pr-3 pl-2 text-[13px]"
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ background: LOOK[part.id].color }}
              />
              <span className="text-ink-2">{part.label}</span>
              <span className="mono-num font-semibold text-ink">
                {wholeMoney(parts[index], currency)}
              </span>
              <span className="sr-only">, {percent(part.share)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13.5px] text-muted">Everything is paused, so nothing is counted.</p>
      )}

      {biggest && shown.active > 1 && (
        <p className="flex items-center gap-2.5 text-[13.5px] leading-snug text-ink-2">
          <Icon name="target" size={16} className="shrink-0 text-[var(--accent-ink)]" />
          <span>
            Biggest: <span className="font-semibold text-ink">{biggest.name}</span>,{' '}
            <span className="mono-num">{wholeMoney(biggest.yearly, currency)}</span> a year (
            {percent(biggest.share)})
          </span>
        </p>
      )}

      {shown.averaged && (
        <p className="text-[12px] text-faint">Weekly and daily charges are averaged over a year.</p>
      )}
    </section>
  );
}

/**
 * What could go: the biggest and the trials about to turn paid, as switches. Tapped ones come off
 * the total at once, and one tap pauses them for real.
 */
function CutPlanner({
  items,
  currency,
  cut,
  saving,
  onToggle,
  onPause,
  onClear,
}: {
  items: Subscription[];
  currency: Currency;
  cut: Set<string>;
  saving: number;
  onToggle: (id: string) => void;
  onPause: () => void;
  onClear: () => void;
}) {
  const id = useId();
  const active = items.filter((item) => !item.paused);
  const trials = active.filter((item) => item.trialEnds);
  const candidates = [
    ...trials,
    ...active.filter((item) => !item.trialEnds).sort((a, b) => yearlyCost(b) - yearlyCost(a)),
  ].slice(0, 6);
  if (candidates.length < 2) return null;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-3 rounded-[26px] bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`${id}-title`}
          className="flex items-center gap-2 font-display text-[19px] font-bold tracking-[-0.02em] text-ink"
        >
          <Icon name="scissors" size={17} className="text-[var(--accent-ink)]" />
          What could go?
        </h2>
        {cut.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-muted hover:text-ink lg:min-h-9"
          >
            Reset
          </button>
        )}
      </div>
      <ul className="grid gap-1.5">
        {candidates.map((item) => {
          const on = cut.has(item.id);
          const year = Math.round(yearlyCost(item));
          return (
            <li key={item.id}>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onToggle(item.id)}
                className={cn(
                  'fx-move flex min-h-14 w-full items-center gap-3 rounded-[16px] px-3 text-left active:scale-[.99]',
                  on
                    ? 'bg-positive-soft shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-positive)_45%,transparent)]'
                    : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-well',
                )}
              >
                <CategoryMark category={item.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[14.5px] font-medium text-ink',
                      on && 'line-through decoration-1 opacity-70',
                    )}
                  >
                    {item.name}
                  </span>
                  {item.trialEnds && (
                    <span className="block text-[12px] text-caution">Free trial</span>
                  )}
                </span>
                <span
                  className={cn(
                    'mono-num shrink-0 text-[14px] font-semibold',
                    on ? 'text-positive' : 'text-ink-2',
                  )}
                >
                  {on ? '−' : ''}
                  {wholeMoney(year, currency)}
                  <span className="font-normal text-muted">/yr</span>
                </span>
                {/* The switch itself. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'fx-move relative h-7 w-12 shrink-0 rounded-full',
                    on ? 'bg-positive' : 'bg-ink/15',
                  )}
                >
                  <span
                    className={cn(
                      'fx-move absolute top-1 left-1 size-5 rounded-full bg-surface shadow-card',
                      on && 'translate-x-5',
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {cut.size > 0 && (
        <div className="fx-rise grid gap-3 rounded-[18px] bg-positive-soft p-4 text-positive sm:flex sm:items-center">
          <p className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium">Cut {cut.size} and you’d save</span>
            <span
              className="block font-display text-[34px] leading-none font-extrabold tracking-[-0.03em]"
              style={{ fontVariationSettings: "'wdth' 110" }}
            >
              <CountUp
                value={saving}
                format={(n) => wholeMoney(n, currency)}
                duration={450}
                className={DISPLAY_NUM}
              />
              <span className="ml-1.5 font-sans text-[15px] font-semibold tracking-normal">
                a year
              </span>
            </span>
          </p>
          <button
            type="button"
            onClick={onPause}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-positive px-5 text-[15px] font-semibold text-white transition-transform active:scale-[.97]"
          >
            <Icon name="minus" size={16} /> Pause {cut.size === 1 ? 'it' : `these ${cut.size}`}
          </button>
        </div>
      )}
    </section>
  );
}

/** What charges next, as a line of days: every active subscription's next charge, soonest first. */
function Timeline({
  summary,
  items,
  today,
  currency,
}: {
  summary: Summary;
  items: Subscription[];
  today: string;
  currency: Currency;
}) {
  const id = useId();
  const [all, setAll] = useState(false);
  const money = (amount: number) => formatMoney(amount, currency);
  const inWindow = new Map(summary.upcoming.map((charge) => [charge.id, charge.count]));
  const charges = items
    .filter((item) => !item.paused)
    .map((item) => ({ item, date: nextCharge(item, today) }))
    .sort((a, b) => a.date.localeCompare(b.date) || b.item.cost - a.item.cost);
  const shown = all ? charges : charges.slice(0, 4);

  if (!charges.length && !summary.trials.length) return null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="grid gap-3 rounded-[26px] bg-surface p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id={`${id}-title`}
          className="font-display text-[19px] font-bold tracking-[-0.02em] text-ink"
        >
          Charges next
        </h2>
        <p className="text-[13px] text-muted">
          Next {SOON_DAYS} days:{' '}
          <span className="mono-num font-semibold text-ink">{money(summary.upcomingTotal)}</span>
        </p>
      </div>

      {summary.trials.length > 0 && (
        <ul className="grid gap-2">
          {summary.trials.map((trial) => {
            const cancel = trial.item.cancelUrl ? webLink(trial.item.cancelUrl) : null;
            return (
              <li
                key={trial.id}
                className="grid gap-1 rounded-[14px] bg-caution-soft px-3.5 py-3 text-[13.5px] text-caution"
              >
                <p className="flex items-start gap-2 font-semibold">
                  <Icon name="bell" size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {trial.name} turns paid{' '}
                    {trial.days === 0 ? 'today' : `on ${dayText(trial.date, today)}`}
                    {trial.days > 0 && ` (${relativeDay(today, trial.date)})`}
                  </span>
                </p>
                <p className="pl-[23px] leading-relaxed">
                  Then {priceText(trial.item, currency)}.
                  {cancel && (
                    <>
                      {' '}
                      <a
                        href={cancel}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="font-semibold underline underline-offset-2"
                      >
                        How to cancel
                        <span className="sr-only"> {trial.name} (opens in a new tab)</span>
                      </a>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <ol className="grid">
        {shown.map(({ item, date }, index) => {
          const [, month, day] = date.split('-');
          const days = daysBetween(today, date);
          const soon = days <= 1;
          const count = inWindow.get(item.id) ?? 0;
          const first = index === 0;
          const last = index === shown.length - 1;
          return (
            <li
              key={item.id}
              className="grid grid-cols-[44px_18px_minmax(0,1fr)_auto] items-center gap-x-2.5"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid justify-items-center rounded-[11px] py-1.5',
                  soon ? ON_ACCENT : 'bg-well',
                )}
                style={soon ? { background: ACCENT } : undefined}
              >
                <span
                  className={cn(
                    'text-[10px] font-semibold tracking-[0.06em] uppercase',
                    soon ? 'opacity-70' : 'text-muted',
                  )}
                >
                  {MONTHS[Number(month) - 1]}
                </span>
                <span
                  className={cn(
                    'font-display text-[17px] leading-none font-bold',
                    !soon && 'text-ink',
                  )}
                >
                  {Number(day)}
                </span>
              </span>
              <span aria-hidden="true" className="relative flex h-full min-h-[56px] justify-center">
                <span
                  className="absolute left-1/2 w-px -translate-x-1/2 bg-line-strong"
                  style={{ top: first ? '50%' : 0, bottom: last ? '50%' : 0 }}
                />
                <span
                  className="relative my-auto size-3 rounded-full shadow-[0_0_0_3px_var(--color-surface)]"
                  style={{ background: LOOK[item.category].color }}
                />
              </span>
              <span className="min-w-0 py-2">
                <span className="block truncate text-[14.5px] font-medium text-ink">
                  {item.name}
                </span>
                <span className="block text-[12.5px] text-muted">
                  <span className="sr-only">{dayText(date, today, true)}, </span>
                  {days < 7 && days > 1
                    ? `${formatDay(date, { weekday: true }).split(',')[0]}, ${relativeDay(today, date)}`
                    : relativeDay(today, date)}
                  {count > 1 && ` · ${count}× in ${SOON_DAYS} days`}
                </span>
              </span>
              <span className="mono-num shrink-0 text-right text-[14.5px] font-semibold text-ink">
                {money(item.cost)}
              </span>
            </li>
          );
        })}
      </ol>

      {charges.length > 4 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((value) => !value)}
          className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-ink-2 hover:text-ink lg:min-h-0"
        >
          <Icon
            name="chevron-down"
            size={15}
            className={cn('transition-transform', all && 'rotate-180')}
          />
          {all ? 'Show fewer' : `Show all ${charges.length}`}
        </button>
      )}
    </section>
  );
}
