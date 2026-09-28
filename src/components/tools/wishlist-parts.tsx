'use client';
import {
  useCallback,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import type { Claim } from '@/lib/tools/claims';
import { formatMoney, minorUnits } from '@/lib/tools/split';
import {
  checkDraft,
  domainOf,
  EMPTY_DRAFT,
  isWebUrl,
  readUrl,
  splitWish,
  WANT_NAMES,
  WANTS,
  type Want,
  type Wish,
  type WishDraft,
  type WishItem,
} from '@/lib/tools/wishlist';
import { IconButton, Label, MoreOptions, Surface, useCopy } from './kit';
import { MoneyInput } from './money-input';
import { LinkQr } from './share-link';

/*
 * Christmas List's pieces: the parchment, the gift tags, the one field wishes go into, and the
 * ways a link goes out. Pine, cranberry, parchment and a little gold.
 */

export const GOLD = 'var(--glow, #c9a24c)';
/** Gold dark enough to read as text on parchment. */
export const GOLD_INK = 'color-mix(in oklab, var(--glow, #c9a24c) 52%, var(--color-ink, #16271f))';
export const PINE = 'var(--third, #2d5a43)';
export const CRANBERRY = 'var(--accent-ink, #a3202f)';

export const tint = (color: string, amount: number) =>
  `color-mix(in srgb, ${color} ${amount}%, transparent)`;

export const WANT_LOOK: Record<Want, { icon: IconName; edge: string; ink: string }> = {
  love: { icon: 'heart', edge: 'var(--accent, #ff5e57)', ink: CRANBERRY },
  like: { icon: 'star', edge: GOLD, ink: GOLD_INK },
  nice: { icon: 'circle', edge: PINE, ink: PINE },
};

export const nameOf = (item: Pick<WishItem, 'name'> | undefined) => item?.name.trim() || 'A wish';

export function joinNames(names: string[]) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/* ---------------- sending ---------------- */

const noop = () => () => {};
export function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => 'share' in navigator,
    () => false,
  );
}

export type SendResult = 'shared' | 'copied' | 'failed' | null;

/** The phone's share sheet where there is one, the clipboard where there isn't. */
export function useSendLink() {
  const canShare = useCanShare();
  return useCallback(
    async (link: string, title: string): Promise<SendResult> => {
      if (canShare) {
        try {
          await navigator.share({ title, url: link });
          return 'shared';
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return null;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        return 'copied';
      } catch {
        return 'failed';
      }
    },
    [canShare],
  );
}

/* ---------------- the parchment ---------------- */

/** A thin band of cranberry and gold along the top of the paper. */
export function Ribbon() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0">
      <div className="h-[5px]" style={{ background: 'var(--accent, #ff5e57)' }} />
      <div className="h-px opacity-80" style={{ background: GOLD }} />
    </div>
  );
}

/** The list's paper: parchment with a ribbon along the top. */
export function Parchment({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        'relative isolate min-w-0 overflow-clip rounded-[26px] bg-surface px-4 pt-9 pb-5 shadow-lift sm:px-7 sm:pt-11 sm:pb-7',
        className,
      )}
    >
      <Ribbon />
      {children}
    </section>
  );
}

/** A picture of the result: two gift tags on a gold string. */
export function TagArt() {
  const tags: [string, Want, string, string][] = [
    ['Merino socks', 'love', '$24', '-rotate-6'],
    ['A good book', 'like', 'Claimed', 'rotate-3'],
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto flex h-[128px] w-[280px] justify-center">
      <svg viewBox="0 0 280 40" className="absolute inset-x-0 top-0 h-10 w-full">
        <path
          d="M4 6 C 80 34, 200 34, 276 6"
          fill="none"
          stroke={GOLD}
          strokeWidth="1.5"
          strokeDasharray="3 4"
        />
      </svg>
      {tags.map(([name, want, meta, turn], index) => (
        <div
          key={name}
          className={cn(
            'relative mt-6 w-[128px] origin-top rounded-[14px] bg-surface p-3 pl-4 text-left shadow-lift',
            turn,
            index > 0 && '-ml-2 mt-9',
          )}
          style={{ borderLeft: `4px solid ${WANT_LOOK[want].edge}` }}
        >
          <span className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-canvas shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]" />
          <p className="pr-3 text-[13px] leading-tight font-semibold text-ink">{name}</p>
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted">
            <span style={{ color: WANT_LOOK[want].ink }}>
              <Icon name={WANT_LOOK[want].icon} size={11} />
            </span>
            {WANT_NAMES[want]}
          </p>
          <p
            className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
            style={{
              background: tint(index ? PINE : GOLD, 16),
              color: index ? PINE : GOLD_INK,
            }}
          >
            {meta}
          </p>
        </div>
      ))}
    </div>
  );
}

