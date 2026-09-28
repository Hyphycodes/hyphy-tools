'use client';
import {
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import {
  formatDay,
  formatRange,
  formatTime,
  inBox,
  paintBox,
  shortDay,
  slotsPerDay,
  slotStart,
  splitByMask,
  toggleDay,
  weekdayName,
  type Tally,
  type TimeWindow,
  type WhenPerson,
  type WhenPlan,
} from '@/lib/tools/when';
import { ACCENT, Avatar, colorOf, GLOW, ON_ACCENT, tint } from './when-parts';

/*
 * The time grid is the app: days across, time slots down. Your times are painted on it in your
 * color; everyone's together light it up, brighter where more people are free.
 */

/** Where an arrow key leads in a grid stored day by day: up/down are slots, left/right days. */
function step(key: string, index: number, rows: number, days: number): number | null {
  const day = Math.floor(index / rows);
  const slot = index % rows;
  if (key === 'ArrowUp') return slot > 0 ? index - 1 : index;
  if (key === 'ArrowDown') return slot < rows - 1 ? index + 1 : index;
  if (key === 'ArrowLeft') return day > 0 ? index - rows : index;
  if (key === 'ArrowRight') return day < days - 1 ? index + rows : index;
  if (key === 'Home') return day * rows;
  if (key === 'End') return day * rows + rows - 1;
  return null;
}

/** The pinned time labels' width (w-11): days scroll underneath them. */
const LABELS = 44;

/**
 * The cell under a point, after pulling the point inside the part of the grid that's on screen:
 * dragging past an edge keeps reaching the edge row or day, the way a spreadsheet selects.
 */
function cellNear(grid: HTMLElement | null, x: number, y: number, last: number) {
  const scroller = grid?.parentElement;
  const first = grid?.querySelector('[data-cell="0"]')?.getBoundingClientRect();
  const end = grid?.querySelector(`[data-cell="${last}"]`)?.getBoundingClientRect();
  if (!grid || !scroller || !first || !end) return null;
  const view = scroller.getBoundingClientRect();
  // 6px in from each edge: hit-testing follows the cells' rounded corners.
  const left = Math.max(first.left, view.left + LABELS) + 6;
  const right = Math.min(end.right, view.right) - 6;
  const top = Math.max(first.top, 0) + 6;
  const bottom = Math.min(end.bottom, window.innerHeight) - 6;
  const cell = document
    .elementFromPoint(Math.min(Math.max(x, left), right), Math.min(Math.max(y, top), bottom))
    ?.closest<HTMLElement>('[data-cell]');
  return cell && grid.contains(cell) ? Number(cell.dataset.cell) : null;
}

function focusCell(grid: HTMLElement | null, index: number) {
  grid?.querySelector<HTMLElement>(`[data-cell="${index}"]`)?.focus();
}

const rowHeight = (plan: WhenPlan) => (plan.slot === 60 ? 'h-11 lg:h-10' : 'h-8 lg:h-7');

/**
 * Days across, time slots down, with the times pinned on the left while the days scroll
 * sideways on a small screen. Stored day by day: cell = day × rows + slot.
 */
function TimeGrid({
  plan,
  today,
  label,
  gridRef,
  readOnly,
  header,
  cell,
  ...handlers
}: {
  plan: WhenPlan;
  today: string;
  label: string;
  gridRef: Ref<HTMLDivElement>;
  readOnly?: boolean;
  header: (day: string, index: number) => ReactNode;
  cell: (index: number, day: number, slot: number) => ReactNode;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerOver?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: () => void;
  onClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const rows = slotsPerDay(plan);
  const hourly = plan.slot === 60;
  const width = `calc(${LABELS}px + ${plan.days.length} * 42px)`;
  return (
    // No padding on the left: scrolled days must pass cleanly under the pinned times.
    <div className="-mr-1 overflow-x-auto overscroll-x-contain pt-1 pr-1 pb-2">
      <div
        ref={gridRef}
        role="grid"
        aria-label={label}
        aria-readonly={readOnly || undefined}
        className="grid gap-[3px] select-none [-webkit-touch-callout:none]"
        style={{ minWidth: width }}
        {...handlers}
      >
        <div role="row" className="flex gap-[3px]">
          <div role="columnheader" className="sticky left-0 z-10 w-11 shrink-0 bg-surface">
            <span className="sr-only">Time</span>
          </div>
          {plan.days.map((day, index) => (
            <div
              key={day}
              role="columnheader"
              className={cn('min-w-[39px] flex-1 basis-0', day < today && 'opacity-50')}
            >
              {header(day, index)}
            </div>
          ))}
        </div>
        {Array.from({ length: rows }, (_, slot) => (
          <div
            key={slot}
            role="row"
            // Half-hour grids get a little more air before each hour.
            className={cn('flex gap-[3px]', !hourly && slot > 0 && slot % 2 === 0 && 'mt-[3px]')}
          >
            <div
              role="rowheader"
              className="sticky left-0 z-10 w-11 shrink-0 bg-surface pr-1.5 text-right"
            >
              <span
                className={cn(
                  'num block -translate-y-[45%] text-[10.5px] leading-none font-medium whitespace-nowrap text-muted',
                  !hourly && slot % 2 === 1 && 'sr-only',
                )}
              >
                {formatTime(slotStart(plan, slot))}
              </span>
            </div>
            {plan.days.map((_, day) => cell(day * rows + slot, day, slot))}
          </div>
        ))}
        <div aria-hidden="true" className="flex">
          <span className="num sticky left-0 z-10 w-11 shrink-0 -translate-y-[45%] bg-surface pr-1.5 text-right text-[10.5px] leading-none font-medium whitespace-nowrap text-muted">
            {formatTime(plan.end * 60)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 'SAT' over '3', naming the month only where it changes, the way a calendar reads. */
function DayName({ day, previous, today }: { day: string; previous?: string; today: string }) {
  return (
    <>
      <span
        className={cn(
          'block text-[10.5px] font-bold tracking-[0.06em] text-muted uppercase',
          day === today && '!text-[var(--accent-ink)]',
        )}
      >
        {day === today ? 'Today' : weekdayName(day)}
      </span>
      <span className="num mt-0.5 block text-[13px] leading-tight font-bold whitespace-nowrap text-ink">
        {previous?.slice(0, 7) === day.slice(0, 7) ? Number(day.slice(8)) : shortDay(day)}
      </span>
    </>
  );
}

/* ---------------- Painting your times ---------------- */

/**
 * Your times: tap a cell, or press and drag a box, to paint it in your color (or erase, starting
 * on a painted cell). Under your paint, faintly, where everyone else is free.
 */
export function PaintGrid({
  plan,
  cells,
  today,
  color,
  others,
  onChange,
}: {
  plan: WhenPlan;
  cells: Uint8Array;
  today: string;
  /** This person's color. */
  color: string;
  /** Everyone else's times, drawn faintly underneath. */
  others: Tally | null;
  onChange: (update: (cells: Uint8Array) => Uint8Array) => void;
}) {
  const rows = slotsPerDay(plan);
  const grid = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  const [stroke, setStroke] = useState<{ from: number; to: number; value: 0 | 1 } | null>(null);
  const [active, setActive] = useState(0);
  const height = rowHeight(plan);

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = (event.target as Element).closest<HTMLElement>('[data-cell]');
    if (!target || painting.current) return;
    event.preventDefault();
    // A touch is captured by the cell it started on; let go, so the finger can travel.
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const pointer = event.pointerId;
    const from = Number(target.dataset.cell);
    const last = plan.days.length * rows - 1;
    // Starting on a painted cell erases; starting on an empty one paints.
    const value: 0 | 1 = cells[from] ? 0 : 1;
    let to = from;
    let [x, y] = [event.clientX, event.clientY];
    let moved = false;
    let frame = 0;
    painting.current = true;
    setStroke({ from, to, value });
    setActive(from);
    const reach = () => {
      const index = cellNear(grid.current, x, y, last);
      if (index === null || index === to) return;
      to = index;
      setStroke({ from, to, value });
    };
    // Held near the bottom or top of the screen, or the edge of the days, the grid scrolls on.
    const drift = () => {
      const scroller = grid.current?.parentElement;
      const first = grid.current?.querySelector('[data-cell="0"]')?.getBoundingClientRect();
      const end = grid.current?.querySelector(`[data-cell="${last}"]`)?.getBoundingClientRect();
      if (moved && scroller && first && end) {
        const view = scroller.getBoundingClientRect();
        // Only while there's more grid past the edge: never on into the rest of the page.
        const vertical =
          y > window.innerHeight - 40 && end.bottom > window.innerHeight
            ? 1
            : y < 104 && first.top < 104
              ? -1
              : 0;
        const sideways = x > view.right - 24 ? 1 : x < view.left + LABELS + 16 ? -1 : 0;
        if (vertical) window.scrollBy(0, vertical * 12);
        if (sideways) scroller.scrollLeft += sideways * 10;
        if (vertical || sideways) reach();
      }
      frame = requestAnimationFrame(drift);
    };
    frame = requestAnimationFrame(drift);
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointer) return;
      [x, y] = [next.clientX, next.clientY];
      moved ||= Math.hypot(x - event.clientX, y - event.clientY) > 6;
      reach();
    };
    const end = (finish: PointerEvent) => {
      if (finish.pointerId !== pointer) return;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      painting.current = false;
      setStroke(null);
      // A cancelled pointer (the browser took the gesture over) paints nothing.
      if (finish.type === 'pointerup')
        onChange((current) => paintBox(current, rows, from, to, value));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as Element).closest<HTMLElement>('[data-cell]');
    if (!target) return;
    const index = Number(target.dataset.cell);
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onChange((current) => paintBox(current, rows, index, index, current[index] ? 0 : 1));
      return;
    }
    const next = step(event.key, index, rows, plan.days.length);
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    focusCell(grid.current, next);
  };

  /** A cell as it shows right now, with the stroke under way painted in. */
  const shown = (index: number) =>
    stroke && inBox(rows, stroke.from, stroke.to, index) ? stroke.value : cells[index];
  const othersTotal = others?.total ?? 0;

  return (
    <TimeGrid
      plan={plan}
      today={today}
      label="Your times. Mark the times you’re free."
      gridRef={grid}
      onPointerDown={down}
      onKeyDown={key}
      header={(day, index) => {
        const start = index * rows;
        const allFree = cells.subarray(start, start + rows).every(Boolean);
        return (
          <button
            type="button"
            onClick={() => onChange((current) => toggleDay(current, rows, index))}
            aria-label={`${allFree ? 'Clear' : 'Mark all of'} ${formatDay(day)}`}
            className="fx-move flex h-12 w-full flex-col items-center justify-center rounded-[11px] text-center hover:bg-ink/[.06]"
            style={allFree ? { background: tint(40, color) } : undefined}
          >
            <DayName day={day} previous={plan.days[index - 1]} today={today} />
          </button>
        );
      }}
      cell={(index, day, slot) => {
        const value = shown(index);
        // Painted runs join up down a day, like one brush stroke.
        const above = value && slot > 0 && shown(index - 1);
        const below = value && slot < rows - 1 && shown(index + 1);
        const underneath = othersTotal ? (others?.counts[index] ?? 0) / othersTotal : 0;
        return (
          <div
            key={index}
            role="gridcell"
            data-cell={index}
            aria-selected={value === 1}
            aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)}`}
            tabIndex={index === active ? 0 : -1}
            className={cn(
              'min-w-[39px] flex-1 basis-0 cursor-pointer touch-none rounded-[10px] transition-[background-color,border-radius] duration-100',
              height,
              !value && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-ink/[.07]',
            )}
            style={
              value
                ? {
                    background: color,
                    boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .45)',
                    borderTopLeftRadius: above ? 3 : undefined,
                    borderTopRightRadius: above ? 3 : undefined,
                    borderBottomLeftRadius: below ? 3 : undefined,
                    borderBottomRightRadius: below ? 3 : undefined,
                  }
                : {
                    background: underneath
                      ? tint(Math.round(10 + 32 * underneath))
                      : 'var(--color-subtle)',
                  }
            }
          />
        );
      }}
    />
  );
}

/* ---------------- Everyone together ---------------- */

/**
 * Everyone's times as heat: brighter where more are free, a check where everyone is, the best
 * time glowing. Under each square, a thin bar in the colors of whoever's free then.
 */
export function HeatGrid({
  plan,
  tally,
  best,
  today,
  picked,
  onPick,
  spot,
}: {
  plan: WhenPlan;
  tally: Tally;
  /** The window that glows. */
  best: TimeWindow | null;
  today: string;
  picked: number | null;
  onPick: (index: number | null) => void;
  /** One person to pick out, by their place in the plan. */
  spot: number | null;
}) {
  const rows = slotsPerDay(plan);
  const total = tally.total;
  const grid = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => picked ?? 0);
  const height = rowHeight(plan);
  const spotColor = spot === null ? null : colorOf(plan, plan.people[spot]?.id);

  const choose = (index: number) => {
    onPick(index);
    setActive(index);
  };

  return (
    <TimeGrid
      plan={plan}
      today={today}
      label="Everyone’s times. Each square shows how many are free."
      gridRef={grid}
      readOnly
      onClick={(event) => {
        const target = (event.target as Element).closest<HTMLElement>('[data-cell]');
        if (target) choose(Number(target.dataset.cell));
      }}
      onKeyDown={(event) => {
        const target = (event.target as Element).closest<HTMLElement>('[data-cell]');
        if (!target) return;
        const next = step(event.key, Number(target.dataset.cell), rows, plan.days.length);
        if (next === null) return;
        event.preventDefault();
        choose(next);
        focusCell(grid.current, next);
      }}
      header={(day, index) => (
        <div className="flex h-12 flex-col items-center justify-center text-center">
          <DayName day={day} previous={plan.days[index - 1]} today={today} />
        </div>
      )}
      cell={(index, day, slot) => {
        const count = tally.counts[index];
        const mask = tally.masks[index];
        const share = total ? count / total : 0;
        const everyone = total > 1 && count === total;
        const glowing = !!best && day === best.day && slot >= best.from && slot < best.to;
        const spotted = spot !== null && !!(mask & (1 << spot));
        const dim = spot !== null && !spotted;
        const colors = total > 1 ? splitByMask(plan, mask).free : [];
        return (
          <div
            key={index}
            role="gridcell"
            data-cell={index}
            aria-selected={index === picked}
            aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)} – ${count} of ${total} free${glowing ? ', the best time' : ''}`}
            tabIndex={index === active ? 0 : -1}
            className={cn(
              'num relative grid min-w-[39px] flex-1 basis-0 cursor-pointer place-items-center overflow-hidden rounded-[9px] text-[11.5px] font-bold transition-[opacity,box-shadow] duration-200',
              height,
              !count && 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
              count > 0 && !everyone && 'text-ink-2',
              glowing && 'fx-ping z-[1]',
              index === picked && 'outline-2 outline-offset-2 outline-[var(--accent-ink)]',
              dim && 'opacity-30',
            )}
            style={
              count
                ? {
                    background: everyone
                      ? `linear-gradient(160deg, ${ACCENT}, ${tint(85, GLOW)})`
                      : tint(Math.round(10 + 62 * share)),
                    color: everyone ? ON_ACCENT : undefined,
                    boxShadow: spotted
                      ? `inset 0 0 0 2.5px ${spotColor}`
                      : glowing
                        ? `0 0 0 2.5px ${GLOW}, 0 4px 22px 0 ${tint(80, GLOW)}`
                        : undefined,
                  }
                : undefined
            }
          >
            {count > 0 && (everyone ? <Icon name="check" size={15} strokeWidth={3} /> : count)}
            {colors.length > 0 && (
              <span aria-hidden="true" className="absolute inset-x-1 bottom-1 flex h-[3px] gap-px">
                {colors.map((person) => (
                  <span
                    key={person.id}
                    className="h-full flex-1 rounded-full"
                    style={{ background: colorOf(plan, person.id) }}
                  />
                ))}
              </span>
            )}
          </div>
        );
      }}
    />
  );
}

