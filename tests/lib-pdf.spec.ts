import { expect, test } from '@playwright/test';
import { everyParts, formatRange, parseParts, parseRange } from '@/lib/tools/pdf';

/* PDF page ranges: keeping pages, and splitting one file into several. */

test('page ranges read the way people type them', () => {
  expect(parseRange('1-3, 5', 7)).toEqual([0, 1, 2, 4]);
  expect(parseRange('6-', 7)).toEqual([5, 6]);
  expect(parseRange('9', 7)).toBeNull();
  expect(formatRange([0, 1, 2, 4])).toBe('1-3, 5');
});

test('split into parts by ranges, keeping each part separate', () => {
  expect(parseParts('1-3, 4-6, 7-', 8)).toEqual([
    [0, 1, 2],
    [3, 4, 5],
    [6, 7],
  ]);
  expect(parseParts('2, 2', 4)).toEqual([[1], [1]]);
  expect(parseParts('1-3, x', 4)).toBeNull();
  expect(parseParts('', 4)).toBeNull();
});

test('split every few pages', () => {
  expect(everyParts(7, 3)).toEqual([[0, 1, 2], [3, 4, 5], [6]]);
  expect(everyParts(3, 1)).toEqual([[0], [1], [2]]);
  expect(everyParts(2, 0)).toEqual([[0], [1]]);
});
