import { z } from 'zod';
import { csv } from '@/lib/files/download';
import { allocate, CURRENCIES, formatMoney, minorUnits } from './split';

/*
 * Subscriptions: what recurring charges really cost. Pure and tested
 * (tests/lib-subscriptions.spec.ts).
 *
 * - Dates are calendar days ("2026-09-28") counted with UTC arithmetic, so no time zone or
 *   daylight-saving change can move a charge to another day. "Today" is the local calendar date.
 * - A subscription keeps the next-charge date the person entered as its anchor. Every later
 *   charge is counted from that anchor, never from the charge before it, so a monthly charge on
 *   Jan 31 lands on Feb 28 (or 29) and then back on Mar 31.
 * - Monthly and yearly totals turn every frequency into an average year of 365.2425 days, and
 *   are rounded once, at the end.
 */

export type IsoDate = string;

const DAY_MS = 86_400_000;
const DAYS_PER_YEAR = 365.2425;
export const MAX_ITEMS = 300;
export const MAX_EVERY = 365;
const MAX_CENTS = 100_000_000;
/** How far ahead "coming up" and "trials ending soon" look. */
export const SOON_DAYS = 30;

/* ---------------- Calendar days ---------------- */

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "2026-09-28" → its parts, or null for anything that isn't a real calendar day. */
export function parseDay(text: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function partsOf(date: IsoDate) {
  const parts = parseDay(date);
  if (!parts) throw new RangeError(`Not a calendar day: ${date}`);
  return parts;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');
const isoOf = (year: number, month: number, day: number) =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Whole days since 1970-01-01. */
export function dayNumber(date: IsoDate) {
  const { year, month, day } = partsOf(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function fromDayNumber(value: number): IsoDate {
  const date = new Date(value * DAY_MS);
  return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export const addDays = (date: IsoDate, days: number) => fromDayNumber(dayNumber(date) + days);
export const daysBetween = (from: IsoDate, to: IsoDate) => dayNumber(to) - dayNumber(from);

/** The same day of the month, `months` later, or that month's last day when it's shorter. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { year, month, day } = partsOf(date);
  const index = year * 12 + month - 1 + months;
  const nextYear = Math.floor(index / 12);
  const nextMonth = index - nextYear * 12 + 1;
  return isoOf(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}

/** Today on the person's own calendar (not UTC's, which may already be tomorrow). */
export function localToday(now = new Date()): IsoDate {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** "Oct 3", "Fri, Oct 3", "Oct 3, 2027": the same words in every time zone. */
export function formatDay(date: IsoDate, { weekday = false, year = false } = {}) {
  const parts = partsOf(date);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(weekday && { weekday: 'short' }),
    ...(year && { year: 'numeric' }),
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

/** "today", "tomorrow", "in 5 days", "3 days ago". */
export function relativeDay(today: IsoDate, date: IsoDate) {
  const days = daysBetween(today, date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/* ---------------- The list ---------------- */

export const UNITS = ['day', 'week', 'month', 'year'] as const;
export type Unit = (typeof UNITS)[number];

export const CATEGORY_IDS = [
  'streaming',
  'music',
  'software',
  'cloud',
  'fitness',
  'news',
  'shopping',
  'food',
  'utilities',
  'other',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
export const CATEGORY_LABELS: Record<CategoryId, string> = {
  streaming: 'Streaming',
  music: 'Music',
  software: 'Software',
  cloud: 'Cloud storage',
  fitness: 'Fitness',
  news: 'News',
  shopping: 'Shopping',
  food: 'Food & delivery',
  utilities: 'Utilities',
  other: 'Other',
};

export { CURRENCIES };
export type Currency = (typeof CURRENCIES)[number];

/** A web address someone typed ("example.com/cancel") → a full http(s) link, or null. */
export function webLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2000 || /\s/.test(trimmed)) return null;
  // A scheme that was typed (https:, mailto:, javascript:) is kept and checked; "host:8080" isn't one.
  const typedScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed);
  try {
    const url = new URL(typedScheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
}

const id = z.string().min(1).max(24);
const day = z.string().refine((text) => parseDay(text) !== null, 'Not a calendar day');

export const subscriptionSchema = z.object({
  id,
  name: z.string().max(80).regex(/\S/),
  /** What one charge costs, in minor units (cents). */
  cost: z.number().int().min(0).max(MAX_CENTS),
  every: z.number().int().min(1).max(MAX_EVERY),
  unit: z.enum(UNITS),
  /** The next charge as entered: the anchor every later charge is counted from. */
  next: day,
  category: z.enum(CATEGORY_IDS),
  /** When a free trial turns paid, or ''. */
  trialEnds: z.string().refine((text) => text === '' || parseDay(text) !== null),
  notes: z.string().max(500),
  /** How to cancel: an http(s) link, or ''. */
  cancelUrl: z
    .string()
    .max(2000)
    .refine((text) => text === '' || webLink(text) !== null),
  paused: z.boolean(),
  /** Part of the made-up sample list. */
  sample: z.boolean().optional(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

const items = z
  .array(subscriptionSchema)
  .max(MAX_ITEMS)
  .refine((list) => new Set(list.map((item) => item.id)).size === list.length, 'Repeated id');

export const SORTS = ['next', 'cost', 'name'] as const;
export type SortBy = (typeof SORTS)[number];

export const subscriptionListSchema = z.object({
  v: z.literal(1),
  currency: z.enum(CURRENCIES),
  sort: z.enum(SORTS),
  items,
});
export type SubscriptionList = z.infer<typeof subscriptionListSchema>;

export function newList(currency: Currency = 'USD'): SubscriptionList {
  return { v: 1, currency, sort: 'next', items: [] };
}

/* ---------------- Charges and costs ---------------- */

type Schedule = Pick<Subscription, 'next' | 'every' | 'unit'>;

const stepOf = ({ every, unit }: Schedule) =>
  unit === 'day' || unit === 'week'
    ? { days: every * (unit === 'week' ? 7 : 1), months: 0 }
    : { days: 0, months: every * (unit === 'year' ? 12 : 1) };

/** The charge `index` steps after the anchor (0 is the anchor itself). */
export function chargeAt(item: Schedule, index: number): IsoDate {
  const step = stepOf(item);
  return step.days
    ? addDays(item.next, index * step.days)
    : addMonths(item.next, index * step.months);
}

function firstIndexFrom(item: Schedule, from: IsoDate) {
  if (item.next >= from) return 0;
  const step = stepOf(item);
  if (step.days) return Math.ceil(daysBetween(item.next, from) / step.days);
  const anchor = partsOf(item.next);
  const start = partsOf(from);
  const months = (start.year - anchor.year) * 12 + start.month - anchor.month;
  let index = Math.floor(months / step.months);
  // A short month can pull a charge before `from`: step on until it isn't.
  while (chargeAt(item, index) < from) index += 1;
  return index;
}

/** The first charge on or after `from` (usually today). */
export function nextCharge(item: Schedule, from: IsoDate): IsoDate {
  return chargeAt(item, firstIndexFrom(item, from));
}

/** The next `count` charges from `from`. */
export function nextCharges(item: Schedule, from: IsoDate, count: number): IsoDate[] {
  const first = firstIndexFrom(item, from);
  return Array.from({ length: count }, (_, offset) => chargeAt(item, first + offset));
}

/** Every charge from `from` through `to`, both included, in order. */
export function chargesBetween(item: Schedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let index = firstIndexFrom(item, from); dates.length < 400; index += 1) {
    const date = chargeAt(item, index);
    if (date > to) break;
    dates.push(date);
  }
  return dates;
}

/** How many times a year it charges, on average. */
export function chargesPerYear({ every, unit }: Pick<Subscription, 'every' | 'unit'>) {
  const perYear = { day: DAYS_PER_YEAR, week: DAYS_PER_YEAR / 7, month: 12, year: 1 }[unit];
  return perYear / every;
}

/** Exact (unrounded) cost a year and a month, in minor units. */
export const yearlyCost = (item: Pick<Subscription, 'cost' | 'every' | 'unit'>) =>
  item.cost * chargesPerYear(item);
export const monthlyCost = (item: Pick<Subscription, 'cost' | 'every' | 'unit'>) =>
  yearlyCost(item) / 12;

/* ---------------- Words ---------------- */

const UNIT_WORDS: Record<Unit, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
};

export const unitWord = (unit: Unit, count: number) => UNIT_WORDS[unit][count === 1 ? 0 : 1];

/** "Monthly", "Every 3 months", "Every 10 days". */
export function frequencyLabel(every: number, unit: Unit) {
  if (every === 1) return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[unit];
  return `Every ${every} ${unitWord(unit, every)}`;
}

/** "$15.49 a month", "$59.94 every 2 weeks". */
export function priceText(item: Pick<Subscription, 'cost' | 'every' | 'unit'>, currency: string) {
  const money = formatMoney(item.cost, currency);
  return item.every === 1
    ? `${money} a ${unitWord(item.unit, 1)}`
    : `${money} every ${item.every} ${unitWord(item.unit, item.every)}`;
}

/* ---------------- The summary ---------------- */

export type UpcomingCharge = {
  id: string;
  name: string;
  category: CategoryId;
  /** The first charge in the window. */
  date: IsoDate;
  /** One charge. */
  amount: number;
  /** How many times it charges in the window (a weekly charge, four or five). */
  count: number;
};

export type Summary = {
  /** Rounded once from the exact sums, in minor units. */
  monthly: number;
  yearly: number;
  active: number;
  paused: number;
  /** Weekly or daily charges are in the totals as averages. */
  averaged: boolean;
  upcoming: UpcomingCharge[];
  upcomingTotal: number;
  upcomingCount: number;
  trials: { id: string; name: string; date: IsoDate; days: number; item: Subscription }[];
  /** Largest first; the parts add up to `monthly` exactly. */
  categories: { id: CategoryId; label: string; monthly: number; share: number }[];
  biggest: { id: string; name: string; monthly: number; yearly: number; share: number }[];
};

export function summarize(list: Subscription[], today: IsoDate, days = SOON_DAYS): Summary {
  const active = list.filter((item) => !item.paused);
  const exactMonthly = active.reduce((sum, item) => sum + monthlyCost(item), 0);
  const exactYearly = active.reduce((sum, item) => sum + yearlyCost(item), 0);
  const monthly = Math.round(exactMonthly);
  const end = addDays(today, days);

  const upcoming = active
    .map((item) => {
      const dates = chargesBetween(item, today, end);
      return {
        id: item.id,
        name: item.name,
        category: item.category,
        date: dates[0] ?? '',
        amount: item.cost,
        count: dates.length,
      };
    })
    .filter((charge) => charge.count > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const trials = active
    .filter((item) => item.trialEnds && item.trialEnds >= today && item.trialEnds <= end)
    .map((item) => ({
      id: item.id,
      name: item.name,
      date: item.trialEnds,
      days: daysBetween(today, item.trialEnds),
      item,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byCategory = new Map<CategoryId, number>();
  for (const item of active)
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + monthlyCost(item));
  const ordered = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const parts = allocate(
    monthly,
    ordered.map(([, value]) => value),
  );
  const categories = ordered.map(([category, value], index) => ({
    id: category,
    label: CATEGORY_LABELS[category],
    monthly: parts[index],
    share: exactMonthly ? value / exactMonthly : 0,
  }));

  const biggest = [...active]
    .sort((a, b) => monthlyCost(b) - monthlyCost(a))
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      name: item.name,
      monthly: Math.round(monthlyCost(item)),
      yearly: Math.round(yearlyCost(item)),
      share: exactMonthly ? monthlyCost(item) / exactMonthly : 0,
    }));

  return {
    monthly,
    yearly: Math.round(exactYearly),
    active: active.length,
    paused: list.length - active.length,
    averaged: active.some((item) => item.unit === 'day' || item.unit === 'week'),
    upcoming,
    upcomingTotal: upcoming.reduce((sum, charge) => sum + charge.amount * charge.count, 0),
    upcomingCount: upcoming.reduce((sum, charge) => sum + charge.count, 0),
    trials,
    categories,
    biggest,
  };
}

/** Paused ones last; then by the chosen order; ties by name. */
export function sortSubscriptions(list: Subscription[], by: SortBy, today: IsoDate) {
  const next = new Map(list.map((item) => [item.id, nextCharge(item, today)]));
  const byName = (a: Subscription, b: Subscription) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  return [...list].sort(
    (a, b) =>
      Number(a.paused) - Number(b.paused) ||
      (by === 'next'
        ? next.get(a.id)!.localeCompare(next.get(b.id)!)
        : by === 'cost'
          ? monthlyCost(b) - monthlyCost(a)
          : 0) ||
      byName(a, b),
  );
}

/* ---------------- Adding and editing ---------------- */

/** The "how often" choices, as people think of them. */
export const FREQUENCIES = [
  { id: 'week', label: 'Weekly' },
  { id: 'month', label: 'Monthly' },
  { id: 'months', label: 'Every few months' },
  { id: 'year', label: 'Yearly' },
  { id: 'custom', label: 'Custom' },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]['id'];

/** The form, as typed. */
export type Draft = {
  name: string;
  cost: number;
  frequency: Frequency;
  /** "Every N": for every few months and custom. */
  every: string;
  /** Custom's unit. */
  unit: Unit;
  next: string;
  category: CategoryId;
  trialEnds: string;
  cancelUrl: string;
  notes: string;
};

export type DraftErrors = Partial<
  Record<'name' | 'cost' | 'every' | 'next' | 'trialEnds' | 'cancelUrl', string>
>;

export function emptyDraft(): Draft {
  return {
    name: '',
    cost: 0,
    frequency: 'month',
    every: '3',
    unit: 'month',
    next: '',
    category: 'other',
    trialEnds: '',
    cancelUrl: '',
    notes: '',
  };
}

export function draftOf(item: Subscription): Draft {
  const frequency: Frequency =
    item.every === 1 && item.unit !== 'day'
      ? item.unit
      : item.unit === 'month'
        ? 'months'
        : 'custom';
  return {
    name: item.name,
    cost: item.cost,
    frequency,
    every: String(item.every),
    unit: item.unit,
    next: item.next,
    category: item.category,
    trialEnds: item.trialEnds,
    cancelUrl: item.cancelUrl,
    notes: item.notes,
  };
}

export type SubscriptionFields = Omit<Subscription, 'id' | 'paused' | 'sample'>;

/** How often the form says it charges, or null while "every N" isn't a usable number. */
export function scheduleOf(draft: Pick<Draft, 'frequency' | 'every' | 'unit'>) {
  if (draft.frequency !== 'months' && draft.frequency !== 'custom')
    return { every: 1, unit: draft.frequency };
  const every = /^\d+$/.test(draft.every.trim()) ? Number(draft.every.trim()) : 0;
  if (every < 1 || every > MAX_EVERY) return null;
  return { every, unit: draft.frequency === 'months' ? ('month' as const) : draft.unit };
}

/** The form → a subscription's fields, or what to fix, in words. */
export function readDraft(
  draft: Draft,
): { ok: true; value: SubscriptionFields } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const name = draft.name.trim().slice(0, 80);
  if (!name) errors.name = 'Give it a name, like “Music app”.';
  if (!(draft.cost > 0)) errors.cost = 'Add what one charge costs.';

  const repeat = scheduleOf(draft);
  if (!repeat) errors.every = `Type a whole number from 1 to ${MAX_EVERY}.`;

  if (!parseDay(draft.next))
    errors.next = draft.next
      ? 'That date doesn’t look right.'
      : 'Pick the day it charges next. A close guess is fine.';
  if (draft.trialEnds && !parseDay(draft.trialEnds))
    errors.trialEnds = 'That date doesn’t look right.';
  const cancelUrl = draft.cancelUrl.trim() ? webLink(draft.cancelUrl) : '';
  if (cancelUrl === null) errors.cancelUrl = 'Use a web address, like example.com/account.';

  if (!repeat || Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      cost: Math.min(draft.cost, MAX_CENTS),
      every: repeat.every,
      unit: repeat.unit,
      next: draft.next,
      category: draft.category,
      trialEnds: draft.trialEnds,
      notes: draft.notes.trim().slice(0, 500),
      cancelUrl: cancelUrl ?? '',
    },
  };
}

/** Another currency for the whole list: amounts keep their digits (¥ has no cents). */
export function changeCurrency(list: SubscriptionList, currency: Currency): SubscriptionList {
  const shift = minorUnits(currency) - minorUnits(list.currency);
  return {
    ...list,
    currency,
    items: list.items.map((item) => ({
      ...item,
      cost: Math.min(MAX_CENTS, Math.round(item.cost * 10 ** shift)),
    })),
  };
}

/* ---------------- Sample ---------------- */

/** Made-up services with made-up prices, dated from today so every part of the summary shows. */
export function sampleItems(today: IsoDate): Subscription[] {
  const rows: [string, number, number, Unit, number, CategoryId, Partial<Subscription>][] = [
    [
      'Streaming service',
      1549,
      1,
      'month',
      4,
      'streaming',
      { cancelUrl: 'https://streaming.example/account/cancel' },
    ],
    ['Music app', 1099, 1, 'month', 11, 'music', {}],
    ['Cloud backup', 2999, 1, 'year', 73, 'cloud', { notes: 'Backs up the family’s photos.' }],
    [
      'Gym',
      3900,
      1,
      'month',
      19,
      'fitness',
      { notes: 'Cancel at the front desk, 30 days’ notice.' },
    ],
    ['Newspaper', 400, 1, 'week', 2, 'news', {}],
    [
      'Photo editor',
      999,
      1,
      'month',
      6,
      'software',
      { trialEnds: addDays(today, 6), cancelUrl: 'https://photo-editor.example/billing' },
    ],
    ['Meal kit', 5994, 2, 'week', 9, 'food', { paused: true }],
  ];
  return rows.map(([name, cost, every, unit, inDays, category, extra], index) => ({
    id: `sample-${index + 1}`,
    name,
    cost,
    every,
    unit,
    next: addDays(today, inDays),
    category,
    trialEnds: '',
    notes: '',
    cancelUrl: '',
    paused: false,
    sample: true,
    ...extra,
  }));
}

/* ---------------- Export and import ---------------- */

const EXPORT_KIND = 'hyphy-subscriptions';

export const exportSchema = z.object({
  kind: z.literal(EXPORT_KIND),
  v: z.literal(1),
  currency: z.enum(CURRENCIES),
  items,
});

export function exportJson(list: SubscriptionList, today: IsoDate) {
  return JSON.stringify(
    { kind: EXPORT_KIND, v: 1, exported: today, currency: list.currency, items: list.items },
    null,
    2,
  );
}

export type Imported = { currency: Currency; items: Subscription[] };

/** A file someone chose → a validated list, or why it can't be used. Nothing half-imports. */
export function readImport(
  text: string,
): { ok: true; data: Imported } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: 'That file isn’t a backup from here. Choose one made with “Download a backup”.',
    };
  }
  const parsed = exportSchema.safeParse(data);
  if (!parsed.success)
    return {
      ok: false,
      error:
        'That file isn’t a Subscriptions backup, or something in it was changed. Nothing was added.',
    };
  return { ok: true, data: { currency: parsed.data.currency, items: parsed.data.items } };
}

/**
 * Adds imported subscriptions to a list. One exported from here before (same id) is updated
 * rather than doubled.
 */
export function mergeItems(current: Subscription[], incoming: Subscription[]) {
  const pending = new Map(incoming.map((item) => [item.id, item]));
  let updated = 0;
  const kept = current.map((item) => {
    const match = pending.get(item.id);
    if (!match) return item;
    pending.delete(item.id);
    updated += 1;
    return match;
  });
  const all = [...kept, ...pending.values()];
  return {
    items: all.slice(0, MAX_ITEMS),
    added: Math.min(pending.size, MAX_ITEMS - kept.length),
    updated,
    skipped: Math.max(0, all.length - MAX_ITEMS),
  };
}

/** A spreadsheet of the list: amounts as plain numbers, every cell formula-safe. */
export function toCsv(list: SubscriptionList, today: IsoDate) {
  const digits = minorUnits(list.currency);
  const amount = (value: number) => (Math.round(value) / 10 ** digits).toFixed(digits);
  return csv([
    [
      'Service',
      'Cost',
      'Currency',
      'How often',
      'Next charge',
      'Per month',
      'Per year',
      'Category',
      'Free trial ends',
      'Status',
      'How to cancel',
      'Notes',
    ],
    ...sortSubscriptions(list.items, 'next', today).map((item) => [
      item.name,
      amount(item.cost),
      list.currency,
      frequencyLabel(item.every, item.unit),
      nextCharge(item, today),
      amount(monthlyCost(item)),
      amount(yearlyCost(item)),
      CATEGORY_LABELS[item.category],
      item.trialEnds,
      item.paused ? 'Paused' : 'Active',
      item.cancelUrl,
      item.notes,
    ]),
  ]);
}
