'use client';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { checkReceipt, type ParsedReceipt } from '@/lib/tools/receipt';
import { receiptReader, type ReadProgress } from '@/lib/tools/receipt-reader';
import { decodeState, clearHash, linkFor, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  computeSplit,
  CURRENCIES,
  formatMoney,
  localCurrency,
  newBill,
  splitBillSchema,
  splitSummary,
  type SplitBill,
} from '@/lib/tools/split';
import { IconButton, Note, useCopy } from './kit';
import { MoneyInput } from './money-input';
import { ShareLinkCard } from './share-link';

/*
 * Split, receipt first: photograph the check, fix anything the reader got wrong, say who's at the
 * table, tap who had what, pick a tip, done — everyone's total, exact to the cent. Typing the
 * items in, or just dividing a total evenly, are always one tap away.
 *
 * Each step has its own address (`?step=people`), so the phone's back gesture steps back through
 * the check instead of leaving it. The bill is kept in this browser; sharing puts a read-only
 * copy inside a link.
 */

const COLORS = [
  '#b8f35a',
  '#8f9bff',
  '#ff8ad8',
  '#ffc53d',
  '#7ce0c3',
  '#ff9e7a',
  '#c7b5ff',
  '#7fd4ff',
];
const TIPS = [15, 18, 20, 22];
const ACCENT = '#b8f35a';

type Step = 'start' | 'receipt' | 'people' | 'items' | 'tip' | 'done' | 'even';
const FLOW: { step: Step; label: string }[] = [
  { step: 'receipt', label: 'Receipt' },
  { step: 'people', label: 'People' },
  { step: 'items', label: 'Who had what' },
  { step: 'tip', label: 'Tax & tip' },
  { step: 'done', label: 'Split' },
];
const STEPS: Step[] = ['receipt', 'people', 'items', 'tip', 'done', 'even'];

/* ---------------- the step, in the address ---------------- */

const STEP_EVENT = 'hyphy:split-step';
let pushed = 0;

function subscribeStep(notify: () => void) {
  const onPop = () => {
    pushed = Math.max(0, pushed - 1);
    notify();
  };
  window.addEventListener('popstate', onPop);
  window.addEventListener(STEP_EVENT, notify);
  return () => {
    window.removeEventListener('popstate', onPop);
    window.removeEventListener(STEP_EVENT, notify);
  };
}
const readStep = (): Step => {
  const value = new URLSearchParams(window.location.search).get('step') as Step | null;
  return value && STEPS.includes(value) ? value : 'start';
};

function useStep() {
  const step = useSyncExternalStore(subscribeStep, readStep, () => 'start' as Step);
  const go = (next: Step, { replace = false } = {}) => {
    const { pathname } = window.location;
    const url = next === 'start' ? pathname : `${pathname}?step=${next}`;
    if (replace) window.history.replaceState(null, '', url);
    else {
      window.history.pushState(null, '', url);
      pushed += 1;
    }
    window.dispatchEvent(new Event(STEP_EVENT));
    window.scrollTo({ top: Math.min(window.scrollY, toolTop()), behavior: 'instant' });
  };
  /** Back one step: the browser's own back when we got here by stepping forward. */
  const back = (previous: Step) => {
    if (pushed > 0) window.history.back();
    else go(previous, { replace: true });
  };
  return { step, go, back };
}

/** Where the tool starts on the page, so a new step opens at its top. */
function toolTop() {
  const tool = document.getElementById('tool');
  return tool ? tool.getBoundingClientRect().top + window.scrollY - 72 : 0;
}

/* ---------------- small parts ---------------- */

const nameOf = (bill: SplitBill, index: number) =>
  bill.people[index]?.name.trim() || (index === 0 ? 'You' : `Person ${index + 1}`);

function Dot({ index, className }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: COLORS[index % COLORS.length] }}
    />
  );
}

function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-5">
      <h2
        className="font-display text-[28px] leading-[1.02] font-bold tracking-[-0.03em] text-ink sm:text-[34px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {children}
      </h2>
      {lead && <p className="mt-2 text-[15px] leading-snug text-muted">{lead}</p>}
    </div>
  );
}

