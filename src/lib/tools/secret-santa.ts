import * as z from 'zod/mini';
import { idSchema, stampSchema } from './claims';

/*
 * Secret Santa: add everyone, say who shouldn't draw whom, draw names, and give each person a
 * private link with only their own match. Nobody else's match is ever on screen or in anyone
 * else's link:
 *
 * - The exchange (people, exclusions, the draw) stays with the organizer, in their browser.
 * - Each person's slip travels in their own link: the exchange's name, who it's for, who they're
 *   giving to, the budget, the day and the note. Nothing about anyone else.
 *
 * The draw is a random assignment where nobody draws themselves or someone they're kept from;
 * with four or more people it also avoids two people simply swapping, when it can. Pure and
 * tested (tests/lib-secret-santa.spec.ts); the randomness is passed in.
 */

export const MAX_PEOPLE = 60;
export const MIN_PEOPLE = 3;

const personSchema = z.object({
  id: idSchema,
  name: z.string().check(z.minLength(1), z.maxLength(40)),
});
export type SantaPerson = z.infer<typeof personSchema>;

export const exchangeSchema = z.object({
  v: z.literal(1),
  id: idSchema,
  title: z.string().check(z.maxLength(80)),
  people: z.array(personSchema).check(z.maxLength(MAX_PEOPLE)),
  /** Pairs who shouldn't draw each other (either way). */
  pairs: z.array(z.tuple([idSchema, idSchema])).check(z.maxLength(MAX_PEOPLE * 2)),
  /** Whole currency units; 0 for no budget. */
  budget: z.int().check(z.minimum(0), z.maximum(100_000)),
  currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  /** The exchange day (YYYY-MM-DD) or ''. */
  date: z.string().check(z.regex(/^(\d{4}-\d{2}-\d{2})?$/)),
  note: z.string().check(z.maxLength(300)),
  /** Who the organizer is, when they're in it. */
  host: z.string().check(z.maxLength(24)),
  drawn: z.nullable(z.object({ at: stampSchema, match: z.record(idSchema, idSchema) })),
  /** People whose private link has been copied or shared. */
  sent: z.array(idSchema).check(z.maxLength(MAX_PEOPLE)),
  edited: stampSchema,
});
export type Exchange = z.infer<typeof exchangeSchema>;

/** One person's envelope: what their private link carries, and nothing more. */
export const slipSchema = z.object({
  v: z.literal(1),
  /** The exchange's id, so the same slip isn't kept twice. */
  x: idSchema,
  /** Whose envelope it is. */
  p: idSchema,
  title: z.string().check(z.maxLength(80)),
  for: z.string().check(z.minLength(1), z.maxLength(40)),
  to: z.string().check(z.minLength(1), z.maxLength(40)),
  budget: z.int().check(z.minimum(0), z.maximum(100_000)),
  currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  date: z.string().check(z.regex(/^(\d{4}-\d{2}-\d{2})?$/)),
  note: z.string().check(z.maxLength(300)),
  /** The organizer's name, for "from Jerry". */
  host: z.string().check(z.maxLength(40)),
});
export type Slip = z.infer<typeof slipSchema>;

export const storeSchema = z.object({
  v: z.literal(1),
  current: z.nullable(idSchema),
  exchanges: z.array(exchangeSchema).check(z.maxLength(12)),
  /** Envelopes opened on this device (your own, from a private link). */
  slips: z.array(slipSchema).check(z.maxLength(24)),
});
export type SantaStore = z.infer<typeof storeSchema>;
export const EMPTY_STORE: SantaStore = { v: 1, current: null, exchanges: [], slips: [] };

export const BUDGETS = [0, 25, 50, 100] as const;
export const NOTE_IDEAS = [
  'Funny gifts only',
  'No gift cards',
  'Homemade welcome',
  'Wish lists welcome',
];

export function newExchange(id: string, now: number): Exchange {
  return {
    v: 1,
    id,
    title: '',
    people: [],
    pairs: [],
    budget: 0,
    currency: 'USD',
    date: '',
    note: '',
    host: '',
    drawn: null,
    sent: [],
    edited: now,
  };
}

export const titleOf = (exchange: Pick<Exchange, 'title'>) =>
  exchange.title.trim() || 'Secret Santa';

/* ---------------- people ---------------- */

/** "Jerry, Kamila and Emauri\nSophia" → four names. */
export function parseNames(text: string) {
  return text
    .split(/[,;\n\t]|\s+and\s+|\s+&\s+/i)
    .map((name) =>
      name
        .replace(/^[-*•\d.)\s]+/, '')
        .trim()
        .slice(0, 40),
    )
    .filter(Boolean);
}

const key = (name: string) => name.trim().toLowerCase();

/** Add names (the same name twice is one person). Changing people undoes a draw. */
export function addPeople(exchange: Exchange, names: string[], ids: string[], now: number) {
  const seen = new Set(exchange.people.map((person) => key(person.name)));
  const people = [...exchange.people];
  names.forEach((name, index) => {
    const clean = name.trim().slice(0, 40);
    if (!clean || seen.has(key(clean)) || people.length >= MAX_PEOPLE || !ids[index]) return;
    seen.add(key(clean));
    people.push({ id: ids[index], name: clean });
  });
  const added = people.length - exchange.people.length;
  if (!added) return { exchange, added };
  return { exchange: { ...exchange, people, drawn: null, sent: [], edited: now }, added };
}

export function removePerson(exchange: Exchange, personId: string, now: number): Exchange {
  return {
    ...exchange,
    people: exchange.people.filter((person) => person.id !== personId),
    pairs: exchange.pairs.filter(([a, b]) => a !== personId && b !== personId),
    host: exchange.host === personId ? '' : exchange.host,
    drawn: null,
    sent: [],
    edited: now,
  };
}

