import * as z from 'zod/mini';

/*
 * When?: a group availability plan that lives entirely inside its link. A plan fixes its days,
 * hours and slot size once; each person's free slots are one bitset over (days × slots), packed
 * into base64url, so a whole group's times fit in a link someone can paste in a chat.
 * Pure and tested (tests/lib-when.spec.ts).
 *
 * Days are 'YYYY-MM-DD' strings and every calendar sum runs on UTC day numbers, so a plan reads
 * the same in every time zone: no Date with a time zone ever decides which day it is. Times are
 * minutes after midnight in the plan's own time zone, which is shown on the plan, never converted.
 */

export const MAX_DAYS = 14;
export const MAX_PEOPLE = 24;
export type SlotSize = 30 | 60;

/* ---------------- Days ---------------- */

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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

const pad = (value: number) => String(value).padStart(2, '0');
const utc = (day: string) => new Date(dayNumber(day) * DAY_MS);

/** 'YYYY-MM-DD' → whole days since 1970-01-01, or NaN when it isn't a real calendar day. */
export function dayNumber(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return NaN;
  const [year, month, date] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const check = new Date(Date.UTC(year, month, date));
  // Date.UTC quietly rolls Feb 30 into March: a real day survives the round trip unchanged.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month ||
    check.getUTCDate() !== date
  )
    return NaN;
  return check.getTime() / DAY_MS;
}

export const isDay = (day: string) => !Number.isNaN(dayNumber(day));

