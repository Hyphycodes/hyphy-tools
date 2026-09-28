import { expect, test } from '@playwright/test';
import {
  claim,
  claimChanges,
  holder,
  unclaim,
  updateClaim,
  type Claimer,
} from '@/lib/tools/claims';
import {
  addWish,
  answerGate,
  checkDraft,
  domainOf,
  editWish,
  EMPTY_DRAFT,
  EMPTY_GIVEN,
  giftListSchema,
  giftProgress,
  isWebUrl,
  MAX_ITEMS,
  mergeGift,
  mergeOwn,
  moveWish,
  newWishList,
  readUrl,
  receiveGift,
  removeWish,
  restoreWish,
  sampleList,
  setWishDetails,
  titleOf,
  toGift,
  wishListSchema,
  wishText,
  withoutClaims,
  type GiftList,
  type WishList,
} from '@/lib/tools/wishlist';

/* Christmas List: links are checked, gifts are claimed once, and the owner never sees claims. */

const T0 = 1_760_000_000_000;
const sam: Claimer = { id: 'sam22', name: 'Sam' };
const aunt: Claimer = { id: 'aunt7', name: '' };
const ids = ['socks', 'kettle', 'book', 'planter', 'beanie', 'tickets'];

const sample = (): WishList => sampleList('maya1', ids, T0);

test('only web links get onto a list', () => {
  expect(isWebUrl('https://kettleandco.example/gooseneck')).toBe(true);
  expect(isWebUrl('http://shop.example')).toBe(true);
  expect(isWebUrl('javascript:alert(1)')).toBe(false);
  expect(isWebUrl('JavaScript:alert(1)')).toBe(false);
  expect(isWebUrl('data:text/html,<b>hi</b>')).toBe(false);
  expect(isWebUrl('https://shop.example@phish.example/')).toBe(false);
  expect(isWebUrl('https://user:pass@shop.example/')).toBe(false);
  expect(isWebUrl('https://shop.example/a b')).toBe(false);
  expect(isWebUrl('https://shop.example/\n')).toBe(false);
  expect(isWebUrl(`https://shop.example/${'a'.repeat(600)}`)).toBe(false);

  expect(readUrl('shop.example/socks')).toEqual({ url: 'https://shop.example/socks' });
  expect(readUrl('  https://www.shop.example/a?b=1  ')).toEqual({
    url: 'https://www.shop.example/a?b=1',
  });
  expect(readUrl('')).toEqual({ url: '' });
  expect('error' in readUrl('javascript:alert(1)')).toBe(true);
  expect('error' in readUrl('mailto:someone@shop.example')).toBe(true);
  expect('error' in readUrl('not a link')).toBe(true);
  // A long tracking tail is trimmed rather than refused.
  const long = readUrl(`https://shop.example/item/42?ref=${'x'.repeat(700)}`);
  expect(long).toEqual({ url: 'https://shop.example/item/42' });

  expect(domainOf('https://www.kettleandco.example/gooseneck?x=1')).toBe('kettleandco.example');
  expect(domainOf('nonsense')).toBe('');
});

test('a gift-giver link can’t smuggle in anything odd', () => {
  const gift = toGift(sample());
  expect(giftListSchema.safeParse(gift).success).toBe(true);
  expect(giftListSchema.safeParse({ ...gift, v: 2 }).success).toBe(false);
  const bad = { ...gift, items: [{ ...gift.items[0], url: 'javascript:alert(document.cookie)' }] };
  expect(giftListSchema.safeParse(bad).success).toBe(false);
  const data = {
    ...gift,
    items: [{ ...gift.items[0], url: 'data:text/html;base64,PHNjcmlwdD4=' }],
  };
  expect(giftListSchema.safeParse(data).success).toBe(false);
  const tooMany = Array.from({ length: MAX_ITEMS + 1 }, (_, index) => ({
    ...gift.items[0],
    id: `w${index}`,
  }));
  expect(giftListSchema.safeParse({ ...gift, items: tooMany }).success).toBe(false);
  expect(giftListSchema.safeParse({ ...gift, currency: 'XYZ' }).success).toBe(false);
  expect(giftListSchema.safeParse({ ...gift, occasion: 'anniversary' }).success).toBe(false);
  expect(
    giftListSchema.safeParse({ ...gift, items: [{ ...gift.items[0], price: -100 }] }).success,
  ).toBe(false);
  // The owner's own list has no room for claims: they're dropped on the way in.
  const parsed = wishListSchema.parse({ ...gift, claims: { socks: [] } });
  expect('claims' in parsed).toBe(false);
});

