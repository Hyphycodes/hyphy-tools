import type { Metadata, Viewport } from 'next';
import { SignalPageViewer } from './viewer';

/**
 * A Signal Page, opened from its link. The page itself is inside the address (after the #), so
 * this route is the same static shell for everyone; the browser draws the page.
 */
export const metadata: Metadata = {
  title: { absolute: 'Signal Page' },
  description: 'A link page made with Hyphy Signal.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const viewport: Viewport = { themeColor: '#111110' };

export default function SignalPageRoute() {
  return <SignalPageViewer />;
}
