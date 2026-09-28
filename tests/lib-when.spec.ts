import { expect, test } from '@playwright/test';
import {
  addDays,
  bestTimes,
  bestTimesText,
  cellCount,
  cellsOf,
  cleanTimeZone,
  countCells,
  dayFromNumber,
  dayNumber,
  describeDays,
  emptyCells,
  findByName,
  formatDay,
  formatDuration,
  formatRange,
  formatTime,
  freeWindows,
  inBox,
  localDay,
  mergePlans,
  monthWeeks,
  newPlan,
  notFree,
  packCells,
  paintBox,
  planHours,
  quickPicks,
  samplePlan,
  shiftMonth,
  slotsPerDay,
  slotStart,
  toggleDay,
  unpackCells,
  weekdayOf,
  whenPlanSchema,
  whenSavedSchema,
  windowText,
  windowWho,
  withPerson,
  type WhenPerson,
  type WhenPlan,
} from '@/lib/tools/when';

/* When?: availability packed into links, and the overlap that decides the plan. */

const base = (patch: Partial<WhenPlan> = {}): WhenPlan => ({
  ...newPlan({
    id: 'plan123abc',
    title: 'Game night',
    tz: 'America/Chicago',
    days: ['2026-10-03', '2026-10-04'],
    start: 17,
    end: 22,
    slot: 60,
  }),
  ...patch,
});

/** A person free during [from, to) hours on the given day columns. */
function person(
  plan: WhenPlan,
  id: string,
  name: string,
  spans: [day: number, from: number, to: number][],
  updated = 1,
): WhenPerson {
  const cells = emptyCells(plan);
  const rows = slotsPerDay(plan);
  const perHour = 60 / plan.slot;
  for (const [day, from, to] of spans)
    for (let slot = (from - plan.start) * perHour; slot < (to - plan.start) * perHour; slot += 1)
      cells[day * rows + slot] = 1;
  return { id, name, times: packCells(cells), updated };
}

test('free times pack into a short bitset and come back exactly', () => {
  for (const count of [1, 7, 8, 9, 16, 91, 671, 672]) {
    for (const pattern of [
      () => 0,
      () => 1,
      (index: number) => index % 2,
      (index: number) => (index * 7919) % 5 === 0,
    ]) {
      const cells = Uint8Array.from({ length: count }, (_, index) => Number(pattern(index)));
      const text = packCells(cells);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(text.length).toBe(Math.ceil((Math.ceil(count / 8) * 4) / 3));
      expect(Array.from(unpackCells(text, count)!)).toEqual(Array.from(cells));
    }
  }
  // The biggest grid (14 days × 48 slots) is 112 characters per person.
  expect(packCells(new Uint8Array(14 * 48).fill(1))).toHaveLength(112);
  expect(packCells([1, 0, 0, 0, 0, 0, 0, 0])).toBe('gA');
});

test('a bitset that doesn’t fit is refused, not guessed at', () => {
  // Cells 1, 4, 7 … 88 are free; the last cell (90) isn't.
  const text = packCells(Uint8Array.from({ length: 91 }, (_, index) => Number(index % 3 === 1)));
  expect(unpackCells(text, 91)).not.toBeNull();
  expect(unpackCells(text, 92)).not.toBeNull(); // 90 to 96 cells all take 12 bytes...
  expect(unpackCells(text, 100)).toBeNull(); // ...100 cells don't.
  expect(unpackCells(text, 88)).toBeNull(); // cell 88 is free, so it can't be padding
  expect(unpackCells(text.slice(1), 91)).toBeNull();
  expect(unpackCells(`${text}A`, 91)).toBeNull();
  expect(unpackCells(`${text.slice(0, -1)}+`, 91)).toBeNull(); // not base64url
  expect(unpackCells(`${text.slice(0, -1)}=`, 91)).toBeNull();
  // Bits past the last cell must be zero: one set of times, one spelling.
  expect(unpackCells('gA', 1)).not.toBeNull();
  expect(unpackCells('gB', 1)).toBeNull(); // a stray bit in the base64 slack
  expect(unpackCells('wA', 1)).toBeNull(); // cell 2 set in a 1-cell grid
  expect(unpackCells('', 0)).toEqual(new Uint8Array(0));
});

