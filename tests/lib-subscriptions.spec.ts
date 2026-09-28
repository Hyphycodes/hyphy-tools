import { expect, test } from '@playwright/test';
import {
  addMonths,
  changeCurrency,
  chargesBetween,
  draftOf,
  emptyDraft,
  exportJson,
  formatDay,
  localToday,
  mergeItems,
  monthlyCost,
  newList,
  nextCharge,
  parseDay,
  priceText,
  readDraft,
  readImport,
  relativeDay,
  sampleItems,
  sortSubscriptions,
  subscriptionListSchema,
  summarize,
  toCsv,
  webLink,
  yearlyCost,
  type Subscription,
} from '@/lib/tools/subscriptions';

/* Subscriptions: calendar math that never slips a day, and totals that are really monthly. */

const TODAY = '2026-09-28';

const sub = (patch: Partial<Subscription>): Subscription => ({
  id: patch.name?.toLowerCase().replace(/\W+/g, '-') ?? 'x',
  name: 'Thing',
  cost: 1000,
  every: 1,
  unit: 'month',
  next: TODAY,
  category: 'other',
  trialEnds: '',
  notes: '',
  cancelUrl: '',
  paused: false,
  ...patch,
});

test('only real calendar days are dates', () => {
  expect(parseDay('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  expect(parseDay('2026-02-29')).toBeNull();
  expect(parseDay('2026-04-31')).toBeNull();
  expect(parseDay('2026-13-01')).toBeNull();
  expect(parseDay('2026-9-28')).toBeNull();
  expect(parseDay('')).toBeNull();
  // Today comes from the local calendar, whatever UTC says.
  expect(localToday(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
  expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
});

test('month-end charges keep their day: Jan 31 → Feb 28 or 29 → Mar 31', () => {
  expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  expect(addMonths('2026-08-31', 13)).toBe('2027-09-30');

  const monthly = sub({ next: '2026-01-31' });
  expect(chargesBetween(monthly, '2026-01-01', '2026-06-30')).toEqual([
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
    '2026-05-31',
    '2026-06-30',
  ]);
  // Rolled forward from an old anchor, never from the clipped February day.
  expect(nextCharge(monthly, '2026-03-01')).toBe('2026-03-31');
  expect(nextCharge(monthly, '2026-02-15')).toBe('2026-02-28');
  expect(nextCharge(monthly, '2026-03-31')).toBe('2026-03-31');
  // A yearly Feb 29 charges on Feb 28 until the next leap year.
  const leap = sub({ unit: 'year', next: '2024-02-29' });
  expect(nextCharge(leap, '2026-01-01')).toBe('2026-02-28');
  expect(nextCharge(leap, '2028-01-01')).toBe('2028-02-29');
});

test('past next-charge dates roll forward to the first charge from today', () => {
  expect(nextCharge(sub({ next: '2026-09-28' }), TODAY)).toBe('2026-09-28');
  expect(nextCharge(sub({ next: '2026-10-05' }), TODAY)).toBe('2026-10-05');
  expect(nextCharge(sub({ next: '2026-01-15' }), TODAY)).toBe('2026-10-15');
  expect(nextCharge(sub({ next: '2026-08-28' }), TODAY)).toBe('2026-09-28');
  expect(nextCharge(sub({ unit: 'week', next: '2026-09-01' }), TODAY)).toBe('2026-09-29');
  expect(nextCharge(sub({ unit: 'week', every: 2, next: '2026-09-14' }), TODAY)).toBe('2026-09-28');
  expect(nextCharge(sub({ unit: 'day', every: 10, next: '2026-09-01' }), TODAY)).toBe('2026-10-01');
  expect(nextCharge(sub({ every: 3, next: '2025-12-31' }), TODAY)).toBe('2026-09-30');
  expect(nextCharge(sub({ unit: 'year', next: '2019-03-01' }), TODAY)).toBe('2027-03-01');
  // Across a daylight-saving change and a year end, still whole days.
  expect(chargesBetween(sub({ unit: 'week', next: '2026-10-26' }), TODAY, '2026-11-20')).toEqual([
    '2026-10-26',
    '2026-11-02',
    '2026-11-09',
    '2026-11-16',
  ]);
  expect(nextCharge(sub({ unit: 'week', next: '2026-12-28' }), '2027-01-01')).toBe('2027-01-04');
});

test('every frequency becomes a true monthly and yearly cost', () => {
  expect(monthlyCost(sub({ cost: 1549 }))).toBe(1549);
  expect(yearlyCost(sub({ cost: 1549 }))).toBe(18588);
  expect(monthlyCost(sub({ cost: 12000, unit: 'year' }))).toBe(1000);
  expect(monthlyCost(sub({ cost: 3000, every: 3 }))).toBe(1000);
  // A week is 1/7 of an average year's days: 52.18 charges, not 52 or 48.
  expect(yearlyCost(sub({ cost: 700, unit: 'week' }))).toBeCloseTo(36524.25, 6);
  expect(monthlyCost(sub({ cost: 1000, unit: 'week', every: 2 }))).toBeCloseTo(2174.0625, 6);
  expect(yearlyCost(sub({ cost: 100, unit: 'day', every: 10 }))).toBeCloseTo(3652.425, 6);
  expect(priceText(sub({ cost: 1549 }), 'USD')).toBe('$15.49 a month');
  expect(priceText(sub({ cost: 5994, unit: 'week', every: 2 }), 'USD')).toBe(
    '$59.94 every 2 weeks',
  );
});

test('the summary: totals without paused ones, what charges soon, trials, categories', () => {
  const items = [
    sub({ name: 'Streaming', cost: 1549, next: '2026-10-02', category: 'streaming' }),
    sub({ name: 'Backup', cost: 2999, unit: 'year', next: '2027-01-10', category: 'cloud' }),
    sub({ name: 'Paper', cost: 400, unit: 'week', next: '2026-09-30', category: 'news' }),
    sub({ name: 'Editor', cost: 999, next: '2026-10-04', trialEnds: '2026-10-04' }),
    sub({ name: 'Old trial', cost: 500, next: '2026-10-20', trialEnds: '2026-09-01' }),
    sub({ name: 'Meals', cost: 5994, unit: 'week', every: 2, paused: true, category: 'food' }),
  ];
  const summary = summarize(items, TODAY);
  const exact = [items[0], items[1], items[2], items[3], items[4]].reduce(
    (sum, item) => sum + monthlyCost(item),
    0,
  );
  expect(summary.monthly).toBe(Math.round(exact));
  expect(summary.active).toBe(5);
  expect(summary.paused).toBe(1);
  expect(summary.averaged).toBe(true);

  // The weekly paper charges five times in the window; the yearly backup not at all.
  const paper = summary.upcoming.find((charge) => charge.name === 'Paper')!;
  expect(paper.count).toBe(5);
  expect(paper.date).toBe('2026-09-30');
  expect(summary.upcoming.map((charge) => charge.name)).toEqual([
    'Paper',
    'Streaming',
    'Editor',
    'Old trial',
  ]);
  expect(summary.upcomingTotal).toBe(5 * 400 + 1549 + 999 + 500);
  expect(summary.upcomingCount).toBe(8);

  // Only trials still running and ending soon.
  expect(summary.trials.map((trial) => [trial.name, trial.days])).toEqual([['Editor', 6]]);

  // Category parts add up to the monthly total to the cent, biggest first.
  expect(summary.categories.reduce((sum, part) => sum + part.monthly, 0)).toBe(summary.monthly);
  expect(summary.categories[0].id).toBe('news');
  expect(summary.categories.find((part) => part.id === 'food')).toBeUndefined();
  expect(summary.biggest.map((item) => item.name)).toEqual(['Paper', 'Streaming', 'Editor']);

  expect(summarize([], TODAY)).toMatchObject({ monthly: 0, yearly: 0, upcoming: [] });
});

test('sorting: next charge, true cost or name, with paused ones last', () => {
  const items = [
    sub({ name: 'b yearly', cost: 24000, unit: 'year', next: '2026-12-01' }),
    sub({ name: 'A monthly', cost: 1500, next: '2026-10-09' }),
    sub({ name: 'c paused', cost: 99999, next: '2026-09-29', paused: true }),
    sub({ name: 'd weekly', cost: 500, unit: 'week', next: '2026-10-01' }),
  ];
  const names = (by: 'next' | 'cost' | 'name') =>
    sortSubscriptions(items, by, TODAY).map((item) => item.name);
  expect(names('next')).toEqual(['d weekly', 'A monthly', 'b yearly', 'c paused']);
  expect(names('cost')).toEqual(['d weekly', 'b yearly', 'A monthly', 'c paused']);
  expect(names('name')).toEqual(['A monthly', 'b yearly', 'd weekly', 'c paused']);
});

test('the form: plain-word errors, and every way to say how often', () => {
  const failed = readDraft(emptyDraft());
  expect(failed.ok).toBe(false);
  if (!failed.ok) expect(Object.keys(failed.errors).sort()).toEqual(['cost', 'name', 'next']);

  const draft = { ...emptyDraft(), name: '  Music app ', cost: 1099, next: '2026-10-09' };
  const monthly = readDraft(draft);
  expect(monthly.ok && monthly.value).toMatchObject({ name: 'Music app', every: 1, unit: 'month' });
  const quarterly = readDraft({ ...draft, frequency: 'months', every: '3' });
  expect(quarterly.ok && quarterly.value).toMatchObject({ every: 3, unit: 'month' });
  const custom = readDraft({ ...draft, frequency: 'custom', every: '10', unit: 'day' });
  expect(custom.ok && custom.value).toMatchObject({ every: 10, unit: 'day' });
  const weekly = readDraft({ ...draft, frequency: 'week' });
  expect(weekly.ok && weekly.value).toMatchObject({ every: 1, unit: 'week' });

  const broken = readDraft({
    ...draft,
    frequency: 'custom',
    every: '0',
    next: '2026-02-30',
    cancelUrl: 'javascript:alert(1)',
  });
  expect(broken.ok).toBe(false);
  if (!broken.ok) expect(Object.keys(broken.errors).sort()).toEqual(['cancelUrl', 'every', 'next']);

  // A cancel link without https gets it; anything but a web page is refused.
  const linked = readDraft({ ...draft, cancelUrl: 'music.example/account ' });
  expect(linked.ok && linked.value.cancelUrl).toBe('https://music.example/account');

  // Editing opens with the same choice it was saved with.
  const saved = sub({ every: 3, unit: 'month' });
  expect(draftOf(saved).frequency).toBe('months');
  expect(draftOf(sub({ unit: 'year' })).frequency).toBe('year');
  expect(draftOf(sub({ unit: 'day', every: 1 })).frequency).toBe('custom');
});

test('cancel links are web pages only', () => {
  expect(webLink('example.com/cancel')).toBe('https://example.com/cancel');
  expect(webLink('http://example.com')).toBe('http://example.com/');
  expect(webLink('shop.example:8080/account')).toBe('https://shop.example:8080/account');
  expect(webLink('javascript:alert(1)')).toBeNull();
  expect(webLink('JavaScript://example.com/%0aalert(1)')).toBeNull();
  expect(webLink('data:text/html,hi')).toBeNull();
  expect(webLink('mailto:help@example.com')).toBeNull();
  expect(webLink('localhost:3000')).toBeNull();
  expect(webLink('not a link')).toBeNull();
  expect(webLink('')).toBeNull();
});

test('export, then import: validated, merged or replaced', () => {
  const list = {
    ...newList(),
    items: [sub({ name: 'Gym', cost: 3900 }), sub({ name: 'Paper', cost: 400, unit: 'week' })],
  };
  const file = exportJson(list, TODAY);
  const back = readImport(file);
  expect(back.ok && back.data.items).toEqual(list.items);

  expect(readImport('not json').ok).toBe(false);
  expect(readImport(JSON.stringify({ items: [] })).ok).toBe(false);
  const tampered = JSON.parse(file);
  tampered.items[0].cancelUrl = 'javascript:alert(1)';
  expect(readImport(JSON.stringify(tampered)).ok).toBe(false);
  tampered.items[0].cancelUrl = '';
  tampered.items[0].next = '2026-02-31';
  expect(readImport(JSON.stringify(tampered)).ok).toBe(false);
  tampered.items[0].next = TODAY;
  tampered.items[1].id = tampered.items[0].id;
  expect(readImport(JSON.stringify(tampered)).ok).toBe(false);

  // Merging updates the ones exported from here and adds the rest.
  const mine = [sub({ name: 'Gym', cost: 3500 }), sub({ name: 'Music', cost: 1099 })];
  const merged = mergeItems(mine, list.items);
  expect(merged.items.map((item) => [item.name, item.cost])).toEqual([
    ['Gym', 3900],
    ['Music', 1099],
    ['Paper', 400],
  ]);
  expect(merged).toMatchObject({ added: 1, updated: 1, skipped: 0 });
});

test('the CSV has every column and can’t smuggle in a formula', () => {
  const list = {
    ...newList(),
    items: [
      sub({ name: '=HYPERLINK("x")', cost: 1549, notes: 'Line, with "quotes"' }),
      sub({ name: 'Weekly', cost: 700, unit: 'week', next: '2026-09-21', paused: true }),
    ],
  };
  const lines = toCsv(list, TODAY).split('\r\n');
  expect(lines[0]).toBe(
    'Service,Cost,Currency,How often,Next charge,Per month,Per year,Category,Free trial ends,Status,How to cancel,Notes',
  );
  expect(lines[1]).toBe(
    `"'=HYPERLINK(""x"")",15.49,USD,Monthly,2026-09-28,15.49,185.88,Other,,Active,,"Line, with ""quotes"""`,
  );
  expect(lines[2]).toBe('Weekly,7.00,USD,Weekly,2026-09-28,30.44,365.24,Other,,Paused,,');
});

test('switching currency keeps the amounts people typed', () => {
  const list = { ...newList(), items: [sub({ cost: 1549 })] };
  expect(changeCurrency(list, 'EUR').items[0].cost).toBe(1549);
  expect(changeCurrency(list, 'JPY').items[0].cost).toBe(15);
  expect(changeCurrency({ ...list, currency: 'JPY' }, 'USD').items[0].cost).toBe(154900);
});

test('the sample is made up, marked, and shows every part of the summary', () => {
  const items = sampleItems(TODAY);
  expect(items.every((item) => item.sample)).toBe(true);
  expect(items.map((item) => item.name)).toEqual(
    expect.arrayContaining(['Streaming service', 'Music app', 'Cloud backup', 'Gym', 'Newspaper']),
  );
  expect(items.every((item) => !item.cancelUrl || /\.example\//.test(item.cancelUrl))).toBe(true);
  expect(subscriptionListSchema.safeParse({ ...newList(), items }).success).toBe(true);
  const summary = summarize(items, TODAY);
  expect(summary.trials).toHaveLength(1);
  expect(summary.paused).toBe(1);
  expect(summary.upcoming.length).toBeGreaterThan(3);
});

test('days read the same in every time zone', () => {
  expect(formatDay('2026-10-03')).toBe('Oct 3');
  expect(formatDay('2026-10-03', { weekday: true })).toBe('Sat, Oct 3');
  expect(formatDay('2027-01-01', { year: true })).toBe('Jan 1, 2027');
  expect(relativeDay(TODAY, TODAY)).toBe('today');
  expect(relativeDay(TODAY, '2026-09-29')).toBe('tomorrow');
  expect(relativeDay(TODAY, '2026-10-08')).toBe('in 10 days');
});
