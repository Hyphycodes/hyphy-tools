'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { readLocal, writeLocal } from '@/lib/share/local';
import {
  bestTimes,
  bestTimesText,
  cellsOf,
  cleanTimeZone,
  countCells,
  describeDays,
  emptyCells,
  findByName,
  formatDay,
  formatDuration,
  formatRange,
  formatTime,
  inBox,
  localDay,
  MAX_DAYS,
  MAX_PEOPLE,
  mergePlans,
  monthOf,
  monthTitle,
  monthWeeks,
  newPlan,
  notFree,
  packCells,
  paintBox,
  planHours,
  quickPicks,
  samplePlan,
  shiftMonth,
  shortDay,
  slotsPerDay,
  slotStart,
  splitByMask,
  tallyPlan,
  toggleDay,
  weekdayName,
  whenPlanSchema,
  whenSavedSchema,
  windowWhen,
  withPerson,
  type Month,
  type SlotSize,
  type Tally,
  type TimeWindow,
  type WhenPerson,
  type WhenPlan,
  type WhenSaved,
} from '@/lib/tools/when';
import { CopyButton, IconButton, Label, Note, Surface } from './kit';
import { ShareLinkCard } from './share-link';

/*
 * When?: pick the days and hours, share one link, and everyone paints when they're free. The plan
 * and everyone's times live inside the link (after the #, which browsers never send to a server).
 * This device keeps a copy of each plan, so links that come back from different people combine.
 */

const ACCENT = '#ffb35c';
const ACCENT_RGB = '255 179 92';
/** Dark ink for text on the accent. */
const ON_ACCENT = '#12110d';
const STORE = 'hyphy.when.v1.';
/** Plans a device remembers; older ones still open from their links. */
const KEEP = 20;

/* ---------------- This device and the address bar ---------------- */

function savedPlans(): WhenSaved[] {
  const found: WhenSaved[] = [];
  try {
    const { localStorage } = window;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      const record = key?.startsWith(STORE) ? readLocal(key, whenSavedSchema) : null;
      if (record) found.push(record);
    }
  } catch {
    // Storage can be switched off entirely (private windows, strict settings): nothing to list.
  }
  return found.sort((a, b) => b.saved - a.saved);
}

function keepPlan(plan: WhenPlan, me: string | null) {
  writeLocal(STORE + plan.id, { v: 1, plan, me, saved: Date.now() } satisfies WhenSaved);
  for (const old of savedPlans().slice(KEEP)) writeLocal(STORE + old.plan.id, null);
}

let addressWrites: Promise<void> = Promise.resolve();

/** Address-bar writes queue up, so a slow one can never land after a newer one. */
function showInAddress(plan: WhenPlan | null) {
  addressWrites = addressWrites
    .then(() => (plan ? writeHash(plan) : clearHash()))
    .catch(() => undefined);
}

/** Link-state fragments start with z or j and run long; anything else (#top) isn't a plan. */
const looksLikePlan = (hash: string) => /^#[zj][A-Za-z0-9_-]{16}/.test(hash);

type Opened = { plan: WhenPlan; me: string | null; note: string | null };

type Screen =
  | { kind: 'loading' }
  | { kind: 'start'; today: string; saved: WhenSaved[]; broken: boolean }
  | ({ kind: 'plan'; today: string } & Opened);

/**
 * A plan arriving from a link meets the copy this device kept: everyone from both is the plan.
 * Also says whether the device added anyone, so the address bar can catch up.
 */
function combineWithDevice(incoming: WhenPlan): [Opened, boolean] {
  const kept = readLocal(STORE + incoming.id, whenSavedSchema);
  let plan = incoming;
  let note: string | null = null;
  let more = 0;
  if (kept) {
    const merged = mergePlans(kept.plan, incoming);
    if (merged.ok) {
      plan = merged.plan;
      more = plan.people.filter(
        (person) =>
          !incoming.people.some(
            (entry) => entry.id === person.id && entry.updated === person.updated,
          ),
      ).length;
      if (more)
        note = `Also shows ${more} ${more === 1 ? 'answer' : 'answers'} from links you opened here before.`;
    } else if (merged.reason === 'too-many') {
      note = `With the links you opened here before, this plan would pass ${MAX_PEOPLE} people, so it shows just this link.`;
    }
  }
  const me = kept?.me && plan.people.some((person) => person.id === kept.me) ? kept.me : null;
  keepPlan(plan, me);
  return [{ plan, me, note }, more > 0];
}

async function openAddress(): Promise<Screen> {
  const today = localDay(new Date());
  const hash = window.location.hash;
  if (!looksLikePlan(hash)) return { kind: 'start', today, saved: savedPlans(), broken: false };
  const incoming = await decodeState(hash, whenPlanSchema);
  if (!incoming) return { kind: 'start', today, saved: savedPlans(), broken: true };
  const [opened, grew] = combineWithDevice(incoming);
  if (grew) showInAddress(opened.plan);
  return { kind: 'plan', today, ...opened };
}

/* ---------------- Small hooks and helpers ---------------- */

const never = () => () => {};