test('the form checks what it needs and nothing more', () => {
  expect(checkDraft({ ...EMPTY_DRAFT }).errors.name).toBeTruthy();
  expect(
    checkDraft({ ...EMPTY_DRAFT, name: 'Socks', url: 'javascript:x' }).errors.url,
  ).toBeTruthy();
  const { wish } = checkDraft({
    ...EMPTY_DRAFT,
    name: '  Socks  ',
    url: 'shop.example/socks',
    price: 2400.4,
    note: ' Size M ',
    want: 'love',
  });
  expect(wish).toEqual({
    name: 'Socks',
    url: 'https://shop.example/socks',
    price: 2400,
    note: 'Size M',
    want: 'love',
  });
  expect(checkDraft({ ...EMPTY_DRAFT, name: 'Yacht', price: 1e15 }).wish?.price).toBe(100_000_000);
});

test('the owner edits: add, change, move, remove and undo', () => {
  let list = newWishList('mine1', T0);
  list = setWishDetails(list, { who: 'Maya' }, T0 + 1);
  expect(titleOf(list)).toBe('Maya’s list');
  const wish = checkDraft({ ...EMPTY_DRAFT, name: 'Socks' }).wish!;
  list = addWish(list, wish, 'socks', T0 + 2);
  list = addWish(list, { ...wish, name: 'Kettle' }, 'kettle', T0 + 3);
  // An id already used (or removed) isn't reused.
  expect(addWish(list, wish, 'socks', T0 + 4)).toBe(list);
  list = editWish(list, 'socks', { ...wish, name: 'Wool socks', want: 'love' }, T0 + 5);
  list = moveWish(list, 'kettle', -1, T0 + 6);
  expect(list.items.map((item) => item.name)).toEqual(['Kettle', 'Wool socks']);
  const { list: removed, removal } = removeWish(list, 'kettle', T0 + 7);
  expect(removed.items).toHaveLength(1);
  expect(restoreWish(removed, removal!, T0 + 8).items.map((item) => item.id)).toEqual([
    'kettle',
    'socks',
  ]);
  expect(wishListSchema.safeParse(list).success).toBe(true);
});

test('gift-givers claim once; only the claimer can unclaim or mark it bought', () => {
  const gift = toGift(sample());
  let claims = claim(gift.claims, 'kettle', sam, T0 + 10);
  expect(claim(claims, 'kettle', aunt, T0 + 11)).toBe(claims);
  expect(unclaim(claims, 'kettle', aunt.id, T0 + 12)).toBe(claims);
  expect(updateClaim(claims, 'kettle', aunt.id, { got: true }, T0 + 13)).toBe(claims);
  claims = updateClaim(claims, 'kettle', sam.id, { got: true }, T0 + 14);
  expect(holder(claims.kettle)?.got).toBe(true);
  // An anonymous giver's claim has no name: the view says "Someone".
  claims = claim(claims, 'socks', aunt, T0 + 15);
  expect(holder(claims.socks)?.name).toBe('');
  expect(giftProgress({ ...gift, claims })).toEqual({ total: 6, claimed: 2, bought: 1, open: 4 });
  claims = unclaim(claims, 'kettle', sam.id, T0 + 16);
  expect(holder(claims.kettle)).toBeNull();
});

