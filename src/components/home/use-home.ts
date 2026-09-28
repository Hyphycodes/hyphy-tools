'use client';
import { useSyncExternalStore } from 'react';
import {
  HOME_KEY,
  emptyHome,
  localDay,
  readHome,
  recordUse,
  setLens,
  setPin,
  type HomeLens,
  type HomePrefs,
} from '@/lib/home/prefs';
import type { ToolId } from '@/lib/catalog/schema';

/*
 * The home preferences as a tiny store over localStorage: every component that reads them (the
 * home, the mode switch, a pin on a card, the header) sees the same value, other tabs included.
 * On the server, and while the page hydrates, there is no value (`null`): the page renders its
 * first-visit version and swaps once it knows (see HOME_BOOT for how the swap stays invisible).
 */

const EVENT = 'hyphy:home';
let cache: { raw: string | null; value: HomePrefs } | null = null;

function rawNow() {
  try {
    return window.localStorage.getItem(HOME_KEY);
  } catch {
    return null;
  }
}

/** The preferences, parsed once per change. Also works where storage is switched off. */
function snapshot(): HomePrefs {
  const raw = rawNow();
  if (!cache || cache.raw !== raw) cache = { raw, value: readHome(raw) };
  return cache.value;
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === HOME_KEY || event.key === null) notify();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, notify);
  };
}

const serverSnapshot = () => null;

/** The preferences, or `null` before the browser has been asked (server render, hydration). */
export function useHome(): HomePrefs | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Change the preferences. Storage can refuse (a private window): the page still follows along. */
export function updateHome(change: (home: HomePrefs) => HomePrefs) {
  const next = change(typeof window === 'undefined' ? emptyHome() : snapshot());
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(HOME_KEY, raw);
  } catch {
    // Kept for this page view only.
  }
  cache = { raw: rawNow() ?? raw, value: next };
  if (next.lens) document.documentElement.dataset.lens = next.lens;
  window.dispatchEvent(new Event(EVENT));
}

export function chooseLens(lens: HomeLens) {
  updateHome((home) => setLens(home, lens, Date.now()));
}

export function pinTool(id: ToolId, on: boolean) {
  updateHome((home) => setPin(home, id, on, Date.now()));
}

export function noteUse(id: ToolId) {
  const now = Date.now();
  updateHome((home) => recordUse(home, id, now, localDay(now)));
}
