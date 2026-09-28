'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as z from 'zod/mini';
import {
  changeCurrentSession,
  currentOf,
  emptyGroup,
  forgetSession,
  groupStoreSchema,
  keepSession,
  nameMe,
  receiveSession,
  type GroupStore,
} from '@/lib/share/group';
import { clearHash, decodeState, linkFor, newId, writeHash } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import { rememberName } from './group-share';

/*
 * One group session on screen, kept in this browser and in the address bar (lib/share/group).
 * The part every link-shared group tool repeats: open a link → merge it with this device's copy;
 * change something → the address and the shareable link follow; name this device once.
 */

export type Received<T> = { before: T | null; after: T };

export function useGroupSession<T extends { id: string }>({
  key,
  schema,
  merge,
  fresh,
  wrongLink,
  onReceive,
}: {
  /** localStorage key, e.g. `hyphy.where.v1`. */
  key: string;
  schema: z.ZodMiniType<T>;
  merge: (mine: T, theirs: T) => T;
  /** A new, empty session (the organizer's first change makes it). */
  fresh: (id: string, now: number) => T;
  /** Said when a link can't be read. */
  wrongLink: string;
  /** A link was opened: what this device had, and what it has now. */
  onReceive?: (received: Received<T>) => void;
}) {
  const [storeSchema] = useState(() => groupStoreSchema(schema));
  const [initial] = useState(() => emptyGroup<T>());
  const [store, setStore, { loaded }] = useLocalState<GroupStore<T>>(key, storeSchema, initial);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<{ data: T; url: string } | null>(null);
  const latest = useRef(store);
  const receiveRef = useRef(onReceive);

  useEffect(() => {
    latest.current = store;
    receiveRef.current = onReceive;
  });

  const saved = currentOf(store);
  const data = saved?.data ?? null;

  const take = useCallback(
    (incoming: T) => {
      const result = receiveSession(latest.current, incoming, merge, Date.now());
      latest.current = result.store;
      setStore(result.store);
      receiveRef.current?.({ before: result.before, after: result.data });
      return result;
    },
    [merge, setStore],
  );

  // A link carries a session: merge it in when the page opens and when the address changes by
  // hand. (This page's own writeHash doesn't fire hashchange.)
  useEffect(() => {
    if (!loaded) return;
    let live = true;
    const open = () => {
      const fragment = window.location.hash;
      if (fragment.length <= 1) {
        setReady(true);
        return;
      }
      void decodeState(fragment, schema).then((incoming) => {
        if (!live) return;
        if (incoming) {
          take(incoming);
          setProblem(null);
        } else setProblem(wrongLink);
        setReady(true);
      });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => {
      live = false;
      window.removeEventListener('hashchange', open);
    };
    // Opening runs once storage is read; the schema and words are fixed for a tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // The address bar always carries the session as it is now, so it can be shared from anywhere.
  useEffect(() => {
    if (!ready || !data) return;
    const timer = setTimeout(() => {
      void writeHash(data);
      void linkFor(data).then((url) => setLink({ data, url }));
    }, 200);
    return () => clearTimeout(timer);
  }, [ready, data]);

  /** Change the session on screen. `create`: with none on screen, start one as its organizer. */
  const update = useCallback(
    (change: (data: T, now: number) => T, { create = false } = {}) => {
      const now = Date.now();
      setStore((current) => {
        const on = currentOf(current);
        if (on) return changeCurrentSession(current, (item) => change(item, now));
        if (!create) return current;
        return keepSession(current, {
          role: 'organizer',
          opened: now,
          data: change(fresh(newId(), now), now),
        });
      });
    },
    [fresh, setStore],
  );

  const setName = useCallback(
    (name: string) => {
      const next = nameMe(latest.current, name, newId(8));
      rememberName(name);
      latest.current = next;
      setStore(next);
      return next.me!;
    },
    [setStore],
  );

  const startNew = useCallback(() => {
    setStore((current) => ({ ...current, current: null }));
    clearHash();
    setProblem(null);
  }, [setStore]);

  const open = useCallback(
    (id: string) => setStore((current) => ({ ...current, current: id })),
    [setStore],
  );

  const forget = useCallback(
    (id: string) => {
      setStore((current) => forgetSession(current, id));
      if (id === latest.current.current) clearHash();
    },
    [setStore],
  );

  /** This device organizes the session on screen from now on ("I'm organizing this"). */
  const adopt = useCallback(
    () =>
      setStore((current) => {
        const on = currentOf(current);
        return on ? keepSession(current, { ...on, role: 'organizer' }) : current;
      }),
    [setStore],
  );

  /** A pasted link: merged when it's this session, otherwise said plainly. */
  const combine = useCallback(
    async (text: string): Promise<{ error: string; other?: string } | { done: T }> => {
      const at = text.indexOf('#');
      if (at < 0) return { error: 'Paste the whole link: everything is in the part after the #.' };
      const incoming = await decodeState(text.slice(at), schema);
      if (!incoming) return { error: wrongLink };
      if (data && incoming.id !== data.id)
        return { error: 'That link is for a different one.', other: text.slice(at) };
      return { done: take(incoming).data };
    },
    [data, schema, take, wrongLink],
  );

  return {
    store,
    loaded,
    ready,
    problem,
    saved,
    data,
    organizer: !saved || saved.role === 'organizer',
    me: store.me,
    /** The link for exactly what's on screen; null while it's being made. */
    link: link && data && link.data === data ? link.url : null,
    update,
    setName,
    startNew,
    open,
    forget,
    adopt,
    combine,
  };
}
