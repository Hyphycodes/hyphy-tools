import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Dock } from '@/components/home/dock';
import { QuickSheet } from '@/components/home/quick';
import { ToastProvider } from '@/components/ui/toast';
import { WorldFooter } from '@/components/world/footer';
import { WorldHeader } from '@/components/world/header';
import { PageTransition, WorldDocument } from '@/components/world/page-transition';
import { RevealRuntime, revealBootScript } from '@/components/world/reveal';
import { SearchPalette } from '@/components/world/search';
import { BASE_PATH } from '@/lib/base-path';
import { HOME_BOOT } from '@/lib/home/boot';
import { STUDIO_URL } from '@/lib/public';
import './world.css';
import './home.css';

/**
 * Where the public world lives, for canonical addresses and share cards: Studio serves this app at
 * /platform. HYPHY_SITE_URL (the address people use, as in emails) wins when it's set.
 */
export const metadata: Metadata = {
  metadataBase: new URL(
    `${(process.env.HYPHY_SITE_URL?.trim() || STUDIO_URL).replace(/\/+$/, '')}${BASE_PATH}/`,
  ),
};

export const viewport: Viewport = {
  themeColor: '#0b0b0a',
  colorScheme: 'dark',
};

/**
 * The public world: the Tools marketplace and every tool page. Dark, open to everyone, no
 * account — deliberately separate from the Spaces product (`(app)`), which it never links into.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="world-night" data-world="night">
      <script dangerouslySetInnerHTML={{ __html: revealBootScript }} />
      <script dangerouslySetInnerHTML={{ __html: HOME_BOOT }} />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ToastProvider>
        <WorldHeader />
        <main id="main" className="min-h-dvh">
          <PageTransition>{children}</PageTransition>
        </main>
        <WorldFooter />
        <SearchPalette />
        <QuickSheet />
        <Dock />
      </ToastProvider>
      <RevealRuntime />
      <WorldDocument />
    </div>
  );
}
