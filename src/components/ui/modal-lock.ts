'use client';
import { useEffect, type RefObject } from 'react';

/*
 * An open <dialog> freezes the page behind it. This used to be `html:has(dialog[open])` in CSS,
 * but a `:has()` anchored on <html> makes the browser restyle the whole document after every DOM
 * change, anywhere — measured at ~70ms per change on the marketplace. A flag on <html>, set only
 * when a dialog actually opens or closes, costs one restyle per open.
 */

let open = 0;

function sync() {
  if (open > 0) document.documentElement.setAttribute('data-modal', '');
  else document.documentElement.removeAttribute('data-modal');
}

export function useModalLock(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    let locked = false;
    const update = () => {
      if (dialog.open === locked) return;
      locked = dialog.open;
      open += locked ? 1 : -1;
      sync();
    };
    const observer = new MutationObserver(update);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    update();
    return () => {
      observer.disconnect();
      if (locked) {
        open -= 1;
        sync();
      }
    };
  }, [ref]);
}
