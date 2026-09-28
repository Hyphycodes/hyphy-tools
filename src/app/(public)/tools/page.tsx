import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FilterBar, FilteredTools, LiveFilterBar } from '@/components/marketplace/browse';
import {
  AllTools,
  Creative,
  Everyday,
  Featured,
  Hero,
  OnTheWay,
  People,
  PrivateByDesign,
} from '@/components/marketplace/sections';

export const metadata: Metadata = {
  title: { absolute: 'Hyphy Tools — small tools that just work' },
  description:
    'Free tools from Hyphy: split a check from a photo of the receipt, find a time, make a QR code, merge PDFs, frame photos for every feed. No sign-up.',
  alternates: { canonical: 'tools' },
};

/**
 * The public Tools marketplace. Static: every section reads the registry at build time, and only
 * search and filtering run in the browser.
 */
export default function Marketplace() {
  return (
    <>
      <Hero />
      {/* One tall container, so the filter bar stays pinned all the way down. */}
      <div className="relative">
        <Suspense fallback={<FilterBar value="all" />}>
          <LiveFilterBar />
        </Suspense>
        <Suspense fallback={null}>
          <FilteredTools />
        </Suspense>
        <div data-editorial>
          <Featured />
          <Creative />
          <People />
          <Everyday />
          <AllTools />
          <PrivateByDesign />
          <OnTheWay />
        </div>
      </div>
    </>
  );
}