/** The one thing to do next, pinned to the bottom of the screen while you work. */
function NextBar({
  children,
  onClick,
  disabled,
  hint,
  aside,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 bg-gradient-to-t from-surface via-surface/95 to-transparent px-4 pt-6 pb-[max(12px,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
      {aside}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] text-[16.5px] font-semibold text-[#12110d] shadow-[0_12px_30px_-12px_rgb(184_243_90/.55)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none"
        style={{ background: ACCENT }}
      >
        {children}
      </button>
      {hint && <p className="mt-2 text-center text-[12.5px] text-muted">{hint}</p>}
    </div>
  );
}

function StepBar({
  step,
  onPick,
  onBack,
  reachable,
}: {
  step: Step;
  onPick: (step: Step) => void;
  onBack: () => void;
  reachable: (step: Step) => boolean;
}) {
  const index = FLOW.findIndex((entry) => entry.step === step);
  return (
    <nav aria-label="Steps" className="mb-6 flex items-center gap-3">
      <IconButton
        icon="arrow-left"
        label="Back"
        onClick={onBack}
        className="!rounded-full bg-well"
      />
      <ol className="flex min-w-0 flex-1 gap-1.5">
        {FLOW.map((entry, position) => (
          <li key={entry.step} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!reachable(entry.step)}
              aria-current={entry.step === step ? 'step' : undefined}
              aria-label={`Go to ${entry.label.toLowerCase()}`}
              onClick={() => onPick(entry.step)}
              className="group block w-full py-2"
            >
              <span
                className={cn(
                  'block h-1.5 rounded-full transition-colors',
                  position <= index ? '' : 'bg-white/[.1] group-enabled:group-hover:bg-white/20',
                )}
                style={position <= index ? { background: ACCENT } : undefined}
              />
            </button>
          </li>
        ))}
      </ol>
      <span className="shrink-0 text-[13px] text-muted">
        <span className="font-semibold text-ink-2">{FLOW[index]?.label}</span>{' '}
        <span className="mono-num">
          {index + 1}/{FLOW.length}
        </span>
      </span>
    </nav>
  );
}

function TextLink({
  children,
  onClick,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: IconName;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-ink-2 transition-colors hover:bg-white/[.06] hover:text-ink"
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}

/* ---------------- the tool ---------------- */

type Reading = {
  photo: string;
  progress: ReadProgress;
  error?: string;
};

export function SplitTool() {
  const id = useId();
  const [bill, setBill, { loaded, reset }] = useLocalState<SplitBill>(
    'hyphy.split.v1',
    splitBillSchema,
    newBill(),
  );
  const { step, go, back } = useStep();
  const [shared, setShared] = useState<SplitBill | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [unsure, setUnsure] = useState<Set<string>>(() => new Set());
  const stop = useRef<AbortController | null>(null);
  const reader = receiptReader();

  // A shared bill arrives in the link: show it, read-only, until someone makes a copy.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length < 3) return;
    void decodeState(hash, splitBillSchema).then((value) => value && setShared(value));
  }, []);

  // A fresh bill pays in the money people use here.
  useEffect(() => {
    if (!loaded) return;
    setBill((current) =>
      current.items.length || current.total
        ? current
        : { ...current, currency: localCurrency(navigator.language) },
    );
  }, [loaded, setBill]);

  // The photo lives only in memory, and only while it's shown.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const view = shared ?? bill;
  const result = useMemo(() => computeSplit(view), [view]);
  const money = (amount: number) => formatMoney(amount, view.currency);
  const update = (patch: Partial<SplitBill>) => setBill((current) => ({ ...current, ...patch }));
  const hasItems = bill.items.some((item) => item.price > 0);

  /* ----- reading a receipt ----- */

  const read = async (file: File) => {
    stop.current?.abort();
    const controller = new AbortController();
    stop.current = controller;
    const url = URL.createObjectURL(file);
    setPhoto(url);
    setReading({ photo: url, progress: { stage: 'preparing', progress: 0 } });
    try {
      const receipt = await reader.read(file, {
        signal: controller.signal,
        onProgress: (progress) =>
          setReading((current) => (current && !current.error ? { ...current, progress } : current)),
      });
      if (controller.signal.aborted) return;
      apply(receipt);
      setReading(null);
      go('receipt');
    } catch (error) {
      if (controller.signal.aborted || (error as DOMException)?.name === 'AbortError') return;
      setReading((current) =>
        current
          ? {
              ...current,
              error:
                'We couldn’t read that photo. Try again with the whole receipt flat and in focus, or type it in.',
            }
          : current,
      );
    }
  };

  const apply = (receipt: ParsedReceipt) => {
    const items = receipt.items.map((item) => ({
      id: `i${newId(6)}`,
      name: item.name,
      price: item.price,
      people: [] as string[],
      ...(item.qty > 1 ? { qty: item.qty } : {}),
    }));
    setUnsure(
      new Set(items.filter((_, index) => receipt.items[index].unsure).map((item) => item.id)),
    );
    setBill((current) => ({
      ...current,
      mode: 'items',
      title: receipt.merchant || '',
      items,
      tax: { mode: 'amount', value: receipt.tax ?? 0 },
      tip:
        receipt.tip !== null
          ? { mode: 'amount', value: receipt.tip, afterTax: false }
          : {
              ...current.tip,
              mode: 'percent',
              value: current.tip.mode === 'percent' && current.tip.value ? current.tip.value : 18,
            },
      receipt: { subtotal: receipt.subtotal, total: receipt.total },
    }));
  };

  const cancelReading = () => {
    stop.current?.abort();
    setReading(null);
  };

  const startManual = () => {
    setPhoto(null);
    setUnsure(new Set());
    setBill((current) => ({
      ...current,
      mode: 'items',
      items: hasItems ? current.items : [],
      receipt: hasItems ? current.receipt : undefined,
    }));
    go('receipt');
  };

  const startEven = () => {
    setBill((current) => ({
      ...current,
      mode: 'even',
      people:
        current.people.length > 1
          ? current.people
          : [...current.people, { id: `p${newId(6)}`, name: '' }],
      tip: current.mode === 'even' ? current.tip : { mode: 'percent', value: 0, afterTax: false },
      tax: current.mode === 'even' ? current.tax : { mode: 'amount', value: 0 },
    }));
    go('even');
  };

  const startOver = () => {
    const people = bill.people;
    reset({ ...newBill(bill.currency), people });
    setPhoto(null);
    setUnsure(new Set());
    go('start', { replace: true });
  };

  /* ----- the shared, read-only view ----- */

  if (shared) {
    return (
      <Frame>
        <Note icon="link" className="mb-5 !items-center">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>A bill someone shared with you. Find your name to see what you owe.</span>
            <button
              type="button"
              onClick={() => {
                setBill({ ...shared });
                setShared(null);
                clearHash();
                go('done', { replace: true });
              }}
              className="font-semibold text-ink underline underline-offset-2"
            >
              Edit a copy
            </button>
          </span>
        </Note>
        <Result bill={shared} result={result} money={money} />
      </Frame>
    );
  }

  /* ----- steps ----- */

  const reachable = (target: Step) =>
    target === 'receipt' || (hasItems && (target === 'people' || bill.people.length > 1));
  const previous = (current: Step): Step => {
    const index = FLOW.findIndex((entry) => entry.step === current);
    return index > 0 ? FLOW[index - 1].step : 'start';
  };
  const bar = (current: Step) => (
    <StepBar
      step={current}
      reachable={reachable}
      onPick={(target) => target !== current && go(target)}
      onBack={() => back(previous(current))}
    />
  );

  // Steps that need a bill fall back to the start until there is one (a reload, a cleared bill).
  const shown: Step =
    !loaded || step === 'start' || step === 'even'
      ? step
      : step === 'receipt' || hasItems
        ? step
        : 'start';

  if (reading)
    return (
      <Frame>
        <ReadingView
          reading={reading}
          onCancel={cancelReading}
          onRetry={(file) => void read(file)}
          onManual={() => {
            cancelReading();
            startManual();
          }}
        />
      </Frame>
    );

  if (shown === 'start')
    return (
      <Frame>
        <Start
          onPhoto={(file) => void read(file)}
          onManual={startManual}
          onEven={startEven}
          privacy={reader.privacy}
          saved={
            loaded && (hasItems || (bill.mode === 'even' && bill.total > 0))
              ? {
                  label:
                    bill.title.trim() || (bill.mode === 'even' ? 'Split evenly' : 'Your last bill'),
                  detail:
                    bill.mode === 'even'
                      ? `${money(result.total)} between ${bill.people.length}`
                      : `${bill.items.length} ${bill.items.length === 1 ? 'item' : 'items'} · ${money(result.total)}`,
                  onContinue: () => go(bill.mode === 'even' ? 'even' : 'done'),
                  onDiscard: startOver,
                }
              : null
          }
        />
      </Frame>
    );

  if (shown === 'even')
    return (
      <Frame>
        <EvenView
          bill={bill}
          result={result}
          money={money}
          update={update}
          onBack={() => back('start')}
          onItems={startManual}
        />
      </Frame>
    );

  if (shown === 'receipt')
    return (
      <Frame>
        {bar('receipt')}
        <ReviewView
          id={id}
          bill={bill}
          update={update}
          money={money}
          photo={photo}
          unsure={unsure}
          onSeen={(itemId) =>
            setUnsure((current) => {
              if (!current.has(itemId)) return current;
              const next = new Set(current);
              next.delete(itemId);
              return next;
            })
          }
          onRetake={(file) => void read(file)}
        />
        <NextBar
          onClick={() => go('people')}
          disabled={!hasItems}
          hint={!hasItems ? 'Add at least one item with a price.' : undefined}
        >
          Who’s splitting? <Icon name="arrow-right" size={18} />
        </NextBar>
      </Frame>
    );

  if (shown === 'people')
    return (
      <Frame>
        {bar('people')}
        <PeopleView bill={bill} update={update} />
        <NextBar
          onClick={() => go('items')}
          disabled={bill.people.length < 2}
          hint={bill.people.length < 2 ? 'Add the people you’re splitting with.' : undefined}
        >
          Who had what? <Icon name="arrow-right" size={18} />
        </NextBar>
      </Frame>
    );

  if (shown === 'items')
    return (
      <Frame>
        {bar('items')}
        <AssignView bill={bill} update={update} money={money} />
        <NextBar
          onClick={() => go('tip')}
          aside={<RunningTotals bill={bill} result={result} money={money} />}
        >
          Tax and tip <Icon name="arrow-right" size={18} />
        </NextBar>
      </Frame>
    );

  if (shown === 'tip')
    return (
      <Frame>
        {bar('tip')}
        <TipView id={id} bill={bill} result={result} money={money} update={update} />
        <NextBar onClick={() => go('done')}>
          See the split <Icon name="arrow-right" size={18} />
        </NextBar>
      </Frame>
    );

  return (
    <Frame>
      {bar('done')}
      <Result bill={bill} result={result} money={money} />
      <ShareArea bill={bill} result={result} />
      <div className="mt-6 flex flex-wrap justify-center gap-1 border-t border-line pt-5">
        <TextLink icon="pencil" onClick={() => go('receipt')}>
          Edit items
        </TextLink>
        <TextLink icon="plus" onClick={startOver}>
          New bill
        </TextLink>
      </div>
    </Frame>
  );
}