/* ---------------- a wish, as a gift tag ---------------- */

/** How much it's wanted: a small chip; on the owner's tags, a tap moves it along. */
export function WantChip({ want, onCycle }: { want: Want; onCycle?: () => void }) {
  const look = WANT_LOOK[want];
  const inner = (
    <>
      <span style={{ color: look.ink }} className="inline-flex">
        <Icon name={look.icon} size={14} />
      </span>
      {WANT_NAMES[want]}
    </>
  );
  if (!onCycle)
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        {inner}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onCycle}
      aria-label={`${WANT_NAMES[want]}. Tap to change how much you want it`}
      className="fx-move -mx-1.5 inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-ink-2 hover:bg-ink/[.06] hover:text-ink active:scale-95"
    >
      <span key={want} className="fx-pop inline-flex items-center gap-1.5">
        {inner}
      </span>
    </button>
  );
}

export function PriceChip({ price, currency }: { price: number; currency: string }) {
  if (!price) return null;
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
      style={{ background: tint(GOLD, 22), color: GOLD_INK }}
    >
      {formatMoney(price, currency).replace(/\.00$/, '')}
    </span>
  );
}

/**
 * A wish as a gift tag: a notched end with a hole, a ribbon of color for how much it's wanted,
 * the price in gold. `face` changes when the tag turns over (claimed): it flips.
 */
