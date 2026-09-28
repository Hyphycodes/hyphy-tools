import { expect, test } from '@playwright/test';
import { parseReceipt } from '@/lib/tools/receipt';
import {
  byCategory,
  byMonth,
  EMPTY_RECEIPTS,
  extractExpense,
  filterReceipts,
  findDate,
  findPayment,
  guessCategory,
  newExpense,
  receiptsCsv,
  recentTags,
  removeExpense,
  saveExpense,
  shortDate,
  tidyMerchant,
} from '@/lib/tools/receipts';

/* Receipts: a read photo becomes an expense, and a year of them stays easy to find and export. */

const TODAY = '2026-09-28';
const T0 = 1_750_000_000_000;

const HOME_DEPOT = [
  'THE HOME DEPOT #1234',
  '123 MAIN ST CHICAGO IL',
  '09/28/26 10:14 AM',
  '2X4 STUD 8FT            12.48',
  'DRYWALL SCREWS           8.97',
  'JOINT COMPOUND          23.55',
  'SUBTOTAL                45.00',
  'SALES TAX                3.72',
  'TOTAL                   48.72',
  'VISA XXXXXXXXXXXX1234',
];

test('a read receipt becomes an expense: merchant, total, tax, date, card, category', () => {
  const extracted = extractExpense(parseReceipt(HOME_DEPOT), HOME_DEPOT, TODAY);
  expect(extracted).toMatchObject({
    total: 4872,
    tax: 372,
    date: '2026-09-28',
    payment: 'Visa ••1234',
    category: 'materials',
    missing: [],
  });
  expect(extracted.merchant).toBe('The Home Depot');
});

test('what can’t be read is asked for, and only that', () => {
  const extracted = extractExpense(parseReceipt(['~~~', 'thank you']), ['~~~', 'thank you'], TODAY);
  expect(extracted.missing).toEqual(['merchant', 'total', 'date']);
  expect(extracted.category).toBe('other');
});

test('dates in the ways receipts print them, never in the future', () => {
  expect(findDate(['Date: 2026-09-12'], TODAY)).toBe('2026-09-12');
  expect(findDate(['9-3-26 18:02'], TODAY)).toBe('2026-09-03');
  expect(findDate(['Sep 28, 2026'], TODAY)).toBe('2026-09-28');
  expect(findDate(['28 Sept 2026'], TODAY)).toBe('2026-09-28');
  expect(findDate(['12/31/26'], TODAY)).toBeNull();
  expect(findDate(['13/45/26', 'no date'], TODAY)).toBeNull();
  expect(findDate(['O9/2O/2026'], TODAY)).toBe('2026-09-20');
});

test('how it was paid', () => {
  expect(findPayment(['AMEX ************1005'])).toBe('Amex ••1005');
  expect(findPayment(['MASTERCARD', 'ACCT # 4417'])).toBe('Mastercard ••4417');
  expect(findPayment(['CASH 60.00', 'CHANGE 11.28'])).toBe('Cash');
  expect(findPayment(['DEBIT CASH BACK 20.00'])).toBe('Debit');
  expect(findPayment(['THANK YOU'])).toBe('');
});

test('categories from the merchant first, then what’s printed', () => {
  expect(guessCategory('Shell')).toBe('fuel');
  expect(guessCategory('Speedway 4412')).toBe('fuel');
  expect(guessCategory('Unknown Mart', ['REGULAR UNLEADED', '12.4 GAL'])).toBe('fuel');
  expect(guessCategory('Menards')).toBe('materials');
  expect(guessCategory('Staples')).toBe('office');
  expect(guessCategory('Uber')).toBe('travel');
  expect(guessCategory('Monteverde', ['TABLE 12', 'SERVER: ANA'])).toBe('meals');
  expect(guessCategory('Harbor Freight Tools')).toBe('equipment');
  expect(guessCategory('Etsy')).toBe('other');
  expect(tidyMerchant('HOME DEPOT #1234')).toBe('Home Depot');
  expect(tidyMerchant("LOWE'S HOME CENTERS")).toBe("Lowe's Home Centers");
});

test('saved, found, added up by month and exported', () => {
  let store = EMPTY_RECEIPTS;
  const add = (id: string, fields: Parameters<typeof newExpense>[3]) =>
    (store = saveExpense(store, newExpense(id, T0, TODAY, fields)));
  add('r1', {
    merchant: 'Home Depot',
    total: 4872,
    date: '2026-09-28',
    category: 'materials',
    tag: 'Oak Brook',
  });
  add('r2', { merchant: 'Shell', total: 5210, date: '2026-09-02', category: 'fuel' });
  add('r3', {
    merchant: 'Staples',
    total: 1999,
    date: '2026-08-15',
    category: 'office',
    note: 'toner, "black"',
  });
  add('r4', { merchant: 'Uber', total: 2400, date: '2025-12-30', category: 'travel' });
  expect(store.receipts.map((receipt) => receipt.id)).toEqual(['r1', 'r2', 'r3', 'r4']);

  const month = filterReceipts(store.receipts, {
    period: 'month',
    category: null,
    query: '',
    today: TODAY,
  });
  expect(month.map((receipt) => receipt.id)).toEqual(['r1', 'r2']);
  expect(
    filterReceipts(store.receipts, { period: 'last', category: null, query: '', today: TODAY }),
  ).toHaveLength(1);
  expect(
    filterReceipts(store.receipts, { period: 'all', category: 'fuel', query: '', today: TODAY }),
  ).toHaveLength(1);
  expect(
    filterReceipts(store.receipts, { period: 'all', category: null, query: 'oak', today: TODAY }),
  ).toHaveLength(1);
  expect(
    filterReceipts(store.receipts, { period: 'all', category: null, query: '48.72', today: TODAY }),
  ).toHaveLength(1);

  const months = byMonth(store.receipts, TODAY);
  expect(months.map((group) => [group.label, group.total])).toEqual([
    ['September', 10082],
    ['August', 1999],
    ['December 2025', 2400],
  ]);
  expect(byCategory(month)[0]).toEqual({ category: 'fuel', total: 5210 });
  expect(shortDate('2026-09-28', TODAY)).toBe('Sep 28');
  expect(shortDate('2025-12-30', TODAY)).toBe('Dec 30, 2025');
  expect(recentTags(store.receipts)).toEqual(['Oak Brook']);

  const sheet = receiptsCsv(store.receipts);
  expect(sheet.split('\r\n')[0]).toBe(
    'Date,Merchant,Category,Total,Tax,Paid with,Project or client,Note',
  );
  expect(sheet).toContain('2026-09-28,Home Depot,Materials,48.72,,,Oak Brook,');
  expect(sheet).toContain('"toner, ""black"""');

  store = removeExpense(store, 'r2');
  expect(store.receipts).toHaveLength(3);
});
