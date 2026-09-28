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
  type Claim,
} from './claims';

/*
 * Bring: a shared supply list for a cookout, a potluck or a trip. The list lives in its link;
 * people claim what they'll bring and send the updated link back. Copies of a list merge by the
 * rules in ./claims. Pure and tested (tests/lib-bring.spec.ts).
 */

export const MAX_ITEMS = 80;
/** Lists kept on one device: the ones you organize and the ones shared with you. */
export const MAX_SAVED = 12;

export const CATEGORIES = ['food', 'drinks', 'supplies', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_NAMES: Record<Category, string> = {
  food: 'Food',
  drinks: 'Drinks',
  supplies: 'Supplies',
  other: 'Other',
};

export const bringItemSchema = z.object({
  id: idSchema,
  name: z.string().max(80),
  /** How much, in the organizer's words: "2 bags", "for 8". */
  qty: z.string().max(30),
  cat: z.enum(CATEGORIES),
  updated: stampSchema,
});
export type BringItem = z.infer<typeof bringItemSchema>;

export const bringListSchema = z
  .object({
    v: z.literal(1),
    id: idSchema,
    title: z.string().max(80),
    when: z.string().max(80),
    where: z.string().max(120),
    note: z.string().max(400),
    /** The organizer's last change. The copy changed last decides the details and the order. */
    edited: stampSchema,
    items: z.array(bringItemSchema).max(MAX_ITEMS),
    removed: z.array(idSchema).max(MAX_REMOVED),
    claims: claimsSchema(MAX_ITEMS),
  })
  .refine((list) => distinctIds(list.items), 'Each item needs its own id');
export type BringList = z.infer<typeof bringListSchema>;

export function newList(id: string, now: number): BringList {
  return {
    v: 1,
    id,
    title: '',
    when: '',
    where: '',
    note: '',
    edited: now,
    items: [],
    removed: [],
    claims: {},
  };
}

/* ---------------- this device's lists ---------------- */

const savedSchema = z.object({
  role: z.enum(['organizer', 'guest']),
  opened: stampSchema,
  list: bringListSchema,
});
export type SavedList = z.infer<typeof savedSchema>;

export const bringStoreSchema = z.object({
  v: z.literal(1),
  /** Who claims from this device. */
  me: claimerSchema.nullable(),
  /** The list on screen when the page opens without a link. */
  current: idSchema.nullable(),
  lists: z.array(savedSchema).max(MAX_SAVED),
});
export type BringStore = z.infer<typeof bringStoreSchema>;

export const EMPTY_STORE: BringStore = { v: 1, me: null, current: null, lists: [] };

/**
 * Keep a list on this device and put it on screen. Past the limit, the oldest list you were a
 * guest on goes first; lists you organize go last.
 */
export function keep(store: BringStore, saved: SavedList): BringStore {
  const lists = [saved, ...store.lists.filter((entry) => entry.list.id !== saved.list.id)];
  while (lists.length > MAX_SAVED) {
    const guest = lists.findLastIndex((entry, index) => index > 0 && entry.role === 'guest');
    lists.splice(guest > 0 ? guest : lists.length - 1, 1);
  }
  return { ...store, current: saved.list.id, lists };
}

/** Change the list on screen. */
export function changeCurrent(store: BringStore, change: (list: BringList) => BringList) {
  const saved = store.lists.find((entry) => entry.list.id === store.current);
  if (!saved) return store;
  const list = change(saved.list);
  return list === saved.list ? store : keep(store, { ...saved, list });
}

/**
 * A link was opened here: merge it into this device's copy of the list, or keep it as a list
 * you're a guest on. `before` is what this device had (null the first time).
 */
export function receive(store: BringStore, incoming: BringList, now: number) {
  const saved = store.lists.find((entry) => entry.list.id === incoming.id);
  const list = mergeBring(saved?.list ?? incoming, incoming);
  return {
    store: keep(store, { role: saved?.role ?? 'guest', opened: now, list }),
    before: saved?.list ?? null,
    list,
  };
}

/* ---------------- merging ---------------- */

/** Two copies of one list → one (see ./claims for the rules). */
export function mergeBring(a: BringList, b: BringList): BringList {
  const newer = b.edited > a.edited ? b : a;
  const { items, removed } = mergeEntries(a, b, MAX_ITEMS);
  return {
    v: 1,
    id: a.id,
    title: newer.title,
    when: newer.when,
    where: newer.where,
    note: newer.note,
    edited: Math.max(a.edited, b.edited),
    items,
    removed,
    claims: mergeClaims(a.claims, b.claims, new Set(items.map((item) => item.id))),
  };
}

/* ---------------- the organizer's edits ---------------- */

type Details = Partial<Pick<BringList, 'title' | 'when' | 'where' | 'note'>>;

export function setDetails(list: BringList, details: Details, now: number): BringList {
  return {
    ...list,
    title: (details.title ?? list.title).slice(0, 80),
    when: (details.when ?? list.when).slice(0, 80),
    where: (details.where ?? list.where).slice(0, 120),
    note: (details.note ?? list.note).slice(0, 400),
    edited: bump(list.edited, now),
  };
}

export type NewItem = { name: string; qty?: string; cat?: Category };

/**
 * Add items at the end, as many as fit. `ids` are fresh ids (one per item added); a category
 * nobody picked is guessed from the name.
 */
export function addItems(list: BringList, entries: NewItem[], ids: string[], now: number) {
  const taken = new Set([...list.items.map((item) => item.id), ...list.removed]);
  const free = ids.filter((id) => !taken.has(id));
  const wanted = entries.filter((entry) => entry.name.trim());
  const room = Math.max(0, Math.min(MAX_ITEMS - list.items.length, free.length));
  const fresh: BringItem[] = wanted.slice(0, room).map((entry, index) => ({
    id: free[index],
    name: entry.name.trim().slice(0, 80),
    qty: (entry.qty ?? '').trim().slice(0, 30),
    cat: entry.cat ?? guessCategory(entry.name),
    updated: now,
  }));
  return {
    list: fresh.length
      ? { ...list, items: [...list.items, ...fresh], edited: bump(list.edited, now) }
      : list,
    added: fresh.length,
    /** Items that didn't fit. */
    left: wanted.length - fresh.length,
  };
}

export function editItem(
  list: BringList,
  itemId: string,
  change: Partial<Pick<BringItem, 'name' | 'qty' | 'cat'>>,
  now: number,
): BringList {
  return {
    ...list,
    edited: bump(list.edited, now),
    items: list.items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...change,
            name: (change.name ?? item.name).slice(0, 80),
            qty: (change.qty ?? item.qty).slice(0, 30),
            updated: bump(item.updated, now),
          }
        : item,
    ),
  };
}

