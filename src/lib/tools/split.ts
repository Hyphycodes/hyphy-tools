import * as z from 'zod/mini';

/*
 * Split: the math of a shared bill, in whole cents, so every person's total adds up to exactly
 * what the table paid — never a cent more or less. Pure and tested (tests/lib-split.spec.ts).
 *
 * - An item is split evenly between the people who shared it (nobody picked = everyone).
 * - Tax and tip are shared in proportion to what each person ordered.
 * - Tip is on the subtotal before tax (the usual custom), unless the bill says otherwise.
 * - Rounding goes to whoever's share was cut the most (largest remainder), so the sum is exact.
 *
 * The schema is zod/mini: it ships in the tool's page, and the full zod was a 390 KB download.
 */

const id = z.string().check(z.minLength(1), z.maxLength(24));
const cents = z.int().check(z.minimum(0), z.maximum(100_000_000));
const rate = z.number().check(z.minimum(0), z.maximum(1_000_000));

export const splitBillSchema = z.object({
  v: z.literal(1),
  title: z.string().check(z.maxLength(80)),
  currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  mode: z.enum(['items', 'even']),
  people: z.array(z.object({ id, name: z.string().check(z.maxLength(40)) })).check(z.maxLength(30)),
  items: z
    .array(
      z.object({
        id,
        name: z.string().check(z.maxLength(80)),
        /** The line's price (all of the quantity). */
        price: cents,
        /** Who shared it; empty means everyone at the table. */
        people: z.array(id).check(z.maxLength(30)),
        /** How many, when the receipt says ("2 Tacos"). */
        qty: z.optional(z.int().check(z.minimum(1), z.maximum(99))),
      }),
    )
    .check(z.maxLength(200)),
  /** Even mode: the amount to divide. */
  total: cents,
  tax: z.object({ mode: z.enum(['amount', 'percent']), value: rate }),
  tip: z.object({
    mode: z.enum(['percent', 'amount']),
    value: rate,
    afterTax: z.boolean(),
  }),
  /** What the receipt itself printed, to check the items against. */
  receipt: z.optional(z.object({ subtotal: z.nullable(cents), total: z.nullable(cents) })),
});
export type SplitBill = z.infer<typeof splitBillSchema>;

export const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'MXN', 'JPY'] as const;

const EURO = /^(AT|BE|CY|DE|EE|ES|FI|FR|GR|HR|IE|IT|LT|LU|LV|MT|NL|PT|SI|SK)$/;

/** The currency people most likely pay in, from the browser's language ("en-GB" → GBP). */
export function localCurrency(locale?: string): string {
  const region = (locale ?? '').split(/[-_]/)[1]?.toUpperCase() ?? '';
  const known: Record<string, string> = {
    US: 'USD',
    CA: 'CAD',
    GB: 'GBP',
    AU: 'AUD',
    MX: 'MXN',
    JP: 'JPY',
  };
  if (known[region]) return known[region];
  if (EURO.test(region)) return 'EUR';
  return 'USD';
}

export function newBill(currency = 'USD'): SplitBill {
  return {
    v: 1,
    title: '',
    currency,
    mode: 'items',
    people: [{ id: 'p1', name: 'You' }],
    items: [],
    total: 0,
    tax: { mode: 'amount', value: 0 },
    tip: { mode: 'percent', value: 18, afterTax: false },
  };
}

/** Currencies without minor units (yen) keep amounts in whole units. */
export function minorUnits(currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** "$12.50", "12,50", "12" → cents (or whole yen). Empty or unreadable → null. */
export function parseMoney(text: string, currency = 'USD'): number | null {
  const digits = minorUnits(currency);
  let clean = text.replace(/[^\d.,-]/g, '');
  if (!clean || clean === '-' || clean.startsWith('-')) return null;
  // "1.234,56" or "12,50": a comma after the last dot is the decimal mark.
  if (clean.includes(',') && (!clean.includes('.') || clean.lastIndexOf(',') > clean.lastIndexOf('.')))
    clean = clean.replace(/\./g, '').replace(',', '.');
  else clean = clean.replace(/,/g, '');
  const value = Number(clean);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10 ** digits);
}

