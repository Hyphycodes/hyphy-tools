'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { safeParse } from 'zod/mini';
import type { $ZodType } from 'zod/v4/core';

/*
 * "Saved in this browser": a tool's work kept in localStorage so it's there next time, on this
 * device only. Every read is validated (storage can hold anything, including an older shape),
 * and every access is wrapped: private windows and strict settings can refuse storage entirely.
 */

export function readLocal<T>(key: string, schema: $ZodType<T>): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = safeParse(schema, JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * State that survives a reload. Starts from `initial` (so the server render and the first client
 * render agree), loads what was saved right after mount, then saves every change.
 * `loaded` says whether saved work has been read yet.
 */
export function useLocalState<T>(key: string, schema: $ZodType<T>, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const skip = useRef(true);

  useEffect(() => {
    const saved = readLocal(key, schema);
    // Reading storage is an external system: this is the effect's job.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved !== null) setValue(saved);
    setLoaded(true);
    // The key and schema are fixed for a tool.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change not yet written: written when the page goes away or the tool closes, so leaving
  // right after a change (to another tool, say) never loses it.
  const pending = useRef<{ key: string; value: T } | null>(null);

  useEffect(() => {
    if (!loaded) return;
    if (skip.current) {
      skip.current = false;
      return;
    }
    pending.current = { key, value };
    const timer = setTimeout(() => {
      writeLocal(key, value);
      pending.current = null;
    }, 250);
    return () => clearTimeout(timer);
  }, [key, value, loaded]);

  useEffect(() => {
    const flush = () => {
      if (!pending.current) return;
      writeLocal(pending.current.key, pending.current.value);
      pending.current = null;
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const reset = useCallback(
    (next: T) => {
      pending.current = null;
      writeLocal(key, null);
      setValue(next);
    },
    [key],
  );

  return [value, setValue, { loaded, reset }] as const;
}