export function moveItem(list: BringList, itemId: string, delta: -1 | 1, now: number): BringList {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0) return list;
  return { ...list, items: moveEntry(list.items, index, delta), edited: bump(list.edited, now) };
}

/** What a removal takes away, so it can be put back. */
export type Removal = { item: BringItem; index: number; claims: Claim[] | null };

export function removeItem(list: BringList, itemId: string, now: number) {
  const index = list.items.findIndex((item) => item.id === itemId);
  if (index < 0) return { list, removal: null };
  const removal: Removal = { item: list.items[index], index, claims: list.claims[itemId] ?? null };
  return {
    list: {
      ...list,
      items: list.items.filter((item) => item.id !== itemId),
      removed: [...list.removed.filter((id) => id !== itemId), itemId].slice(-MAX_REMOVED),
      claims: Object.fromEntries(Object.entries(list.claims).filter(([id]) => id !== itemId)),
      edited: bump(list.edited, now),
    },
    removal,
  };
}

/** Undo a removal: the item goes back where it was, with its claims. */
export function restoreItem(list: BringList, removal: Removal, now: number): BringList {
  if (list.items.some((item) => item.id === removal.item.id)) return list;
  if (list.items.length >= MAX_ITEMS) return list;
  const items = [...list.items];
  items.splice(Math.min(removal.index, items.length), 0, removal.item);
  return {
    ...list,
    items,
    removed: list.removed.filter((id) => id !== removal.item.id),
    claims: removal.claims ? { ...list.claims, [removal.item.id]: removal.claims } : list.claims,
    edited: bump(list.edited, now),
  };
}

/* ---------------- fast entry ---------------- */

/** "Ice (2 bags)", "Ice - 2 bags", "Ice: 2 bags", "• Buns x2" → what, and how much. */
export function parseLine(line: string): { name: string; qty: string } | null {
  const text = line
    .replace(/^\s*(?:[-*•·–—]\s+|\d{1,3}[.)]\s+|\[[ xX✓✔]?\]\s*)/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const match =
    text.match(/^(.+?)\s*\(([^()]{1,30})\)$/) ??
    text.match(/^(.+?)\s+[-–—]\s+(.{1,30})$/) ??
    text.match(/^(.+?):\s+(.{1,30})$/) ??
    text.match(/^(.+?)\s+[x×](\d{1,4})$/i);
  const [name, qty] = match ? [match[1], match[2]] : [text, ''];
  if (!name.trim()) return null;
  return { name: name.trim().slice(0, 80), qty: qty.trim().slice(0, 30) };
}