test('slots, times and ranges read the way people say them', () => {
  const plan = base({ start: 9, end: 22, slot: 30 });
  expect(slotsPerDay(plan)).toBe(26);
  expect(slotsPerDay({ start: 0, end: 24, slot: 30 })).toBe(48);
  expect(cellCount(plan)).toBe(52);
  expect(slotStart(plan, 0)).toBe(540);
  expect(slotStart(plan, 21)).toBe(1170);
  expect(formatTime(0)).toBe('12 AM');
  expect(formatTime(540)).toBe('9 AM');
  expect(formatTime(720)).toBe('12 PM');
  expect(formatTime(1170)).toBe('7:30 PM');
  expect(formatTime(1140, true)).toBe('7:00 PM');
  expect(formatTime(1440)).toBe('12 AM');
  expect(formatRange(1140, 1260)).toBe('7–9 PM');
  expect(formatRange(1170, 1200)).toBe('7:30–8 PM');
  expect(formatRange(660, 780)).toBe('11 AM – 1 PM');
  expect(formatRange(0, 120)).toBe('12–2 AM');
  expect(formatRange(1320, 1440)).toBe('10 PM – midnight');
  expect(formatRange(60, 1440)).toBe('1 AM – midnight');
  expect(formatRange(0, 1440)).toBe('All day');
  expect(planHours({ start: 9, end: 22 })).toBe('9 AM – 10 PM');
  expect(formatDuration(30)).toBe('30 min');
  expect(formatDuration(60)).toBe('1 hour');
  expect(formatDuration(90)).toBe('1½ hours');
  expect(formatDuration(180)).toBe('3 hours');
});

test('dragging paints the box between two cells; tapping a day fills or empties it', () => {
  const rows = 5;
  const cells = new Uint8Array(3 * rows);
  // From day 0, slot 3 to day 1, slot 1: slots 1–3 on days 0 and 1.
  const painted = paintBox(cells, rows, 3, rows + 1, 1);
  expect(Array.from(painted)).toEqual([0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]);
  expect(cells.every((value) => value === 0)).toBe(true); // the original is untouched
  expect(inBox(rows, 3, rows + 1, 2)).toBe(true);
  expect(inBox(rows, 3, rows + 1, rows * 2 + 2)).toBe(false);
  // Erasing works the same way, and a tap is a box of one.
  expect(Array.from(paintBox(painted, rows, 2, 2, 0)).slice(0, 5)).toEqual([0, 1, 0, 1, 0]);
  const filled = toggleDay(painted, rows, 2);
  expect(Array.from(filled.slice(10))).toEqual([1, 1, 1, 1, 1]);
  expect(Array.from(toggleDay(filled, rows, 2).slice(10))).toEqual([0, 0, 0, 0, 0]);
  expect(Array.from(toggleDay(painted, rows, 0).slice(0, 5))).toEqual([1, 1, 1, 1, 1]);
  expect(countCells(filled)).toBe(11);
});