export function WishTag({
  item,
  currency,
  face = 'open',
  dim = false,
  mine = false,
  order = 0,
  action,
  onCycle,
  children,
}: {
  item: WishItem;
  currency: string;
  face?: string;
  dim?: boolean;
  mine?: boolean;
  order?: number;
  /** A small button in the tag's corner (the owner's Edit). */
  action?: ReactNode;
  onCycle?: () => void;
  children?: ReactNode;
}) {
  const domain = item.url && isWebUrl(item.url) ? domainOf(item.url) : '';
  return (
    <li
      className="fx-settle [filter:drop-shadow(0_1px_1px_rgb(0_0_0/.06))_drop-shadow(0_10px_18px_rgb(22_39_31/.08))]"
      style={{ '--i': Math.min(order, 12) } as CSSProperties}
    >
      <div
        key={face}
        className={cn(
          face !== 'open' && 'fx-flip',
          'relative grid gap-3 py-4 pr-3.5 pl-12 sm:pr-4 sm:pl-14 [clip-path:polygon(22px_0,100%_0,100%_100%,22px_100%,0_calc(100%-22px),0_22px)]',
          dim ? 'bg-subtle' : 'bg-surface',
        )}
        style={{
          borderRadius: '0 18px 18px 0',
          ...(mine && {
            background: `color-mix(in oklab, var(--accent, #ff5e57) 11%, var(--color-surface))`,
          }),
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-4 size-3.5 -translate-y-1/2 rounded-full bg-canvas shadow-[inset_0_1px_2px_rgb(0_0_0/.18)] sm:left-5"
        />
        <span
          aria-hidden="true"
          className={cn(
            'absolute inset-y-0 left-[38px] w-[3px] sm:left-[44px]',
            dim && 'opacity-40',
          )}
          style={{ background: WANT_LOOK[item.want].edge }}
        />
        <div className="flex items-start gap-2">
          <div className={cn('min-w-0 flex-1', dim && 'opacity-60')}>
            <p className="text-[17px] leading-snug font-semibold break-words text-ink">
              {nameOf(item)}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <WantChip want={item.want} onCycle={onCycle} />
              <PriceChip price={item.price} currency={currency} />
            </div>
            {item.note && (
              <p className="mt-2 text-[14.5px] leading-relaxed break-words text-ink-2">
                {item.note}
              </p>
            )}
          </div>
          {action}
        </div>
        {domain && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex h-10 max-w-full items-center gap-2 justify-self-start rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
          >
            <Icon name="globe" size={14} className="shrink-0 text-muted" />
            <span className="truncate">{domain}</span>
            <Icon name="arrow-up-right" size={14} className="shrink-0" />
            <span className="sr-only">(opens the shop’s page in a new tab)</span>
          </a>
        )}
        {children}
      </div>
    </li>
  );
}

/** A gift-giver's side of a tag: claim it, or what's become of it. */
export function GiverActions({
  name,
  record,
  mine,
  onClaim,
  onRelease,
  onBought,
}: {
  name: string;
  record: Claim | null;
  mine: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onBought: (got: boolean) => void;
}) {
  if (!record) {
    return (
      <button
        type="button"
        onClick={onClaim}
        aria-label={`I’ll get ${name}`}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] px-5 text-[15.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_10px_22px_-14px_var(--accent)] transition-transform active:scale-[.98] sm:h-11 sm:w-auto sm:justify-self-start"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        <Icon name="gift" size={17} /> I’ll get this
      </button>
    );
  }
  if (!mine) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-ink-2">
        <span style={{ color: PINE }} className="inline-flex">
          <Icon name="check-circle" size={17} />
        </span>
        <span>
          Taken by <span className="font-semibold text-ink">{record.name.trim() || 'someone'}</span>
          {record.got && ' · bought'}
        </span>
      </p>
    );
  }
  return (
    <div className="grid gap-2 border-t border-line pt-3 sm:flex sm:items-center">
      <p className="flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold text-ink">
        <span
          className="fx-stamp grid size-7 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
          style={{ background: 'var(--accent, #ff5e57)' }}
        >
          <Icon name="check" size={14} strokeWidth={3} />
        </span>
        You’re getting this
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-pressed={Boolean(record.got)}
          onClick={() => onBought(!record.got)}
          className={cn(
            'inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] font-medium transition-colors sm:flex-none',
            record.got
              ? 'bg-positive-soft text-positive'
              : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
          )}
        >
          <Icon name={record.got ? 'check-circle' : 'circle'} size={15} />
          {record.got ? 'Bought' : 'Mark as bought'}
        </button>
        <button
          type="button"
          onClick={onRelease}
          aria-label={`Unclaim ${name}`}
          className="h-11 rounded-full px-4 text-[14px] font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
        >
          Unclaim
        </button>
      </div>
    </div>
  );
}

/* ---------------- adding a wish ---------------- */

/** Round amounts for the price chips, in the list's currency's own sizes. */
function priceSteps(currency: string) {
  const units =
    currency === 'JPY'
      ? [3000, 5000, 10000, 30000]
      : currency === 'MXN'
        ? [500, 1000, 2000, 5000]
        : [25, 50, 100, 250];
  const scale = 10 ** minorUnits(currency);
  return units.map((unit) => unit * scale);
}

const chip =
  'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium transition-[background-color,box-shadow,transform] active:scale-[.96]';
const chipOff = 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink';
const chipOn = 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]';

/**
 * A wish goes in with one field. A link pasted into it is picked out (and names the wish);
 * how much it's wanted and a price are taps; a note waits under "Link or note".
 */