/** Who's free, and who isn't, in one square. */
export function CellDetail({
  plan,
  tally,
  index,
}: {
  plan: WhenPlan;
  tally: Tally;
  index: number;
}) {
  const rows = slotsPerDay(plan);
  const day = Math.floor(index / rows);
  const slot = index % rows;
  const { free, busy } = splitByMask(plan, tally.masks[index]);
  return (
    <div
      aria-live="polite"
      className="fx-rise grid gap-3 rounded-[18px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-bold text-ink">
          {formatDay(plan.days[day])} ·{' '}
          {formatRange(slotStart(plan, slot), slotStart(plan, slot + 1))}
        </p>
        <p className="num text-[13.5px] font-semibold text-ink-2">
          {free.length === tally.total && tally.total > 1
            ? 'Everyone’s free'
            : `${free.length}/${tally.total} free`}
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {free.map((person) => (
          <PersonChip key={person.id} plan={plan} person={person} free />
        ))}
        {busy.map((person) => (
          <PersonChip key={person.id} plan={plan} person={person} free={false} />
        ))}
      </ul>
    </div>
  );
}

function PersonChip({ plan, person, free }: { plan: WhenPlan; person: WhenPerson; free: boolean }) {
  return (
    <li
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-1 text-[13px] font-semibold',
        free
          ? 'bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-line)]'
          : 'text-faint line-through',
      )}
    >
      <Avatar
        name={person.name}
        color={free ? colorOf(plan, person.id) : 'var(--color-well)'}
        size={24}
        ring={false}
      />
      {person.name}
      <span className="sr-only">{free ? ' is free' : ' isn’t free'}</span>
    </li>
  );
}
