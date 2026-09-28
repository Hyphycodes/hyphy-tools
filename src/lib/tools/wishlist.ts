import { z } from 'zod';
import {
  bump,
  claimerSchema,
  claimsSchema,
  distinctIds,
  holder,
  idSchema,
  MAX_REMOVED,
  mergeClaims,
  mergeEntries,
  moveEntry,
  stampSchema,
} from './claims';
import { CURRENCIES, formatMoney } from './split';

/*
 * Christmas List: a wish list with links, prices and notes. The owner keeps the list in their
 * browser and shares a gift-giver link: the list plus a map of claims. Gift-givers claim in
 * their copies of the link and pass it along; copies merge by the rules in ./claims. The owner's
 * own list has no claims in it at all, so the owner's view can't spoil anything.
 * Pure and tested (tests/lib-wishlist.spec.ts).
 */

export const MAX_ITEMS = 60;
/** Lists opened from gift-giver links, kept on one device. */
export const MAX_SAVED = 12;
/** Long enough for a product page, short enough that 60 of them still fit in a link. */
export const MAX_URL = 500;
/** 1,000,000.00 in cents. */
export const MAX_PRICE = 100_000_000;

export const OCCASIONS = ['christmas', 'birthday', 'wedding', 'baby', 'other'] as const;
export type Occasion = (typeof OCCASIONS)[number];
export const OCCASION_NAMES: Record<Occasion, string> = {
  christmas: 'Christmas',
  birthday: 'Birthday',
  wedding: 'Wedding',
  baby: 'Baby',
  other: 'Other',
};

export const WANTS = ['love', 'like', 'nice'] as const;
export type Want = (typeof WANTS)[number];
export const WANT_NAMES: Record<Want, string> = {
  love: 'Love it',
  like: 'Like it',
  nice: 'Nice to have',
};

/* ---------------- links ---------------- */

/**
 * A web address a gift link may point to: http or https, no hidden sign-in details
 * ("https://shop@elsewhere"), no spaces or control characters.
 */
