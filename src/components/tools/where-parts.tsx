'use client';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { linkSource, placeFrom, type Place } from '@/lib/tools/places';
import {
  IDEAS,
  VOTES,
  type RoundKind,
  type Standing,
  type Tally,
  type Vote,
  type WhereOption,
} from '@/lib/tools/where';
import { PeopleStack } from './bring-art';
import { CountUp } from './kit';
import { PlaceArt } from './place-card';

/*
 * Where?'s world: a warm city night above, cream destination cards below. The question sits in
 * the night sky; every choice is a little destination with its own color and pin; votes are
 * three friendly taps; the result is bars, and a clear favorite becomes a ticket.
 */

/* ---------------- the night sky ---------------- */

/** A few buildings with lit windows, drawn once. */
function Skyline() {
  const buildings = [
    [0, 64, 38],
    [34, 44, 30],
    [60, 78, 26],
    [82, 52, 40],
    [118, 90, 22],
    [136, 60, 34],
    [166, 40, 28],
    [190, 72, 36],
    [222, 50, 26],
    [244, 84, 30],
    [270, 58, 38],
    [304, 46, 24],
    [324, 70, 34],
    [354, 54, 46],
  ];
  return (
    <svg
      viewBox="0 0 400 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[72px] w-full sm:h-[92px]"
    >
      {buildings.map(([x, h, w], index) => (
        <g key={x}>
          <rect x={x} y={100 - h} width={w} height={h} rx="2" fill="#1c0d24" opacity=".9" />
          {Array.from({ length: Math.floor(h / 14) }, (_, row) =>
            Array.from({ length: Math.floor(w / 10) }, (_, col) =>
              (row * 7 + col * 3 + index) % 4 === 0 ? (
                <rect
                  key={`${row}-${col}`}
                  x={x + 4 + col * 9}
                  y={100 - h + 6 + row * 13}
                  width="3.5"
                  height="4.5"
                  rx=".8"
                  fill={(row + col + index) % 3 === 0 ? '#ffb35c' : '#ff8f7a'}
                  opacity=".85"
                />
              ) : null,
            ),
          )}
        </g>
      ))}
    </svg>
  );
}

