'use client';
import { NextSteps } from './next-step';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { download, downloadText, slugName } from '@/lib/files/download';
import { newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import { deletePhoto, getPhoto, putPhoto, shrinkPhoto } from '@/lib/share/photos';
import { todayHere } from '@/lib/tools/plan';
import { parseReceipt } from '@/lib/tools/receipt';
import type { ReadProgress } from '@/lib/tools/receipt-reader';
import {
  byCategory,
  byMonth,
  CATEGORIES,
  CATEGORY_NAMES,
  EMPTY_RECEIPTS,
  extractExpense,
  filterReceipts,
  inPeriod,
  newExpense,
  PERIOD_NAMES,
  receiptsCsv,
  receiptsStoreSchema,
  recentTags,
  removeExpense,
  saveExpense,
  shortDate,
  type Expense,
  type Extracted,
  type Period,
  type ReceiptCategory,
  type ReceiptsStore,
} from '@/lib/tools/receipts';
import { formatMoney } from '@/lib/tools/split';
import { ActionButton, CountUp, MoreOptions, Note, Surface } from './kit';
import { MoneyInput } from './money-input';
import {
  CATEGORY_LOOK,
  CategoryChips,
  CategoryMark,
  PhotoView,
  Slip,
  TapField,
  Thumb,
} from './receipts-parts';

/*
 * Receipts: take a photo, it's read, you check it, it's saved. The photo is read on this device
 * once (lib/tools/receipt-reader), and only what couldn't be read is asked for. Saved receipts
 * stack by month with their totals, can be found, fixed, removed and exported as a spreadsheet.
 * Everything is kept in this browser (lib/tools/receipts, lib/share/photos).
 */

const noop = () => () => {};

type Draft = {
  expense: Expense;
  /** The photo as it will be kept (made smaller). */
  photo: Blob | null;
  url: string | null;
  extracted: Extracted | null;
  failed: boolean;
};

type Reading = { url: string | null; stage: ReadProgress['stage']; progress: number };

async function asPicture(file: File): Promise<Blob> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return file;
  const { openRenderablePdf } = await import('@/lib/tools/pdf-render');
  const pdf = await openRenderablePdf(file);
  try {
    const size = await pdf.size(0);
    const width = 1500;
    const height = Math.round((size.height / size.width) * width);
    return await pdf.render(0, { width, height, type: 'image/jpeg', quality: 0.9 });
  } finally {
    pdf.close();
  }
}

