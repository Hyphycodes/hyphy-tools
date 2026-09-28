import type { Metadata, Viewport } from 'next';
import { Hubot_Sans, Martian_Mono, Mona_Sans } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';

const hubot = Hubot_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-hubot',
  display: 'swap',
});
const mona = Mona_Sans({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-mona',
  display: 'swap',
});
/**
 * Hubot Sans draws its zero slashed, which reads as code in a total or a date. Display type
 * borrows Mona Sans's plain zero (just that one glyph, 2.5 KB, variable weight and width).
 */
const zero = localFont({
  src: './fonts/mona-sans-zero.woff2',
  weight: '200 900',
  variable: '--font-zero',
  display: 'swap',
  preload: false,
  fallback: [],
  adjustFontFallback: false,
  declarations: [
    { prop: 'unicode-range', value: 'U+0030' },
    { prop: 'font-stretch', value: '75% 125%' },
  ],
});
const martian = Martian_Mono({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-martian',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Hyphy Tools', template: '%s · Hyphy Tools' },
  description: 'A universal toolbox that grows into your personal or business operating system.',
  applicationName: 'Hyphy Tools',
  // A private preview: keep it out of search engines until launch.
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: 'Hyphy Tools', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#f3f1eb',
  colorScheme: 'light',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The public world marks <html> before first paint (reveals), so its classes may differ.
    <html
      lang="en"
      className={`${hubot.variable} ${mona.variable} ${martian.variable} ${zero.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
