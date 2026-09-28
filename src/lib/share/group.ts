import * as z from 'zod/mini';
import { claimerSchema, idSchema, stampSchema, type Claimer } from '@/lib/tools/claims';

/*
 * Group sessions: the shared shape underneath Where?, Plan and Secret Santa (and the same idea
 * Bring and When? grew on their own). A session is one thing a group does together: a vote, a
 * plan, an exchange. It lives in its link (lib/share/link-state); every device that opens the
 * link keeps a copy here, with the role it has (the organizer who made it, or a guest it was
 * shared with), and opening a newer copy merges it in with the tool's own merge rules.
 *
 * - `me`: who this device is in every group ({ id made here once, the name they gave }).
 * - `current`: the session on screen when the page opens without a link.
 * - `sessions`: newest first, at most MAX_SESSIONS; guests' old sessions go first.
 *
 * Pure and tested (tests/lib-group.spec.ts). The tool supplies the session schema and merge.
 */

export const MAX_SESSIONS = 12;

export type Role = 'organizer' | 'guest';

export type Saved<T> = { role: Role; opened: number; data: T };

export type GroupStore<T> = {
  v: 1;
  me: Claimer | null;
  current: string | null;
  sessions: Saved<T>[];
};

/** The device store's schema for a tool's session schema. */
export function groupStoreSchema<T>(session: z.ZodMiniType<T>) {
  return z.object({
    v: z.literal(1),
    me: z.nullable(claimerSchema),
    current: z.nullable(idSchema),
    sessions: z
      .array(
        z.object({
          role: z.enum(['organizer', 'guest']),
          opened: stampSchema,
          data: session,
        }),
      )
      .check(z.maxLength(MAX_SESSIONS)),
  }) as unknown as z.ZodMiniType<GroupStore<T>>;
}

export function emptyGroup<T>(): GroupStore<T> {
  return { v: 1, me: null, current: null, sessions: [] };
}

type WithId = { id: string };

/** The session on screen, if any. */
export function currentOf<T extends WithId>(store: GroupStore<T>): Saved<T> | null {
  return store.sessions.find((entry) => entry.data.id === store.current) ?? null;
}

/**
 * Keep a session on this device and put it on screen. Past the limit, the oldest session this
 * device was a guest in goes first; sessions it organizes go last.
 */
export function keepSession<T extends WithId>(
  store: GroupStore<T>,
  saved: Saved<T>,
): GroupStore<T> {
  const sessions = [saved, ...store.sessions.filter((entry) => entry.data.id !== saved.data.id)];
  while (sessions.length > MAX_SESSIONS) {
    const guest = sessions.findLastIndex((entry, index) => index > 0 && entry.role === 'guest');
    sessions.splice(guest > 0 ? guest : sessions.length - 1, 1);
  }
  return { ...store, current: saved.data.id, sessions };
}

/** Change the session on screen (a vote, an RSVP, an edit). Nothing on screen: nothing changes. */
export function changeCurrentSession<T extends WithId>(
  store: GroupStore<T>,
  change: (data: T) => T,
): GroupStore<T> {
  const saved = currentOf(store);
  if (!saved) return store;
  const data = change(saved.data);
  return data === saved.data ? store : keepSession(store, { ...saved, data });
}

/**
 * A link was opened here: merge it into this device's copy, or keep it as a session this device
 * is a guest in. `before` is what this device had (null the first time).
 */
export function receiveSession<T extends WithId>(
  store: GroupStore<T>,
  incoming: T,
  merge: (mine: T, theirs: T) => T,
  now: number,
) {
  const saved = store.sessions.find((entry) => entry.data.id === incoming.id);
  const data = saved ? merge(saved.data, incoming) : incoming;
  return {
    store: keepSession(store, { role: saved?.role ?? 'guest', opened: now, data }),
    before: saved?.data ?? null,
    data,
  };
}

/** Take a session off this device. Everyone else keeps theirs. */
export function forgetSession<T extends WithId>(store: GroupStore<T>, id: string): GroupStore<T> {
  return {
    ...store,
    current: store.current === id ? null : store.current,
    sessions: store.sessions.filter((entry) => entry.data.id !== id),
  };
}

/** Name this device (or fix a typo); the id stays, so everything it did keeps its owner. */
export function nameMe<T>(store: GroupStore<T>, name: string, freshId: string): GroupStore<T> {
  return { ...store, me: { id: store.me?.id ?? freshId, name: name.trim().slice(0, 40) } };
}