/** Whole days since 1970-01-01 → 'YYYY-MM-DD'. */
export function dayFromNumber(value: number) {
  const date = new Date(value * DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export const addDays = (day: string, count: number) => dayFromNumber(dayNumber(day) + count);

/** 0 is Sunday, 6 is Saturday. */
export const weekdayOf = (day: string) => utc(day).getUTCDay();

/** Today on this device's own calendar: the one place a local clock decides the day. */
export function localDay(now: Date) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 'Sat, Oct 3' */
export function formatDay(day: string) {
  const date = utc(day);
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** 'Oct 3' */
export function shortDay(day: string) {
  const date = utc(day);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** 'Sat' */
export const weekdayName = (day: string) => WEEKDAYS[weekdayOf(day)];

/** 'Sat, Oct 3', 'Fri, Oct 2 – Sun, Oct 4', or '5 days, Oct 2 – Oct 15' when there are gaps. */
export function describeDays(days: string[]) {
  if (!days.length) return 'No days picked';
  const first = days[0];
  const last = days[days.length - 1];
  if (days.length === 1) return formatDay(first);
  if (dayNumber(last) - dayNumber(first) + 1 === days.length)
    return `${formatDay(first)} – ${formatDay(last)}`;
  return `${days.length} days, ${shortDay(first)} – ${shortDay(last)}`;
}

export type Month = { year: number; month: number };

export const monthOf = (day: string): Month => ({
  year: Number(day.slice(0, 4)),
  month: Number(day.slice(5, 7)) - 1,
});

export function shiftMonth({ year, month }: Month, by: number): Month {
  const index = year * 12 + month + by;
  return { year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 };
}

/** 'October 2026' */
export const monthTitle = ({ year, month }: Month) => `${MONTH_NAMES[month]} ${year}`;

/** A month laid out for a calendar, Sunday first, with null for the blanks around it. */
export function monthWeeks({ year, month }: Month): (string | null)[][] {
  const first = Date.UTC(year, month, 1) / DAY_MS;
  const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: new Date(first * DAY_MS).getUTCDay() }, () => null),
    ...Array.from({ length }, (_, index) => dayFromNumber(first + index)),
  ];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Ready-made sets of days, counted from today. A weekend here is Friday to Sunday. */
export function quickPicks(today: string) {
  const weekday = weekdayOf(today);
  // This week's Friday, which is already behind us on a Saturday or a Sunday.
  const friday = addDays(today, weekday === 0 ? -2 : 5 - weekday);
  const run = (from: string, count: number) =>
    Array.from({ length: count }, (_, index) => addDays(from, index));
  return [
    { id: 'week', label: 'Next 7 days', days: run(today, 7) },
    {
      id: 'this-weekend',
      label: 'This weekend',
      days: run(friday, 3).filter((day) => day >= today),
    },
    { id: 'next-weekend', label: 'Next weekend', days: run(addDays(friday, 7), 3) },
  ];
}

/* ---------------- Times ---------------- */

/** '7 PM', '7:30 PM'; with `withMinutes`, always '7:00 PM'. 1440 is midnight again. */
export function formatTime(minutes: number, withMinutes = false) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  const clock = hour % 12 || 12;
  return `${clock}${minute || withMinutes ? `:${pad(minute)}` : ''} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** '7–9 PM', '11 AM – 1 PM', '10 PM – midnight', 'All day'. */
export function formatRange(from: number, to: number) {
  if (to - from >= 1440) return 'All day';
  if (to === 1440) return `${formatTime(from)} – midnight`;
  const start = formatTime(from);
  const end = formatTime(to);
  // When both ends share AM or PM, say it once.
  if (start.slice(-2) === end.slice(-2)) return `${start.slice(0, -3)}–${end}`;
  return `${start} – ${end}`;
}

/** '30 min', '1 hour', '1½ hours', '3 hours'. */
export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const half = minutes % 60 >= 30 ? '½' : '';
  return `${hours}${half} ${hours === 1 && !half ? 'hour' : 'hours'}`;
}

/* ---------------- The plan ---------------- */

const printable = (text: string) =>
  !Array.from(text).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

const planId = z.string().check(z.regex(/^[a-z0-9]{6,16}$/));
const personId = z.string().check(z.regex(/^[a-z0-9]{4,16}$/));
const day = z.string().check(z.regex(/^20\d\d-\d\d-\d\d$/), z.refine(isDay, 'Not a calendar day'));
/** An IANA name such as 'America/Chicago', 'Europe/London' or 'UTC'. */
const TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

export const whenPersonSchema = z.object({
  id: personId,
  name: z.string().check(z.trim(), z.minLength(1), z.maxLength(40), z.refine(printable)),
  /** Their free cells, packed (see packCells). */
  times: z.string().check(z.maxLength(112)),
  /** When they last saved, in ms: the later copy wins when two links are combined. */
  updated: z.int().check(z.minimum(0), z.maximum(4_102_444_800_000)),
});
export type WhenPerson = z.infer<typeof whenPersonSchema>;

export const whenPlanSchema = z
  .object({
    v: z.literal(1),
    id: planId,
    title: z.string().check(z.maxLength(80), z.refine(printable)),
    tz: z.string().check(z.maxLength(64), z.regex(TIME_ZONE)),
    days: z.array(day).check(z.minLength(1), z.maxLength(MAX_DAYS)),
    /** Whole hours: 9 and 22 mean 9 AM to 10 PM, and 24 is midnight. */
    start: z.int().check(z.minimum(0), z.maximum(23)),
    end: z.int().check(z.minimum(1), z.maximum(24)),
    slot: z.union([z.literal(30), z.literal(60)]),
    people: z.array(whenPersonSchema).check(z.maxLength(MAX_PEOPLE)),
  })
  .check(
    z.superRefine((plan, context) => {
      const fail = (message: string, path: PropertyKey[]) =>
        context.addIssue({ code: 'custom', message, path });
      if (plan.end <= plan.start) fail('The hours end before they start', ['end']);
      plan.days.forEach((value, index) => {
        if (index && value <= plan.days[index - 1]) fail('Days go in order, once each', ['days']);
      });
      const seen = new Set<string>();
      const cells = plan.end > plan.start ? cellCount(plan) : 0;
      plan.people.forEach((person, index) => {
        if (seen.has(person.id)) fail('Someone is in the plan twice', ['people', index, 'id']);
        seen.add(person.id);
        if (!cells || !unpackCells(person.times, cells))
          fail('These times don’t fit this plan', ['people', index, 'times']);
      });
    }),
  );
export type WhenPlan = z.infer<typeof whenPlanSchema>;

/** What this device keeps of a plan: the plan, and which person in it is the one using it. */
export const whenSavedSchema = z.object({
  v: z.literal(1),
  plan: whenPlanSchema,
  me: z.nullable(personId),
  /** When this device last saved it (ms), so recent plans list first. */
  saved: z.int().check(z.minimum(0)),
});
export type WhenSaved = z.infer<typeof whenSavedSchema>;

type Grid = Pick<WhenPlan, 'days' | 'start' | 'end' | 'slot'>;

/** Rows in each day: the hours considered, cut into slots. */
export const slotsPerDay = (plan: Pick<WhenPlan, 'start' | 'end' | 'slot'>) =>
  ((plan.end - plan.start) * 60) / plan.slot;

export const cellCount = (plan: Grid) => plan.days.length * slotsPerDay(plan);

/** Minutes after midnight when a row starts (or, for the row after the last, when it ends). */
export const slotStart = (plan: Pick<WhenPlan, 'start' | 'slot'>, slot: number) =>
  plan.start * 60 + slot * plan.slot;

/** '9 AM – 10 PM' */
export const planHours = (plan: Pick<WhenPlan, 'start' | 'end'>) =>
  formatRange(plan.start * 60, plan.end * 60);

/** A time zone we can put in a plan: the device's own, or UTC when it gives something odd. */
export const cleanTimeZone = (zone: string | undefined) =>
  zone && zone.length <= 64 && TIME_ZONE.test(zone) ? zone : 'UTC';

export function newPlan(options: {
  id: string;
  title: string;
  tz: string;
  days: string[];
  start: number;
  end: number;
  slot: SlotSize;
}): WhenPlan {
  return {
    v: 1,
    id: options.id,
    title: options.title.trim().slice(0, 80),
    tz: cleanTimeZone(options.tz),
    days: [...new Set(options.days)].sort().slice(0, MAX_DAYS),
    start: options.start,
    end: options.end,
    slot: options.slot,
    people: [],
  };
}

/** Same days, hours, slots and time zone: the only way two people's bitsets line up. */
export const sameGrid = (a: WhenPlan, b: WhenPlan) =>
  a.tz === b.tz &&
  a.start === b.start &&
  a.end === b.end &&
  a.slot === b.slot &&
  a.days.join() === b.days.join();

/* ---------------- Bitsets ---------------- */

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export const emptyCells = (plan: Grid) => new Uint8Array(cellCount(plan));

/**
 * One person's free cells (day by day, then slot by slot) → one bit each → base64url. The first
 * cell is the highest bit of the first byte. 14 days of 48 slots take 112 characters.
 */
export function packCells(cells: ArrayLike<number>) {
  const bytes = new Uint8Array(Math.ceil(cells.length / 8));
  for (let index = 0; index < cells.length; index += 1)
    if (cells[index]) bytes[index >> 3] |= 0x80 >> (index & 7);
  let text = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const left = bytes.length - index;
    const chunk =
      (bytes[index] << 16) |
      ((left > 1 ? bytes[index + 1] : 0) << 8) |
      (left > 2 ? bytes[index + 2] : 0);
    text += BASE64URL[chunk >> 18] + BASE64URL[(chunk >> 12) & 63];
    if (left > 1) text += BASE64URL[(chunk >> 6) & 63];
    if (left > 2) text += BASE64URL[chunk & 63];
  }
  return text;
}

/**
 * The reverse, strictly: exactly `count` cells, or null. Leftover bits must be zero, so one set of
 * times has exactly one spelling and a hand-edited link can't hide anything in the slack.
 */
export function unpackCells(text: string, count: number): Uint8Array | null {
  const size = Math.ceil(count / 8);
  if (text.length !== Math.ceil((size * 4) / 3)) return null;
  const bytes = new Uint8Array(size);
  let buffer = 0;
  let bits = 0;
  let filled = 0;
  for (const char of text) {
    const digit = BASE64URL.indexOf(char);
    if (digit < 0) return null;
    buffer = ((buffer << 6) | digit) & 0x3fff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[filled] = (buffer >> bits) & 0xff;
      filled += 1;
    }
  }
  if (buffer & ((1 << bits) - 1)) return null;
  const cells = new Uint8Array(count);
  for (let index = 0; index < size * 8; index += 1) {
    const bit = (bytes[index >> 3] >> (7 - (index & 7))) & 1;
    if (index < count) cells[index] = bit;
    else if (bit) return null;
  }
  return cells;
}

export const cellsOf = (plan: WhenPlan, person: WhenPerson) =>
  unpackCells(person.times, cellCount(plan)) ?? emptyCells(plan);

export const countCells = (cells: ArrayLike<number>) => {
  let count = 0;
  for (let index = 0; index < cells.length; index += 1) count += cells[index] ? 1 : 0;
  return count;
};

/** Is `index` inside the box whose corners are the cells `from` and `to`? */
export function inBox(rows: number, from: number, to: number, index: number) {
  const day = Math.floor(index / rows);
  const slot = index % rows;
  const [dayA, dayB] = [Math.floor(from / rows), Math.floor(to / rows)];
  const [slotA, slotB] = [from % rows, to % rows];
  return (
    day >= Math.min(dayA, dayB) &&
    day <= Math.max(dayA, dayB) &&
    slot >= Math.min(slotA, slotB) &&
    slot <= Math.max(slotA, slotB)
  );
}

/** A drag from one cell to another marks (1) or clears (0) every cell in the box between them. */
export function paintBox(cells: Uint8Array, rows: number, from: number, to: number, value: 0 | 1) {
  const next = cells.slice();
  for (let index = 0; index < next.length; index += 1)
    if (inBox(rows, from, to, index)) next[index] = value;
  return next;
}

/** Tapping a day's name fills the day, or empties it when it's already full. */
export function toggleDay(cells: Uint8Array, rows: number, day: number) {
  const next = cells.slice();
  const full = next.subarray(day * rows, day * rows + rows).every(Boolean);
  next.fill(full ? 0 : 1, day * rows, day * rows + rows);
  return next;
}

/* ---------------- People ---------------- */

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const findByName = (plan: WhenPlan, name: string) =>
  plan.people.find((person) => sameName(person.name, name));

/** Adds someone, or replaces their earlier times in place. */
export function withPerson(plan: WhenPlan, person: WhenPerson): WhenPlan {
  const known = plan.people.some((entry) => entry.id === person.id);
  return {
    ...plan,
    people: known
      ? plan.people.map((entry) => (entry.id === person.id ? person : entry))
      : [...plan.people, person],
  };
}

/** Is `a` a later save than `b`? A tie compares the contents, so the order of combining never matters. */
function newer(a: WhenPerson, b: WhenPerson) {
  if (a.updated !== b.updated) return a.updated > b.updated;
  return `${a.times}|${a.name}` > `${b.times}|${b.name}`;
}

export type MergeResult =
  | { ok: true; plan: WhenPlan; added: number; updated: number }
  | { ok: false; reason: 'other-plan' | 'other-grid' | 'too-many' };

/**
 * Two copies of one plan → one: everyone from both, matched by id, and where both copies have the
 * same person, the copy they saved later. Links for another plan (or another grid) never mix.
 */
export function mergePlans(base: WhenPlan, other: WhenPlan): MergeResult {
  if (base.id !== other.id) return { ok: false, reason: 'other-plan' };
  if (!sameGrid(base, other)) return { ok: false, reason: 'other-grid' };
  const people = [...base.people];
  let added = 0;
  let updated = 0;
  for (const person of other.people) {
    const index = people.findIndex((entry) => entry.id === person.id);
    if (index < 0) {
      people.push(person);
      added += 1;
    } else if (newer(person, people[index])) {
      people[index] = person;
      updated += 1;
    }
  }
  if (people.length > MAX_PEOPLE) return { ok: false, reason: 'too-many' };
  return { ok: true, plan: { ...base, people }, added, updated };
}

/* ---------------- The overlap ---------------- */

export type Tally = {
  /** People who've added their times. */
  total: number;
  /** How many are free, cell by cell. */
  counts: Uint8Array;
  /** Who's free, cell by cell: bit i is plan.people[i]. */
  masks: Uint32Array;
};

export function tallyPlan(plan: WhenPlan): Tally {
  const size = cellCount(plan);
  const counts = new Uint8Array(size);
  const masks = new Uint32Array(size);
  plan.people.slice(0, MAX_PEOPLE).forEach((person, index) => {
    const cells = cellsOf(plan, person);
    for (let cell = 0; cell < size; cell += 1) {
      if (!cells[cell]) continue;
      counts[cell] += 1;
      masks[cell] |= 1 << index;
    }
  });
  return { total: Math.min(plan.people.length, MAX_PEOPLE), counts, masks };
}

/** A run of back-to-back slots on one day when the same group is free. `to` is exclusive. */
export type TimeWindow = { day: number; from: number; to: number; count: number; mask: number };

export function freeWindows(plan: WhenPlan, tally = tallyPlan(plan)): TimeWindow[] {
  const rows = slotsPerDay(plan);
  const windows: TimeWindow[] = [];
  plan.days.forEach((_, day) => {
    let open: TimeWindow | null = null;
    for (let slot = 0; slot <= rows; slot += 1) {
      const mask = slot < rows ? tally.masks[day * rows + slot] : 0;
      if (open && mask === open.mask) {
        open.to = slot + 1;
        continue;
      }
      if (open) windows.push(open);
      open = mask
        ? { day, from: slot, to: slot + 1, mask, count: tally.counts[day * rows + slot] }
        : null;
    }
  });
  return windows;
}

/**
 * The times that work: the most people free first (so everyone-free comes first), then the
 * longest stretch, then the earliest. Once two people have answered, a time needs at least two of
 * them free: one person alone isn't a plan.
 */
export function bestTimes(plan: WhenPlan, limit = 5, tally = tallyPlan(plan)) {
  const least = Math.min(2, tally.total);
  return freeWindows(plan, tally)
    .filter((window) => window.count >= least)
    .sort(
      (a, b) =>
        b.count - a.count || b.to - b.from - (a.to - a.from) || a.day - b.day || a.from - b.from,
    )
    .slice(0, limit);
}

/** Who's free, and who isn't, for a cell's or a window's mask. */
export function splitByMask(plan: WhenPlan, mask: number) {
  const free: WhenPerson[] = [];
  const busy: WhenPerson[] = [];
  plan.people.forEach((person, index) => (mask & (1 << index) ? free : busy).push(person));
  return { free, busy };
}

/** 'not Ben', 'not Ben or Cam', 'not Ben, Cam or Dee', '4 can’t make it'. */
export function notFree(names: string[]) {
  if (names.length > 3) return `${names.length} can’t make it`;
  if (names.length === 1) return `not ${names[0]}`;
  return `not ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/** 'Sat, Oct 3 · 7–9 PM' */
export const windowWhen = (plan: WhenPlan, window: TimeWindow) =>
  `${formatDay(plan.days[window.day])} · ${formatRange(
    slotStart(plan, window.from),
    slotStart(plan, window.to),
  )}`;

/** 'everyone (5 of 5)', '6 of 7 free (not Ben)'. */
export function windowWho(plan: WhenPlan, window: Pick<TimeWindow, 'count' | 'mask'>) {
  const total = plan.people.length;
  if (window.count === total)
    return total === 1 ? '1 of 1 free' : `everyone (${total} of ${total})`;
  const { busy } = splitByMask(plan, window.mask);
  return `${window.count} of ${total} free (${notFree(busy.map((person) => person.name))})`;
}

/** 'Sat, Oct 3 · 7–9 PM — 6 of 7 free (not Ben)' */
export const windowText = (plan: WhenPlan, window: TimeWindow) =>
  `${windowWhen(plan, window)} — ${windowWho(plan, window)}`;

/** The best times as plain text for the group chat. */
export function bestTimesText(plan: WhenPlan, windows: TimeWindow[]) {
  return [
    `${plan.title.trim() || 'Our plan'}: the best times so far`,
    ...windows.map((window, index) => `${index + 1}. ${windowText(plan, window)}`),
    `Times in ${plan.tz}. Found with Hyphy When?`,
  ].join('\n');
}

/* ---------------- An example ---------------- */

/**
 * A made-up game night for five made-up friends, over the next seven days, so the payoff can be
 * seen before anyone's been asked. Each span is [weekday, from hour, to hour].
 */
export function samplePlan(today: string, tz: string): WhenPlan {
  const plan = newPlan({
    id: 'example',
    title: 'Game night (example)',
    tz,
    days: Array.from({ length: 7 }, (_, index) => addDays(today, index + 1)),
    start: 16,
    end: 23,
    slot: 60,
  });
  const spans: [string, [number, number, number][]][] = [
    [
      'Rosa',
      [
        [5, 18, 23],
        [6, 16, 23],
        [0, 16, 20],
        [2, 19, 22],
      ],
    ],
    [
      'Theo',
      [
        [6, 17, 22],
        [0, 16, 21],
        [3, 18, 21],
        [4, 19, 22],
      ],
    ],
    [
      'Mina',
      [
        [5, 17, 21],
        [6, 18, 23],
        [1, 19, 22],
        [4, 18, 21],
      ],
    ],
    [
      'Jules',
      [
        [5, 18, 22],
        [6, 16, 21],
        [0, 17, 19],
        [2, 18, 21],
        [3, 19, 22],
      ],
    ],
    [
      'Priya',
      [
        [5, 19, 23],
        [6, 18, 22],
        [4, 19, 21],
      ],
    ],
  ];
  const rows = slotsPerDay(plan);
  const people = spans.map(([name, free], index) => {
    const cells = emptyCells(plan);
    plan.days.forEach((value, column) => {
      for (const [weekday, from, to] of free) {
        if (weekdayOf(value) !== weekday) continue;
        for (let hour = from; hour < to; hour += 1) cells[column * rows + hour - plan.start] = 1;
      }
    });
    return { id: `demo${index + 1}`, name, times: packCells(cells), updated: 0 };
  });
  return { ...plan, people };
}
