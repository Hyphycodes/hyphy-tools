'use client';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  addDays,
  dayFromNumber,
  dayNumber,
  formatDay,
  formatRange,
  formatTime,
  MAX_DAYS,
  weekdayOf,
} from '@/lib/tools/when';
import { ACCENT, GLOW, ON_ACCENT, tint } from './when-parts';

/*
 * Setting a plan up by touch: days tapped or swept across on a calendar, and the part of the day
 * picked on a sun's arc, with an hour strip underneath for exact hours.
 */

/* ---------------- The days ---------------- */

const WEEKS = 6;
/** How far ahead the calendar goes, in weeks: about a year. */
const AHEAD = 52;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const monthIndex = (day: string) => Number(day.slice(5, 7)) - 1;

/**
 * A sweep across the calendar, from the day it started on to the day it's over now: every day in
 * between (in date order, never in the past) is added, or taken away when it started on a picked
 * day. Adding stops at the most days a plan holds, nearest the start first.
 */
export function sweepDays(
  base: string[],
  anchor: string,
  to: string,
  add: boolean,
  today: string,
): string[] {
  const [a, b] = [dayNumber(anchor), dayNumber(to)];
  const direction = b >= a ? 1 : -1;
  const set = new Set(base);
  for (let value = a; ; value += direction) {
    const day = dayFromNumber(value);
    if (day >= today) {
      if (!add) set.delete(day);
      else if (set.size < MAX_DAYS) set.add(day);
    }
    if (value === b) break;
  }
  return [...set].sort();
}

/** The title over the weeks on show: 'September – October 2026'. */
function spanTitle(first: string, last: string) {
  const [a, b] = [monthIndex(first), monthIndex(last)];
  const [y1, y2] = [first.slice(0, 4), last.slice(0, 4)];
  if (a === b) return `${MONTH_NAMES[a]} ${y1}`;
  if (y1 === y2) return `${MONTH_NAMES[a]} – ${MONTH_NAMES[b]} ${y2}`;
  return `${MONTHS[a]} ${y1} – ${MONTHS[b]} ${y2}`;
}

/**
 * A wall calendar, six weeks from this one: tap a day, or press and sweep across several. On a
 * phone the sweep paints days instead of scrolling the page.
 */
