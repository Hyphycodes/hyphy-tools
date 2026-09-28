'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { checkReceipt } from '@/lib/tools/receipt';
import type { ReadProgress } from '@/lib/tools/receipt-reader';
import { newId } from '@/lib/share/link-state';
import { CURRENCIES, type SplitBill } from '@/lib/tools/split';
import { Note, SampleButton } from './kit';
import { MoneyInput } from './money-input';
import { Paper, ReceiptGhost } from './split-art';
import { PhotoButton, TextLink, Title, type Money, type Update } from './split-parts';

/*
 * The receipt, from nothing to checked: the empty slip you drop a photo on (or snap one), the
 * photo being read, then the receipt as it was read — every line editable where it's printed.
 */

export type Saved = {
  label: string;
  detail: string;
  onContinue: () => void;
  onDiscard: () => void;
};

/* ---------------- the empty receipt ---------------- */

export function Start({
  onPhoto,
  onSample,
  onManual,
  onEven,
  saved,
}: {
  onPhoto: (file: File) => void;
  onSample: () => void;
  onManual: () => void;
  onEven: () => void;
  saved: Saved | null;
}) {
  const id = useId();
  const [lit, setLit] = useState(false);
  const take = useRef(onPhoto);
  useEffect(() => {
    take.current = onPhoto;
  });

  // A photo dragged anywhere over the page lights the receipt up; a drop anywhere counts.
  useEffect(() => {
    let depth = 0;
    const files = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
    const enter = (event: DragEvent) => {
      if (!files(event)) return;
      depth += 1;
      setLit(true);
    };
    const leave = (event: DragEvent) => {
      if (!files(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setLit(false);
    };
    const over = (event: DragEvent) => {
      if (files(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!files(event)) return;
      event.preventDefault();
      depth = 0;
      setLit(false);
      const file = Array.from(event.dataTransfer?.files ?? []).find((entry) =>
        entry.type.startsWith('image/'),
      );
      if (file) take.current(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[440px] pt-1">
      {saved && (
        <div className="fx-rise mb-4 flex items-center gap-2 rounded-full bg-surface p-1.5 pl-4 shadow-card">
          <Icon name="receipt-text" size={17} className="shrink-0 text-[var(--accent-ink)]" />
          <p className="min-w-0 flex-1 truncate text-[14px] text-muted">
            <span className="font-semibold text-ink">{saved.label}</span> · {saved.detail}
          </p>
          <button
            type="button"
            onClick={saved.onContinue}
            className="h-10 shrink-0 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink"
          >
            Continue
          </button>
          <button
            type="button"
            aria-label="Discard the last bill"
            title="Discard the last bill"
            onClick={saved.onDiscard}
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/[.06] hover:text-ink"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <Paper
        edges="bottom"
        tooth={18}
        tint={lit ? 'var(--accent)' : undefined}
        outerClassName={cn('fx-move', lit && 'scale-[1.02] -rotate-[.6deg]')}
        className="px-6 pt-8 pb-12 text-center sm:px-10 sm:pt-11 sm:pb-14"
      >
        {/* The whole slip is the button: the camera on a phone, the file picker elsewhere. */}
        <label
          htmlFor={`${id}-camera`}
          aria-hidden="true"
          className="absolute inset-0 cursor-pointer [@media(pointer:fine)]:hidden"
        />
        <label
          htmlFor={`${id}-upload`}
          aria-hidden="true"
          className="absolute inset-0 hidden cursor-pointer [@media(pointer:fine)]:block"
        />
        <div className="pointer-events-none relative">
          <ReceiptGhost />
          <h2
            className="mt-7 font-display text-[32px] leading-none font-bold tracking-[-0.035em] text-balance sm:text-[40px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            <span className="hidden [@media(pointer:fine)]:inline">
              {lit ? 'Let go to read it' : 'Drop your receipt'}
            </span>
            <span className="[@media(pointer:fine)]:hidden">Got the check?</span>
          </h2>
        </div>
        <div className="relative mt-6 grid justify-items-center gap-1.5">
          <PhotoButton
            id={`${id}-camera`}
            label="Take a photo"
            icon="camera"
            capture
            variant="primary"
            onFile={onPhoto}
            className="w-full max-w-[300px] [@media(pointer:fine)]:hidden"
          />
          <PhotoButton
            id={`${id}-upload`}
            label="Upload a photo"
            icon="upload"
            variant="bare"
            onFile={onPhoto}
            className="h-11 px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/[.06] [@media(pointer:fine)]:h-14 [@media(pointer:fine)]:bg-[var(--accent)] [@media(pointer:fine)]:px-7 [@media(pointer:fine)]:text-[17px] [@media(pointer:fine)]:font-semibold [@media(pointer:fine)]:text-[var(--on-accent,#12110d)] [@media(pointer:fine)]:shadow-[0_14px_30px_-14px_var(--accent)] [@media(pointer:fine)]:hover:bg-[var(--accent)]"
          />
        </div>
      </Paper>

      <div className="mt-4 grid justify-items-center">
        <SampleButton onClick={onSample} className="!text-[15px]">
          Try a sample receipt
        </SampleButton>
        <div className="flex flex-wrap justify-center">
          <TextLink icon="pencil" onClick={onManual} className="!text-[14.5px] !text-muted">
            Type it in instead
          </TextLink>
          <TextLink icon="people" onClick={onEven} className="!text-[14.5px] !text-muted">
            Split evenly instead
          </TextLink>
        </div>
      </div>
    </div>
  );
}

/* ---------------- reading the photo ---------------- */

export type Reading = {
  photo: string;
  progress: ReadProgress;
  error?: string;
};

export function ReadingView({
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
        ? 'Getting the reader ready…'
        : `Reading the receipt… ${percent}%`;
  // The light sweeps down the photo as the reading gets further, once.
  const scan = stage === 'reading' ? 6 + percent * 0.88 : stage === 'loading' ? 4 : 2;
  return (
    <div className="mx-auto grid w-full max-w-[440px] gap-5 pt-1">
      <Paper edges="bottom" tooth={18} className="p-3 pb-7">
        <div className="relative overflow-hidden rounded-[6px] bg-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local photo, never optimized */}
          <img
            src={reading.photo}
            alt="Your receipt"
            className="max-h-[52vh] w-full object-contain"
          />
          {!reading.error && (
            <span
              aria-hidden="true"
              className="absolute inset-x-0 h-16 -translate-y-1/2 transition-[top] duration-500 ease-out"
              style={{
                top: `${scan}%`,
                background:
                  'linear-gradient(transparent, color-mix(in srgb, var(--accent) 55%, transparent) 50%, transparent)',
              }}
            />
          )}
        </div>
      </Paper>
      {reading.error ? (
        <div className="grid gap-3">
          <Note tone="caution" icon="alert">
            {reading.error}
          </Note>
          <PhotoButton label="Try another photo" icon="camera" variant="primary" onFile={onRetry} />
          <div className="flex justify-center">
            <TextLink icon="pencil" onClick={onManual}>
              Type it in instead
            </TextLink>
          </div>
        </div>
      ) : (
        <div className="grid justify-items-center gap-1" role="status" aria-live="polite">
          <p className="text-[16px] font-semibold text-ink">{status}</p>
          <TextLink onClick={onCancel} className="!text-[14px] !text-muted">
            Cancel
          </TextLink>
        </div>
      )}
    </div>
  );
}

/* ---------------- the receipt, as read ---------------- */

/** Money fields printed on the paper instead of sitting in a box. */
const onPaper = {
  className: '[&>span]:!text-current [&>span]:opacity-40',
  input:
    '!bg-transparent !text-current !shadow-none !rounded-[8px] !font-mono !text-[15px] placeholder:!text-current placeholder:opacity-30 focus:!bg-ink/[.07] lg:!h-11',
};

export function ReviewView({
  bill,
  update,
  money,
  photo,
  sample,
  unsure,
  onSeen,
  onRetake,
}: {
  bill: SplitBill;
  update: Update;
  money: Money;
  photo: string | null;
  sample: boolean;
  unsure: Set<string>;
  onSeen: (itemId: string) => void;
  onRetake: (file: File) => void;
}) {
  const id = useId();
  const read = Boolean(bill.receipt);
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [adding, setAdding] = useState(!read);
  const [showPhoto, setShowPhoto] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
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
  const tax =
    bill.tax.mode === 'amount'
      ? bill.tax.value
      : Math.round((check.itemsTotal * bill.tax.value) / 100);

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
            ? 'A made-up dinner. Tap any line to change it.'
            : read
              ? bill.items.length
                ? 'Tap any line to fix it.'
                : 'No prices on that photo. Add the lines yourself, or try a flatter photo.'
              : 'A name, a price, Enter. Next line.'
        }
      >
        {read ? 'Check the receipt' : 'What’s on the check?'}
      </Title>

      {photo && (
        <div className="mb-4 flex items-center gap-2 px-1">
          <button
            type="button"
            onClick={() => setShowPhoto((value) => !value)}
            className="flex items-center gap-2.5 rounded-full bg-ink/[.06] p-1 pr-4 text-[14px] font-medium text-ink-2 hover:text-ink"
            aria-expanded={showPhoto}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local photo */}
            <img src={photo} alt="" className="size-9 rounded-full object-cover" />
            {showPhoto ? 'Hide photo' : 'Compare with photo'}
          </button>
          <label className="relative ml-auto inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[14px] text-muted hover:bg-ink/[.06] hover:text-ink">
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
          className="fx-rise mb-4 max-h-[60vh] w-full rounded-[14px] bg-ink object-contain"
        />
      )}

      {unsure.size > 0 && (
        <Note tone="caution" icon="alert" className="mb-3">
          {unsure.size === 1 ? 'One line was' : `${unsure.size} lines were`} hard to read. Give{' '}
          {unsure.size === 1 ? 'it' : 'them'} a look.
        </Note>
      )}

      <Paper edges="both" className="fx-settle px-3 pt-7 pb-8 sm:px-6">
        <input
          aria-label="Where was this?"
          placeholder="Where was this?"
          value={bill.title}
          maxLength={80}
          onChange={(event) => update({ title: event.target.value })}
          className="h-11 w-full rounded-[8px] bg-transparent px-2 text-center font-display text-[20px] font-bold tracking-[-0.01em] uppercase outline-none placeholder:font-sans placeholder:text-[16px] placeholder:font-normal placeholder:tracking-normal placeholder:normal-case placeholder:opacity-45 focus:bg-ink/[.06]"
          style={{ fontVariationSettings: "'wdth' 100" }}
        />
        <p className="mono-num mb-2 flex items-center justify-center gap-1 text-[10.5px] tracking-[0.12em] uppercase">
          <span className="opacity-50">
            {bill.items.length} {bill.items.length === 1 ? 'item' : 'items'} ·
          </span>
          <select
            aria-label="Currency"
            value={bill.currency}
            onChange={(event) => update({ currency: event.target.value })}
            className="h-7 cursor-pointer rounded-[6px] bg-transparent px-1 tracking-[0.12em] uppercase opacity-60 outline-none hover:bg-ink/[.06] hover:opacity-100 focus:bg-ink/[.06]"
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </p>
        <div className="mb-1 border-t-2 border-dashed border-current/20" />

        <ul className="grid grid-cols-1" aria-label="Items">
          {bill.items.map((item, index) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-0.5 border-b border-dashed border-current/15 py-0.5',
                unsure.has(item.id) && '-mx-1.5 rounded-[10px] bg-[#ffd666]/55 px-1.5',
              )}
            >
              {item.qty && item.qty > 1 && (
                <span className="mono-num shrink-0 pl-1.5 text-[12.5px] font-semibold opacity-55">
                  {item.qty}×
                </span>
              )}
              <input
                aria-label={`Item ${index + 1}`}
                value={item.name}
                placeholder="What was it?"
                maxLength={80}
                onChange={(event) => edit(item.id, { name: event.target.value })}
                className="h-11 min-w-0 flex-1 rounded-[8px] bg-transparent px-1.5 text-[16px] font-medium outline-none placeholder:opacity-35 focus:bg-ink/[.06]"
              />
              <MoneyInput
                value={item.price}
                currency={bill.currency}
                label={`Item ${index + 1}’s price`}
                onChange={(cents) => edit(item.id, { price: cents })}
                className={cn('w-[104px] shrink-0', onPaper.className)}
                inputClassName={cn(onPaper.input, 'font-semibold')}
              />
              <button
                type="button"
                aria-label={`Remove ${item.name || `item ${index + 1}`}`}
                title="Remove"
                onClick={() =>
                  update({ items: bill.items.filter((entry) => entry.id !== item.id) })
                }
                className="grid size-9 shrink-0 place-items-center rounded-full opacity-30 transition-opacity hover:bg-ink/[.07] hover:opacity-90"
              >
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>

        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
            className="fx-rise mt-2.5 flex items-center gap-1 rounded-[12px] border-[1.5px] border-dashed border-current/25 p-1 pl-1.5"
          >
            <input
              ref={nameInput}
              aria-label="New item"
              placeholder={bill.items.length ? 'Add a line' : 'First line, like Pizza'}
              value={name}
              maxLength={80}
              enterKeyHint="next"
              autoComplete="off"
              autoFocus={bill.items.length === 0 || read}
              onChange={(event) => setName(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-[8px] bg-transparent px-1.5 text-[16px] outline-none placeholder:opacity-45 focus:bg-ink/[.06]"
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
              className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-ink text-on-ink transition-opacity disabled:opacity-20"
            >
              <Icon name="plus" size={18} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 flex h-11 w-full items-center gap-2 rounded-[10px] px-1.5 text-[15px] opacity-55 transition-opacity hover:bg-ink/[.05] hover:opacity-90"
          >
            <Icon name="plus" size={16} /> Add a missing line
          </button>
        )}

        <dl className="mt-4 grid gap-0.5 border-t-2 border-dashed border-current/20 pt-3 text-[15px]">
          <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
            <dt className="opacity-60">Subtotal</dt>
            <dd className="mono-num font-semibold">{money(check.itemsTotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 pl-1.5">
            <dt>
              <label htmlFor={`${id}-tax`} className="opacity-60">
                Tax
              </label>
            </dt>
            <dd>
              <MoneyInput
                id={`${id}-tax`}
                value={tax}
                currency={bill.currency}
                label="Tax"
                onChange={(cents) => update({ tax: { mode: 'amount', value: cents } })}
                className={cn('w-[118px]', onPaper.className)}
                inputClassName={cn(onPaper.input, '!pr-1.5')}
              />
            </dd>
          </div>
          {bill.tip.mode === 'amount' && bill.tip.value > 0 && read && (
            <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
              <dt className="opacity-60">Tip on the receipt</dt>
              <dd className="mono-num">{money(bill.tip.value)}</dd>
            </div>
          )}
          {bill.receipt?.total != null && (
            <div className="flex min-h-9 items-center justify-between gap-3 px-1.5">
              <dt className="opacity-60">Total on the receipt</dt>
              <dd className="mono-num">{money(bill.receipt.total)}</dd>
            </div>
          )}
        </dl>
      </Paper>

      {read && bill.items.length > 0 && check.subtotalGap !== 0 && (
        <Note tone="caution" icon="alert" className="mt-4">
          The lines add up to {money(check.itemsTotal)}; the receipt says{' '}
          {money(bill.receipt?.subtotal ?? 0)}.{' '}
          {check.subtotalGap > 0 ? 'A line may be missing.' : 'A line may be counted twice.'}
        </Note>
      )}
      {read && bill.items.length > 0 && check.subtotalGap === 0 && check.totalGap !== 0 && (
        <Note tone="caution" icon="alert" className="mt-4">
          Lines, tax and tip come to {money(bill.receipt!.total! - check.totalGap)}; the receipt’s
          total is {money(bill.receipt!.total!)}. Worth a look.
        </Note>
      )}
    </div>
  );
}

/** "6 items · $77.85": what the receipt comes to before the tip you pick. */
export function receiptSummary(bill: SplitBill, money: Money) {
  const items = bill.items.reduce((sum, item) => sum + item.price, 0);
  const tax =
    bill.tax.mode === 'amount' ? bill.tax.value : Math.round((items * bill.tax.value) / 100);
  const printedTip = bill.tip.mode === 'amount' ? bill.tip.value : 0;
  const lines = bill.items.length;
  return `${lines} ${lines === 1 ? 'item' : 'items'} · ${money(items + tax + printedTip)}`;
}
