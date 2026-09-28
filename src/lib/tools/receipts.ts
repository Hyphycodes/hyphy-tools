import * as z from 'zod/mini';
import { csv } from '@/lib/files/download';
import { idSchema, stampSchema } from './claims';
import type { ParsedReceipt, ReceiptLine } from './receipt';

/*
 * Receipts: a photo becomes an expense record. The text on the photo is read on the device
 * (lib/tools/receipt-reader) and parsed once (lib/tools/receipt for the amounts; this file for
 * the date, how it was paid and a category); what was found is saved with the record, so a
 * receipt is never read twice. Records live in this browser (their photos in IndexedDB, see
 * lib/share/photos); with accounts they move to the account and keep this shape.
 *
 * Amounts are whole cents. Pure and tested (tests/lib-receipts.spec.ts).
 */

export const CATEGORIES = [
  'materials',
  'meals',
  'travel',
  'fuel',
  'office',
  'equipment',
  'other',
] as const;
export type ReceiptCategory = (typeof CATEGORIES)[number];

export const CATEGORY_NAMES: Record<ReceiptCategory, string> = {
  materials: 'Materials',
  meals: 'Meals',
  travel: 'Travel',
  fuel: 'Fuel',
  office: 'Office',
  equipment: 'Equipment',
  other: 'Other',
};

export const MAX_RECEIPTS = 2000;

export const expenseSchema = z.object({
  id: idSchema,
  merchant: z.string().check(z.maxLength(80)),
  /** Cents. */
  total: z.int().check(z.minimum(0), z.maximum(100_000_000)),
  tax: z.nullable(z.int().check(z.minimum(0), z.maximum(100_000_000))),
  date: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  category: z.enum(CATEGORIES),
  /** "Visa ••1234", "Cash". */
  payment: z.string().check(z.maxLength(40)),
  /** A project, client or job it belongs to. */
  tag: z.string().check(z.maxLength(60)),
  note: z.string().check(z.maxLength(400)),
  /** A photo is kept in this browser under the record's id. */
  photo: z.boolean(),
  /** How it got its details: read from the photo, or typed. */
  source: z.enum(['read', 'typed']),
  created: stampSchema,
  updated: stampSchema,
});
export type Expense = z.infer<typeof expenseSchema>;

export const receiptsStoreSchema = z.object({
  v: z.literal(1),
  currency: z.string().check(z.regex(/^[A-Z]{3}$/)),
  receipts: z.array(expenseSchema).check(z.maxLength(MAX_RECEIPTS)),
});
export type ReceiptsStore = z.infer<typeof receiptsStoreSchema>;
export const EMPTY_RECEIPTS: ReceiptsStore = { v: 1, currency: 'USD', receipts: [] };

/* ---------------- reading a receipt ---------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function validDay(year: number, month: number, day: number) {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last ? `${year}-${pad(month)}-${pad(day)}` : null;
}

/**
 * The receipt's date, from its lines: 09/28/2026, 9-28-26, 2026-09-28, Sep 28, 2026 or
 * 28 Sep 2026. Dates after `today` (a misread) are skipped.
 */
export function findDate(lines: string[], today: string): string | null {
  const found: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/[Oo](?=\d)|(?<=\d)[Oo]/g, '0');
    for (const match of line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
      const day = validDay(+match[1], +match[2], +match[3]);
      if (day) found.push(day);
    }
    for (const match of line.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g)) {
      const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
      const day = validDay(year, +match[1], +match[2]);
      if (day) found.push(day);
    }
    for (const match of line.matchAll(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/gi,
    )) {
      const day = validDay(
        +match[3],
        MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1,
        +match[2],
      );
      if (day) found.push(day);
    }
    for (const match of line.matchAll(
      /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/gi,
    )) {
      const day = validDay(
        +match[3],
        MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1,
        +match[1],
      );
      if (day) found.push(day);
    }
  }
  return found.find((day) => day <= today) ?? null;
}

const CARDS: [RegExp, string][] = [
  [/\bamex\b|american\s*express/i, 'Amex'],
  [/\bvisa\b/i, 'Visa'],
  [/master\s*card|\bmc\b/i, 'Mastercard'],
  [/\bdiscover\b/i, 'Discover'],
  [/apple\s*pay/i, 'Apple Pay'],
  [/google\s*pay/i, 'Google Pay'],
  [/\bdebit\b/i, 'Debit'],
];