export function formatMoney(amount: number, currency = 'USD') {
  const digits = minorUnits(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount / 10 ** digits);
}

/** For inputs: cents → "12.50" (no symbol). */
export function moneyInput(amount: number, currency = 'USD') {
  const digits = minorUnits(currency);
  return amount ? (amount / 10 ** digits).toFixed(digits) : '';
}

/**
 * Splits `total` into whole units in proportion to `weights`, giving the rounding leftovers to
 * the largest remainders. The parts always add up to `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0) return allocate(total, weights.map(() => 1));
  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

export type PersonShare = {
  id: string;
  name: string;
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  /** What they're paying for, item by item. */
  items: { id: string; name: string; share: number; split: number }[];
};

export type SplitResult = {
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
  people: PersonShare[];
};

export function computeSplit(bill: SplitBill): SplitResult {
  const people = bill.people;
  const count = people.length;
  if (!count)
    return { subtotal: 0, tax: 0, tip: 0, total: 0, people: [] };

  const ids = new Set(people.map((person) => person.id));
  const subtotals = new Map(people.map((person) => [person.id, 0]));
  const lines = new Map<string, PersonShare['items']>(people.map((person) => [person.id, []]));

  let subtotal = 0;
  if (bill.mode === 'even') {
    subtotal = bill.total;
    allocate(bill.total, people.map(() => 1)).forEach((part, index) =>
      subtotals.set(people[index].id, part),
    );
  } else {
    for (const item of bill.items) {
      if (!item.price) continue;
      const sharers = item.people.filter((person) => ids.has(person));
      const between = sharers.length ? sharers : people.map((person) => person.id);
      const parts = allocate(item.price, between.map(() => 1));
      between.forEach((personId, index) => {
        subtotals.set(personId, subtotals.get(personId)! + parts[index]);
        lines.get(personId)!.push({
          id: item.id,
          name: item.name,
          share: parts[index],
          split: between.length,
        });
      });
      subtotal += item.price;
    }
  }

  const tax =
    bill.tax.mode === 'amount' ? Math.round(bill.tax.value) : Math.round((subtotal * bill.tax.value) / 100);
  const tipBase = bill.tip.afterTax ? subtotal + tax : subtotal;
  const tip =
    bill.tip.mode === 'amount' ? Math.round(bill.tip.value) : Math.round((tipBase * bill.tip.value) / 100);

  const weights = people.map((person) => subtotals.get(person.id)!);
  const taxes = allocate(tax, weights);
  const tips = allocate(tip, weights);

  return {
    subtotal,
    tax,
    tip,
    total: subtotal + tax + tip,
    people: people.map((person, index) => {
      const own = subtotals.get(person.id)!;
      return {
        id: person.id,
        name: person.name,
        subtotal: own,
        tax: taxes[index],
        tip: tips[index],
        total: own + taxes[index] + tips[index],
        items: lines.get(person.id)!,
      };
    }),
  };
}

/** A plain-text summary for the group chat. */
export function splitSummary(bill: SplitBill, result: SplitResult) {
  const money = (amount: number) => formatMoney(amount, bill.currency);
  const name = (person: { name: string }, index: number) => person.name.trim() || `Person ${index + 1}`;
  const lines = [
    `${bill.title.trim() || 'The bill'}: ${money(result.total)}`,
    ...result.people.map((person, index) => `${name(person, index)}: ${money(person.total)}`),
  ];
  const extras = [
    result.tax ? `${money(result.tax)} tax` : '',
    result.tip
      ? `${bill.tip.mode === 'percent' ? `${bill.tip.value}% tip` : `${money(result.tip)} tip`}`
      : '',
  ].filter(Boolean);
  if (extras.length)
    lines.push(
      bill.mode === 'items'
        ? `(${extras.join(' and ')} shared by what each person ordered.)`
        : `(Includes ${extras.join(' and ')}.)`,
    );
  lines.push('Split with Hyphy Split');
  return lines.join('\n');
}
