'use client';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { directionsUrl, placeFrom, type Place } from '@/lib/tools/places';
import {
  countdown,
  headcount,
  PLAN_LOOK,
  peopleOf,
  QUICK_TIMES,
  quickDays,
  titleOf,
  whenLine,
  type Plan,
  type Rsvp,
} from '@/lib/tools/plan';
import { formatTime } from '@/lib/tools/when';
import { PeopleStack, PersonDot } from './bring-art';
import { PlaceArt } from './place-card';

/*
 * Plan's world: blue sky, warm ivory and a little sunshine. The plan is an invitation card —
 * a big title, the day, the place and who's coming — and underneath it a gentle timeline of the
 * few things around it (before, the day, after), each one line with one action.
 */

/* ---------------- the invitation ---------------- */

/** Soft clouds and a low sun over cobalt: the top of every invitation. */
export function Sky({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      className={cn('relative isolate overflow-hidden', className)}
      style={{
        background:
          'radial-gradient(40% 70% at 88% 100%, rgb(255 216 77 / .85), rgb(255 216 77 / 0) 70%), radial-gradient(60% 90% at 0% 0%, #7fa2ff, transparent 70%), linear-gradient(180deg, #3f6ef0, #6f95ff)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(22px 12px at 18% 42%, rgb(255 255 255 / .75), transparent 70%), radial-gradient(34px 16px at 24% 38%, rgb(255 255 255 / .7), transparent 70%), radial-gradient(28px 12px at 62% 26%, rgb(255 255 255 / .55), transparent 70%), radial-gradient(40px 16px at 68% 22%, rgb(255 255 255 / .55), transparent 70%)',
        }}
      />
      {children}
    </div>
  );
}

export function InviteCard({
  plan,
  today,
  onEditWhen,
  onEditPlace,
  onEditTitle,
  children,
}: {
  plan: Plan;
  today: string;
  onEditWhen?: () => void;
  onEditPlace?: () => void;
  onEditTitle?: () => void;
  /** Under the card's details: RSVP, people. */
  children?: ReactNode;
}) {
  const look = PLAN_LOOK[plan.kind];
  const when = whenLine(plan);
  const soon = countdown(plan.date, today);
  const people = peopleOf(plan);
  const count = headcount(plan);
  const going = people.filter((person) => person.rsvp !== 'out').map((person) => person.name);
  return (
    <article
      aria-labelledby="plan-title"
      className="relative isolate min-w-0 overflow-hidden rounded-[30px] bg-surface shadow-lift"
    >
      <Sky className="h-[118px] sm:h-[138px]">
        <span className="absolute top-5 left-5 grid size-14 place-items-center rounded-[18px] bg-white/95 text-[#2f55d4] shadow-[0_10px_24px_-10px_rgb(20_32_61/.5)] sm:left-7 sm:size-16">
          <Icon name={look.icon} size={28} strokeWidth={2} />
        </span>
        {soon && (
          <span className="absolute top-5 right-5 inline-flex h-8 items-center rounded-full bg-[#ffd84d] px-3.5 text-[13px] font-bold text-[#14203d] shadow-[0_6px_16px_-8px_rgb(20_32_61/.5)] sm:right-7">
            {soon}
          </span>
        )}
      </Sky>
      {/* The invitation's scalloped edge. */}
      <div
        aria-hidden="true"
        className="-mt-3 h-3"
        style={{
          background:
            'radial-gradient(circle at 10px 0, transparent 9px, var(--color-surface) 9.5px) 0 0 / 20px 12px repeat-x',
        }}
      />
      <div className="px-5 pt-3 pb-6 sm:px-8 sm:pb-8">
        <p className="text-[12px] font-bold tracking-[.14em] text-[var(--accent-ink)] uppercase">
          {look.label === 'Something else' ? 'The plan' : look.label}
        </p>
        <h2
          id="plan-title"
          className="mt-1.5 font-display text-[36px] leading-[.98] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[48px]"
          style={{ fontVariationSettings: "'wdth' 112" }}
        >
          {onEditTitle ? (
            <button type="button" onClick={onEditTitle} className="group text-left">
              {titleOf(plan)}
              <Icon
                name="pencil"
                size={17}
                className="ml-2 inline-block align-middle text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
              />
              <span className="sr-only"> (rename)</span>
            </button>
          ) : (
            titleOf(plan)
          )}
        </h2>

        <dl className="mt-5 grid gap-3">
          <Detail
            icon="calendar"
            label="When"
            value={when}
            empty="Day to be decided"
            onClick={onEditWhen}
          />
          <Detail
            icon="map-pin"
            label="Where"
            value={plan.place?.name ?? ''}
            sub={plan.place?.note}
            empty="Place to be decided"
            onClick={onEditPlace}
            end={
              plan.place && (
                <a
                  href={directionsUrl(plan.place)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Directions to ${plan.place.name}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-well text-ink-2 hover:bg-ink/10 hover:text-ink"
                >
                  <Icon name="navigation" size={17} />
                </a>
              )
            }
          />
          {people.length > 0 && (
            <div className="flex items-center gap-3">
              <dt className="sr-only">Who</dt>
              <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[#ffd84d]/40 text-[#14203d]">
                <Icon name="people" size={19} />
              </span>
              <dd className="flex min-w-0 flex-1 items-center gap-2.5">
                <PeopleStack
                  names={going.length ? going : people.map((person) => person.name)}
                  size={30}
                />
                <span className="min-w-0 text-[14.5px] text-ink-2">
                  {count.total} {count.total === 1 ? 'person' : 'people'}
                  {count.in > 0 && <span className="text-muted"> · {count.in} in</span>}
                  {count.maybe > 0 && <span className="text-muted"> · {count.maybe} maybe</span>}
                </span>
              </dd>
            </div>
          )}
        </dl>
        {plan.note.trim() && (
          <p className="mt-5 rounded-[16px] bg-[#ffd84d]/20 px-4 py-3 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">
            {plan.note.trim()}
          </p>
        )}
        {children}
      </div>
    </article>
  );
}

function Detail({
  icon,
  label,
  value,
  sub,
  empty,
  onClick,
  end,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  empty: string;
  onClick?: () => void;
  end?: ReactNode;
}) {
  const body = (
    <>
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-[14px]',
          value ? 'bg-signal-soft text-[var(--accent-ink)]' : 'bg-well text-muted',
        )}
      >
        <Icon name={icon} size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[17px] leading-tight',
            value ? 'font-semibold text-ink' : 'text-muted',
          )}
        >
          {value || empty}
        </span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
    </>
  );
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 flex-1">
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="-mx-2 flex w-[calc(100%+16px)] min-w-0 items-center gap-3 rounded-[16px] px-2 py-1 text-left transition-colors hover:bg-ink/[.04]"
            aria-label={`${label}: ${value || empty}. Change`}
          >
            {body}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-3">{body}</div>
        )}
      </dd>
      {end}
    </div>
  );
}

