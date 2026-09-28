import * as z from 'zod/mini';

/*
 * Signal Pages: a link-in-bio page that travels inside its own link. The page is validated like
 * any input from a stranger — only web, email and phone links survive, lengths are capped — and
 * then drawn in one of the designs below.
 */

export const DESIGNS = {
  paper: {
    name: 'Paper',
    background: '#f3f1eb',
    fg: '#16150f',
    muted: 'rgba(22,21,15,.6)',
    button: { bg: '#ffffff', fg: '#16150f', border: 'rgba(22,21,15,.12)', radius: 999 },
    avatar: { bg: '#16150f', fg: '#ffffff' },
    font: 'sans',
  },
  ink: {
    name: 'Ink',
    background: '#111110',
    fg: '#f4f1ea',
    muted: 'rgba(244,241,234,.6)',
    button: {
      bg: 'rgba(255,255,255,.09)',
      fg: '#f4f1ea',
      border: 'rgba(255,255,255,.1)',
      radius: 999,
    },
    avatar: { bg: '#e4ff3a', fg: '#16150f' },
    font: 'sans',
  },
  signal: {
    name: 'Signal',
    background: '#3240ff',
    fg: '#ffffff',
    muted: 'rgba(255,255,255,.75)',
    button: { bg: '#ffffff', fg: '#1f28b8', border: 'transparent', radius: 999 },
    avatar: { bg: '#ff8ad8', fg: '#16150f' },
    font: 'display',
  },
  ember: {
    name: 'Ember',
    background: '#2a120e',
    fg: '#fff7ef',
    muted: 'rgba(255,247,239,.62)',
    button: {
      bg: 'rgba(255,247,239,.1)',
      fg: '#fff7ef',
      border: 'rgba(255,247,239,.14)',
      radius: 16,
    },
    avatar: { bg: '#e0492f', fg: '#fff7ef' },
    font: 'sans',
  },
  aurora: {
    name: 'Aurora',
    background:
      'radial-gradient(120% 70% at 0% 0%, rgba(124,92,255,.55), transparent 60%), radial-gradient(90% 60% at 100% 100%, rgba(32,211,146,.35), transparent 60%), #0c0b14',
    fg: '#f3f1ff',
    muted: 'rgba(243,241,255,.64)',
    button: {
      bg: 'rgba(255,255,255,.08)',
      fg: '#f3f1ff',
      border: 'rgba(255,255,255,.16)',
      radius: 14,
    },
    avatar: { bg: '#b9a8ff', fg: '#140f2b' },
    font: 'display',
  },
  mono: {
    name: 'Mono',
    background: '#ffffff',
    fg: '#0a0a0a',
    muted: 'rgba(10,10,10,.6)',
    button: { bg: '#ffffff', fg: '#0a0a0a', border: '#0a0a0a', radius: 0 },
    avatar: { bg: '#0a0a0a', fg: '#ffffff' },
    font: 'mono',
  },
  sunset: {
    name: 'Sunset',
    background: 'linear-gradient(170deg, #ffd9b0 0%, #ffb4a2 45%, #e5989b 100%)',
    fg: '#3a1a1f',
    muted: 'rgba(58,26,31,.65)',
    button: {
      bg: 'rgba(255,255,255,.72)',
      fg: '#3a1a1f',
      border: 'rgba(255,255,255,.6)',
      radius: 999,
    },
    avatar: { bg: '#3a1a1f', fg: '#ffd9b0' },
    font: 'display',
  },
  garden: {
    name: 'Garden',
    background: '#15271d',
    fg: '#eaf2e3',
    muted: 'rgba(234,242,227,.62)',
    button: { bg: '#cfe6b8', fg: '#15271d', border: 'transparent', radius: 12 },
    avatar: { bg: '#cfe6b8', fg: '#15271d' },
    font: 'sans',
  },
} as const;

export type DesignId = keyof typeof DESIGNS;
export const DESIGN_IDS = Object.keys(DESIGNS) as DesignId[];

