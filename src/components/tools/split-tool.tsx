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
  allocate,
  computeSplit,
  CURRENCIES,
  formatMoney,
  localCurrency,
  newBill,
  splitBillSchema,
  splitSummary,
  type SplitBill,
} from '@/lib/tools/split';
import { IconButton, Journey, Note, SampleButton, StartPanel, useCopy } from './kit';
import { MoneyInput } from './money-input';
import { ShareLinkCard } from './share-link';
import { Avatar, colorOf, PAPER, PAPER_INK, StartArt, torn } from './split-art';

/*
 * Split, receipt first: photograph the check, fix anything the reader got wrong, say who's at the
 * table, tap who had what, pick a tip, done — everyone's total, exact to the cent. Typing the
 * items in, or just dividing a total evenly, are always one tap away.
 *
 * Each step has its own address (`?step=people`), so the phone's back gesture steps back through
 * the check instead of leaving it. The bill is kept in this browser; sharing puts a read-only
 * copy inside a link.
 */

const TIPS = [15, 18, 20, 22];
const ACCENT = 'var(--accent, var(--color-ink))';

type Step = 'start' | 'receipt' | 'people' | 'items' | 'tip' | 'done' | 'even';
const FLOW: { step: Step; label: string }[] = [
  { step: 'receipt', label: 'Receipt' },
  { step: 'people', label: 'People' },
  { step: 'items', label: 'Who had it' },
  { step: 'tip', label: 'Tax & tip' },
  { step: 'done', label: 'Totals' },
];
const STEPS: Step[] = ['receipt', 'people', 'items', 'tip', 'done', 'even'];

/** A made-up dinner to try it with, made on the device. */
const SAMPLE: ParsedReceipt = {
  merchant: 'The Sample Trattoria',
  items: [
    { name: 'Garlic knots', qty: 1, price: 750, unsure: false },
    { name: 'Margherita pizza', qty: 1, price: 1600, unsure: false },
    { name: 'Rigatoni alla vodka', qty: 1, price: 1850, unsure: false },
    { name: 'Caesar salad', qty: 1, price: 1200, unsure: false },
    { name: 'Lemonade', qty: 2, price: 900, unsure: false },
    { name: 'Tiramisu', qty: 1, price: 850, unsure: false },
  ],
  subtotal: 7150,
  tax: 635,
  tip: null,
  total: null,
};

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

/* ---------------- names you split with before ---------------- */

const NAMES_KEY = 'hyphy.split.names';

