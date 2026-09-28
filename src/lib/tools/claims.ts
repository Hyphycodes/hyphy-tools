import { z } from 'zod';

/*
 * Claims on lists that live in their links (Bring, Christmas List). There's no master copy:
 * every link someone sends back is a copy, and copies meet when a link is opened on a device
 * that has seen the list before, or when someone combines two links. These rules make that
 * merge safe in any order and any number of times, so nobody's claim is lost and nothing comes
 * back from the dead:
 *
 * - Items: every item either copy has, matched by id. For the same item, the later edit wins.
 *   A removed item's id is remembered, so an older link can't bring it back.
 * - Claims: the earliest claim on an item holds it; a competing, later claim is released.
 *   Unclaiming leaves a small record behind, so an older link can't restore the claim.
 * - Only the device that made a claim can release or change it (its claimer id is on the claim).
 *
 * Pure and tested (tests/lib-bring.spec.ts, tests/lib-wishlist.spec.ts).
 */

/** List, item and claimer ids: the alphabet `newId` draws from, nothing else. */
export const idSchema = z.string().regex(/^[a-z0-9]{1,24}$/);

/** A moment, in milliseconds since 1970 (what `Date.now()` returns). */
export const MAX_STAMP = 8_640_000_000_000;
export const stampSchema = z.number().int().min(0).max(MAX_STAMP);

/** Removed items remembered per list, so older links can't bring them back. */
export const MAX_REMOVED = 200;

/** Records kept per item: whoever holds it, plus the most recent released claims. */
export const MAX_RECORDS = 6;

export const claimSchema = z.object({
  /** The claimer's device id. Only that device can release or change the claim. */
  by: idSchema,
  name: z.string().max(40),
  /** When it was claimed. The earliest claim holds the item. */
  at: stampSchema,
  /** When it last changed. Between two copies of one claim, the later change wins. */
  t: stampSchema,
  /** Released. Kept so an older link can't restore the claim. */
  off: z.boolean().optional(),
  /** Bought (Christmas List). */
  got: z.boolean().optional(),
});
export type Claim = z.infer<typeof claimSchema>;

/** Claims by item id. */
export type Claims = Record<string, Claim[]>;

export function claimsSchema(maxItems: number) {
  return z
    .record(idSchema, z.array(claimSchema).max(MAX_RECORDS))
    .refine((claims) => Object.keys(claims).length <= maxItems, 'Too many claimed items');
}

/** Who's claiming on this device: an id made here once, and the name they gave. */
export const claimerSchema = z.object({ id: idSchema, name: z.string().max(40) });
export type Claimer = z.infer<typeof claimerSchema>;

/** A time that's later than `previous` even when this device's clock is behind another's. */
export function bump(previous: number, now: number) {
  return Math.min(MAX_STAMP, Math.max(now, previous + 1));
}

