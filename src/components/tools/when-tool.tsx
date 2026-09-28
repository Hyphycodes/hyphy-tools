'use client';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { clearHash, decodeState, newId, writeHash } from '@/lib/share/link-state';
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
  localDay,
  MAX_DAYS,
  MAX_PEOPLE,
  mergePlans,
  newPlan,
  packCells,
  planHours,
  quickPicks,
  samplePlan,
  slotsPerDay,
  slotStart,
  tallyPlan,
  whenPlanSchema,
  whenSavedSchema,
  windowWhen,
  withPerson,
  type SlotSize,
  type TimeWindow,
  type WhenPerson,
  type WhenPlan,
  type WhenSaved,
} from '@/lib/tools/when';
import { ActionBar, Advanced, Choices, IconButton, Note, SampleButton, useCopy } from './kit';
import { CellDetail, HeatGrid, PaintGrid } from './when-grid';
import {
  ACCENT,
  Avatar,
  BIG_BUTTON,
  BIG_FILL,
  BestTicket,
  colorOf,
  CombineLinks,
  CopyBest,
  Faces,
  InviteCard,
  ON_ACCENT,
  Pill,
  SendActions,
  tint,
} from './when-parts';
import { DayParts, DayPicker, partsName } from './when-setup';
import { PlanReturn, usePlanHandoff } from './plan-return';

/*
 * When?: tap the days, pick the time of day, send the invite, and everyone paints when they're
 * free. The plan and everyone's times live inside the link (after the #, which browsers never
 * send to a server). This device keeps a copy of each plan, so links that come back combine.
 */

const STORE = 'hyphy.when.v1.';
/** Plans a device remembers; older ones still open from their links. */
const KEEP = 20;
/** What a plan is called when nobody names it. */
const DEFAULT_TITLE = 'Get-together';

type View = 'share' | 'respond' | 'results';

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

/** Scrolls an element into view when it's out of sight, gently unless motion is reduced. */
function reveal(element: HTMLElement | null) {
  if (!element) return;
  const { top } = element.getBoundingClientRect();
  if (top >= 0 && top < window.innerHeight * 0.75) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
}

/** 'America/Chicago' → 'Chicago', for "times in Chicago time". */
const zoneCity = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

/** 'Evening · 5–10 PM', or just the hours when they're custom. */
const hoursWords = (plan: Pick<WhenPlan, 'start' | 'end'>) => {
  const named = partsName(plan.start, plan.end);
  return named && named !== 'All day' ? `${named} · ${planHours(plan)}` : planHours(plan);
};

/** Tap to name it, instead of typing. */
const NAMES = ['Dinner', 'Game night', 'Drinks', 'Team call', 'Catch-up', 'Birthday'];

/** Now, but always later than the copy it replaces, even if this device's clock runs behind. */
function laterThan(updated: number) {
  return Math.max(Date.now(), updated + 1);
}

function freshPersonId(plan: WhenPlan) {
  let id = newId(6);
  while (plan.people.some((person) => person.id === id)) id = newId(6);
  return id;
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
        <div aria-busy="true" className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,.8fr)]">
          <div className="skeleton h-[520px] !rounded-[28px]" />
          <div className="skeleton hidden h-[360px] !rounded-[28px] lg:block" />
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

