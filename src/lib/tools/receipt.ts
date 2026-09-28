/*
 * Reading a receipt: turns the lines a text reader found on a photo into a bill — the place, the
 * items (with quantities when printed), subtotal, tax, a printed tip and the total. Pure and
 * tested (tests/lib-receipt.spec.ts), and deliberately modest: it never pretends to be sure.
 * Anything it can't read cleanly is marked `unsure`, and the totals it finds are checked against
 * the items so the person reviewing knows where to look.
 *
 * Amounts are whole cents (or whole units for currencies without them), like the rest of Split.
 */

export type ReceiptLine = {
  text: string;
  /** 0–100, from the text reader. */
  confidence?: number;
};

export type ReceiptItem = {
  name: string;
  qty: number;
  /** The line's price (all of the quantity), in cents. */
  price: number;
  /** Read poorly, or the name looks garbled: worth a glance. */
  unsure: boolean;
};

export type ParsedReceipt = {
  merchant: string;
  items: ReceiptItem[];
  subtotal: number | null;
  tax: number | null;
  /** Only a tip that's printed as paid, never the "suggested tip" table. */
  tip: number | null;
  total: number | null;
};

export type ReceiptCheck = {
  /** What the items add up to. */
  itemsTotal: number;
  /** The receipt's subtotal disagrees with the items by this much (0 when they agree). */
  subtotalGap: number;
  /** items + tax + tip disagrees with the printed total by this much (0 when they agree). */
  totalGap: number;
};

const TIP = /\b(tip|tips|gratuity|grat|service charge|svc chg)\b/;
const SUGGESTED = /suggest|%|guide|calculat/;
const SUBTOTAL = /\bsub[\s-]*t[o0]?ta?l\b|\bsubtotal\b|\bsub tl\b|\bnet total\b|\bfood total\b/;
const TAX = /\b(tax|taxes|vat|gst|hst|pst|qst|iva|sales tx|tx)\b/;
const TOTAL =
  /\b(total|t[o0]tal|amount due|balance due|amt due|grand total|to pay|total due|importe)\b/;
const NOT_AN_ITEM =
  /\b(change|cash|visa|mastercard|master card|amex|american express|discover|debit|credit|card|tender|tendered|payment|paid|auth|authorization|approval|approved|acct|account|ref|transaction|txn|contactless|balance|you saved|savings|points|rewards|loyalty|discount|coupon|promo|terminal|merchant id|batch|thank)\b/;
const HEADER_NOISE =
  /\b(receipt|invoice|order|table|guest|guests|server|cashier|check|chk|tel|phone|www|http|\.com|street|st\.|ave|avenue|road|rd\.|suite|blvd|welcome|thank)\b|\d{3}[-.\s)]\d{3}[-.\s]\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}:\d{2}/;

/** Letters an OCR engine confuses with digits, inside something that's clearly a number. */
const DIGITISH: Record<string, string> = {
  O: '0',
  o: '0',
  D: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  s: '5',
  B: '8',
  Z: '2',
};

/** Repairs a price-shaped token at the end of a line ("1O.5O" → "10.50", "12 .50" → "12.50"). */
function repairNumbers(line: string) {
  return line
    .replace(/(\d)\s+([.,])\s*(\d{2})\b/g, '$1$2$3')
    .replace(/(\d[.,])\s+(\d{2})\b/g, '$1$2')
    .replace(/[\dOoDIl|SsBZ]+[.,][\dOoDIl|SsBZ]{2}\b/g, (token) =>
      /\d/.test(token) && token.replace(/[^\d]/g, '').length >= 2
        ? token.replace(/[OoDIl|SsBZ]/g, (letter) => DIGITISH[letter] ?? letter)
        : token,
    );
}

const PRICE = /(-)?\s?[$€£¥]?\s?((?:\d{1,3}(?:[,.\s]\d{3})+)|\d{1,6})[.,](\d{2})(?!\d)/g;

type Priced = { before: string; cents: number; negative: boolean; count: number };

/** The last amount on the line, and the words before it. */
function lastPrice(line: string): Priced | null {
  const matches = [...line.matchAll(PRICE)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const whole = Number(match[2].replace(/[,.\s]/g, ''));
  const cents = whole * 100 + Number(match[3]);
  if (!Number.isFinite(cents) || cents > 10_000_000) return null;
  return {
    before: line.slice(0, match.index).trim(),
    cents,
    negative: Boolean(match[1]) || /\(\s*$|-\s*$/.test(line.slice(0, match.index)),
    count: matches.length,
  };
}

function letters(text: string) {
  return (text.match(/\p{L}/gu) ?? []).length;
}

function titleCase(text: string) {
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s&-])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
}