test('the best times put everyone first, then longer, then earlier', () => {
  const plan = base();
  const group = {
    ...plan,
    people: [
      person(plan, 'anaa', 'Ana', [
        [0, 17, 22],
        [1, 17, 20],
      ]),
      person(plan, 'benn', 'Ben', [
        [0, 18, 21],
        [1, 17, 20],
      ]),
      person(plan, 'camm', 'Cam', [
        [0, 19, 21],
        [1, 17, 20],
      ]),
      person(plan, 'deee', 'Dee', [[0, 20, 22]]),
    ],
  };
  // Saturday: 5 PM Ana · 6 PM Ana+Ben · 7 PM +Cam · 8 PM everyone · 9 PM Ana+Dee.
  // Sunday: Ana, Ben and Cam from 5 to 8 PM, as one window because it's the same group.
  expect(freeWindows(group)).toHaveLength(6);
  const best = bestTimes(group);
  expect(best.map((window) => windowText(group, window))).toEqual([
    'Sat, Oct 3 · 8–9 PM — everyone (4 of 4)',
    'Sun, Oct 4 · 5–8 PM — 3 of 4 free (not Dee)',
    'Sat, Oct 3 · 7–8 PM — 3 of 4 free (not Dee)',
    'Sat, Oct 3 · 6–7 PM — 2 of 4 free (not Cam or Dee)',
    'Sat, Oct 3 · 9–10 PM — 2 of 4 free (not Ben or Cam)',
  ]);
  // One person free alone isn't a time that works, once two or more have answered.
  expect(best.some((window) => window.count < 2)).toBe(false);
  expect(bestTimes(group, 3)).toHaveLength(3);
  // Before anyone answers there's nothing; with one answer, their own times.
  expect(bestTimes(plan)).toEqual([]);
  const solo = { ...plan, people: [group.people[3]] };
  expect(bestTimes(solo).map((window) => windowWho(solo, window))).toEqual(['1 of 1 free']);
  const text = bestTimesText(group, best.slice(0, 2));
  expect(text).toContain('Game night: the best times so far');
  expect(text).toContain('1. Sat, Oct 3 · 8–9 PM — everyone (4 of 4)');
  expect(text).toContain('Times in America/Chicago.');
});

test('who’s missing is said plainly', () => {
  expect(notFree(['Ben'])).toBe('not Ben');
  expect(notFree(['Ben', 'Cam'])).toBe('not Ben or Cam');
  expect(notFree(['Ben', 'Cam', 'Dee'])).toBe('not Ben, Cam or Dee');
  expect(notFree(['Ben', 'Cam', 'Dee', 'Eli'])).toBe('4 can’t make it');
  const plan = base();
  const seven = {
    ...plan,
    people: ['Ana', 'Ben', 'Cam', 'Dee', 'Eli', 'Fay', 'Gus'].map((name, index) =>
      person(plan, `p${name.toLowerCase()}`, name, name === 'Ben' ? [] : [[0, 19, 21]], index),
    ),
  };
  const [top] = bestTimes(seven);
  expect(windowText(seven, top)).toBe('Sat, Oct 3 · 7–9 PM — 6 of 7 free (not Ben)');
});

test('combining links keeps everyone, and the later save of each person', () => {
  const plan = base();
  const ana = person(plan, 'anaa', 'Ana', [[0, 17, 19]], 100);
  const ben = person(plan, 'benn', 'Ben', [[0, 18, 20]], 200);
  const benLater = person(plan, 'benn', 'Ben', [[1, 17, 22]], 300);
  const cam = person(plan, 'camm', 'Cam', [[1, 19, 20]], 50);
  const mine = { ...plan, people: [ana, ben] };
  const theirs = { ...plan, people: [benLater, cam] };

  const merged = mergePlans(mine, theirs);
  expect(merged.ok && merged.plan.people).toEqual([ana, benLater, cam]);
  expect(merged.ok && [merged.added, merged.updated]).toEqual([1, 1]);
  // The other way round: the same people, the same versions.
  const reverse = mergePlans(theirs, mine);
  expect(reverse.ok && reverse.plan.people).toEqual([benLater, cam, ana]);
  expect(reverse.ok && [reverse.added, reverse.updated]).toEqual([1, 0]);
  // An older copy never overwrites a newer one; the same link twice changes nothing.
  const stale = mergePlans({ ...plan, people: [benLater] }, { ...plan, people: [ben] });
  expect(stale.ok && stale.plan.people).toEqual([benLater]);
  const again = mergePlans(mine, mine);
  expect(again.ok && [again.plan.people, again.added, again.updated]).toEqual([mine.people, 0, 0]);
  // Two saves at the same moment settle the same way whichever copy comes first.
  const twin = { ...ben, times: benLater.times };
  const one = mergePlans({ ...plan, people: [ben] }, { ...plan, people: [twin] });
  const two = mergePlans({ ...plan, people: [twin] }, { ...plan, people: [ben] });
  expect(one.ok && two.ok && one.plan.people[0] === two.plan.people[0]).toBe(true);
});

