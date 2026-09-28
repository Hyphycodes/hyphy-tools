'use client';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { linkFor, newId } from '@/lib/share/link-state';
import { splitSummary, type SplitBill } from '@/lib/tools/split';
import { Advanced, CountUp, useCopy } from './kit';
import { MoneyInput } from './money-input';
import { ShareLinkCard } from './share-link';
import { Avatar, colorOf, Paper } from './split-art';
import {
  ACCENT,
  nameOf,
  PercentInput,
  TextLink,
  TIPS,
  Title,
  Toggle,
  type Money,
  type Result as SplitResult,
  type Update,
} from './split-parts';

/*
 * The end of the bill: the tip, picked with a thumb; then the payoff, where the receipt resolves
 * into everyone's own slip of paper, in their color, with what they owe. And the shortcut for
 * when a total just needs dividing.
 */

const order = (index: number) => ({ '--i': index }) as CSSProperties;

/* ---------------- the tip ---------------- */

function TipChip({
  on,
  onClick,
  title,
  detail,
  size = 'lg',
}: {
  on: boolean;
  onClick?: () => void;
  title: ReactNode;
  detail?: ReactNode;
  size?: 'lg' | 'sm';
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'fx-move flex items-center justify-center rounded-[20px] px-2 active:scale-[.96]',
        size === 'lg' ? 'min-h-[78px] flex-col' : 'min-h-12 gap-2',
        on
          ? 'text-[var(--on-accent,#12110d)] shadow-[0_12px_26px_-14px_var(--accent,transparent)]'
          : 'bg-surface text-ink shadow-card hover:bg-ink/[.04]',
      )}
      style={on ? { background: ACCENT } : undefined}
    >
      <span
        className={cn(
          'font-display leading-tight font-bold tracking-[-0.02em]',
          size === 'lg' ? 'text-[24px]' : 'text-[16px]',
        )}
      >
        {title}
      </span>
      {detail && (
        <span
          className={cn(
            'mono-num text-[12px]',
            on ? 'text-[var(--on-accent,#12110d)]/70' : 'text-muted',
          )}
        >
          {detail}
        </span>
      )}
    </button>
  );
}

