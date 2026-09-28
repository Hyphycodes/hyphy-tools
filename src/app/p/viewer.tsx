'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignalPageView } from '@/components/tools/signal-page-view';
import { decodeState } from '@/lib/share/link-state';
import { DESIGNS, signalPageSchema, type SignalPage } from '@/lib/tools/signal-pages';

/** Reads the page out of the address and draws it. A bad or cut-off link says so plainly. */
export function SignalPageViewer() {
  const [page, setPage] = useState<SignalPage | null | 'invalid'>(null);

  useEffect(() => {
    const read = () =>
      void decodeState(window.location.hash, signalPageSchema).then((value) =>
        setPage(value ?? 'invalid'),
      );
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  useEffect(() => {
    if (page && page !== 'invalid' && page.name.trim()) document.title = page.name.trim();
  }, [page]);

  if (page === null) return <main className="min-h-dvh bg-[#111110]" aria-busy="true" />;

  if (page === 'invalid')
    return (
      <main className="grid min-h-dvh place-items-center bg-[#111110] px-6 text-center text-[#f4f1ea]">
        <div className="max-w-sm">
          <h1 className="text-[22px] font-semibold">This page’s link is incomplete.</h1>
          <p className="mt-2 text-[15px] text-[#f4f1ea]/65">
            A Signal Page lives inside its link, so the whole link is needed — it may have been cut
            off when it was copied. Ask for it again.
          </p>
          <Link
            href="/tools/signal-pages"
            className="mt-6 inline-block text-[14px] font-medium text-[#b9beff] underline-offset-2 hover:underline"
          >
            Make your own Signal Page
          </Link>
        </div>
      </main>
    );

  return (
    <main className="min-h-dvh">
      {/* The design behind everything, so scrolling past either end never shows another color. */}
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ background: DESIGNS[page.design].background }}
      />
      <SignalPageView
        page={page}
        fill
        className="relative"
        footer={
          <footer className="mt-12 max-w-[440px] text-[11.5px] leading-relaxed opacity-55">
            <p>
              Made with{' '}
              <Link href="/tools/signal-pages" className="underline underline-offset-2">
                Hyphy Signal
              </Link>
              . This page lives inside its own link: Hyphy doesn’t host, keep or review it. Check
              where a link goes before you share anything personal.
            </p>
          </footer>
        }
      />
    </main>
  );
}