test('links for another plan, another grid, or too many people don’t mix', () => {
  const plan = base();
  expect(mergePlans(plan, { ...plan, id: 'otherplan1' })).toEqual({
    ok: false,
    reason: 'other-plan',
  });
  expect(mergePlans(plan, { ...plan, days: ['2026-10-03'] })).toEqual({
    ok: false,
    reason: 'other-grid',
  });
  expect(mergePlans(plan, { ...plan, slot: 30 })).toMatchObject({ reason: 'other-grid' });
  expect(mergePlans(plan, { ...plan, tz: 'Europe/London' })).toMatchObject({
    reason: 'other-grid',
  });
  const crowd = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => person(plan, `${prefix}${index}xx`, 'X', []));
  expect(
    mergePlans({ ...plan, people: crowd('a', 20) }, { ...plan, people: crowd('b', 5) }),
  ).toEqual({ ok: false, reason: 'too-many' });
  expect(
    mergePlans({ ...plan, people: crowd('a', 20) }, { ...plan, people: crowd('b', 4) }).ok,
  ).toBe(true);
});

test('saving adds a person once, and a name can be matched', () => {
  const plan = base();
  const ana = person(plan, 'anaa', 'Ana', [[0, 17, 19]]);
  const added = withPerson(plan, ana);
  expect(added.people).toEqual([ana]);
  const edited = withPerson(added, { ...ana, name: 'Ana R', updated: 5 });
  expect(edited.people).toHaveLength(1);
  expect(edited.people[0].name).toBe('Ana R');
  expect(findByName(edited, '  ana r ')?.id).toBe('anaa');
  expect(findByName(edited, 'Ben')).toBeUndefined();
  expect(countCells(cellsOf(edited, edited.people[0]))).toBe(2);
});

test('a link can’t smuggle in anything odd', () => {
  const plan = base();
  const valid = { ...plan, people: [person(plan, 'anaa', 'Ana', [[0, 17, 19]])] };
  const accepts = (value: unknown) => whenPlanSchema.safeParse(value).success;
  expect(accepts(valid)).toBe(true);
  expect(accepts({ ...valid, v: 2 })).toBe(false);
  expect(accepts({ ...valid, id: 'NOT-OK' })).toBe(false);
  expect(accepts({ ...valid, title: 'x'.repeat(81) })).toBe(false);
  expect(accepts({ ...valid, title: 'Line\nbreak' })).toBe(false);
  expect(accepts({ ...valid, tz: 'Mars/Olympus Mons' })).toBe(false);
  expect(accepts({ ...valid, tz: '<script>' })).toBe(false);
  // Days: real, in order, once each, no more than 14.
  expect(accepts({ ...valid, days: ['2026-02-30', '2026-10-04'], people: [] })).toBe(false);
  expect(accepts({ ...valid, days: ['2026-10-04', '2026-10-03'] })).toBe(false);
  expect(accepts({ ...valid, days: ['2026-10-03', '2026-10-03'] })).toBe(false);
  expect(accepts({ ...valid, days: ['26-10-03', '2026-10-04'] })).toBe(false);
  const fifteen = Array.from({ length: 15 }, (_, index) => addDays('2026-10-01', index));
  expect(accepts({ ...plan, days: fifteen })).toBe(false);
  expect(accepts({ ...plan, days: fifteen.slice(0, 14) })).toBe(true);
  expect(accepts({ ...plan, days: [] })).toBe(false);
  // Hours and slots.
  expect(accepts({ ...plan, start: 22, end: 22 })).toBe(false);
  expect(accepts({ ...plan, start: 20, end: 9 })).toBe(false);
  expect(accepts({ ...plan, end: 25 })).toBe(false);
  expect(accepts({ ...plan, start: 8.5 })).toBe(false);
  expect(accepts({ ...plan, slot: 45 })).toBe(false);
  expect(accepts({ ...plan, start: 0, end: 24, slot: 30 })).toBe(true);
  // People: times that fit this grid, unique ids, real names, no more than 24.
  const ana = valid.people[0];
  expect(accepts({ ...valid, slot: 30 })).toBe(false); // Ana's times were for hourly slots
  expect(accepts({ ...valid, people: [{ ...ana, times: `${ana.times}A` }] })).toBe(false);
  expect(accepts({ ...valid, people: [{ ...ana, times: 'not base64!' }] })).toBe(false);
  expect(accepts({ ...valid, people: [ana, { ...ana }] })).toBe(false);
  expect(accepts({ ...valid, people: [{ ...ana, name: '   ' }] })).toBe(false);
  expect(accepts({ ...valid, people: [{ ...ana, name: 'x'.repeat(41) }] })).toBe(false);
  expect(accepts({ ...valid, people: [{ ...ana, updated: -1 }] })).toBe(false);
  expect(accepts({ ...valid, people: [{ ...ana, admin: true }] })).toBe(true); // extras are dropped
  expect(whenPlanSchema.parse({ ...valid, people: [{ ...ana, admin: true }] }).people[0]).toEqual(
    ana,
  );
  const crowd = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ ...ana, id: `pp${index}xx` }));
  expect(accepts({ ...plan, people: crowd(24) })).toBe(true);
  expect(accepts({ ...plan, people: crowd(25) })).toBe(false);
  expect(accepts(null)).toBe(false);
  expect(accepts('plan')).toBe(false);
});