export function DayPicker({
  today,
  selected,
  onChange,
}: {
  today: string;
  selected: string[];
  onChange: (days: string[]) => void;
}) {
  const sunday = addDays(today, -weekdayOf(today));
  const [offset, setOffset] = useState(0);
  const [sweep, setSweep] = useState<{ anchor: string; to: string; add: boolean } | null>(null);
  const [focused, setFocused] = useState(today);
  const grid = useRef<HTMLDivElement>(null);
  const start = addDays(sunday, offset * 7);
  const days = Array.from({ length: WEEKS * 7 }, (_, index) => addDays(start, index));
  const shown = new Set(
    sweep ? sweepDays(selected, sweep.anchor, sweep.to, sweep.add, today) : selected,
  );
  const full = selected.length >= MAX_DAYS;
  // Picked days out of sight: say where they are, and lead there.
  const later = selected.filter((day) => day > days[days.length - 1]);
  const earlier = selected.filter((day) => day < days[0]);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = (event.target as Element).closest<HTMLElement>('[data-day]');
    if (!target || target.dataset.off) return;
    event.preventDefault();
    // A touch is captured by the day it started on; let go, so the finger can travel.
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const pointer = event.pointerId;
    const anchor = target.dataset.day as string;
    const add = !selected.includes(anchor);
    const base = selected;
    let to = anchor;
    setSweep({ anchor, to, add });
    setFocused(anchor);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const hit = document
        .elementFromPoint(next.clientX, next.clientY)
        ?.closest<HTMLElement>('[data-day]');
      if (!hit || !grid.current?.contains(hit) || hit.dataset.off) return;
      const day = hit.dataset.day as string;
      if (day === to) return;
      to = day;
      setSweep({ anchor, to, add });
    };
    const end = (finish: PointerEvent) => {
      if (finish.pointerId !== pointer) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setSweep(null);
      if (finish.type === 'pointerup') onChange(sweepDays(base, anchor, to, add, today));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-day]');
    if (!target) return;
    const day = target.dataset.day as string;
    const move: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(event.key in move)) return;
    event.preventDefault();
    const next = addDays(day, move[event.key]);
    if (next < today || next > addDays(sunday, AHEAD * 7 + WEEKS * 7 - 1)) return;
    if (next < days[0]) setOffset((value) => Math.max(0, value - 1));
    if (next > days[days.length - 1]) setOffset((value) => value + 1);
    setFocused(next);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus(),
    );
  };

  const nav =
    'grid size-11 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/[.07] hover:text-ink disabled:opacity-25';

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="pl-1 text-[16px] font-bold tracking-[-0.01em] text-ink" aria-live="polite">
          {spanTitle(days[0] < today ? today : days[0], days[days.length - 1])}
        </p>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Earlier weeks"
            disabled={offset <= 0}
            onClick={() => setOffset((value) => Math.max(0, value - 4))}
            className={nav}
          >
            <Icon name="chevron-left" size={18} />
          </button>
          <button
            type="button"
            aria-label="Later weeks"
            disabled={offset >= AHEAD}
            onClick={() => setOffset((value) => Math.min(AHEAD, value + 4))}
            className={nav}
          >
            <Icon name="chevron-right" size={18} />
          </button>
        </div>
      </div>
      <div aria-hidden="true" className="grid grid-cols-7 px-0.5">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => (
          <span
            key={name}
            className="text-center text-[11px] font-semibold tracking-[0.06em] text-muted uppercase"
          >
            {name}
          </span>
        ))}
      </div>
      <div
        ref={grid}
        role="group"
        aria-label="Days. Tap a day, or sweep across several."
        onPointerDown={down}
        onKeyDown={key}
        className="grid touch-none grid-cols-7 gap-1 select-none [-webkit-touch-callout:none] sm:gap-1.5"
      >
        {days.map((day, index) => {
          const column = index % 7;
          const on = shown.has(day);
          const past = day < today;
          const off = past || (full && !on && !sweep);
          const isToday = day === today;
          const first = day.slice(8) === '01';
          const joinLeft = on && column > 0 && shown.has(addDays(day, -1));
          const joinRight = on && column < 6 && shown.has(addDays(day, 1));
          // Months alternate a faint shade, the way a long calendar reads at a glance.
          const shade = monthIndex(day) % 2 === 1;
          return (
            <button
              key={day}
              type="button"
              data-day={day}
              data-off={past ? '1' : undefined}
              aria-pressed={on}
              aria-label={`${formatDay(day)}${isToday ? ', today' : ''}`}
              disabled={off}
              tabIndex={day === focused ? 0 : -1}
              onClick={(event) => {
                // Pointers are handled on press; this is the keyboard's Enter and Space.
                if (event.detail === 0 && !past)
                  onChange(sweepDays(selected, day, day, !selected.includes(day), today));
              }}
              className={cn(
                'fx-move relative flex h-[52px] min-w-0 flex-col items-start justify-between rounded-[14px] p-1.5 text-left sm:h-[64px] sm:p-2',
                !on && !past && 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line)]',
                !on && !past && 'enabled:hover:shadow-[inset_0_0_0_1.5px_var(--accent-ink)]',
                past && 'opacity-35',
                off && !past && 'opacity-50',
                on && 'z-[1]',
              )}
              style={
                on
                  ? {
                      background: ACCENT,
                      color: ON_ACCENT,
                      boxShadow: `0 8px 18px -10px ${GLOW}, inset 0 1px 0 rgb(255 255 255 / .4)`,
                      borderTopLeftRadius: joinLeft ? 5 : undefined,
                      borderBottomLeftRadius: joinLeft ? 5 : undefined,
                      borderTopRightRadius: joinRight ? 5 : undefined,
                      borderBottomRightRadius: joinRight ? 5 : undefined,
                    }
                  : {
                      background: shade && !past ? tint(10) : undefined,
                      boxShadow: isToday ? `inset 0 0 0 2px ${tint(80)}` : undefined,
                    }
              }
            >
              {(first || index === 0) && (
                <span
                  className={cn(
                    'text-[9.5px] leading-none font-bold tracking-[0.06em] uppercase sm:text-[10.5px]',
                    on ? 'opacity-70' : 'text-[var(--accent-ink)]',
                  )}
                >
                  {MONTHS[monthIndex(day)]}
                </span>
              )}
              <span
                className={cn(
                  'font-display mt-auto text-[17px] leading-none sm:text-[19px]',
                  on ? 'font-bold' : isToday ? 'font-bold text-ink' : 'font-medium text-ink-2',
                )}
              >
                {Number(day.slice(8))}
              </span>
              {isToday && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-1.5 right-1.5 text-[8.5px] font-bold tracking-[0.04em] uppercase sm:top-2 sm:right-2 sm:text-[9.5px]',
                    !on && 'text-[var(--accent-ink)]',
                  )}
                >
                  Today
                </span>
              )}
              {on && (
                <Icon
                  name="check"
                  size={13}
                  strokeWidth={3}
                  className="fx-pop absolute right-2 bottom-2 hidden sm:block"
                />
              )}
            </button>
          );
        })}
      </div>
      {(later.length > 0 || earlier.length > 0) && (
        <button
          type="button"
          onClick={() => {
            const target = (later[0] ?? earlier[0]) as string;
            setOffset(
              Math.max(
                0,
                Math.min(AHEAD, Math.floor((dayNumber(target) - dayNumber(sunday)) / 7) - 1),
              ),
            );
          }}
          className="mx-auto inline-flex min-h-10 items-center gap-1 rounded-full px-3.5 text-[13.5px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-ink/[.05]"
        >
          {!later.length && <Icon name="chevron-left" size={15} />}
          {later.length + earlier.length} more picked {later.length ? 'later' : 'earlier'}
          {later.length > 0 && <Icon name="chevron-right" size={15} />}
        </button>
      )}
    </div>
  );
}