export function WishForm({
  initial,
  currency,
  submitLabel,
  onSubmit,
  onCancel,
  first = false,
  children,
}: {
  initial: WishDraft;
  currency: string;
  submitLabel: string;
  onSubmit: (wish: Wish) => void;
  onCancel?: () => void;
  /** The very first wish: a bigger field. */
  first?: boolean;
  /** More controls for an existing wish (move, remove). */
  children?: ReactNode;
}) {
  const id = useId();
  const editing = Boolean(onCancel);
  const [draft, setDraft] = useState<WishDraft>(initial);
  const [errors, setErrors] = useState<{ name?: string; url?: string }>({});
  const [other, setOther] = useState(false);
  // Remounting the extras clears them (and closes them) after an add.
  const [round, setRound] = useState(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<WishDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const steps = priceSteps(currency);
  const showExtras = editing || draft.name.trim().length > 0 || Boolean(draft.url);
  const domain = draft.url && isWebUrl(draft.url) ? domainOf(draft.url) : '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A link typed into the name goes where links go.
    const split = draft.url ? { name: draft.name, url: draft.url } : splitWish(draft.name);
    const candidate = { ...draft, name: split.name, url: split.url || draft.url };
    const checked = checkDraft(candidate);
    setErrors(checked.errors);
    if (!checked.wish) {
      if (checked.errors.name) nameInput.current?.focus();
      else {
        const details = document.getElementById(`${id}-more`)?.querySelector('details');
        if (details) details.open = true;
        document.getElementById(`${id}-url`)?.focus();
      }
      return;
    }
    onSubmit(checked.wish);
    if (!editing) {
      setDraft({ ...EMPTY_DRAFT });
      setOther(false);
      setRound((value) => value + 1);
      nameInput.current?.focus();
    }
  };

  // A link pasted into the name field: kept as the link, and it names the wish.
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim();
    if (!/^(https?:\/\/|www\.)\S+$/i.test(text)) return;
    const split = splitWish(text);
    if (!split.url) return;
    event.preventDefault();
    setErrors({});
    change({ url: split.url, name: draft.name.trim() ? draft.name : split.name });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3">
      <div className="flex gap-2">
        <label htmlFor={`${id}-name`} className="sr-only">
          {editing ? 'What is it?' : 'Add a wish'}
        </label>
        <input
          ref={nameInput}
          id={`${id}-name`}
          value={draft.name}
          maxLength={editing ? 120 : 2000}
          placeholder={first ? 'I’d love…' : 'Add another wish, or paste a link'}
          enterKeyHint="done"
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? `${id}-name-error` : undefined}
          onPaste={paste}
          onChange={(event) => {
            change({ name: event.target.value });
            if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
          }}
          className={cn(
            'w-0 min-w-0 flex-1 rounded-[14px] bg-surface px-4 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)]',
            first ? 'h-14 text-[18px]' : 'h-12 text-[16px] lg:text-[15.5px]',
            errors.name && 'shadow-[inset_0_0_0_1.5px_var(--color-critical)]',
          )}
        />
        {!editing && (
          <button
            type="submit"
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[14px] px-4.5 font-semibold text-[var(--on-accent,#12110d)] transition-transform active:scale-95',
              first ? 'h-14 text-[16px]' : 'h-12 text-[15px]',
            )}
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="plus" size={18} /> {submitLabel}
          </button>
        )}
      </div>
      {errors.name && (
        <p id={`${id}-name-error`} className="text-[13px] text-critical">
          {errors.name}
        </p>
      )}
      {domain && (
        <span className="fx-pop inline-flex h-10 max-w-full items-center gap-2 justify-self-start rounded-full bg-well pr-1 pl-3.5 text-[13.5px] font-medium text-ink-2">
          <Icon name="link-2" size={14} className="shrink-0 text-muted" />
          <span className="truncate">{domain}</span>
          <IconButton
            icon="x"
            size="sm"
            label="Remove the link"
            onClick={() => change({ url: '' })}
          />
        </span>
      )}

      {showExtras && (
        <div className="fx-rise grid gap-2.5">
          <div
            role="radiogroup"
            aria-label="How much you want it"
            className="scroller -mx-1 flex gap-1.5 overflow-x-auto px-1"
          >
            {WANTS.map((want) => {
              const on = draft.want === want;
              return (
                <button
                  key={want}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => change({ want })}
                  className={cn(chip, on ? chipOn : chipOff)}
                >
                  <span style={{ color: WANT_LOOK[want].ink }} className="inline-flex">
                    <Icon name={WANT_LOOK[want].icon} size={15} />
                  </span>
                  {WANT_NAMES[want]}
                </button>
              );
            })}
          </div>
          <div
            role="radiogroup"
            aria-label="About how much"
            className="scroller -mx-1 flex gap-1.5 overflow-x-auto px-1"
          >
            {steps.map((step) => {
              const on = !other && draft.price === step;
              return (
                <button
                  key={step}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setOther(false);
                    change({ price: on ? 0 : step });
                  }}
                  className={cn(chip, on ? chipOn : chipOff)}
                >
                  {formatMoney(step, currency).replace(/\.00$/, '')}
                </button>
              );
            })}
            {(() => {
              const exact = other || (draft.price > 0 && !steps.includes(draft.price));
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={exact}
                  onClick={() => setOther(true)}
                  className={cn(chip, exact ? chipOn : chipOff)}
                >
                  {exact && draft.price > 0 ? formatMoney(draft.price, currency) : 'Exact price'}
                </button>
              );
            })()}
          </div>
          {(other || (draft.price > 0 && !steps.includes(draft.price))) && (
            <div className="fx-rise max-w-[200px]">
              <MoneyInput
                key={currency}
                id={`${id}-price`}
                label="Price"
                value={draft.price}
                currency={currency}
                autoFocus={other}
                onChange={(price) => change({ price })}
              />
            </div>
          )}
        </div>
      )}

      <div id={`${id}-more`} className="contents">
        <MoreOptions
          key={round}
          label="Link or note"
          summary={
            [domain || (draft.url ? 'a link' : ''), draft.note ? 'a note' : '']
              .filter(Boolean)
              .join(' · ') || undefined
          }
          defaultOpen={editing && Boolean(draft.note || (draft.url && !domain))}
        >
          <div className="grid gap-3">
            <Field label="Link" optional htmlFor={`${id}-url`} error={errors.url}>
              <Input
                id={`${id}-url`}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={draft.url}
                maxLength={2000}
                placeholder="https://"
                aria-invalid={Boolean(errors.url)}
                onChange={(event) => change({ url: event.target.value })}
                onBlur={() => {
                  const read = readUrl(draft.url);
                  if ('error' in read) setErrors((current) => ({ ...current, url: read.error }));
                  else {
                    setErrors((current) => ({ ...current, url: undefined }));
                    if (read.url !== draft.url) change({ url: read.url });
                  }
                }}
              />
            </Field>
            <Field label="Note" optional htmlFor={`${id}-note`}>
              <Input
                id={`${id}-note`}
                value={draft.note}
                maxLength={200}
                placeholder="Size M, dark green, anything but white"
                onChange={(event) => change({ note: event.target.value })}
              />
            </Field>
          </div>
        </MoreOptions>
      </div>

      {editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-[var(--on-accent,#12110d)]"
            style={{ background: 'var(--accent, var(--color-ink))' }}
          >
            <Icon name="check" size={16} /> {submitLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-11 rounded-full px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/5 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
      {children}
    </form>
  );
}

/* ---------------- sharing ---------------- */

/** A tick that lands: the link went out. */
export function SentMark({ title, line }: { title: string; line?: string }) {
  return (
    <div className="grid justify-items-center gap-2 text-center" role="status">
      <span
        className="fx-stamp grid size-16 place-items-center rounded-full text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent)]"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        <Icon name="gift" size={28} />
      </span>
      <p
        className="fx-rise mt-1 font-display text-[28px] leading-none font-extrabold tracking-[-0.03em] text-balance text-ink"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {title}
      </p>
      {line && (
        <p className="fx-rise max-w-[32ch] text-[14px] leading-snug text-muted [--i:1]">{line}</p>
      )}
    </div>
  );
}

/** Copy the link, a code to scan, and anything else quiet. */
export function LinkExtras({
  link,
  onUsed,
  children,
}: {
  link: string | null;
  onUsed?: () => void;
  children?: ReactNode;
}) {
  const { copy, copied } = useCopy();
  const [qr, setQr] = useState(false);
  const small =
    'inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[.07] hover:text-ink disabled:opacity-40 lg:h-10';
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap justify-center gap-0.5">
        <button
          type="button"
          disabled={!link}
          onClick={() => {
            if (!link) return;
            onUsed?.();
            void copy(link, 'Link copied');
          }}
          className={small}
        >
          <Icon name={link && copied === link ? 'check' : 'link-2'} size={15} />
          {link && copied === link ? 'Copied' : 'Copy link'}
        </button>
        {link && link.length <= 1600 && (
          <button
            type="button"
            aria-pressed={qr}
            onClick={() => setQr((value) => !value)}
            className={small}
          >
            <Icon name="qr" size={15} /> {qr ? 'Hide code' : 'Code to scan'}
          </button>
        )}
        {children}
      </div>
      {qr && link && (
        <div className="fx-pop mx-auto w-full max-w-[200px] rounded-[16px] bg-white p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <LinkQr url={link} />
        </div>
      )}
    </div>
  );
}

/** After claiming: pass the link on, from the bottom of the screen where the thumb is. */
export function SendOn({
  names,
  owner,
  link,
  onSend,
  onDone,
}: {
  names: string[];
  owner: string;
  link: string | null;
  onSend: () => Promise<SendResult>;
  onDone: () => void;
}) {
  const [result, setResult] = useState<SendResult>(null);
  return (
    <div
      role="status"
      className="fx-rise fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-[22px] bg-surface p-3.5 shadow-pop lg:hidden"
    >
      <div className="flex items-center gap-3">
        <span
          className="fx-stamp grid size-10 shrink-0 place-items-center rounded-full text-[var(--on-accent,#12110d)]"
          style={{ background: 'var(--accent, #ff5e57)' }}
        >
          <Icon name="gift" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-snug font-semibold text-ink">
            {result === 'copied' ? 'Copied.' : `You’re getting ${joinNames(names)}.`}
          </p>
          <p className="text-[13.5px] leading-snug text-muted">
            Pass it to the other givers{owner ? `, not ${owner}` : ''}.
          </p>
        </div>
        <IconButton icon="x" label="Close" onClick={onDone} />
      </div>
      <button
        type="button"
        disabled={!link}
        onClick={async () => {
          const outcome = await onSend();
          setResult(outcome);
          if (outcome === 'shared') onDone();
        }}
        className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-semibold text-[var(--on-accent,#12110d)] transition-[opacity,transform] active:scale-[.985] disabled:opacity-50"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        <Icon name="send" size={17} /> {link ? 'Pass it on' : 'Updating the link…'}
      </button>
      {result === 'failed' && (
        <p className="mt-2 text-[12.5px] text-critical">
          This browser wouldn’t copy. Use Pass it on beside the list instead.
        </p>
      )}
    </div>
  );
}

export type Combined = { error: string; other?: string } | { done: string };

export function Combine({ onCombine }: { onCombine: (text: string) => Promise<Combined> }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Combined | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const outcome = await onCombine(text.trim());
    setBusy(false);
    setResult(outcome);
    if ('done' in outcome) setText('');
  };

  return (
    <form onSubmit={submit} className="grid gap-2">
      <label htmlFor={`${id}-link`} className="text-[13.5px] font-medium text-ink-2">
        Got another link? Combine it
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-link`}
          value={text}
          placeholder="Paste a link"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
          className="h-11 w-0 min-w-0 flex-1 rounded-[12px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:text-[14.5px]"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="inline-flex h-11 shrink-0 items-center rounded-[12px] bg-ink px-4 text-[14.5px] font-semibold text-on-ink disabled:opacity-40"
        >
          Combine
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={cn(
            'text-[13px] leading-relaxed',
            'error' in result ? 'text-critical' : 'text-positive',
          )}
        >
          {'error' in result ? result.error : result.done}{' '}
          {'error' in result && result.other && (
            <a
              href={`#${result.other.replace(/^#/, '')}`}
              className="font-semibold text-ink underline underline-offset-2"
            >
              Open that list instead
            </a>
          )}
        </p>
      )}
    </form>
  );
}

export function ListsCard({ children }: { children: ReactNode }) {
  return (
    <Surface className="grid gap-2">
      <Label>Your lists</Label>
      <ul className="grid gap-1">{children}</ul>
    </Surface>
  );
}

export function NameSheet({
  open,
  itemName,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  itemName: string | null;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="sm"
      title={itemName ? `You’re getting ${itemName}` : 'Your name on claims'}
      description="Other gift-givers see it. Blank shows “Someone”."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`}>
            {itemName ? 'Claim it' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(name);
        }}
        className="grid gap-3 pt-1"
      >
        <Field label="Your name" optional htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            data-autofocus
            value={name}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Someone"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