test('the biggest plan still fits a link, and what a device keeps is checked too', () => {
  const days = Array.from({ length: 14 }, (_, index) => addDays('2026-10-01', index));
  const plan = newPlan({
    id: 'bigplan123',
    title: 'Everything',
    tz: 'Europe/London',
    days,
    start: 0,
    end: 24,
    slot: 30,
  });
  const people = Array.from({ length: 24 }, (_, index) => ({
    id: `pp${index}xx`,
    name: `Person ${index + 1}`,
    times: packCells(Uint8Array.from({ length: cellCount(plan) }, (_, cell) => (cell + index) % 3)),
    updated: 1_790_000_000_000 + index,
  }));
  const full = { ...plan, people };
  expect(whenPlanSchema.safeParse(full).success).toBe(true);
  expect(JSON.stringify(full).length).toBeLessThan(6000);
  expect(whenSavedSchema.safeParse({ v: 1, plan: full, me: 'pp3xx', saved: 1 }).success).toBe(true);
  expect(whenSavedSchema.safeParse({ v: 1, plan: full, me: 'NO', saved: 1 }).success).toBe(false);
});

test('a new plan tidies its days and keeps a sensible time zone', () => {
  const plan = newPlan({
    id: 'abcdef',
    title: '  Planning call  ',
    tz: 'America/Chicago',
    days: ['2026-10-05', '2026-10-03', '2026-10-05'],
    start: 9,
    end: 17,
    slot: 30,
  });
  expect(plan.title).toBe('Planning call');
  expect(plan.days).toEqual(['2026-10-03', '2026-10-05']);
  expect(plan.people).toEqual([]);
  expect(cleanTimeZone('America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
  expect(cleanTimeZone('Etc/GMT+5')).toBe('Etc/GMT+5');
  expect(cleanTimeZone('UTC')).toBe('UTC');
  expect(cleanTimeZone(undefined)).toBe('UTC');
  expect(cleanTimeZone('../../etc')).toBe('UTC');
  expect(describeDays(['2026-10-03'])).toBe('Sat, Oct 3');
  expect(describeDays(['2026-10-02', '2026-10-03', '2026-10-04'])).toBe('Fri, Oct 2 – Sun, Oct 4');
  expect(describeDays(['2026-10-02', '2026-10-09'])).toBe('2 days, Oct 2 – Oct 9');
});

test('the example plan is valid and has an obvious best time', () => {
  const plan = samplePlan('2026-09-28', 'America/Chicago');
  expect(whenPlanSchema.safeParse(plan).success).toBe(true);
  expect(plan.days).toEqual(Array.from({ length: 7 }, (_, index) => addDays('2026-09-29', index)));
  const [first, second] = bestTimes(plan);
  expect(windowText(plan, first)).toBe('Sat, Oct 3 · 6–9 PM — everyone (5 of 5)');
  expect(second.count).toBe(4);
});

test('dates never drift with the device’s time zone', () => {
  const original = process.env.TZ;
  const zones = [
    'UTC',
    'America/Chicago',
    'America/Los_Angeles',
    'Europe/London',
    'Asia/Kolkata',
    'Australia/Lord_Howe',
    'Pacific/Kiritimati', // UTC+14
    'Pacific/Pago_Pago', // UTC−11
  ];
  try {
    for (const zone of zones) {
      process.env.TZ = zone;
      // Round trips, across daylight-saving switches, month ends, years and leap days.
      for (const day of [
        '2026-03-07',
        '2026-03-08',
        '2026-03-29',
        '2026-10-25',
        '2026-11-01',
        '2026-12-31',
        '2028-02-29',
      ])
        expect(dayFromNumber(dayNumber(day)), zone).toBe(day);
      expect(addDays('2026-03-07', 1), zone).toBe('2026-03-08');
      expect(addDays('2026-03-08', 1), zone).toBe('2026-03-09');
      expect(addDays('2026-10-31', 2), zone).toBe('2026-11-02');
      expect(addDays('2026-12-31', 1), zone).toBe('2027-01-01');
      expect(addDays('2028-02-28', 1), zone).toBe('2028-02-29');
      expect(addDays('2027-02-28', 1), zone).toBe('2027-03-01');
      expect(addDays('2026-10-04', -7), zone).toBe('2026-09-27');
      expect(weekdayOf('2026-10-03'), zone).toBe(6);
      expect(weekdayOf('2026-03-08'), zone).toBe(0);
      expect(formatDay('2026-10-03'), zone).toBe('Sat, Oct 3');
      expect(formatDay('2027-01-01'), zone).toBe('Fri, Jan 1');
      expect(Number.isNaN(dayNumber('2026-02-29')), zone).toBe(true);
      // Today comes from the device's own calendar, late at night and just after midnight.
      expect(localDay(new Date(2026, 9, 4, 23, 59)), zone).toBe('2026-10-04');
      expect(localDay(new Date(2026, 9, 4, 0, 1)), zone).toBe('2026-10-04');
      // October 2026 starts on a Thursday; February 2026 fills exactly four weeks.
      const october = monthWeeks({ year: 2026, month: 9 });
      expect(october[0], zone).toEqual([
        null,
        null,
        null,
        null,
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
      ]);
      expect(october.flat().filter(Boolean), zone).toHaveLength(31);
      expect(monthWeeks({ year: 2026, month: 1 }), zone).toHaveLength(4);
      expect(monthWeeks({ year: 2026, month: 1 })[0][0], zone).toBe('2026-02-01');
      // Quick picks from a Monday, a Saturday and a Sunday.
      const [week, thisWeekend, nextWeekend] = quickPicks('2026-09-28');
      expect(week.days[0], zone).toBe('2026-09-28');
      expect(week.days[6], zone).toBe('2026-10-04');
      expect(thisWeekend.days, zone).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
      expect(nextWeekend.days, zone).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
      expect(quickPicks('2026-10-03')[1].days, zone).toEqual(['2026-10-03', '2026-10-04']);
      expect(quickPicks('2026-10-04')[1].days, zone).toEqual(['2026-10-04']);
      expect(quickPicks('2026-10-04')[2].days[0], zone).toBe('2026-10-09');
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
  expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
  expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
});