export function ReceiptsTool() {
  const toast = useToast();
  const today = useSyncExternalStore(noop, todayHere, () => '');
  const [store, setStore, { loaded }] = useLocalState<ReceiptsStore>(
    'hyphy.receipts.v1',
    receiptsStoreSchema,
    EMPTY_RECEIPTS,
  );
  const [reading, setReading] = useState<Reading | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; month: number } | null>(null);
  /** Fuel or travel just filed: the drive itself belongs in Mileage. */
  const [drove, setDrove] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  const [category, setCategory] = useState<ReceiptCategory | null>(null);
  const [query, setQuery] = useState('');
  const stop = useRef<AbortController | null>(null);

  useEffect(() => () => stop.current?.abort(), []);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), 6000);
    return () => clearTimeout(timer);
  }, [saved]);

  const receipts = store.receipts;
  const money = (cents: number) => formatMoney(cents, store.currency);

  /* ---------------- capture ---------------- */

  const capture = async (file: File) => {
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    const id = newId(10);
    setReading({ url: null, stage: 'preparing', progress: 0 });
    let picture: Blob;
    try {
      picture = await asPicture(file);
    } catch {
      setReading(null);
      toast({ title: 'That file couldn’t be opened. Try a photo of the receipt.', icon: 'alert' });
      return;
    }
    const kept = await shrinkPhoto(picture);
    const url = URL.createObjectURL(kept);
    setReading({ url, stage: 'preparing', progress: 0 });
    const base = newExpense(id, Date.now(), today, { photo: true, source: 'read' });
    try {
      const { readReceiptLines } = await import('@/lib/tools/receipt-reader');
      const lines = await readReceiptLines(picture, {
        signal: controller.signal,
        onProgress: (progress) => setReading({ url, ...progress }),
      });
      const extracted = extractExpense(parseReceipt(lines), lines, today);
      setDraft({
        photo: kept,
        url,
        extracted,
        failed: false,
        expense: {
          ...base,
          merchant: extracted.merchant,
          total: extracted.total ?? 0,
          tax: extracted.tax,
          date: extracted.date ?? today,
          payment: extracted.payment,
          category: extracted.category,
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        URL.revokeObjectURL(url);
        return;
      }
      setDraft({ photo: kept, url, extracted: null, failed: true, expense: base });
    } finally {
      setReading(null);
    }
  };

  const typeIt = () =>
    setDraft({
      photo: null,
      url: null,
      extracted: null,
      failed: false,
      expense: newExpense(newId(10), Date.now(), today),
    });

  const discard = () => {
    if (draft?.url) URL.revokeObjectURL(draft.url);
    setDraft(null);
  };

  const keep = async () => {
    if (!draft) return;
    let expense = {
      ...draft.expense,
      merchant: draft.expense.merchant.trim(),
      updated: Date.now(),
    };
    if (draft.photo) {
      const ok = await putPhoto(expense.id, draft.photo);
      if (!ok) {
        expense = { ...expense, photo: false };
        toast({
          title: 'Saved without the photo: this browser won’t keep pictures.',
          icon: 'alert',
        });
      }
    }
    const next = saveExpense(store, expense);
    setStore(next);
    const month = next.receipts
      .filter((receipt) => receipt.date.slice(0, 7) === expense.date.slice(0, 7))
      .reduce((sum, receipt) => sum + receipt.total, 0);
    setSaved({ id: expense.id, month });
    setDrove(expense.category === 'fuel' || expense.category === 'travel');
    setPeriod(inPeriod(expense.date, 'month', today) ? 'month' : 'all');
    setCategory(null);
    setQuery('');
    discard();
  };

  const update = (id: string, change: Partial<Expense>) =>
    setStore((current) => {
      const found = current.receipts.find((receipt) => receipt.id === id);
      return found ? saveExpense(current, { ...found, ...change, updated: Date.now() }) : current;
    });

  const remove = (id: string) => {
    const found = receipts.find((receipt) => receipt.id === id);
    if (!found) return;
    if (!window.confirm(`Delete the ${found.merchant || 'receipt'} receipt? This can’t be undone.`))
      return;
    setStore((current) => removeExpense(current, id));
    void deletePhoto(id);
    setOpen(null);
    toast({ title: 'Receipt deleted' });
  };

  /* ---------------- screens ---------------- */

  if (!loaded || !today)
    return <div aria-busy="true" className="skeleton h-[480px] !rounded-[28px]" />;

  if (reading)
    return (
      <Scanning
        reading={reading}
        onCancel={() => {
          stop.current?.abort();
          if (reading.url) URL.revokeObjectURL(reading.url);
          setReading(null);
        }}
      />
    );

  if (draft)
    return (
      <Confirm
        draft={draft}
        today={today}
        currency={store.currency}
        tags={recentTags(receipts)}
        onChange={(change) =>
          setDraft(
            (current) => current && { ...current, expense: { ...current.expense, ...change } },
          )
        }
        onSave={() => void keep()}
        onRetake={(file) => {
          discard();
          void capture(file);
        }}
        onCancel={discard}
      />
    );

  const shown = filterReceipts(receipts, { period, category, query, today });
  const months = byMonth(shown, today);
  const total = shown.reduce((sum, receipt) => sum + receipt.total, 0);
  const thisMonth = receipts.filter((receipt) => inPeriod(receipt.date, 'month', today));
  const openReceipt = open ? receipts.find((receipt) => receipt.id === open) : undefined;

  if (!receipts.length)
    return (
      <div className="mx-auto grid w-full max-w-[720px] gap-4">
        <CaptureCard onFile={(file) => void capture(file)} onType={typeIt} empty />
      </div>
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(320px,.8fr)_minmax(0,1.3fr)] lg:items-start">
      <div className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        <CaptureCard onFile={(file) => void capture(file)} onType={typeIt} />
        <MonthCard receipts={thisMonth} money={money} today={today} saved={saved} />
        {drove && (
          <NextSteps
            from="receipts"
            title="Filed"
            steps={[{ tool: 'mileage', label: 'Log the drive' }]}
            className="px-1"
          />
        )}
      </div>

      <section aria-labelledby="receipts-list" className="grid min-w-0 gap-4">
        <h2 id="receipts-list" className="sr-only">
          Your receipts
        </h2>
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="When" className="flex flex-wrap gap-1.5">
              {(['month', 'last', 'year', 'all'] as Period[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="radio"
                  aria-checked={period === entry}
                  onClick={() => setPeriod(entry)}
                  className={cn(
                    'min-h-10 rounded-full px-3.5 text-[14px] font-medium transition-colors',
                    period === entry ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {PERIOD_NAMES[entry]}
                </button>
              ))}
            </div>
            <label className="relative ml-auto min-w-[160px] flex-1 sm:max-w-[240px]">
              <span className="sr-only">Search receipts</span>
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
              />
              <input
                type="search"
                value={query}
                placeholder="Search"
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-full bg-surface pr-3 pl-9 text-[15px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
              />
            </label>
          </div>
          <div
            role="radiogroup"
            aria-label="Category"
            className="scroller -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!category}
              onClick={() => setCategory(null)}
              className={cn(
                'min-h-10 shrink-0 rounded-full px-3.5 text-[13.5px] font-medium',
                !category ? 'bg-signal-soft text-[var(--accent-ink)]' : 'bg-well text-ink-2',
              )}
            >
              Every category
            </button>
            {CATEGORIES.filter((entry) =>
              receipts.some((receipt) => receipt.category === entry),
            ).map((entry) => (
              <button
                key={entry}
                type="button"
                role="radio"
                aria-checked={category === entry}
                onClick={() => setCategory(category === entry ? null : entry)}
                className={cn(
                  'inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full pr-3.5 pl-2 text-[13.5px] font-medium',
                  category === entry
                    ? 'bg-signal-soft text-[var(--accent-ink)]'
                    : 'bg-well text-ink-2',
                )}
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: CATEGORY_LOOK[entry].color }}
                />
                {CATEGORY_NAMES[entry]}
              </button>
            ))}
          </div>
        </div>

        {months.length ? (
          months.map((group) => (
            <section key={group.key} aria-label={group.label} className="grid gap-2">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h3 className="font-display text-[15px] font-extrabold tracking-[.1em] text-ink uppercase">
                  {group.label}
                </h3>
                <p className="mono-num text-[15px] font-semibold text-ink">{money(group.total)}</p>
              </div>
              <ul className="grid overflow-hidden rounded-[20px] bg-surface shadow-card">
                {group.receipts.map((receipt) => (
                  <li key={receipt.id} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpen(receipt.id)}
                      className={cn(
                        'flex min-h-[68px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-ink/[.03]',
                        saved?.id === receipt.id && 'fx-settle bg-signal-soft',
                      )}
                    >
                      <Thumb id={receipt.id} has={receipt.photo} category={receipt.category} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-semibold text-ink">
                          {receipt.merchant || 'Receipt'}
                        </span>
                        <span className="flex items-center gap-1.5 truncate text-[13px] text-muted">
                          <span
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: CATEGORY_LOOK[receipt.category].color }}
                          />
                          {CATEGORY_NAMES[receipt.category]} · {shortDate(receipt.date, today)}
                          {receipt.tag && ` · ${receipt.tag}`}
                        </span>
                      </span>
                      <span className="mono-num shrink-0 text-[16px] font-semibold text-ink">
                        {money(receipt.total)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <Surface className="grid justify-items-center gap-2 py-10 text-center">
            <Icon name="search" size={24} className="text-faint" />
            <p className="text-[16px] font-semibold text-ink">Nothing here</p>
            <p className="text-[14px] text-muted">
              {query
                ? `No receipts match “${query}”.`
                : `No receipts for ${PERIOD_NAMES[period].toLowerCase()}.`}
            </p>
            <button
              type="button"
              onClick={() => {
                setPeriod('all');
                setCategory(null);
                setQuery('');
              }}
              className="mt-1 rounded-full bg-well px-4 py-2.5 text-[14px] font-medium text-ink-2"
            >
              Show all receipts
            </button>
          </Surface>
        )}

        {shown.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="text-[14px] text-muted">
              {shown.length} {shown.length === 1 ? 'receipt' : 'receipts'} ·{' '}
              <span className="font-semibold text-ink">{money(total)}</span>
            </p>
            <button
              type="button"
              onClick={() =>
                downloadText(
                  receiptsCsv(shown),
                  `receipts-${period === 'all' ? 'all' : today.slice(0, period === 'year' ? 4 : 7)}.csv`,
                  'text/csv',
                )
              }
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink"
            >
              <Icon name="download" size={15} /> Export CSV
            </button>
          </div>
        )}
      </section>

      <DetailSheet
        receipt={openReceipt}
        today={today}
        currency={store.currency}
        tags={recentTags(receipts)}
        onChange={(change) => openReceipt && update(openReceipt.id, change)}
        onDelete={() => openReceipt && remove(openReceipt.id)}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

/* ---------------- capture ---------------- */

function CaptureCard({
  onFile,
  onType,
  empty = false,
}: {
  onFile: (file: File) => void;
  onType: () => void;
  empty?: boolean;
}) {
  const id = useId();
  const take = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };
  const input = (suffix: string, accept: string, capture?: boolean) => (
    <input
      id={`${id}-${suffix}`}
      type="file"
      accept={accept}
      {...(capture ? { capture: 'environment' as const } : {})}
      className="sr-only"
      onChange={(event) => {
        take(event.target.files);
        event.target.value = '';
      }}
    />
  );
  return (
    <section
      aria-label="Add a receipt"
      className={cn(
        'relative isolate overflow-hidden rounded-[28px] bg-[#1d2420] text-[#f4f1e8] shadow-lift',
        empty ? 'px-6 pt-8 pb-7 sm:px-10 sm:pt-12 sm:pb-10' : 'p-5',
      )}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        take(event.dataTransfer.files);
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            'radial-gradient(60% 70% at 100% 0%, rgb(31 138 91 / .55), transparent 70%), repeating-linear-gradient(0deg, transparent 0 23px, rgb(255 255 255 / .04) 23px 24px)',
        }}
      />
      {empty && (
        <div className="mx-auto mb-6 w-[180px]" aria-hidden="true">
          <Viewfinder />
        </div>
      )}
      <div className={cn(empty && 'text-center')}>
        <h2
          className={cn(
            'font-display font-extrabold tracking-[-0.035em]',
            empty ? 'text-[34px] leading-[1] sm:text-[44px]' : 'text-[22px]',
          )}
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          {empty ? 'No receipts yet.' : 'Add a receipt'}
        </h2>
        {empty && (
          <p className="mx-auto mt-2 max-w-[34ch] text-[15.5px] text-[#f4f1e8]/75">
            Take a photo. It’s read right here, you check it, and it’s filed.
          </p>
        )}
      </div>
      <div className={cn('mt-5 grid gap-2', empty && 'mx-auto max-w-[420px]')}>
        <label
          htmlFor={`${id}-camera`}
          className="inline-flex h-15 cursor-pointer items-center justify-center gap-2.5 rounded-[18px] bg-[var(--accent)] px-5 text-[17px] font-semibold text-[var(--on-accent)] shadow-[0_16px_30px_-16px_var(--accent)] transition-transform active:scale-[.98]"
        >
          <Icon name="camera" size={21} /> {empty ? 'Take your first photo' : 'Take photo'}
        </label>
        {input('camera', 'image/*', true)}
        <div className="grid grid-cols-2 gap-2">
          <label
            htmlFor={`${id}-photo`}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-white/10 text-[15px] font-semibold hover:bg-white/15"
          >
            <Icon name="image" size={17} /> Choose photo
          </label>
          {input('photo', 'image/*')}
          <label
            htmlFor={`${id}-file`}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[16px] bg-white/10 text-[15px] font-semibold hover:bg-white/15"
          >
            <Icon name="upload" size={17} /> Upload file
          </label>
          {input('file', 'image/*,application/pdf')}
        </div>
        <button
          type="button"
          onClick={onType}
          className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-[#f4f1e8]/75 hover:bg-white/10 hover:text-[#f4f1e8]"
        >
          <Icon name="pencil" size={14} /> No photo? Type it in
        </button>
      </div>
      {empty && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12.5px] text-[#f4f1e8]/55">
          <Icon name="lock" size={12} /> Read on your device. Photos stay in this browser.
        </p>
      )}
    </section>
  );
}

/** A receipt in a camera's corners. */
function Viewfinder() {
  return (
    <svg viewBox="0 0 180 150" className="h-auto w-full">
      <g fill="none" stroke="#1f8a5b" strokeWidth="4" strokeLinecap="round">
        <path d="M8 34V14a6 6 0 0 1 6-6h20M146 8h20a6 6 0 0 1 6 6v20M172 116v20a6 6 0 0 1-6 6h-20M34 142H14a6 6 0 0 1-6-6v-20" />
      </g>
      <path
        d="M54 22h72v104l-6 5-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5-6-5Z"
        fill="#fbf8ef"
        transform="rotate(-4 90 75)"
      />
      <g transform="rotate(-4 90 75)" fill="#1d2420">
        <rect x="68" y="36" width="44" height="5" rx="2.5" opacity=".7" />
        {[52, 62, 72, 82].map((y) => (
          <g key={y} opacity=".3">
            <rect x="64" y={y} width="30" height="4" rx="2" />
            <rect x="102" y={y} width="14" height="4" rx="2" />
          </g>
        ))}
        <rect x="64" y="100" width="22" height="6" rx="3" />
        <rect x="96" y="100" width="20" height="6" rx="3" />
      </g>
      <rect x="20" y="72" width="140" height="3" rx="1.5" fill="#34d399" opacity=".9" />
    </svg>
  );
}

function Scanning({ reading, onCancel }: { reading: Reading; onCancel: () => void }) {
  const label =
    reading.stage === 'loading'
      ? 'Getting the reader ready…'
      : reading.stage === 'reading'
        ? 'Reading the receipt…'
        : 'Looking at the photo…';
  const value =
    reading.stage === 'reading'
      ? 0.35 + reading.progress * 0.65
      : reading.stage === 'loading'
        ? reading.progress * 0.35
        : 0.04;
  return (
    <div className="mx-auto grid w-full max-w-[560px] gap-4">
      <div className="relative isolate overflow-hidden rounded-[28px] bg-[#1d2420] p-5 sm:p-7">
        <div className="relative mx-auto max-w-[340px] overflow-hidden rounded-[14px] bg-[#fbf8ef]">
          {reading.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={reading.url}
              alt="Your receipt"
              className="block max-h-[56vh] w-full object-contain"
            />
          ) : (
            <div className="h-72" />
          )}
          <div aria-hidden="true" className="receipt-scan absolute inset-x-0 h-16" />
        </div>
      </div>
      <div className="grid gap-2 px-1" role="status" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[17px] font-semibold text-ink">{label}</p>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center rounded-full px-3 text-[14px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
          >
            Cancel
          </button>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink/[.08]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${Math.round(value * 100)}%` }}
          />
        </div>
        {reading.stage === 'loading' && (
          <p className="text-[13px] text-muted">
            The first scan downloads the reader (about 4 MB). After that it’s instant, and offline.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------- confirm ---------------- */

function Confirm({
  draft,
  today,
  currency,
  tags,
  onChange,
  onSave,
  onRetake,
  onCancel,
}: {
  draft: Draft;
  today: string;
  currency: string;
  tags: string[];
  onChange: (change: Partial<Expense>) => void;
  onSave: () => void;
  onRetake: (file: File) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const { expense, extracted } = draft;
  const typed = !draft.url;
  const missing = new Set(
    extracted?.missing ?? (draft.failed || typed ? ['merchant', 'total'] : []),
  );
  const [editing, setEditing] = useState<Set<string>>(() => new Set(missing));
  const edit = (field: string) => setEditing((current) => new Set(current).add(field));
  const ready = expense.total > 0 && expense.merchant.trim().length > 0;
  const found = extracted && extracted.missing.length < 3;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-start">
      {draft.url && (
        <div className="relative isolate overflow-hidden rounded-[28px] bg-[#1d2420] p-4 sm:p-6 lg:sticky lg:top-24">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={draft.url}
            alt="Your receipt"
            className="mx-auto block max-h-[26vh] rounded-[12px] bg-white object-contain lg:max-h-[70vh]"
          />
          <label
            htmlFor={`${id}-retake`}
            className="mx-auto mt-3 flex min-h-11 w-max cursor-pointer items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-[#f4f1e8]/75 hover:bg-white/10"
          >
            <Icon name="camera" size={15} /> Retake
          </label>
          <input
            id={`${id}-retake`}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onRetake(file);
              event.target.value = '';
            }}
          />
        </div>
      )}

      <div className="grid min-w-0 gap-4">
        {draft.failed && (
          <Note icon="alert" tone="caution">
            Couldn’t read this one. Type the total and where it’s from; the photo is kept.
          </Note>
        )}
        {found && (
          <p className="fx-pop inline-flex items-center gap-1.5 justify-self-start rounded-full bg-signal-soft px-3.5 py-1.5 text-[13.5px] font-semibold text-[var(--accent-ink)]">
            <Icon name="sparkles" size={14} /> Read from your photo. Tap anything to fix it.
          </p>
        )}
        <Slip>
          <div className="grid gap-4">
            <TapField
              label="Total"
              big
              display={expense.total ? formatMoney(expense.total, currency) : ''}
              empty="Add the total"
              editing={editing.has('total')}
              onEdit={() => edit('total')}
            >
              <MoneyInput
                value={expense.total}
                currency={currency}
                label="Total"
                autoFocus={!typed || missing.has('total')}
                onChange={(cents) => onChange({ total: cents })}
                inputClassName="!h-16 !text-[30px] !font-bold"
              />
            </TapField>
            <TapField
              label="Where"
              display={expense.merchant}
              empty="Add where it’s from"
              editing={editing.has('merchant')}
              onEdit={() => edit('merchant')}
            >
              <input
                aria-label="Where it’s from"
                value={expense.merchant}
                maxLength={80}
                placeholder="Home Depot"
                autoFocus={missing.has('merchant') && !missing.has('total')}
                onChange={(event) => onChange({ merchant: event.target.value })}
                className="h-12 rounded-[12px] bg-subtle px-3.5 text-[17px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
              />
            </TapField>
            <TapField
              label="Date"
              display={
                expense.date === today
                  ? `Today · ${shortDate(expense.date, today)}`
                  : shortDate(expense.date, today)
              }
              empty="Add the date"
              editing={editing.has('date')}
              onEdit={() => edit('date')}
            >
              <input
                type="date"
                aria-label="Date"
                value={expense.date}
                max={today}
                onChange={(event) => event.target.value && onChange({ date: event.target.value })}
                className="h-12 max-w-[220px] rounded-[12px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
              />
            </TapField>
            <div className="grid gap-2">
              <p className="text-[11.5px] font-bold tracking-[.12em] text-muted uppercase">
                Category
              </p>
              <CategoryChips
                value={expense.category}
                suggested={extracted?.category}
                onChange={(category) => onChange({ category })}
              />
            </div>
            <ExtraFields expense={expense} currency={currency} tags={tags} onChange={onChange} />
          </div>
        </Slip>
        <div className="sticky bottom-0 z-20 grid gap-2 bg-gradient-to-t from-canvas via-canvas/95 to-transparent pt-4 pb-[max(12px,env(safe-area-inset-bottom))] sm:static sm:bg-none sm:p-0">
          <ActionButton icon="check" disabled={!ready} onClick={onSave}>
            {ready
              ? 'Looks right'
              : !expense.total
                ? 'Add the total to save'
                : 'Add where it’s from'}
          </ActionButton>
          <button
            type="button"
            onClick={onCancel}
            className="mx-auto inline-flex min-h-11 items-center rounded-full px-4 text-[14px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
          >
            Don’t save
          </button>
        </div>
      </div>
    </div>
  );
}

/** Tax, how it was paid, a project or client, a note: filled when read, otherwise optional. */
function ExtraFields({
  expense,
  currency,
  tags,
  onChange,
}: {
  expense: Expense;
  currency: string;
  tags: string[];
  onChange: (change: Partial<Expense>) => void;
}) {
  const id = useId();
  const summary = [
    expense.tax !== null && `Tax ${formatMoney(expense.tax, currency)}`,
    expense.payment,
    expense.tag,
    expense.note && 'note',
  ]
    .filter(Boolean)
    .join(' · ');
  const field =
    'h-12 w-full rounded-[12px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]';
  return (
    <MoreOptions
      label="Tax, card, project, note"
      summary={summary || 'Optional'}
      className="border-t border-dashed border-line-strong pt-2"
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-[13.5px] font-medium text-ink-2">
            Tax
            <MoneyInput
              value={expense.tax ?? 0}
              currency={currency}
              label="Tax"
              onChange={(cents) => onChange({ tax: cents || null })}
            />
          </label>
          <label
            className="grid gap-1.5 text-[13.5px] font-medium text-ink-2"
            htmlFor={`${id}-paid`}
          >
            Paid with
            <input
              id={`${id}-paid`}
              value={expense.payment}
              maxLength={40}
              placeholder="Visa ••1234"
              onChange={(event) => onChange({ payment: event.target.value })}
              className={field}
            />
          </label>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-tag`} className="text-[13.5px] font-medium text-ink-2">
            Project or client
          </label>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={expense.tag === tag}
                  onClick={() => onChange({ tag: expense.tag === tag ? '' : tag })}
                  className={cn(
                    'min-h-10 rounded-full px-3.5 text-[14px] font-medium',
                    expense.tag === tag ? 'bg-ink text-on-ink' : 'bg-well text-ink-2',
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          <input
            id={`${id}-tag`}
            value={expense.tag}
            maxLength={60}
            placeholder="Oak Brook remodel"
            onChange={(event) => onChange({ tag: event.target.value })}
            className={field}
          />
        </div>
        <label className="grid gap-1.5 text-[13.5px] font-medium text-ink-2" htmlFor={`${id}-note`}>
          Note
          <textarea
            id={`${id}-note`}
            value={expense.note}
            maxLength={400}
            rows={2}
            onChange={(event) => onChange({ note: event.target.value })}
            className="rounded-[12px] bg-subtle p-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none"
          />
        </label>
      </div>
    </MoreOptions>
  );
}

/* ---------------- the month ---------------- */

function MonthCard({
  receipts,
  money,
  today,
  saved,
}: {
  receipts: Expense[];
  money: (cents: number) => string;
  today: string;
  saved: { id: string; month: number } | null;
}) {
  const total = receipts.reduce((sum, receipt) => sum + receipt.total, 0);
  const parts = byCategory(receipts);
  const month = byMonth([{ date: today } as Expense], today)[0]?.label ?? 'This month';
  return (
    <Surface className="grid gap-3">
      {saved && (
        <p
          key={saved.id}
          role="status"
          className="fx-stamp inline-flex items-center gap-1.5 justify-self-start rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-[13.5px] font-bold text-[var(--on-accent)]"
        >
          <Icon name="check" size={14} strokeWidth={3} /> Filed
        </p>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-[15px] font-extrabold tracking-[.1em] text-ink uppercase">
          {month}
        </p>
        <p className="text-[13.5px] text-muted">
          {receipts.length} {receipts.length === 1 ? 'receipt' : 'receipts'}
        </p>
      </div>
      <p
        className="font-display text-[44px] leading-none font-extrabold tracking-[-0.04em] text-ink"
        style={{ fontVariationSettings: "'wdth' 110" }}
      >
        <CountUp value={total} format={money} mono={false} />
      </p>
      {total > 0 && (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-ink/[.06]" aria-hidden="true">
            {parts.map((part) => (
              <span
                key={part.category}
                className="h-full"
                style={{
                  width: `${(part.total / total) * 100}%`,
                  background: CATEGORY_LOOK[part.category].color,
                }}
              />
            ))}
          </div>
          <ul className="grid gap-1.5">
            {parts.slice(0, 4).map((part) => (
              <li key={part.category} className="flex items-center gap-2 text-[14px]">
                <CategoryMark category={part.category} size={24} />
                <span className="flex-1 text-ink-2">{CATEGORY_NAMES[part.category]}</span>
                <span className="mono-num font-medium text-ink">{money(part.total)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Surface>
  );
}

/* ---------------- one receipt ---------------- */

function DetailSheet({
  receipt,
  today,
  currency,
  tags,
  onChange,
  onDelete,
  onClose,
}: {
  receipt: Expense | undefined;
  today: string;
  currency: string;
  tags: string[];
  onChange: (change: Partial<Expense>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const edit = (field: string) => setEditing((current) => new Set(current).add(field));
  const close = () => {
    setEditing(new Set());
    onClose();
  };
  const savePhoto = async () => {
    if (!receipt) return;
    const blob = await getPhoto(receipt.id);
    if (blob) download(blob, `${slugName(receipt.merchant || 'receipt')}-${receipt.date}.jpg`);
  };
  return (
    <Sheet
      open={Boolean(receipt)}
      onClose={close}
      width="md"
      title={receipt?.merchant || 'Receipt'}
    >
      {receipt && (
        <div className="grid gap-5">
          <PhotoView id={receipt.id} has={receipt.photo} alt={`Receipt from ${receipt.merchant}`} />
          <div className="grid gap-4">
            <TapField
              label="Total"
              big
              display={formatMoney(receipt.total, currency)}
              empty="Add the total"
              editing={editing.has('total')}
              onEdit={() => edit('total')}
            >
              <MoneyInput
                value={receipt.total}
                currency={currency}
                label="Total"
                onChange={(cents) => cents > 0 && onChange({ total: cents })}
                inputClassName="!h-14 !text-[26px] !font-bold"
              />
            </TapField>
            <TapField
              label="Where"
              display={receipt.merchant}
              empty="Add where it’s from"
              editing={editing.has('merchant')}
              onEdit={() => edit('merchant')}
            >
              <input
                aria-label="Where it’s from"
                defaultValue={receipt.merchant}
                maxLength={80}
                onBlur={(event) =>
                  event.target.value.trim() && onChange({ merchant: event.target.value.trim() })
                }
                className="h-12 rounded-[12px] bg-subtle px-3.5 text-[17px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none"
              />
            </TapField>
            <TapField
              label="Date"
              display={shortDate(receipt.date, today)}
              empty="Add the date"
              editing={editing.has('date')}
              onEdit={() => edit('date')}
            >
              <input
                id={`${id}-date`}
                type="date"
                aria-label="Date"
                value={receipt.date}
                max={today}
                onChange={(event) => event.target.value && onChange({ date: event.target.value })}
                className="h-12 max-w-[220px] rounded-[12px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
              />
            </TapField>
            <div className="grid gap-2">
              <p className="text-[11.5px] font-bold tracking-[.12em] text-muted uppercase">
                Category
              </p>
              <CategoryChips
                value={receipt.category}
                onChange={(category) => onChange({ category })}
              />
            </div>
            <ExtraFields expense={receipt} currency={currency} tags={tags} onChange={onChange} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
            {receipt.photo ? (
              <button
                type="button"
                onClick={() => void savePhoto()}
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
              >
                <Icon name="download" size={15} /> Download photo
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium text-muted hover:bg-critical-soft hover:text-critical"
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