/** The working area: one calm column, even on a wide screen. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[640px] rounded-[24px] bg-surface px-4 pt-5 pb-4 shadow-card sm:px-6 sm:pt-7">
      {children}
    </div>
  );
}

/* ---------------- 1. start: the receipt ---------------- */

function PhotoButton({
  label,
  icon,
  capture,
  primary,
  onFile,
  className,
}: {
  label: string;
  icon: IconName;
  capture?: boolean;
  primary?: boolean;
  onFile: (file: File) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        'relative flex h-14 cursor-pointer items-center justify-center gap-2.5 rounded-[16px] text-[16.5px] font-semibold transition-transform focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-signal)] active:scale-[.985]',
        primary
          ? 'text-[#12110d] shadow-[0_14px_34px_-14px_rgb(184_243_90/.6)]'
          : 'bg-well text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[.08]',
        className,
      )}
      style={primary ? { background: ACCENT } : undefined}
    >
      <Icon name={icon} size={20} />
      {label}
      <input
        type="file"
        accept="image/*"
        aria-label={label}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function Start({
  onPhoto,
  onManual,
  onEven,
  privacy,
  saved,
}: {
  onPhoto: (file: File) => void;
  onManual: () => void;
  onEven: () => void;
  privacy: string;
  saved: { label: string; detail: string; onContinue: () => void; onDiscard: () => void } | null;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = Array.from(event.dataTransfer.files).find((entry) =>
      entry.type.startsWith('image/'),
    );
    if (file) onPhoto(file);
  };
  return (
    <div
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes('Files')) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn('rounded-[18px] transition-shadow', over && 'shadow-[0_0_0_2px_#b8f35a]')}
    >
      {saved && (
        <div className="mb-5 flex items-center gap-3 rounded-[16px] bg-subtle p-3 pl-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">{saved.label}</p>
            <p className="truncate text-[13px] text-muted">{saved.detail}</p>
          </div>
          <button
            type="button"
            onClick={saved.onContinue}
            className="h-10 shrink-0 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink"
          >
            Continue
          </button>
          <IconButton icon="x" label="Discard the last bill" onClick={saved.onDiscard} size="sm" />
        </div>
      )}

      <ReceiptPicture />
      <h2
        className="mt-5 text-center font-display text-[30px] leading-[1.02] font-bold tracking-[-0.03em] text-ink sm:text-[36px]"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        Snap the receipt
      </h2>
      <p className="mx-auto mt-2 max-w-[32ch] text-center text-[15.5px] leading-snug text-muted">
        We’ll read the items. You tap who had what. Everyone gets their exact total.
      </p>

      <div className="mt-6 grid gap-2.5">
        {/* Phones: straight to the camera. Computers: a file (or drop it here). */}
        <PhotoButton
          label="Take a photo"
          icon="camera"
          capture
          primary
          onFile={onPhoto}
          className="[@media(pointer:fine)]:hidden"
        />
        <PhotoButton
          label="Upload a photo"
          icon="upload"
          onFile={onPhoto}
          className="[@media(pointer:fine)]:bg-[#b8f35a] [@media(pointer:fine)]:text-[#12110d] [@media(pointer:fine)]:shadow-none"
        />
      </div>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[12.5px] text-muted">
        <Icon name="lock" size={12} /> {privacy}
      </p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-1 border-t border-line pt-4">
        <TextLink icon="pencil" onClick={onManual}>
          Type it in instead
        </TextLink>
        <TextLink icon="people" onClick={onEven}>
          Split evenly instead
        </TextLink>
      </div>
    </div>
  );
}

