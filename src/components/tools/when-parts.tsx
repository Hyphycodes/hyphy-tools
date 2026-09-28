'use client';
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { decodeState, linkFor } from '@/lib/share/link-state';
import {
  bestTimesText,
  describeDays,
  formatDuration,
  formatRange,
  MAX_PEOPLE,
  mergePlans,
  notFree,
  slotStart,
  splitByMask,
  weekdayName,
  whenPlanSchema,
  type TimeWindow,
  type WhenPerson,
  type WhenPlan,
} from '@/lib/tools/when';
import { CopyButton, Note, useCopy } from './kit';
import { LinkQr } from './share-link';

/*
 * The small shared pieces of When?: its lights, people's colors, faces, the invite, sending it,
 * the best-time ticket and combining links.
 */

/** The tool's two lights, from its world: a warm sunrise, and a sunset for the glow. */
export const ACCENT = 'var(--accent, #ffb35c)';
export const GLOW = 'var(--glow, #ff7e5f)';
/** Dark ink for text on the accent and on people's colors. */
export const ON_ACCENT = 'var(--on-accent, #12110d)';
/** The one big thing to do: a sunrise to tap. */
export const BIG_BUTTON =
  'inline-flex h-[60px] w-full items-center justify-center gap-2.5 rounded-full px-6 text-[17.5px] font-bold text-[var(--on-accent,#12110d)] shadow-[0_18px_36px_-16px_var(--glow,transparent)] transition-[transform,opacity] active:scale-[.98] disabled:opacity-40 disabled:shadow-none';
export const BIG_FILL = { background: `linear-gradient(100deg, ${ACCENT}, ${GLOW})` };

/** The accent (or another color) at a strength, for fills and washes. */
export const tint = (percent: number, color = ACCENT) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Everyone gets a color, in the order they joined the plan. Warm and bright enough for dark ink
 * on top, and far enough apart to tell side by side.
 */
const PEOPLE_COLORS = [
  '#ff9f5a',
  '#f47a9b',
  '#9b8cff',
  '#46c2b3',
  '#62a6ff',
  '#f2c94c',
  '#8fd07a',
  '#d38ce8',
];
export const colorAt = (index: number) => PEOPLE_COLORS[index % PEOPLE_COLORS.length];

/** A person's color in this plan; someone not in it yet gets the next one. */
export function colorOf(plan: WhenPlan, id: string | null | undefined) {
  const index = id ? plan.people.findIndex((person) => person.id === id) : -1;
  return colorAt(index < 0 ? plan.people.length : index);
}

export const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

const never = () => () => {};

/** Whether this browser can hand a link to the phone's share sheet. */
export const useCanShare = () =>
  useSyncExternalStore(
    never,
    () => 'share' in navigator,
    () => false,
  );

/* ---------------- Faces ---------------- */

export function Avatar({
  name,
  color,
  size = 32,
  ring = true,
  className,
}: {
  name: string;
  color: string;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-bold',
        ring && 'shadow-[0_0_0_2.5px_var(--color-surface)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: color,
        color: ON_ACCENT,
      }}
    >
      {initial(name)}
    </span>
  );
}

/** A little stack of faces, each in its person's color. */
export function Faces({
  plan,
  people,
  max = 6,
  size = 32,
}: {
  plan: WhenPlan;
  people: WhenPerson[];
  max?: number;
  size?: number;
}) {
  const more = people.length - max;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {people.slice(0, max).map((person, index) => (
        <Avatar
          key={person.id}
          name={person.name}
          color={colorOf(plan, person.id)}
          size={size}
          className={cn(index > 0 && '-ml-2', 'fx-pop')}
        />
      ))}
      {more > 0 && (
        <span
          className="num -ml-2 grid place-items-center rounded-full bg-well font-semibold text-ink-2 shadow-[0_0_0_2.5px_var(--color-surface)]"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        >
          +{more}
        </span>
      )}
    </span>
  );
}

/* ---------------- The invite ---------------- */

