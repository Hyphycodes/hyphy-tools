import { expect, test } from '@playwright/test';
import {
  changeCurrentSession,
  currentOf,
  emptyGroup,
  forgetSession,
  keepSession,
  MAX_SESSIONS,
  nameMe,
  receiveSession,
} from '@/lib/share/group';
import { handoffFrom, leave, take, toolForPlan } from '@/lib/share/handoff';
import { directionsUrl, linkSource, placeFrom, placeKind } from '@/lib/tools/places';
import {
  addOption,
  castVote,
  editOption,
  MAX_OPTIONS,
  mergeWhere,
  newRound,
  pickOption,
  questionOf,
  removeOption,
  resultText,
  setDetails,
  tally,
  whereSchema,
  type WhereRound,
} from '@/lib/tools/where';

/* Where?: places as cards, votes that merge from any number of links, a result you can read. */

const T0 = 1_750_000_000_000;
const ana = { id: 'ana11', name: 'Ana' };
const ben = { id: 'ben22', name: 'Ben' };
const cy = { id: 'cy333', name: 'Cy' };
const place = (name: string, note = '') => ({ name, note, url: '' });

function dinner(): WhereRound {
  let round = setDetails(newRound('rnd1', T0), { kind: 'eat', when: 'Friday night' }, T0);
  round = addOption(round, place('Monteverde', 'Italian · West Loop'), 'mv', '', T0 + 1).round;
  round = addOption(round, place('Aba'), 'aba', '', T0 + 2).round;
  round = addOption(round, place('Tacos'), 'tac', '', T0 + 3).round;
  return round;
}

