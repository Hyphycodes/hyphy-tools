'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Reveals `[data-reveal]` elements once, as they scroll into view. The page is complete without
 * it: content is only hidden once `reveal-ready` is on <html> (set before first paint by the
 * layout's inline script, or here after a client-side navigation), with reduced motion never.
 */
export function RevealRuntime() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const root = document.documentElement;
    root.classList.add('reveal-live');
    const pending = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-shown])'));
    if (!root.classList.contains('reveal-ready')) {
      // Arrived by a client-side navigation: what's already on screen stays put.
      const fold = window.innerHeight;
      for (const element of pending())
        if (element.getBoundingClientRect().top < fold) element.setAttribute('data-shown', '');
      root.classList.add('reveal-ready');
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-shown', '');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );
    pending().forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}

/** Runs before first paint: the night world, and hide what will be revealed (never with reduced motion). */
export const revealBootScript = `try{document.documentElement.dataset.world='night';if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('reveal-ready')}catch(e){}`;
