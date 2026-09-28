import * as z from 'zod/mini';
import { TOOL_IDS } from '@/lib/catalog/ids';
import type { ToolId } from '@/lib/catalog/schema';

/*
 * Home preferences: the mode someone picked, the tools they keep handy, and which tools they've
 * opened lately. That's all. No clicks, no durations, no pages, nothing sent anywhere: it's kept
 * in this browser (`hyphy.home.v1`) so Hyphy can put someone's own tools first without an
 * account.
 *
 * Shaped to sync later: every field is last-writer-wins by its own timestamp, pins keep a
 * tombstone when they're taken off (`on: false`), and `mergeHome` joins two copies (this phone
 * and a laptop, once accounts arrive) without losing either side.
 *
 * Pure and tested (tests/lib-home.spec.ts).
 */

export const HOME_KEY = 'hyphy.home.v1';
export const HOME_LENSES = ['everyday', 'create', 'work', 'all'] as const;
export type HomeLens = (typeof HOME_LENSES)[number];

const stamp = z.number().check(z.minimum(0));
const isoDay = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));

const pinSchema = z.object({ on: z.boolean(), t: stamp });
const useSchema = z.object({
  /** First opened. Its place on the shelf never moves after that. */
  first: stamp,
  last: stamp,
  /** Distinct days it was opened: a reload or ten visits in a day count once. */
  days: z.int().check(z.minimum(0), z.maximum(100_000)),
  /** The last of those days, in this device's calendar. */
  day: isoDay,
});

export const homeSchema = z.object({
  v: z.literal(1),
  lens: z.nullable(z.enum(HOME_LENSES)),
  lensAt: stamp,
  pins: z.record(z.string(), pinSchema),
  uses: z.record(z.string(), useSchema),
});
export type HomePrefs = z.infer<typeof homeSchema>;
export type Pin = z.infer<typeof pinSchema>;
export type Use = z.infer<typeof useSchema>;

export function emptyHome(): HomePrefs {
  return { v: 1, lens: null, lensAt: 0, pins: {}, uses: {} };
}

const known = new Set<string>(TOOL_IDS);

/** Parse whatever storage held: anything unknown (an older shape, a removed tool) drops out. */
export function readHome(raw: string | null): HomePrefs {
  if (!raw) return emptyHome();
  try {
    const parsed = z.safeParse(homeSchema, JSON.parse(raw));
    if (!parsed.success) return emptyHome();
    const home = parsed.data;
    const keep = <T>(record: Record<string, T>) =>
      Object.fromEntries(Object.entries(record).filter(([id]) => known.has(id)));
    return { ...home, pins: keep(home.pins), uses: keep(home.uses) };
  } catch {
    return emptyHome();
  }
}

/* ---------------- changes ---------------- */

export function setLens(home: HomePrefs, lens: HomeLens, now: number): HomePrefs {
  return { ...home, lens, lensAt: now };
}

export function isPinned(home: HomePrefs | null, id: ToolId) {
  return Boolean(home?.pins[id]?.on);
}

export function setPin(home: HomePrefs, id: ToolId, on: boolean, now: number): HomePrefs {
  return { ...home, pins: { ...home.pins, [id]: { on, t: now } } };
}

/** A tool was opened today (`today` is YYYY-MM-DD on this device). */
export function recordUse(home: HomePrefs, id: ToolId, now: number, today: string): HomePrefs {
  const before = home.uses[id];
  const use: Use = before
    ? {
        first: before.first,
        last: Math.max(before.last, now),
        days: before.day === today ? before.days : before.days + 1,
        day: today > before.day ? today : before.day,
      }
    : { first: now, last: now, days: 1, day: today };
  return { ...home, uses: { ...home.uses, [id]: use } };
}

/** "Forget what I've opened": pins and the mode stay. */
export function clearHistory(home: HomePrefs): HomePrefs {
  return { ...home, uses: {} };
}