/** 15 · 18 · 20, big; no tip or your own, smaller. A printed tip is simply kept. */
function TipPicker({
  bill,
  update,
  base,
  money,
  tip,
  printed = false,
}: {
  bill: SplitBill;
  update: Update;
  /** What a percentage is taken of. */
  base: number;
  money: Money;
  /** The tip as it stands, in money. */
  tip: number;
  printed?: boolean;
}) {
  const preset =
    bill.tip.mode === 'percent' && (bill.tip.value === 0 || TIPS.includes(bill.tip.value));
  const [custom, setCustom] = useState(!preset && !printed);
  const pick = (value: number) => {
    setCustom(false);
    update({ tip: { ...bill.tip, mode: 'percent', value } });
  };
  return (
    <div>
      {printed ? (
        <div className="grid" role="group" aria-label="Tip">
          <TipChip on title="On the receipt" detail={money(bill.tip.value)} />
        </div>
      ) : (
        <div className="grid gap-2" role="group" aria-label="Tip">
          <div className="grid grid-cols-3 gap-2">
            {TIPS.map((value) => (
              <TipChip
                key={value}
                on={!custom && bill.tip.mode === 'percent' && bill.tip.value === value}
                onClick={() => pick(value)}
                title={`${value}%`}
                detail={money(Math.round((base * value) / 100))}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TipChip
              size="sm"
              on={!custom && bill.tip.mode === 'percent' && bill.tip.value === 0}
              onClick={() => pick(0)}
              title="No tip"
            />
            <TipChip
              size="sm"
              on={custom}
              onClick={() => setCustom(true)}
              title="Custom"
              detail={custom ? money(tip) : undefined}
            />
          </div>
        </div>
      )}
      {(custom || printed) && (
        <div className="fx-rise mt-2 flex items-center justify-between gap-2 rounded-[18px] bg-surface p-2 pl-4 shadow-card">
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
                inputClassName="!bg-surface"
              />
            )}
            <Toggle
              label="Tip as"
              value={bill.tip.mode === 'amount' ? '$' : '%'}
              onChange={(value) =>
                update({
                  tip:
                    value === '$'
                      ? { ...bill.tip, mode: 'amount', value: tip }
                      : {
                          ...bill.tip,
                          mode: 'percent',
                          value: base ? Math.round((tip / base) * 100) : 0,
                        },
                })
              }
            />
          </span>
        </div>
      )}
    </div>
  );
}

/** Money fields printed on the paper. */
const onPaper = {
  className: '[&>span]:!text-current [&>span]:opacity-40',
  input:
    '!bg-transparent !text-current !shadow-none !rounded-[8px] !font-mono !text-[15px] placeholder:!text-current placeholder:opacity-30 focus:!bg-ink/[.07] lg:!h-11',
};

export function TipView({
  bill,
  result,
  money,
  update,
}: {
  bill: SplitBill;
  result: SplitResult;
  money: Money;
  update: Update;
}) {
  const printed = bill.tip.mode === 'amount' && Boolean(bill.receipt) && bill.tip.value > 0;
  const base = bill.tip.afterTax ? result.subtotal + result.tax : result.subtotal;
  const tipNote =
    bill.tip.mode === 'percent' ? (bill.tip.value ? `${bill.tip.value}%` : 'none') : '';

  return (
    <div>
      <Title>Tax and tip</Title>

      <Paper edges="both" className="px-4 pt-7 pb-8 sm:px-6">
        {bill.title.trim() && (
          <p className="mb-3 text-center font-display text-[17px] font-bold tracking-[-0.01em] uppercase opacity-80">
            {bill.title}
          </p>
        )}
        <dl className="grid gap-0.5 text-[15px]">
          <div className="flex min-h-10 items-center justify-between gap-3 px-1.5">
            <dt className="opacity-60">Items</dt>
            <dd className="mono-num">{money(result.subtotal)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 pl-1.5">
            <dt className="opacity-60">Tax</dt>
            <dd>
              {bill.tax.mode === 'amount' ? (
                <MoneyInput
                  value={bill.tax.value}
                  currency={bill.currency}
                  label="Tax"
                  onChange={(cents) => update({ tax: { mode: 'amount', value: cents } })}
                  className={cn('w-[118px]', onPaper.className)}
                  inputClassName={cn(onPaper.input, '!pr-1.5')}
                />
              ) : (
                <PercentInput
                  label="Tax rate"
                  value={bill.tax.value}
                  onChange={(value) => update({ tax: { mode: 'percent', value } })}
                />
              )}
            </dd>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-3 px-1.5">
            <dt className="opacity-60">
              Tip{tipNote && <span className="mono-num ml-1.5 text-[12.5px]">{tipNote}</span>}
            </dt>
            <dd key={result.tip} className="mono-num fx-pop">
              {money(result.tip)}
            </dd>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-dashed border-current/20 px-1.5 pt-3">
            <dt className="font-semibold">Total</dt>
            <dd
              className="font-display text-[30px] leading-none font-bold tracking-[-0.03em]"
              style={{ fontVariationSettings: "'wdth' 106" }}
            >
              <CountUp
                value={result.total}
                from={result.total}
                duration={320}
                format={(n) => money(Math.round(n))}
                mono={false}
              />
            </dd>
          </div>
        </dl>
      </Paper>

      <p className="label mt-6 mb-2.5 px-1">Tip</p>
      <TipPicker
        bill={bill}
        update={update}
        base={base}
        money={money}
        tip={result.tip}
        printed={printed}
      />

      <Advanced className="mt-4 px-1">
        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-3 text-[14.5px] text-ink-2">
            Tax as
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
          {bill.tip.mode === 'percent' && bill.tip.value > 0 && (
            <label className="flex min-h-11 items-center justify-between gap-3 text-[14.5px] text-ink-2">
              Tip on the total with tax
              <input
                type="checkbox"
                checked={bill.tip.afterTax}
                onChange={(event) =>
                  update({ tip: { ...bill.tip, afterTax: event.target.checked } })
                }
                className="size-5 accent-[var(--accent-ink)]"
              />
            </label>
          )}
        </div>
      </Advanced>
    </div>
  );
}

/* ---------------- the payoff: everyone's slip ---------------- */

export function Result({
  bill,
  result,
  money,
  celebrate,
}: {
  bill: SplitBill;
  result: SplitResult;
  money: Money;
  celebrate?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const format = (n: number) => money(Math.round(n));
  return (
    <section aria-label="Totals">
      {/* What's left of the receipt: where, and what it all came to. */}
      <Paper
        edges="bottom"
        tooth={12}
        outerClassName="fx-settle"
        className="px-5 pt-6 pb-8 text-center"
      >
        <p className="mono-num text-[11px] tracking-[0.14em] uppercase opacity-60">
          {bill.title.trim() || 'The bill'}
        </p>
        <p
          className="mt-2 font-display text-[46px] leading-none font-bold tracking-[-0.035em] sm:text-[56px]"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          <CountUp value={result.total} format={format} mono={false} />
        </p>
        <p className="mt-2 text-[13px] opacity-60">
          {money(result.subtotal)} {bill.mode === 'items' ? 'in items' : 'bill'}
          {result.tax > 0 && ` · ${money(result.tax)} tax`}
          {result.tip > 0 && ` · ${money(result.tip)} tip`}
        </p>
      </Paper>

      {celebrate && (
        <p className="fx-pop mt-5 flex items-center justify-center gap-1.5 text-[15px] font-semibold text-[var(--accent-ink)] [animation-delay:200ms]">
          <Icon name="check" size={17} strokeWidth={2.8} />
          Split {result.people.length} ways, exact to the cent
        </p>
      )}

      <ul className="mt-4 grid grid-cols-1 gap-3">
        {result.people.map((person, index) => {
          const expanded = open === person.id;
          const color = colorOf(index);
          const name = nameOf(bill, index);
          return (
            <li key={person.id} className="fx-settle" style={order(Math.min(index, 8) + 3)}>
              <Paper edges="both" tooth={12} tint={color}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : person.id)}
                  className="flex w-full items-center gap-3.5 px-4 pt-6 pb-5 text-left sm:px-5"
                >
                  <Avatar index={index} name={name} size={50} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[20px] leading-tight font-bold">
                      {name}
                    </span>
                    <span className="flex items-center gap-1 text-[12.5px] opacity-60">
                      {bill.mode === 'items'
                        ? `${person.items.length} ${person.items.length === 1 ? 'item' : 'items'}`
                        : 'Equal share'}
                      <Icon
                        name="chevron-down"
                        size={13}
                        className={cn('fx-move', expanded && 'rotate-180')}
                      />
                    </span>
                  </span>
                  <span
                    className="shrink-0 font-display text-[34px] leading-none font-bold tracking-[-0.03em]"
                    style={{ fontVariationSettings: "'wdth' 106" }}
                  >
                    <CountUp value={person.total} format={format} duration={800} mono={false} />
                  </span>
                </button>
                {expanded && (
                  <dl className="fx-rise mx-4 grid gap-1.5 border-t border-dashed border-current/25 pt-3 pb-6 text-[14px] sm:mx-5">
                    {person.items.map((item) => (
                      <div key={item.id} className="flex justify-between gap-3">
                        <dt className="min-w-0 truncate">
                          {item.name || 'Item'}
                          {item.split > 1 && (
                            <span className="opacity-55"> · shared by {item.split}</span>
                          )}
                        </dt>
                        <dd className="mono-num">{money(item.share)}</dd>
                      </div>
                    ))}
                    {bill.mode === 'even' && (
                      <div className="flex justify-between gap-3">
                        <dt>Their share of the bill</dt>
                        <dd className="mono-num">{money(person.subtotal)}</dd>
                      </div>
                    )}
                    {person.tax > 0 && (
                      <div className="flex justify-between gap-3 opacity-65">
                        <dt>Tax</dt>
                        <dd className="mono-num">{money(person.tax)}</dd>
                      </div>
                    )}
                    {person.tip > 0 && (
                      <div className="flex justify-between gap-3 opacity-65">
                        <dt>Tip</dt>
                        <dd className="mono-num">{money(person.tip)}</dd>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between gap-3 border-t border-current/15 pt-2 font-semibold">
                      <dt>Total</dt>
                      <dd className="mono-num">{money(person.total)}</dd>
                    </div>
                  </dl>
                )}
              </Paper>
            </li>
          );
        })}
      </ul>
      {bill.mode === 'items' && (result.tax > 0 || result.tip > 0) && (
        <p className="mt-3 text-center text-[12.5px] text-muted">
          Tax and tip follow what each person ordered. Tap a name for the math.
        </p>
      )}
    </section>
  );
}

/** Sending it: the phone's share sheet first, the words to paste, or a link to the bill. */
export function ShareArea({ bill, result }: { bill: SplitBill; result: SplitResult }) {
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
    await copy(`${summary}\n${url}`, 'Copied. Paste it in the group chat');
  };
  return (
    <div className="mt-6 grid gap-2">
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={share}
          className="flex h-16 items-center justify-center gap-2.5 rounded-[20px] text-[18px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_16px_34px_-16px_var(--accent,transparent)] active:scale-[.98]"
          style={{ background: ACCENT }}
        >
          <Icon name="share" size={20} /> Share totals
        </button>
        <button
          type="button"
          onClick={() => copy(summary, 'Totals copied')}
          aria-label="Copy the totals as text"
          className="inline-flex h-16 items-center justify-center gap-2 rounded-[20px] bg-surface px-5 text-[15.5px] font-semibold text-ink shadow-card hover:bg-ink/[.04] active:scale-[.98]"
        >
          <Icon name={copied === summary ? 'check' : 'copy'} size={18} />
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
        <Icon name="chevron-down" size={15} className={cn('fx-move', more && 'rotate-180')} />
      </button>
      {more && (
        <div className="fx-rise grid gap-3 rounded-[20px] bg-surface p-4 shadow-card">
          <ShareLinkCard
            build={() => linkFor(bill)}
            title={bill.title.trim() || 'The bill'}
            cta="Share the bill as a link"
          >
            <p className="text-[13px] text-muted">
              Anyone with the link sees their total. They can’t change it.
            </p>
          </ShareLinkCard>
        </div>
      )}
    </div>
  );
}

/* ---------------- evenly ---------------- */

export function EvenView({
  bill,
  result,
  money,
  update,
  onBack,
  onItems,
}: {
  bill: SplitBill;
  result: SplitResult;
  money: Money;
  update: Update;
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
  const base = bill.tip.afterTax ? result.subtotal + result.tax : result.subtotal;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          aria-label="Back"
          title="Back"
          onClick={onBack}
          className="grid size-11 place-items-center rounded-full bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <span className="text-[14px] font-semibold text-ink-2">Split evenly</span>
      </div>
      <Title>How much was it?</Title>
      <MoneyInput
        value={bill.total}
        currency={bill.currency}
        label="Bill total"
        autoFocus={!bill.total}
        onChange={(cents) => update({ total: cents })}
        inputClassName="!h-[72px] !text-[32px] !rounded-[20px] !pl-10 !bg-surface !font-display font-bold lg:!h-[72px] lg:!text-[32px]"
      />

      <p className="label mt-6 mb-2.5 px-1">Between</p>
      <div className="flex items-center justify-between gap-2 rounded-[20px] bg-surface p-2 shadow-card">
        <button
          type="button"
          aria-label="One fewer person"
          onClick={() => setCount(count - 1)}
          disabled={count <= 2}
          className="grid size-14 shrink-0 place-items-center rounded-[16px] bg-ink/[.06] text-ink active:scale-[.94] disabled:opacity-30"
        >
          <Icon name="minus" size={22} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-1.5">
          <span aria-hidden="true" className="flex -space-x-2">
            {Array.from({ length: faces }, (_, index) => (
              <Avatar
                key={bill.people[index]?.id ?? index}
                index={index}
                name={nameOf(bill, index)}
                size={32}
                className="fx-pop ring-2 ring-[var(--color-surface)]"
              />
            ))}
            {count > faces && (
              <span className="grid size-8 place-items-center rounded-full bg-well text-[11px] font-bold text-ink-2 ring-2 ring-[var(--color-surface)]">
                +{count - faces}
              </span>
            )}
          </span>
          <p className="text-center leading-none">
            <span className="mono-num text-[20px] font-bold text-ink">{count}</span>{' '}
            <span className="text-[14px] text-muted">people</span>
          </p>
        </div>
        <button
          type="button"
          aria-label="One more person"
          onClick={() => setCount(count + 1)}
          disabled={count >= 30}
          className="grid size-14 shrink-0 place-items-center rounded-[16px] bg-ink/[.06] text-ink active:scale-[.94] disabled:opacity-30"
        >
          <Icon name="plus" size={22} />
        </button>
      </div>

      <p className="label mt-6 mb-2.5 px-1">Tip</p>
      <TipPicker bill={bill} update={update} base={base} money={money} tip={result.tip} />

      <Paper edges="both" outerClassName="mt-6" className="px-5 pt-8 pb-9 text-center">
        <p className="mono-num text-[11px] tracking-[0.14em] uppercase opacity-60">
          Each person pays
        </p>
        <p
          className="mt-2 font-display text-[56px] leading-none font-bold tracking-[-0.035em]"
          style={{ fontVariationSettings: "'wdth' 108" }}
          aria-live="polite"
        >
          {money(each)}
        </p>
        <p className="mt-3 text-[13px] opacity-60">
          {money(result.total)} total{result.tip > 0 && ` with ${money(result.tip)} tip`}
          {uneven && ' · a few people pay a cent more so it adds up'}
        </p>
      </Paper>
      {result.total > 0 && <ShareArea bill={bill} result={result} />}
      <div className="mt-4 flex justify-center">
        <TextLink icon="receipt-text" onClick={onItems} className="!text-muted">
          Split by item instead
        </TextLink>
      </div>
    </div>
  );
}