/** The top of the round: the question in a warm night sky over the city. */
export function NightSky({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-[26px] px-5 pt-7 pb-[88px] text-[#fff4ea] sm:px-8 sm:pt-9 sm:pb-[108px]',
        className,
      )}
      style={{
        background:
          'radial-gradient(60% 70% at 85% 110%, rgb(255 107 91 / .55), transparent 70%), radial-gradient(40% 50% at 10% 0%, rgb(155 123 255 / .35), transparent 70%), linear-gradient(180deg, #2a1433, #43203f 70%, #5a2a44)',
      }}
    >
      {/* Stars and a moon. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            'radial-gradient(circle at 12% 22%, #fff 0.8px, transparent 1.4px), radial-gradient(circle at 34% 12%, #fff 0.6px, transparent 1.2px), radial-gradient(circle at 58% 30%, #fff 0.7px, transparent 1.3px), radial-gradient(circle at 76% 16%, #fff 0.9px, transparent 1.5px), radial-gradient(circle at 92% 38%, #fff 0.6px, transparent 1.2px), radial-gradient(circle at 46% 44%, #fff 0.5px, transparent 1px)',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-5 right-6 size-9 rounded-full sm:top-7 sm:right-9 sm:size-11"
        style={{
          background: 'radial-gradient(circle at 35% 35%, #fff6e8, #ffd9b8 60%, #ffb38a)',
          boxShadow: '0 0 40px 8px rgb(255 200 160 / .25)',
        }}
      />
      <Skyline />
      <div className="relative">{children}</div>
    </div>
  );
}

/* ---------------- votes ---------------- */

export const VOTE_LOOK: Record<Vote, { icon: IconName; label: string; short: string }> = {
  love: { icon: 'heart', label: 'Love it', short: 'Love' },
  ok: { icon: 'thumbs-up', label: 'Works for me', short: 'Works' },
  no: { icon: 'thumbs-down', label: 'Not this one', short: 'Not this' },
};

/** Three taps under a card. The one you picked is lit; tapping it again takes it back. */
export function VoteButtons({
  name,
  value,
  onVote,
}: {
  name: string;
  value: Vote | undefined;
  onVote: (vote: Vote) => void;
}) {
  return (
    <div role="group" aria-label={`Your vote on ${name}`} className="grid grid-cols-3 gap-1.5">
      {VOTES.map((vote) => {
        const on = value === vote;
        const look = VOTE_LOOK[vote];
        return (
          <button
            key={vote}
            type="button"
            aria-pressed={on}
            aria-label={`${look.label}: ${name}`}
            onClick={() => onVote(vote)}
            className={cn(
              'fx-move flex h-11 min-w-0 items-center justify-center gap-1 rounded-[12px] text-[12.5px] font-semibold active:scale-95 max-sm:h-12',
              on
                ? vote === 'no'
                  ? 'bg-ink text-on-ink'
                  : 'text-[var(--on-accent,#12110d)] shadow-[0_8px_18px_-10px_var(--accent)]'
                : 'bg-ink/[.05] text-ink-2 hover:bg-ink/10 hover:text-ink',
            )}
            style={on && vote !== 'no' ? { background: 'var(--accent)' } : undefined}
          >
            <Icon
              name={look.icon}
              size={16}
              strokeWidth={on ? 2.4 : 1.9}
              className={cn(on && vote === 'love' && 'fx-ping [&_path]:fill-current')}
            />
            <span className="truncate max-sm:sr-only">{look.short}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- a destination card ---------------- */

export function OptionCard({
  option,
  standing,
  mine,
  leading,
  picked,
  index,
  onVote,
  onOpen,
}: {
  option: WhereOption;
  standing: Standing | undefined;
  mine: Vote | undefined;
  leading: boolean;
  picked: boolean;
  index: number;
  onVote: (vote: Vote) => void;
  onOpen: () => void;
}) {
  const yes = standing?.yes ?? 0;
  const lovers =
    standing?.names.filter((entry) => entry.vote !== 'no').map((entry) => entry.name) ?? [];
  return (
    <li
      className={cn(
        'fx-rise relative flex min-w-0 flex-col overflow-hidden rounded-[22px] bg-surface shadow-lift',
        (leading || picked) && 'shadow-[0_0_0_2.5px_var(--accent),0_18px_36px_-18px_var(--accent)]',
      )}
      style={{ ['--i' as string]: Math.min(index, 8) }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${option.name}: details`}
        className="group relative block text-left"
      >
        <PlaceArt
          name={option.name}
          kind={option.kind}
          className="h-[104px] w-full transition-transform duration-300 group-hover:scale-[1.03] sm:h-[120px]"
        />
        {yes > 0 && (
          <span className="absolute top-2.5 right-2.5 inline-flex h-7 items-center gap-1 rounded-full bg-[#fffaf5]/95 px-2.5 text-[12.5px] font-bold text-[#2a1420] shadow-[0_4px_12px_-6px_rgb(0_0_0/.4)]">
            <Icon name="heart" size={12} strokeWidth={2.6} className="text-[#e0473a]" />
            <span className="mono-num">{yes}</span>
          </span>
        )}
        {(leading || picked) && (
          <span
            className="fx-stamp absolute top-2.5 left-2.5 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-extrabold tracking-[.06em] text-[var(--on-accent,#12110d)] uppercase"
            style={{ background: 'var(--accent)' }}
          >
            <Icon name={picked ? 'check' : 'star'} size={12} strokeWidth={2.8} />
            {picked ? 'The pick' : 'Leading'}
          </span>
        )}
        <span className="block px-3.5 pt-3 pb-1">
          <span className="block truncate font-display text-[18px] leading-tight font-bold tracking-[-0.02em] text-ink">
            {option.name}
          </span>
          <span className="block truncate text-[13px] text-muted">
            {option.note || (option.url ? `from ${linkSource(option.url)}` : '\u00a0')}
          </span>
        </span>
      </button>
      <div className="mt-auto grid gap-2 px-2.5 pt-1.5 pb-2.5">
        {lovers.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <PeopleStack names={lovers} size={22} />
          </div>
        )}
        <VoteButtons name={option.name} value={mine} onVote={onVote} />
      </div>
    </li>
  );
}

/* ---------------- adding places ---------------- */

/**
 * The way a place gets in: type it, paste a link (Google Maps, Yelp, OpenTable… name it for
 * you), or tap an idea.
 */
export function AddPlace({
  kind,
  taken,
  onAdd,
  full,
  compact = false,
}: {
  kind: RoundKind;
  taken: string[];
  onAdd: (place: Place & { named: boolean }) => void;
  full: boolean;
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const has = new Set(taken.map((name) => name.trim().toLowerCase()));
  const ideas = IDEAS[kind]
    .filter((idea) => !has.has(idea.toLowerCase()))
    .slice(0, compact ? 4 : 8);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const place = placeFrom(text);
    if (!place) return;
    onAdd(place);
    setText('');
  };
  return (
    <div className="grid gap-3">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor={`${id}-place`} className="sr-only">
          Add a place or paste a link
        </label>
        <div className="relative min-w-0 flex-1">
          <Icon
            name="map-pin"
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[var(--accent-ink)]"
          />
          <input
            id={`${id}-place`}
            value={text}
            disabled={full}
            maxLength={600}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={full ? 'That’s plenty of choices' : 'Add a place or paste a link'}
            onChange={(event) => setText(event.target.value)}
            className="h-13 w-full rounded-[16px] bg-surface pr-3 pl-10 text-[16px] text-ink shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)] disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={!text.trim() || full}
          className="inline-flex h-13 shrink-0 items-center gap-1.5 rounded-[16px] px-4.5 text-[15px] font-semibold text-[var(--on-accent,#12110d)] transition-opacity disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          <Icon name="plus" size={17} strokeWidth={2.4} /> Add
        </button>
      </form>
      {ideas.length > 0 && !full && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ideas">
          {ideas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => onAdd({ name: idea, note: '', url: '', named: true })}
              className="inline-flex min-h-10 items-center gap-1 rounded-full bg-ink/[.05] px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink active:scale-[.97]"
            >
              <Icon name="plus" size={13} className="text-muted" /> {idea}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- the result ---------------- */

/** How it's looking: a bar per place, the leader lit. Not a spreadsheet. */
export function Standings({ result }: { result: Tally }) {
  const top = Math.max(1, ...result.standings.map((entry) => entry.points));
  const shown = result.standings.filter((entry) => entry.points > 0 || entry.no > 0);
  if (!shown.length) return null;
  return (
    <ol className="grid gap-3.5" aria-label="How the vote is going">
      {shown.map((entry, index) => {
        const lead = result.leader?.option.id === entry.option.id;
        return (
          <li
            key={entry.option.id}
            className="fx-rise grid gap-1.5"
            style={{ ['--i' as string]: index }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  'min-w-0 truncate text-[13px] font-extrabold tracking-[.08em] uppercase',
                  lead ? 'text-ink' : 'text-ink-2',
                )}
              >
                {entry.option.name}
              </span>
              <span className="shrink-0 text-[12.5px] text-muted">
                {entry.love > 0 && `${entry.love} ♥ `}
                {entry.no > 0 && `· ${entry.no} no`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/[.06]">
                <div
                  className="fx-move h-full rounded-full"
                  style={{
                    width: `${Math.max(4, (entry.points / top) * 100)}%`,
                    background: lead
                      ? 'linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #ffb35c))'
                      : 'color-mix(in srgb, var(--w-ink, #2a1420) 22%, transparent)',
                  }}
                />
              </div>
              <span
                className={cn(
                  'w-8 shrink-0 text-right font-display text-[22px] leading-none font-extrabold tracking-[-0.03em]',
                  lead ? 'text-[var(--accent-ink)]' : 'text-ink-2',
                )}
                aria-label={`${entry.yes} would go`}
              >
                <CountUp value={entry.yes} mono={false} />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A clear favorite, as a ticket: the place, big, and what to do now. */
export function WinnerTicket({
  standing,
  voters,
  picked,
  close,
  children,
}: {
  standing: Standing;
  voters: number;
  picked: boolean;
  close: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      aria-live="polite"
      aria-label={`${standing.option.name} ${picked ? 'is the pick' : 'is winning'}`}
      className="relative isolate overflow-hidden rounded-[26px] text-[#fff4ea] shadow-lift"
      style={{
        background:
          'radial-gradient(70% 90% at 90% 0%, rgb(255 107 91 / .6), transparent 70%), linear-gradient(160deg, #2a1433, #4a2140)',
      }}
    >
      <PlaceArt
        name={standing.option.name}
        kind={standing.option.kind}
        pin="lg"
        className="fx-emerge h-[132px] w-full"
      />
      {/* The ticket's tear line. */}
      <div aria-hidden="true" className="relative h-0">
        <span className="absolute -top-3 -left-3 size-6 rounded-full bg-[var(--color-canvas)]" />
        <span className="absolute -top-3 -right-3 size-6 rounded-full bg-[var(--color-canvas)]" />
      </div>
      <div className="px-5 pt-5 pb-5 text-center sm:px-6">
        <p className="text-[12px] font-bold tracking-[.14em] text-[#ffc9b0] uppercase">
          {picked
            ? 'It’s decided'
            : voters < 2
              ? 'Leading so far'
              : close
                ? 'Ahead, just'
                : 'The group’s favorite'}
        </p>
        <p
          className="fx-stamp mt-2 font-display text-[36px] leading-[.95] font-extrabold tracking-[-0.035em] text-balance sm:text-[44px]"
          style={{ fontVariationSettings: "'wdth' 112" }}
        >
          {standing.option.name}
        </p>
        {standing.option.note && (
          <p className="mt-1.5 text-[14.5px] text-[#fff4ea]/75">{standing.option.note}</p>
        )}
        <p className="fx-rise mt-3 text-[16px] font-semibold">
          {standing.yes} of {voters} {voters === 1 ? 'is' : 'are'} in
          {standing.love > 0 && (
            <span className="font-normal text-[#fff4ea]/75"> · {standing.love} love it</span>
          )}
        </p>
        {children && <div className="mt-5 grid gap-2">{children}</div>}
      </div>
    </section>
  );
}

/** A button on the night ticket. */
export function TicketButton({
  icon,
  children,
  onClick,
  href,
  primary = false,
}: {
  icon: IconName;
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  primary?: boolean;
}) {
  const className = cn(
    'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full px-5 text-[15.5px] font-semibold transition-[transform,background-color] active:scale-[.98]',
    primary
      ? 'bg-[#fff4ea] text-[#2a1420] hover:bg-white'
      : 'bg-white/[.1] text-[#fff4ea] hover:bg-white/[.16]',
  );
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        <Icon name={icon} size={17} /> {children}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={className}>
      <Icon name={icon} size={17} /> {children}
    </button>
  );
}
