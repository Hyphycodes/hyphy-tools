'use client';
import { usePathname } from 'next/navigation';
import { ViewTransition, type ReactNode } from 'react';

/**
 * Opening a tool (or going back to the marketplace) cross-fades the old page out and lets the new
 * one rise in, where the browser supports view transitions. Keyed by the path, so only real
 * navigations animate — typing, filtering and loading inside a page never do.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