/* ---------------- The time of day ---------------- */

/** Parts of the day, instead of two clocks. `sun` is where the sun sits on its arc. */
export const PARTS = [
  { id: 'morning', label: 'Morning', start: 8, end: 12, sun: 0.2 },
  { id: 'afternoon', label: 'Afternoon', start: 12, end: 17, sun: 0.5 },
  { id: 'evening', label: 'Evening', start: 17, end: 22, sun: 0.82 },
] as const;

/** The parts a range is made of exactly (a run of them), or null for custom hours. */
export function partsOf(start: number, end: number): [number, number] | null {
  const a = PARTS.findIndex((part) => part.start === start);
  const b = PARTS.findIndex((part) => part.end === end);
  return a >= 0 && b >= a ? [a, b] : null;
}

/** 'Evening', 'Afternoon – Evening', 'All day', or null for custom hours. */
export function partsName(start: number, end: number) {
  const run = partsOf(start, end);
  if (!run) return start === 0 && end === 24 ? 'All day' : null;
  if (run[0] === 0 && run[1] === PARTS.length - 1) return 'All day';
  return run[0] === run[1]
    ? PARTS[run[0]].label
    : `${PARTS[run[0]].label} – ${PARTS[run[1]].label}`;
}

/** The sun on its arc over the horizon: where in the day these hours sit. */
function SunArc({ at, on, evening }: { at: number; on: boolean; evening?: boolean }) {
  const angle = Math.PI * (1 - at);
  const x = 24 + 17 * Math.cos(angle);
  const y = 25 - 17 * Math.sin(angle);
  return (
    <svg aria-hidden="true" viewBox="0 0 48 30" className="h-[30px] w-12 shrink-0">
      <path
        d="M7 25a17 17 0 0 1 34 0"
        fill="none"
        stroke="currentColor"
        strokeOpacity={on ? 0.45 : 0.25}
        strokeWidth="1.6"
        strokeDasharray="2 2.8"
        strokeLinecap="round"
      />
      <path d="M3 25h42" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.8" />
      <circle
        cx={x}
        cy={y}
        r={on ? 5.6 : 4.6}
        fill={on ? (evening ? GLOW : ACCENT) : 'currentColor'}
        fillOpacity={on ? 1 : 0.4}
        className="fx-move"
      />
    </svg>
  );
}

/**
 * Morning, afternoon, evening: tap one, or tap another to stretch across them. Under them, the
 * whole day as a strip of hours whose ends can be dragged for exact hours.
 */
export function DayParts({
  start,
  end,
  onChange,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const run = partsOf(start, end);

  const tap = (index: number) => {
    const part = PARTS[index];
    if (!run) return onChange(part.start, part.end);
    const [a, b] = run;
    if (index < a || index > b) {
      // Stretch to take it in.
      const [from, to] = [Math.min(a, index), Math.max(b, index)];
      return onChange(PARTS[from].start, PARTS[to].end);
    }
    if (a === b) return; // The only one: keep it.
    if (index === a) return onChange(PARTS[a + 1].start, PARTS[b].end);
    if (index === b) return onChange(PARTS[a].start, PARTS[b - 1].end);
    onChange(part.start, part.end); // One in the middle: just that one.
  };

  return (
    <div className="grid gap-3">
      <div role="group" aria-label="Time of day" className="grid grid-cols-3 gap-2">
        {PARTS.map((part, index) => {
          const on = !!run && index >= run[0] && index <= run[1];
          return (
            <button
              key={part.id}
              type="button"
              aria-pressed={on}
              onClick={() => tap(index)}
              className={cn(
                'fx-move flex min-h-[92px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[18px] px-1.5 py-2.5 text-center active:scale-[.97]',
                on
                  ? 'text-[var(--on-accent,#12110d)]'
                  : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_1.5px_var(--accent-ink)]',
              )}
              style={
                on
                  ? {
                      background: `linear-gradient(160deg, ${tint(70)}, ${ACCENT})`,
                      boxShadow: `inset 0 0 0 2px ${ACCENT}, 0 10px 22px -14px ${GLOW}`,
                    }
                  : undefined
              }
            >
              <SunArc at={part.sun} on={on} evening={part.id === 'evening'} />
              <span className="text-[15px] leading-tight font-bold sm:text-[16px]">
                {part.label}
              </span>
              <span
                className={cn(
                  'text-[11.5px] leading-tight font-medium whitespace-nowrap sm:text-[12.5px]',
                  on ? 'opacity-75' : 'text-muted',
                )}
              >
                {formatRange(part.start * 60, part.end * 60)}
              </span>
            </button>
          );
        })}
      </div>
      <HourStrip start={start} end={end} onChange={onChange} />
    </div>
  );
}

