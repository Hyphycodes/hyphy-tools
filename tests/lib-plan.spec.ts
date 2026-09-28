import { expect, test } from '@playwright/test';
import {
  addPeople,
  answer,
  attach,
  countdown,
  headcount,
  mergePlan,
  newPlan,
  peopleOf,
  planSchema,
  planText,
  quickDays,
  removePerson,
  setDetails,
  titleOf,
  whenLine,
  type Plan,
} from '@/lib/tools/plan';

/* Plan: a shared event card that merges answers from any number of links. */

const T0 = 1_750_000_000_000;
const jerry = { id: 'jerry1', name: 'Jerry' };
const kamila = { id: 'kam222', name: 'Kamila' };

function birthday(): Plan {
  let plan = setDetails(
    newPlan('plan1', T0),
    { kind: 'birthday', title: 'Kamila’s Birthday', date: '2026-10-17', time: 1170 },
    T0,
  );
  plan = answer(plan, jerry, 'in', T0 + 1, { host: true });
  plan = addPeople(
    plan,
    ['Kamila', 'Emauri', 'Sophia', 'kamila'],
    ['k1', 'e1', 's1', 'k2'],
    T0 + 2,
  ).plan;
  return plan;
}

test('a plan needs nothing but a name; the kind names it until then', () => {
  const plan = newPlan('p', T0, 'trip');
  expect(titleOf(plan)).toBe('Trip');
  expect(whenLine(plan)).toBe('');
  expect(planSchema.safeParse(plan).success).toBe(true);
});

test('the day reads like an invitation', () => {
  const plan = birthday();
  expect(whenLine(plan)).toBe('Saturday, October 17 · 7:30 PM');
  const trip = setDetails(plan, { date: '2026-10-16', end: '2026-10-18', time: -1 }, T0 + 5);
  expect(whenLine(trip)).toBe('Fri, Oct 16 – Sun, Oct 18');
  // An end before the start is dropped.
  expect(setDetails(plan, { end: '2026-10-01' }, T0 + 6).end).toBe('');
  expect(countdown('2026-10-17', '2026-09-28')).toBe('In 3 weeks');
  expect(countdown('2026-09-29', '2026-09-28')).toBe('Tomorrow');
  expect(countdown('2026-10-01', '2026-09-28')).toBe('In 3 days');
});

test('quick days start from today and never repeat', () => {
  // 2026-09-28 is a Monday.
  const picks = quickDays('2026-09-28');
  expect(picks.map((pick) => pick.label)).toEqual([
    'Today',
    'Tomorrow',
    'Friday',
    'Saturday',
    'Sunday',
    'Next Saturday',
  ]);
  expect(picks.find((pick) => pick.label === 'Saturday')?.date).toBe('2026-10-03');
  // On a Saturday, "Saturday" is today.
  expect(quickDays('2026-10-03').map((pick) => pick.label)).not.toContain('Saturday');
});

test('people: invited names, answers, "that’s me", the host first', () => {
  let plan = birthday();
  expect(peopleOf(plan).map((person) => person.name)).toEqual([
    'Jerry',
    'Kamila',
    'Emauri',
    'Sophia',
  ]);
  plan = answer(plan, kamila, 'in', T0 + 10, { invite: 'k1' });
  plan = answer(plan, { id: 'emo', name: 'Emauri' }, 'maybe', T0 + 11, { invite: 'e1' });
  expect(peopleOf(plan).map((person) => `${person.name}:${person.rsvp}`)).toEqual([
    'Jerry:in',
    'Kamila:in',
    'Emauri:maybe',
    'Sophia:invited',
  ]);
  expect(headcount(plan)).toMatchObject({ in: 2, maybe: 1, invited: 1, out: 0, total: 4 });
  plan = removePerson(plan, 's1', T0 + 12);
  expect(headcount(plan).total).toBe(3);
});

test('copies merge: everyone’s answers, the newest details, the newest attachments', () => {
  const base = birthday();
  const fromKamila = answer(base, kamila, 'in', T0 + 20, { invite: 'k1' });
  const fromSophia = answer(base, { id: 'soph', name: 'Sophia' }, 'out', T0 + 21, { invite: 's1' });
  const moved = setDetails(base, { time: 1200 }, T0 + 22);
  const one = mergePlan(mergePlan(fromKamila, fromSophia), moved);
  const two = mergePlan(moved, mergePlan(fromSophia, fromKamila));
  expect(one.people).toEqual(two.people);
  expect(one.time).toBe(1200);
  expect(peopleOf(one).map((person) => `${person.name}:${person.rsvp}`)).toEqual([
    'Jerry:in',
    'Kamila:in',
    'Emauri:invited',
    'Sophia:out',
  ]);
});

test('a connected tool brings its place or its day with it', () => {
  const plan = birthday();
  const withPlace = attach(
    plan,
    'where',
    {
      url: 'https://x.test/tools/where#z',
      summary: 'Monteverde',
      t: T0 + 30,
      place: { name: 'Monteverde', note: 'Italian', url: '' },
    },
    T0 + 30,
  );
  expect(withPlace.place?.name).toBe('Monteverde');
  expect(withPlace.links.where?.summary).toBe('Monteverde');
  const withTime = attach(
    withPlace,
    'when',
    {
      url: 'https://x.test/tools/when#z',
      summary: 'Fri',
      t: T0 + 31,
      date: '2026-10-16',
      time: 1140,
    },
    T0 + 31,
  );
  expect(whenLine(withTime)).toBe('Friday, October 16 · 7 PM');
  const newer = mergePlan(
    withTime,
    attach(plan, 'bring', { url: 'u', summary: '3 things still needed', t: T0 + 40 }, T0 + 40),
  );
  expect(Object.keys(newer.links).sort()).toEqual(['bring', 'when', 'where']);
  expect(planText(withTime, 'https://x.test/p')).toContain('Are you in? https://x.test/p');
});
