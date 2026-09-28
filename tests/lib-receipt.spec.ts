import { expect, test } from '@playwright/test';
import { checkReceipt, parseReceipt } from '@/lib/tools/receipt';

/* Reading a receipt's text into a bill: items, quantities, totals, and honesty about doubts. */

test('a restaurant check: place, items, quantities, subtotal, tax and total', () => {
  const receipt = parseReceipt([
    'ROSA’S KITCHEN',
    '1428 Mission Street',
    'Tel (555) 010-2233',
    'Table 12   Guests 3',
    'Server: Mo   09/27/2026 7:42 PM',
    '2 Tacos al pastor        14.00',
    'Burger                   22.50',
    'Fries                     9.00',
    'Lemonade x2               8.00',
    '1 @ 11.50 Salad          11.50',
    'Subtotal                 65.00',
    'Tax 8.75%                 5.69',
    'TOTAL                    70.69',
    'VISA ****4421            70.69',
    'Suggested tip: 18% $11.70  20% $13.00',
    'Thank you!',
  ]);
  expect(receipt.merchant).toBe('Rosa’s Kitchen');
  expect(receipt.items.map((item) => [item.name, item.qty, item.price])).toEqual([
    ['Tacos al pastor', 2, 1400],
    ['Burger', 1, 2250],
    ['Fries', 1, 900],
    ['Lemonade', 2, 800],
    ['Salad', 1, 1150],
  ]);
  expect(receipt.subtotal).toBe(6500);
  expect(receipt.tax).toBe(569);
  expect(receipt.total).toBe(7069);
  // The suggestion table is advice, not a tip that was paid.
  expect(receipt.tip).toBeNull();
  expect(checkReceipt(receipt)).toEqual({ itemsTotal: 6500, subtotalGap: 0, totalGap: 0 });
});

test('a printed tip is kept; payment lines are never items', () => {
  const receipt = parseReceipt([
    'Blue Door Cafe',
    'Flat white   5.50',
    'Croissant    4.25',
    'Sub-total    9.75',
    'Sales Tax    0.83',
    'Tip          2.00',
    'Amount due  12.58',
    'Cash        20.00',
    'Change       7.42',
  ]);
  expect(receipt.items).toHaveLength(2);
  expect(receipt.tip).toBe(200);
  expect(receipt.total).toBe(1258);
  expect(checkReceipt(receipt).totalGap).toBe(0);
});

test('typical OCR slips: letters for digits, spaces inside prices, commas for points', () => {
  const receipt = parseReceipt([
    { text: 'Nachos        1O.5O', confidence: 91 },
    { text: 'Wings 12 .00', confidence: 88 },
    { text: 'Agua fresca 3,50', confidence: 90 },
    { text: 'Tota1 26.00', confidence: 80 },
  ]);
  expect(receipt.items.map((item) => item.price)).toEqual([1050, 1200, 350]);
  expect(receipt.total).toBe(2600);
});

test('it never pretends: poor reads are marked, and gaps against the totals are reported', () => {
  const receipt = parseReceipt([
    { text: 'Pad thai 13.00', confidence: 92 },
    { text: '#@! 8.00', confidence: 31 },
    { text: 'Subtotal 25.00', confidence: 90 },
    { text: 'Total 25.00', confidence: 90 },
  ]);
  expect(receipt.items[0].unsure).toBe(false);
  expect(receipt.items[1]).toMatchObject({ name: '', price: 800, unsure: true });
  // 13 + 8 = 21, the receipt says 25: something was missed.
  expect(checkReceipt(receipt).subtotalGap).toBe(400);
});

test('nothing readable gives an empty receipt, not a guess', () => {
  const receipt = parseReceipt(['', 'hello there', '12/05/2026 19:42', '(555) 123-4567']);
  expect(receipt.items).toEqual([]);
  expect(receipt.total).toBeNull();
});

test('discounts and refunds are left for the person to handle, not added as items', () => {
  const receipt = parseReceipt(['Pizza 18.00', 'Happy hour discount -3.00', 'Total 15.00']);
  expect(receipt.items.map((item) => item.name)).toEqual(['Pizza']);
  expect(checkReceipt(receipt).totalGap).toBe(-3 * 100);
});
