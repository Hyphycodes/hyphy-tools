'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { readLocal, writeLocal } from '@/lib/share/local';
import {
  addDays,
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
import {
  ActionBar,
  ActionButton,
  Choices,
  CopyButton,
  IconButton,
  Journey,
  Label,
  MoreOptions,
  Note,
  Surface,
  useCopy,
} from './kit';
import { LinkQr } from './share-link';

/*
 * When?: pick the days and hours, share one link, and everyone paints when they're free. The plan
 * and everyone's times live inside the link (after the #, which browsers never send to a server).
 * This device keeps a copy of each plan, so links that come back from different people combine.
 */

/** The tool's two lights, from its world: warm amber, and a sunset for the glow. */
const ACCENT = 'var(--accent, #ffb35c)';
const GLOW = 'var(--glow, #ff7e5f)';
/** The accent (or another color) at a strength, for fills and washes. */
const tint = (percent: number, color = ACCENT) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;
/** Dark ink for text on the accent. */
const ON_ACCENT = '#12110d';
const STORE = 'hyphy.when.v1.';
/** Plans a device remembers; older ones still open from their links. */
const KEEP = 20;

/** The whole path, as the live step tracker names it. Picking the days is behind you on a plan. */
const STEPS = ['Pick days', 'Share', 'Add times', 'Best time'];

type View = 'share' | 'respond' | 'results';
const STEP_OF: Record<View, number> = { share: 1, respond: 2, results: 3 };
const VIEW_AT: View[] = ['share', 'share', 'respond', 'results'];

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
  | ({ kind: 'plan'; today: string; view?: View } & Opened);

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

/** Whether this browser can hand a link to the phone's share sheet. */
const useCanShare = () =>
  useSyncExternalStore(
    never,
    () => 'share' in navigator,
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

/** Parts of the day to choose from, instead of two clocks. `sun` is where it sits on the arc. */
const HOURS = [
  { id: 'mornings', label: 'Mornings', start: 8, end: 12, sun: 0.18 },
  { id: 'afternoons', label: 'Afternoons', start: 12, end: 17, sun: 0.5 },
  { id: 'evenings', label: 'Evenings', start: 17, end: 22, sun: 0.84 },
  { id: 'all', label: 'All day', start: 9, end: 22, sun: null },
] as const;

const hoursOf = (plan: Pick<WhenPlan, 'start' | 'end'>) =>
  HOURS.find((option) => option.start === plan.start && option.end === plan.end) ?? null;

/** 'Evenings, 5–10 PM', or just the hours when they're custom. */
const hoursWords = (plan: Pick<WhenPlan, 'start' | 'end'>) => {
  const named = hoursOf(plan);
  return named ? `${named.label}, ${planHours(plan)}` : planHours(plan);
};

/** Tap to name it, instead of typing. */
const NAMES = ['Dinner', 'Game night', 'Drinks', 'Team call', 'Catch-up'];

const initial = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? '?';

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

/* ---------------- Little pictures ---------------- */

/** The sun on its arc over the horizon: where in the day these hours sit. */
function SunArc({ at, on, evening }: { at: number | null; on: boolean; evening?: boolean }) {
  const angle = Math.PI * (1 - (at ?? 0.5));
  const x = 20 + 15 * Math.cos(angle);
  const y = 21 - 15 * Math.sin(angle);
  return (
    <svg aria-hidden="true" viewBox="0 0 40 26" className="h-[26px] w-10 shrink-0">
      <path
        d="M5 21a15 15 0 0 1 30 0"
        fill="none"
        stroke={at === null && on ? ACCENT : 'currentColor'}
        strokeOpacity={at === null && on ? 1 : 0.3}
        strokeWidth="1.6"
        strokeDasharray={at === null ? undefined : '2 2.6'}
        strokeLinecap="round"
      />
      <path d="M2 21h36" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.6" />
      <circle cx={x} cy={y} r="4.2" fill={on ? (evening ? GLOW : ACCENT) : 'currentColor'} />
    </svg>
  );
}

/** A small, made-up heat map: what the answer looks like before anyone's been asked. */
const PREVIEW = [
  [0, 1, 0, 1, 2, 1, 0],
  [1, 2, 1, 1, 4, 2, 1],
  [1, 3, 2, 2, 5, 4, 2],
  [0, 2, 3, 1, 5, 3, 1],
  [0, 1, 1, 0, 2, 1, 0],
];

function PreviewArt({ quiet = false, className }: { quiet?: boolean; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('grid grid-cols-7 gap-[3px]', quiet && 'opacity-40', className)}
    >
      {PREVIEW.flat().map((value, index) => (
        <span
          key={index}
          className="h-3.5 rounded-[4px]"
          style={{
            background: value ? tint(14 + value * 17) : 'var(--color-well)',
            boxShadow: value === 5 && !quiet ? `0 0 0 1.5px ${GLOW}` : undefined,
          }}
        />
      ))}
    </div>
  );
}

/** A low sun with a few rays: the "that's the one" mark on the best time. */
function SunsetArt({ className }: { className?: string }) {
  const id = useId().replace(/[^\w-]/g, '');
  return (
    <svg aria-hidden="true" viewBox="0 0 88 60" className={className}>
      <defs>
        <linearGradient id={`${id}-sun`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb35c" style={{ stopColor: ACCENT }} />
          <stop offset="1" stopColor="#ff7e5f" style={{ stopColor: GLOW }} />
        </linearGradient>
      </defs>
      {[-62, -31, 0, 31, 62].map((turn) => (
        <path
          key={turn}
          d="M44 12V4"
          stroke="currentColor"
          strokeOpacity=".5"
          strokeWidth="2.4"
          strokeLinecap="round"
          transform={`rotate(${turn} 44 44)`}
        />
      ))}
      <path d="M20 44a24 24 0 0 1 48 0Z" fill={`url(#${id}-sun)`} />
      <path
        d="M8 44h72M22 51h44"
        stroke="currentColor"
        strokeOpacity=".35"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
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
  const commit = useCallback((next: WhenPlan, me: string | null, view?: View) => {
    // Another tab may have saved into this plan meanwhile: whoever it kept stays in.
    const kept = readLocal(STORE + next.id, whenSavedSchema);
    const merged = kept ? mergePlans(next, kept.plan) : null;
    const plan = merged?.ok ? merged.plan : next;
    keepPlan(plan, me);
    showInAddress(plan);
    setScreen((current) =>
      current.kind === 'loading'
        ? current
        : { kind: 'plan', today: current.today, plan, me, note: null, view },
    );
  }, []);

  const open = (incoming: WhenPlan, view?: View) => {
    const [opened] = combineWithDevice(incoming);
    showInAddress(opened.plan);
    setScreen((current) =>
      current.kind === 'loading'
        ? current
        : { kind: 'plan', today: current.today, ...opened, view },
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
    <div ref={top} className="scroll-mt-24">
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
            commit(plan, null, 'share');
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
          startOn={screen.view}
          onCommit={commit}
          onOpen={open}
          onStartOver={startOver}
        />
      )}
    </div>
  );
}

/* ---------------- Making a plan ---------------- */

const PICK_ICONS: Record<string, IconName> = {
  week: 'calendar',
  'this-weekend': 'sun',
  'next-weekend': 'party',
};

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
  onOpen: (plan: WhenPlan, view?: View) => void;
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
  const hours = hoursOf({ start, end });

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
      <Surface
        className="grid gap-7 !pb-0 sm:!p-7"
        style={{
          backgroundImage: `radial-gradient(90% 38% at 50% 0%, ${tint(13)}, transparent 72%)`,
        }}
      >
        {broken && (
          <Note icon="alert" tone="caution">
            That link couldn’t be opened. It may have been cut off when it was copied: ask for it
            again, or start a new plan here.
          </Note>
        )}
        {/* The days are the one real question, so they come first; everything else has a default. */}
        <section aria-labelledby={`${id}-days`} className="grid gap-4">
          <div className="grid gap-1.5">
            <h2
              id={`${id}-days`}
              className="font-display text-[26px] leading-[1.05] font-bold tracking-[-0.03em] text-ink sm:text-[30px]"
              style={{ fontVariationSettings: "'wdth' 108" }}
            >
              Which days could work?
            </h2>
            <p className="text-[14.5px] leading-snug text-muted">
              Tap a quick pick, or the days on the calendar.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
            {picks.map((option) => {
              const on = option.days.join() === days.join();
              const last = option.days[option.days.length - 1];
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => pick(option.days)}
                  className={cn(
                    'flex min-h-[96px] min-w-0 flex-col items-start gap-2 rounded-[18px] p-3 text-left transition-[background-color,box-shadow,transform] active:scale-[.97]',
                    on
                      ? 'bg-signal-soft shadow-[inset_0_0_0_2px_var(--accent,var(--color-ink))]'
                      : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-8 place-items-center rounded-[10px]',
                      !on && 'bg-white/[.06] text-ink-2',
                    )}
                    style={on ? { background: ACCENT, color: ON_ACCENT } : undefined}
                  >
                    <Icon name={PICK_ICONS[option.id] ?? 'calendar'} size={16} />
                  </span>
                  <span className="grid gap-0.5">
                    <span className="text-[14.5px] leading-tight font-semibold text-ink">
                      {option.label}
                    </span>
                    <span className="text-[12px] leading-tight text-muted">
                      {option.days.length > 1
                        ? `${shortDay(option.days[0])} – ${last.slice(5, 7) === option.days[0].slice(5, 7) ? Number(last.slice(8)) : shortDay(last)}`
                        : shortDay(option.days[0])}
                    </span>
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
          <div className="-mt-1 flex min-h-6 flex-wrap items-center justify-between gap-2 text-[13.5px]">
            <span
              className={cn('flex items-center gap-2', days.length ? 'text-ink-2' : 'text-muted')}
              aria-live="polite"
            >
              {days.length > 0 && (
                <span
                  className="mono-num grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[12px] font-bold"
                  style={{ background: ACCENT, color: ON_ACCENT }}
                >
                  {days.length}
                </span>
              )}
              {days.length ? describeDays(days) : 'Tap as many days as you like.'}
            </span>
            {days.length > 0 && (
              <button
                type="button"
                onClick={() => setDays([])}
                className="min-h-9 font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {days.length >= MAX_DAYS && (
            <p className="-mt-2 text-[12.5px] text-muted">
              {MAX_DAYS} days is the most one plan can hold.
            </p>
          )}
        </section>

        <section aria-labelledby={`${id}-hours`} className="grid gap-3">
          <h3 id={`${id}-hours`} className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
            What time of day?
          </h3>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-hours`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {HOURS.map((option) => {
              const on = hours?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setStart(option.start);
                    setEnd(option.end);
                  }}
                  className={cn(
                    'flex min-h-[60px] min-w-0 items-center gap-2.5 rounded-[16px] px-3 py-2 text-left transition-[background-color,box-shadow,transform] active:scale-[.97] sm:flex-col sm:items-start sm:gap-1.5 sm:py-3',
                    on
                      ? 'bg-signal-soft text-ink shadow-[inset_0_0_0_2px_var(--accent,var(--color-ink))]'
                      : 'bg-well text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
                  )}
                >
                  <SunArc at={option.sun} on={on} evening={option.id === 'evenings'} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-[14.5px] leading-tight font-semibold text-ink">
                      {option.label}
                    </span>
                    <span className="text-[12px] leading-tight whitespace-nowrap text-muted">
                      {planHours(option)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <MoreOptions
            label="Exact hours"
            summary={`${hours ? '' : `${planHours({ start, end })} · `}${slotWords(slot)}`}
          >
            <div className="grid gap-3 pb-1">
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
                  Times are in{' '}
                  {zone ? <span className="text-ink-2">{zoneCity(zone)}</span> : 'your'} time, for
                  everyone who opens the plan.
                </span>
              </p>
            </div>
          </MoreOptions>
        </section>

        <section className="grid gap-2.5">
          <Field label="Name it" htmlFor={`${id}-title`} optional>
            <Input
              id={`${id}-title`}
              aria-label="What’s the plan for?"
              placeholder="Game night"
              value={title}
              maxLength={80}
              autoComplete="off"
              enterKeyHint="done"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          </Field>
          <Choices
            label="Name ideas"
            scroll
            value={NAMES.includes(title) ? title : null}
            options={NAMES.map((name) => ({ value: name, label: name }))}
            onChange={setTitle}
          />
        </section>

        {/* Stays under the thumb on a phone while the calendar scrolls by. */}
        <ActionBar className={cn('!mt-0 rounded-b-[22px]', !days.length && '!static')}>
          <ActionButton icon="send" onClick={create} disabled={!days.length}>
            Next: share
          </ActionButton>
          <p className="mt-2 text-center text-[12.5px] text-muted" aria-live="polite">
            {days.length
              ? `${days.length} ${days.length === 1 ? 'day' : 'days'} · ${hoursWords({ start, end })}`
              : 'Pick at least one day to go on.'}
          </p>
        </ActionBar>
      </Surface>

      <aside aria-label="Examples and saved plans" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-4">
          <PreviewArt />
          <div>
            <p className="text-[15.5px] font-semibold text-ink">See it with a group first</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
              A made-up game night with five friends’ times already in. See which evening wins.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpen(samplePlan(today, currentTimeZone()), 'results')}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[14.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10 lg:text-[14px]"
          >
            <Icon name="sparkles" size={16} /> Open the example
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

/** A month to tap days on: picked days glow, and runs of them join up like a range. */
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
  const picked = new Set(selected);
  // Picked days out of sight in another month: say so, and lead there.
  const key = `${month.year}-${String(month.month + 1).padStart(2, '0')}`;
  const later = selected.filter((day) => day.slice(0, 7) > key);
  const earlier = selected.filter((day) => day.slice(0, 7) < key);
  const elsewhere = later.length ? later : earlier;
  return (
    <div className="grid gap-1.5 rounded-[20px] bg-subtle px-2 pt-2 pb-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-3 sm:pb-3">
      <div className="flex items-center justify-between gap-2">
        <IconButton
          icon="chevron-left"
          label="Previous month"
          disabled={position(month) <= position(first)}
          onClick={() => onMonth(shiftMonth(month, -1))}
        />
        <p className="text-[15px] font-semibold text-ink" aria-live="polite">
          {monthTitle(month)}
        </p>
        <IconButton
          icon="chevron-right"
          label="Next month"
          disabled={position(month) >= position(first) + 12}
          onClick={() => onMonth(shiftMonth(month, 1))}
        />
      </div>
      <div role="group" aria-label={monthTitle(month)} className="grid grid-cols-7 gap-y-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((letter, column) => (
          <span key={column} aria-hidden="true" className="label pb-1 text-center !text-[10.5px]">
            {letter}
          </span>
        ))}
        {monthWeeks(month)
          .flat()
          .map((day, cell) => {
            if (!day) return <span key={`blank-${cell}`} aria-hidden="true" />;
            const column = cell % 7;
            const on = picked.has(day);
            // Runs join up within a week row, and never past the month's edge.
            const joinBefore =
              on && column > 0 && day.slice(8) !== '01' && picked.has(addDays(day, -1));
            const next = addDays(day, 1);
            const joinAfter =
              on && column < 6 && next.slice(0, 7) === day.slice(0, 7) && picked.has(next);
            const past = day < today;
            const isToday = day === today;
            return (
              <div key={day} className="relative grid place-items-center">
                {joinBefore && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-[3px] left-0 w-1/2"
                    style={{ background: tint(24) }}
                  />
                )}
                {joinAfter && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-[3px] right-0 w-1/2"
                    style={{ background: tint(24) }}
                  />
                )}
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={`${formatDay(day)}${isToday ? ', today' : ''}`}
                  disabled={past || (full && !on)}
                  onClick={() => onToggle(day)}
                  className={cn(
                    'mono-num relative grid aspect-square w-full max-w-11 place-items-center rounded-full text-[15px] transition-[background-color,transform] active:scale-90 disabled:cursor-default disabled:opacity-30 lg:max-w-10 lg:text-[14px]',
                    on ? 'font-bold' : 'text-ink-2 enabled:hover:bg-ink/[.08]',
                    isToday && !on && 'font-bold text-ink',
                  )}
                  style={
                    on
                      ? {
                          background: ACCENT,
                          color: ON_ACCENT,
                          boxShadow: `0 6px 18px -7px ${GLOW}, inset 0 1px 0 rgb(255 255 255 / .35)`,
                        }
                      : isToday
                        ? { boxShadow: `inset 0 0 0 1.5px ${tint(55)}` }
                        : undefined
                  }
                >
                  {Number(day.slice(8))}
                  {isToday && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-[5px] size-1 rounded-full"
                      style={{ background: on ? ON_ACCENT : ACCENT }}
                    />
                  )}
                </button>
              </div>
            );
          })}
      </div>
      {elsewhere.length > 0 && (
        <button
          type="button"
          onClick={() => onMonth(monthOf(elsewhere[0]))}
          className="mx-auto inline-flex min-h-10 items-center gap-1 rounded-full px-3.5 text-[13.5px] font-medium text-signal-ink transition-colors hover:bg-signal-soft"
        >
          {!later.length && <Icon name="chevron-left" size={15} />}
          {elsewhere.length} more in {monthTitle(monthOf(elsewhere[0])).split(' ')[0]}
          {later.length > 0 && <Icon name="chevron-right" size={15} />}
        </button>
      )}
    </div>
  );
}

/* ---------------- Sharing ---------------- */

/** What people will see when they open the link: a little invitation, days torn off a calendar. */
function InviteCard({
  plan,
  today,
  onRespond,
}: {
  plan: WhenPlan;
  today: string;
  onRespond: () => void;
}) {
  return (
    <div
      className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[22px] bg-well p-5 pt-6 text-left shadow-[inset_0_0_0_1px_var(--color-line),0_24px_50px_-30px_var(--glow,transparent)] sm:-rotate-1"
      role="group"
      aria-label="The invite"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1.5"
        style={{ background: `linear-gradient(90deg, ${ACCENT}, ${GLOW})` }}
      />
      <p className="label flex items-center gap-1.5 !text-signal-ink">
        <Icon name="calendar-clock" size={14} /> You’re invited
      </p>
      <p
        className="mt-2 font-display text-[26px] leading-[1.05] font-bold tracking-[-0.03em] break-words text-ink"
        style={{ fontVariationSettings: "'wdth' 108" }}
      >
        {plan.title || 'When works for you?'}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13.5px] text-ink-2">
        <Icon name="clock" size={14} className="shrink-0 text-muted" />
        {hoursWords(plan)}
      </p>
      <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={describeDays(plan.days)}>
        {plan.days.map((day) => (
          <li
            key={day}
            className={cn(
              'grid w-[42px] justify-items-center overflow-hidden rounded-[10px] bg-surface pb-1.5 shadow-[inset_0_0_0_1px_var(--color-line)]',
              day < today && 'opacity-40',
            )}
          >
            <span aria-hidden="true" className="h-[3px] w-full" style={{ background: ACCENT }} />
            <span className="mt-1 text-[9.5px] font-semibold tracking-[0.06em] text-muted uppercase">
              {weekdayName(day)}
            </span>
            <span className="mono-num text-[16px] leading-tight font-semibold text-ink">
              {Number(day.slice(8))}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onRespond}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[13px] text-[14.5px] font-semibold text-ink shadow-[inset_0_0_0_1.5px_var(--accent,var(--color-line-strong))] transition-transform active:scale-[.98]"
        style={{ background: tint(16) }}
      >
        <Icon name="hand" size={16} /> Tap when you’re free
      </button>
    </div>
  );
}

/** Hand the link out: the share sheet on a phone, a copy everywhere, a code to scan across a table. */
function ShareActions({ plan, share: shareLabel }: { plan: WhenPlan; share: string }) {
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
        title: plan.title || 'When works for you?',
        text: 'Tap the times you’re free:',
        url,
      });
    } catch {
      // Cancelled, or not allowed here: the copy button is right there.
    }
  };

  const copyButton = (
    <ActionButton
      variant={canShare ? 'quiet' : 'accent'}
      icon={done ? 'check' : 'copy'}
      disabled={!url}
      onClick={() => url && void copy(url, 'Link copied')}
    >
      {done ? 'Copied' : canShare ? 'Copy' : 'Copy the link'}
    </ActionButton>
  );

  return (
    <div className="grid gap-2.5">
      {canShare ? (
        <div className="grid grid-cols-[1.6fr_1fr] gap-2">
          <ActionButton icon="share" disabled={!url} onClick={share}>
            {shareLabel}
          </ActionButton>
          {copyButton}
        </div>
      ) : (
        copyButton
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <Icon name="lock" size={13} className="shrink-0" />
          Everything’s inside the link. Nothing is uploaded.
        </span>
        {url && url.length <= 1600 && (
          <button
            type="button"
            onClick={() => setShowQr((value) => !value)}
            className="inline-flex min-h-9 items-center gap-1 font-medium text-ink-2 hover:text-ink"
          >
            <Icon name="qr" size={14} /> {showQr ? 'Hide code' : 'Show a code'}
          </button>
        )}
      </div>
      {showQr && url && (
        <div className="mx-auto w-full max-w-[220px] animate-rise rounded-[16px] bg-white p-3">
          <LinkQr url={url} />
        </div>
      )}
    </div>
  );
}

/* ---------------- A plan ---------------- */

function PlanView({
  plan,
  me,
  note,
  today,
  startOn,
  onCommit,
  onOpen,
  onStartOver,
}: {
  plan: WhenPlan;
  me: string | null;
  note: string | null;
  today: string;
  startOn?: View;
  onCommit: (plan: WhenPlan, me: string | null) => void;
  onOpen: (plan: WhenPlan) => void;
  onStartOver: () => void;
}) {
  const id = useId();
  const toast = useToast();
  const zone = useTimeZone();
  const coarse = useCoarsePointer();
  const mine = plan.people.find((person) => person.id === me) ?? null;
  // Straight from making it: hand it out. Opened from a link: add your times. Back again: results.
  const [view, setView] = useState<View>(() => startOn ?? (mine ? 'results' : 'respond'));
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
  const top = useRef<HTMLDivElement>(null);

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
  const sendBack = justSaved && !dirty;

  // Unsaved times would be lost on leaving: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const go = (next: View) => {
    setView(next);
    requestAnimationFrame(() => reveal(top.current));
  };

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
    go('results');
    toast({ title: 'Your times are saved', description: 'Now send the updated link back.' });
  };

  const startOver = () => {
    if (dirty && !window.confirm('Start a new plan? The times you haven’t saved will be lost.'))
      return;
    onStartOver();
  };

  const minutesFree = (person: WhenPerson) => countCells(cellsOf(plan, person)) * plan.slot;

  const notes = (
    <>
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
    </>
  );

  const people = (
    <Surface className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <Label>Who’s answered · {plan.people.length}</Label>
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
                  {initial(person.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-ink">
                    {person.name}
                    {you && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {minutes ? `${formatDuration(minutes)} free` : 'Not free at any of these times'}
                  </p>
                </div>
                {you && (
                  <button
                    type="button"
                    onClick={() => go('respond')}
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
  );

  return (
    <div className="grid gap-5">
      <div ref={top} className="flex scroll-mt-24 items-start gap-3">
        <Journey
          steps={STEPS}
          current={STEP_OF[view]}
          onPick={(index) => index > 0 && go(VIEW_AT[index])}
          reachable={(index) => index > 0}
          className="flex-1"
        />
        <button
          type="button"
          onClick={startOver}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <Icon name="plus" size={15} /> New plan
        </button>
      </div>

      {view === 'share' ? (
        <div className="mx-auto grid w-full max-w-[640px] gap-4">
          {notes}
          <Surface
            className="grid gap-6 !p-5 sm:!p-8"
            style={{
              backgroundImage: `radial-gradient(80% 45% at 50% 0%, ${tint(15)}, transparent 72%), radial-gradient(60% 40% at 100% 100%, ${tint(12, GLOW)}, transparent 70%)`,
            }}
          >
            <div className="text-center">
              <h2
                className="font-display text-[28px] leading-[1.02] font-bold tracking-[-0.035em] text-balance text-ink sm:text-[36px]"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {total ? 'Send the latest link' : 'Your invite is ready'}
              </h2>
              <p className="mx-auto mt-2 max-w-[38ch] text-[15px] leading-snug text-pretty text-muted">
                {total
                  ? 'It holds everyone’s times so far. Whoever opens it adds theirs and sends it back.'
                  : 'Send it to the group chat. Everyone taps when they’re free, then sends the link back.'}
              </p>
            </div>
            <InviteCard plan={plan} today={today} onRespond={() => go('respond')} />
            <ShareActions plan={plan} share="Share the invite" />
            <div className="-mt-1 flex flex-wrap justify-center gap-2 border-t border-line pt-4">
              <button
                type="button"
                onClick={() => go('respond')}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
              >
                <Icon name="pencil" size={15} /> {mine ? 'Edit your times' : 'Add your own times'}
              </button>
              {total > 0 && (
                <button
                  type="button"
                  onClick={() => go('results')}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
                >
                  <Icon name="star" size={15} /> See the best time
                </button>
              )}
            </div>
          </Surface>
        </div>
      ) : view === 'respond' ? (
        <div
          className={cn(
            'grid gap-5',
            total > 0
              ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.8fr)] lg:items-start'
              : 'mx-auto w-full max-w-[760px]',
          )}
        >
          <Surface className="grid gap-4 !pb-0 sm:!p-6">
            <div className="grid gap-1">
              <p className="label flex min-w-0 items-center gap-1.5 !text-signal-ink">
                <Icon name="calendar-clock" size={14} className="shrink-0" />
                <span className="truncate">{plan.title || 'When works for you?'}</span>
              </p>
              <h2
                className="mt-1 font-display text-[28px] leading-[1.02] font-bold tracking-[-0.035em] text-ink sm:text-[34px]"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {mine ? 'Your free times' : 'Paint when you’re free'}
              </h2>
              <p className="text-[14px] text-muted">
                {describeDays(plan.days)} · {planHours(plan)}
              </p>
            </div>
            {notes}
            <p className="flex items-start gap-2.5 rounded-[14px] bg-signal-soft px-3.5 py-2.5 text-[13.5px] leading-snug text-ink-2">
              <Icon name="hand" size={16} className="mt-px shrink-0 text-signal-ink" />
              <span>
                Tap or drag across the times that work. Tap a day to fill all of it.
                {coarse && ' Drag the times on the left to scroll.'}
              </span>
            </p>
            <PaintGrid plan={plan} cells={cells} today={today} onChange={setCells} />
            <div className="-mt-1 flex min-h-10 flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13.5px] text-ink-2" aria-live="polite">
                <span
                  aria-hidden="true"
                  className="size-3.5 rounded-[4px]"
                  style={{ background: marked ? ACCENT : 'var(--color-well)' }}
                />
                {marked ? `${formatDuration(marked * plan.slot)} free` : 'Nothing marked yet'}
                {target && dirty && <span className="text-muted">· not saved yet</span>}
              </p>
              {marked > 0 && (
                <button
                  type="button"
                  onClick={() => setCells(emptyCells(plan))}
                  className="h-10 rounded-[11px] px-3 text-[14px] font-medium text-muted transition-colors hover:bg-ink/[.07] hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
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
                autoCapitalize="words"
                enterKeyHint="done"
                placeholder="Your first name"
                onChange={(event) => {
                  setName(event.target.value);
                  setClash(null);
                }}
                onBlur={() => setClash(matchName())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </Field>
            {clash && (
              <div
                role="alert"
                className="grid gap-3 rounded-[14px] bg-caution-soft p-3.5 text-[13.5px] text-caution"
              >
                <p>
                  Someone called <strong>{clash.name}</strong> has already added times. Is that you?
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
            {full && (
              <Note icon="people" tone="caution">
                This plan already has {MAX_PEOPLE} people, the most one plan can hold.
              </Note>
            )}
            <ActionBar className="!mt-0 rounded-b-[22px]">
              <ActionButton icon="check" onClick={save} disabled={full || (!!mine && !dirty)}>
                {mine && !dirty ? 'Saved' : target ? 'Save changes' : 'Save my times'}
              </ActionButton>
              {!marked && !full && (
                <p className="mt-2 text-center text-[12.5px] text-muted">
                  Saving with nothing marked tells everyone none of these times work.
                </p>
              )}
            </ActionBar>
          </Surface>

          {total > 0 && (
            <aside aria-label="So far" className="grid gap-4 lg:sticky lg:top-24">
              <Surface className="grid gap-3.5">
                <div className="flex items-center gap-3">
                  <Faces people={plan.people} />
                  <p className="min-w-0 text-[14px] leading-snug text-ink-2">
                    {`${total} ${total === 1 ? 'person has' : 'people have'} answered.`}
                    {best[0] && total > 1 && (
                      <>
                        {' '}
                        Best so far:{' '}
                        <strong className="text-ink">{windowWhen(plan, best[0])}</strong>
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => go('results')}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink lg:h-10"
                >
                  <Icon name="star" size={15} /> See the best time
                </button>
              </Surface>
            </aside>
          )}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.85fr)] lg:items-start">
          <div className="grid min-w-0 gap-5">
            {notes}
            {sendBack && (
              <Surface
                className="grid animate-rise gap-4"
                style={{ boxShadow: `inset 0 0 0 1.5px ${tint(55)}` }}
              >
                <div className="flex items-start gap-3.5">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-[13px]"
                    style={{ background: ACCENT, color: ON_ACCENT }}
                  >
                    <Icon name="check" size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[16.5px] font-semibold text-ink">
                      You’re in. Now send the link back
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                      Your times live in the link. Send it to the group chat, or back to whoever
                      sent it to you.
                    </p>
                  </div>
                </div>
                <ShareActions plan={plan} share="Send it back" />
              </Surface>
            )}
            <BestTime
              plan={plan}
              best={best}
              total={total}
              answered={!!mine}
              sharing={sendBack}
              onRespond={() => go('respond')}
              onShare={() => go('share')}
            />
            {total > 0 && (
              <Surface className="grid gap-4 !p-3 sm:!p-5">
                <div className="flex items-baseline justify-between gap-3 px-1 pt-1 sm:px-0 sm:pt-0">
                  <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
                    Everyone’s times
                  </h2>
                  <span className="text-[12px] text-muted">{zoneCity(plan.tz)} time</span>
                </div>
                <Everyone plan={plan} tally={tally} best={best} today={today} coarse={coarse} />
              </Surface>
            )}
          </div>

          <aside aria-label="People and sharing" className="grid gap-4 lg:sticky lg:top-24">
            {people}
            {!sendBack && total > 0 && (
              <Surface className="grid gap-3.5">
                <div>
                  <p className="text-[15.5px] font-semibold text-ink">Waiting on someone?</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted">
                    This link holds everyone’s times so far. Send it on.
                  </p>
                </div>
                <ShareActions plan={plan} share="Share the link" />
              </Surface>
            )}
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
      )}
    </div>
  );
}

/** A little stack of faces: whoever's in. */
function Faces({ people, max = 5 }: { people: WhenPerson[]; max?: number }) {
  const more = people.length - max;
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center">
      {people.slice(0, max).map((person, index) => (
        <span
          key={person.id}
          className={cn(
            'grid size-8 place-items-center rounded-full text-[12.5px] font-bold shadow-[0_0_0_2.5px_var(--color-surface)]',
            index > 0 && '-ml-2',
          )}
          style={{
            background: index % 2 ? `color-mix(in srgb, ${GLOW} 70%, ${ACCENT})` : ACCENT,
            color: ON_ACCENT,
          }}
        >
          {initial(person.name)}
        </span>
      ))}
      {more > 0 && (
        <span className="mono-num -ml-2 grid size-8 place-items-center rounded-full bg-well text-[11.5px] font-semibold text-ink-2 shadow-[0_0_0_2.5px_var(--color-surface)]">
          +{more}
        </span>
      )}
    </span>
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
      <span className={cn('label block !text-[10px]', day === today && '!text-signal-ink')}>
        {day === today ? 'Today' : weekdayName(day)}
      </span>
      <span className="mt-0.5 block text-[12px] leading-tight font-semibold whitespace-nowrap text-ink">
        {previous?.slice(0, 7) === day.slice(0, 7) ? Number(day.slice(8)) : shortDay(day)}
      </span>
    </>
  );
}

const rowHeight = (plan: WhenPlan) => (plan.slot === 60 ? 'h-11 lg:h-9' : 'h-8 lg:h-6');

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

  /** A cell as it shows right now, with the stroke under way painted in. */
  const shown = (index: number) =>
    stroke && inBox(rows, stroke.from, stroke.to, index) ? stroke.value : cells[index];

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
            style={allFree ? { background: tint(18) } : undefined}
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
        return (
          <div
            key={index}
            role="gridcell"
            data-cell={index}
            aria-selected={value === 1}
            aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)}`}
            tabIndex={index === active ? 0 : -1}
            className={cn(
              'min-w-[38px] flex-1 basis-0 cursor-pointer touch-none rounded-[9px] transition-colors duration-75',
              height,
              !value &&
                'bg-subtle shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-ink/[.09]',
            )}
            style={
              value
                ? {
                    background: ACCENT,
                    boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .35)',
                    borderTopLeftRadius: above ? 3 : undefined,
                    borderTopRightRadius: above ? 3 : undefined,
                    borderBottomLeftRadius: below ? 3 : undefined,
                    borderBottomRightRadius: below ? 3 : undefined,
                  }
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
  const top = best[0] && total > 1 ? best[0] : null;

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
          const winner = !!top && day === top.day && slot >= top.from && slot < top.to;
          return (
            <div
              key={index}
              role="gridcell"
              data-cell={index}
              aria-selected={index === picked}
              aria-label={`${formatDay(plan.days[day])}, ${formatTime(slotStart(plan, slot), true)} – ${count} of ${total} free${winner ? ', the best time' : ''}`}
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
                      background: tint(Math.round(14 + 86 * share)),
                      color: share > 0.55 ? ON_ACCENT : undefined,
                      boxShadow: winner ? `inset 0 0 0 2px ${GLOW}` : undefined,
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
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[12px] text-muted sm:px-0"
      >
        <span className="flex items-center gap-1.5">
          Fewer
          {[14, 35, 57, 78, 100].map((strength) => (
            <span
              key={strength}
              className="inline-block size-3.5 rounded-[4px]"
              style={{ background: tint(strength) }}
            />
          ))}
          More free
        </span>
        <span className="flex items-center gap-1">
          <Icon name="check" size={12} strokeWidth={2.5} /> everyone
        </span>
        {top && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block size-3.5 rounded-[4px]"
              style={{ boxShadow: `inset 0 0 0 2px ${GLOW}` }}
            />
            best time
          </span>
        )}
      </div>

      {shown === null ? (
        <p className="px-1 text-[13.5px] text-muted sm:px-0">
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
              style={free ? { background: tint(18) } : undefined}
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

/** The payoff: the one time that works, big, with the runners-up under it. */
function BestTime({
  plan,
  best,
  total,
  answered,
  sharing,
  onRespond,
  onShare,
}: {
  plan: WhenPlan;
  best: TimeWindow[];
  total: number;
  answered: boolean;
  /** The link is already being handed out just above: don't offer it twice. */
  sharing: boolean;
  onRespond: () => void;
  onShare: () => void;
}) {
  const winner = total > 1 ? best[0] : undefined;
  const wash = {
    backgroundImage: `radial-gradient(110% 80% at 0% 0%, ${tint(winner ? 26 : 12)}, transparent 62%), radial-gradient(80% 70% at 100% 100%, ${tint(winner ? 22 : 9, GLOW)}, transparent 66%)`,
  };

  if (!winner) {
    const [title, lead] =
      total === 0
        ? [
            'No answers yet',
            'Send the invite. As people paint when they’re free, the best time lights up here.',
          ]
        : total === 1
          ? [
              `Just ${plan.people[0].name} so far`,
              'Once a second person adds their times, the overlap shows up here.',
            ]
          : [
              'No overlap yet',
              'Nobody’s free at the same time so far. As more people add their times, that can change.',
            ];
    return (
      <Surface className="grid gap-5 !p-5 sm:!p-7" style={wash}>
        <PreviewArt quiet className="mx-auto w-full max-w-[260px]" />
        <div aria-live="polite" className="text-center">
          <h2
            className="font-display text-[26px] leading-[1.05] font-bold tracking-[-0.03em] text-ink"
            style={{ fontVariationSettings: "'wdth' 108" }}
          >
            {title}
          </h2>
          <p className="mx-auto mt-2 max-w-[36ch] text-[14.5px] leading-snug text-muted">{lead}</p>
        </div>
        <div className={cn('grid gap-2', !sharing && 'sm:grid-cols-2')}>
          {!sharing && (
            <ActionButton icon="share" onClick={onShare}>
              Share the invite
            </ActionButton>
          )}
          <ActionButton variant="quiet" icon="pencil" onClick={onRespond}>
            {answered ? 'Edit your times' : 'Add your times'}
          </ActionButton>
        </div>
      </Surface>
    );
  }

  const everyone = winner.count === total;
  const { free, busy } = splitByMask(plan, winner.mask);
  const from = slotStart(plan, winner.from);
  const to = slotStart(plan, winner.to);
  return (
    <Surface
      as="section"
      aria-labelledby="when-best"
      className="relative isolate grid gap-5 overflow-hidden !p-5 sm:!p-7"
      style={wash}
    >
      <SunsetArt className="pointer-events-none absolute top-4 right-3 -z-10 w-[88px] text-signal-ink sm:top-6 sm:right-6 sm:w-[110px]" />
      <div aria-live="polite" className="grid gap-1">
        <p id="when-best" className="label flex items-center gap-1.5 !text-signal-ink">
          <Icon name="star" size={14} /> Best time
        </p>
        <p
          className="mt-1.5 font-display text-[38px] leading-[0.95] font-extrabold tracking-[-0.04em] text-ink sm:text-[48px]"
          style={{ fontVariationSettings: "'wdth' 112" }}
        >
          {formatDay(plan.days[winner.day])}
        </p>
        <p className="font-display text-[26px] leading-tight font-bold tracking-[-0.03em] text-ink-2 sm:text-[30px]">
          {formatRange(from, to)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Faces people={free} />
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold"
          style={
            everyone
              ? { background: ACCENT, color: ON_ACCENT }
              : { background: tint(18), color: 'var(--color-ink)' }
          }
        >
          {everyone ? (
            <>
              <Icon name="check" size={14} strokeWidth={2.75} /> Everyone’s free
            </>
          ) : (
            <span className="mono-num">
              {winner.count} of {total} free
            </span>
          )}
        </span>
        <span className="text-[13px] text-muted">
          {!everyone && `${notFree(busy.map((person) => person.name))} · `}
          {formatDuration(to - from)}
        </span>
      </div>
      <CopyButton
        text={bestTimesText(plan, best)}
        label="Copy for the group chat"
        what="Best times copied"
        className="!h-12 w-full !rounded-[14px] !text-[15px]"
      />
      {best.length > 1 && (
        <div className="grid gap-2 border-t border-line pt-4">
          <p className="label">Also works</p>
          <ol className="grid gap-1.5">
            {best.slice(1).map((window) => {
              const start = slotStart(plan, window.from);
              const stop = slotStart(plan, window.to);
              return (
                <li
                  key={`${window.day}-${window.from}`}
                  className="flex items-center gap-3 rounded-[14px] bg-subtle/80 px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]"
                >
                  <p className="min-w-0 flex-1 text-[14px] leading-snug text-ink">
                    <span className="font-semibold">{formatDay(plan.days[window.day])}</span>
                    <span className="text-ink-2"> · {formatRange(start, stop)}</span>
                  </p>
                  <span
                    className="mono-num shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                    style={
                      window.count === total
                        ? { background: ACCENT, color: ON_ACCENT }
                        : { background: tint(16), color: 'var(--color-signal-ink)' }
                    }
                  >
                    {window.count}/{total}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
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
