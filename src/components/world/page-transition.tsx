'use client';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

/**
 * Opening a tool (or going back to the marketplace) lets the new page fade in. A plain CSS fade
 * on the new page only: a view transition had to snapshot the whole old page first, which
 * measured as the slowest part of opening a tool on a phone. Keyed by the path, so typing,
 * filtering and loading inside a page never animate.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-page">
      {children}
    </div>
  );
}

/**
 * Marks <html> as the night world while it's on screen (the layout's boot script marks it before
 * first paint), so the page behind it — overscroll, the iOS bounce — is night too.
 */
export function WorldDocument() {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.world = 'night';
    return () => {
      delete root.dataset.world;
    };
  }, []);
  return null;
}
