import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CatalogShelves } from '@/components/home/catalog';
import { FilterBar, FilteredTools, LiveFilterBar } from '@/components/marketplace/browse';
import { isReady, listedTools } from '@/lib/catalog';

export const metadata: Metadata = {
  title: 'All tools',
  description:
    'Every Hyphy tool in one place: plans with people, money, links and QR codes, images, files and PDFs, and tools for business. Free, and no sign-up.',
  alternates: { canonical: 'tools/all' },
};

/**
 * The whole catalog, always one tap from any mode: filters by what a tool helps with
 * (`?c=money`), every tool as a card, and "Keep handy" on each.
 */
export default function AllToolsPage() {
  const count = listedTools.filter(isReady).length;
  return (
    <>
      <section
        aria-labelledby="all-page-title"
        className="mx-auto w-full max-w-[1320px] px-4 pt-[88px] pb-6 sm:px-6 sm:pt-32 sm:pb-8 lg:px-8"
      >
        <h1
          id="all-page-title"
          className="animate-rise font-display text-[44px] leading-[0.95] font-extrabold tracking-[-0.045em] text-ink sm:text-[76px]"
          style={{ fontVariationSettings: "'wdth' 114" }}
        >
          All tools
        </h1>
        <p className="mt-3 max-w-[56ch] text-[15.5px] text-ink-2 sm:text-[17px]">
          {count} tools, free, most of them working right on your device. Keep the ones you use
          handy and they’ll be first on your home.
        </p>
      </section>
      <div className="relative">
        <Suspense fallback={<FilterBar value="all" />}>
          <LiveFilterBar />
        </Suspense>
        <Suspense fallback={null}>
          <FilteredTools />
        </Suspense>
        <div data-editorial>
          <CatalogShelves />
        </div>
      </div>
    </>
  );
}
