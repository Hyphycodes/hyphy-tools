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
import { formatMoney } from '@/lib/tools/split';
import {
  CATEGORY_IDS,
  CATEGORY_LABELS,
  changeCurrency,
  CURRENCIES,
  draftOf,
  emptyDraft,
  exportJson,
  formatDay,
  FREQUENCIES,
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
import { Label, Note, Surface } from './kit';
import { MoneyInput } from './money-input';

/*
 * Subscriptions: what you pay for, kept in this browser, and what it all really costs — a month,
 * a year, the next 30 days — with free trials that are about to turn paid called out.
 * Nothing is connected to a bank or an inbox: people type their list, and can take it with them.
 */

const STORAGE_KEY = 'hyphy.subscriptions.v1';
const MAX_IMPORT_BYTES = 2_000_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

const SORT_LABELS: Record<SortBy, string> = { next: 'Next charge', cost: 'Cost', name: 'Name' };

const field =
  'h-11 w-full min-w-0 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none transition-shadow placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_0_4px_rgb(106_116_255/.14)] aria-[invalid=true]:shadow-[inset_0_0_0_1.5px_var(--color-critical)] lg:h-10 lg:text-[14.5px]';
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

function CategoryMark({ category, size = 'md' }: { category: CategoryId; size?: 'sm' | 'md' }) {
  const look = LOOK[category];
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center text-[#12110d] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]',
        size === 'md' ? 'size-10 rounded-[12px]' : 'size-8 rounded-[10px]',
      )}
      style={{ background: look.color }}
    >
      <Icon name={look.icon} size={size === 'md' ? 18 : 15} />
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
  const [formKey, setFormKey] = useState(0);
  const [focusForm, setFocusForm] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removed, setRemoved] = useState<{ item: Subscription; index: number } | null>(null);
  const [incoming, setIncoming] = useState<{ file: string; data: Imported } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const ready = loaded && today !== '';
  const { items, currency } = list;
  const summary = useMemo(() => (ready ? summarize(items, today) : null), [ready, items, today]);
  const sorted = useMemo(
    () => (ready ? sortSubscriptions(items, list.sort, today) : []),
    [ready, items, list.sort, today],
  );
  const money = (amount: number) => formatMoney(amount, currency);
  const samples = items.filter((item) => item.sample).length;
  const formOpen = items.length === 0 || adding;
  const full = items.length >= MAX_ITEMS;

  const updateItems = (change: (current: Subscription[]) => Subscription[]) =>
    setList((current) => ({ ...current, items: change(current.items) }));

  const add = (value: SubscriptionFields) => {
    const item: Subscription = { id: `s${newId(8)}`, ...value, paused: false };
    updateItems((current) => (current.length >= MAX_ITEMS ? current : [...current, item]));
    setRemoved(null);
    // Keep the form open for the next one: most people add several in a row.
    setAdding(true);
    setFormKey((key) => key + 1);
    setFocusForm(true);
    toast({ title: `Added ${item.name}`, description: priceText(item, currency) });
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
    setFocusForm(false);
    setRemoved(null);
  };

  const clearSample = () => {
    updateItems((current) => current.filter((item) => !item.sample));
    setFocusForm(false);
    setOpen(null);
    setEditing(null);
    setRemoved(null);
  };

  const exportAs = (kind: 'csv' | 'json') => {
    if (kind === 'csv') downloadText(toCsv(list, today), `subscriptions-${today}.csv`, 'text/csv');
    else downloadText(exportJson(list, today), `subscriptions-${today}.json`, 'application/json');
    toast({
      title: `Exported ${items.length} ${items.length === 1 ? 'subscription' : 'subscriptions'}`,
      description: kind === 'csv' ? 'A CSV for any spreadsheet' : 'A JSON file you can import here',
      icon: 'download',
    });
  };

  const chooseImport = async (file: File) => {
    setImportError('');
    setIncoming(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError('That file is too big to be a Subscriptions export. Nothing was imported.');
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
    setOpen(null);
    setEditing(null);
    setRemoved(null);
  };

  const clearAll = () => {
    if (
      !window.confirm(
        'Clear your whole list from this browser? Export a copy first if you might want it back.',
      )
    )
      return;
    setList(newList(currency));
    setFocusForm(false);
    setOpen(null);
    setEditing(null);
    setRemoved(null);
    setIncoming(null);
  };

  if (!ready || !summary)
    return (
      <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)]">
        <div className="skeleton h-[420px] !rounded-[22px]" />
        <div className="skeleton hidden h-[420px] !rounded-[22px] lg:block" />
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

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)] lg:grid-rows-[auto_1fr] lg:items-start">
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

        {formOpen ? (
          <Surface as="section" aria-labelledby={`${id}-add`} className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label id={`${id}-add`}>{items.length ? 'Add another' : 'Add a subscription'}</Label>
              {items.length === 0 ? (
                <button
                  type="button"
                  onClick={trySample}
                  className="-my-2 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-signal-ink transition-colors hover:bg-signal-soft lg:h-9"
                >
                  <Icon name="sparkles" size={15} /> Try a sample list
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    // The form goes away: keep keyboard focus where the form was opened from.
                    requestAnimationFrame(() =>
                      document.getElementById(`${id}-open-form`)?.focus(),
                    );
                  }}
                  className="-my-2 inline-flex h-11 items-center rounded-full px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-9"
                >
                  Done
                </button>
              )}
            </div>
            {full ? (
              <p className="text-[13.5px] text-muted">
                A list holds {MAX_ITEMS} subscriptions. Remove one to add another.
              </p>
            ) : (
              <SubscriptionForm
                key={formKey}
                initial={emptyDraft()}
                currency={currency}
                today={today}
                submitLabel="Add subscription"
                submitIcon="plus"
                autoFocus={focusForm}
                currencyPicker={items.length === 0 ? currencyPicker : undefined}
                onSubmit={add}
              />
            )}
          </Surface>
        ) : (
          <button
            id={`${id}-open-form`}
            type="button"
            onClick={() => {
              setAdding(true);
              setFocusForm(true);
            }}
            className="flex h-14 items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-line-strong text-[15px] font-medium text-ink-2 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
          >
            <Icon name="plus" size={17} /> Add a subscription
          </button>
        )}

        {items.length > 0 && (
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
        )}

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
      </div>

      <SummaryPanel summary={summary} items={items} today={today} currency={currency} />

      <Surface
        as="section"
        aria-labelledby={`${id}-data`}
        className="grid gap-4 lg:col-start-1 lg:row-start-2"
      >
        <div className="grid gap-1.5">
          <Label id={`${id}-data`}>Keep a copy</Label>
          <p className="text-[13.5px] leading-relaxed text-muted">
            Your list is saved in this browser only, and clearing your browser data deletes it.
            Export a copy to keep it safe or to move it to another device.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportAs('csv')}
            disabled={!items.length}
            className={quietButton}
          >
            <Icon name="download" size={16} /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => exportAs('json')}
            disabled={!items.length}
            className={quietButton}
          >
            <Icon name="braces" size={16} /> Export JSON
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} className={quietButton}>
            <Icon name="upload" size={16} /> Import JSON
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
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-4">
          <p className="flex items-center gap-2 text-[12.5px] text-faint">
            <Icon name="sparkles" size={14} /> Coming later: find subscriptions in your email
            receipts.
          </p>
          {items.length > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex min-h-11 items-center text-[13px] text-muted underline-offset-2 hover:text-critical hover:underline lg:min-h-0"
            >
              Clear the whole list
            </button>
          )}
        </div>
      </Surface>
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