export function renamePerson(exchange: Exchange, personId: string, name: string, now: number) {
  const clean = name.trim().slice(0, 40);
  if (!clean) return exchange;
  if (exchange.people.some((person) => person.id !== personId && key(person.name) === key(clean)))
    return exchange;
  return {
    ...exchange,
    people: exchange.people.map((person) =>
      person.id === personId ? { ...person, name: clean } : person,
    ),
    edited: now,
  };
}

/* ---------------- who shouldn't draw whom ---------------- */

export const isPaired = (exchange: Pick<Exchange, 'pairs'>, a: string, b: string) =>
  exchange.pairs.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Keep two people from drawing each other; the same pair again lets them. */
export function togglePair(exchange: Exchange, a: string, b: string, now: number): Exchange {
  if (a === b) return exchange;
  const pairs = isPaired(exchange, a, b)
    ? exchange.pairs.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
    : [...exchange.pairs, [a, b] as [string, string]];
  return { ...exchange, pairs, drawn: null, sent: [], edited: now };
}

/* ---------------- the draw ---------------- */

export type DrawProblem =
  { kind: 'few' } | { kind: 'stuck'; name: string } | { kind: 'impossible' };

/** Why a draw can't work yet, in advance: too few people, or someone nobody can draw. */
export function drawProblem(exchange: Pick<Exchange, 'people' | 'pairs'>): DrawProblem | null {
  const { people } = exchange;
  if (people.length < MIN_PEOPLE) return { kind: 'few' };
  for (const person of people) {
    const options = people.filter(
      (other) => other.id !== person.id && !isPaired(exchange, person.id, other.id),
    );
    if (!options.length) return { kind: 'stuck', name: person.name };
  }
  return null;
}

function shuffle<T>(items: T[], random: () => number) {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]];
  }
  return list;
}

/**
 * Draw names: giver id → receiver id, or null when the exclusions leave no way to do it.
 * Backtracking over a shuffled order, most-constrained giver first.
 */
export function drawNames(
  exchange: Pick<Exchange, 'people' | 'pairs'>,
  random: () => number,
): Record<string, string> | null {
  if (drawProblem(exchange)) return null;
  const ids = exchange.people.map((person) => person.id);
  const allowed = new Map(
    ids.map((id) => [id, ids.filter((other) => other !== id && !isPaired(exchange, id, other))]),
  );
  const attempt = (noSwaps: boolean) => {
    const givers = shuffle(ids, random).sort(
      (a, b) => allowed.get(a)!.length - allowed.get(b)!.length,
    );
    const match: Record<string, string> = {};
    const taken = new Set<string>();
    let steps = 0;
    const place = (index: number): boolean => {
      if (index === givers.length) return true;
      if ((steps += 1) > 20_000) return false;
      const giver = givers[index];
      for (const receiver of shuffle(allowed.get(giver)!, random)) {
        if (taken.has(receiver)) continue;
        if (noSwaps && match[receiver] === giver) continue;
        match[giver] = receiver;
        taken.add(receiver);
        if (place(index + 1)) return true;
        taken.delete(receiver);
        delete match[giver];
      }
      return false;
    };
    return place(0) ? match : null;
  };
  const noSwaps = ids.length >= 4;
  for (let tries = 0; tries < 6; tries += 1) {
    const match = attempt(noSwaps) ?? (noSwaps ? null : attempt(false));
    if (match) return match;
  }
  return attempt(false);
}

/** Is a draw sound? Everyone gives once and receives once, never to themselves or a kept pair. */
export function validDraw(
  exchange: Pick<Exchange, 'people' | 'pairs'>,
  match: Record<string, string>,
) {
  const ids = exchange.people.map((person) => person.id);
  const receivers = ids.map((id) => match[id]);
  return (
    receivers.every(Boolean) &&
    new Set(receivers).size === ids.length &&
    receivers.every((receiver) => ids.includes(receiver)) &&
    ids.every((id) => match[id] !== id && !isPaired(exchange, id, match[id]))
  );
}

/** A person's own envelope. */
export function slipFor(exchange: Exchange, personId: string): Slip | null {
  const giver = exchange.people.find((person) => person.id === personId);
  const receiverId = exchange.drawn?.match[personId];
  const receiver = exchange.people.find((person) => person.id === receiverId);
  if (!giver || !receiver) return null;
  const host = exchange.people.find((person) => person.id === exchange.host);
  return {
    v: 1,
    x: exchange.id,
    p: giver.id,
    title: titleOf(exchange),
    for: giver.name,
    to: receiver.name,
    budget: exchange.budget,
    currency: exchange.currency,
    date: exchange.date,
    note: exchange.note,
    host: host?.name ?? '',
  };
}

/** "$50", "No budget". */
export function budgetLabel(budget: number, currency = 'USD') {
  if (!budget) return 'No budget';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(budget);
  } catch {
    return `${budget}`;
  }
}

/** A message to send with someone's private link. Says whose it is, never what's inside. */
export function slipMessage(exchange: Exchange, name: string, link: string) {
  const title = titleOf(exchange);
  const what =
    title === 'Secret Santa' ? 'Secret Santa envelope' : `Secret Santa envelope for ${title}`;
  return `${name}, here’s your ${what}. It’s only for you: ${link}`;
}

/** Keep an opened envelope on this device (newest first). */
export function keepSlip(store: SantaStore, slip: Slip): SantaStore {
  const slips = [
    slip,
    ...store.slips.filter((entry) => !(entry.x === slip.x && entry.p === slip.p)),
  ];
  return { ...store, slips: slips.slice(0, 24) };
}