/** The weekend coming up, or the next one when this one is nearly over. */
function firstPick(today: string) {
  const picks = quickPicks(today);
  const weekend = picks.find((pick) => pick.id === 'this-weekend');
  const next = picks.find((pick) => pick.id === 'next-weekend');
  return (weekend && weekend.days.length >= 2 ? weekend : (next ?? picks[0])).days;
}

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
  const [naming, setNaming] = useState(false);
  const [days, setDays] = useState<string[]>(() => firstPick(today));
  const [start, setStart] = useState(17);
  const [end, setEnd] = useState(22);
  const [slot, setSlot] = useState<SlotSize>(60);
  const [saved, setSaved] = useState(savedAtStart);
  const titleInput = useRef<HTMLInputElement>(null);
  // Opened from a Plan: the invite starts with the plan's name.
  const handoff = usePlanHandoff();
  const handoffTitle = handoff?.title ?? '';
  useEffect(() => {
    // The address is read once the page is interactive; the title follows it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (handoffTitle) setTitle((current) => current || handoffTitle);
  }, [handoffTitle]);

  const create = () => {
    if (!days.length) return;
    onCreate(
      newPlan({
        id: newId(10),
        title: title.trim() || DEFAULT_TITLE,
        tz: currentTimeZone(),
        days,
        start,
        end,
        slot,
      }),
    );
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

  const named = partsName(start, end);
  const summary = days.length
    ? `${days.length} ${days.length === 1 ? 'day' : 'days'} · ${named && named !== 'All day' ? `${named}, ` : ''}${planHours({ start, end })}`
    : 'Tap the days that could work';

  const cta = (
    <button
      type="button"
      onClick={create}
      disabled={!days.length}
      className={BIG_BUTTON}
      style={BIG_FILL}
    >
      <Icon name="send" size={20} /> Make the invite
    </button>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,.8fr)] lg:items-start lg:gap-6">
      {/* The calendar is the tool: the days are the one real question. */}
      <section
        aria-labelledby={`${id}-title`}
        className="grid min-w-0 gap-4 rounded-[28px] bg-surface p-3 pt-4 shadow-lift sm:p-6"
      >
        {broken && (
          <Note icon="alert" tone="caution">
            That link couldn’t be opened. It may have been cut off: ask for it again, or start a new
            plan here.
          </Note>
        )}
        <div className="grid gap-2 px-1">
          <label htmlFor={`${id}-title`} className="sr-only">
            What’s it for?
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={titleInput}
              id={`${id}-title`}
              value={title}
              maxLength={80}
              autoComplete="off"
              enterKeyHint="done"
              placeholder={DEFAULT_TITLE}
              onChange={(event) => setTitle(event.target.value)}
              onFocus={() => setNaming(true)}
              onBlur={() => setNaming(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              className="min-w-0 flex-1 bg-transparent font-display text-[30px] leading-[1.1] font-bold tracking-[-0.035em] text-ink outline-none placeholder:text-ink sm:text-[38px]"
              style={{ fontVariationSettings: "'wdth' 110" }}
            />
            <button
              type="button"
              aria-label="Name it"
              onClick={() => titleInput.current?.focus()}
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-ink/[.06] hover:text-ink',
                naming && 'invisible',
              )}
            >
              <Icon name="pencil" size={17} />
            </button>
          </div>
          {naming && (
            <div className="fx-rise -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  // Keeps the field focused, so the tap lands before the chips hide.
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setTitle(name);
                    titleInput.current?.blur();
                  }}
                  className="h-10 shrink-0 rounded-full bg-ink/[.06] px-3.5 text-[14px] font-semibold text-ink-2 hover:bg-ink/10 hover:text-ink"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          role="group"
          aria-label="Quick picks"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
        >
          {picks.map((pick) => {
            const on = pick.days.join() === days.join();
            return (
              <button
                key={pick.id}
                type="button"
                aria-pressed={on}
                onClick={() => setDays(pick.days)}
                className={cn(
                  'fx-move h-10 shrink-0 rounded-full px-3.5 text-[14px] font-semibold',
                  on
                    ? 'text-[var(--on-accent,#12110d)]'
                    : 'bg-ink/[.06] text-ink-2 hover:bg-ink/10 hover:text-ink',
                )}
                style={on ? { background: ACCENT } : undefined}
              >
                {pick.label}
              </button>
            );
          })}
          {days.length > 0 && (
            <button
              type="button"
              onClick={() => setDays([])}
              className="h-10 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-muted hover:bg-ink/[.05] hover:text-ink"
            >
              Clear
            </button>
          )}
        </div>

        <DayPicker today={today} selected={days} onChange={setDays} />
        {days.length >= MAX_DAYS && (
          <p className="-mt-1 text-center text-[13px] font-medium text-muted">
            {MAX_DAYS} days is the most one plan holds.
          </p>
        )}
      </section>

      <div className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        <section
          aria-labelledby={`${id}-when`}
          className="grid gap-3 rounded-[28px] bg-surface p-3 pt-4 shadow-lift sm:p-5"
        >
          <h2 id={`${id}-when`} className="px-1 text-[17px] font-bold tracking-[-0.01em] text-ink">
            What time of day?
          </h2>
          <DayParts
            start={start}
            end={end}
            onChange={(from, to) => {
              setStart(from);
              setEnd(to);
            }}
          />
          <Advanced summary={slot === 30 ? '30-minute slots' : undefined} className="px-1">
            <div className="grid gap-3 pb-1">
              <Choices
                label="Slot size"
                value={String(slot) as '60' | '30'}
                options={[
                  { value: '60', label: '1-hour slots' },
                  { value: '30', label: '30-minute slots' },
                ]}
                onChange={(value) => setSlot(value === '30' ? 30 : 60)}
              />
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <Icon name="globe" size={15} className="shrink-0" />
                {zone ? `${zoneCity(zone)} time, for everyone` : 'Your time, for everyone'}
              </p>
            </div>
          </Advanced>
          <div className="hidden lg:grid lg:gap-2">
            {cta}
            <p className="text-center text-[13px] font-medium text-muted" aria-live="polite">
              {summary}
            </p>
          </div>
        </section>

        <SampleButton onClick={() => onOpen(samplePlan(today, currentTimeZone()), 'results')}>
          See an example
        </SampleButton>

        {saved.length > 0 && (
          <section aria-labelledby={`${id}-saved`} className="grid gap-2 px-1">
            <h2 id={`${id}-saved`} className="label">
              Your plans
            </h2>
            <ul className="grid gap-1.5">
              {saved.slice(0, 8).map(({ plan }) => (
                <li
                  key={plan.id}
                  className="flex items-center gap-2 rounded-[18px] bg-surface p-1.5 pl-2 shadow-card"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(plan)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-1 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className="num grid size-10 shrink-0 place-items-center rounded-[12px] text-[14px] font-bold"
                      style={{ background: tint(30), color: 'var(--color-ink)' }}
                    >
                      {Number(plan.days[0].slice(8))}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-semibold text-ink">
                        {plan.title || 'Untitled plan'}
                      </span>
                      <span className="block truncate text-[12.5px] text-muted">
                        {describeDays(plan.days)} · {plan.people.length}{' '}
                        {plan.people.length === 1 ? 'person' : 'people'}
                      </span>
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
          </section>
        )}
      </div>

      {/* Under the thumb on a phone, whichever part of the setup is on screen. */}
      <ActionBar className="!mt-0 -mx-3 px-3 lg:hidden">
        {cta}
        <p className="mt-2 text-center text-[13px] font-medium text-muted" aria-live="polite">
          {summary}
        </p>
      </ActionBar>
    </div>
  );
}

/* ---------------- A plan ---------------- */

const TABS: { view: View; label: string; icon: 'send' | 'hand' | 'star' }[] = [
  { view: 'share', label: 'Invite', icon: 'send' },
  { view: 'respond', label: 'My times', icon: 'hand' },
  { view: 'results', label: 'Best time', icon: 'star' },
];

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
  const zone = useTimeZone();
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
  const [spot, setSpot] = useState<number | null>(null);
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
  const color = colorOf(plan, target?.id);
  const winner = total > 1 ? (best[0] ?? null) : null;
  const rows = slotsPerDay(plan);
  const [picked, setPicked] = useState<number | null>(() =>
    winner ? winner.day * rows + winner.from : null,
  );

  // Everyone else, drawn faintly under your paint.
  const others = useMemo(() => {
    const rest = plan.people.filter((person) => person.id !== target?.id);
    return rest.length ? tallyPlan({ ...plan, people: rest }) : null;
  }, [plan, target?.id]);

  // What the group looks like with your times in, as you paint.
  const withYou = useMemo(() => {
    if (!marked) return null;
    const preview = withPerson(plan, {
      id: target?.id ?? 'you',
      name: name.trim() || 'You',
      times: packed,
      updated: 0,
    });
    const count = preview.people.length;
    const first = count > 1 ? bestTimes(preview, 1)[0] : undefined;
    return first ? { plan: preview, window: first, total: count } : null;
  }, [plan, packed, marked, name, target?.id]);

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
      updated: laterThan(target?.updated ?? 0),
    };
    const next = withPerson(plan, person);
    onCommit(next, person.id);
    setName(clean);
    setClaimed(null);
    setClash(null);
    setJustSaved(true);
    // Land on the answer with the best time picked out.
    const first = bestTimes(next, 1)[0];
    setPicked(first && next.people.length > 1 ? first.day * rows + first.from : null);
    go('results');
  };

  const startOver = () => {
    if (dirty && !window.confirm('Start a new plan? The times you haven’t saved will be lost.'))
      return;
    onStartOver();
  };

  const notes =
    (zone && zone !== plan.tz) || passed || note ? (
      <div className="grid gap-2">
        {zone && zone !== plan.tz && (
          <Note icon="globe" tone="caution">
            Times are in {zoneCity(plan.tz)} time ({plan.tz}), not converted to yours.
          </Note>
        )}
        {passed && (
          <Note icon="calendar" tone="caution">
            All of these days have passed. Start a new plan to pick new ones.
          </Note>
        )}
        {note && (
          <Note icon="check" tone="positive">
            {note}
          </Note>
        )}
      </div>
    ) : null;

  return (
    <div className="grid gap-4">
      <PlanReturn
        tool="when"
        ready={Boolean(winner)}
        attachment={() => ({
          url: window.location.href,
          summary: winner
            ? `${formatDay(plan.days[winner.day])} · ${formatTime(slotStart(plan, winner.from))}`
            : total
              ? `${total} ${total === 1 ? 'person has' : 'people have'} answered`
              : 'Waiting for answers',
          t: Date.now(),
          ...(winner
            ? { date: plan.days[winner.day], time: slotStart(plan, winner.from) % 1440 }
            : {}),
        })}
      />
      {/* The plan, and where you are in it. */}
      <div ref={top} className="grid scroll-mt-24 gap-3 sm:flex sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-display text-[24px] leading-tight font-bold tracking-[-0.03em] text-ink sm:text-[28px]"
              style={{ fontVariationSettings: "'wdth' 108" }}
            >
              {plan.title || DEFAULT_TITLE}
            </p>
            <p className="truncate text-[13.5px] font-medium text-muted">
              {describeDays(plan.days)} · {planHours(plan)}
            </p>
          </div>
          <button
            type="button"
            onClick={startOver}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-ink/[.06] px-4 text-[14px] font-semibold text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink sm:order-last"
          >
            <Icon name="plus" size={15} /> New
          </button>
        </div>
        <nav
          aria-label="This plan"
          className="grid grid-cols-3 gap-1 rounded-full bg-ink/[.06] p-1 sm:w-[400px] sm:shrink-0"
        >
          {TABS.map((tab) => {
            const here = view === tab.view;
            return (
              <button
                key={tab.view}
                type="button"
                aria-current={here ? 'page' : undefined}
                onClick={() => go(tab.view)}
                className={cn(
                  'fx-move inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 text-[14px] font-semibold',
                  here ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
                )}
              >
                <Icon
                  name={tab.icon}
                  size={15}
                  className={cn('shrink-0', here && 'text-[var(--accent-ink)]')}
                />
                <span className="truncate">{tab.label}</span>
                {tab.view === 'results' && total > 0 && (
                  <span className="num hidden text-[12px] font-bold text-muted sm:inline">
                    {total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {view === 'share' ? (
        <div className="mx-auto grid w-full max-w-[520px] gap-5 pt-2 sm:pt-4">
          {notes}
          <InviteCard plan={plan} today={today} hours={hoursWords(plan)} />
          <SendActions plan={plan} label={total ? 'Send the latest link' : 'Send the invite'}>
            <Pill icon="hand" onClick={() => go('respond')}>
              {mine ? 'Edit my times' : 'Add my times'}
            </Pill>
          </SendActions>
          {total > 0 && (
            <button
              type="button"
              onClick={() => go('results')}
              className="mx-auto inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-[var(--accent-ink)] hover:bg-ink/[.05]"
            >
              <Faces plan={plan} people={plan.people} size={26} max={5} />
              {total} {total === 1 ? 'answer' : 'answers'} so far
              <Icon name="chevron-right" size={15} />
            </button>
          )}
        </div>
      ) : view === 'respond' ? (
        <section
          aria-label="Your times"
          className="mx-auto grid w-full max-w-[860px] gap-3 rounded-[28px] bg-surface p-3 pt-4 shadow-lift sm:p-6"
        >
          {/* Who's painting: your name, in your color. */}
          <div className="flex items-center gap-3 px-1">
            <Avatar name={name || '?'} color={color} size={44} ring={false} />
            <div className="min-w-0 flex-1">
              <label
                htmlFor={`${id}-name`}
                className="block text-[12px] font-semibold tracking-[0.06em] text-muted uppercase"
              >
                Your name
              </label>
              <input
                ref={nameInput}
                id={`${id}-name`}
                value={name}
                maxLength={40}
                autoComplete="given-name"
                autoCapitalize="words"
                enterKeyHint="done"
                placeholder="Tap to add"
                aria-invalid={nameMissing && !name.trim() ? true : undefined}
                aria-describedby={nameMissing && !name.trim() ? `${id}-name-error` : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setClash(null);
                }}
                onBlur={() => setClash(matchName())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                className="w-full min-w-0 bg-transparent text-[20px] font-bold tracking-[-0.01em] text-ink outline-none placeholder:font-semibold placeholder:text-faint"
              />
            </div>
          </div>
          {nameMissing && !name.trim() && (
            <p
              id={`${id}-name-error`}
              role="alert"
              className="-mt-1 px-1 text-[13px] font-semibold text-critical"
            >
              Add your name, so the group knows whose times these are.
            </p>
          )}
          {clash && (
            <div
              role="alert"
              className="grid gap-3 rounded-[16px] bg-caution-soft p-3.5 text-[13.5px] text-caution"
            >
              <p>
                <strong>{clash.name}</strong> already added times. Is that you?
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
                  className="h-11 rounded-full bg-ink px-4 text-[14px] font-semibold text-on-ink hover:bg-ink-2"
                >
                  Yes, edit {clash.name}’s times
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNotMe((current) => [...current, clash.id]);
                    setClash(null);
                  }}
                  className="h-11 rounded-full bg-ink/[.07] px-4 text-[14px] font-semibold text-ink-2 hover:bg-ink/10 hover:text-ink"
                >
                  No, I’m someone else
                </button>
              </div>
            </div>
          )}
          {claimed && !mine && (
            <Note icon="pencil" tone="positive">
              Editing {claimed.name}’s times. Saving replaces them.
            </Note>
          )}
          {notes}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 pt-1">
            <p className="text-[15px] font-bold text-ink">When are you free?</p>
            <p className="text-[12.5px] font-medium text-muted">Tap or drag · tap a day for all</p>
          </div>
          <PaintGrid
            plan={plan}
            cells={cells}
            today={today}
            color={color}
            others={others}
            onChange={setCells}
          />
          <div className="-mt-1 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
            <p
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium text-ink-2"
              aria-live="polite"
            >
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3.5 rounded-[4px]"
                  style={{ background: color }}
                />
                {marked ? `${formatDuration(marked * plan.slot)} free` : 'Nothing marked yet'}
              </span>
              {others && (
                <span className="flex items-center gap-1.5 text-muted">
                  <span
                    aria-hidden="true"
                    className="size-3.5 rounded-[4px]"
                    style={{ background: tint(34) }}
                  />
                  Others free
                </span>
              )}
              {target && dirty && <span className="text-muted">Not saved yet</span>}
            </p>
            {marked > 0 && (
              <button
                type="button"
                onClick={() => setCells(emptyCells(plan))}
                className="h-11 rounded-full px-3.5 text-[14px] font-semibold text-muted transition-colors hover:bg-ink/[.06] hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {full && (
            <Note icon="people" tone="caution">
              This plan already has {MAX_PEOPLE} people, the most one plan can hold.
            </Note>
          )}
          <ActionBar className="!mt-0 -mx-3 rounded-b-[28px] px-3 sm:mx-0 sm:px-0">
            {withYou && (
              <p
                key={`${withYou.window.day}-${withYou.window.from}-${withYou.window.count}`}
                className="fx-pop mb-2.5 flex items-center justify-center gap-2 text-center text-[14px] font-semibold text-ink"
              >
                {withYou.window.count === withYou.total ? (
                  <Icon
                    name="check-circle"
                    size={17}
                    className="shrink-0 text-[var(--accent-ink)]"
                  />
                ) : (
                  <Icon name="star" size={16} className="shrink-0 text-[var(--accent-ink)]" />
                )}
                <span className="min-w-0 truncate">{windowWhen(withYou.plan, withYou.window)}</span>
                <span
                  className="num shrink-0 rounded-full px-2 py-0.5 text-[12.5px] font-bold"
                  style={
                    withYou.window.count === withYou.total
                      ? { background: ACCENT, color: ON_ACCENT }
                      : { background: tint(22) }
                  }
                >
                  {withYou.window.count}/{withYou.total}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={save}
              disabled={full || (!!mine && !dirty)}
              className={BIG_BUTTON}
              style={BIG_FILL}
            >
              <Icon name="check" size={20} />
              {mine && !dirty ? 'Saved' : target ? 'Save changes' : 'Save my times'}
            </button>
            {!marked && !full && (
              <p className="mt-2 text-center text-[12.5px] text-muted">
                Saving with nothing marked means none of these work.
              </p>
            )}
          </ActionBar>
        </section>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="grid min-w-0 gap-4">
            {notes}
            {sendBack && mine && (
              <p className="fx-pop inline-flex items-center gap-2 justify-self-start rounded-full bg-positive-soft px-3.5 py-2 text-[14px] font-semibold text-positive">
                <Icon name="check" size={16} strokeWidth={2.75} /> You’re in, {mine.name}
              </p>
            )}
            {winner ? (
              <BestTicket plan={plan} best={winner} total={total}>
                <Answers
                  plan={plan}
                  best={best}
                  total={total}
                  sendBack={sendBack}
                  onShare={() => go('share')}
                />
              </BestTicket>
            ) : (
              <NoAnswer
                plan={plan}
                total={total}
                answered={!!mine}
                sendBack={sendBack}
                onShare={() => go('share')}
                onRespond={() => go('respond')}
              />
            )}
            {total > 0 && (
              <section
                aria-labelledby={`${id}-everyone`}
                className="grid gap-3 rounded-[28px] bg-surface p-3 pt-4 shadow-card sm:p-5"
              >
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h2 id={`${id}-everyone`} className="text-[16px] font-bold text-ink">
                    Everyone’s times
                  </h2>
                  <span className="text-[12.5px] font-medium text-muted">
                    {zoneCity(plan.tz)} time
                  </span>
                </div>
                <HeatGrid
                  plan={plan}
                  tally={tally}
                  best={winner}
                  today={today}
                  picked={picked}
                  onPick={setPicked}
                  spot={spot}
                />
                <Legend total={total} />
                {picked !== null && picked < tally.counts.length && (
                  <CellDetail plan={plan} tally={tally} index={picked} />
                )}
              </section>
            )}
            {winner && best.length > 1 && (
              <AlsoWorks
                plan={plan}
                best={best}
                total={total}
                onPick={(window) => setPicked(window.day * rows + window.from)}
              />
            )}
          </div>

          <aside aria-label="People" className="grid gap-4 lg:sticky lg:top-24">
            <section className="grid gap-2 rounded-[24px] bg-surface p-3 shadow-card sm:p-4">
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="label">People · {plan.people.length}</h2>
                {plan.people.length > 1 && (
                  <span className="text-[12px] text-muted">Tap to see theirs</span>
                )}
              </div>
              {plan.people.length === 0 ? (
                <p className="px-1 pb-1 text-[13.5px] text-muted">No one yet.</p>
              ) : (
                <ul className="grid gap-0.5">
                  {plan.people.map((person, index) => {
                    const you = person.id === me;
                    const minutes = countCells(cellsOf(plan, person)) * plan.slot;
                    const on = spot === index;
                    return (
                      <li key={person.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => setSpot(on ? null : index)}
                          className={cn(
                            'fx-move flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-[14px] px-1.5 py-1 text-left hover:bg-ink/[.04]',
                            on && 'bg-ink/[.05]',
                          )}
                          style={
                            on
                              ? { boxShadow: `inset 0 0 0 2px ${colorOf(plan, person.id)}` }
                              : undefined
                          }
                        >
                          <Avatar
                            name={person.name}
                            color={colorOf(plan, person.id)}
                            size={36}
                            ring={false}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14.5px] font-semibold text-ink">
                              {person.name}
                              {you && <span className="font-normal text-muted"> (you)</span>}
                            </span>
                            <span className="block text-[12.5px] text-muted">
                              {minutes ? `${formatDuration(minutes)} free` : 'None of these work'}
                            </span>
                          </span>
                        </button>
                        {you && (
                          <IconButton
                            icon="pencil"
                            label="Edit your times"
                            onClick={() => go('respond')}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {!mine && (
                <Pill icon="hand" onClick={() => go('respond')} className="mt-1">
                  Add my times
                </Pill>
              )}
            </section>
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

/* ---------------- The answer ---------------- */

/** Under the ticket: what to do with it. */
function Answers({
  plan,
  best,
  total,
  sendBack,
  onShare,
}: {
  plan: WhenPlan;
  best: TimeWindow[];
  total: number;
  sendBack: boolean;
  onShare: () => void;
}) {
  const everyone = best[0]?.count === total;
  return sendBack ? (
    <SendActions plan={plan} label="Send it back">
      <CopyBest plan={plan} best={best} />
    </SendActions>
  ) : everyone ? (
    <div className="grid gap-3">
      <Announce plan={plan} best={best} />
      <div className="flex flex-wrap justify-center gap-2">
        <Pill icon="send" onClick={onShare}>
          Share the link
        </Pill>
      </div>
    </div>
  ) : (
    <SendActions plan={plan} label="Send the latest link">
      <CopyBest plan={plan} best={best} />
    </SendActions>
  );
}

/** The runners-up: tap one to see it on the grid. */
function AlsoWorks({
  plan,
  best,
  total,
  onPick,
}: {
  plan: WhenPlan;
  best: TimeWindow[];
  total: number;
  onPick: (window: TimeWindow) => void;
}) {
  return (
    <section className="grid gap-2 px-1">
      <h2 className="label">Also works</h2>
      <ol className="grid gap-1.5">
        {best.slice(1).map((window) => {
          const all = window.count === total;
          return (
            <li key={`${window.day}-${window.from}`}>
              <button
                type="button"
                onClick={() => onPick(window)}
                className="flex min-h-12 w-full items-center gap-3 rounded-[16px] bg-surface px-3.5 py-2 text-left shadow-card transition-transform active:scale-[.99]"
              >
                <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink">
                  <span className="font-bold">{formatDay(plan.days[window.day])}</span>
                  <span className="text-ink-2">
                    {' '}
                    · {formatRange(slotStart(plan, window.from), slotStart(plan, window.to))}
                  </span>
                </span>
                <span
                  className="num shrink-0 rounded-full px-2 py-0.5 text-[12.5px] font-bold"
                  style={
                    all
                      ? { background: ACCENT, color: ON_ACCENT }
                      : { background: tint(20), color: 'var(--color-ink)' }
                  }
                >
                  {window.count}/{total}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Everyone's free: telling the group is the one thing left to do. */
function Announce({ plan, best }: { plan: WhenPlan; best: TimeWindow[] }) {
  const { copy, copied } = useCopy();
  const text = bestTimesText(plan, best);
  const done = copied === text;
  return (
    <button
      type="button"
      onClick={() => void copy(text, 'Best times copied')}
      className={BIG_BUTTON}
      style={BIG_FILL}
    >
      <Icon name={done ? 'check' : 'copy'} size={20} />
      {done ? 'Copied. Paste it in the chat' : 'Copy for the group chat'}
    </button>
  );
}

/** Before there's an answer: who's in so far, and the way to get more. */
function NoAnswer({
  plan,
  total,
  answered,
  sendBack,
  onShare,
  onRespond,
}: {
  plan: WhenPlan;
  total: number;
  answered: boolean;
  sendBack: boolean;
  onShare: () => void;
  onRespond: () => void;
}) {
  const [title, lead] =
    total === 0
      ? ['No answers yet', 'Send the invite. The best time lights up here.']
      : total === 1
        ? [`Just ${plan.people[0].name} so far`, 'One more and the overlap shows up.']
        : ['No overlap yet', 'Nobody’s free at the same time so far.'];
  return (
    <section
      aria-live="polite"
      className="relative isolate grid gap-5 overflow-hidden rounded-[28px] bg-surface p-5 text-center shadow-lift sm:p-7"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: `radial-gradient(70% 70% at 50% 0%, ${tint(18)}, transparent 70%)` }}
      />
      {total > 0 && (
        <div className="mx-auto">
          <Faces plan={plan} people={plan.people} size={40} />
        </div>
      )}
      <div>
        <h2
          className="font-display text-[28px] leading-[1.05] font-bold tracking-[-0.03em] text-ink"
          style={{ fontVariationSettings: "'wdth' 108" }}
        >
          {title}
        </h2>
        <p className="mx-auto mt-1.5 max-w-[34ch] text-[15px] text-muted">{lead}</p>
      </div>
      {sendBack ? (
        <SendActions plan={plan} label="Send it back" />
      ) : (
        <div className="grid gap-2">
          <button type="button" onClick={onShare} className={BIG_BUTTON} style={BIG_FILL}>
            <Icon name="send" size={20} /> Send the invite
          </button>
          <Pill icon="hand" onClick={onRespond} className="mx-auto">
            {answered ? 'Edit my times' : 'Add my times'}
          </Pill>
        </div>
      )}
    </section>
  );
}

function Legend({ total }: { total: number }) {
  return (
    <div
      aria-hidden="true"
      className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[12px] font-medium text-muted"
    >
      <span className="flex items-center gap-1.5">
        Fewer
        {[14, 30, 46, 62, 82].map((strength) => (
          <span
            key={strength}
            className="inline-block size-3.5 rounded-[4px]"
            style={{ background: tint(strength) }}
          />
        ))}
        More free
      </span>
      {total > 1 && (
        <span className="flex items-center gap-1.5">
          <span
            className="grid size-3.5 place-items-center rounded-[4px]"
            style={{ background: ACCENT, color: ON_ACCENT }}
          >
            <Icon name="check" size={10} strokeWidth={3.5} />
          </span>
          Everyone
        </span>
      )}
    </div>
  );
}
