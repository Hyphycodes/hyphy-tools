import { expect, test } from '@playwright/test';
import {
  addPeople,
  drawNames,
  drawProblem,
  EMPTY_STORE,
  exchangeSchema,
  keepSlip,
  newExchange,
  parseNames,
  removePerson,
  slipFor,
  slipMessage,
  slipSchema,
  togglePair,
  validDraw,
  type Exchange,
} from '@/lib/tools/secret-santa';

/* Secret Santa: names in, a fair private draw out, and slips that carry one match each. */

const T0 = 1_750_000_000_000;

/** A seeded random, so every draw in a test is repeatable. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function crew(names = ['Jerry', 'Kamila', 'Emauri', 'Sophia', 'Dana', 'Luis']): Exchange {
  return addPeople(
    newExchange('ex1', T0),
    names,
    names.map((_, index) => `p${index}`),
    T0,
  ).exchange;
}

test('names come in any way people type them', () => {
  expect(parseNames('Jerry, Kamila and Emauri\nSophia & Dana; 1. Luis')).toEqual([
    'Jerry',
    'Kamila',
    'Emauri',
    'Sophia',
    'Dana',
    'Luis',
  ]);
  const exchange = crew();
  expect(addPeople(exchange, ['jerry', 'Rosa'], ['x1', 'x2'], T0).added).toBe(1);
});

test('a draw needs three people and a way around every exclusion', () => {
  expect(drawProblem(crew(['Jerry', 'Kamila']))).toEqual({ kind: 'few' });
  let small = crew(['Jerry', 'Kamila', 'Emauri']);
  small = togglePair(small, 'p0', 'p1', T0);
  small = togglePair(small, 'p0', 'p2', T0);
  expect(drawProblem(small)).toEqual({ kind: 'stuck', name: 'Jerry' });
  // Three people with one couple kept apart: no valid draw exists.
  const couple = togglePair(crew(['Jerry', 'Kamila', 'Emauri']), 'p0', 'p1', T0);
  expect(drawNames(couple, seeded(1))).toBeNull();
});

test('every draw is valid: nobody draws themselves or someone they’re kept from', () => {
  let exchange = crew();
  exchange = togglePair(exchange, 'p0', 'p1', T0); // Jerry ↔ Kamila
  exchange = togglePair(exchange, 'p4', 'p5', T0); // Dana ↔ Luis
  for (let seed = 1; seed <= 200; seed += 1) {
    const match = drawNames(exchange, seeded(seed));
    expect(match, `seed ${seed}`).not.toBeNull();
    expect(validDraw(exchange, match!), `seed ${seed}`).toBe(true);
    // With four or more, nobody simply swaps.
    for (const [giver, receiver] of Object.entries(match!))
      expect(match![receiver]).not.toBe(giver);
  }
});

test('draws vary', () => {
  const exchange = crew();
  const seen = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1)
    seen.add(JSON.stringify(drawNames(exchange, seeded(seed))));
  expect(seen.size).toBeGreaterThan(10);
});

test('changing people or pairs undoes a draw', () => {
  const exchange = crew();
  const drawn = { ...exchange, drawn: { at: T0, match: drawNames(exchange, seeded(3))! } };
  expect(removePerson(drawn, 'p5', T0).drawn).toBeNull();
  expect(togglePair(drawn, 'p0', 'p2', T0).drawn).toBeNull();
  expect(addPeople(drawn, ['Rosa'], ['p9'], T0).exchange.drawn).toBeNull();
  expect(togglePair(togglePair(exchange, 'p0', 'p2', T0), 'p2', 'p0', T0).pairs).toEqual([]);
});

test('a slip carries one match and nothing about anyone else', () => {
  const base = { ...crew(), title: 'Office party', budget: 50, host: 'p0', note: 'No gift cards' };
  const exchange: Exchange = { ...base, drawn: { at: T0, match: drawNames(base, seeded(7))! } };
  expect(exchangeSchema.safeParse(exchange).success).toBe(true);
  const slip = slipFor(exchange, 'p1')!;
  expect(slipSchema.safeParse(slip).success).toBe(true);
  expect(slip).toMatchObject({ for: 'Kamila', title: 'Office party', budget: 50, host: 'Jerry' });
  const receiver = exchange.people.find((person) => person.id === exchange.drawn!.match.p1)!;
  expect(slip.to).toBe(receiver.name);
  const others = exchange.people
    .map((person) => person.name)
    .filter((name) => name !== 'Kamila' && name !== receiver.name && name !== 'Jerry');
  const text = JSON.stringify(slip);
  for (const name of others) expect(text).not.toContain(name);
  expect(slipMessage(exchange, 'Kamila', 'https://x.test/#z')).not.toContain(receiver.name);
  const kept = keepSlip(keepSlip(EMPTY_STORE, slip), slip);
  expect(kept.slips).toHaveLength(1);
});
