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
import { allocate, formatMoney } from '@/lib/tools/split';
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  changeCurrency,
  chargeAt,
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
import { ActionButton, Choices, Label, Note, SampleButton, StartPanel, Surface } from './kit';
import { MoneyInput } from './money-input';

/*
 * Subscriptions: what you pay for, kept in this browser, and what it all really costs — a month,
 * a year, what charges next — with free trials that are about to turn paid called out.
 * Nothing is connected to a bank or an inbox: people tap what they pay for, type what it costs,
 * and can take the list with them.
 */

const STORAGE_KEY = 'hyphy.subscriptions.v1';
const MAX_IMPORT_BYTES = 2_000_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ACCENT = 'var(--accent, var(--color-ink))';
const GLOW = 'var(--glow, var(--accent, var(--color-ink)))';

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

/** The kinds of things most people pay for: one tap to start one. No prices: only you know yours. */
type Preset = {
  id: string;
  name: string;
  category: CategoryId;
  icon: IconName;
  unit: 'week' | 'month' | 'year';
};
const PRESETS: Preset[] = [
  { id: 'streaming', name: 'Streaming', category: 'streaming', icon: 'play', unit: 'month' },
  { id: 'music', name: 'Music', category: 'music', icon: 'music', unit: 'month' },
  { id: 'cloud', name: 'Cloud storage', category: 'cloud', icon: 'archive', unit: 'month' },
  { id: 'gym', name: 'Gym', category: 'fitness', icon: 'activity', unit: 'month' },
  { id: 'phone', name: 'Phone plan', category: 'utilities', icon: 'phone', unit: 'month' },
  { id: 'internet', name: 'Internet', category: 'utilities', icon: 'wifi', unit: 'month' },
  { id: 'news', name: 'News', category: 'news', icon: 'file-text', unit: 'month' },
  { id: 'apps', name: 'Apps', category: 'software', icon: 'command', unit: 'month' },
  { id: 'games', name: 'Games', category: 'other', icon: 'dice', unit: 'month' },
  { id: 'meals', name: 'Meal kit', category: 'food', icon: 'utensils', unit: 'week' },
  { id: 'delivery', name: 'Delivery pass', category: 'shopping', icon: 'truck', unit: 'month' },
];

const SORT_LABELS: Record<SortBy, string> = { next: 'Next charge', cost: 'Cost', name: 'Name' };