/** "2 x Fries", "2 @ 4.50 Fries", "Fries 2 @ 4.50" → quantity and name. */
function quantityOf(name: string): { qty: number; name: string } {
  let qty = 1;
  let rest = name;
  const unit = rest.match(/(\d{1,2})\s*[@xX×*]\s*[$]?\d{1,4}[.,]\d{2}/);
  if (unit) {
    qty = Number(unit[1]);
    rest = rest.replace(unit[0], ' ');
  } else {
    const lead = rest.match(/^\s*(\d{1,2})\s*(?:[xX×*@]\s*|\s+)(?=\p{L})/u);
    if (lead) {
      qty = Number(lead[1]);
      rest = rest.slice(lead[0].length);
    } else {
      const trail = rest.match(/\s[xX×]\s?(\d{1,2})\s*$/);
      if (trail) {
        qty = Number(trail[1]);
        rest = rest.slice(0, trail.index);
      }
    }
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) qty = 1;
  return { qty, name: rest };
}

function cleanName(text: string) {
  return text
    .replace(/[^\p{L}\p{N}&'’%+./\s-]/gu, ' ')
    .replace(/\s[A-Z]{1,2}$/, ' ') // a trailing tax flag ("T", "FN")
    .replace(/^[\s.\-–:#*]+|[\s.\-–:#*]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function merchantOf(lines: string[]) {
  for (const raw of lines.slice(0, 6)) {
    const text = raw.replace(/^\s*welcome\s+to\s+/i, '').trim();
    if (letters(text) < 3) continue;
    if (HEADER_NOISE.test(text.toLowerCase())) continue;
    if (lastPrice(text)) continue;
    if (letters(text) / text.replace(/\s/g, '').length < 0.6) continue;
    return titleCase(cleanName(text)).slice(0, 60);
  }
  return '';
}

/** Turns the reader's lines into a receipt. Lines are top to bottom. */
export function parseReceipt(input: (ReceiptLine | string)[]): ParsedReceipt {
  const lines = input
    .map((line) => (typeof line === 'string' ? { text: line } : line))
    .map((line) => ({ ...line, text: repairNumbers(line.text.replace(/\s+/g, ' ').trim()) }))
    .filter((line) => line.text.length > 0);

  const receipt: ParsedReceipt = {
    merchant: merchantOf(lines.map((line) => line.text)),
    items: [],
    subtotal: null,
    tax: null,
    tip: null,
    total: null,
  };
  let totalsStarted = false;

  for (const line of lines) {
    const priced = lastPrice(line.text);
    if (!priced) continue;
    // "Tota1", "Subt0tal": digits misread inside words, back to letters for matching.
    const words = priced.before
      .toLowerCase()
      .replace(/(?<=\p{L})[10]|[10](?=\p{L})/gu, (digit) => (digit === '1' ? 'l' : 'o'));

    if (TIP.test(words)) {
      // "Suggested tip: 18% $8.10 20% $9.00" is advice, not money paid.
      if (!SUGGESTED.test(line.text.toLowerCase()) && priced.count === 1)
        receipt.tip = priced.cents;
      totalsStarted = true;
      continue;
    }
    if (SUBTOTAL.test(words)) {
      receipt.subtotal = priced.cents;
      totalsStarted = true;
      continue;
    }
    if (TAX.test(words)) {
      receipt.tax = (receipt.tax ?? 0) + priced.cents;
      totalsStarted = true;
      continue;
    }
    if (TOTAL.test(words) && !NOT_AN_ITEM.test(words.replace(/\b(balance|amount)\s+due\b/, ''))) {
      // The first total is the bill; later ones repeat it after payment lines.
      if (receipt.total === null) receipt.total = priced.cents;
      totalsStarted = true;
      continue;
    }
    if (totalsStarted || priced.negative || NOT_AN_ITEM.test(words)) continue;

    const { qty, name } = quantityOf(priced.before);
    const clean = cleanName(name);
    if (!clean && !priced.cents) continue;
    const readable = letters(clean) >= 2;
    receipt.items.push({
      name: readable ? titleCase(clean).slice(0, 80) : '',
      qty,
      price: priced.cents,
      unsure: !readable || (line.confidence !== undefined && line.confidence < 65),
    });
  }
  return receipt;
}

/** How well the receipt's own totals agree with what was read. */
export function checkReceipt(receipt: ParsedReceipt): ReceiptCheck {
  const itemsTotal = receipt.items.reduce((sum, item) => sum + item.price, 0);
  const subtotal = receipt.subtotal ?? itemsTotal;
  return {
    itemsTotal,
    subtotalGap: receipt.subtotal === null ? 0 : receipt.subtotal - itemsTotal,
    totalGap:
      receipt.total === null
        ? 0
        : receipt.total - (subtotal + (receipt.tax ?? 0) + (receipt.tip ?? 0)),
  };
}