function recentNames(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function rememberNames(names: string[]) {
  try {
    const seen = new Set<string>();
    const keep = [...names.map((name) => name.trim()), ...recentNames()].filter((name) => {
      const key = name.toLowerCase();
      if (!name || /^(you|me)$/i.test(name) || /^person \d+$/i.test(name) || seen.has(key))
        return false;
      seen.add(key);
      return true;
    });
    localStorage.setItem(NAMES_KEY, JSON.stringify(keep.slice(0, 8)));
  } catch {
    // Private mode or storage off: suggestions are a nicety.
  }
}

/* ---------------- small parts ---------------- */

const nameOf = (bill: SplitBill, index: number) =>
  bill.people[index]?.name.trim() || (index === 0 ? 'You' : `Person ${index + 1}`);

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
        className="flex h-14 w-full items-center justify-center gap-2 rounded-[16px] text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] transition-[transform,opacity] active:scale-[.985] disabled:opacity-40 disabled:shadow-none"
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
  return (
    <div className="mb-6 flex items-start gap-3">
      <IconButton
        icon="arrow-left"
        label="Back"
        onClick={onBack}
        className="!rounded-full bg-well"
      />
      <Journey
        className="flex-1 pt-1"
        steps={FLOW.map((entry) => entry.label)}
        current={FLOW.findIndex((entry) => entry.step === step)}
        onPick={(index) => onPick(FLOW[index].step)}
        reachable={(index) => reachable(FLOW[index].step)}
      />
    </div>
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

/** A slip of receipt paper: light and warm in any theme, torn at the edges. */
function Paper({
  children,
  edges = 'bottom',
  className,
}: {
  children: ReactNode;
  edges?: 'bottom' | 'top' | 'both';
  className?: string;
}) {
  return (
    <div
      className={cn('relative', className)}
      style={{ background: PAPER, color: PAPER_INK, ...torn(edges, 14) }}
    >
      {children}
    </div>
  );
}

/** Money fields that sit on the paper instead of in a box. */
const onPaper = {
  className: '[&>span]:!text-[#221e16]/45',
  input:
    '!bg-transparent !text-[#221e16] !shadow-none !rounded-[9px] placeholder:!text-[#221e16]/30 focus:!bg-[#221e16]/[.07] lg:!h-11 lg:!text-[16px]',
};

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
  const [sample, setSample] = useState(false);
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
    setSample(false);
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

  const startSample = () => {
    setPhoto(null);
    setSample(true);
    apply(SAMPLE);
    go('receipt');
  };

  const startManual = () => {
    setPhoto(null);
    setSample(false);
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
    setSample(false);
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
      <Start
        onPhoto={(file) => void read(file)}
        onSample={startSample}
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
          sample={sample}
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
          onClick={() => {
            rememberNames(bill.people.map((person) => person.name));
            go('items');
          }}
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
      <Result bill={bill} result={result} money={money} celebrate />
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
          ? 'text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)]'
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
  onSample,
  onManual,
  onEven,
  privacy,
  saved,
}: {
  onPhoto: (file: File) => void;
  onSample: () => void;
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
      className={cn(
        'mx-auto w-full max-w-[640px] rounded-[26px] transition-shadow',
        over && 'shadow-[0_0_0_2px_var(--accent,var(--color-ink))]',
      )}
    >
      <StartPanel
        art={
          <>
            {saved && (
              <div className="mb-5 flex items-center gap-3 rounded-[16px] bg-subtle p-3 pl-4 text-left shadow-[inset_0_0_0_1px_var(--color-line)]">
                <Icon name="receipt-text" size={18} className="shrink-0 text-signal-ink" />
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
                <IconButton
                  icon="x"
                  label="Discard the last bill"
                  onClick={saved.onDiscard}
                  size="sm"
                />
              </div>
            )}
            <StartArt />
          </>
        }
        title="Got the check?"
        lead="Snap it and we’ll read the items. Tap who had what, and everyone gets their exact total."
        footer={
          <div className="grid gap-4">
            <p className="flex items-center justify-center gap-1.5 text-[12.5px]">
              <Icon name="lock" size={12} className="shrink-0" /> {privacy}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1 border-t border-line pt-3">
              <TextLink icon="pencil" onClick={onManual}>
                Type it in instead
              </TextLink>
              <TextLink icon="people" onClick={onEven}>
                Split evenly instead
              </TextLink>
            </div>
          </div>
        }
      >
        <div className="grid gap-2.5">
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
            className="[@media(pointer:fine)]:bg-[var(--accent,var(--color-ink))] [@media(pointer:fine)]:text-[#12110d] [@media(pointer:fine)]:shadow-none"
          />
          <SampleButton onClick={onSample} className="mt-0.5">
            Try a sample receipt
          </SampleButton>
        </div>
      </StartPanel>
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
            className="absolute inset-x-0 h-16 animate-[scan_1.8s_ease-in-out_infinite_alternate] bg-gradient-to-b from-transparent via-[var(--accent,white)]/30 to-transparent"
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
  sample,
  unsure,
  onSeen,
  onRetake,
}: {
  id: string;
  bill: SplitBill;
  update: (patch: Partial<SplitBill>) => void;
  money: (amount: number) => string;
  photo: string | null;
  sample: boolean;
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
          sample
            ? 'A made-up dinner to try it with. Tap any line to change it.'
            : read
              ? bill.items.length
                ? 'Here’s what we read. Tap any line to fix it.'
                : 'We couldn’t find any prices on that photo. Add the items below, or try a flatter, sharper photo.'
              : 'One line at a time: a name, a price, then Enter.'
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

      {unsure.size > 0 && (
        <Note tone="caution" icon="alert" className="mb-3">
          We weren’t sure about the highlighted {unsure.size === 1 ? 'line' : 'lines'}. Give{' '}
          {unsure.size === 1 ? 'it' : 'them'} a quick look.
        </Note>
      )}

      <Paper edges="both" className="px-3 pt-6 pb-7 sm:px-5">
        <input
          aria-label="Where was this?"
          placeholder="Where was this?"
          value={bill.title}
          maxLength={80}
          onChange={(event) => update({ title: event.target.value })}
          className="h-11 w-full rounded-[9px] bg-transparent px-2 text-center font-display text-[19px] font-bold tracking-[-0.01em] uppercase outline-none placeholder:font-sans placeholder:text-[16px] placeholder:font-normal placeholder:tracking-normal placeholder:normal-case placeholder:opacity-45 focus:bg-[#221e16]/[.07]"
          style={{ fontVariationSettings: "'wdth' 100" }}
        />
        <p className="mono-num mb-2 text-center text-[10.5px] tracking-[0.12em] uppercase opacity-50">
          {bill.items.length} {bill.items.length === 1 ? 'item' : 'items'} · {bill.currency}
        </p>
        <div className="mb-1 border-t-2 border-dashed border-[#221e16]/20" />

        <ul className="grid grid-cols-1" aria-label="Items">
          {bill.items.map((item, index) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-1 border-b border-dashed border-[#221e16]/15 py-1',
                unsure.has(item.id) && '-mx-1.5 rounded-[10px] bg-[#ffd666]/55 px-1.5',
              )}
            >
              {item.qty && item.qty > 1 && (
                <span className="mono-num shrink-0 pl-1 text-[12.5px] font-semibold opacity-60">
                  {item.qty}×
                </span>
              )}
              <input
                aria-label={`Item ${index + 1}`}
                value={item.name}
                placeholder="What was it?"
                maxLength={80}
                onChange={(event) => edit(item.id, { name: event.target.value })}
                className="h-11 min-w-0 flex-1 rounded-[9px] bg-transparent px-1.5 text-[16px] outline-none placeholder:opacity-35 focus:bg-[#221e16]/[.07]"
              />
              <MoneyInput
                value={item.price}
                currency={bill.currency}
                label={`Item ${index + 1}’s price`}
                onChange={(cents) => edit(item.id, { price: cents })}
                className={cn('w-[100px] shrink-0', onPaper.className)}
                inputClassName={cn(onPaper.input, 'font-semibold')}
              />
              <button
                type="button"
                aria-label={`Remove ${item.name || `item ${index + 1}`}`}
                title="Remove"
                onClick={() =>
                  update({ items: bill.items.filter((entry) => entry.id !== item.id) })
                }
                className="grid size-9 shrink-0 place-items-center rounded-full opacity-40 transition-opacity hover:bg-[#221e16]/[.07] hover:opacity-90"
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
          className="mt-2 flex items-center gap-1 rounded-[12px] border-[1.5px] border-dashed border-[#221e16]/30 p-1 pl-1.5"
        >
          <input
            ref={nameInput}
            aria-label="New item"
            placeholder={bill.items.length ? 'Add an item' : 'First item, like Pizza'}
            value={name}
            maxLength={80}
            enterKeyHint="next"
            autoComplete="off"
            autoFocus={!read && bill.items.length === 0}
            onChange={(event) => setName(event.target.value)}
            className="h-11 min-w-0 flex-1 rounded-[9px] bg-transparent px-1.5 text-[16px] outline-none placeholder:opacity-45 focus:bg-[#221e16]/[.07]"
          />
          <MoneyInput
            value={price}
            currency={bill.currency}
            label="New item’s price"
            onChange={setPrice}
            onEnter={add}
            className={cn('w-[92px] shrink-0', onPaper.className)}
            inputClassName={onPaper.input}
          />
          <button
            type="submit"
            aria-label="Add"
            disabled={!name.trim() && !price}
            className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#221e16] text-[#fdfaf3] transition-opacity disabled:opacity-25"
          >
            <Icon name="plus" size={18} />
          </button>
        </form>

        <dl className="mt-4 grid gap-1 border-t-2 border-dashed border-[#221e16]/20 pt-3 text-[15px]">
          <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
            <dt className="opacity-65">Subtotal</dt>
            <dd className="num font-semibold">{money(check.itemsTotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 pl-1.5">
            <dt>
              <label htmlFor={`${id}-review-tax`} className="opacity-65">
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
                className={cn('w-[112px]', onPaper.className)}
                inputClassName={cn(onPaper.input, '!pr-1.5')}
              />
            </dd>
          </div>
          {bill.tip.mode === 'amount' && bill.tip.value > 0 && read && (
            <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
              <dt className="opacity-65">Tip on the receipt</dt>
              <dd className="num">{money(bill.tip.value)}</dd>
            </div>
          )}
          {bill.receipt?.total != null ? (
            <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
              <dt className="opacity-65">Total on the receipt</dt>
              <dd className="num font-semibold">{money(bill.receipt.total)}</dd>
            </div>
          ) : check.itemsTotal > 0 ? (
            <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
              <dt className="font-semibold">Before tip</dt>
              <dd className="num font-display text-[19px] font-bold">
                {money(
                  check.itemsTotal +
                    (bill.tax.mode === 'amount'
                      ? bill.tax.value
                      : Math.round((check.itemsTotal * bill.tax.value) / 100)),
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </Paper>

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

      <div className="mt-4 flex items-center justify-end gap-2 text-[13px] text-muted">
        <label htmlFor={`${id}-currency`}>Paying in</label>
        <select
          id={`${id}-currency`}
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
  // Only ever shown after the bill loads, so reading storage here never meets the server's HTML.
  const [recent] = useState(recentNames);
  const input = useRef<HTMLInputElement>(null);
  const full = bill.people.length >= 30;
  const add = (value = name) => {
    if (full) return;
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

  const taken = new Set(bill.people.map((person) => person.name.trim().toLowerCase()));
  let guest = 'Guest';
  for (let number = 2; taken.has(guest.toLowerCase()); number += 1) guest = `Guest ${number}`;
  const suggestions = [
    ...(taken.has('you') || taken.has('me') ? [] : ['Me']),
    ...recent.filter((entry) => !taken.has(entry.toLowerCase())).slice(0, 5),
    guest,
  ];

  return (
    <div>
      <Title lead="Type a name and press Enter, then the next. Tap a name to change it.">
        Who’s splitting?
      </Title>

      <ul className="flex flex-wrap gap-2" aria-label="At the table">
        {bill.people.map((person, index) => {
          const shown = person.name || (index === 0 ? 'You' : `Person ${index + 1}`);
          return (
            <li
              key={person.id}
              className="flex h-12 max-w-full animate-pop items-center gap-1.5 rounded-full bg-well pr-1 pl-1.5"
              style={{
                boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${colorOf(index)} 45%, transparent)`,
              }}
            >
              <Avatar index={index} name={nameOf(bill, index)} size={36} />
              <input
                aria-label={`Person ${index + 1}’s name`}
                value={person.name}
                placeholder={index === 0 ? 'You' : `Person ${index + 1}`}
                maxLength={40}
                autoCapitalize="words"
                autoComplete="off"
                onChange={(event) =>
                  update({
                    people: bill.people.map((entry) =>
                      entry.id === person.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  })
                }
                style={{ width: `${Math.min(18, Math.max(3, shown.length)) + 1.5}ch` }}
                className="h-10 min-w-0 rounded-full bg-transparent px-1.5 text-[16px] font-semibold text-ink outline-none placeholder:text-ink-2 focus:bg-white/[.06]"
              />
              {bill.people.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove ${nameOf(bill, index)}`}
                  title="Remove"
                  onClick={() => remove(person.id)}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-critical-soft hover:text-critical"
                >
                  <Icon name="x" size={15} />
                </button>
              ) : (
                <span className="w-2" />
              )}
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add();
        }}
        className="mt-4 flex h-[60px] items-center gap-2.5 rounded-[18px] bg-subtle pr-1.5 pl-2 shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] transition-shadow focus-within:shadow-[inset_0_0_0_2px_var(--accent,var(--color-ink))]"
      >
        <Avatar index={bill.people.length} name={name.trim() || '+'} size={40} />
        <input
          ref={input}
          aria-label="Add a name"
          placeholder={full ? 'That’s a full table' : 'Add a name'}
          disabled={full}
          value={name}
          maxLength={40}
          autoCapitalize="words"
          autoComplete="off"
          enterKeyHint="next"
          autoFocus={bill.people.length < 2}
          onChange={(event) => setName(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!name.trim() || full}
          className="h-11 shrink-0 rounded-[12px] px-4 text-[15px] font-semibold text-[#12110d] transition-opacity disabled:opacity-30"
          style={{ background: ACCENT }}
        >
          Add
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Quick add">
        <span className="mr-0.5 text-[13px] text-muted">Quick add</span>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={full}
            onClick={() => add(suggestion)}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-well px-3.5 text-[14.5px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:text-ink active:scale-[.97] disabled:opacity-40"
          >
            <Icon name="plus" size={14} /> {suggestion}
          </button>
        ))}
      </div>
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
  const setPeople = (itemId: string, people: (current: string[]) => string[]) =>
    update({
      items: bill.items.map((item) =>
        item.id === itemId ? { ...item, people: people(item.people) } : item,
      ),
    });
  const toggle = (itemId: string, personId: string) =>
    setPeople(itemId, (current) =>
      current.includes(personId)
        ? current.filter((entry) => entry !== personId)
        : [...current, personId],
    );
  const index = new Map(bill.people.map((person, position) => [person.id, position]));

  return (
    <div>
      <Title lead="Tap who had each one. Tap two or more to share it. Untapped items are shared by everyone.">
        Who had what?
      </Title>
      <ul className="grid grid-cols-1 gap-3">
        {bill.items.map((item) => {
          const sharers = item.people.filter((personId) => index.has(personId));
          const everyone = sharers.length === 0;
          const count = everyone ? bill.people.length : sharers.length;
          const parts = allocate(
            item.price,
            Array.from({ length: count }, () => 1),
          );
          const each = parts.length
            ? `${parts[0] === parts[parts.length - 1] ? '' : 'about '}${money(parts[0])} each`
            : '';
          const colors = sharers.map((personId) => colorOf(index.get(personId)!));
          return (
            <li
              key={item.id}
              className="relative overflow-hidden rounded-[20px] bg-subtle p-3.5 pl-5 shadow-[inset_0_0_0_1px_var(--color-line)]"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-3 left-2 w-1 rounded-full transition-[background] duration-300"
                style={{
                  background: everyone
                    ? 'var(--color-line-strong)'
                    : colors.length === 1
                      ? colors[0]
                      : `linear-gradient(${colors.join(', ')})`,
                }}
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[17px] font-semibold text-ink">
                  {item.qty && item.qty > 1 ? `${item.qty}× ` : ''}
                  {item.name || 'Item'}
                </p>
                <p className="num shrink-0 text-[16px] font-semibold text-ink">
                  {money(item.price)}
                </p>
              </div>
              <div
                role="group"
                aria-label={`Who had ${item.name || 'this'}`}
                className="mt-3 flex flex-wrap gap-2"
              >
                {bill.people.map((person, position) => {
                  const on = item.people.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(item.id, person.id)}
                      className={cn(
                        'inline-flex h-11 items-center gap-2 rounded-full pr-4 pl-1.5 text-[15px] font-semibold transition-[background-color,color,box-shadow,transform] active:scale-[.95]',
                        on
                          ? 'text-[#12110d]'
                          : 'bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink',
                      )}
                      style={on ? { background: colorOf(position) } : undefined}
                    >
                      {on ? (
                        <span
                          className="grid size-8 place-items-center rounded-full bg-[#12110d]/85"
                          style={{ color: colorOf(position) }}
                        >
                          <Icon name="check" size={16} strokeWidth={3} />
                        </span>
                      ) : (
                        <Avatar index={position} name={nameOf(bill, position)} size={32} />
                      )}
                      {nameOf(bill, position)}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2.5 flex min-h-8 items-center justify-between gap-2 text-[13px]">
                <p className="flex min-w-0 items-center gap-1.5 text-muted">
                  {everyone ? (
                    <>
                      <Icon name="people" size={14} className="shrink-0" />
                      <span className="truncate">Everyone shares it · {each}</span>
                    </>
                  ) : count === 1 ? (
                    <span className="truncate">
                      Just {nameOf(bill, index.get(sharers[0])!)} · {money(item.price)}
                    </span>
                  ) : (
                    <>
                      <span className="shrink-0 rounded-full bg-signal-soft px-2 py-0.5 text-[12px] font-semibold text-signal-ink">
                        Shared ÷{count}
                      </span>
                      <span className="truncate">{each}</span>
                    </>
                  )}
                </p>
                {!everyone && (
                  <button
                    type="button"
                    onClick={() => setPeople(item.id, () => [])}
                    className="h-8 shrink-0 rounded-full px-2.5 text-[12.5px] font-medium text-muted hover:bg-white/[.06] hover:text-ink"
                  >
                    Split with all
                  </button>
                )}
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
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-well pr-3 pl-1 text-[13px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          <Avatar index={index} name={nameOf(bill, index)} size={26} />
          {nameOf(bill, index)}
          <span className="num font-semibold text-ink">{money(person.subtotal)}</span>
        </span>
      ))}
    </div>
  );
}

/* ---------------- 5. tax and tip ---------------- */

function TipChip({
  on,
  onClick,
  title,
  detail,
  className,
}: {
  on: boolean;
  onClick?: () => void;
  title: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'flex min-h-[68px] flex-col items-center justify-center rounded-[18px] px-2 transition-[background-color,color,box-shadow,transform] active:scale-[.97]',
        on
          ? 'text-[#12110d] shadow-[0_12px_28px_-16px_var(--accent,transparent)]'
          : 'bg-well text-ink shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[.08]',
        className,
      )}
      style={on ? { background: ACCENT } : undefined}
    >
      <span className="font-display text-[20px] leading-tight font-bold tracking-[-0.02em]">
        {title}
      </span>
      {detail && (
        <span className={cn('num text-[12.5px]', on ? 'text-[#12110d]/70' : 'text-muted')}>
          {detail}
        </span>
      )}
    </button>
  );
}

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
  const base = bill.tip.afterTax ? result.subtotal + result.tax : result.subtotal;
  const tipFor = (percent: number) => money(Math.round((base * percent) / 100));

  return (
    <div>
      <Title lead="Shared by what each person ordered, so a salad never pays for a steak.">
        Tax and tip
      </Title>

      <p className="label mb-2.5">Tip</p>
      {printed ? (
        <div className="grid gap-2" role="group" aria-label="Tip">
          <TipChip on title="On the receipt" detail={money(bill.tip.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Tip">
          <TipChip
            on={bill.tip.value === 0 && !custom}
            onClick={() => {
              setCustom(false);
              update({ tip: { ...bill.tip, mode: 'percent', value: 0 } });
            }}
            title="No tip"
            detail="Skip it"
          />
          {TIPS.map((value) => (
            <TipChip
              key={value}
              on={!custom && bill.tip.mode === 'percent' && bill.tip.value === value}
              onClick={() => {
                setCustom(false);
                update({ tip: { ...bill.tip, mode: 'percent', value } });
              }}
              title={`${value}%`}
              detail={tipFor(value)}
            />
          ))}
          <TipChip
            on={custom}
            onClick={() => setCustom(true)}
            title="Custom"
            detail={custom ? money(result.tip) : 'Your call'}
          />
        </div>
      )}
      {(custom || printed) && (
        <div className="mt-2.5 flex animate-rise items-center justify-between gap-2 rounded-[16px] bg-subtle p-2 pl-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <span className="text-[14px] text-muted">{printed ? 'Change the tip' : 'Your tip'}</span>
          <span className="flex items-center gap-1.5">
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
                className="w-[120px]"
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
          </span>
        </div>
      )}
      {bill.tip.mode === 'percent' && bill.tip.value > 0 && (
        <label className="mt-2 flex min-h-11 items-center gap-2.5 text-[14px] text-muted">
          <input
            type="checkbox"
            checked={bill.tip.afterTax}
            onChange={(event) => update({ tip: { ...bill.tip, afterTax: event.target.checked } })}
            className="size-5 accent-[var(--accent,var(--color-ink))]"
          />
          Tip on the total with tax
        </label>
      )}

      <div className="mt-6 flex items-center justify-between gap-3 rounded-[16px] bg-subtle p-2 pl-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <label htmlFor={`${id}-tax`} className="text-[15px] text-ink-2">
          Tax
          <span className="block text-[12.5px] text-muted">
            {bill.receipt && bill.tax.mode === 'amount' && bill.tax.value > 0
              ? 'From the receipt'
              : 'As printed on the check'}
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          {bill.tax.mode === 'amount' ? (
            <MoneyInput
              id={`${id}-tax`}
              value={bill.tax.value}
              currency={bill.currency}
              label="Tax"
              onChange={(cents) => update({ tax: { mode: 'amount', value: cents } })}
              className="w-[112px]"
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

      <Paper edges="both" className="mt-6 px-5 py-6">
        <dl className="grid gap-1.5 text-[15px]">
          {[
            ['Items', result.subtotal],
            ['Tax', result.tax],
            ['Tip', result.tip],
          ].map(([label, amount]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="opacity-65">{label}</dt>
              <dd className="num">{money(amount as number)}</dd>
            </div>
          ))}
          <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t-2 border-dashed border-[#221e16]/20 pt-2.5">
            <dt className="font-semibold">Total</dt>
            <dd className="num font-display text-[22px] font-bold tracking-[-0.02em]">
              {money(result.total)}
            </dd>
          </div>
        </dl>
      </Paper>
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
    <div className="relative w-[100px]">
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

/** A few flecks of color over the total: done, and it adds up. */
function Confetti() {
  const bits = [
    { left: '2%', top: 6, rotate: -18, color: 0, delay: 60 },
    { left: '9%', top: 44, rotate: 24, color: 2, delay: 160 },
    { left: '3%', top: 84, rotate: 50, color: 6, delay: 320 },
    { left: '91%', top: 10, rotate: 30, color: 1, delay: 100 },
    { left: '85%', top: 50, rotate: -12, color: 3, delay: 220 },
    { left: '94%', top: 88, rotate: 8, color: 4, delay: 280 },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {bits.map((bit, index) => (
        <span
          key={index}
          className="absolute animate-rise"
          style={{ left: bit.left, top: bit.top, animationDelay: `${bit.delay}ms` }}
        >
          <span
            className="block h-2 w-3.5 rounded-[3px]"
            style={{ background: colorOf(bit.color), transform: `rotate(${bit.rotate}deg)` }}
          />
        </span>
      ))}
    </div>
  );
}

function Result({
  bill,
  result,
  money,
  celebrate,
}: {
  bill: SplitBill;
  result: ReturnType<typeof computeSplit>;
  money: (amount: number) => string;
  celebrate?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section aria-label="Totals">
      <div className="relative mb-6 px-6 pt-2 text-center">
        {celebrate && <Confetti />}
        <p className="label !text-ink-2">{bill.title.trim() || 'The bill'}</p>
        <p
          className="num mt-2 font-display text-[48px] leading-none font-bold tracking-[-0.035em] text-ink"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {money(result.total)}
        </p>
        <p className="mt-2 text-[13px] text-muted">
          {money(result.subtotal)} {bill.mode === 'items' ? 'in items' : 'bill'}
          {result.tax > 0 && ` · ${money(result.tax)} tax`}
          {result.tip > 0 && ` · ${money(result.tip)} tip`}
        </p>
        {celebrate && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-signal-soft px-3 py-1.5 text-[13px] font-medium text-signal-ink">
            <Icon name="check" size={14} strokeWidth={2.6} />
            Split {result.people.length} ways, exact to the cent
          </p>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {result.people.map((person, index) => {
          const expanded = open === person.id;
          const color = colorOf(index);
          return (
            <li
              key={person.id}
              className={cn(
                'animate-rise overflow-hidden rounded-[22px]',
                expanded && 'sm:col-span-2',
              )}
              style={{
                animationDelay: `${Math.min(index, 8) * 60}ms`,
                background: `color-mix(in oklab, ${color} 13%, var(--color-subtle))`,
                boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 38%, transparent)`,
              }}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : person.id)}
                className="flex w-full items-center gap-3.5 p-4 text-left"
              >
                <Avatar index={index} name={nameOf(bill, index)} size={46} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold text-ink">
                    {nameOf(bill, index)}
                  </span>
                  <span className="flex items-center gap-1 text-[12.5px] text-muted">
                    {bill.mode === 'items'
                      ? `${person.items.length} ${person.items.length === 1 ? 'item' : 'items'}`
                      : 'Equal share'}
                    <Icon
                      name="chevron-down"
                      size={13}
                      className={cn('transition-transform', expanded && 'rotate-180')}
                    />
                  </span>
                </span>
                <span
                  className="num font-display text-[30px] leading-none font-bold tracking-[-0.03em] text-ink"
                  style={{ fontVariationSettings: "'wdth' 106" }}
                >
                  {money(person.total)}
                </span>
              </button>
              {expanded && (
                <dl
                  className="grid animate-fade gap-1.5 px-4 pt-3 pb-4 text-[14px]"
                  style={{
                    borderTop: `1px dashed color-mix(in srgb, ${color} 40%, transparent)`,
                  }}
                >
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
  const { copy, copied } = useCopy();
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
    <div className="mt-6 grid gap-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={share}
          className="flex h-14 items-center justify-center gap-2 rounded-[16px] text-[16.5px] font-semibold text-[#12110d] shadow-[0_14px_32px_-16px_var(--accent,transparent)] active:scale-[.985]"
          style={{ background: ACCENT }}
        >
          <Icon name="share" size={18} /> Share the split
        </button>
        <button
          type="button"
          onClick={() => copy(summary, 'Totals copied')}
          aria-label="Copy the totals as text"
          className="inline-flex h-14 items-center justify-center gap-2 rounded-[16px] bg-well px-4 text-[15px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-white/[.08] active:scale-[.985]"
        >
          <Icon name={copied === summary ? 'check' : 'copy'} size={17} />
          {copied === summary ? 'Copied' : 'Copy'}
        </button>
      </div>
      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((value) => !value)}
        className="mx-auto inline-flex h-11 items-center gap-1.5 px-2 text-[14px] text-muted hover:text-ink"
      >
        More ways to share{' '}
        <Icon name="chevron-down" size={15} className={cn(more && 'rotate-180')} />
      </button>
      {more && (
        <div className="grid animate-rise gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
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
  const faces = Math.min(count, 7);

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
        inputClassName="!h-16 !text-[28px] !rounded-[18px] !pl-9 lg:!h-16 lg:!text-[28px]"
      />

      <p className="label mt-6 mb-2.5">Between</p>
      <div className="flex items-center justify-between gap-2 rounded-[18px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <button
          type="button"
          aria-label="One fewer person"
          onClick={() => setCount(count - 1)}
          disabled={count <= 2}
          className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-well text-ink active:scale-[.95] disabled:opacity-30"
        >
          <Icon name="minus" size={20} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <span aria-hidden="true" className="flex -space-x-1.5">
            {Array.from({ length: faces }, (_, index) => (
              <Avatar
                key={index}
                index={index}
                name={nameOf(bill, index)}
                size={28}
                className="ring-2 ring-[var(--color-subtle)]"
              />
            ))}
            {count > faces && (
              <span className="grid size-7 place-items-center rounded-full bg-well text-[11px] font-bold text-ink-2 ring-2 ring-[var(--color-subtle)]">
                +{count - faces}
              </span>
            )}
          </span>
          <p className="text-center leading-none">
            <span className="num text-[22px] font-bold text-ink">{count}</span>{' '}
            <span className="text-[14px] text-muted">people</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="One more person"
          onClick={() => setCount(count + 1)}
          disabled={count >= 30}
          className="grid size-12 shrink-0 place-items-center rounded-[14px] bg-well text-ink active:scale-[.95] disabled:opacity-30"
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
                'h-12 rounded-[14px] text-[15px] font-semibold transition-[background-color,color,transform] active:scale-[.96]',
                on
                  ? 'text-[#12110d]'
                  : 'bg-well text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]',
              )}
              style={on ? { background: ACCENT } : undefined}
            >
              {value ? `${value}%` : 'None'}
            </button>
          );
        })}
      </div>

      <Paper edges="both" className="mt-6 px-5 py-7 text-center">
        <p className="mono-num text-[11px] tracking-[0.12em] uppercase opacity-60">
          Each person pays
        </p>
        <p
          className="num mt-1.5 font-display text-[50px] leading-none font-bold tracking-[-0.035em]"
          style={{ fontVariationSettings: "'wdth' 108" }}
          aria-live="polite"
        >
          {money(each)}
        </p>
        <p className="mt-2.5 text-[13px] opacity-65">
          {money(result.total)} total{result.tip > 0 && ` with ${money(result.tip)} tip`}
          {uneven && ' · a few cents go to some people so it adds up exactly'}
        </p>
      </Paper>
      {result.total > 0 && <ShareArea bill={bill} result={result} />}
      <div className="mt-4 flex justify-center">
        <TextLink icon="receipt-text" onClick={onItems}>
          Split by item instead
        </TextLink>
      </div>
    </div>
  );
}