function currentTimeZone() {
  try {
    return cleanTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
}

/** This visitor's time zone; null while rendering on the server. */
const useTimeZone = () => useSyncExternalStore(never, currentTimeZone, () => null);

const COARSE = '(pointer: coarse)';
function watchCoarse(onChange: () => void) {
  const query = window.matchMedia(COARSE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/** A finger rather than a mouse: painting and scrolling need saying differently. */
const useCoarsePointer = () =>
  useSyncExternalStore(
    watchCoarse,
    () => window.matchMedia(COARSE).matches,
    () => false,
  );

/** Scrolls an element into view when it's out of sight, gently unless motion is reduced. */
function reveal(element: HTMLElement | null) {
  if (!element) return;
  const { top } = element.getBoundingClientRect();
  if (top >= 0 && top < window.innerHeight * 0.75) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
}

/** 'America/Chicago' → 'Chicago', for "mark times in Chicago time". */
const zoneCity = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

const slotWords = (slot: SlotSize) => (slot === 60 ? '1-hour slots' : '30-minute slots');

function freshPersonId(plan: WhenPlan) {
  let id = newId(6);
  while (plan.people.some((person) => person.id === id)) id = newId(6);
  return id;
}

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

/** The pinned time labels' width (w-10): days scroll underneath them. */
const LABELS = 40;

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
  // 8px in from each edge: hit-testing follows the cells' rounded corners.
  const left = Math.max(first.left, view.left + LABELS) + 8;
  const right = Math.min(end.right, view.right) - 8;
  const top = Math.max(first.top, 0) + 8;
  const bottom = Math.min(end.bottom, window.innerHeight) - 8;
  const cell = document
    .elementFromPoint(Math.min(Math.max(x, left), right), Math.min(Math.max(y, top), bottom))
    ?.closest<HTMLElement>('[data-cell]');
  return cell && grid.contains(cell) ? Number(cell.dataset.cell) : null;
}

function focusCell(grid: HTMLElement | null, index: number) {
  grid?.querySelector<HTMLElement>(`[data-cell="${index}"]`)?.focus();
}

/* ---------------- The tool ---------------- */

export function WhenTool() {
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const top = useRef<HTMLDivElement>(null);

  // The address decides what opens: a plan from a link, or a fresh start.
  useEffect(() => {
    let live = true;
    const open = () => {
      void openAddress().then((next) => {
        if (live) setScreen(next);
      });
    };
    open();
    // A link pasted into this page's own address bar arrives as a hash change, not a new page.
    window.addEventListener('hashchange', open);
    return () => {
      live = false;
      window.removeEventListener('hashchange', open);
    };
  }, []);

  /** Every change to a plan is kept on this device, written into the address bar, and shown. */
  const commit = useCallback((next: WhenPlan, me: string | null) => {
    // Another tab may have saved into this plan meanwhile: whoever it kept stays in.
    const kept = readLocal(STORE + next.id, whenSavedSchema);
    const merged = kept ? mergePlans(next, kept.plan) : null;
    const plan = merged?.ok ? merged.plan : next;
    keepPlan(plan, me);
    showInAddress(plan);
    setScreen((current) =>
      current.kind === 'loading'
        ? current
        : { kind: 'plan', today: current.today, plan, me, note: null },
    );
  }, []);

  const open = (incoming: WhenPlan) => {
    const [opened] = combineWithDevice(incoming);
    showInAddress(opened.plan);
    setScreen((current) =>
      current.kind === 'loading' ? current : { kind: 'plan', today: current.today, ...opened },
    );
    requestAnimationFrame(() => reveal(top.current));
  };

  const startOver = () => {
    showInAddress(null);
    const saved = savedPlans();
    setScreen((current) =>
      current.kind === 'loading'
        ? current
        : { kind: 'start', today: current.today, saved, broken: false },
    );
    requestAnimationFrame(() => reveal(top.current));
  };

  return (
    <div ref={top} className="scroll-mt-24" style={{ '--when': ACCENT } as CSSProperties}>
      {screen.kind === 'loading' ? (
        <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)]">
          <div className="skeleton h-[460px] !rounded-[22px]" />
          <div className="skeleton hidden h-[460px] !rounded-[22px] lg:block" />
        </div>
      ) : screen.kind === 'start' ? (
        <StartScreen
          today={screen.today}
          saved={screen.saved}
          broken={screen.broken}
          onCreate={(plan) => {
            commit(plan, null);
            requestAnimationFrame(() => reveal(top.current));
          }}
          onOpen={open}
        />
      ) : (
        <PlanView
          key={screen.plan.id}
          plan={screen.plan}
          me={screen.me}
          note={screen.note}
          today={screen.today}
          onCommit={commit}
          onOpen={open}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}

/* ---------------- Making a plan ---------------- */

function StartScreen({
  today,
  saved: savedAtStart,
  broken,
  onCreate,
  onOpen,
}: {
  today: string;
  saved: WhenSaved[];
  broken: boolean;
  onCreate: (plan: WhenPlan) => void;
  onOpen: (plan: WhenPlan) => void;
}) {
  const id = useId();
  const zone = useTimeZone();
  const picks = useMemo(() => quickPicks(today), [today]);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const [month, setMonth] = useState<Month>(() => monthOf(today));
  const [start, setStart] = useState(9);
  const [end, setEnd] = useState(22);
  const [slot, setSlot] = useState<SlotSize>(60);
  const [saved, setSaved] = useState(savedAtStart);

  const toggle = (day: string) =>
    setDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : current.length >= MAX_DAYS
          ? current
          : [...current, day].sort(),
    );

  const pick = (next: string[]) => {
    setDays(next);
    if (next[0]) setMonth(monthOf(next[0]));
  };

  const create = () => {
    if (!days.length) return;
    onCreate(newPlan({ id: newId(10), title, tz: currentTimeZone(), days, start, end, slot }));
  };

  const forget = (plan: WhenPlan) => {
    if (
      !window.confirm(
        `Forget “${plan.title || 'Untitled plan'}” on this device? Its link still works.`,
      )
    )
      return;
    writeLocal(STORE + plan.id, null);
    setSaved((current) => current.filter((record) => record.plan.id !== plan.id));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <Surface className="grid gap-6">
        {broken && (
          <Note icon="alert" tone="caution">
            That link couldn’t be opened. It may have been cut off when it was copied: ask for it
            again, or start a new plan here.
          </Note>
        )}
        {/* The days are the one real question, so they come first; everything else has a default. */}
        <section aria-labelledby={`${id}-days`} className="grid gap-3">
          <h2
            id={`${id}-days`}
            className="font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink"
          >
            Which days could work?
          </h2>
          <div className="grid grid-cols-3 gap-2">
            {picks.map((option) => {
              const on = option.days.join() === days.join();
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(option.days)}
                  className={cn(
                    'grid min-h-14 content-center gap-0.5 rounded-[14px] px-2.5 py-2 text-left transition-colors',
                    on
                      ? 'bg-[rgb(255_179_92/.16)] shadow-[inset_0_0_0_1.5px_var(--when)]'
                      : 'bg-well hover:bg-ink/10',
                  )}
                >
                  <span className="text-[13.5px] leading-tight font-semibold text-ink">
                    {option.label}
                  </span>
                  <span className="text-[11.5px] leading-tight text-muted">
                    {option.days.length > 1
                      ? `${shortDay(option.days[0])} – ${shortDay(option.days[option.days.length - 1])}`
                      : shortDay(option.days[0])}
                  </span>
                </button>
              );
            })}
          </div>
          <MonthCalendar
            month={month}
            today={today}
            selected={days}
            onMonth={setMonth}
            onToggle={toggle}
          />
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className={days.length ? 'text-ink-2' : 'text-muted'} aria-live="polite">
              {days.length ? describeDays(days) : 'Tap the days you’re considering.'}
            </span>
            {days.length > 0 && (
              <button
                type="button"
                onClick={() => setDays([])}
                className="font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Clear days
              </button>
            )}
          </div>
          {days.length >= MAX_DAYS && (
            <p className="text-[12.5px] text-muted">
              {MAX_DAYS} days is the most one plan can hold.
            </p>
          )}
        </section>

        <details className="group/hours -mt-2 border-t border-line pt-1">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 text-[14px] text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon name="clock" size={16} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              {planHours({ start, end })} · {slotWords(slot)}
            </span>
            <span className="font-medium text-muted group-open/hours:hidden">Change</span>
            <Icon
              name="chevron-right"
              size={15}
              className="shrink-0 text-muted transition-transform group-open/hours:rotate-90"
            />
          </summary>
          <div className="grid gap-3 pt-2 pb-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.1fr]">
              <Field label="From" htmlFor={`${id}-from`}>
                <Select
                  id={`${id}-from`}
                  value={start}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setStart(value);
                    if (end <= value) setEnd(value + 1);
                  }}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>
                      {formatTime(hour * 60)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="To" htmlFor={`${id}-to`}>
                <Select
                  id={`${id}-to`}
                  value={end}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setEnd(value);
                    if (start >= value) setStart(value - 1);
                  }}
                >
                  {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                    <option key={hour} value={hour}>
                      {hour === 24 ? 'Midnight' : formatTime(hour * 60)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div
                role="group"
                aria-labelledby={`${id}-slot`}
                className="col-span-2 flex flex-col gap-1.5 sm:col-span-1"
              >
                <span id={`${id}-slot`} className="text-[13.5px] font-medium text-ink-2">
                  Slots
                </span>
                <Segmented
                  name={`${id}-slot-size`}
                  value={String(slot)}
                  options={[
                    { value: '60', label: '1 hour' },
                    { value: '30', label: '30 min' },
                  ]}
                  onChange={(value) => setSlot(value === '30' ? 30 : 60)}
                />
              </div>
            </div>
            <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
              <Icon name="globe" size={15} className="mt-[2px] shrink-0" />
              <span>
                Times are in {zone ? <span className="text-ink-2">{zoneCity(zone)}</span> : 'your'}{' '}
                time, for everyone who opens the plan.
              </span>
            </p>
          </div>
        </details>

        <Field label="What’s it for?" htmlFor={`${id}-title`} optional>
          <Input
            id={`${id}-title`}
            aria-label="What’s the plan for?"
            placeholder="Game night"
            value={title}
            maxLength={80}
            enterKeyHint="done"
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </Field>

        {/* Once a day is picked, it stays in reach on a phone while the calendar scrolls by. */}
        <div
          className={cn(
            '-mx-2 grid gap-2 rounded-[16px] p-2 lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none',
            days.length > 0 && 'sticky bottom-3 z-10 bg-surface/95 backdrop-blur',
          )}
        >
          <button
            type="button"
            onClick={create}
            disabled={!days.length}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[13px] bg-ink px-5 text-[15.5px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40 lg:h-11 lg:text-[14.5px]"
          >
            <Icon name="calendar-clock" size={17} /> Create the plan
          </button>
          <p className="text-center text-[12.5px] text-muted" aria-live="polite">
            {days.length
              ? `${days.length} ${days.length === 1 ? 'day' : 'days'}, ${planHours({ start, end })}, in ${slotWords(slot)}.`
              : 'Tap the days above to start.'}
          </p>
        </div>
      </Surface>

      <aside aria-label="Examples and saved plans" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-4">
          <div className="flex items-start gap-3.5">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-[13px]"
              style={{ background: ACCENT, color: ON_ACCENT }}
            >
              <Icon name="people" size={20} />
            </span>
            <div>
              <p className="text-[15.5px] font-semibold text-ink">See it with a group first</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                Open a made-up game night with five friends’ times already in, and see which evening
                wins.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpen(samplePlan(today, currentTimeZone()))}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[14px]"
          >
            <Icon name="eye" size={16} /> Open the example
          </button>
        </Surface>

        {saved.length > 0 && (
          <Surface className="grid gap-3">
            <Label>Your plans</Label>
            <ul className="grid gap-1.5">
              {saved.slice(0, 8).map(({ plan }) => (
                <li
                  key={plan.id}
                  className="flex items-center gap-1 rounded-[14px] bg-subtle p-1 pl-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(plan)}
                    className="min-w-0 flex-1 py-2 text-left"
                  >
                    <span className="block truncate text-[14.5px] font-medium text-ink">
                      {plan.title || 'Untitled plan'}
                    </span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {describeDays(plan.days)} · {plan.people.length}{' '}
                      {plan.people.length === 1 ? 'person' : 'people'}
                    </span>
                  </button>
                  <IconButton
                    icon="x"
                    label={`Forget ${plan.title || 'this plan'} on this device`}
                    onClick={() => forget(plan)}
                  />
                </li>
              ))}
            </ul>
            <p className="text-[12px] leading-relaxed text-muted">
              Removing a plan here doesn’t change its link.
            </p>
          </Surface>
        )}
      </aside>
    </div>
  );
}