/* ---------------- are you in? ---------------- */

const RSVP_LOOK: Record<Exclude<Rsvp, 'invited'>, { label: string; icon: IconName }> = {
  in: { label: 'I’m in', icon: 'check' },
  maybe: { label: 'Maybe', icon: 'clock' },
  out: { label: 'Can’t make it', icon: 'x' },
};

export function RsvpButtons({
  value,
  onAnswer,
}: {
  value: Rsvp | null;
  onAnswer: (rsvp: Exclude<Rsvp, 'invited'>) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Are you in?" className="grid grid-cols-3 gap-2">
      {(['in', 'maybe', 'out'] as const).map((rsvp) => {
        const on = value === rsvp;
        return (
          <button
            key={rsvp}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onAnswer(rsvp)}
            className={cn(
              'fx-move flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[16px] px-2 text-[14px] font-semibold active:scale-[.97]',
              on
                ? rsvp === 'in'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] shadow-[0_12px_26px_-14px_var(--accent)]'
                  : 'bg-ink text-on-ink'
                : 'bg-well text-ink-2 hover:bg-ink/10',
            )}
          >
            <Icon name={RSVP_LOOK[rsvp].icon} size={18} strokeWidth={on ? 2.6 : 2} />
            {RSVP_LOOK[rsvp].label}
          </button>
        );
      })}
    </div>
  );
}

export const RSVP_WORD: Record<Rsvp, string> = {
  in: 'In',
  maybe: 'Maybe',
  out: 'Can’t',
  invited: 'Invited',
};

/* ---------------- the timeline ---------------- */

