'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon } from '@/components/ui/icon';
import type { ParsedReceipt } from '@/lib/tools/receipt';
import { receiptReader } from '@/lib/tools/receipt-reader';
import { decodeState, clearHash, linkFor, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  computeSplit,
  formatMoney,
  localCurrency,
  newBill,
  splitBillSchema,
  type SplitBill,
} from '@/lib/tools/split';
import { IconButton, Journey, Note } from './kit';
import { PlanReturn } from './plan-return';
import { NextBar, TextLink } from './split-parts';
import { AssignView, PeopleView, rememberNames } from './split-people';
import {
  ReadingView,
  receiptSummary,
  ReviewView,
  Start,
  type Reading,
  type Saved,
} from './split-receipt';
import { EvenView, Result, ShareArea, TipView } from './split-result';

/*
 * Split, receipt first. The receipt is the interface: drop or snap it, fix what the reader got
 * wrong right on the paper, say who's at the table, then paint each line with the person who had
 * it. Pick a tip with a thumb, and the receipt resolves into everyone's own total, exact to the
 * cent. Typing the lines in, or just dividing a total evenly, are always one tap away.
 *
 * Each step has its own address (`?step=people`), so the phone's back gesture steps back through
 * the check instead of leaving it. The bill is kept in this browser; sharing puts a read-only
 * copy inside a link.
 *
 * The parts: split-receipt (the slip, the reading, the checked receipt), split-people (the table
 * and the highlighter), split-result (tip, payoff, sharing, evenly), split-art (paper and faces).
 */

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

/* ---------------- the tool ---------------- */

export function SplitTool() {
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
                'We couldn’t read that one. Try again with the whole receipt flat and in focus, or type it in.',
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
      <Column>
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
      </Column>
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
    <>
      {current !== 'done' && (
        <PlanReturn tool="split" ready={false} attachment={() => null} className="mb-4" />
      )}
      <div className="mb-5 flex items-start gap-3">
        <IconButton
          icon="arrow-left"
          label="Back"
          onClick={() => back(previous(current))}
          className="!size-11 !rounded-full bg-ink/[.06] !text-ink-2"
        />
        <Journey
          className="flex-1 pt-1"
          steps={FLOW.map((entry) => entry.label)}
          current={FLOW.findIndex((entry) => entry.step === current)}
          onPick={(index) => FLOW[index].step !== current && go(FLOW[index].step)}
          reachable={(index) => reachable(FLOW[index].step)}
        />
      </div>
    </>
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
      <Column>
        <ReadingView
          reading={reading}
          onCancel={cancelReading}
          onRetry={(file) => void read(file)}
          onManual={() => {
            cancelReading();
            startManual();
          }}
        />
      </Column>
    );

  if (shown === 'start') {
    const saved: Saved | null =
      loaded && (hasItems || (bill.mode === 'even' && bill.total > 0))
        ? {
            label: bill.title.trim() || (bill.mode === 'even' ? 'Split evenly' : 'Your last bill'),
            detail:
              bill.mode === 'even'
                ? `${money(result.total)} between ${bill.people.length}`
                : `${bill.items.length} ${bill.items.length === 1 ? 'item' : 'items'} · ${money(result.total)}`,
            onContinue: () => go(bill.mode === 'even' ? 'even' : 'done'),
            onDiscard: startOver,
          }
        : null;
    return (
      <Start
        onPhoto={(file) => void read(file)}
        onSample={startSample}
        onManual={startManual}
        onEven={startEven}
        saved={saved}
      />
    );
  }

  if (shown === 'even')
    return (
      <Column>
        <EvenView
          bill={bill}
          result={result}
          money={money}
          update={update}
          onBack={() => back('start')}
          onItems={startManual}
        />
      </Column>
    );

  if (shown === 'receipt')
    return (
      <Column>
        {bar('receipt')}
        <ReviewView
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
          label="Looks right. Who’s splitting?"
          hint={!hasItems ? 'Add at least one line with a price.' : undefined}
          aside={
            hasItems ? (
              <p className="mb-2.5 text-center">
                <span className="mono-num inline-flex h-8 items-center rounded-full bg-ink px-3.5 text-[13.5px] font-semibold text-on-ink">
                  {receiptSummary(bill, money)}
                </span>
              </p>
            ) : undefined
          }
        >
          <Icon name="check" size={19} strokeWidth={2.6} /> Looks right
        </NextBar>
      </Column>
    );

  if (shown === 'people')
    return (
      <Column>
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
      </Column>
    );

  if (shown === 'items')
    return (
      <Column>
        {bar('items')}
        <AssignView
          bill={bill}
          update={update}
          money={money}
          result={result}
          onNext={() => go('tip')}
        />
      </Column>
    );

  if (shown === 'tip')
    return (
      <Column>
        {bar('tip')}
        <TipView bill={bill} result={result} money={money} update={update} />
        <NextBar onClick={() => go('done')}>
          See the split <Icon name="arrow-right" size={18} />
        </NextBar>
      </Column>
    );

  return (
    <Column>
      {bar('done')}
      <PlanReturn
        tool="split"
        className="mb-4"
        ready={result.total > 0}
        attachment={async () =>
          result.total > 0
            ? {
                url: await linkFor(bill),
                summary: `${money(result.total)} · ${result.people.length} ${result.people.length === 1 ? 'person' : 'people'}`,
                t: Date.now(),
              }
            : null
        }
      />
      <Result bill={bill} result={result} money={money} celebrate />
      <ShareArea bill={bill} result={result} />
      <div className="mt-6 flex flex-wrap justify-center gap-1 border-t border-line pt-4">
        <TextLink icon="pencil" onClick={() => go('receipt')}>
          Edit items
        </TextLink>
        <TextLink icon="plus" onClick={startOver}>
          New bill
        </TextLink>
      </div>
    </Column>
  );
}

/** One calm column on the table, even on a wide screen: the receipt is the width of a receipt. */
function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[520px] pt-1 pb-4">{children}</div>;
}