function MonthCalendar({
  month,
  today,
  selected,
  onMonth,
  onToggle,
}: {
  month: Month;
  today: string;
  selected: string[];
  onMonth: (month: Month) => void;
  onToggle: (day: string) => void;
}) {
  const first = monthOf(today);
  const position = (value: Month) => value.year * 12 + value.month;
  const full = selected.length >= MAX_DAYS;
  return (
    <div className="grid gap-2 rounded-[18px] bg-subtle p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-3">
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon="chevron-left"
          label="Previous month"
          disabled={position(month) <= position(first)}
          onClick={() => onMonth(shiftMonth(month, -1))}
        />
        <p className="text-[14.5px] font-semibold text-ink" aria-live="polite">
          {monthTitle(month)}
        </p>
        <IconButton
          icon="chevron-right"
          label="Next month"
          disabled={position(month) >= position(first) + 12}
          onClick={() => onMonth(shiftMonth(month, 1))}
        />
      </div>
      <div role="group" aria-label={monthTitle(month)} className="grid grid-cols-7 gap-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((letter, column) => (
          <span key={column} aria-hidden="true" className="label pb-1 text-center">
            {letter}
          </span>
        ))}
        {monthWeeks(month)
          .flat()
          .map((day, cell) => {
            if (!day) return <span key={`blank-${cell}`} aria-hidden="true" />;
            const on = selected.includes(day);
            const past = day < today;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={`${formatDay(day)}${day === today ? ', today' : ''}`}
                disabled={past || (full && !on)}
                onClick={() => onToggle(day)}
                className={cn(
                  'mono-num h-11 rounded-[11px] text-[14.5px] transition-colors disabled:cursor-default disabled:opacity-30 lg:h-10 lg:text-[13.5px]',
                  on ? 'font-semibold' : 'text-ink-2 enabled:hover:bg-ink/[.08]',
                  day === today && !on && 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                )}
                style={on ? { background: ACCENT, color: ON_ACCENT } : undefined}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
      </div>
    </div>
  );
}

/* ---------------- A plan ---------------- */

function PlanView({
  plan,
  me,
  note,
  today,
  onCommit,
  onOpen,
  onStartOver,
}: {
  plan: WhenPlan;
  me: string | null;
  note: string | null;
  today: string;
  onCommit: (plan: WhenPlan, me: string | null) => void;
  onOpen: (plan: WhenPlan) => void;
  onStartOver: () => void;
}) {
  const id = useId();
  const toast = useToast();
  const zone = useTimeZone();
  const coarse = useCoarsePointer();
  const mine = plan.people.find((person) => person.id === me) ?? null;
  const [tab, setTab] = useState<'mine' | 'all'>(mine ? 'all' : 'mine');
  const [name, setName] = useState(mine?.name ?? '');
  const [cells, setCells] = useState(() => (mine ? cellsOf(plan, mine) : emptyCells(plan)));
  /** Someone already in the plan this visitor said they are (from another device). */
  const [claimed, setClaimed] = useState<WhenPerson | null>(null);
  /** A name match waiting for "is that you?", and matches already answered "no". */
  const [clash, setClash] = useState<WhenPerson | null>(null);
  const [notMe, setNotMe] = useState<string[]>([]);
  const [nameMissing, setNameMissing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);

  const tally = useMemo(() => tallyPlan(plan), [plan]);
  const best = useMemo(() => bestTimes(plan, 5, tally), [plan, tally]);
  const total = tally.total;
  const target = mine ?? claimed;
  const packed = packCells(cells);
  const marked = countCells(cells);
  const dirty =
    name.trim() !== (target?.name ?? '') ||
    packed !== (target?.times ?? packCells(emptyCells(plan)));
  const full = !target && plan.people.length >= MAX_PEOPLE;
  const passed = plan.days.every((day) => day < today);

  // Unsaved times would be lost on leaving: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Typing a name that's already in the plan: maybe it's the same person on another device. */
  const matchName = () => {
    if (target) return null;
    const same = findByName(plan, name);
    return same && !notMe.includes(same.id) ? same : null;
  };

  const save = () => {
    const clean = name.trim();
    if (!clean) {
      setNameMissing(true);
      nameInput.current?.focus();
      return;
    }
    const same = matchName();
    if (same) {
      setClash(same);
      return;
    }
    if (full) return;
    const person: WhenPerson = {
      id: target?.id ?? freshPersonId(plan),
      name: clean,
      times: packed,
      // Always later than the copy it replaces, even if this device's clock runs behind.
      updated: Math.max(Date.now(), (target?.updated ?? 0) + 1),
    };
    onCommit(withPerson(plan, person), person.id);
    setName(clean);
    setClaimed(null);
    setClash(null);
    setJustSaved(true);
    toast({ title: 'Your times are saved', description: 'Now send the updated link back.' });
  };

  const editMine = () => {
    setTab('mine');
    requestAnimationFrame(() => reveal(editor.current));
  };

  const startOver = () => {
    if (dirty && !window.confirm('Start a new plan? The times you haven’t saved will be lost.'))
      return;
    onStartOver();
  };

  const minutesFree = (person: WhenPerson) => countCells(cellsOf(plan, person)) * plan.slot;
  const shareVersion = plan.people.map((person) => `${person.id}${person.updated}`).join('.');

  return (
    <div className="grid gap-5">
      <Surface className="grid gap-4 !p-5 sm:!p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="label">
              {total === 0
                ? 'No one’s added times yet'
                : `${total} ${total === 1 ? 'person has' : 'people have'} added times`}
            </p>
            <h2
              className="mt-2 font-display text-[30px] leading-[1.02] font-extrabold tracking-[-0.035em] break-words text-ink sm:text-[38px]"
              style={{ fontVariationSettings: "'wdth' 110" }}
            >
              {plan.title || 'When works for everyone?'}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px] text-ink-2">
              <li className="flex items-center gap-1.5">
                <Icon name="calendar" size={15} className="text-muted" />
                {describeDays(plan.days)}
              </li>
              <li className="flex items-center gap-1.5">
                <Icon name="clock" size={15} className="text-muted" />
                {planHours(plan)} · {slotWords(plan.slot)}
              </li>
              <li className="flex items-center gap-1.5">
                <Icon name="globe" size={15} className="text-muted" />
                {zoneCity(plan.tz)} time
              </li>
            </ul>
          </div>
          <button
            type="button"
            onClick={startOver}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-[12px] bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-9 lg:text-[13.5px]"
          >
            <Icon name="plus" size={15} /> Start a new plan
          </button>
        </div>
        {zone && zone !== plan.tz && (
          <Note icon="globe" tone="caution">
            This plan’s times are in {plan.tz}, and you’re in {zone}. Mark when you’re free in{' '}
            {zoneCity(plan.tz)} time: nothing here is converted.
          </Note>
        )}
        {passed && (
          <Note icon="calendar" tone="caution">
            All of this plan’s days have passed. Start a new plan to pick new ones.
          </Note>
        )}
        {note && (
          <Note icon="check" tone="positive">
            {note}
          </Note>
        )}
        {best[0] && total > 1 && (
          <p className="flex items-start gap-2.5 rounded-[12px] bg-[rgb(255_179_92/.1)] px-3.5 py-2.5 text-[13.5px] text-ink-2 lg:hidden">
            <Icon name="star" size={15} className="mt-[2px] shrink-0 text-[var(--when)]" />
            <span>
              Best so far: <strong className="text-ink">{windowWhen(plan, best[0])}</strong>,{' '}
              {best[0].count === total ? 'everyone’s free' : `${best[0].count} of ${total} free`}
            </span>
          </p>
        )}
      </Surface>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.85fr)] lg:items-start">
        <div className="grid min-w-0 gap-5">
          <Surface className="grid gap-4 !p-3 sm:!p-5">
            <div
              ref={editor}
              role="tablist"
              aria-label="Whose times"
              className="grid scroll-mt-24 grid-cols-2 gap-1 rounded-[13px] bg-well p-1"
            >
              {(['mine', 'all'] as const).map((value) => (
                <button
                  key={value}
                  id={`${id}-tab-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={`${id}-panel`}
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                    event.preventDefault();
                    const next = tab === 'mine' ? 'all' : 'mine';
                    setTab(next);
                    document.getElementById(`${id}-tab-${next}`)?.focus();
                  }}
                  className={cn(
                    'flex h-11 items-center justify-center gap-2 rounded-[10px] px-3 text-[14.5px] font-medium transition-colors lg:h-9 lg:text-[13.5px]',
                    tab === value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
                  )}
                >
                  {value === 'mine' ? (
                    <>
                      <Icon name="pencil" size={15} /> {mine ? 'Your times' : 'Add your times'}
                    </>
                  ) : (
                    <>
                      <Icon name="people" size={15} /> Everyone
                      <span className="mono-num text-[12px] text-muted">{total}</span>
                    </>
                  )}
                </button>
              ))}
            </div>

            <div
              role="tabpanel"
              id={`${id}-panel`}
              aria-labelledby={`${id}-tab-${tab}`}
              className="grid min-w-0 gap-4 px-1 sm:px-0"
            >
              {tab === 'mine' ? (
                <>
                  <Field
                    label="Your name"
                    htmlFor={`${id}-name`}
                    error={
                      nameMissing && !name.trim()
                        ? 'Add your name, so the group knows whose times these are.'
                        : undefined
                    }
                  >
                    <Input
                      ref={nameInput}
                      id={`${id}-name`}
                      value={name}
                      maxLength={40}
                      autoComplete="given-name"
                      enterKeyHint="done"
                      placeholder="Your first name"
                      onChange={(event) => {
                        setName(event.target.value);
                        setClash(null);
                      }}
                      onBlur={() => setClash(matchName())}
                    />
                  </Field>
                  {clash && (
                    <div
                      role="alert"
                      className="grid gap-3 rounded-[14px] bg-caution-soft p-3.5 text-[13.5px] text-caution"
                    >
                      <p>
                        Someone called <strong>{clash.name}</strong> has already added times. Is
                        that you?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setClaimed(clash);
                            setName(clash.name);
                            // Nothing painted yet: start from the times they saved before.
                            if (!marked) setCells(cellsOf(plan, clash));
                            setClash(null);
                          }}
                          className="h-10 rounded-[10px] bg-ink px-3.5 text-[13.5px] font-semibold text-on-ink hover:bg-ink-2"
                        >
                          Yes, edit {clash.name}’s times
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotMe((current) => [...current, clash.id]);
                            setClash(null);
                          }}
                          className="h-10 rounded-[10px] bg-well px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
                        >
                          No, I’m someone else
                        </button>
                      </div>
                    </div>
                  )}
                  {claimed && !mine && (
                    <Note icon="pencil" tone="positive">
                      Editing the times {claimed.name} saved before. Saving replaces them.
                    </Note>
                  )}
                  <p className="text-[13px] leading-relaxed text-muted">
                    Tap or drag across the times you’re free. Tap a day to fill all of it.
                    {coarse && ' To scroll past the grid, drag the times on the left.'}
                  </p>
                  <PaintGrid plan={plan} cells={cells} today={today} onChange={setCells} />
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <p className="mr-auto text-[13px] text-muted" aria-live="polite">
                      {marked
                        ? `${formatDuration(marked * plan.slot)} marked`
                        : 'Nothing marked yet'}
                      {target && dirty && ' · not saved yet'}
                    </p>
                    {marked > 0 && (
                      <button
                        type="button"
                        onClick={() => setCells(emptyCells(plan))}
                        className="h-11 rounded-[11px] px-3 text-[14px] font-medium text-muted transition-colors hover:bg-ink/[.07] hover:text-ink lg:h-10 lg:text-[13.5px]"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={save}
                      disabled={full || (!!mine && !dirty)}
                      className="inline-flex h-11 items-center gap-2 rounded-[12px] bg-ink px-5 text-[15px] font-semibold text-on-ink transition-colors hover:bg-ink-2 disabled:opacity-40 lg:h-10 lg:text-[14px]"
                    >
                      <Icon name="check" size={16} />
                      {mine && !dirty ? 'Saved' : target ? 'Save changes' : 'Save my times'}
                    </button>
                  </div>
                  {!marked && !full && (
                    <p className="-mt-2 text-right text-[12.5px] text-muted">
                      Saving with nothing marked tells everyone none of these times work.
                    </p>
                  )}
                  {full && (
                    <Note icon="people" tone="caution">
                      This plan already has {MAX_PEOPLE} people, the most one plan can hold.
                    </Note>
                  )}
                </>
              ) : (
                <Everyone plan={plan} tally={tally} best={best} today={today} coarse={coarse} />
              )}
            </div>
          </Surface>

          <Surface
            className={cn(
              'grid gap-4',
              justSaved &&
                !dirty &&
                'outline outline-[1.5px] outline-offset-[-1.5px] outline-[rgb(255_179_92/.55)]',
            )}
          >
            <div className="flex items-start gap-3.5">
              <span
                className="grid size-11 shrink-0 place-items-center rounded-[13px]"
                style={{ background: ACCENT, color: ON_ACCENT }}
              >
                <Icon name={justSaved && !dirty ? 'check' : 'send'} size={19} />
              </span>
              <div className="min-w-0">
                <p className="text-[16px] font-semibold text-ink">
                  {justSaved && !dirty
                    ? 'Saved. Now send the updated link back'
                    : total
                      ? 'Share the latest link'
                      : 'Share the plan'}
                </p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                  {justSaved && !dirty
                    ? 'The plan lives in the link: each person adds their times and passes the new link on. Send it to the group chat, or back to whoever sent it to you.'
                    : total
                      ? 'This link holds everyone’s times so far. Whoever opens it can add theirs, then sends the updated link back.'
                      : 'Send this link to everyone you’re asking. Each person adds their times, then sends the updated link back.'}
                </p>
              </div>
            </div>
            <ShareLinkCard
              key={shareVersion}
              title={plan.title || 'When works for you?'}
              cta={justSaved && !dirty ? 'Get the updated link' : 'Get the link'}
              build={() => linkFor(plan)}
            />
          </Surface>
        </div>

        <aside aria-label="Best times and people" className="grid gap-4 lg:sticky lg:top-24">
          <BestTimes plan={plan} best={best} total={total} />

          <Surface className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <Label>People · {plan.people.length}</Label>
              <span className="text-[12px] text-muted">Up to {MAX_PEOPLE}</span>
            </div>
            {plan.people.length === 0 ? (
              <p className="text-[13.5px] leading-relaxed text-muted">
                No one yet. Everyone who saves their times shows up here.
              </p>
            ) : (
              <ul className="grid gap-0.5">
                {plan.people.map((person) => {
                  const you = person.id === me;
                  const minutes = minutesFree(person);
                  return (
                    <li key={person.id} className="flex items-center gap-3 py-1.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold',
                          !you && 'bg-well text-ink-2',
                        )}
                        style={you ? { background: ACCENT, color: ON_ACCENT } : undefined}
                      >
                        {Array.from(person.name.trim())[0]?.toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium text-ink">
                          {person.name}
                          {you && <span className="font-normal text-muted"> (you)</span>}
                        </p>
                        <p className="text-[12.5px] text-muted">
                          {minutes
                            ? `${formatDuration(minutes)} free`
                            : 'Not free at any of these times'}
                        </p>
                      </div>
                      {you && (
                        <button
                          type="button"
                          onClick={editMine}
                          className="inline-flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/[.07] hover:text-ink lg:h-9"
                        >
                          <Icon name="pencil" size={14} /> Edit
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Surface>

          <CombineLinks
            plan={plan}
            onCombine={(combined) => onCommit(combined, me)}
            onOpen={(other) => {
              if (
                dirty &&
                !window.confirm('Open the other plan? The times you haven’t saved will be lost.')
              )
                return;
              onOpen(other);
            }}
          />
        </aside>
      </div>
    </div>
  );
}

/* ---------------- The grids ---------------- */

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
  const width = `calc(2.5rem + ${plan.days.length} * 41px)`;
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
          <div role="columnheader" className="sticky left-0 z-10 w-10 shrink-0 bg-surface">
            <span className="sr-only">Time</span>
          </div>
          {plan.days.map((day, index) => (
            <div
              key={day}
              role="columnheader"
              className={cn('min-w-[38px] flex-1 basis-0', day < today && 'opacity-50')}
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
              className="sticky left-0 z-10 w-10 shrink-0 bg-surface pr-1.5 text-right"
            >
              <span
                className={cn(
                  'mono-num block -translate-y-[45%] text-[10px] leading-none whitespace-nowrap text-muted',
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
          <span className="mono-num sticky left-0 z-10 w-10 shrink-0 -translate-y-[45%] bg-surface pr-1.5 text-right text-[10px] leading-none whitespace-nowrap text-muted">
            {formatTime(plan.end * 60)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 'SAT' over 'Oct 3', naming the month only where it changes, the way a calendar reads. */
function DayName({ day, previous, today }: { day: string; previous?: string; today: string }) {
  return (
    <>
      <span className={cn('label block !text-[10px]', day === today && '!text-[var(--when)]')}>
        {day === today ? 'Today' : weekdayName(day)}
      </span>
      <span className="mt-0.5 block text-[12px] leading-tight font-semibold whitespace-nowrap text-ink">
        {previous?.slice(0, 7) === day.slice(0, 7) ? Number(day.slice(8)) : shortDay(day)}
      </span>
    </>
  );
}

const rowHeight = (plan: WhenPlan) => (plan.slot === 60 ? 'h-10 lg:h-9' : 'h-7 lg:h-6');

/** Your times: tap a cell, or press and drag a box, to paint it (or erase, starting on a free cell). */
function PaintGrid({
  plan,
  cells,
  today,
  onChange,
}: {
  plan: WhenPlan;
  cells: Uint8Array;
  today: string;
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
    // Starting on a free cell erases; starting on an empty one paints.
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
            className="flex h-12 w-full flex-col items-center justify-center rounded-[10px] text-center transition-colors hover:bg-ink/[.07]"
          >
            <DayName day={day} previous={plan.days[index - 1]} today={today} />
          </button>
        );
      }}
      cell={(index, day, slot) => {
        const value =
          stroke && inBox(rows, stroke.from, stroke.to, index) ? stroke.value : cells[index];
        return (
          <div
            key={index}
            role="gridcell"
            data-cell={index}
            aria-selected={value === 1}
            aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)}`}
            tabIndex={index === active ? 0 : -1}
            className={cn(
              'min-w-[38px] flex-1 basis-0 cursor-pointer touch-none rounded-[7px] transition-colors duration-75',
              height,
              !value &&
                'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-ink/[.09]',
            )}
            style={
              value
                ? { background: ACCENT, boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .35)' }
                : undefined
            }
          />
        );
      }}
    />
  );
}

