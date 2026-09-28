import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FilterBar, FilteredTools, LiveFilterBar } from '@/components/marketplace/browse';
import {
  AllTools,
  Drops,
  FamilyStage,
  Featured,
  Hero,
  Money,
  PrivateByDesign,
} from '@/components/marketplace/sections';
import { catalogFacts } from '@/lib/catalog';

const facts = catalogFacts();

export const metadata: Metadata = {
  title: { absolute: 'Hyphy Tools — useful little things, serious systems' },
  description: `${facts.open} free tools from Hyphy: split a check, find a time, make a QR code, merge PDFs, frame photos for every feed. ${facts.local} run entirely on your device. No sign-up.`,
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
          <FamilyStage id="gather" />
          <Money />
          <FamilyStage id="signal" />
          <FamilyStage id="image-lab" />
          <FamilyStage id="file-lab" />
          <Drops />
          <PrivateByDesign />
          <AllTools />
        </div>
      </div>
    </>
  );
}
