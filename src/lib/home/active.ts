import type { ToolId } from '@/lib/catalog/schema';
import { groupStoreSchema, currentOf } from '@/lib/share/group';
import { readLocal } from '@/lib/share/local';
import { bringStoreSchema } from '@/lib/tools/bring';
import { distance, inMonthPeriod, mileageStoreSchema, totals } from '@/lib/tools/mileage';
import { countdown, headcount, planSchema, titleOf } from '@/lib/tools/plan';
import { receiptsStoreSchema } from '@/lib/tools/receipts';
import { storeSchema as santaStoreSchema } from '@/lib/tools/secret-santa';
import { computeSplit, formatMoney, splitBillSchema } from '@/lib/tools/split';
import { relativeDay, subscriptionListSchema, summarize } from '@/lib/tools/subscriptions';
import { questionOf, tally, whereSchema } from '@/lib/tools/where';
import { ownerStoreSchema } from '@/lib/tools/wishlist';

/*
 * "Pick up where you left off": the work a tool is holding for someone right now, read from what
 * the tool itself keeps in this browser (with the tool's own schema). Only tools that really keep
 * something take part; a tool that keeps nothing is never shown as if it did. Each card opens the
 * tool on the same thing (the group tools open their current session without a link).
 *
 * Loaded by the home after it's on screen (a dynamic import), so the tool schemas never weigh on
 * the first paint.
 */

export type ActiveItem = {
  tool: ToolId;
  /** "Kamila’s Birthday", "September mileage". */
  title: string;
  /** The number that matters: "5 of 8 are in", "284.7 mi". */
  stat: string;
  /** One more fact: "In 5 days", "4 added this week". */
  detail?: string;
  /** Happening right now (a drive being measured). */
  live?: boolean;
  /** When it last changed, for the order. */
  t: number;
};

const DAY = 86_400_000;
/** Older than this and it isn't "ongoing" any more. */
const FRESH = 45 * DAY;