/** A torn-off calendar page: the weekday on a colored band, the date big. */
export function DayTile({
  day,
  size = 'md',
  faded,
  className,
}: {
  day: string;
  size?: 'sm' | 'md' | 'lg';
  faded?: boolean;
  className?: string;
}) {
  const month = new Date(`${day}T12:00:00Z`)
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    .toUpperCase();
  return (
    <span
      className={cn(
        'grid shrink-0 justify-items-center overflow-hidden bg-surface shadow-[inset_0_0_0_1px_var(--color-line),0_1px_2px_var(--color-line)]',
        size === 'sm' && 'w-[42px] rounded-[10px] pb-1',
        size === 'md' && 'w-[54px] rounded-[12px] pb-1.5',
        size === 'lg' && 'w-[92px] rounded-[20px] pb-2.5 sm:w-[112px]',
        faded && 'opacity-40',
        className,
      )}
    >
      <span
        className={cn(
          'w-full text-center font-bold tracking-[0.08em] text-[var(--on-accent,#12110d)] uppercase',
          size === 'sm' && 'py-[2px] text-[8.5px]',
          size === 'md' && 'py-[3px] text-[10px]',
          size === 'lg' && 'py-1.5 text-[13px] sm:text-[14px]',
        )}
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${GLOW})` }}
      >
        {weekdayName(day)}
      </span>
      <span
        className={cn(
          'font-display leading-none font-bold text-ink',
          size === 'sm' && 'mt-1 text-[16px]',
          size === 'md' && 'mt-1.5 text-[21px]',
          size === 'lg' && 'mt-2 text-[44px] tracking-[-0.04em] sm:text-[54px]',
        )}
      >
        {Number(day.slice(8))}
      </span>
      <span
        className={cn(
          'font-semibold tracking-[0.08em] text-muted',
          size === 'sm' && 'text-[8px]',
          size === 'md' && 'mt-0.5 text-[9px]',
          size === 'lg' && 'mt-1 text-[12px]',
        )}
      >
        {month}
      </span>
    </span>
  );
}

/** What people see when they open the link: an invitation with the days pinned to it. */
export function InviteCard({
  plan,
  today,
  hours,
}: {
  plan: WhenPlan;
  today: string;
  /** 'Evenings · 5–10 PM' */
  hours: string;
}) {
  return (
    <div
      role="group"
      aria-label="The invite"
      className="fx-settle relative mx-auto w-full max-w-[460px] overflow-hidden rounded-[26px] bg-surface p-5 pt-7 text-left shadow-lift sm:p-7 sm:pt-8"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-2"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${GLOW})` }}
      />
      <p className="label flex items-center gap-1.5 !text-[var(--accent-ink)]">
        <Icon name="calendar-clock" size={14} /> You’re invited
      </p>
      <p
        className="mt-2 font-display text-[32px] leading-[1.02] font-bold tracking-[-0.035em] break-words text-ink sm:text-[38px]"
        style={{ fontVariationSettings: "'wdth' 110" }}
      >
        {plan.title || 'Get-together'}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-[14.5px] font-medium text-ink-2">
        <Icon name="clock" size={15} className="shrink-0 text-muted" />
        {hours}
      </p>
      <ul className="mt-5 flex flex-wrap gap-2" aria-label={describeDays(plan.days)}>
        {plan.days.map((day, index) => (
          <li key={day} className="fx-rise" style={{ ['--i' as string]: index }}>
            <DayTile day={day} faded={day < today} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Sending it ---------------- */

/**
 * Hand the link out: the phone's share sheet, a copy everywhere, a code to scan across a table.
 * The big button is the invite going out; the rest are small.
 */
export function SendActions({
  plan,
  label,
  children,
}: {
  plan: WhenPlan;
  /** 'Send the invite', 'Send it back' */
  label: string;
  /** More small actions, in the row with the code. */
  children?: ReactNode;
}) {
  const canShare = useCanShare();
  const { copy, copied } = useCopy();
  const [link, setLink] = useState<{ plan: WhenPlan; url: string } | null>(null);
  const [showQr, setShowQr] = useState(false);
  // Made ahead of the tap, so copying happens inside it (Safari needs that).
  useEffect(() => {
    let live = true;
    void linkFor(plan).then((url) => {
      if (live) setLink({ plan, url });
    });
    return () => {
      live = false;
    };
  }, [plan]);
  const url = link?.plan === plan ? link.url : null;
  const done = !!url && copied === url;

  const share = async () => {
    if (!url) return;
    try {
      await navigator.share({
        title: plan.title || 'Get-together',
        text: 'When are you free? Tap your times:',
        url,
      });
    } catch {
      // Cancelled, or not allowed here: the copy button is right there.
    }
  };

  const small =
    'inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-ink/[.06] px-4 text-[14px] font-semibold text-ink-2 transition-[background-color,transform] hover:bg-ink/10 hover:text-ink active:scale-[.97] disabled:opacity-40';

  return (
    <div className="grid gap-3">
      <button
        type="button"
        disabled={!url}
        onClick={() => (canShare ? void share() : url && void copy(url, 'Invite link copied'))}
        className={BIG_BUTTON}
        style={BIG_FILL}
      >
        <Icon name={done ? 'check' : 'send'} size={20} />
        {done ? 'Link copied. Paste it in the chat' : label}
      </button>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {canShare && (
          <button
            type="button"
            disabled={!url}
            onClick={() => url && void copy(url, 'Invite link copied')}
            className={small}
          >
            <Icon name={done ? 'check' : 'copy'} size={15} /> {done ? 'Copied' : 'Copy link'}
          </button>
        )}
        {url && url.length <= 1600 && (
          <button
            type="button"
            aria-expanded={showQr}
            onClick={() => setShowQr((value) => !value)}
            className={small}
          >
            <Icon name="qr" size={15} /> {showQr ? 'Hide code' : 'Show a code'}
          </button>
        )}
        {children}
      </div>
      {showQr && url && (
        <div className="fx-pop mx-auto w-full max-w-[220px] rounded-[18px] bg-white p-3 shadow-card">
          <LinkQr url={url} />
        </div>
      )}
    </div>
  );
}

/* ---------------- The answer ---------------- */

/** The payoff: the one time that works, as a ticket, big. */
export function BestTicket({
  plan,
  best,
  total,
  children,
}: {
  plan: WhenPlan;
  best: TimeWindow;
  total: number;
  /** What to do with it (copy, send). */
  children?: ReactNode;
}) {
  const everyone = best.count === total;
  const { free, busy } = splitByMask(plan, best.mask);
  const from = slotStart(plan, best.from);
  const to = slotStart(plan, best.to);
  const day = plan.days[best.day];
  return (
    <section
      aria-labelledby="when-best"
      aria-live="polite"
      className="relative isolate overflow-hidden rounded-[28px] bg-surface p-4 shadow-lift sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(70% 90% at 0% 0%, ${tint(everyone ? 34 : 22)}, transparent 70%), radial-gradient(60% 80% at 100% 100%, ${tint(everyone ? 26 : 14, GLOW)}, transparent 70%)`,
        }}
      />
      <p
        id="when-best"
        className="fx-pop flex items-center gap-1.5 text-[13px] font-bold tracking-[0.06em] text-[var(--accent-ink)] uppercase"
      >
        <Icon name={everyone ? 'check-circle' : 'star'} size={16} />
        {everyone ? (total > 1 ? 'Everyone’s free' : 'Free') : 'Best time so far'}
      </p>
      <div className="mt-3 flex items-center gap-4 sm:gap-6">
        <DayTile day={day} size="lg" className="fx-stamp shadow-lift" />
        <div className="min-w-0">
          <p
            className="fx-rise font-display text-[34px] leading-[.95] font-extrabold tracking-[-0.045em] text-ink sm:text-[54px]"
            style={{ fontVariationSettings: "'wdth' 112" }}
          >
            {formatRange(from, to)}
          </p>
          <div className="fx-rise mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 [--i:1]">
            <Faces plan={plan} people={free} max={8} size={30} />
            <span
              className="num inline-flex h-8 items-center gap-1 rounded-full px-3 text-[15px] font-bold"
              style={
                everyone
                  ? { background: ACCENT, color: ON_ACCENT }
                  : { background: tint(22), color: 'var(--color-ink)' }
              }
            >
              {best.count}/{total}
              <span className="font-semibold">free</span>
            </span>
          </div>
          <p className="fx-rise mt-1.5 text-[13.5px] text-muted [--i:2]">
            {!everyone && `${notFree(busy.map((person) => person.name))} · `}
            {formatDuration(to - from)}
          </p>
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  );
}

/** Copy the best times as text for the chat. */
export function CopyBest({ plan, best }: { plan: WhenPlan; best: TimeWindow[] }) {
  return (
    <CopyButton
      text={bestTimesText(plan, best)}
      label="Copy for the group chat"
      what="Best times copied"
      className="!h-11 !rounded-full !bg-ink/[.06] !px-4 !text-[14px] !font-semibold"
    />
  );
}

/** A quiet round button. */
export function Pill({
  icon,
  children,
  onClick,
  className,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-ink/[.06] px-4 text-[14px] font-semibold text-ink-2 transition-[background-color,transform] hover:bg-ink/10 hover:text-ink active:scale-[.97]',
        className,
      )}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/* ---------------- Combining links ---------------- */

export function CombineLinks({
  plan,
  onCombine,
  onOpen,
}: {
  plan: WhenPlan;
  onCombine: (plan: WhenPlan) => void;
  onOpen: (plan: WhenPlan) => void;
}) {
  const id = useId();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    tone: 'positive' | 'caution';
    message: string;
    other?: WhenPlan;
  } | null>(null);

  const combine = async () => {
    const at = text.indexOf('#');
    if (at < 0) {
      setResult({
        tone: 'caution',
        message: 'That isn’t a When? link. Copy the whole link and try again.',
      });
      return;
    }
    setBusy(true);
    const other = await decodeState(text.slice(at).trim(), whenPlanSchema);
    setBusy(false);
    if (!other) {
      setResult({
        tone: 'caution',
        message: 'Couldn’t read that link. It may have been cut off when it was copied.',
      });
      return;
    }
    const merged = mergePlans(plan, other);
    if (!merged.ok) {
      setResult(
        merged.reason === 'other-plan'
          ? {
              tone: 'caution',
              message: `That link is for a different plan${other.title ? `, “${other.title}”` : ''}, so its times stay separate.`,
              other,
            }
          : merged.reason === 'other-grid'
            ? {
                tone: 'caution',
                message:
                  'That link is this plan with different days or hours, so its times can’t be combined.',
              }
            : {
                tone: 'caution',
                message: `Together they’d have more than ${MAX_PEOPLE} people, the most one plan can hold.`,
              },
      );
      return;
    }
    setText('');
    if (!merged.added && !merged.updated) {
      setResult({ tone: 'positive', message: 'Nothing new in that link: everyone in it is here.' });
      return;
    }
    onCombine(merged.plan);
    const parts = [
      merged.added && `added ${merged.added} ${merged.added === 1 ? 'person' : 'people'}`,
      merged.updated && `updated ${merged.updated}`,
    ].filter(Boolean);
    setResult({ tone: 'positive', message: `Combined: ${parts.join(' and ')}.` });
    toast({ title: 'Links combined' });
  };

  return (
    // Rarely needed (opening each link here combines them anyway), so it starts folded.
    <details className="group/combine rounded-[20px] bg-surface px-4 shadow-card">
      <summary className="flex min-h-13 cursor-pointer list-none items-center gap-2.5 text-[14.5px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
        <Icon name="layers" size={16} className="shrink-0 text-muted" />
        <span id={`${id}-label`} className="min-w-0 flex-1">
          Got several links back?
        </span>
        <Icon
          name="chevron-right"
          size={15}
          className="shrink-0 text-muted transition-transform group-open/combine:rotate-90"
        />
      </summary>
      <div className="grid gap-3 pt-1 pb-4">
        <p className="text-[13px] leading-relaxed text-muted">
          Open each one here, or paste them in. Everyone ends up in one plan.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void combine();
          }}
        >
          <input
            aria-labelledby={`${id}-label`}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setResult(null);
            }}
            placeholder="Paste a When? link"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 rounded-[12px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--accent-ink)] lg:h-10 lg:text-[14px]"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] bg-well px-4 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-10 lg:text-[14px]"
          >
            <Icon name="layers" size={15} /> Combine
          </button>
        </form>
        {result && (
          <Note icon={result.tone === 'positive' ? 'check' : 'alert'} tone={result.tone}>
            {result.message}
            {result.other && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => result.other && onOpen(result.other)}
                  className="font-semibold underline underline-offset-2"
                >
                  Open that plan
                </button>
              </>
            )}
          </Note>
        )}
      </div>
    </details>
  );
}