export function Phase({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="relative grid gap-2 pl-7">
      <span
        aria-hidden="true"
        className="absolute top-1.5 bottom-0 left-[7px] w-0 border-l-2 border-dotted border-[var(--accent-ink)]/30"
      />
      <span
        aria-hidden="true"
        className="absolute top-1 left-0 size-4 rounded-full border-[3px] border-[var(--color-canvas)] bg-[var(--accent)]"
      />
      <h3 className="text-[12px] font-extrabold tracking-[.14em] text-[var(--accent-ink)] uppercase">
        {label}
      </h3>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

/** One thing around the plan: its name, where it stands, one action. */
export function Module({
  icon,
  label,
  value,
  empty,
  action,
  onAction,
  href,
  secondary,
  tone = '#4f7cff',
}: {
  icon: IconName;
  label: string;
  value?: ReactNode;
  empty: ReactNode;
  action?: string;
  onAction?: () => void;
  href?: string;
  secondary?: ReactNode;
  tone?: string;
}) {
  const actionClass =
    'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors';
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[20px] bg-surface p-3 pr-3 shadow-card">
      <span
        className="grid size-12 shrink-0 place-items-center rounded-[15px] text-[#14203d]"
        style={{ background: `color-mix(in srgb, ${tone} 26%, white)` }}
      >
        <Icon name={icon} size={21} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] font-bold tracking-[.12em] text-muted uppercase">{label}</p>
        <p
          className={cn(
            'truncate text-[15.5px] leading-snug',
            value ? 'font-semibold text-ink' : 'text-ink-2',
          )}
        >
          {value || empty}
        </p>
      </div>
      {secondary}
      {action &&
        (href ? (
          <a href={href} className={cn(actionClass, 'bg-well text-ink hover:bg-ink/10')}>
            {action}
          </a>
        ) : (
          <button
            type="button"
            onClick={onAction}
            className={cn(
              actionClass,
              value ? 'bg-well text-ink hover:bg-ink/10' : 'text-[var(--on-accent)]',
            )}
            style={value ? undefined : { background: 'var(--accent)' }}
          >
            {action}
          </button>
        ))}
    </div>
  );
}

/* ---------------- editors (inline in the first steps, in sheets later) ---------------- */

const chip = (on: boolean) =>
  cn(
    'min-h-11 shrink-0 rounded-full px-4 text-[14.5px] font-medium transition-colors active:scale-[.97]',
    on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-well text-ink-2 hover:bg-ink/10',
  );