const MONTHS = [
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
const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

type Context = { now: number; today: string; lastOpened: (id: ToolId) => number };
type Reader = (context: Context) => ActiveItem | null;

const planStore = groupStoreSchema(planSchema);
const whereStore = groupStoreSchema(whereSchema);

const readers: Partial<Record<ToolId, Reader>> = {
  plan: ({ today }) => {
    const saved = readLocal('hyphy.plan.v1', planStore);
    const plan = saved && currentOf(saved)?.data;
    if (!plan) return null;
    const people = headcount(plan);
    const asked = people.in + people.maybe + people.invited;
    if (!plan.title.trim() && !asked) return null;
    // A plan whose day has passed is done.
    if (plan.date && (plan.end || plan.date) < today) return null;
    return {
      tool: 'plan',
      title: titleOf(plan),
      stat: asked ? `${people.in} of ${asked} are in` : 'Nobody asked yet',
      detail: plan.date ? countdown(plan.date, today) : 'No day yet',
      t: plan.edited,
    };
  },

  where: () => {
    const saved = readLocal('hyphy.where.v1', whereStore);
    const round = saved && currentOf(saved)?.data;
    if (!round || !round.options.length) return null;
    const result = tally(round);
    const winner = round.pick ? result.leader?.option.name : null;
    return {
      tool: 'where',
      title: round.title.trim() || questionOf(round),
      stat: winner ?? (result.voters ? plural(result.voters, 'vote') : 'No votes yet'),
      detail: winner ? 'Winner chosen' : plural(round.options.length, 'place'),
      t: round.edited,
    };
  },

  split: ({ lastOpened }) => {
    const bill = readLocal('hyphy.split.v1', splitBillSchema);
    if (!bill || (!bill.items.length && !bill.total)) return null;
    const result = computeSplit(bill);
    if (!result.total) return null;
    return {
      tool: 'split',
      title: bill.title.trim() || 'Your bill',
      stat: formatMoney(result.total, bill.currency),
      detail: plural(bill.people.length, 'person', 'people'),
      t: lastOpened('split'),
    };
  },

  bring: () => {
    const store = readLocal('hyphy.bring.v1', bringStoreSchema);
    const list = store?.lists.find((entry) => entry.list.id === store.current)?.list;
    if (!list || !list.items.length) return null;
    const needed = list.items.filter((item) => !list.claims[item.id]?.length).length;
    return {
      tool: 'bring',
      title: list.title.trim() || 'Your list',
      stat: needed ? `${needed} still needed` : 'All covered',
      detail: plural(list.items.length, 'thing'),
      t: list.edited,
    };
  },

  mileage: ({ today }) => {
    const store = readLocal('hyphy.mileage.v1', mileageStoreSchema);
    if (!store) return null;
    if (store.drive)
      return {
        tool: 'mileage',
        title: 'Drive in progress',
        stat: `${distance(store.drive.meters, store.unit)} ${store.unit}`,
        detail: 'Tap to stop',
        live: true,
        t: store.drive.startedAt,
      };
    const month = store.trips.filter((trip) => inMonthPeriod(trip.date, 'month', today));
    if (!month.length) return null;
    const sum = totals(month);
    return {
      tool: 'mileage',
      title: `${MONTHS[Number(today.slice(5, 7)) - 1]} mileage`,
      stat: `${distance(sum.meters, store.unit)} ${store.unit}`,
      detail: plural(month.length, 'trip'),
      t: Math.max(...month.map((trip) => trip.updated)),
    };
  },

  receipts: ({ now, today }) => {
    const store = readLocal('hyphy.receipts.v1', receiptsStoreSchema);
    if (!store) return null;
    const month = store.receipts.filter(
      (receipt) => receipt.date.slice(0, 7) === today.slice(0, 7),
    );
    const week = store.receipts.filter((receipt) => now - receipt.created < 7 * DAY).length;
    if (!month.length && !week) return null;
    const total = month.reduce((sum, receipt) => sum + receipt.total, 0);
    return {
      tool: 'receipts',
      title: `${MONTHS[Number(today.slice(5, 7)) - 1]} receipts`,
      stat: formatMoney(total, store.currency),
      detail: week ? `${week} added this week` : plural(month.length, 'receipt'),
      t: Math.max(...store.receipts.map((receipt) => receipt.updated)),
    };
  },

  subscriptions: ({ today, lastOpened }) => {
    const list = readLocal('hyphy.subscriptions.v1', subscriptionListSchema);
    if (!list || !list.items.length) return null;
    const summary = summarize(list.items, today);
    if (!summary.active) return null;
    const next = summary.upcoming[0];
    return {
      tool: 'subscriptions',
      title: 'Subscriptions',
      stat: `${formatMoney(summary.monthly, list.currency)}/mo`,
      detail: next ? `${next.name} ${relativeDay(today, next.date).toLowerCase()}` : undefined,
      t: lastOpened('subscriptions'),
    };
  },

  'secret-santa': ({ today }) => {
    const store = readLocal('hyphy.santa.v1', santaStoreSchema);
    const exchange = store?.exchanges.find((entry) => entry.id === store.current);
    if (!exchange || exchange.people.length < 2) return null;
    if (exchange.date && exchange.date < today) return null;
    return {
      tool: 'secret-santa',
      title: exchange.title.trim() || 'Secret Santa',
      stat: exchange.drawn
        ? `${exchange.sent.length} of ${exchange.people.length} sent`
        : `${exchange.people.length} people in`,
      detail: exchange.drawn ? 'Names drawn' : 'Not drawn yet',
      t: exchange.edited,
    };
  },

  wishlist: () => {
    const store = readLocal('hyphy.wishlist.v1', ownerStoreSchema);
    const list = store?.list;
    if (!list || !list.items.length) return null;
    return {
      tool: 'wishlist',
      title: list.title.trim() || 'Your wish list',
      stat: plural(list.items.length, 'wish', 'wishes'),
      detail: store.shared ? 'Shared' : 'Not shared yet',
      t: list.edited,
    };
  },
};

/** Tools that can say what they're holding. */
export const ACTIVE_TOOLS = Object.keys(readers) as ToolId[];

/** Everything ongoing on this device: a live drive first, then the latest change first. */
export function readActive(context: Context, limit = 4): ActiveItem[] {
  const items: ActiveItem[] = [];
  for (const read of Object.values(readers)) {
    try {
      const item = read(context);
      if (item && (item.live || context.now - item.t < FRESH)) items.push(item);
    } catch {
      // One tool's odd data never takes the home down.
    }
  }
  return items
    .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || b.t - a.t)
    .slice(0, limit);
}
