import { expect, test } from '@playwright/test';
import {
  addItems,
  applyTemplate,
  bringListSchema,
  bringText,
  EMPTY_STORE,
  editItem,
  groups,
  guessCategory,
  keep,
  MAX_ITEMS,
  MAX_SAVED,
  mergeBring,
  moveItem,
  newList,
  parseLine,
  parseLines,
  progress,
  receive,
  removeItem,
  restoreItem,
  setDetails,
  TEMPLATES,
  type BringList,
} from '@/lib/tools/bring';
import { claim, holder, unclaim, type Claimer } from '@/lib/tools/claims';

/* Bring: a supply list that lives in its link, and copies of it that merge without losing anyone. */

const T0 = 1_750_000_000_000;
const dana: Claimer = { id: 'dana1', name: 'Dana' };
const sam: Claimer = { id: 'sam22', name: 'Sam' };

let counter = 0;
const ids = (count: number) => Array.from({ length: count }, () => `i${(counter += 1)}`);

/** A small cookout list: burgers, ice, napkins. */
function cookout(): BringList {
  const list = setDetails(newList('cook0ut', T0), { title: 'Cookout', where: 'Lakeside Park' }, T0);
  return addItems(
    list,
    [{ name: 'Burgers', qty: '12' }, { name: 'Ice', qty: '2 bags' }, { name: 'Napkins' }],
    ['burg', 'ice', 'nap'],
    T0,
  ).list;
}

test('a shared link can’t smuggle in anything odd', () => {
  const list = cookout();
  expect(bringListSchema.safeParse(list).success).toBe(true);
  // Wrong version.
  expect(bringListSchema.safeParse({ ...list, v: 2 }).success).toBe(false);
  // Too many items.
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, index) => ({
    ...list.items[0],
    id: `x${index}`,
  }));
  expect(bringListSchema.safeParse({ ...list, items: many }).success).toBe(false);
  // The same id twice.
  expect(
    bringListSchema.safeParse({ ...list, items: [list.items[0], list.items[0]] }).success,
  ).toBe(false);
  // Ids outside the alphabet are refused; prototype tricks are dropped.
  expect(bringListSchema.safeParse({ ...list, id: '../x' }).success).toBe(false);
  expect(bringListSchema.safeParse({ ...list, claims: { 'Not-An-Id': [] } }).success).toBe(false);
  const sneaky = bringListSchema.safeParse(
    JSON.parse(JSON.stringify(list).replace('"claims":{}', '"claims":{"__proto__":[]}')),
  );
  if (sneaky.success) {
    expect(Object.getPrototypeOf(sneaky.data.claims)).toBe(Object.prototype);
    expect(Object.keys(sneaky.data.claims)).toEqual([]);
  }
  // Overlong text.
  expect(bringListSchema.safeParse({ ...list, title: 'x'.repeat(81) }).success).toBe(false);
  // A claim with a made-up shape.
  expect(
    bringListSchema.safeParse({ ...list, claims: { burg: [{ by: 'dana1', name: 'Dana' }] } })
      .success,
  ).toBe(false);
  // Unknown categories.
  expect(
    bringListSchema.safeParse({ ...list, items: [{ ...list.items[0], cat: 'weapons' }] }).success,
  ).toBe(false);
});

test('fast entry reads amounts the way people type them', () => {
  expect(parseLine('Ice (2 bags)')).toEqual({ name: 'Ice', qty: '2 bags' });
  expect(parseLine('- Burgers - 12')).toEqual({ name: 'Burgers', qty: '12' });
  expect(parseLine('Chips: 3 bags')).toEqual({ name: 'Chips', qty: '3 bags' });
  expect(parseLine('• Hot dog buns x2')).toEqual({ name: 'Hot dog buns', qty: '2' });
  expect(parseLine('1. Napkins')).toEqual({ name: 'Napkins', qty: '' });
  expect(parseLine('[ ] Speaker')).toEqual({ name: 'Speaker', qty: '' });
  expect(parseLine('Chips & salsa')).toEqual({ name: 'Chips & salsa', qty: '' });
  expect(parseLine('12 burgers')).toEqual({ name: '12 burgers', qty: '' });
  expect(parseLine('   ')).toBeNull();
  expect(parseLines('Burgers\n\nIce (2 bags)\r\n  \nPlates')).toHaveLength(3);
});