/** How it was paid: "Visa ••1234", "Cash", or '' when the receipt doesn't say. */
export function findPayment(lines: string[]): string {
  const text = lines.join('\n');
  const last4 = text.match(/(?:[*xX#•]{2,}|ending(?: in)?|acct\s*#?)\s*[*xX#•\s]*(\d{4})\b/i)?.[1];
  for (const [pattern, name] of CARDS)
    if (pattern.test(text)) return last4 ? `${name} ••${last4}` : name;
  if (/\bcash\b/i.test(text) && !/cash\s*back/i.test(text)) return 'Cash';
  return last4 ? `Card ••${last4}` : '';
}

const CATEGORY_WORDS: [ReceiptCategory, RegExp][] = [
  [
    'fuel',
    /\b(shell|bp|chevron|exxon|mobil|marathon|speedway|circle k|sunoco|citgo|valero|arco|phillips 66|conoco|wawa|sheetz|quiktrip|qt|casey'?s|love'?s|pilot|flying j|racetrac|gallons?|gal|unleaded|diesel|regular|premium|pump\s*#?\s*\d+|fuel|gas station)\b/i,
  ],
  [
    'materials',
    /\b(home depot|lowe'?s|menards|ace hardware|true value|lumber|hardware|ferguson|sherwin|drywall|concrete|plywood|lumber|supply|builders?|fastenal|grainger|abc supply)\b/i,
  ],
  [
    'equipment',
    /\b(harbor freight|best buy|b ?& ?h|dewalt|milwaukee|makita|ryobi|tool rental|sunbelt|united rentals|apple store|micro center)\b/i,
  ],
  [
    'office',
    /\b(staples|office depot|officemax|fedex office|ups store|usps|post office|toner|ink|printer|paper|postage|shipping)\b/i,
  ],
  [
    'travel',
    /\b(uber|lyft|taxi|cab|airlines?|delta|united|american airlines|southwest|jetblue|alaska air|hotel|inn|marriott|hilton|hyatt|holiday inn|airbnb|parking|park ?mobile|toll|amtrak|hertz|enterprise|avis|budget rent|national car)\b/i,
  ],
  [
    'meals',
    /\b(restaurant|cafe|coffee|starbucks|dunkin|mcdonald'?s|grill|pizza|taco|tacos|burger|chipotle|subway|diner|kitchen|bistro|bar|pub|tip|gratuity|server|table\s*#?\s*\d+|guests?|panera|wendy'?s|chick-fil-a|sushi|thai|deli|bakery)\b/i,
  ],
];

/** A category from the merchant and what's printed. Merchant names count first. */
export function guessCategory(merchant: string, lines: string[] = []): ReceiptCategory {
  for (const [category, words] of CATEGORY_WORDS) if (words.test(merchant)) return category;
  const text = lines.join(' ');
  for (const [category, words] of CATEGORY_WORDS) if (words.test(text)) return category;
  return 'other';
}

const cleanMerchant = (text: string) =>
  text
    .replace(/[^\p{L}\p{N}&'’.\-\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

/** Title case for all-caps merchant names ("HOME DEPOT #1234" → "Home Depot"). */
export function tidyMerchant(text: string) {
  const clean = cleanMerchant(
    text.replace(/\s*(#|no\.?|store)\s*\d+.*$/i, '').replace(/\s+\d{3,}$/, ''),
  );
  if (clean !== clean.toUpperCase()) return clean;
  return clean
    .toLowerCase()
    .replace(
      /(^|[\s&'’-])(\p{L})/gu,
      (_, before: string, letter: string) => before + letter.toUpperCase(),
    )
    .replace(/'S\b/g, "'s")
    .replace(/’S\b/g, '’s');
}

export type Extracted = {
  merchant: string;
  total: number | null;
  tax: number | null;
  date: string | null;
  payment: string;
  category: ReceiptCategory;
  /** What couldn't be read, so the person is asked only for that. */
  missing: ('merchant' | 'total' | 'date')[];
};

/** A read receipt → the details of an expense. */
export function extractExpense(
  parsed: ParsedReceipt,
  lines: (ReceiptLine | string)[],
  today: string,
): Extracted {
  const text = lines.map((line) => (typeof line === 'string' ? line : line.text));
  const merchant = tidyMerchant(parsed.merchant);
  const itemsTotal = parsed.items.reduce((sum, item) => sum + item.price, 0);
  const total =
    parsed.total ??
    (parsed.subtotal !== null
      ? parsed.subtotal + (parsed.tax ?? 0) + (parsed.tip ?? 0)
      : itemsTotal
        ? itemsTotal + (parsed.tax ?? 0)
        : null);
  const date = findDate(text, today);
  const missing: Extracted['missing'] = [];
  if (!merchant) missing.push('merchant');
  if (!total) missing.push('total');
  if (!date) missing.push('date');
  return {
    merchant,
    total: total || null,
    tax: parsed.tax,
    date,
    payment: findPayment(text),
    category: guessCategory(merchant, text),
    missing,
  };
}

/* ---------------- the records ---------------- */

export function newExpense(
  id: string,
  now: number,
  today: string,
  fields: Partial<Expense> = {},
): Expense {
  return {
    id,
    merchant: '',
    total: 0,
    tax: null,
    date: today,
    category: 'other',
    payment: '',
    tag: '',
    note: '',
    photo: false,
    source: 'typed',
    created: now,
    updated: now,
    ...fields,
  };
}

/** Save a record (new or changed), newest receipt date first. */
export function saveExpense(store: ReceiptsStore, expense: Expense): ReceiptsStore {
  const receipts = [expense, ...store.receipts.filter((entry) => entry.id !== expense.id)]
    .sort((a, b) => (a.date === b.date ? b.created - a.created : a.date < b.date ? 1 : -1))
    .slice(0, MAX_RECEIPTS);
  return { ...store, receipts };
}

export function removeExpense(store: ReceiptsStore, id: string): ReceiptsStore {
  return { ...store, receipts: store.receipts.filter((entry) => entry.id !== id) };
}

/** Projects and clients used before, most recent first: offered as chips. */
export function recentTags(receipts: Expense[], limit = 6) {
  const tags: string[] = [];
  for (const receipt of [...receipts].sort((a, b) => b.updated - a.updated)) {
    const tag = receipt.tag.trim();
    if (tag && !tags.some((known) => known.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

/* ---------------- finding and adding up ---------------- */

export type Period = 'month' | 'last' | 'year' | 'all';
export const PERIOD_NAMES: Record<Period, string> = {
  month: 'This month',
  last: 'Last month',
  year: 'This year',
  all: 'All',
};

export function inPeriod(date: string, period: Period, today: string) {
  if (period === 'all') return true;
  if (period === 'year') return date.slice(0, 4) === today.slice(0, 4);
  if (period === 'month') return date.slice(0, 7) === today.slice(0, 7);
  const [year, month] = today.split('-').map(Number);
  const last = month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
  return date.slice(0, 7) === last;
}

export function matches(receipt: Expense, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [
    receipt.merchant,
    receipt.note,
    receipt.tag,
    receipt.payment,
    CATEGORY_NAMES[receipt.category],
    (receipt.total / 100).toFixed(2),
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

export function filterReceipts(
  receipts: Expense[],
  {
    period,
    category,
    query,
    today,
  }: { period: Period; category: ReceiptCategory | null; query: string; today: string },
) {
  return receipts.filter(
    (receipt) =>
      inPeriod(receipt.date, period, today) &&
      (!category || receipt.category === category) &&
      matches(receipt, query),
  );
}

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

export type MonthGroup = { key: string; label: string; total: number; receipts: Expense[] };

/** Receipts by month, newest first, each with its total. */
export function byMonth(receipts: Expense[], today = ''): MonthGroup[] {
  const groups = new Map<string, Expense[]>();
  for (const receipt of receipts) {
    const key = receipt.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), receipt]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => {
      const [year, month] = key.split('-').map(Number);
      const sameYear = today.slice(0, 4) === String(year);
      return {
        key,
        label: sameYear ? MONTH_NAMES[month - 1] : `${MONTH_NAMES[month - 1]} ${year}`,
        total: list.reduce((sum, receipt) => sum + receipt.total, 0),
        receipts: list,
      };
    });
}

/** Totals by category, largest first. */
export function byCategory(receipts: Expense[]) {
  const totals = new Map<ReceiptCategory, number>();
  for (const receipt of receipts)
    totals.set(receipt.category, (totals.get(receipt.category) ?? 0) + receipt.total);
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/** "Sep 28" (or "Sep 28, 2025" in another year). */
export function shortDate(date: string, today = '') {
  const [year, month, day] = date.split('-').map(Number);
  const name = MONTH_NAMES[month - 1].slice(0, 3);
  return today.slice(0, 4) === String(year) ? `${name} ${day}` : `${name} ${day}, ${year}`;
}

/** The records as a spreadsheet. */
export function receiptsCsv(receipts: Expense[]) {
  return csv([
    ['Date', 'Merchant', 'Category', 'Total', 'Tax', 'Paid with', 'Project or client', 'Note'],
    ...receipts.map((receipt) => [
      receipt.date,
      receipt.merchant,
      CATEGORY_NAMES[receipt.category],
      (receipt.total / 100).toFixed(2),
      receipt.tax === null ? '' : (receipt.tax / 100).toFixed(2),
      receipt.payment,
      receipt.tag,
      receipt.note,
    ]),
  ]);
}