export function WhenEditor({
  today,
  date,
  end,
  time,
  trip,
  onChange,
}: {
  today: string;
  date: string;
  end: string;
  time: number;
  trip: boolean;
  onChange: (next: { date: string; end: string; time: number }) => void;
}) {
  const id = useId();
  const picks = quickDays(today);
  const [custom, setCustom] = useState(Boolean(date && !picks.some((pick) => pick.date === date)));
  const [customTime, setCustomTime] = useState(
    time >= 0 && !QUICK_TIMES.some((entry) => entry.time === time),
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <p className="text-[13.5px] font-medium text-ink-2">{trip ? 'First day' : 'Day'}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Day">
          {picks.map((pick) => (
            <button
              key={pick.label}
              type="button"
              role="radio"
              aria-checked={date === pick.date && !custom}
              onClick={() => {
                setCustom(false);
                onChange({ date: pick.date, end, time });
              }}
              className={chip(date === pick.date && !custom)}
            >
              {pick.label}
            </button>
          ))}
          <button type="button" onClick={() => setCustom(true)} className={chip(custom)}>
            Another day
          </button>
        </div>
        {custom && (
          <input
            type="date"
            aria-label="Pick a day"
            value={date}
            min={today}
            onChange={(event) => onChange({ date: event.target.value, end, time })}
            className="h-12 rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
          />
        )}
      </div>
      {trip ? (
        <div className="grid gap-2">
          <label htmlFor={`${id}-end`} className="text-[13.5px] font-medium text-ink-2">
            Last day <span className="font-normal text-faint">· optional</span>
          </label>
          <input
            id={`${id}-end`}
            type="date"
            value={end}
            min={date || today}
            disabled={!date}
            onChange={(event) => onChange({ date, end: event.target.value, time })}
            className="h-12 rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] disabled:opacity-50"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-[13.5px] font-medium text-ink-2">
            Time <span className="font-normal text-faint">· optional</span>
          </p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Time">
            {QUICK_TIMES.map((entry) => (
              <button
                key={entry.time}
                type="button"
                role="radio"
                aria-checked={time === entry.time && !customTime}
                onClick={() => {
                  setCustomTime(false);
                  onChange({ date, end, time: time === entry.time ? -1 : entry.time });
                }}
                className={chip(time === entry.time && !customTime)}
              >
                {entry.label}
              </button>
            ))}
            <button type="button" onClick={() => setCustomTime(true)} className={chip(customTime)}>
              {customTime && time >= 0 ? formatTime(time) : 'Other'}
            </button>
          </div>
          {customTime && (
            <input
              type="time"
              aria-label="Pick a time"
              value={time >= 0 ? `${pad(Math.floor(time / 60))}:${pad(time % 60)}` : ''}
              onChange={(event) => {
                const [hours, minutes] = event.target.value.split(':').map(Number);
                onChange({
                  date,
                  end,
                  time: Number.isFinite(hours) ? hours * 60 + (minutes || 0) : -1,
                });
              }}
              className="h-12 rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Where: a name or a pasted link, or hand it to the group (Where?). */
export function PlaceEditor({
  place,
  onPlace,
  onVote,
}: {
  place: Place | null;
  onPlace: (place: Place | null) => void;
  onVote?: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = placeFrom(text);
    if (!found) return;
    onPlace({ name: found.name, note: found.note, url: found.url });
    setText('');
  };
  return (
    <div className="grid gap-3">
      {place && (
        <div className="flex items-center gap-3 rounded-[18px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <PlaceArt name={place.name} pin="sm" className="size-12 shrink-0 rounded-[14px]" />
          <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{place.name}</p>
          <button
            type="button"
            onClick={() => onPlace(null)}
            className="inline-flex h-10 items-center rounded-full px-3 text-[13.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
          >
            Clear
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={`${id}-place`} className="sr-only">
          A place, or paste a link
        </label>
        <input
          id={`${id}-place`}
          value={text}
          maxLength={600}
          autoComplete="off"
          placeholder={place ? 'Somewhere else?' : 'A place, or paste a Maps link'}
          onChange={(event) => setText(event.target.value)}
          className="h-12 w-0 min-w-0 flex-1 rounded-[14px] bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-12 shrink-0 rounded-[14px] px-4 text-[15px] font-semibold text-[var(--on-accent)] disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          Set
        </button>
      </form>
      {onVote && (
        <button
          type="button"
          onClick={onVote}
          className="flex min-h-14 items-center gap-3 rounded-[18px] bg-[#ff6b5b]/12 px-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-[#ff6b5b]/20"
        >
          <span className="grid size-9 place-items-center rounded-full bg-[#ff6b5b] text-[#12110d]">
            <Icon name="heart" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            Not sure? Let everyone vote
            <span className="block text-[13px] font-normal text-muted">Opens Where?</span>
          </span>
          <Icon name="arrow-right" size={17} className="text-muted" />
        </button>
      )}
    </div>
  );
}

/** Who: names as chips, added one at a time or pasted as a list. */
export function PeopleEditor({
  plan,
  onAdd,
  onRemove,
}: {
  plan: Plan;
  onAdd: (names: string[]) => void;
  onRemove?: (personId: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const people = peopleOf(plan);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const names = text
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length) onAdd(names);
    setText('');
  };
  return (
    <div className="grid gap-3">
      {people.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="On the list">
          {people.map((person) => (
            <li
              key={person.id}
              className="fx-pop inline-flex min-h-11 items-center gap-2 rounded-full bg-well py-1 pr-1.5 pl-1.5 text-[14.5px] font-medium text-ink"
            >
              <PersonDot name={person.name} size={30} />
              {person.name}
              <span className="text-[12px] text-muted">
                {person.host ? 'Host' : RSVP_WORD[person.rsvp]}
              </span>
              {onRemove && !person.host && (
                <button
                  type="button"
                  aria-label={`Take ${person.name} off the list`}
                  onClick={() => onRemove(person.id)}
                  className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/10 hover:text-ink"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={`${id}-who`} className="sr-only">
          Add people
        </label>
        <input
          id={`${id}-who`}
          value={text}
          maxLength={400}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add a name (or a few, with commas)"
          onChange={(event) => setText(event.target.value)}
          className="h-12 w-0 min-w-0 flex-1 rounded-[14px] bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-12 shrink-0 rounded-[14px] px-4 text-[15px] font-semibold text-[var(--on-accent)] disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          Add
        </button>
      </form>
    </div>
  );
}