/** Does every item in a list have its own id? (A hand-made link could repeat one.) */
export function distinctIds(items: readonly { id: string }[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/* ---------------- items ---------------- */

type Entry = { id: string; updated: number };
type Copy<T extends Entry> = { edited: number; items: T[]; removed: string[] };

/**
 * Two copies of a list's items → one. The order comes from the copy edited last; items only the
 * other copy has go at the end. Removed items stay removed.
 */
export function mergeEntries<T extends Entry>(a: Copy<T>, b: Copy<T>, max: number) {
  const removed = [...new Set([...a.removed, ...b.removed])].slice(-MAX_REMOVED);
  const gone = new Set(removed);
  const [base, other] = b.edited > a.edited ? [b, a] : [a, b];
  const theirs = new Map(other.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const items: T[] = [];
  for (const item of base.items) {
    if (gone.has(item.id) || seen.has(item.id)) continue;
    const twin = theirs.get(item.id);
    items.push(twin && twin.updated > item.updated ? twin : item);
    seen.add(item.id);
  }
  for (const item of other.items) {
    if (gone.has(item.id) || seen.has(item.id)) continue;
    items.push(item);
    seen.add(item.id);
  }
  return { items: items.slice(0, max), removed };
}

/** Move an item one place up (-1) or down (+1). */
export function moveEntry<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/* ---------------- claims ---------------- */

const byTime = (a: Claim, b: Claim) => a.at - b.at || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0);

/** Who has an item: the earliest claim still standing, or nobody. */
export function holder(records: readonly Claim[] | undefined): Claim | null {
  let best: Claim | null = null;
  for (const record of records ?? []) {
    if (!record.off && (!best || byTime(record, best) < 0)) best = record;
  }
  return best;
}

/** The small record a released claim leaves behind: who, when, and nothing else. */
const released = (record: Claim): Claim => ({
  by: record.by,
  name: '',
  at: record.at,
  t: record.t,
  off: true,
});

/** Two copies of the same claim: the later change wins; at the same moment, a release wins. */
function later(a: Claim, b: Claim): Claim {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  if (Boolean(a.off) !== Boolean(b.off)) return a.off ? a : b;
  // Same moment, same state: pick the same one whichever copy came first.
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/** One item's records, settled: the earliest standing claim holds, everything else is released. */
function settle(records: Claim[]): Claim[] {
  const top = holder(records);
  const rest = records
    .filter((record) => record !== top)
    .map(released)
    .sort((a, b) => b.t - a.t || byTime(a, b))
    .slice(0, top ? MAX_RECORDS - 1 : MAX_RECORDS);
  return top ? [top, ...rest] : rest;
}

/**
 * Two copies of a list's claims → one, keeping only items that still exist (`keep`).
 * Safe in any order and any number of times.
 */
export function mergeClaims(a: Claims, b: Claims, keep: ReadonlySet<string>): Claims {
  const merged: [string, Claim[]][] = [];
  for (const itemId of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!keep.has(itemId)) continue;
    const byClaim = new Map<string, Claim>();
    for (const record of [...(a[itemId] ?? []), ...(b[itemId] ?? [])]) {
      const key = `${record.by}:${record.at}`;
      const known = byClaim.get(key);
      byClaim.set(key, known ? later(known, record) : record);
    }
    const records = settle([...byClaim.values()]);
    if (records.length) merged.push([itemId, records]);
  }
  return Object.fromEntries(merged);
}

/** Claim an item for `me`, unless someone already has it. */
export function claim(claims: Claims, itemId: string, me: Claimer, now: number): Claims {
  const records = claims[itemId] ?? [];
  if (holder(records)) return claims;
  const record: Claim = { by: me.id, name: me.name.trim().slice(0, 40), at: now, t: now };
  return { ...claims, [itemId]: settle([record, ...records]) };
}

/** Let go of an item. Only the device that claimed it can. */
export function unclaim(claims: Claims, itemId: string, meId: string, now: number): Claims {
  const records = claims[itemId] ?? [];
  const top = holder(records);
  if (!top || top.by !== meId) return claims;
  const gone = { ...released(top), t: bump(top.t, now) };
  return { ...claims, [itemId]: settle(records.map((record) => (record === top ? gone : record))) };
}

/** Change your own claim: the name on it, or whether it's bought. */
export function updateClaim(
  claims: Claims,
  itemId: string,
  meId: string,
  change: { name?: string; got?: boolean },
  now: number,
): Claims {
  const records = claims[itemId] ?? [];
  const top = holder(records);
  if (!top || top.by !== meId) return claims;
  const got = change.got ?? top.got;
  const next: Claim = {
    by: top.by,
    name: (change.name ?? top.name).trim().slice(0, 40),
    at: top.at,
    t: bump(top.t, now),
    ...(got ? { got: true } : {}),
  };
  return { ...claims, [itemId]: records.map((record) => (record === top ? next : record)) };
}

/** Put a new name on every claim this device holds (someone fixed a typo in their name). */
export function renameClaims(claims: Claims, meId: string, name: string, now: number): Claims {
  let next = claims;
  for (const itemId of heldBy(claims, meId)) next = updateClaim(next, itemId, meId, { name }, now);
  return next;
}

/** The items a claimer holds. */
export function heldBy(claims: Claims, meId: string): string[] {
  return Object.keys(claims).filter((itemId) => holder(claims[itemId])?.by === meId);
}

/** How many items are held. */
export function heldCount(claims: Claims, itemIds: readonly string[]) {
  return itemIds.filter((itemId) => holder(claims[itemId])).length;
}

/** A short fingerprint of the claims: it changes whenever any claim does. */
export function claimsVersion(claims: Claims) {
  let latest = 0;
  let count = 0;
  for (const records of Object.values(claims)) {
    for (const record of records) {
      latest = Math.max(latest, record.t);
      count += 1;
    }
  }
  return `${count}.${latest}`;
}

/**
 * What changed for this device when two copies met: its claims that didn't survive (someone
 * claimed first, or the item was removed), and claims that are new since `before`.
 */
export function claimChanges(before: Claims, after: Claims, meId: string | null) {
  const lost: { itemId: string; takenBy: string | null }[] = [];
  if (meId) {
    for (const itemId of heldBy(before, meId)) {
      const now = holder(after[itemId]);
      if (now?.by === meId) continue;
      lost.push({ itemId, takenBy: now ? now.name.trim() || 'Someone' : null });
    }
  }
  let added = 0;
  for (const itemId of Object.keys(after)) {
    const now = holder(after[itemId]);
    const then = holder(before[itemId]);
    if (now && (!then || then.by !== now.by || then.at !== now.at)) added += 1;
  }
  return { lost, added };
}