/** How often, as chips. "Other" opens "every N days/weeks/months/years". */
type Cycle = 'month' | 'year' | 'week' | 'other';
const CYCLES: { value: Cycle; label: string }[] = [
  { value: 'month', label: 'Monthly' },
  { value: 'year', label: 'Yearly' },
  { value: 'week', label: 'Weekly' },
  { value: 'other', label: 'Other' },
];
const cycleOf = (draft: Draft): Cycle =>
  draft.frequency === 'months' || draft.frequency === 'custom' ? 'other' : draft.frequency;

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
}: {
  category: CategoryId;
  icon?: IconName;
  size?: 'sm' | 'md' | 'lg';
}) {
  const look = LOOK[category];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
        size === 'lg' && 'size-12 rounded-[15px]',
        size === 'md' && 'size-10 rounded-[12px]',
        size === 'sm' && 'size-8 rounded-[10px]',
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
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<Preset | 'other' | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ item: Subscription; index: number } | null>(null);
  const [incoming, setIncoming] = useState<{ file: string; data: Imported } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const overviewRef = useRef<HTMLElement>(null);

  const ready = loaded && today !== '';
  const { items, currency } = list;
  const summary = useMemo(() => (ready ? summarize(items, today) : null), [ready, items, today]);
  const sorted = useMemo(
    () => (ready ? sortSubscriptions(items, list.sort, today) : []),
    [ready, items, list.sort, today],
  );
  const money = (amount: number) => formatMoney(amount, currency);
  const samples = items.filter((item) => item.sample).length;
  const empty = items.length === 0;
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
    toast({ title: `Added ${item.name}`, description: priceText(item, currency) });
  };

  const finishAdding = () => {
    setAdding(false);
    setPicked(null);
    requestAnimationFrame(() =>
      overviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
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

  const trySample = () => {
    updateItems(() => sampleItems(today));
    setAdding(false);
    setPicked(null);
    setRemoved(null);
  };

  const clearSample = () => {
    updateItems((current) => current.filter((item) => !item.sample));
    setOpen(null);
    setEditing(null);
    setRemoved(null);
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
  };

  if (!ready || !summary)
    return (
      <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)]">
        <div className="skeleton h-[520px] !rounded-[26px]" />
        <div className="skeleton hidden h-[520px] !rounded-[22px] lg:block" />
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

  // The way in: tiles to tap, or the short form for the one that was tapped.
  const adder = full ? (
    <p className="text-[13.5px] text-muted">
      A list holds {MAX_ITEMS} subscriptions. Remove one to add another.
    </p>
  ) : picked ? (
    <SubscriptionForm
      key={formKey}
      variant={picked === 'other' ? 'full' : 'quick'}
      icon={picked === 'other' ? undefined : picked.icon}
      initial={
        picked === 'other'
          ? emptyDraft()
          : {
              ...emptyDraft(),
              name: picked.name,
              category: picked.category,
              frequency: picked.unit,
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
    <TileGrid idPrefix={id} added={addedNames} onPick={pick} />
  );

  const backup = (
    // Backups are housekeeping, not the job: one folded line, opened when needed.
    <Surface as="section" aria-labelledby={`${id}-data`} className="!py-1">
      <details className="group/data">
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
          <p className="text-[13.5px] leading-relaxed text-muted">
            Your list stays in this browser, and clearing your browsing data clears it too. Download
            a backup to keep it safe or to open it somewhere else.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => exportAs('json')}
              disabled={!items.length}
              className={quietButton}
            >
              <Icon name="download" size={16} /> Download a backup
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className={quietButton}
            >
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
    </Surface>
  );

  const removedNote = (
    <>
      <p aria-live="polite" className="sr-only">
        {removed ? `Removed ${removed.item.name}. Undo is below the list.` : ''}
      </p>
      {removed && (
        <Note icon="trash" className="!items-center">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Removed {removed.item.name}.</span>
            <button
              type="button"
              onClick={undoRemove}
              className="inline-flex min-h-11 items-center gap-1 font-semibold text-ink underline underline-offset-2 lg:min-h-0"
            >
              Undo
            </button>
          </span>
        </Note>
      )}
    </>
  );

  /* ---------- Nothing yet: tap what you pay for ---------- */
  if (empty)
    return (
      <div className="mx-auto grid w-full max-w-[680px] gap-5">
        <StartPanel
          art={picked ? undefined : <LedgerArt />}
          title={picked ? 'What does it cost?' : 'What do you pay for?'}
          lead={
            picked
              ? 'Type what one charge costs. Everything else can wait.'
              : 'Tap everything you pay for again and again. You’ll add what each one costs, and see what it all really adds up to.'
          }
          footer={
            !picked && (
              <div className="grid justify-items-center gap-3">
                <SampleButton onClick={trySample}>See it with a sample list</SampleButton>
                <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                  <Icon name="lock" size={13} className="text-faint" />
                  <span>Stays in this browser. Nothing connects to your bank.</span>
                  <span className="inline-flex items-center gap-1.5">
                    Prices in {currencyPicker}
                  </span>
                </p>
              </div>
            )
          }
        >
          <div className="text-left">{adder}</div>
        </StartPanel>
        {removedNote}
        {backup}
      </div>
    );

  /* ---------- A list: the overview, and the list itself ---------- */
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] lg:items-start">
      <aside
        ref={overviewRef}
        aria-label="What it all costs"
        className={cn(
          'grid min-w-0 scroll-mt-24 gap-4 lg:col-start-2 lg:row-start-1',
          // On a phone, adding keeps the tiles on top; otherwise the total leads.
          adding && 'order-last lg:order-none',
        )}
      >
        <Overview summary={summary} currency={currency} />
        <Timeline summary={summary} items={items} today={today} currency={currency} />
      </aside>

      <div className="grid min-w-0 gap-5 lg:col-start-1 lg:row-start-1">
        {samples > 0 && (
          <Note icon="sparkles" className="!items-center">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {samples === items.length ? 'This is a sample list' : 'Your list includes samples'}:
                made-up services and prices, to show how it works.
              </span>
              <button
                type="button"
                onClick={clearSample}
                className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-2 lg:min-h-0"
              >
                Clear the sample
              </button>
            </span>
          </Note>
        )}

        {adding ? (
          <Surface
            as="section"
            aria-labelledby={`${id}-add`}
            className="relative isolate grid gap-4 overflow-hidden"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                background: `radial-gradient(80% 60% at 50% 0%, color-mix(in srgb, ${ACCENT} 12%, transparent), transparent 70%)`,
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label id={`${id}-add`}>{picked ? 'What does it cost?' : 'Tap to add more'}</Label>
                <p className="mt-1 text-[13.5px] text-muted" aria-live="polite">
                  {items.length} on your list ·{' '}
                  <span className="mono-num font-semibold text-ink">{money(summary.monthly)}</span>{' '}
                  a month
                </p>
              </div>
              <button
                type="button"
                onClick={finishAdding}
                className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-semibold text-[#12110d] transition-transform active:scale-[.97] lg:h-10 lg:text-[14px]"
                style={{ background: ACCENT }}
              >
                <Icon name="check" size={16} /> Done
              </button>
            </div>
            {adder}
          </Surface>
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

        <Surface as="section" aria-labelledby={`${id}-list`} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <Label id={`${id}-list`}>Your subscriptions · {items.length}</Label>
              <p className="mono-num mt-1 text-[12.5px] text-muted">
                {money(summary.monthly)} a month
                {summary.paused > 0 && ` · ${summary.paused} paused`}
              </p>
            </div>
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
        </Surface>

        {removedNote}
        {backup}
      </div>
    </div>
  );
}

/* ---------------- The way in ---------------- */

function TileGrid({
  idPrefix,
  added,
  onPick,
}: {
  idPrefix: string;
  added: Set<string>;
  onPick: (choice: Preset | 'other') => void;
}) {
  return (
    <div
      role="group"
      aria-label="What do you pay for?"
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-2.5"
    >
      {PRESETS.map((preset) => {
        const on = added.has(preset.name.toLowerCase());
        return (
          <button
            key={preset.id}
            id={`${idPrefix}-tile-${preset.id}`}
            type="button"
            onClick={() => onPick(preset)}
            className={cn(
              'relative flex min-h-[96px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] px-1.5 py-3 text-center transition-[background-color,box-shadow,transform] active:scale-[.97]',
              on
                ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--glow,var(--color-signal))_55%,transparent)]'
                : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
            )}
          >
            <CategoryMark category={preset.category} icon={preset.icon} />
            <span className="text-[13.5px] leading-tight font-medium text-ink">{preset.name}</span>
            {on && (
              <span
                className="absolute top-2 right-2 grid size-5 place-items-center rounded-full text-[#12110d]"
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
        className="flex min-h-[96px] min-w-0 flex-col items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong px-1.5 py-3 text-center transition-[background-color,transform] hover:bg-ink/5 active:scale-[.97]"
      >
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-[12px] text-[#12110d]"
          style={{ background: ACCENT }}
        >
          <Icon name="plus" size={19} />
        </span>
        <span className="text-[13.5px] leading-tight font-medium text-ink">Something else</span>
      </button>
    </div>
  );
}

/** The picture on the first screen: a little ledger that adds up, with its circle of colors. */
function LedgerArt() {
  const rows: [CategoryId, number][] = [
    ['streaming', 70],
    ['music', 52],
    ['cloud', 60],
    ['fitness', 44],
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto h-[200px] w-[272px]">
      <div className="absolute top-2 left-3 w-[204px] -rotate-[4deg] rounded-[18px] bg-subtle p-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong),0_26px_44px_-26px_rgb(0_0_0/.7)]">
        {rows.map(([category, width]) => (
          <div key={category} className="flex items-center gap-2.5 py-[5px]">
            <span className="size-5 rounded-[7px]" style={{ background: LOOK[category].color }} />
            <span className="h-2 rounded-full bg-ink/15" style={{ width }} />
            <span className="ml-auto h-2 w-7 rounded-full bg-ink/25" />
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2.5">
          <span className="h-2 w-12 rounded-full bg-ink/15" />
          <span className="h-3 w-14 rounded-full" style={{ background: ACCENT }} />
        </div>
      </div>
      <div className="absolute right-1 bottom-0 rotate-[8deg] rounded-full bg-surface p-1.5 shadow-[0_18px_36px_-20px_rgb(0_0_0/.8)]">
        <Donut
          size={86}
          parts={[
            { id: 'streaming', share: 0.34 },
            { id: 'fitness', share: 0.26 },
            { id: 'music', share: 0.22 },
            { id: 'cloud', share: 0.18 },
          ]}
        />
      </div>
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

/**
 * One subscription's form. "quick" came from a tile: the name and category are already known, so
 * it asks only what it costs and how often. "full" also asks the name and category. The next
 * charge, free trial, cancel link and notes wait under More options.
 */
function SubscriptionForm({
  variant,
  icon,
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
    if (first && (LATER_FIELDS.includes(first) || (quick && first === 'name'))) setMore(true);
    requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
  };

  const setCycle = (cycle: Cycle) =>
    change(
      cycle === 'other'
        ? {
            frequency: 'custom',
            unit:
              draft.frequency === 'week' || draft.frequency === 'year' ? draft.frequency : 'month',
            every: draft.frequency === 'custom' || draft.frequency === 'months' ? draft.every : '3',
          }
        : { frequency: cycle },
    );

  const schedule = scheduleOf(draft);
  const shownNext = complete(draft).next;
  const past =
    schedule && parseDay(draft.next) && draft.next < today
      ? nextCharge({ next: draft.next, ...schedule }, today)
      : null;
  const errorCount = Object.keys(errors).length;
  const money = (amount: number) => formatMoney(amount, currency);
  const otherUnit = draft.frequency === 'months' ? 'month' : draft.unit;

  // What that works out to: the satisfying bit while typing a price.
  const worksOut =
    schedule && draft.cost > 0
      ? schedule.every === 1 && schedule.unit === 'month'
        ? `That’s ${money(Math.round(yearlyCost({ cost: draft.cost, ...schedule })))} a year.`
        : `${frequencyLabel(schedule.every, schedule.unit)}: about ${money(Math.round(monthlyCost({ cost: draft.cost, ...schedule })))} a month.`
      : null;

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
      <div className={cn(contained && 'overflow-hidden')}>
        <Choices
          label="Kind"
          value={draft.category}
          scroll
          options={CATEGORY_IDS.map((category) => ({
            value: category,
            label: CATEGORY_LABELS[category],
            swatch: LOOK[category].color,
          }))}
          onChange={(category) => change({ category })}
        />
      </div>
    </div>
  );

  return (
    <form ref={form} onSubmit={submit} noValidate className="grid animate-fade gap-5">
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

      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-cost`} className="text-[13.5px] font-medium text-ink-2">
          What one charge costs
        </label>
        <MoneyInput
          id={`${id}-cost`}
          label={errors.cost ? `What one charge costs. ${errors.cost}` : 'What one charge costs'}
          value={draft.cost}
          currency={currency}
          autoFocus={autoFocus && (quick || Boolean(initial.name))}
          onChange={(cost) => change({ cost })}
          onEnter={() => form.current?.requestSubmit()}
          inputClassName={cn(
            '!h-14 !text-[24px] font-semibold !text-left',
            errors.cost && '!shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
          )}
        />
        <p
          className={cn('min-h-[18px] text-[12.5px]', errors.cost ? 'text-critical' : 'text-muted')}
        >
          {errors.cost ?? worksOut ?? 'A close guess is fine. You can change it any time.'}
        </p>
      </div>

      <div className="grid min-w-0 gap-2">
        <p className="text-[13.5px] font-medium text-ink-2">How often</p>
        <div role="radiogroup" aria-label="How often" className="grid grid-cols-4 gap-1.5">
          {CYCLES.map((cycle) => {
            const on = cycleOf(draft) === cycle.value;
            return (
              <button
                key={cycle.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setCycle(cycle.value)}
                className={cn(
                  'h-12 min-w-0 rounded-[13px] px-1 text-[14.5px] font-medium transition-[background-color,color,transform] active:scale-[.97] lg:h-11 lg:text-[14px]',
                  on ? 'text-[#12110d]' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
                style={on ? { background: ACCENT } : undefined}
              >
                {cycle.label}
              </button>
            );
          })}
        </div>
        {cycleOf(draft) === 'other' && (
          <div className="flex animate-fade flex-wrap items-center gap-2 pt-1 text-[14px] text-ink-2">
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
              className={cn('w-full text-[12.5px]', errors.every ? 'text-critical' : 'text-muted')}
            >
              {errors.every ?? (schedule ? '' : `A whole number from 1 to ${MAX_EVERY}.`)}
            </p>
          </div>
        )}
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
                    ? 'A close guess is fine.'
                    : 'A guess, one charge from today. Pick the real day if you know it.'
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
              hint="It’s flagged when the day is close."
            >
              <input
                id={`${id}-trialEnds`}
                type="date"
                value={draft.trialEnds}
                onChange={(event) => change({ trialEnds: event.target.value })}
                className={cn(field, 'text-left')}
                {...described(`${id}-trialEnds`, errors.trialEnds, true)}
              />
            </Row>
            <Row
              label="How to cancel"
              htmlFor={`${id}-cancelUrl`}
              error={errors.cancelUrl}
              optional
              hint="The page where you cancel, for the day you need it."
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
                {...described(`${id}-cancelUrl`, errors.cancelUrl, true)}
              />
            </Row>
            <Row label="Notes" htmlFor={`${id}-notes`} optional>
              <textarea
                id={`${id}-notes`}
                value={draft.notes}
                maxLength={500}
                rows={2}
                placeholder="Shared with the family. Cancel by phone."
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

  return (
    <li
      className={cn(
        'relative min-w-0 overflow-hidden rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
        expanded && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', item.paused && 'opacity-40')}
        style={{ background: color }}
      />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-details`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-3 pr-3 pl-3.5 text-left sm:pr-3.5 sm:pl-4"
      >
        <span className={cn('contents', item.paused && '[&>*]:opacity-55')}>
          <CategoryMark category={item.category} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium text-ink">{item.name}</span>
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
                  className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-signal-ink underline-offset-2 hover:underline lg:min-h-0"
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
              {item.paused && (
                <p className="text-[12.5px] text-muted">
                  Paused subscriptions stay on your list but aren’t in any total.
                </p>
              )}
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
        should happen to your {count(current)}?
      </p>
      <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted">
        {sameCurrency ? (
          <li>
            <span className="font-medium text-ink-2">Add to my list</span> keeps yours and adds
            these. Anything already on your list isn’t doubled.
          </li>
        ) : (
          <li>
            This file is in {data.currency} and your list is in {currency}. A list has one currency,
            so it can only replace yours.
          </li>
        )}
        <li>
          <span className="font-medium text-ink-2">Replace my list</span> swaps yours for the
          file’s. Download a backup of yours first if you might want it back.
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

/** A ring of colors, one arc per part, drawn in SVG. */
function Donut({
  parts,
  size = 120,
  children,
}: {
  parts: { id: CategoryId; share: number }[];
  size?: number;
  children?: ReactNode;
}) {
  const gap = parts.length > 1 ? 1.2 : 0;
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
          strokeWidth="15"
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
              strokeWidth="15"
              pathLength={100}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-starts[index]}
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

function Overview({ summary, currency }: { summary: Summary; currency: Currency }) {
  const id = useId();
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const money = (amount: number) => formatMoney(amount, currency);
  const yearly = period === 'year';
  const parts = yearly
    ? allocate(
        summary.yearly,
        summary.categories.map((part) => part.share),
      )
    : summary.categories.map((part) => part.monthly);
  const biggest = summary.biggest[0];

  return (
    <Surface
      as="section"
      aria-labelledby={`${id}-title`}
      className="relative isolate grid gap-5 overflow-hidden !p-5 sm:!p-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(70% 60% at 100% 0%, color-mix(in srgb, ${ACCENT} 16%, transparent), transparent 70%), radial-gradient(60% 50% at 0% 100%, color-mix(in srgb, ${GLOW} 9%, transparent), transparent 70%)`,
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="label flex items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: GLOW }} />
          It all costs
        </h2>
        <div
          role="radiogroup"
          aria-label="Show the total"
          className="flex rounded-full bg-well p-1"
        >
          {(['month', 'year'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={period === value}
              onClick={() => setPeriod(value)}
              className={cn(
                'h-9 rounded-full px-3.5 text-[13.5px] font-medium transition-colors',
                period === value ? 'text-[#12110d]' : 'text-muted hover:text-ink',
              )}
              style={period === value ? { background: ACCENT } : undefined}
            >
              {value === 'month' ? 'Month' : 'Year'}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" aria-atomic="true">
        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span
            className="font-display text-[50px] leading-[0.9] font-extrabold tracking-[-0.045em] text-ink sm:text-[60px]"
            style={{ fontVariationSettings: "'wdth' 112" }}
          >
            {money(yearly ? summary.yearly : summary.monthly)}
          </span>
          <span className="text-[17px] font-medium text-muted">a {period}</span>
        </p>
        <p className="mt-2.5 text-[14px] text-muted">
          That’s{' '}
          <span className="mono-num font-medium text-ink-2">
            {money(yearly ? summary.monthly : summary.yearly)}
          </span>{' '}
          a {yearly ? 'month' : 'year'}, from {summary.active}{' '}
          {summary.active === 1 ? 'subscription' : 'subscriptions'}
          {summary.paused > 0 && ` (${summary.paused} paused, not counted)`}.
        </p>
      </div>

      {summary.categories.length > 0 ? (
        <section aria-label="Where it goes" className="flex items-center gap-5 sm:gap-6">
          <Donut parts={summary.categories} size={116}>
            <span>
              <span className="mono-num block text-[20px] leading-none font-bold text-ink">
                {summary.categories.length}
              </span>
              <span className="mt-1 block text-[11px] text-muted">
                {summary.categories.length === 1 ? 'kind' : 'kinds'}
              </span>
            </span>
          </Donut>
          <ul className="grid min-w-0 flex-1 gap-2">
            {summary.categories.map((part, index) => (
              <li key={part.id} className="flex min-w-0 items-center gap-2 text-[13.5px]">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: LOOK[part.id].color }}
                />
                <span className="min-w-0 flex-1 truncate text-ink-2">{part.label}</span>
                <span className="mono-num shrink-0 text-ink">{money(parts[index])}</span>
                <span className="mono-num hidden w-9 shrink-0 text-right text-[12px] text-muted min-[400px]:block">
                  {percent(part.share)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-[13.5px] text-muted">Everything is paused, so nothing is counted.</p>
      )}

      {biggest && summary.active > 1 && (
        <p className="flex items-start gap-2.5 rounded-[14px] bg-well px-3.5 py-3 text-[13.5px] leading-snug text-ink-2">
          <Icon name="target" size={16} className="mt-0.5 shrink-0 text-signal-ink" />
          <span>
            Biggest: <span className="font-semibold text-ink">{biggest.name}</span>,{' '}
            <span className="mono-num">{money(biggest.yearly)}</span> a year,{' '}
            {percent(biggest.share)} of it all.
          </span>
        </p>
      )}

      {summary.averaged && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          Weekly and daily charges are averaged over a year: a weekly charge counts about 4.35 times
          a month.
        </p>
      )}
    </Surface>
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
  const shown = all ? charges : charges.slice(0, 5);

  if (!charges.length && !summary.trials.length) return null;

  return (
    <Surface as="section" aria-labelledby={`${id}-title`} className="grid gap-4 !p-5 sm:!p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <Label id={`${id}-title`}>Charges next</Label>
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
                  Then {priceText(trial.item, currency)}. Cancel before then if you don’t want to
                  keep it.
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
                  soon ? 'text-[#12110d]' : 'bg-well',
                )}
                style={soon ? { background: ACCENT } : undefined}
              >
                <span
                  className={cn(
                    'text-[10px] font-semibold tracking-[0.06em] uppercase',
                    soon ? 'text-[#12110d]/70' : 'text-muted',
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
              <span aria-hidden="true" className="relative flex h-full min-h-[60px] justify-center">
                <span
                  className="absolute left-1/2 w-px -translate-x-1/2 bg-line-strong"
                  style={{ top: first ? '50%' : 0, bottom: last ? '50%' : 0 }}
                />
                <span
                  className="relative my-auto size-3 rounded-full shadow-[0_0_0_3px_var(--color-surface)]"
                  style={{ background: LOOK[item.category].color }}
                />
              </span>
              <span className="min-w-0 py-2.5">
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

      {charges.length > 5 && (
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
    </Surface>
  );
}