test('categories are guessed, and can be wrong only in harmless ways', () => {
  expect(guessCategory('Sparkling water')).toBe('drinks');
  expect(guessCategory('Ice')).toBe('drinks');
  expect(guessCategory('Ice cream')).toBe('food');
  expect(guessCategory('Watermelon')).toBe('food');
  expect(guessCategory('Paper plates')).toBe('supplies');
  expect(guessCategory('Trash bags')).toBe('supplies');
  expect(guessCategory('Bluetooth speaker')).toBe('other');
  expect(guessCategory('Hot dog buns')).toBe('food');
  expect(guessCategory('Something mysterious')).toBe('other');
});

test('adding stops at the limit and says how many didn’t fit', () => {
  const full = addItems(
    newList('big', T0),
    Array.from({ length: MAX_ITEMS + 5 }, (_, index) => ({ name: `Thing ${index}` })),
    ids(MAX_ITEMS + 5),
    T0,
  );
  expect(full.added).toBe(MAX_ITEMS);
  expect(full.left).toBe(5);
  expect(full.list.items).toHaveLength(MAX_ITEMS);
  expect(bringListSchema.safeParse(full.list).success).toBe(true);
  // Blank names aren't items.
  expect(addItems(newList('b', T0), [{ name: '  ' }], ids(1), T0).added).toBe(0);
});

test('templates add generic items, skip what’s there, and name an unnamed list', () => {
  const cookoutTemplate = TEMPLATES.find((template) => template.id === 'cookout')!;
  const fresh = applyTemplate(newList('t', T0), 'cookout', ids(40), T0);
  expect(fresh.added).toBe(cookoutTemplate.items.length);
  expect(fresh.list.title).toBe('Cookout');
  expect(fresh.list.items.find((item) => item.name === 'Ice')?.cat).toBe('drinks');
  const again = applyTemplate(fresh.list, 'cookout', ids(40), T0 + 1);
  expect(again.added).toBe(0);
  const named = applyTemplate(cookout(), 'potluck', ids(40), T0);
  expect(named.list.title).toBe('Cookout');
  expect(named.list.items.filter((item) => item.name === 'Ice')).toHaveLength(1);
  for (const template of TEMPLATES) {
    expect(applyTemplate(newList('t', T0), template.id, ids(40), T0).added).toBeGreaterThan(8);
  }
});

test('claims: earliest wins, and only the claimer can let go', () => {
  let list = cookout();
  list = { ...list, claims: claim(list.claims, 'burg', dana, T0 + 10) };
  // Someone else can't claim a held item, or release it.
  expect(claim(list.claims, 'burg', sam, T0 + 20)).toBe(list.claims);
  expect(unclaim(list.claims, 'burg', sam.id, T0 + 30)).toBe(list.claims);
  expect(holder(list.claims.burg)?.name).toBe('Dana');
  // Dana can.
  const released = unclaim(list.claims, 'burg', dana.id, T0 + 40);
  expect(holder(released.burg)).toBeNull();
  // Then Sam can claim it.
  expect(holder(claim(released, 'burg', sam, T0 + 50).burg)?.name).toBe('Sam');
});

test('merging copies: items join, later edits win, earliest claim holds', () => {
  const base = cookout();
  // The organizer renames the burgers and adds cups.
  const organizer = addItems(
    editItem(base, 'burg', { name: 'Veggie burgers' }, T0 + 100),
    [{ name: 'Cups' }],
    ['cups'],
    T0 + 110,
  ).list;
  // Dana (on the old link) claims ice; Sam (also on the old link) claims ice a bit later.
  const fromDana = { ...base, claims: claim(base.claims, 'ice', dana, T0 + 200) };
  const fromSam = { ...base, claims: claim(base.claims, 'ice', sam, T0 + 300) };

  const merged = mergeBring(mergeBring(organizer, fromSam), fromDana);
  expect(merged.items.map((item) => item.name)).toEqual([
    'Veggie burgers',
    'Ice',
    'Napkins',
    'Cups',
  ]);
  expect(holder(merged.claims.ice)?.name).toBe('Dana');
  expect(merged.title).toBe('Cookout');

  // Order doesn't matter, and merging again changes nothing.
  const other = mergeBring(fromDana, mergeBring(fromSam, organizer));
  expect(other).toEqual(merged);
  expect(mergeBring(merged, merged)).toEqual(merged);
  expect(mergeBring(merged, fromSam)).toEqual(merged);
  expect(bringListSchema.safeParse(merged).success).toBe(true);
});