function SubscriptionForm({
  initial,
  currency,
  today,
  submitLabel,
  submitIcon,
  autoFocus,
  currencyPicker,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  currency: Currency;
  today: string;
  submitLabel: string;
  submitIcon: IconName;
  autoFocus?: boolean;
  currencyPicker?: ReactNode;
  onSubmit: (value: SubscriptionFields) => void;
  onCancel?: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [more, setMore] = useState(
    Boolean(initial.trialEnds || initial.cancelUrl || initial.notes),
  );

  const change = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    // A free trial usually turns paid the day it ends: a good first guess for the next charge.
    if (patch.trialEnds && !draft.next && parseDay(patch.trialEnds)) next.next = patch.trialEnds;
    setDraft(next);
    // Errors already showing clear as they're fixed; nothing new lights up while typing.
    if (Object.keys(errors).length) {
      const result = readDraft(next);
      const kept: DraftErrors = {};
      if (!result.ok)
        for (const key of FIELD_ORDER) if (errors[key]) kept[key] = result.errors[key];
      setErrors(kept);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = readDraft(draft);
    if (result.ok) {
      onSubmit(result.value);
      return;
    }
    setErrors(result.errors);
    const first = FIELD_ORDER.find((key) => result.errors[key]);
    if (first === 'trialEnds' || first === 'cancelUrl') setMore(true);
    requestAnimationFrame(() => document.getElementById(`${id}-${first}`)?.focus());
  };

  const schedule = scheduleOf(draft);
  const past =
    schedule && parseDay(draft.next) && draft.next < today
      ? nextCharge({ next: draft.next, ...schedule }, today)
      : null;
  const errorCount = Object.keys(errors).length;

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,.8fr)]">
        <Row label="What is it?" htmlFor={`${id}-name`} error={errors.name}>
          <input
            id={`${id}-name`}
            value={draft.name}
            maxLength={80}
            autoFocus={autoFocus}
            autoComplete="off"
            placeholder="Music app"
            onChange={(event) => change({ name: event.target.value })}
            className={field}
            {...described(`${id}-name`, errors.name)}
          />
        </Row>
        <Row label="What one charge costs" htmlFor={`${id}-cost`} error={errors.cost}>
          <div className="flex gap-2">
            <MoneyInput
              id={`${id}-cost`}
              label={errors.cost ? `Cost. ${errors.cost}` : 'What one charge costs'}
              value={draft.cost}
              currency={currency}
              onChange={(cost) => change({ cost })}
              className="min-w-0 flex-1"
              inputClassName={cn(
                errors.cost && '!shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
              )}
            />
            {currencyPicker}
          </div>
        </Row>
      </div>

      <div className="grid min-w-0 gap-2">
        <p id={`${id}-often`} className="text-[13.5px] font-medium text-ink-2">
          How often it charges
        </p>
        <div role="radiogroup" aria-labelledby={`${id}-often`} className="flex flex-wrap gap-1.5">
          {FREQUENCIES.map((frequency) => (
            <button
              key={frequency.id}
              type="button"
              role="radio"
              aria-checked={draft.frequency === frequency.id}
              onClick={() => change({ frequency: frequency.id })}
              className={cn(
                'h-11 rounded-[11px] px-3.5 text-[14px] font-medium transition-colors lg:h-9 lg:text-[13.5px]',
                draft.frequency === frequency.id
                  ? 'bg-ink text-on-ink'
                  : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
              )}
            >
              {frequency.label}
            </button>
          ))}
        </div>
        {(draft.frequency === 'months' || draft.frequency === 'custom') && (
          <div className="flex animate-fade flex-wrap items-center gap-2 pt-1 text-[14px] text-ink-2">
            <label htmlFor={`${id}-every`}>Every</label>
            <input
              id={`${id}-every`}
              inputMode="numeric"
              autoComplete="off"
              value={draft.every}
              maxLength={3}
              onChange={(event) => change({ every: event.target.value.replace(/\D/g, '') })}
              className={cn(field, 'num !w-20 text-center')}
              {...described(`${id}-every`, errors.every, true)}
            />
            {draft.frequency === 'months' ? (
              <span>{unitWord('month', Number(draft.every) || 2)}</span>
            ) : (
              <select
                aria-label="Days, weeks, months or years"
                value={draft.unit}
                onChange={(event) => change({ unit: event.target.value as Draft['unit'] })}
                className={cn(field, '!w-auto pr-8')}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitWord(unit, Number(draft.every) || 2)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {(draft.frequency === 'months' || draft.frequency === 'custom') && (
          <p
            id={`${id}-every-note`}
            className={cn('text-[12.5px]', errors.every ? 'text-critical' : 'text-muted')}
          >
            {errors.every ??
              (schedule
                ? `${frequencyLabel(schedule.every, schedule.unit)}, about ${formatMoney(Math.round(monthlyCost({ cost: draft.cost, ...schedule })), currency)} a month.`
                : `A whole number from 1 to ${MAX_EVERY}.`)}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Row
          label="Next charge"
          htmlFor={`${id}-next`}
          error={errors.next}
          hint={past ? `That’s past, so the next one is ${dayText(past, today)}.` : undefined}
        >
          <input
            id={`${id}-next`}
            type="date"
            value={draft.next}
            onChange={(event) => change({ next: event.target.value })}
            className={cn(field, 'text-left')}
            {...described(`${id}-next`, errors.next, past)}
          />
        </Row>
        <Row label="Category" htmlFor={`${id}-category`}>
          <div className="relative">
            <select
              id={`${id}-category`}
              value={draft.category}
              onChange={(event) => change({ category: event.target.value as CategoryId })}
              className={cn(field, 'appearance-none pr-9')}
            >
              {CATEGORY_IDS.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
            <Icon
              name="chevron-down"
              size={16}
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted"
            />
          </div>
        </Row>
      </div>

      <div className="grid gap-4">
        <button
          type="button"
          aria-expanded={more}
          aria-controls={`${id}-more`}
          onClick={() => setMore((value) => !value)}
          className="-my-1 inline-flex h-11 items-center gap-2 justify-self-start rounded-[10px] text-[14px] font-medium text-ink-2 hover:text-ink lg:h-9 lg:text-[13.5px]"
        >
          <Icon
            name="chevron-down"
            size={16}
            className={cn('transition-transform', more && 'rotate-180')}
          />
          Free trial, how to cancel, notes
        </button>
        {more && (
          <div id={`${id}-more`} className="grid animate-fade gap-4 sm:grid-cols-2">
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
            <Row label="Notes" htmlFor={`${id}-notes`} optional className="sm:col-span-2">
              <textarea
                id={`${id}-notes`}
                value={draft.notes}
                maxLength={500}
                rows={2}
                placeholder="Shared with the family. Cancel by phone."
                onChange={(event) => change({ notes: event.target.value })}
                className={cn(field, '!h-auto min-h-20 py-2.5 leading-relaxed')}
              />
            </Row>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={inkButton}>
          <Icon name={submitIcon} size={16} /> {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-11 items-center rounded-[11px] px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink lg:h-10 lg:text-[14px]"
          >
            Cancel
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

  return (
    <li
      className={cn(
        'min-w-0 rounded-[16px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
        expanded && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-details`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-3 text-left sm:px-3.5"
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
          className="grid animate-fade gap-3 border-t border-line px-3 pt-3 pb-3.5 sm:px-3.5"
        >
          {editing ? (
            <SubscriptionForm
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
                <Detail term="Category">{CATEGORY_LABELS[item.category]}</Detail>
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
            these. Ones exported from here before are updated, not doubled.
          </li>
        ) : (
          <li>
            This file is in {data.currency} and your list is in {currency}. A list has one currency,
            so it can only replace yours.
          </li>
        )}
        <li>
          <span className="font-medium text-ink-2">Replace my list</span> swaps yours for the
          file’s. Export yours first if you might want it back.
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

/* ---------------- The summary ---------------- */

function SummaryPanel({
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
  const [allUpcoming, setAllUpcoming] = useState(false);
  const money = (amount: number) => formatMoney(amount, currency);
  const byId = new Map(items.map((item) => [item.id, item]));
  const upcoming = allUpcoming ? summary.upcoming : summary.upcoming.slice(0, 5);
  const empty = items.length === 0;

  return (
    <aside
      aria-label="What it all costs"
      className="grid gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
    >
      <Surface className="grid gap-5 !p-5 sm:!p-6">
        <div aria-live="polite" aria-atomic="true">
          <p className="label flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 rounded-full bg-[var(--accent,var(--color-signal))]"
            />
            Your subscriptions cost
          </p>
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span
              className={cn(
                'font-display text-[46px] leading-[0.9] font-extrabold tracking-[-0.045em] sm:text-[56px]',
                empty ? 'text-faint' : 'text-ink',
              )}
              style={{ fontVariationSettings: "'wdth' 112" }}
            >
              {money(summary.monthly)}
            </span>
            <span className="text-[16px] font-medium text-muted">a month</span>
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <span
              className={cn(
                'font-display text-[28px] leading-none font-bold tracking-[-0.03em]',
                empty ? 'text-faint' : 'text-ink-2',
              )}
              style={{ fontVariationSettings: "'wdth' 108" }}
            >
              {money(summary.yearly)}
            </span>
            <span className="text-[14px] text-muted">a year</span>
          </p>
          {!empty && (
            <p className="mt-3 text-[13px] text-muted">
              {summary.active} counted
              {summary.paused > 0 && ` · ${summary.paused} paused, not counted`}
            </p>
          )}
        </div>
        {empty ? (
          <p className="text-[13.5px] leading-relaxed text-muted">
            Add what you pay for. Weekly, monthly, yearly: it all turns into one honest monthly
            number, plus what charges next.
          </p>
        ) : (
          summary.averaged && (
            <p className="text-[12.5px] leading-relaxed text-muted">
              Weekly and daily charges are averaged over a year: a weekly charge counts about 4.35
              times a month.
            </p>
          )
        )}

        {!empty && (
          <section aria-labelledby={`${id}-soon`} className="grid gap-3 border-t border-line pt-5">
            <div className="flex items-baseline justify-between gap-3">
              <Label id={`${id}-soon`}>Next {SOON_DAYS} days</Label>
              <p className="mono-num text-[13px] text-ink-2">
                {money(summary.upcomingTotal)}
                <span className="text-muted">
                  {' '}
                  · {summary.upcomingCount} {summary.upcomingCount === 1 ? 'charge' : 'charges'}
                </span>
              </p>
            </div>
            {summary.upcoming.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                Nothing charges in the next {SOON_DAYS} days.
              </p>
            ) : (
              <ul className="row-divide">
                {upcoming.map((charge) => {
                  const [, month, day] = charge.date.split('-');
                  return (
                    <li key={charge.id} className="flex items-center gap-3 py-2.5">
                      <span
                        aria-hidden="true"
                        className="grid w-11 shrink-0 justify-items-center rounded-[10px] bg-well py-1.5"
                      >
                        <span className="text-[10px] font-semibold tracking-[0.06em] text-muted uppercase">
                          {MONTHS[Number(month) - 1]}
                        </span>
                        <span className="font-display text-[17px] leading-none font-bold text-ink">
                          {Number(day)}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">
                          {charge.name}
                        </span>
                        <span className="block text-[12.5px] text-muted">
                          <span className="sr-only">{dayText(charge.date, today, true)}, </span>
                          {relativeDay(today, charge.date)}
                          {charge.count > 1 &&
                            ` · then ${charge.count - 1} more ${charge.count === 2 ? 'time' : 'times'}`}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="mono-num block text-[14.5px] font-semibold text-ink">
                          {money(charge.amount)}
                        </span>
                        {charge.count > 1 && (
                          <span className="mono-num block text-[11.5px] text-muted">
                            {money(charge.amount * charge.count)} in all
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {summary.upcoming.length > 5 && (
              <button
                type="button"
                aria-expanded={allUpcoming}
                onClick={() => setAllUpcoming((value) => !value)}
                className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-medium text-ink-2 hover:text-ink lg:min-h-0"
              >
                <Icon
                  name="chevron-down"
                  size={15}
                  className={cn('transition-transform', allUpcoming && 'rotate-180')}
                />
                {allUpcoming ? 'Show fewer' : `Show all ${summary.upcoming.length}`}
              </button>
            )}
          </section>
        )}

        {summary.trials.length > 0 && (
          <section aria-labelledby={`${id}-trials`} className="grid gap-2.5">
            <Label id={`${id}-trials`}>Free trials ending soon</Label>
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
                      Then {priceText(trial.item, currency)}. Cancel before then if you don’t want
                      to keep it.
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
          </section>
        )}
      </Surface>

      {summary.categories.length > 0 && (
        <Surface className="grid gap-5 !p-5 sm:!p-6">
          <section aria-labelledby={`${id}-where`} className="grid gap-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label id={`${id}-where`}>Where it goes</Label>
              <span className="text-[12px] text-muted">a month</span>
            </div>
            <ul className="grid gap-3">
              {summary.categories.map((part) => (
                <li key={part.id} className="grid gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                    <span className="flex min-w-0 items-center gap-2 text-ink-2">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: LOOK[part.id].color }}
                      />
                      <span className="truncate">{part.label}</span>
                    </span>
                    <span className="mono-num shrink-0 text-ink">
                      {money(part.monthly)}
                      <span className="text-muted"> · {percent(part.share)}</span>
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-well">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(1.5, part.share * 100)}%`,
                        background: LOOK[part.id].color,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {summary.biggest.length > 1 && (
            <section
              aria-labelledby={`${id}-biggest`}
              className="grid gap-3 border-t border-line pt-5"
            >
              <Label id={`${id}-biggest`}>Biggest costs</Label>
              <ol className="grid gap-2.5">
                {summary.biggest.map((entry) => {
                  const item = byId.get(entry.id);
                  return (
                    <li key={entry.id} className="flex items-center gap-3">
                      {item && <CategoryMark category={item.category} size="sm" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium text-ink">
                          {entry.name}
                        </span>
                        <span className="block text-[12.5px] text-muted">
                          {percent(entry.share)} of the total
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="mono-num block text-[14.5px] font-semibold text-ink">
                          {money(entry.monthly)}
                          <span className="text-[12px] font-normal text-muted"> a month</span>
                        </span>
                        <span className="mono-num block text-[11.5px] text-muted">
                          {money(entry.yearly)} a year
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
        </Surface>
      )}
    </aside>
  );
}
