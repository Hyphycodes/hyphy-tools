import { expect, test } from '@playwright/test';
import {
  allocate,
  computeSplit,
  formatMoney,
  newBill,
  parseMoney,
  splitBillSchema,
  splitSummary,
  type SplitBill,
} from '@/lib/tools/split';

/* Split's arithmetic: exact to the cent, fair by what people ordered. */

const bill = (patch: Partial<SplitBill>): SplitBill => ({
  ...newBill(),
  people: [
    { id: 'a', name: 'Ana' },
    { id: 'b', name: 'Ben' },
    { id: 'c', name: 'Cam' },
  ],
  tip: { mode: 'percent', value: 0, afterTax: false },
  ...patch,
});

test('allocation always adds up exactly', () => {
  expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  expect(allocate(1, [1, 1])).toEqual([1, 0]);
  expect(allocate(0, [3, 1])).toEqual([0, 0]);
  expect(allocate(10, [0, 0])).toEqual([5, 5]);
  for (const total of [1, 7, 99, 1001, 123457])
    for (const weights of [[1], [1, 2, 3], [5, 0, 5], [7, 11, 13, 17]])
      expect(allocate(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
});

test('shared plates split between the people who shared them', () => {
  const result = computeSplit(
    bill({
      items: [
        { id: 'pizza', name: 'Pizza', price: 1800, people: ['a', 'b'] },
        { id: 'salad', name: 'Salad', price: 1200, people: ['c'] },
        { id: 'wine', name: 'Wine', price: 3000, people: [] },
      ],
    }),
  );
  const [ana, ben, cam] = result.people;
  expect(ana.subtotal).toBe(900 + 1000);
  expect(ben.subtotal).toBe(900 + 1000);
  expect(cam.subtotal).toBe(1200 + 1000);
  expect(result.subtotal).toBe(6000);
  expect(result.total).toBe(6000);
});

test('tax and tip land in proportion, and the totals match the bill to the cent', () => {
  const result = computeSplit(
    bill({
      items: [
        { id: 'x', name: 'Steak', price: 3333, people: ['a'] },
        { id: 'y', name: 'Pasta', price: 1667, people: ['b'] },
        { id: 'z', name: 'Soup', price: 1001, people: ['c'] },
      ],
      tax: { mode: 'amount', value: 533 },
      tip: { mode: 'percent', value: 18, afterTax: false },
    }),
  );
  expect(result.tax).toBe(533);
  expect(result.tip).toBe(Math.round(6001 * 0.18));
  const sum = result.people.reduce((total, person) => total + person.total, 0);
  expect(sum).toBe(result.total);
  expect(result.total).toBe(6001 + 533 + 1080);
  // Ana ordered more than half, so she carries more than half of the tax.
  expect(result.people[0].tax).toBeGreaterThan(result.people[1].tax);
});

test('tip on the total with tax, and a tax rate', () => {
  const result = computeSplit(
    bill({
      mode: 'even',
      total: 9000,
      tax: { mode: 'percent', value: 10 },
      tip: { mode: 'percent', value: 20, afterTax: true },
    }),
  );
  expect(result.tax).toBe(900);
  expect(result.tip).toBe(1980);
  expect(result.people.map((person) => person.total)).toEqual([3960, 3960, 3960]);
});

test('money reads the way people type it', () => {
  expect(parseMoney('12.50')).toBe(1250);
  expect(parseMoney('$1,234.56')).toBe(123456);
  expect(parseMoney('12,50')).toBe(1250);
  expect(parseMoney('1.234,56')).toBe(123456);
  expect(parseMoney('abc')).toBeNull();
  expect(parseMoney('-5')).toBeNull();
  expect(parseMoney('1500', 'JPY')).toBe(1500);
  expect(formatMoney(123456)).toBe('$1,234.56');
  expect(formatMoney(1500, 'JPY')).toBe('¥1,500');
});

test('a shared link can’t smuggle in anything odd', () => {
  expect(
    splitBillSchema.safeParse({
      ...newBill(),
      items: [{ id: 'x', name: 'x', price: -1, people: [] }],
    }).success,
  ).toBe(false);
  expect(splitBillSchema.safeParse({ ...newBill(), v: 2 }).success).toBe(false);
  expect(splitBillSchema.safeParse(newBill()).success).toBe(true);
});

test('the group-chat summary names everyone', () => {
  const current = bill({
    title: 'Dinner',
    items: [{ id: 'x', name: 'All of it', price: 9000, people: [] }],
    tip: { mode: 'percent', value: 20, afterTax: false },
  });
  const text = splitSummary(current, computeSplit(current));
  expect(text).toContain('Dinner: $108.00');
  expect(text).toContain('Ana: $36.00');
  expect(text).toContain('20% tip');
});