/** Two copies of the same person's home, joined: each field keeps its latest change. */
export function mergeHome(a: HomePrefs, b: HomePrefs): HomePrefs {
  const pins: Record<string, Pin> = { ...a.pins };
  for (const [id, pin] of Object.entries(b.pins))
    if (!pins[id] || pin.t > pins[id].t) pins[id] = pin;
  const uses: Record<string, Use> = { ...a.uses };
  for (const [id, use] of Object.entries(b.uses)) {
    const mine = uses[id];
    uses[id] = mine
      ? {
          first: Math.min(mine.first, use.first),
          last: Math.max(mine.last, use.last),
          days: Math.max(mine.days, use.days),
          day: mine.day > use.day ? mine.day : use.day,
        }
      : use;
  }
  const lens = b.lensAt > a.lensAt ? b : a;
  return { v: 1, lens: lens.lens, lensAt: lens.lensAt, pins, uses };
}

/* ---------------- reading it ---------------- */

const DAY = 86_400_000;
/** Opened on this many different days: it's one of their regulars. */
export const REGULAR_DAYS = 3;
/** Regulars that haven't been opened for this long step off the shelf (pins never do). */
const REGULAR_FOR = 60 * DAY;
/** Tools opened once or twice stay on the shelf this long. */
const RECENT_FOR = 21 * DAY;

export type ShelfReason = 'pinned' | 'regular' | 'recent' | 'starter';
export type ShelfItem = { id: ToolId; reason: ShelfReason; last: number | null };

/**
 * Someone's own tools, in an order that stays put: what they pinned (in the order they pinned
 * it), then the tools they come back to, then the ones they tried lately, each in the order it
 * first arrived. Nothing jumps around because it was used a minute ago; the automatic part only
 * adds and, after weeks unused, lets go. Starters fill the shelf until it's the person's own.
 */
export function shelf(
  home: HomePrefs,
  {
    now,
    starters,
    listed,
    fill = 6,
    max = 8,
  }: { now: number; starters: ToolId[]; listed: ReadonlySet<ToolId>; fill?: number; max?: number },
): ShelfItem[] {
  const items: ShelfItem[] = [];
  const has = (id: ToolId) => items.some((item) => item.id === id);
  const last = (id: ToolId) => home.uses[id]?.last ?? null;

  const pinned = Object.entries(home.pins)
    .filter(([id, pin]) => pin.on && listed.has(id as ToolId))
    .sort((a, b) => a[1].t - b[1].t);
  for (const [id] of pinned)
    items.push({ id: id as ToolId, reason: 'pinned', last: last(id as ToolId) });

  const used = Object.entries(home.uses)
    .filter(([id]) => listed.has(id as ToolId))
    .sort((a, b) => a[1].first - b[1].first) as [ToolId, Use][];
  for (const [id, use] of used)
    if (!has(id) && use.days >= REGULAR_DAYS && now - use.last < REGULAR_FOR)
      items.push({ id, reason: 'regular', last: use.last });
  for (const [id, use] of used)
    if (!has(id) && use.days < REGULAR_DAYS && now - use.last < RECENT_FOR)
      items.push({ id, reason: 'recent', last: use.last });

  for (const id of starters)
    if (items.length < fill && !has(id) && listed.has(id))
      items.push({ id, reason: 'starter', last: null });

  return items.slice(0, Math.max(max, pinned.length));
}

/** Whether someone has made the home their own yet (a pin, or a tool opened). */
export function isPersonal(home: HomePrefs | null) {
  if (!home) return false;
  return Object.values(home.pins).some((pin) => pin.on) || Object.keys(home.uses).length > 0;
}

/** The tools opened most recently, newest first. */
export function recentTools(home: HomePrefs, limit = 4): { id: ToolId; last: number }[] {
  return (Object.entries(home.uses) as [ToolId, Use][])
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, limit)
    .map(([id, use]) => ({ id, last: use.last }));
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Yesterday", "Sunday" (this past week), then "Sep 12". In this device's time. */
export function whenLabel(stampMs: number, now: number) {
  const day = new Date(stampMs);
  const today = new Date(now);
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / DAY);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return WEEKDAYS[day.getDay()];
  return `${MONTHS[day.getMonth()]} ${day.getDate()}`;
}

/** "Good morning", "Good afternoon", "Good evening", by this device's clock. */
export function greeting(now: number) {
  const hour = new Date(now).getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** YYYY-MM-DD in this device's calendar. */
export function localDay(now: number) {
  const date = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