test('an older link can’t undo an unclaim or bring back a removed item', () => {
  const base = cookout();
  const claimed = { ...base, claims: claim(base.claims, 'burg', dana, T0 + 10) };
  const unclaimed = { ...claimed, claims: unclaim(claimed.claims, 'burg', dana.id, T0 + 20) };
  expect(holder(mergeBring(unclaimed, claimed).claims.burg)).toBeNull();
  expect(holder(mergeBring(claimed, unclaimed).claims.burg)).toBeNull();

  const { list: without } = removeItem(claimed, 'nap', T0 + 30);
  const merged = mergeBring(claimed, without);
  expect(merged.items.map((item) => item.id)).toEqual(['burg', 'ice']);
  // A claim on a removed item goes with it.
  const { list: noBurgers } = removeItem(base, 'burg', T0 + 40);
  expect(mergeBring(noBurgers, claimed).claims.burg).toBeUndefined();
});

test('undoing a removal puts the item and its claim back where they were', () => {
  const claimed = cookout();
  claimed.claims = claim(claimed.claims, 'ice', dana, T0 + 5);
  const { list, removal } = removeItem(claimed, 'ice', T0 + 10);
  expect(list.items.map((item) => item.id)).toEqual(['burg', 'nap']);
  const restored = restoreItem(list, removal!, T0 + 20);
  expect(restored.items.map((item) => item.id)).toEqual(['burg', 'ice', 'nap']);
  expect(restored.removed).not.toContain('ice');
  expect(holder(restored.claims.ice)?.name).toBe('Dana');
});

test('the organizer’s order and details come from the copy changed last', () => {
  const base = cookout();
  const moved = moveItem(base, 'nap', -1, T0 + 50);
  expect(moved.items.map((item) => item.id)).toEqual(['burg', 'nap', 'ice']);
  const renamed = setDetails(moved, { when: 'Saturday, 2pm' }, T0 + 60);
  const merged = mergeBring(base, renamed);
  expect(merged.items.map((item) => item.id)).toEqual(['burg', 'nap', 'ice']);
  expect(merged.when).toBe('Saturday, 2pm');
  // A device whose clock runs behind still moves the list forward.
  const behind = setDetails(renamed, { title: 'Cookout 2' }, T0 - 99_999);
  expect(behind.edited).toBeGreaterThan(renamed.edited);
  expect(mergeBring(renamed, behind).title).toBe('Cookout 2');
});

test('opening a link on this device merges it into what’s kept here', () => {
  const base = cookout();
  let store = keep(EMPTY_STORE, { role: 'organizer', opened: T0, list: base });
  // Dana's link comes back with her claim.
  const fromDana = { ...base, claims: claim(base.claims, 'burg', dana, T0 + 10) };
  const opened = receive(store, fromDana, T0 + 20);
  store = opened.store;
  expect(store.lists[0].role).toBe('organizer');
  expect(opened.before).toEqual(base);
  expect(holder(store.lists[0].list.claims.burg)?.name).toBe('Dana');
  // A list never seen before is kept as one you're a guest on.
  const elsewhere = receive(store, newList('another1', T0), T0 + 30);
  expect(elsewhere.store.lists[0].role).toBe('guest');
  expect(elsewhere.store.current).toBe('another1');
  expect(elsewhere.before).toBeNull();
  // Past the limit, guest lists go before the ones you organize.
  let crowded = elsewhere.store;
  for (let index = 0; index < MAX_SAVED + 3; index += 1)
    crowded = receive(crowded, newList(`guest${index}`, T0), T0 + 40 + index).store;
  expect(crowded.lists).toHaveLength(MAX_SAVED);
  expect(crowded.lists.some((entry) => entry.list.id === base.id)).toBe(true);
});

test('progress and groups put what’s still needed first', () => {
  const list = cookout();
  list.claims = claim(list.claims, 'burg', dana, T0 + 1);
  expect(progress(list)).toEqual({ total: 3, claimed: 1, needed: 2 });
  const { needed, covered } = groups(list);
  expect(needed.map((group) => group.cat)).toEqual(['drinks', 'supplies']);
  expect(covered.map((group) => group.items[0].name)).toEqual(['Burgers']);
});

test('the group-chat text says who’s bringing what', () => {
  const list = cookout();
  list.claims = claim(list.claims, 'burg', dana, T0 + 1);
  const text = bringText(list, 'https://tools.example/bring#zabc');
  expect(text).toContain('Cookout');
  expect(text).toContain('Lakeside Park');
  expect(text).toContain('1 of 3 claimed');
  expect(text).toContain('✓ Burgers (12) — Dana');
  expect(text).toContain('○ Ice (2 bags) — still needed');
  expect(text).toContain('○ Napkins — still needed');
  expect(text.indexOf('○ Ice')).toBeLessThan(text.indexOf('✓ Burgers'));
  expect(text).toContain('Claim something: https://tools.example/bring#zabc');
  expect(bringText(newList('e', T0))).toContain('0 of 0 claimed');
});