/** A receipt, drawn: the tool's promise before there's a photo. */
function ReceiptPicture() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[132px] w-[220px]">
      <div
        className="absolute inset-x-6 top-0 bottom-0 rotate-[-4deg] rounded-t-[6px] bg-[#efebe2] p-3 shadow-[0_20px_40px_-18px_rgb(0_0_0/.8)]"
        style={{
          maskImage:
            'linear-gradient(black, black), radial-gradient(circle at 6px 100%, transparent 5px, black 5.5px)',
        }}
      >
        {[62, 44, 70, 52].map((width, index) => (
          <div key={index} className="mb-2.5 flex items-center justify-between gap-2">
            <span className="h-1.5 rounded-full bg-[#12110d]/20" style={{ width: `${width}%` }} />
            <span className="h-1.5 w-7 rounded-full bg-[#12110d]/35" />
          </div>
        ))}
        <div className="mt-3 flex justify-between border-t border-dashed border-[#12110d]/25 pt-2">
          <span className="h-2 w-10 rounded-full bg-[#12110d]/45" />
          <span className="h-2 w-9 rounded-full bg-[#12110d]/60" />
        </div>
      </div>
      <div className="absolute top-3 right-0 grid gap-1.5">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="flex h-6 items-center gap-1.5 rounded-full bg-[#1f1f1c] pr-2.5 pl-1.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]"
          >
            <Dot index={index} className="!size-3" />
            <span className="h-1.5 w-8 rounded-full bg-white/25" />
          </span>
        ))}
      </div>
    </div>
  );
}