/** A pasted list, one item per line. Blank lines are skipped. */
export function parseLines(text: string) {
  return text
    .split(/\r?\n/)
    .map(parseLine)
    .filter((entry): entry is { name: string; qty: string } => entry !== null);
}

/** A first guess at the category from the name. The organizer can always change it. */
const HINTS: [Category, RegExp][] = [
  ['food', /\b(ice cream|popsicles?)\b/i],
  [
    'drinks',
    /\b(drinks?|beverages?|soda|pop|cola|juices?|lemonade|water|seltzers?|sparkling|beers?|wine|cider|prosecco|champagne|cocktails?|mixers?|tonic|coffee|tea|kombucha|milk|punch|ice)\b/i,
  ],
  [
    'supplies',
    /\b(plates?|cups?|napkins?|forks?|knives|spoons?|cutlery|utensils|tongs|spatula|foil|plastic wrap|bags?|charcoal|propane|lighters?|matches|grill|cooler|chairs?|tables?|tablecloths?|tents?|tarps?|lanterns?|flashlights?|headlamps?|stove|fuel|firewood|blankets?|towels?|sunscreen|bug spray|first aid|batter(?:y|ies)|extension cords?|serving|bowls?|openers?|corkscrew|paper towels?|dish soap|sponges?|containers?|toothpicks|skewers|straws)\b/i,
  ],
  [
    'other',
    /\b(speakers?|playlist|music|games?|cards|dice|balls?|frisbee|cornhole|decorations?|balloons?|candles?|camera|guitar|puzzles?)\b/i,
  ],
  [
    'food',
    /\b(food|snacks?|chips|salsa|dips?|guac\w*|hummus|salads?|fruit|watermelon|berries|bread|buns?|rolls?|cheese|crackers|desserts?|cakes?|cupcakes?|cookies|brownies|pies?|pizzas?|pasta|rice|beans|chicken|burgers?|hot ?dogs?|sausages?|brats?|steaks?|meat|veggies?|vegetables|corn|sandwich(?:es)?|wraps?|eggs|bacon|pancakes?|marshmallows|s[’']mores|chocolate|candy|nuts|popcorn|pretzels|mains?|sides?|dish(?:es)?|sauces?|ketchup|mustard|condiments|soup|chili|tacos?|tortillas|oatmeal|breakfast|lunch|dinner|appetizers?|pickles|olives|butter|salt|pepper|spices)\b/i,
  ],
];

export function guessCategory(name: string): Category {
  for (const [category, pattern] of HINTS) if (pattern.test(name)) return category;
  return 'other';
}

/* ---------------- starter templates ---------------- */

type Template = { id: string; name: string; items: [string, string, Category][] };

/** Generic starting points: every item is editable, nothing is assumed about the group. */
export const TEMPLATES: Template[] = [
  {
    id: 'cookout',
    name: 'Cookout',
    items: [
      ['Burgers', '12', 'food'],
      ['Hot dogs', '12', 'food'],
      ['Buns', '2 packs', 'food'],
      ['Chips & dip', '', 'food'],
      ['Salad', '', 'food'],
      ['Watermelon', '', 'food'],
      ['Soda', '12 cans', 'drinks'],
      ['Water', 'a case', 'drinks'],
      ['Ice', '2 bags', 'drinks'],
      ['Charcoal', '', 'supplies'],
      ['Plates, cups & napkins', '', 'supplies'],
      ['Trash bags', '', 'supplies'],
      ['Speaker', '', 'other'],
      ['Lawn games', '', 'other'],
    ],
  },
  {
    id: 'potluck',
    name: 'Potluck',
    items: [
      ['Main dish', '', 'food'],
      ['Vegetarian main', '', 'food'],
      ['Side dish', '', 'food'],
      ['Salad', '', 'food'],
      ['Bread', '', 'food'],
      ['Dessert', '', 'food'],
      ['Fruit platter', '', 'food'],
      ['Drinks', '', 'drinks'],
      ['Ice', '1 bag', 'drinks'],
      ['Serving spoons', '', 'supplies'],
      ['Plates & cutlery', '', 'supplies'],
      ['Napkins', '', 'supplies'],
      ['Containers for leftovers', '', 'supplies'],
    ],
  },
  {
    id: 'camping',
    name: 'Camping trip',
    items: [
      ['Camp stove & fuel', '', 'supplies'],
      ['Cooler', '', 'supplies'],
      ['Firewood', '2 bundles', 'supplies'],
      ['Lighter & matches', '', 'supplies'],
      ['Lantern', '', 'supplies'],
      ['First aid kit', '', 'supplies'],
      ['Bug spray & sunscreen', '', 'supplies'],
      ['Trash bags', '', 'supplies'],
      ['Breakfast', 'eggs & bread', 'food'],
      ['Dinner', 'first night', 'food'],
      ['Snacks', '', 'food'],
      ['S’mores kit', '', 'food'],
      ['Water jugs', '2', 'drinks'],
      ['Coffee', '', 'drinks'],
      ['Ice', '2 bags', 'drinks'],
      ['Cards or a game', '', 'other'],
    ],
  },
  {
    id: 'game-night',
    name: 'Game night',
    items: [
      ['Pizza', '2', 'food'],
      ['Chips & salsa', '', 'food'],
      ['Veggie tray', '', 'food'],
      ['Something sweet', '', 'food'],
      ['Soda', '', 'drinks'],
      ['Sparkling water', '', 'drinks'],
      ['Ice', '1 bag', 'drinks'],
      ['Cups & napkins', '', 'supplies'],
      ['Extra chairs', '', 'supplies'],
      ['A party game', '', 'other'],
      ['A strategy game', '', 'other'],
      ['Deck of cards', '', 'other'],
    ],
  },
];

/** Add a template's items (skipping any the list already has) and name an unnamed list. */
export function applyTemplate(list: BringList, templateId: string, ids: string[], now: number) {
  const template = TEMPLATES.find((entry) => entry.id === templateId);
  if (!template) return { list, added: 0, left: 0 };
  const have = new Set(list.items.map((item) => item.name.trim().toLowerCase()));
  const entries = template.items
    .filter(([name]) => !have.has(name.toLowerCase()))
    .map(([name, qty, cat]) => ({ name, qty, cat }));
  const result = addItems(list, entries, ids, now);
  return {
    ...result,
    list: list.title.trim() ? result.list : { ...result.list, title: template.name },
  };
}

/* ---------------- reading the list ---------------- */

export function progress(list: BringList) {
  const total = list.items.length;
  const claimed = list.items.filter((item) => holder(list.claims[item.id])).length;
  return { total, claimed, needed: total - claimed };
}

export type Group = { cat: Category; items: BringItem[] };

/** What's still needed first, then what's covered; each by category, in the list's order. */
export function groups(list: BringList) {
  const needed: BringItem[] = [];
  const covered: BringItem[] = [];
  for (const item of list.items) (holder(list.claims[item.id]) ? covered : needed).push(item);
  const byCategory = (items: BringItem[]): Group[] =>
    CATEGORIES.map((cat) => ({ cat, items: items.filter((item) => item.cat === cat) })).filter(
      (group) => group.items.length > 0,
    );
  return { needed: byCategory(needed), covered: byCategory(covered) };
}

export function itemLabel(item: Pick<BringItem, 'name' | 'qty'>) {
  const name = item.name.trim() || 'Something';
  return item.qty.trim() ? `${name} (${item.qty.trim()})` : name;
}

/** The list as plain text for the group chat: what's still needed first, then who's got what. */
export function bringText(list: BringList, link?: string) {
  const { total, claimed } = progress(list);
  const lines = [list.title.trim() || 'What we’re bringing'];
  const details = [list.when.trim(), list.where.trim()].filter(Boolean).join(' · ');
  if (details) lines.push(details);
  if (list.note.trim()) lines.push(list.note.trim());
  lines.push(`${claimed} of ${total} claimed`, '');
  for (const item of list.items) {
    if (!holder(list.claims[item.id])) lines.push(`○ ${itemLabel(item)} — still needed`);
  }
  for (const item of list.items) {
    const who = holder(list.claims[item.id]);
    if (who) lines.push(`✓ ${itemLabel(item)} — ${who.name.trim() || 'Someone'}`);
  }
  if (link) lines.push('', `Claim something: ${link}`);
  return lines.join('\n');
}