test.describe('places without a places service', () => {
  test('a typed name is the place', () => {
    expect(placeFrom('  Monteverde ')).toEqual({
      name: 'Monteverde',
      note: '',
      url: '',
      named: true,
    });
    expect(placeFrom('')).toBeNull();
  });

  test('pasted links name the place and keep the link', () => {
    const google = placeFrom(
      'https://www.google.com/maps/place/Monteverde+Restaurant+%26+Pastificio/@41.88,-87.65,17z',
    )!;
    expect(google.name).toBe('Monteverde Restaurant & Pastificio');
    expect(google.url).toContain('google.com/maps');
    expect(placeFrom('https://www.yelp.com/biz/aba-chicago-2')!.name).toBe('Aba Chicago');
    expect(placeFrom('https://www.opentable.com/r/girl-and-the-goat-chicago')!.name).toBe(
      'Girl and the Goat Chicago',
    );
    const resy = placeFrom('https://resy.com/cities/chicago-il/venues/monteverde')!;
    expect(resy).toMatchObject({ name: 'Monteverde', note: 'Chicago' });
    expect(placeFrom('https://maps.apple.com/?q=Aba&ll=41.8,-87.6')!.name).toBe('Aba');
    // A short link can't be read: named from the service, flagged to check.
    expect(placeFrom('https://maps.app.goo.gl/abc123')).toMatchObject({
      name: 'Google Maps',
      named: false,
    });
    expect(placeFrom('monteverdechicago.com')).toMatchObject({
      name: 'Monteverdechicago',
      named: false,
    });
  });

  test('kinds, sources and directions', () => {
    expect(placeKind('Monteverde', 'Italian')).toBe('food');
    expect(placeKind('Rooftop bar')).toBe('drinks');
    expect(placeKind('Café Rosa')).toBe('coffee');
    expect(placeKind('Bowling')).toBe('fun');
    expect(placeKind('Montrose Beach')).toBe('outdoors');
    expect(placeKind('Aba')).toBe('place');
    expect(linkSource('https://www.yelp.com/biz/aba')).toBe('Yelp');
    const maps = 'https://www.google.com/maps/place/Aba/@1,2';
    expect(directionsUrl({ name: 'Aba', note: '', url: maps })).toBe(maps);
    expect(directionsUrl({ name: 'Aba', note: 'Fulton Market', url: '' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Aba%20Fulton%20Market',
    );
  });
});

test.describe('a round of Where?', () => {
  test('asks the kind’s question until it’s given its own', () => {
    const round = dinner();
    expect(questionOf(round)).toBe('Where should we eat?');
    expect(questionOf(setDetails(round, { title: 'Birthday dinner?' }, T0 + 9))).toBe(
      'Birthday dinner?',
    );
  });

  test('places: no twins, a limit, edits re-read the kind', () => {
    const round = dinner();
    expect(addOption(round, place('monteverde'), 'x1', '', T0).reason).toBe('twin');
    let full = round;
    for (let index = 0; full.options.length < MAX_OPTIONS; index += 1)
      full = addOption(full, place(`Spot ${index}`), `s${index}`, '', T0).round;
    expect(addOption(full, place('One more'), 'x2', '', T0).reason).toBe('full');
    const edited = editOption(round, 'aba', { note: 'Mediterranean rooftop' }, T0 + 5);
    expect(edited.options.find((option) => option.id === 'aba')!.kind).toBe('food');
  });

  test('votes: love, works, no; the same vote again takes it back', () => {
    let round = dinner();
    round = castVote(round, ana, 'mv', 'love', T0 + 10);
    round = castVote(round, ana, 'aba', 'ok', T0 + 11);
    round = castVote(round, ben, 'mv', 'love', T0 + 12);
    round = castVote(round, ben, 'tac', 'no', T0 + 13);
    round = castVote(round, cy, 'aba', 'love', T0 + 14);
    let result = tally(round);
    expect(result.voters).toBe(3);
    expect(result.leader?.option.name).toBe('Monteverde');
    expect(result.leader).toMatchObject({ love: 2, yes: 2, points: 4 });
    expect(result.state).toBe('close');
    round = castVote(round, ana, 'aba', 'ok', T0 + 15);
    expect(round.votes[ana.id].picks.aba).toBeUndefined();
    result = tally(round);
    expect(result.state).toBe('clear');
  });

  test('a tie has no leader until someone settles it', () => {
    let round = dinner();
    round = castVote(round, ana, 'mv', 'love', T0 + 10);
    round = castVote(round, ben, 'aba', 'love', T0 + 11);
    expect(tally(round)).toMatchObject({ state: 'tie', leader: null });
    round = pickOption(round, 'aba', T0 + 12);
    expect(tally(round).leader?.option.name).toBe('Aba');
    expect(tally(pickOption(round, '', T0 + 13)).leader).toBeNull();
  });

  test('nobody voting means no result', () => {
    expect(tally(dinner())).toMatchObject({ state: 'none', leader: null, voters: 0 });
  });

  test('removing a place takes its votes and its pick with it', () => {
    let round = castVote(dinner(), ana, 'tac', 'love', T0 + 10);
    round = pickOption(round, 'tac', T0 + 11);
    round = removeOption(round, 'tac', T0 + 12);
    expect(round.options.map((option) => option.id)).toEqual(['mv', 'aba']);
    expect(round.votes[ana.id].picks).toEqual({});
    expect(round.pick).toBe('');
  });

  test('copies merge in any order: everyone’s votes, the newest vote per person', () => {
    const base = dinner();
    const fromAna = castVote(base, ana, 'mv', 'love', T0 + 20);
    const fromBen = castVote(
      addOption(base, place('Ramen'), 'ram', ben.id, T0 + 21).round,
      ben,
      'ram',
      'love',
      T0 + 22,
    );
    const anaChanged = castVote(
      castVote(fromAna, ana, 'mv', 'love', T0 + 30),
      ana,
      'aba',
      'ok',
      T0 + 31,
    );
    const one = mergeWhere(mergeWhere(fromAna, fromBen), anaChanged);
    const two = mergeWhere(anaChanged, mergeWhere(fromBen, fromAna));
    expect(one.votes).toEqual(two.votes);
    expect(one.options.map((option) => option.id).sort()).toEqual(['aba', 'mv', 'ram', 'tac']);
    // Ana's newer copy took her love for Monteverde back and said Aba works.
    expect(one.votes[ana.id].picks).toEqual({ aba: 'ok' });
    expect(one.votes[ben.id].picks).toEqual({ ram: 'love' });
    // An older link can't bring a removed place back.
    const removed = removeOption(one, 'ram', T0 + 40);
    expect(mergeWhere(removed, fromBen).options.some((option) => option.id === 'ram')).toBe(false);
  });

  test('a round survives its own schema, and text for the group chat', () => {
    const round = castVote(dinner(), ana, 'mv', 'love', T0 + 10);
    expect(whereSchema.safeParse(JSON.parse(JSON.stringify(round))).success).toBe(true);
    expect(resultText(round, tally(round), 'https://x.test/#z1')).toContain(
      'Where should we eat? → Monteverde',
    );
  });
});

test.describe('group sessions on a device', () => {
  type S = { id: string; n: number };
  const merge = (a: S, b: S) => ({ id: a.id, n: Math.max(a.n, b.n) });

  test('keeps sessions, merges a link into its copy, forgets on request', () => {
    let store = emptyGroup<S>();
    store = keepSession(store, { role: 'organizer', opened: T0, data: { id: 'a', n: 1 } });
    const first = receiveSession(store, { id: 'b', n: 5 }, merge, T0 + 1);
    expect(first.before).toBeNull();
    expect(currentOf(first.store)).toMatchObject({ role: 'guest', data: { id: 'b', n: 5 } });
    const again = receiveSession(first.store, { id: 'a', n: 3 }, merge, T0 + 2);
    expect(again.before).toEqual({ id: 'a', n: 1 });
    expect(currentOf(again.store)).toMatchObject({ role: 'organizer', data: { n: 3 } });
    const changed = changeCurrentSession(again.store, (data) => ({ ...data, n: 9 }));
    expect(currentOf(changed)!.data.n).toBe(9);
    const forgotten = forgetSession(changed, 'a');
    expect(forgotten.current).toBeNull();
    expect(forgotten.sessions.map((entry) => entry.data.id)).toEqual(['b']);
  });

  test('past the limit, guests’ oldest sessions go first', () => {
    let store = keepSession(emptyGroup<S>(), {
      role: 'organizer',
      opened: T0,
      data: { id: 'mine', n: 0 },
    });
    for (let index = 0; index < MAX_SESSIONS + 3; index += 1)
      store = keepSession(store, { role: 'guest', opened: T0, data: { id: `g${index}`, n: 0 } });
    expect(store.sessions).toHaveLength(MAX_SESSIONS);
    expect(store.sessions.some((entry) => entry.data.id === 'mine')).toBe(true);
    expect(store.sessions.some((entry) => entry.data.id === 'g0')).toBe(false);
  });

  test('naming a device keeps its id', () => {
    const named = nameMe(emptyGroup<S>(), '  Dana ', 'dev1');
    expect(named.me).toEqual({ id: 'dev1', name: 'Dana' });
    expect(nameMe(named, 'Dana W', 'other').me).toEqual({ id: 'dev1', name: 'Dana W' });
  });
});

test.describe('handoffs between Plan and the group tools', () => {
  test('a tool opened for a plan knows which one', () => {
    expect(toolForPlan('when', 'pl4n', 'Kamila’s Birthday')).toBe(
      '/tools/when?plan=pl4n&title=Kamila%E2%80%99s+Birthday',
    );
    expect(handoffFrom('?plan=pl4n&title=Kamila%E2%80%99s+Birthday')).toEqual({
      plan: 'pl4n',
      title: 'Kamila’s Birthday',
    });
    expect(handoffFrom('?plan=<script>')).toBeNull();
    expect(handoffFrom('')).toBeNull();
  });

  test('results wait for their plan and are taken once', () => {
    const attachment = { url: 'https://x.test/tools/where#z1', summary: 'Monteverde', t: T0 };
    const pending = leave(leave({}, 'p1', 'where', attachment), 'p2', 'when', {
      ...attachment,
      summary: 'Sat 7:30 PM',
    });
    const { waiting, rest } = take(pending, 'p1');
    expect(waiting.where?.summary).toBe('Monteverde');
    expect(Object.keys(rest)).toEqual(['p2']);
    expect(take(rest, 'p1').waiting).toEqual({});
  });
});