export function isWebUrl(text: string) {
  if (text.length > MAX_URL || !/^https?:\/\//i.test(text)) return false;
  // Whitespace and control characters have no business in a stored link.
  if (/\s/.test(text) || [...text].some((char) => char < ' ' || char === '\x7f')) return false;
  try {
    const url = new URL(text);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/**
 * What someone pasted → a link to store. "shop.example/socks" becomes https://shop.example/socks;
 * a link too long to fit loses its tracking tail (?… and #…) before it's refused.
 */
export function readUrl(input: string): { url: string } | { error: string } {
  const text = input.trim();
  if (!text) return { url: '' };
  const candidate =
    !/^https?:\/\//i.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(text)
      ? `https://${text}`
      : text;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'That doesn’t look like a web link. Paste one that starts with https://' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    return { error: 'Only web links (http or https) can go on a list.' };
  if (url.username || url.password) return { error: 'That link hides a sign-in. Use a plain one.' };
  if (url.href.length > MAX_URL) {
    url.search = '';
    url.hash = '';
  }
  if (url.href.length > MAX_URL)
    return { error: 'That link is too long to fit. Try a shorter link to the same page.' };
  if (!isWebUrl(url.href))
    return { error: 'That doesn’t look like a web link. Paste one that starts with https://' };
  return { url: url.href };
}

/** "https://www.shop.example/a/b?c" → "shop.example". */
export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/* ---------------- the list ---------------- */

const urlSchema = z
  .string()
  .max(MAX_URL)
  .refine((url) => url === '' || isWebUrl(url), 'Links must be web links (http or https)');

export const wishItemSchema = z.object({
  id: idSchema,
  name: z.string().max(120),
  url: urlSchema,
  /** In cents; 0 = no price given. */
  price: z.number().int().min(0).max(MAX_PRICE),
  /** Size, color, anything that helps. */
  note: z.string().max(200),
  want: z.enum(WANTS),
  updated: stampSchema,
});
export type WishItem = z.infer<typeof wishItemSchema>;

const listShape = {
  v: z.literal(1),
  id: idSchema,
  title: z.string().max(80),
  /** Whose list it is: "Maya". */
  who: z.string().max(40),
  occasion: z.enum(OCCASIONS),
  currency: z.enum(CURRENCIES),
  /** The owner's last change. The copy changed last decides the details and the order. */
  edited: stampSchema,
  items: z.array(wishItemSchema).max(MAX_ITEMS),
  removed: z.array(idSchema).max(MAX_REMOVED),
};

/** The owner's list, as kept in their browser. It has no claims in it, ever. */
export const wishListSchema = z
  .object(listShape)
  .refine((list) => distinctIds(list.items), 'Each item needs its own id');
export type WishList = z.infer<typeof wishListSchema>;

/** A gift-giver link: the list, plus who's getting what. */
export const giftListSchema = z
  .object({ ...listShape, claims: claimsSchema(MAX_ITEMS) })
  .refine((list) => distinctIds(list.items), 'Each item needs its own id');
export type GiftList = z.infer<typeof giftListSchema>;

export function newWishList(id: string, now: number): WishList {
  return {
    v: 1,
    id,
    title: '',
    who: '',
    occasion: 'christmas',
    currency: 'USD',
    edited: now,
    items: [],
    removed: [],
  };
}

/** "Maya’s list", from the title or whose list it is. */
export function titleOf(list: Pick<WishList, 'title' | 'who'>) {
  const who = list.who.trim();
  return list.title.trim() || (who ? `${who}’s list` : 'A wish list');
}

/** The owner's list → the gift-giver link's contents (nobody has claimed anything in it yet). */
export function toGift(list: WishList): GiftList {
  return { ...list, claims: {} };
}

/** A gift-giver copy → just the list. What the owner sees. */
export function withoutClaims(list: GiftList): WishList {
  return {
    v: 1,
    id: list.id,
    title: list.title,
    who: list.who,
    occasion: list.occasion,
    currency: list.currency,
    edited: list.edited,
    items: list.items,
    removed: list.removed,
  };
}

/* ---------------- merging ---------------- */

/** Two copies of one gift-giver list → one (see ./claims for the rules). */
export function mergeGift(a: GiftList, b: GiftList): GiftList {
  const newer = b.edited > a.edited ? b : a;
  const { items, removed } = mergeEntries(a, b, MAX_ITEMS);
  return {
    v: 1,
    id: a.id,
    title: newer.title,
    who: newer.who,
    occasion: newer.occasion,
    currency: newer.currency,
    edited: Math.max(a.edited, b.edited),
    items,
    removed,
    claims: mergeClaims(a.claims, b.claims, new Set(items.map((item) => item.id))),
  };
}

/** The owner opened a link to their own list: take in item changes, never the claims. */
export function mergeOwn(own: WishList, incoming: GiftList): WishList {
  return withoutClaims(mergeGift(toGift(own), { ...incoming, claims: {} }));
}

/* ---------------- the owner's edits ---------------- */

type Details = Partial<Pick<WishList, 'title' | 'who' | 'occasion' | 'currency'>>;

export function setWishDetails(list: WishList, details: Details, now: number): WishList {
  return {
    ...list,
    ...details,
    title: (details.title ?? list.title).slice(0, 80),
    who: (details.who ?? list.who).slice(0, 40),
    edited: bump(list.edited, now),
  };
}

/** A wish as typed into the form, before it's checked. */
export type WishDraft = { name: string; url: string; price: number; note: string; want: Want };
export type Wish = Pick<WishItem, 'name' | 'url' | 'price' | 'note' | 'want'>;
export const EMPTY_DRAFT: WishDraft = { name: '', url: '', price: 0, note: '', want: 'like' };

/** Check a draft: a name is needed, a link must be a web link. */
export function checkDraft(draft: WishDraft): {
  wish: Wish | null;
  errors: { name?: string; url?: string };
} {
  const errors: { name?: string; url?: string } = {};
  const name = draft.name.trim().slice(0, 120);
  if (!name) errors.name = 'Say what it is.';
  const link = readUrl(draft.url);
  if ('error' in link) errors.url = link.error;
  if (errors.name || errors.url || 'error' in link) return { wish: null, errors };
  return {
    wish: {
      name,
      url: link.url,
      price: Math.min(MAX_PRICE, Math.max(0, Math.round(draft.price) || 0)),
      note: draft.note.trim().slice(0, 200),
      want: draft.want,
    },
    errors,
  };
}

export function addWish(list: WishList, wish: Wish, id: string, now: number): WishList {
  const taken = list.items.some((item) => item.id === id) || list.removed.includes(id);
  if (list.items.length >= MAX_ITEMS || taken) return list;
  return {
    ...list,
    items: [...list.items, { ...wish, id, updated: now }],
    edited: bump(list.edited, now),
  };
}

export function editWish(list: WishList, itemId: string, wish: Wish, now: number): WishList {
  return {
    ...list,
    edited: bump(list.edited, now),
    items: list.items.map((item) =>
      item.id === itemId ? { ...item, ...wish, updated: bump(item.updated, now) } : item,
    ),
  };
}

export function moveWish(list: WishList, itemId: string, delta: -1 | 1, now: number): WishList {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0) return list;
  return { ...list, items: moveEntry(list.items, index, delta), edited: bump(list.edited, now) };
}

export type WishRemoval = { item: WishItem; index: number };

export function removeWish(list: WishList, itemId: string, now: number) {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0) return { list, removal: null };
  const removal: WishRemoval = { item: list.items[index], index };
  return {
    list: {
      ...list,
      items: list.items.filter((item) => item.id !== itemId),
      removed: [...list.removed.filter((id) => id !== itemId), itemId].slice(-MAX_REMOVED),
      edited: bump(list.edited, now),
    },
    removal,
  };
}

export function restoreWish(list: WishList, removal: WishRemoval, now: number): WishList {
  if (list.items.some((item) => item.id === removal.item.id)) return list;
  if (list.items.length >= MAX_ITEMS) return list;
  const items = [...list.items];
  items.splice(Math.min(removal.index, items.length), 0, removal.item);
  return {
    ...list,
    items,
    removed: list.removed.filter((id) => id !== removal.item.id),
    edited: bump(list.edited, now),
  };
}

/* ---------------- the owner's device ---------------- */

export const ownerStoreSchema = z.object({
  v: z.literal(1),
  list: wishListSchema.nullable(),
  /** The list's `edited` when its gift-giver link was last made: later edits aren't in it. */
  shared: stampSchema.nullable(),
});
export type OwnerStore = z.infer<typeof ownerStoreSchema>;
export const EMPTY_OWNER: OwnerStore = { v: 1, list: null, shared: null };

/** A made-up list to try the tool with: invented shops on .example addresses. */
export function sampleList(id: string, ids: string[], now: number): WishList {
  const wishes: Wish[] = [
    {
      name: 'Merino hiking socks',
      url: 'https://www.trailhouse.example/socks/merino-crew',
      price: 2400,
      note: 'Size M. Any color but white.',
      want: 'love',
    },
    {
      name: 'Gooseneck pour-over kettle',
      url: 'https://kettleandco.example/gooseneck',
      price: 6900,
      note: 'Matte black if there’s a choice.',
      want: 'love',
    },
    {
      name: 'A paperback you loved this year',
      url: '',
      price: 0,
      note: 'Surprise me. Mysteries are always welcome.',
      want: 'like',
    },
    {
      name: 'Ceramic planter, medium',
      url: 'https://www.claybarn.example/planters/medium',
      price: 3200,
      note: 'For the kitchen window. Speckled or plain.',
      want: 'like',
    },
    {
      name: 'Wool beanie',
      url: '',
      price: 2800,
      note: 'Dark green or navy.',
      want: 'nice',
    },
    {
      name: 'Tickets to something fun',
      url: '',
      price: 0,
      note: 'A show, a match, a class. Doing over having.',
      want: 'nice',
    },
  ];
  return {
    ...newWishList(id, now),
    title: 'Maya’s list',
    who: 'Maya',
    items: wishes.map((wish, index) => ({ ...wish, id: ids[index], updated: now })),
  };
}

/** The list as plain text (no claims: this is the owner's copy, safe to paste anywhere). */
export function wishText(list: WishList) {
  const occasion = list.occasion === 'other' ? '' : ` · ${OCCASION_NAMES[list.occasion]}`;
  const lines = [`${titleOf(list)}${occasion}`, ''];
  list.items.forEach((item, index) => {
    const parts = [
      item.name.trim() || 'A wish',
      item.price ? formatMoney(item.price, list.currency) : '',
      WANT_NAMES[item.want],
    ].filter(Boolean);
    lines.push(`${index + 1}. ${parts.join(' — ')}`);
    if (item.note.trim()) lines.push(`   ${item.note.trim()}`);
    if (item.url) lines.push(`   ${item.url}`);
  });
  return lines.join('\n');
}

/* ---------------- gift-givers on this device ---------------- */

const givenSchema = z.object({
  /** What this device answered at the gate: a gift-giver, the list's owner, or not yet. */
  role: z.enum(['ask', 'giver', 'owner']),
  opened: stampSchema,
  list: giftListSchema,
});
export type Given = z.infer<typeof givenSchema>;

export const givenStoreSchema = z.object({
  v: z.literal(1),
  /** Who claims from this device. The name may be blank: "Someone". */
  me: claimerSchema.nullable(),
  lists: z.array(givenSchema).max(MAX_SAVED),
});
export type GivenStore = z.infer<typeof givenStoreSchema>;
export const EMPTY_GIVEN: GivenStore = { v: 1, me: null, lists: [] };

/** An owner never keeps claims, even ones that arrive in a link. */
const fitFor = (role: Given['role'], list: GiftList): GiftList =>
  role === 'owner' ? { ...list, claims: {} } : list;

/** Keep a list on this device, most recent first, dropping the oldest past the limit. */
export function keepGiven(store: GivenStore, given: Given): GivenStore {
  const lists = [
    { ...given, list: fitFor(given.role, given.list) },
    ...store.lists.filter((entry) => entry.list.id !== given.list.id),
  ];
  return { ...store, lists: lists.slice(0, MAX_SAVED) };
}

/** A gift-giver link was opened here: merge it into this device's copy, if there is one. */
export function receiveGift(store: GivenStore, incoming: GiftList, now: number) {
  const saved = store.lists.find((entry) => entry.list.id === incoming.id);
  const role = saved?.role ?? 'ask';
  const list = fitFor(role, mergeGift(saved?.list ?? incoming, incoming));
  return {
    store: keepGiven(store, { role, opened: now, list }),
    before: saved?.list ?? null,
    list,
    role,
  };
}

/** Change a list kept on this device. */
export function changeGiven(
  store: GivenStore,
  listId: string,
  change: (list: GiftList) => GiftList,
) {
  const saved = store.lists.find((entry) => entry.list.id === listId);
  if (!saved) return store;
  const list = change(saved.list);
  return list === saved.list ? store : keepGiven(store, { ...saved, list });
}

/** Remember the answer at the gate. Saying "it's my list" drops any claims kept here. */
export function answerGate(store: GivenStore, listId: string, role: 'giver' | 'owner') {
  return {
    ...store,
    lists: store.lists.map((entry) =>
      entry.list.id === listId ? { ...entry, role, list: fitFor(role, entry.list) } : entry,
    ),
  };
}

export function giftProgress(list: GiftList) {
  const total = list.items.length;
  const claimed = list.items.filter((item) => holder(list.claims[item.id])).length;
  const bought = list.items.filter((item) => holder(list.claims[item.id])?.got).length;
  return { total, claimed, bought, open: total - claimed };
}