/** Socials: a handle or an address in, the right link out. */
export const NETWORKS = {
  instagram: { name: 'Instagram', icon: 'instagram', base: 'https://instagram.com/' },
  tiktok: { name: 'TikTok', icon: 'tiktok', base: 'https://www.tiktok.com/@' },
  youtube: { name: 'YouTube', icon: 'youtube', base: 'https://www.youtube.com/@' },
  x: { name: 'X', icon: 'x-social', base: 'https://x.com/' },
  linkedin: { name: 'LinkedIn', icon: 'linkedin', base: 'https://www.linkedin.com/in/' },
  facebook: { name: 'Facebook', icon: 'facebook', base: 'https://www.facebook.com/' },
  spotify: { name: 'Spotify', icon: 'spotify', base: '' },
  email: { name: 'Email', icon: 'mail', base: 'mailto:' },
  website: { name: 'Website', icon: 'globe', base: '' },
} as const;

export type NetworkId = keyof typeof NETWORKS;
export const NETWORK_IDS = Object.keys(NETWORKS) as NetworkId[];

const text = (max: number) => z.string().check(z.maxLength(max));

export const signalPageSchema = z.object({
  v: z.literal(1),
  name: text(60),
  handle: text(30),
  bio: text(160),
  design: z.enum(DESIGN_IDS as [DesignId, ...DesignId[]]),
  links: z
    .array(
      z.object({
        id: z.string().check(z.minLength(1), z.maxLength(16)),
        label: text(60),
        url: text(800),
      }),
    )
    .check(z.maxLength(12)),
  socials: z
    .array(
      z.object({ network: z.enum(NETWORK_IDS as [NetworkId, ...NetworkId[]]), value: text(200) }),
    )
    .check(z.maxLength(8)),
});
export type SignalPage = z.infer<typeof signalPageSchema>;

export function newSignalPage(): SignalPage {
  return {
    v: 1,
    name: '',
    handle: '',
    bio: '',
    design: 'ink',
    links: [{ id: 'l1', label: '', url: '' }],
    socials: [],
  };
}

/**
 * The address a link button may open: http(s), mail or phone — never `javascript:` or `data:`.
 * "shop.example" gets https://. Anything else is null and the button isn't shown.
 */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') return url.href;
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.'))
      return url.href;
    return null;
  } catch {
    return null;
  }
}

/** Where a link really goes, for the small print under it: "tickets.example". */
export function hostOf(href: string) {
  try {
    const url = new URL(href);
    if (url.protocol === 'mailto:') return url.pathname;
    if (url.protocol === 'tel:') return url.pathname;
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A social's link from what was typed: "@rosa.eats", "rosa.eats" or a full address. */
export function socialHref(network: NetworkId, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const info = NETWORKS[network];
  if (network === 'email') {
    const address = value.replace(/^mailto:/i, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : null;
  }
  // An address (it has a scheme or a path) is used as it is; anything else is a handle.
  if (network === 'website' || /^https?:\/\//i.test(value) || value.includes('/'))
    return safeHref(value);
  if (!info.base) return null;
  const handle = value.replace(/^@/, '').replace(/[^\w.-]/g, '');
  return handle ? `${info.base}${handle}` : null;
}

/** The monogram in the avatar: first letter of the name, or of the handle. */
export function monogram(page: Pick<SignalPage, 'name' | 'handle'>) {
  const source = page.name.trim() || page.handle.trim() || 'H';
  return (source.match(/[\p{L}\p{N}]/u)?.[0] ?? 'H').toUpperCase();
}

/** Links that will actually show on the page (named, with a safe address). */
export function publishedLinks(page: SignalPage) {
  return page.links
    .map((link) => ({ ...link, href: safeHref(link.url) }))
    .filter((link): link is typeof link & { href: string } =>
      Boolean(link.label.trim() && link.href),
    );
}