/**
 * The whole day, midnight to midnight, with the hours in the plan lit. Drag either end (or use
 * the arrow keys on it) for exact hours.
 */
function HourStrip({
  start,
  end,
  onChange,
}: {
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<'start' | 'end' | null>(null);
  const at = (hour: number) => `${(hour / 24) * 100}%`;

  const hourAt = (x: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box) return null;
    return Math.round(Math.min(1, Math.max(0, (x - box.left) / box.width)) * 24);
  };

  const set = (which: 'start' | 'end', hour: number) => {
    if (which === 'start') onChange(Math.min(Math.max(0, hour), end - 1), end);
    else onChange(start, Math.max(Math.min(24, hour), start + 1));
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const hour = hourAt(event.clientX);
    if (hour === null) return;
    event.preventDefault();
    // The nearer end follows the finger; between them, the nearer one too.
    const which: 'start' | 'end' = Math.abs(hour - start) <= Math.abs(hour - end) ? 'start' : 'end';
    const pointer = event.pointerId;
    setHeld(which);
    set(which, hour);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      const value = hourAt(next.clientX);
      if (value !== null) set(which, value);
    };
    const up = (finish: PointerEvent) => {
      if (finish.pointerId !== pointer) return;
      setHeld(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // The ends read their own latest values from props on every render, so `set` stays current.
  const knob = (which: 'start' | 'end') => {
    const value = which === 'start' ? start : end;
    return (
      <span
        role="slider"
        tabIndex={0}
        aria-label={which === 'start' ? 'From' : 'Until'}
        aria-valuemin={which === 'start' ? 0 : 1}
        aria-valuemax={which === 'start' ? 23 : 24}
        aria-valuenow={value}
        aria-valuetext={value === 24 ? 'Midnight' : formatTime(value * 60)}
        onKeyDown={(event) => {
          const change: Record<string, number> = {
            ArrowLeft: -1,
            ArrowDown: -1,
            ArrowRight: 1,
            ArrowUp: 1,
          };
          if (!(event.key in change)) return;
          event.preventDefault();
          set(which, value + change[event.key]);
        }}
        className={cn(
          'fx-move absolute top-1/2 grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-surface shadow-[0_2px_8px_-2px_rgb(0_0_0/.25),0_0_0_2px_var(--accent-ink)] outline-offset-4',
          held === which && 'scale-110',
        )}
        style={{ left: at(value) }}
      >
        <span className="size-2 rounded-full" style={{ background: GLOW }} />
      </span>
    );
  };

  return (
    <div className="grid gap-1.5 rounded-[18px] bg-surface px-4 pt-3 pb-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
          Hours
        </span>
        <span className="font-display text-[16px] font-bold text-ink" aria-live="polite">
          {formatRange(start * 60, end * 60)}
        </span>
      </div>
      <div
        ref={track}
        onPointerDown={down}
        className="relative h-11 cursor-pointer touch-none select-none"
      >
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full bg-ink/[.07]"
        />
        {Array.from({ length: 23 }, (_, index) => index + 1).map((hour) => (
          <span
            key={hour}
            aria-hidden="true"
            className={cn(
              'absolute top-1/2 w-px -translate-y-1/2 bg-ink/15',
              hour % 6 ? 'h-1.5' : 'h-3.5',
            )}
            style={{ left: at(hour) }}
          />
        ))}
        <span
          aria-hidden="true"
          className="fx-move absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full"
          style={{
            left: at(start),
            width: `${((end - start) / 24) * 100}%`,
            background: `linear-gradient(90deg, ${ACCENT}, ${GLOW})`,
          }}
        />
        {knob('start')}
        {knob('end')}
      </div>
      <div aria-hidden="true" className="relative h-4 text-[10.5px] font-medium text-muted">
        <span className="absolute left-0">12a</span>
        <span className="absolute -translate-x-1/2" style={{ left: at(6) }}>
          6a
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: at(12) }}>
          noon
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: at(18) }}>
          6p
        </span>
        <span className="absolute right-0">12a</span>
      </div>
    </div>
  );
}
