'use client';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

/*
 * Things you can pick up and put somewhere else: pages, PDFs, photos. Pointer events, so a mouse,
 * a finger and a pen all work the same way:
 *
 * - a mouse lifts a thing as soon as it moves a few pixels;
 * - a finger rests on it for a moment (so the page still scrolls), or grabs its handle at once;
 * - the keyboard moves it with the arrow keys on its handle.
 *
 * While one thing is held, the others slide out of its way (FLIP), and when it's let go it
 * settles into its slot. With reduced motion everything simply jumps into place.
 */

type Key = string | number;

type Drag = {
  key: Key;
  index: number;
  pointerId: number;
  touch: boolean;
  active: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** Where the pointer holds the thing, from its top left corner. */
  grabX: number;
  grabY: number;
  /** Every slot, in page coordinates, measured when the thing was lifted. */
  slots: { left: number; top: number; width: number; height: number }[];
  timer: number | undefined;
};

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const EASE = 'transform var(--motion-dur, 240ms) var(--motion-ease, cubic-bezier(.2,.9,.25,1.04))';

export function useSortable({
  keys,
  onMove,
  disabled = false,
  hold = 280,
}: {
  /** The things, in their current order. */
  keys: Key[];
  onMove: (from: number, to: number) => void;
  disabled?: boolean;
  /** How long a finger rests before the thing lifts, in ms. */
  hold?: number;
}) {
  const nodes = useRef(new Map<Key, HTMLElement>());
  const handles = useRef(new Map<Key, HTMLElement>());
  const before = useRef<Map<Key, DOMRect> | null>(null);
  const drag = useRef<Drag | null>(null);
  /** The window listeners of the drag in progress, so they can be taken off again. */
  const bound = useRef<(() => void) | null>(null);
  const latest = useRef({ keys, onMove, disabled });
  const [lifted, setLifted] = useState<Key | null>(null);
  const [pending, setPending] = useState<Key | null>(null);
  const signature = keys.join('|');

  useLayoutEffect(() => {
    latest.current = { keys, onMove, disabled };
  });

  /** Moves a thing, measuring everything first so it can slide rather than jump. */
  const move = (from: number, to: number) => {
    const count = latest.current.keys.length;
    if (from === to || to < 0 || to >= count) return false;
    const rects = new Map<Key, DOMRect>();
    nodes.current.forEach((node, key) => rects.set(key, node.getBoundingClientRect()));
    before.current = rects;
    latest.current.onMove(from, to);
    return true;
  };

  /** Keeps the held thing under the pointer, whichever slot it's in now. */
  const follow = () => {
    const state = drag.current;
    if (!state?.active) return;
    const node = nodes.current.get(state.key);
    const slot = state.slots[state.index];
    if (!node || !slot) return;
    const left = state.x + window.scrollX - state.grabX - slot.left;
    const top = state.y + window.scrollY - state.grabY - slot.top;
    node.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };

  // After a move: everything that shifted slides from where it was to where it is now.
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    follow();
    if (!rects || reduced()) return;
    const held = drag.current?.active ? drag.current.key : null;
    nodes.current.forEach((node, key) => {
      if (key === held) return;
      const old = rects.get(key);
      if (!old) return;
      node.style.transition = 'none';
      node.style.transform = '';
      const now = node.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) return;
      node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      // Read layout, so the browser starts from the old place before sliding.
      void node.offsetWidth;
      node.style.transition = EASE;
      node.style.transform = '';
    });
    // Runs when the order changes; `follow` reads refs only.
  }, [signature]);

  /** Which slot the held thing is over now: the one its middle is closest to. */
  const retarget = () => {
    const state = drag.current;
    if (!state?.active) return;
    const node = nodes.current.get(state.key);
    const slot = state.slots[state.index];
    if (!node || !slot) return;
    const middleX = state.x + window.scrollX - state.grabX + slot.width / 2;
    const middleY = state.y + window.scrollY - state.grabY + slot.height / 2;
    let best = state.index;
    let distance = Infinity;
    state.slots.forEach((candidate, index) => {
      const dx = candidate.left + candidate.width / 2 - middleX;
      const dy = candidate.top + candidate.height / 2 - middleY;
      // Rows count a little more than columns: a grid reads left to right, then down.
      const d = dx * dx + dy * dy * 1.4;
      if (d < distance) {
        distance = d;
        best = index;
      }
    });
    if (best !== state.index) {
      const from = state.index;
      state.index = best;
      move(from, best);
    }
  };

  // Scrolling while something is held keeps it under the finger.
  useEffect(() => {
    if (lifted === null) return;
    let frame = 0;
    const tick = () => {
      const state = drag.current;
      if (!state?.active) return;
      const edge = 96;
      const bottom = window.innerHeight - 120;
      const speed =
        state.y < edge
          ? -Math.ceil((edge - state.y) / 6)
          : state.y > bottom
            ? Math.ceil((state.y - bottom) / 6)
            : 0;
      if (speed) {
        window.scrollBy(0, speed);
        follow();
        retarget();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // `follow` and `retarget` read refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted]);

  const activate = () => {
    const state = drag.current;
    if (!state || state.active) return;
    const node = nodes.current.get(state.key);
    if (!node) return;
    const rect = node.getBoundingClientRect();
    state.active = true;
    state.grabX = state.x - rect.left;
    state.grabY = state.y - rect.top;
    state.slots = latest.current.keys.map((key) => {
      const slot = nodes.current.get(key)?.getBoundingClientRect();
      return slot
        ? {
            left: slot.left + window.scrollX,
            top: slot.top + window.scrollY,
            width: slot.width,
            height: slot.height,
          }
        : { left: 0, top: 0, width: 0, height: 0 };
    });
    node.style.transition = 'none';
    node.style.zIndex = '30';
    node.style.position = 'relative';
    setPending(null);
    setLifted(state.key);
    if (state.touch) navigator.vibrate?.(8);
  };

  const end = (cancelled: boolean) => {
    const state = drag.current;
    drag.current = null;
    bound.current?.();
    bound.current = null;
    if (!state) return;
    window.clearTimeout(state.timer);
    setPending(null);
    if (!state.active) return;
    const node = nodes.current.get(state.key);
    if (node) {
      // Settle into the slot.
      node.style.transition = reduced() ? 'none' : EASE;
      node.style.transform = '';
      window.setTimeout(() => {
        node.style.zIndex = '';
        node.style.transition = '';
      }, 320);
    }
    setLifted(null);
    if (!cancelled) {
      // The pointer lifting over the thing would count as a tap on it.
      const swallow = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  function onPointerMove(event: PointerEvent) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    state.x = event.clientX;
    state.y = event.clientY;
    if (!state.active) {
      const moved = Math.hypot(state.x - state.startX, state.y - state.startY);
      if (state.touch) {
        // A finger that moves before the hold is up is scrolling, not lifting.
        if (moved > 8) end(true);
      } else if (moved > 5) activate();
      return;
    }
    follow();
    retarget();
  }
  function onPointerUp(event: PointerEvent) {
    if (drag.current && event.pointerId === drag.current.pointerId) end(false);
  }
  function onPointerCancel(event: PointerEvent) {
    if (drag.current && event.pointerId === drag.current.pointerId) end(true);
  }
  // Once something is lifted, the finger moves it instead of the page.
  function onTouchMove(event: TouchEvent) {
    if (drag.current?.active && event.cancelable) event.preventDefault();
  }

  useEffect(
    () => () => {
      bound.current?.();
      bound.current = null;
    },
    [],
  );

  const start = (event: ReactPointerEvent<HTMLElement>, key: Key) => {
    if (latest.current.disabled || drag.current) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const target = event.target as HTMLElement;
    // Buttons on the thing (turn, remove) are buttons, not handles.
    if (target.closest('[data-no-drag]')) return;
    const index = latest.current.keys.indexOf(key);
    if (index < 0) return;
    const touch = event.pointerType !== 'mouse';
    const handle = Boolean(target.closest('[data-drag-handle]'));
    drag.current = {
      key,
      index,
      pointerId: event.pointerId,
      touch,
      active: false,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      grabX: 0,
      grabY: 0,
      slots: [],
      timer: undefined,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    bound.current = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('touchmove', onTouchMove);
    };
    if (touch) {
      if (handle) activate();
      else {
        setPending(key);
        drag.current.timer = window.setTimeout(activate, hold);
      }
    }
  };

  const keyMove = (event: KeyboardEvent<HTMLElement>, key: Key) => {
    const index = latest.current.keys.indexOf(key);
    const to =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? latest.current.keys.length - 1
              : null;
    if (to === null || latest.current.disabled) return;
    event.preventDefault();
    if (move(index, to)) {
      // Moving a node in the document can drop its focus: hand it back.
      requestAnimationFrame(() => handles.current.get(key)?.focus());
    }
  };

  return {
    /** The key of the thing being held, while it is. */
    lifted,
    /** The key of the thing a finger is resting on, before it lifts. */
    pending,
    /** Moves a thing (buttons, menus), sliding the others. */
    move,
    item: (key: Key) => ({
      ref: (node: HTMLElement | null) => {
        if (node) nodes.current.set(key, node);
        else nodes.current.delete(key);
      },
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => start(event, key),
      onContextMenu: (event: React.MouseEvent) => {
        if (drag.current) event.preventDefault();
      },
      style: { WebkitTouchCallout: 'none', userSelect: 'none' } as React.CSSProperties,
    }),
    handle: (key: Key) => ({
      ref: (node: HTMLElement | null) => {
        if (node) handles.current.set(key, node);
        else handles.current.delete(key);
      },
      'data-drag-handle': '',
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyMove(event, key),
      style: { touchAction: 'none' } as React.CSSProperties,
    }),
  };
}