test('the owner’s re-shared link brings edits in, and givers’ claims survive by item', () => {
  const original = sample();
  // A giver claims the kettle on the first link.
  const giverCopy: GiftList = {
    ...toGift(original),
    claims: claim({}, 'kettle', sam, T0 + 100),
  };
  // Meanwhile the owner edits: renames the kettle, drops the beanie, adds a scarf.
  let edited = editWish(
    original,
    'kettle',
    { ...original.items[1], name: 'Gooseneck kettle (black)' },
    T0 + 200,
  );
  edited = removeWish(edited, 'beanie', T0 + 210).list;
  edited = addWish(edited, { ...original.items[4], name: 'Scarf' }, 'scarf', T0 + 220);

  // The giver opens the owner's new link on the same device.
  const merged = mergeGift(giverCopy, toGift(edited));
  expect(merged.items.find((item) => item.id === 'kettle')?.name).toBe('Gooseneck kettle (black)');
  expect(merged.items.some((item) => item.id === 'beanie')).toBe(false);
  expect(merged.items.at(-1)?.name).toBe('Scarf');
  expect(holder(merged.claims.kettle)?.name).toBe('Sam');
  expect(merged).toEqual(mergeGift(toGift(edited), giverCopy));

  // Two givers claim the same gift on different copies: the earlier one keeps it.
  const auntCopy: GiftList = { ...toGift(original), claims: claim({}, 'kettle', aunt, T0 + 50) };
  const both = mergeGift(merged, auntCopy);
  expect(holder(both.claims.kettle)?.by).toBe(aunt.id);
  // Sam's device learns its claim didn't hold.
  expect(claimChanges(merged.claims, both.claims, sam.id).lost).toEqual([
    { itemId: 'kettle', takenBy: 'Someone' },
  ]);
});

test('the owner never takes claims in, even from their own list’s link', () => {
  const own = sample();
  const incoming: GiftList = {
    ...toGift(editWish(own, 'socks', { ...own.items[0], note: 'Size L now' }, T0 + 5)),
    claims: claim({}, 'socks', sam, T0 + 6),
  };
  const merged = mergeOwn(own, incoming);
  expect('claims' in merged).toBe(false);
  expect(merged.items[0].note).toBe('Size L now');
  expect(withoutClaims(incoming)).not.toHaveProperty('claims');
});

test('this device remembers the answer at the gate', () => {
  const incoming: GiftList = { ...toGift(sample()), claims: claim({}, 'socks', sam, T0 + 1) };
  const first = receiveGift(EMPTY_GIVEN, incoming, T0 + 2);
  expect(first.role).toBe('ask');
  expect(first.before).toBeNull();
  // "It's my list": claims kept on this device are dropped, and stay dropped.
  const owner = answerGate(first.store, incoming.id, 'owner');
  expect(owner.lists[0].list.claims).toEqual({});
  const again = receiveGift(owner, incoming, T0 + 3);
  expect(again.role).toBe('owner');
  expect(again.list.claims).toEqual({});
  // A gift-giver keeps them, and later links merge in.
  const giver = answerGate(first.store, incoming.id, 'giver');
  const later: GiftList = { ...incoming, claims: claim(incoming.claims, 'book', aunt, T0 + 4) };
  const merged = receiveGift(giver, later, T0 + 5);
  expect(merged.role).toBe('giver');
  expect(Object.keys(merged.list.claims).sort()).toEqual(['book', 'socks']);
});

test('the list as text has no claims in it', () => {
  const text = wishText(sample());
  expect(text).toContain('Maya’s list · Christmas');
  expect(text).toContain('1. Merino hiking socks — $24.00 — Love it');
  expect(text).toContain('Size M. Any color but white.');
  expect(text).toContain('https://kettleandco.example/gooseneck');
  expect(text).toContain('3. A paperback you loved this year — Like it');
  expect(text).not.toMatch(/claim/i);
});