/** Everyone's times: the heat map, and who's free in the square you point at. */
function Everyone({
  plan,
  tally,
  best,
  today,
  coarse,
}: {
  plan: WhenPlan;
  tally: Tally;
  best: TimeWindow[];
  today: string;
  coarse: boolean;
}) {
  const rows = slotsPerDay(plan);
  const total = tally.total;
  const grid = useRef<HTMLDivElement>(null);
  // Open on the best time, so the answer is the first thing shown.
  const [picked, setPicked] = useState<number | null>(() =>
    best[0] ? best[0].day * rows + best[0].from : null,
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const [active, setActive] = useState(() => picked ?? 0);
  const shown = hovered ?? picked;
  const height = rowHeight(plan);

  const choose = (index: number) => {
    setPicked(index);
    setActive(index);
  };

  return (
    <div className="grid gap-4">
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
        onPointerOver={(event) => {
          if (event.pointerType !== 'mouse') return;
          const target = (event.target as Element).closest<HTMLElement>('[data-cell]');
          setHovered(target ? Number(target.dataset.cell) : null);
        }}
        onPointerLeave={() => setHovered(null)}
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
          const share = total ? count / total : 0;
          return (
            <div
              key={index}
              role="gridcell"
              data-cell={index}
              aria-selected={index === picked}
              aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)} – ${count} of ${total} free`}
              tabIndex={index === active ? 0 : -1}
              className={cn(
                'mono-num grid min-w-[38px] flex-1 basis-0 cursor-pointer place-items-center rounded-[7px] text-[10.5px] font-semibold',
                height,
                !count && 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
                count > 0 && share <= 0.55 && 'text-ink-2',
                index === picked && 'outline-2 outline-offset-1 outline-ink',
              )}
              style={
                count
                  ? {
                      background: `rgb(${ACCENT_RGB} / ${0.14 + 0.86 * share})`,
                      color: share > 0.55 ? ON_ACCENT : undefined,
                    }
                  : undefined
              }
            >
              {count > 0 &&
                (count === total && total > 1 ? (
                  <Icon name="check" size={13} strokeWidth={2.75} />
                ) : (
                  count
                ))}
            </div>
          );
        }}
      />

      <div
        aria-hidden="true"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted"
      >
        <span className="flex items-center gap-1.5">
          Fewer
          {[0.14, 0.35, 0.57, 0.78, 1].map((alpha) => (
            <span
              key={alpha}
              className="inline-block size-3.5 rounded-[4px]"
              style={{ background: `rgb(${ACCENT_RGB} / ${alpha})` }}
            />
          ))}
          More free
        </span>
        <span className="flex items-center gap-1">
          Numbers count who’s free ·
          <Icon name="check" size={12} strokeWidth={2.5} /> everyone
        </span>
      </div>

      {total === 0 ? (
        <p className="rounded-[14px] bg-subtle p-4 text-[13.5px] leading-relaxed text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          No one’s added their times yet. As people do, this fills in: the brighter a square, the
          more people are free then.
        </p>
      ) : shown === null ? (
        <p className="text-[13.5px] text-muted">
          {coarse ? 'Tap' : 'Point at'} a square to see who’s free then.
        </p>
      ) : (
        <CellDetail plan={plan} tally={tally} index={shown} />
      )}
    </div>
  );
}

function CellDetail({ plan, tally, index }: { plan: WhenPlan; tally: Tally; index: number }) {
  const rows = slotsPerDay(plan);
  const day = Math.floor(index / rows);
  const slot = index % rows;
  const { free, busy } = splitByMask(plan, tally.masks[index]);
  return (
    <div
      aria-live="polite"
      className="grid gap-3 rounded-[16px] bg-subtle p-4 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[15px] font-semibold text-ink">
          {formatDay(plan.days[day])} ·{' '}
          {formatRange(slotStart(plan, slot), slotStart(plan, slot + 1))}
        </p>
        <p className="text-[13px] text-muted">
          {free.length === tally.total ? (
            <span className="font-medium text-ink-2">Everyone’s free</span>
          ) : (
            <span className="mono-num">
              {free.length} of {tally.total} free
            </span>
          )}
        </p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <PeopleChips label="Free" people={free} free />
        <PeopleChips label="Not free" people={busy} free={false} />
      </div>
    </div>
  );
}

function PeopleChips({
  label,
  people,
  free,
}: {
  label: string;
  people: WhenPerson[];
  free: boolean;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <p className="label">
        {label} · {people.length}
      </p>
      {people.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {people.map((person) => (
            <li
              key={person.id}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium',
                free ? 'text-ink' : 'bg-well text-muted',
              )}
              style={free ? { background: `rgb(${ACCENT_RGB} / .18)` } : undefined}
            >
              <Icon name={free ? 'check' : 'x'} size={12} strokeWidth={2.4} />
              {person.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-faint">No one</p>
      )}
    </div>
  );
}

/* ---------------- The answer ---------------- */

function BestTimes({ plan, best, total }: { plan: WhenPlan; best: TimeWindow[]; total: number }) {
  return (
    <Surface className="grid gap-4 !p-5 sm:!p-6">
      <div className="flex items-baseline justify-between gap-3">
        <Label>Best times</Label>
        {total > 0 && <span className="text-[12px] text-muted">Times in {plan.tz}</span>}
      </div>
      <div aria-live="polite">
        {total === 0 ? (
          <div className="grid gap-1.5">
            <p className="text-[16px] font-semibold text-ink">No one’s added their times yet.</p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Add yours, then send the link to the group. As people add theirs, the times that work
              for the most people rise to the top here.
            </p>
          </div>
        ) : total === 1 ? (
          <div className="grid gap-1.5">
            <p className="text-[16px] font-semibold text-ink">
              {plan.people[0].name} is the only one so far.
            </p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Once a second person adds their times, the overlaps show up here.
            </p>
          </div>
        ) : best.length === 0 ? (
          <div className="grid gap-1.5">
            <p className="text-[16px] font-semibold text-ink">No overlap yet.</p>
            <p className="text-[13.5px] leading-relaxed text-muted">
              Nobody’s free at the same time so far. As more people add their times, that can
              change.
            </p>
          </div>
        ) : (
          <ol className="grid gap-2">
            {best.map((window, index) => {
              const everyone = window.count === total;
              const { busy } = splitByMask(plan, window.mask);
              const from = slotStart(plan, window.from);
              const to = slotStart(plan, window.to);
              return (
                <li
                  key={`${window.day}-${window.from}`}
                  className={cn(
                    'grid gap-1 rounded-[16px] p-3.5',
                    index === 0
                      ? 'bg-[rgb(255_179_92/.12)] shadow-[inset_0_0_0_1px_rgb(255_179_92/.45)]'
                      : 'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[15px] leading-snug font-semibold text-ink">
                      {formatDay(plan.days[window.day])}
                      <span className="text-ink-2"> · {formatRange(from, to)}</span>
                    </p>
                    <span
                      className="mono-num shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                      style={
                        everyone
                          ? { background: ACCENT, color: ON_ACCENT }
                          : { background: `rgb(${ACCENT_RGB} / .16)`, color: ACCENT }
                      }
                    >
                      {window.count}/{total}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted">
                    {everyone
                      ? 'Everyone’s free'
                      : `${window.count} of ${total} free, ${notFree(busy.map((person) => person.name))}`}{' '}
                    · {formatDuration(to - from)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {total > 1 && best.length > 0 && (
        <CopyButton
          text={bestTimesText(plan, best)}
          label="Copy for the group chat"
          what="Best times copied"
          className="!h-11 w-full lg:!h-10"
        />
      )}
    </Surface>
  );
}

/* ---------------- Combining links ---------------- */

function CombineLinks({
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
    <Surface as="section" className="!py-1">
      <details className="group/combine">
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
            Open each one here, or paste them in one at a time. Everyone’s times end up in one plan.
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
              className="h-11 min-w-0 flex-1 rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14px]"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[11px] bg-well px-4 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-40 lg:h-10 lg:text-[14px]"
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
    </Surface>
  );
}
