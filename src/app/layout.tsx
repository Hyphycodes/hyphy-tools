import type { Metadata, Viewport } from 'next';
import { Hubot_Sans, Martian_Mono, Mona_Sans } from 'next/font/google';
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
    <html lang="en" className={`${hubot.variable} ${mona.variable} ${martian.variable}`}>
      <body>{children}</body>
    </html>
  );
}