function ReadingView({
  reading,
  onCancel,
  onRetry,
  onManual,
}: {
  reading: Reading;
  onCancel: () => void;
  onRetry: (file: File) => void;
  onManual: () => void;
}) {
  const { stage, progress } = reading.progress;
  const percent = Math.round(progress * 100);
  const status =
    stage === 'preparing'
      ? 'Getting the photo ready…'
      : stage === 'loading'
        ? 'Getting the reader ready… (first time only)'
        : `Reading the receipt… ${percent}%`;
  return (
    <div className="grid gap-5">
      <div className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-[18px] bg-black shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, never optimized */}
        <img
          src={reading.photo}
          alt="Your receipt"
          className="max-h-[52vh] w-full object-contain"
        />
        {!reading.error && (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 h-16 animate-[scan_1.8s_ease-in-out_infinite_alternate] bg-gradient-to-b from-transparent via-[#b8f35a]/30 to-transparent"
          />
        )}
      </div>
      {reading.error ? (
        <div className="grid gap-3">
          <Note tone="caution" icon="alert">
            {reading.error}
          </Note>
          <PhotoButton label="Try another photo" icon="camera" primary onFile={onRetry} />
          <div className="flex justify-center">
            <TextLink icon="pencil" onClick={onManual}>
              Type it in instead
            </TextLink>
          </div>
        </div>
      ) : (
        <div className="grid gap-3" role="status" aria-live="polite">
          <p className="text-center text-[15.5px] font-medium text-ink">{status}</p>
          <div className="mx-auto h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-white/[.08]">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${stage === 'reading' ? 30 + percent * 0.7 : stage === 'loading' ? 8 + percent * 0.22 : 4}%`,
                background: ACCENT,
              }}
            />
          </div>
          <div className="flex justify-center">
            <TextLink onClick={onCancel}>Cancel</TextLink>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 2. review what was read ---------------- */

function ReviewView({
  id,
  bill,
  update,
  money,
  photo,
  unsure,
  onSeen,
  onRetake,
}: {
  id: string;
  bill: SplitBill;
  update: (patch: Partial<SplitBill>) => void;
  money: (amount: number) => string;
  photo: string | null;
  unsure: Set<string>;
  onSeen: (itemId: string) => void;
  onRetake: (file: File) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [showPhoto, setShowPhoto] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const read = Boolean(bill.receipt);
  const check = checkReceipt({
    merchant: bill.title,
    items: bill.items.map((item) => ({
      name: item.name,
      qty: item.qty ?? 1,
      price: item.price,
      unsure: false,
    })),
    subtotal: bill.receipt?.subtotal ?? null,
    tax: bill.tax.mode === 'amount' ? bill.tax.value : null,
    tip: bill.tip.mode === 'amount' ? bill.tip.value : null,
    total:
      bill.tip.mode === 'amount' && bill.tax.mode === 'amount'
        ? (bill.receipt?.total ?? null)
        : null,
  });

  const add = () => {
    if (!name.trim() && !price) return;
    update({
      items: [
        ...bill.items,
        {
          id: `i${newId(6)}`,
          name: name.trim() || `Item ${bill.items.length + 1}`,
          price,
          people: [],
        },
      ],
    });
    setName('');
    setPrice(0);
    requestAnimationFrame(() => nameInput.current?.focus());
  };
  const edit = (itemId: string, patch: Partial<SplitBill['items'][number]>) => {
    onSeen(itemId);
    update({
      items: bill.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    });
  };

  return (
    <div>
      <Title
        lead={
          read
            ? bill.items.length
              ? 'Here’s what we read. Tap anything to fix it.'
              : 'We couldn’t find any prices on that photo. Add the items below, or try a flatter, sharper photo.'
            : 'Add what’s on the check. Name and price, then Enter.'
        }
      >
        {read ? 'Check the receipt' : 'What’s on the check?'}
      </Title>

      {photo && (
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowPhoto((value) => !value)}
            className="flex items-center gap-2.5 rounded-[12px] bg-well p-1.5 pr-3.5 text-[14px] font-medium text-ink-2 hover:text-ink"
            aria-expanded={showPhoto}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local photo */}
            <img src={photo} alt="" className="size-9 rounded-[8px] object-cover" />
            {showPhoto ? 'Hide photo' : 'Compare with photo'}
          </button>
          <label className="relative ml-auto inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] text-muted hover:text-ink">
            <Icon name="camera" size={16} /> Retake
            <input
              type="file"
              accept="image/*"
              aria-label="Retake the photo"
              className="absolute inset-0 cursor-pointer opacity-0"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onRetake(file);
              }}
            />
          </label>
        </div>
      )}
      {photo && showPhoto && (
        // eslint-disable-next-line @next/next/no-img-element -- a local photo
        <img
          src={photo}
          alt="Your receipt"
          className="mb-4 max-h-[60vh] w-full animate-rise rounded-[14px] bg-black object-contain"
        />
      )}

      <input
        aria-label="Where was this?"
        placeholder="Where was this? (optional)"
        value={bill.title}
        maxLength={80}
        onChange={(event) => update({ title: event.target.value })}
        className="mb-3 h-11 w-full rounded-[12px] bg-transparent px-1 text-[18px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint focus:bg-subtle focus:px-3"
      />

      {unsure.size > 0 && (
        <Note tone="caution" icon="alert" className="mb-3">
          We weren’t sure about the highlighted {unsure.size === 1 ? 'line' : 'lines'}. Give{' '}
          {unsure.size === 1 ? 'it' : 'them'} a quick look.
        </Note>
      )}

      <ul className="grid grid-cols-1 gap-2" aria-label="Items">
        {bill.items.map((item, index) => (
          <li
            key={item.id}
            className={cn(
              'flex items-center gap-2 rounded-[14px] bg-subtle p-1.5 pl-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]',
              unsure.has(item.id) && 'shadow-[inset_0_0_0_1.5px_var(--color-caution)]',
            )}
          >
            {item.qty && item.qty > 1 && (
              <span className="mono-num shrink-0 rounded-[7px] bg-white/[.07] px-1.5 py-0.5 text-[12px] text-ink-2">
                {item.qty}×
              </span>
            )}
            <input
              aria-label={`Item ${index + 1}`}
              value={item.name}
              placeholder="What was it?"
              maxLength={80}
              onChange={(event) => edit(item.id, { name: event.target.value })}
              className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint"
            />
            <MoneyInput
              value={item.price}
              currency={bill.currency}
              label={`Item ${index + 1}’s price`}
              onChange={(cents) => edit(item.id, { price: cents })}
              className="w-[108px] shrink-0"
            />
            <IconButton
              icon="x"
              label={`Remove ${item.name || `item ${index + 1}`}`}
              tone="danger"
              size="sm"
              onClick={() => update({ items: bill.items.filter((entry) => entry.id !== item.id) })}
            />
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
        className="mt-2 flex items-center gap-2 rounded-[14px] p-1.5 pl-2.5 shadow-[inset_0_0_0_1px_var(--color-line-strong)] [border-style:dashed]"
      >
        <input
          ref={nameInput}
          aria-label="New item"
          placeholder={bill.items.length ? 'Add an item' : 'First item – Margherita'}
          value={name}
          maxLength={80}
          enterKeyHint="next"
          autoFocus={!read && bill.items.length === 0}
          onChange={(event) => setName(event.target.value)}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-faint"
        />
        <MoneyInput
          value={price}
          currency={bill.currency}
          label="New item’s price"
          onChange={setPrice}
          onEnter={add}
          className="w-[108px] shrink-0"
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={!name.trim() && !price}
          className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-ink text-on-ink transition-opacity disabled:opacity-30"
        >
          <Icon name="plus" size={18} />
        </button>
      </form>

      <dl className="mt-5 grid gap-2 rounded-[16px] bg-subtle p-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">Subtotal</dt>
          <dd className="num font-semibold text-ink">{money(check.itemsTotal)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>
            <label htmlFor={`${id}-review-tax`} className="text-muted">
              Tax
            </label>
          </dt>
          <dd>
            <MoneyInput
              id={`${id}-review-tax`}
              value={
                bill.tax.mode === 'amount'
                  ? bill.tax.value
                  : Math.round((check.itemsTotal * bill.tax.value) / 100)
              }
              currency={bill.currency}
              label="Tax"
              onChange={(cents) => update({ tax: { mode: 'amount', value: cents } })}
              className="w-[120px]"
            />
          </dd>
        </div>
        {bill.tip.mode === 'amount' && bill.tip.value > 0 && read && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted">Tip on the receipt</dt>
            <dd className="num text-ink">{money(bill.tip.value)}</dd>
          </div>
        )}
        {bill.receipt?.total != null && (
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
            <dt className="text-muted">Total on the receipt</dt>
            <dd className="num font-semibold text-ink">{money(bill.receipt.total)}</dd>
          </div>
        )}
      </dl>
      {read && bill.items.length > 0 && check.subtotalGap !== 0 && (
        <Note tone="caution" icon="alert" className="mt-3">
          The items add up to {money(check.itemsTotal)}, but the receipt’s subtotal says{' '}
          {money(bill.receipt?.subtotal ?? 0)}.{' '}
          {check.subtotalGap > 0 ? 'Something may be missing.' : 'Something may be counted twice.'}
        </Note>
      )}
      {read && bill.items.length > 0 && check.subtotalGap === 0 && check.totalGap !== 0 && (
        <Note tone="caution" icon="alert" className="mt-3">
          Items, tax and tip come to {money(bill.receipt!.total! - check.totalGap)}; the receipt’s
          total is {money(bill.receipt!.total!)}. Worth a look.
        </Note>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
        <span>Currency</span>
        <select
          aria-label="Currency"
          value={bill.currency}
          onChange={(event) => update({ currency: event.target.value })}
          className="h-9 rounded-[10px] bg-well px-2.5 text-[14px] text-ink-2 outline-none"
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ---------------- 3. who's splitting ---------------- */

function PeopleView({
  bill,
  update,
}: {
  bill: SplitBill;
  update: (patch: Partial<SplitBill>) => void;
}) {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const add = (value = name) => {
    if (bill.people.length >= 30) return;
    update({ people: [...bill.people, { id: `p${newId(6)}`, name: value.trim() }] });
    setName('');
    requestAnimationFrame(() => input.current?.focus());
  };
  const remove = (personId: string) =>
    update({
      people: bill.people.filter((person) => person.id !== personId),
      items: bill.items.map((item) => ({
        ...item,
        people: item.people.filter((sharer) => sharer !== personId),
      })),
    });

  return (
    <div>
      <Title lead="Add everyone at the table. You can change names any time.">
        Who’s splitting?
      </Title>
      <ul className="grid grid-cols-1 gap-2">
        {bill.people.map((person, index) => (
          <li
            key={person.id}
            className="flex h-14 items-center gap-3 rounded-[14px] bg-subtle pr-1.5 pl-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
          >
            <Dot index={index} className="!size-3" />
            <input
              aria-label={`Person ${index + 1}’s name`}
              value={person.name}
              placeholder={index === 0 ? 'You' : `Person ${index + 1}`}
              maxLength={40}
              autoCapitalize="words"
              onChange={(event) =>
                update({
                  people: bill.people.map((entry) =>
                    entry.id === person.id ? { ...entry, name: event.target.value } : entry,
                  ),
                })
              }
              className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
            />
            {bill.people.length > 1 && (
              <IconButton
                icon="x"
                label={`Remove ${nameOf(bill, index)}`}
                tone="danger"
                onClick={() => remove(person.id)}
              />
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add();
        }}
        className="mt-2 flex h-14 items-center gap-2 rounded-[14px] pr-1.5 pl-4 shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
      >
        <Icon name="user-plus" size={18} className="shrink-0 text-muted" />
        <input
          ref={input}
          aria-label="Add a name"
          placeholder="Add a name"
          value={name}
          maxLength={40}
          autoCapitalize="words"
          enterKeyHint="done"
          autoFocus={bill.people.length < 2}
          onChange={(event) => setName(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
        />
        <button
          type={name.trim() ? 'submit' : 'button'}
          onClick={name.trim() ? undefined : () => add('')}
          className="h-11 shrink-0 rounded-[11px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink"
        >
          {name.trim() ? 'Add' : '+ Person'}
        </button>
      </form>
    </div>
  );
}

/* ---------------- 4. who had what ---------------- */

function AssignView({
  bill,
  update,
  money,
}: {
  bill: SplitBill;
  update: (patch: Partial<SplitBill>) => void;
  money: (amount: number) => string;
}) {
  const toggle = (itemId: string, personId: string) =>
    update({
      items: bill.items.map((item) => {
        if (item.id !== itemId) return item;
        const on = item.people.includes(personId);
        // Nobody tapped means everyone; tapping everyone keeps them all lit, which reads better.
        return {
          ...item,
          people: on
            ? item.people.filter((entry) => entry !== personId)
            : [...item.people, personId],
        };
      }),
    });

  return (
    <div>
      <Title lead="Tap who had each one. Tap more than one person to share it. Nobody tapped means everyone shares it.">
        Who had what?
      </Title>
      <ul className="grid grid-cols-1 gap-2.5">
        {bill.items.map((item) => {
          const everyone = item.people.length === 0;
          const split = everyone ? bill.people.length : item.people.length;
          return (
            <li
              key={item.id}
              className="rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <div className="flex items-baseline justify-between gap-3 px-0.5">
                <p className="min-w-0 truncate text-[16px] font-semibold text-ink">
                  {item.qty && item.qty > 1 ? `${item.qty}× ` : ''}
                  {item.name || 'Item'}
                </p>
                <p className="num shrink-0 text-[15px] text-ink-2">
                  {money(item.price)}
                  {split > 1 && (
                    <span className="ml-1.5 text-[12.5px] text-muted">
                      {everyone ? 'everyone' : `÷${split}`}
                    </span>
                  )}
                </p>
              </div>
              <div
                role="group"
                aria-label={`Who had ${item.name || 'this'}`}
                className="mt-2.5 flex flex-wrap gap-1.5"
              >
                {bill.people.map((person, index) => {
                  const on = item.people.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(item.id, person.id)}
                      className={cn(
                        'inline-flex h-10 items-center gap-2 rounded-full pr-3.5 pl-3 text-[14.5px] font-medium transition-[background-color,color,box-shadow] active:scale-[.97]',
                        on
                          ? 'bg-ink text-on-ink'
                          : 'bg-white/[.05] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                      )}
                    >
                      <Dot index={index} />
                      {nameOf(bill, index)}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Everyone's share so far, above the button: feedback while you tap. */
function RunningTotals({
  bill,
  result,
  money,
}: {
  bill: SplitBill;
  result: ReturnType<typeof computeSplit>;
  money: (amount: number) => string;
}) {
  return (
    <div
      className="scrollbar-none -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1"
      aria-label="So far"
    >
      {result.people.map((person, index) => (
        <span
          key={person.id}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-well px-2.5 text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          <Dot index={index} className="!size-2" />
          {nameOf(bill, index)}
          <span className="num font-semibold text-ink">{money(person.subtotal)}</span>
        </span>
      ))}
    </div>
  );
}

/* ---------------- 5. tax and tip ---------------- */

function TipView({
  id,
  bill,
  result,
  money,
  update,
}: {
  id: string;
  bill: SplitBill;
  result: ReturnType<typeof computeSplit>;
  money: (amount: number) => string;
  update: (patch: Partial<SplitBill>) => void;
}) {
  const printed = bill.tip.mode === 'amount' && Boolean(bill.receipt) && bill.tip.value > 0;
  const preset =
    bill.tip.mode === 'percent' && (bill.tip.value === 0 || TIPS.includes(bill.tip.value));
  const [custom, setCustom] = useState(!preset && !printed);

  const chip = (on: boolean) =>
    cn(
      'h-12 rounded-[12px] text-[15px] font-semibold transition-colors',
      on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:text-ink',
    );

  return (
    <div>
      <Title lead="Shared by what each person ordered, so a salad never pays for a steak.">
        Tax and tip
      </Title>

      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-subtle p-3 pl-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <label htmlFor={`${id}-tax`} className="text-[15px] text-ink-2">
          Tax
          {bill.receipt && bill.tax.mode === 'amount' && bill.tax.value > 0 && (
            <span className="block text-[12.5px] text-muted">From the receipt</span>
          )}
        </label>
        <div className="flex items-center gap-1.5">
          {bill.tax.mode === 'amount' ? (
            <MoneyInput
              id={`${id}-tax`}
              value={bill.tax.value}
              currency={bill.currency}
              label="Tax"
              onChange={(cents) => update({ tax: { mode: 'amount', value: cents } })}
              className="w-[120px]"
            />
          ) : (
            <PercentInput
              id={`${id}-tax`}
              label="Tax rate"
              value={bill.tax.value}
              onChange={(value) => update({ tax: { mode: 'percent', value } })}
            />
          )}
          <Toggle
            label="Tax as"
            value={bill.tax.mode === 'amount' ? '$' : '%'}
            onChange={(value) =>
              update({
                tax:
                  value === '$'
                    ? { mode: 'amount', value: result.tax }
                    : {
                        mode: 'percent',
                        value: result.subtotal
                          ? Math.round((result.tax / result.subtotal) * 10000) / 100
                          : 0,
                      },
              })
            }
          />
        </div>
      </div>

      <p className="label mt-6 mb-2.5">Tip</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tip">
        {printed ? (
          <button type="button" className={cn(chip(true), 'col-span-3')} aria-pressed="true">
            On the receipt · {money(bill.tip.value)}
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-pressed={bill.tip.value === 0 && !custom}
              onClick={() => {
                setCustom(false);
                update({ tip: { ...bill.tip, mode: 'percent', value: 0 } });
              }}
              className={chip(bill.tip.value === 0 && !custom)}
            >
              No tip
            </button>
            {TIPS.map((value) => {
              const on = !custom && bill.tip.mode === 'percent' && bill.tip.value === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setCustom(false);
                    update({ tip: { ...bill.tip, mode: 'percent', value } });
                  }}
                  className={chip(on)}
                >
                  {value}%
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={custom}
              onClick={() => setCustom(true)}
              className={chip(custom)}
            >
              Custom
            </button>
          </>
        )}
      </div>
      {(custom || printed) && (
        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          {bill.tip.mode === 'percent' ? (
            <PercentInput
              label="Tip percent"
              value={bill.tip.value}
              autoFocus={custom}
              onChange={(value) => update({ tip: { ...bill.tip, mode: 'percent', value } })}
            />
          ) : (
            <MoneyInput
              value={bill.tip.value}
              currency={bill.currency}
              label="Tip amount"
              onChange={(cents) => update({ tip: { ...bill.tip, mode: 'amount', value: cents } })}
              className="w-[130px]"
            />
          )}
          <Toggle
            label="Tip as"
            value={bill.tip.mode === 'amount' ? '$' : '%'}
            onChange={(value) =>
              update({
                tip:
                  value === '$'
                    ? { ...bill.tip, mode: 'amount', value: result.tip }
                    : {
                        ...bill.tip,
                        mode: 'percent',
                        value: result.subtotal
                          ? Math.round((result.tip / result.subtotal) * 100)
                          : 0,
                      },
              })
            }
          />
        </div>
      )}
      {bill.tip.mode === 'percent' && bill.tip.value > 0 && (
        <label className="mt-3 flex min-h-11 items-center gap-2.5 text-[14px] text-muted">
          <input
            type="checkbox"
            checked={bill.tip.afterTax}
            onChange={(event) => update({ tip: { ...bill.tip, afterTax: event.target.checked } })}
            className="size-5 accent-[#b8f35a]"
          />
          Tip on the total with tax
        </label>
      )}

      <dl className="mt-5 grid gap-1.5 rounded-[16px] bg-subtle p-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)]">
        {[
          ['Items', result.subtotal],
          ['Tax', result.tax],
          ['Tip', result.tip],
        ].map(([label, amount]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="num text-ink-2">{money(amount as number)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2.5">
          <dt className="font-semibold text-ink">Total</dt>
          <dd className="num text-[17px] font-bold text-ink">{money(result.total)}</dd>
        </div>
      </dl>
    </div>
  );
}

function PercentInput({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id?: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative w-[110px]">
      <input
        id={id}
        aria-label={label}
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value ? String(value) : ''}
        placeholder="0"
        onChange={(event) => {
          const next = Number(event.target.value.replace(',', '.').replace(/[^\d.]/g, ''));
          if (Number.isFinite(next)) onChange(Math.min(100, next));
        }}
        className="num h-11 w-full rounded-[11px] bg-subtle pr-8 pl-3 text-right text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-muted">
        %
      </span>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: '$' | '%';
  onChange: (value: '$' | '%') => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-[11px] bg-well p-1">
      {(['$', '%'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-9 w-9 rounded-[8px] text-[14px] font-semibold',
            value === option ? 'bg-surface text-ink shadow-card' : 'text-muted',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/* ---------------- 6. the split ---------------- */

function Result({
  bill,
  result,
  money,
}: {
  bill: SplitBill;
  result: ReturnType<typeof computeSplit>;
  money: (amount: number) => string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Totals">
      <div className="mb-5 text-center">
        <p className="label">{bill.title.trim() || 'The bill'}</p>
        <p
          className="num mt-1.5 font-display text-[44px] leading-none font-bold tracking-[-0.03em] text-ink"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {money(result.total)}
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          {money(result.subtotal)} {bill.mode === 'items' ? 'in items' : 'bill'}
          {result.tax > 0 && ` · ${money(result.tax)} tax`}
          {result.tip > 0 && ` · ${money(result.tip)} tip`}
        </p>
      </div>
      <ul className="grid grid-cols-1 gap-2">
        {result.people.map((person, index) => {
          const expanded = open === person.id;
          return (
            <li
              key={person.id}
              className="overflow-hidden rounded-[18px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : person.id)}
                className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
              >
                <Dot index={index} className="!size-3.5" />
                <span className="min-w-0 flex-1 truncate text-[17px] font-semibold text-ink">
                  {nameOf(bill, index)}
                </span>
                <span
                  className="num font-display text-[26px] leading-none font-bold tracking-[-0.02em] text-ink"
                  style={{ fontVariationSettings: "'wdth' 106" }}
                >
                  {money(person.total)}
                </span>
                <Icon
                  name="chevron-down"
                  size={17}
                  className={cn(
                    'shrink-0 text-muted transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
              {expanded && (
                <dl className="grid animate-fade gap-1.5 border-t border-line px-4 py-3 text-[14px]">
                  {person.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <dt className="min-w-0 truncate text-ink-2">
                        {item.name || 'Item'}
                        {item.split > 1 && (
                          <span className="text-muted"> · shared by {item.split}</span>
                        )}
                      </dt>
                      <dd className="num text-ink-2">{money(item.share)}</dd>
                    </div>
                  ))}
                  {bill.mode === 'even' && (
                    <div className="flex justify-between gap-3">
                      <dt className="text-ink-2">Their share of the bill</dt>
                      <dd className="num text-ink-2">{money(person.subtotal)}</dd>
                    </div>
                  )}
                  {person.tax > 0 && (
                    <div className="flex justify-between gap-3 text-muted">
                      <dt>Tax</dt>
                      <dd className="num">{money(person.tax)}</dd>
                    </div>
                  )}
                  {person.tip > 0 && (
                    <div className="flex justify-between gap-3 text-muted">
                      <dt>Tip</dt>
                      <dd className="num">{money(person.tip)}</dd>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between gap-3 border-t border-line pt-2 font-semibold text-ink">
                    <dt>Total</dt>
                    <dd className="num">{money(person.total)}</dd>
                  </div>
                </dl>
              )}
            </li>
          );
        })}
      </ul>
      {bill.mode === 'items' && (result.tax > 0 || result.tip > 0) && (
        <p className="mt-3 text-center text-[12.5px] text-muted">
          Tax and tip are shared by what each person ordered. Tap a name to see the math.
        </p>
      )}
    </section>
  );
}

/** Sharing, once there's something worth sending: the phone's share sheet first. */
function ShareArea({ bill, result }: { bill: SplitBill; result: ReturnType<typeof computeSplit> }) {
  const { copy } = useCopy();
  const [more, setMore] = useState(false);
  const summary = splitSummary(bill, result);
  const share = async () => {
    const url = await linkFor(bill);
    if (navigator.share) {
      try {
        await navigator.share({ title: bill.title.trim() || 'The bill', text: summary, url });
        return;
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return;
      }
    }
    await copy(`${summary}\n${url}`, 'Copied — paste it in the group chat');
  };
  return (
    <div className="mt-5 grid gap-2">
      <button
        type="button"
        onClick={share}
        className="flex h-14 items-center justify-center gap-2 rounded-[16px] text-[16.5px] font-semibold text-[#12110d] active:scale-[.985]"
        style={{ background: ACCENT }}
      >
        <Icon name="share" size={18} /> Share the split
      </button>
      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((value) => !value)}
        className="mx-auto inline-flex h-10 items-center gap-1.5 text-[14px] text-muted hover:text-ink"
      >
        More ways to share{' '}
        <Icon name="chevron-down" size={15} className={cn(more && 'rotate-180')} />
      </button>
      {more && (
        <div className="grid animate-rise gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <button
            type="button"
            onClick={() => copy(summary, 'Totals copied')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well text-[15px] font-medium text-ink-2 hover:text-ink"
          >
            <Icon name="copy" size={16} /> Copy the totals as text
          </button>
          <ShareLinkCard
            build={() => linkFor(bill)}
            title={bill.title.trim() || 'The bill'}
            cta="Share the bill as a link"
          >
            <p className="text-[13px] text-muted">
              A link anyone can open to see their total. It’s read-only.
            </p>
          </ShareLinkCard>
        </div>
      )}
    </div>
  );
}

/* ---------------- evenly ---------------- */

function EvenView({
  bill,
  result,
  money,
  update,
  onBack,
  onItems,
}: {
  bill: SplitBill;
  result: ReturnType<typeof computeSplit>;
  money: (amount: number) => string;
  update: (patch: Partial<SplitBill>) => void;
  onBack: () => void;
  onItems: () => void;
}) {
  const count = bill.people.length;
  const setCount = (next: number) => {
    const size = Math.max(2, Math.min(30, next));
    const people = bill.people.slice(0, size);
    while (people.length < size) people.push({ id: `p${newId(6)}`, name: '' });
    update({ people });
  };
  const each = result.people.length ? Math.min(...result.people.map((person) => person.total)) : 0;
  const uneven = new Set(result.people.map((person) => person.total)).size > 1;

  return (
    <div>
      <div className="mb-5 flex items-center gap-3">
        <IconButton
          icon="arrow-left"
          label="Back"
          onClick={onBack}
          className="!rounded-full bg-well"
        />
        <span className="text-[13px] font-semibold text-ink-2">Split evenly</span>
      </div>
      <Title>How much was it?</Title>
      <MoneyInput
        value={bill.total}
        currency={bill.currency}
        label="Bill total"
        autoFocus={!bill.total}
        onChange={(cents) => update({ total: cents })}
        inputClassName="!h-16 !text-[28px] !rounded-[16px] !pl-9"
      />

      <p className="label mt-6 mb-2.5">Between</p>
      <div className="flex items-center justify-between rounded-[16px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <button
          type="button"
          aria-label="One fewer person"
          onClick={() => setCount(count - 1)}
          disabled={count <= 2}
          className="grid size-12 place-items-center rounded-[12px] bg-well text-ink disabled:opacity-30"
        >
          <Icon name="minus" size={20} />
        </button>
        <p className="text-center">
          <span className="num text-[28px] font-bold text-ink">{count}</span>{' '}
          <span className="text-[15px] text-muted">people</span>
        </p>
        <button
          type="button"
          aria-label="One more person"
          onClick={() => setCount(count + 1)}
          className="grid size-12 place-items-center rounded-[12px] bg-well text-ink"
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      <p className="label mt-6 mb-2.5">Add a tip?</p>
      <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Tip">
        {[0, ...TIPS].map((value) => {
          const on = bill.tip.mode === 'percent' && bill.tip.value === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={on}
              onClick={() => update({ tip: { ...bill.tip, mode: 'percent', value } })}
              className={cn(
                'h-11 rounded-[11px] text-[14px] font-semibold',
                on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2',
              )}
            >
              {value ? `${value}%` : 'None'}
            </button>
          );
        })}
      </div>

      <div
        className="mt-6 rounded-[20px] p-5 text-center"
        style={{ background: 'color-mix(in oklab, #b8f35a 14%, transparent)' }}
      >
        <p className="label !text-ink-2">Each person pays</p>
        <p
          className="num mt-1 font-display text-[48px] leading-none font-bold tracking-[-0.03em] text-ink"
          style={{ fontVariationSettings: "'wdth' 108" }}
          aria-live="polite"
        >
          {money(each)}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          {money(result.total)} total{result.tip > 0 && ` with ${money(result.tip)} tip`}
          {uneven && ' · a few cents go to some people so it adds up exactly'}
        </p>
      </div>
      {result.total > 0 && <ShareArea bill={bill} result={result} />}
      <div className="mt-4 flex justify-center">
        <TextLink icon="receipt-text" onClick={onItems}>
          Split by item instead
        </TextLink>
      </div>
    </div>
  );
}
