import { z } from 'zod';

/*
 * Signal Links: a campaign link is a page's own address plus a few tags (utm_source, utm_medium,
 * utm_campaign…) that analytics tools read to say where a visit came from. Pure and tested
 * (tests/lib-campaign-links.spec.ts).
 *
 * - The page keeps its own query and #fragment exactly as they were; only utm_ tags are replaced.
 * - Tags go before the #fragment (analytics only reads the query) in the usual order.
 * - Nothing here counts clicks. The link goes straight to the page; it only carries labels.
 */

export const TAGS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;
export type Tag = (typeof TAGS)[number];
export type Tags = Record<Tag, string>;

/** Each tag in plain words, for the fields under Advanced. */
export const TAG_HELP: Record<Tag, { label: string; help: string; example: string }> = {
  utm_source: {
    label: 'Source',
    help: 'Where it’s posted: the site, app or thing people see.',
    example: 'instagram',
  },
  utm_medium: {
    label: 'Medium',
    help: 'The kind of channel: social, email, print, or cpc for paid ads.',
    example: 'social',
  },
  utm_campaign: {
    label: 'Campaign',
    help: 'What it’s for, so every link for it is counted together.',
    example: 'fall-menu',
  },
  utm_content: {
    label: 'Content',
    help: 'Which one, when you’re comparing two posts, spots or designs.',
    example: 'story',
  },
  utm_term: {
    label: 'Term',
    help: 'The search words, for paid search ads. Usually left empty.',
    example: 'brunch-near-me',
  },
};

/* ---------------- Where the link will live ---------------- */

export const PLACE_IDS = [
  'instagram-post',
  'instagram-story',
  'instagram-bio',
  'tiktok',
  'facebook',
  'linkedin',
  'x',
  'youtube',
  'newsletter',
  'text',
  'flyer',
  'business-card',
  'google-business',
  'paid-ad',
] as const;
export type PlaceId = (typeof PLACE_IDS)[number];

export type Place = {
  id: PlaceId;
  label: string;
  source: string;
  medium: string;
  /** Tells apart spots on the same site (a story from a bio link). */
  content?: string;
  /** Printed: people will scan a QR code rather than tap. */
  qr?: boolean;
};

/*
 * Lowercase, and chosen so analytics files each one under the channel people expect
 * (Google Analytics reads medium "social" as social, "email" as email, "cpc" as paid search).
 */
const PLACE_TAGS: Record<PlaceId, Omit<Place, 'id'>> = {
  'instagram-post': {
    label: 'Instagram post',
    source: 'instagram',
    medium: 'social',
    content: 'post',
  },
  'instagram-story': {
    label: 'Instagram story',
    source: 'instagram',
    medium: 'social',
    content: 'story',
  },
  'instagram-bio': {
    label: 'Instagram bio',
    source: 'instagram',
    medium: 'social',
    content: 'bio',
  },
  tiktok: { label: 'TikTok', source: 'tiktok', medium: 'social' },
  facebook: { label: 'Facebook', source: 'facebook', medium: 'social' },
  linkedin: { label: 'LinkedIn', source: 'linkedin', medium: 'social' },
  x: { label: 'X', source: 'x', medium: 'social' },
  youtube: {
    label: 'YouTube description',
    source: 'youtube',
    medium: 'video',
    content: 'description',
  },
  newsletter: { label: 'Email newsletter', source: 'newsletter', medium: 'email' },
  text: { label: 'Text message', source: 'text-message', medium: 'sms' },
  flyer: { label: 'Flyer or poster', source: 'flyer', medium: 'print', qr: true },
  'business-card': { label: 'Business card', source: 'business-card', medium: 'print', qr: true },
  'google-business': {
    label: 'Google Business profile',
    source: 'google',
    medium: 'organic',
    content: 'business-profile',
  },
  'paid-ad': { label: 'Paid ad', source: 'google', medium: 'cpc' },
};

export const PLACES: Place[] = PLACE_IDS.map((id) => ({ id, ...PLACE_TAGS[id] }));

export const placeById = (id: PlaceId | null): Place | null =>
  id ? { id, ...PLACE_TAGS[id] } : null;

/* ---------------- The builder ---------------- */

const tagText = z.string().max(200);

export const draftSchema = z.object({
  /** The page, as pasted. */
  page: z.string().max(4000),
  place: z.enum(PLACE_IDS).nullable(),
  /** "What's it for?": becomes the campaign name. */
  purpose: z.string().max(120),
  /** "Which version?": becomes the content tag. */
  version: z.string().max(120),
  /** Tags typed by hand under Advanced. Each one wins over what the plain choices suggest. */
  raw: z.object({
    utm_source: tagText.optional(),
    utm_medium: tagText.optional(),
    utm_campaign: tagText.optional(),
    utm_content: tagText.optional(),
    utm_term: tagText.optional(),
  }),
});
export type Draft = z.infer<typeof draftSchema>;

export function emptyDraft(): Draft {
  return { page: '', place: null, purpose: '', version: '', raw: {} };
}

/** A made-up restaurant's menu, shared in an Instagram story. */
export function exampleDraft(): Draft {
  return {
    page: 'saltandember.example/menu#dinner',
    place: 'instagram-story',
    purpose: 'Fall menu launch',
    version: '',
    raw: {},
  };
}

/** "Fall Menu — Rosa’s!" → "fall-menu-rosas": lowercase words joined by hyphens. */
export function slug(text: string, max = 80) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
      .replace(/&/g, ' and ')
      .replace(/['’‘`]/g, '')
      // Emoji leftovers (variation selectors, joiners, keycaps) are marks too, but invisible ones.
      .replace(/[\u200d\u20e3\ufe00-\ufe0f]/g, '')
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '')
  );
}

/** What the plain choices add up to, before anything typed under Advanced. */
export function suggestedTags(draft: Pick<Draft, 'place' | 'purpose' | 'version'>): Tags {
  const place = placeById(draft.place);
  return {
    utm_source: place?.source ?? '',
    utm_medium: place?.medium ?? '',
    utm_campaign: slug(draft.purpose),
    // The spot ("story") and the version ("blue-poster") together: story-blue-poster.
    utm_content: [place?.content, slug(draft.version)].filter(Boolean).join('-'),
    utm_term: '',
  };
}

/** The tags the link will carry. */
export function tagsFor(draft: Draft): Tags {
  const suggested = suggestedTags(draft);
  const pick = (tag: Tag) => (draft.raw[tag] ?? suggested[tag]).trim();
  return {
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
    utm_content: pick('utm_content'),
    utm_term: pick('utm_term'),
  };
}

/** The three tags analytics needs to name a visit's origin, when they're missing. */
export const missingTags = (tags: Tags) =>
  (['utm_source', 'utm_medium', 'utm_campaign'] as const).filter((tag) => !tags[tag]);

/** Hand-typed values that will split reports ("Instagram" ≠ "instagram") or read badly. */
export function untidyTags(tags: Tags) {
  return TAGS.flatMap((tag) => {
    const value = tags[tag];
    const found: { tag: Tag; problem: 'capitals' | 'spaces' }[] = [];
    if (value !== value.toLowerCase()) found.push({ tag, problem: 'capitals' });
    if (/\s/.test(value)) found.push({ tag, problem: 'spaces' });
    return found;
  });
}

/* ---------------- The page and the link ---------------- */

export type PageCheck =
  { ok: true; url: URL; addedHttps: boolean } | { ok: false; empty: boolean; message: string };

const NOT_A_PAGE = 'That doesn’t look like a web address. Try something like shop.example/menu.';

/**
 * What someone pasted → a web page's address. "shop.example/menu" gets https://; only http and
 * https pages are accepted (never javascript:, data: or mailto:).
 */
export function readPage(text: string): PageCheck {
  const trimmed = text.trim();
  if (!trimmed)
    return {
      ok: false,
      empty: true,
      message: 'Paste the address of the page you’re sending people to.',
    };
  if (/\s/.test(trimmed))
    return {
      ok: false,
      empty: false,
      message: 'A web address has no spaces. Check that only the link was pasted.',
    };
  // A scheme that was typed is kept and checked; "shop.example:8080" is a port, not a scheme.
  const scheme = /^([a-z][a-z\d+.-]*):(?!\d)/i.exec(trimmed)?.[1].toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https')
    return {
      ok: false,
      empty: false,
      message: 'Only web pages (http or https) can carry campaign tags.',
    };
  let url: URL;
  try {
    url = new URL(scheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`);
  } catch {
    return { ok: false, empty: false, message: NOT_A_PAGE };
  }
  const host = url.hostname;
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !/^[^.]+(\.[^.]+)+\.?$/.test(host))
    return { ok: false, empty: false, message: NOT_A_PAGE };
  return { ok: true, url, addedHttps: !scheme };
}

export type CampaignLink = {
  href: string;
  /** Scheme, host and path. */
  base: string;
  /** The page's own query pieces, exactly as they were. */
  query: string[];
  /** The tags added, in order, as written in the link. */
  tags: { tag: Tag; value: string }[];
  /** "#…", or "". */
  hash: string;
  /** Campaign tags the page's address already had, now replaced ("utm_source=fb"). */
  replaced: string[];
};

const decodePiece = (text: string) => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

/** The page's address with the tags added (and any old utm_ tags taken out). */
export function campaignLink(url: URL, tags: Tags): CampaignLink {
  const query: string[] = [];
  const replaced: string[] = [];
  for (const piece of url.search.slice(1).split('&')) {
    if (!piece) continue;
    if (/^utm_/i.test(decodePiece(piece.split('=')[0]))) replaced.push(decodePiece(piece));
    else query.push(piece);
  }
  const added = TAGS.filter((tag) => tags[tag]).map((tag) => ({
    tag,
    value: encodeURIComponent(tags[tag]),
  }));
  const bare = new URL(url.href);
  bare.search = '';
  bare.hash = '';
  const search = [...query, ...added.map(({ tag, value }) => `${tag}=${value}`)].join('&');
  return {
    href: `${bare.href}${search ? `?${search}` : ''}${url.hash}`,
    base: bare.href,
    query,
    tags: added,
    hash: url.hash,
    replaced,
  };
}

/** QR Studio, opened with this link filled in (it reads #link=). */
export const qrStudioHref = (href: string) => `/tools/qr#link=${encodeURIComponent(href)}`;

/* ---------------- Recent links (this browser only) ---------------- */

export const RECENT_LIMIT = 12;

const isWebHref = (text: string) => {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

export const recentSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(24),
      href: z.string().max(8000).refine(isWebHref),
      /** When it was last copied, opened or made into a code (ms). */
      at: z.number().int().min(0),
      draft: draftSchema,
    }),
  )
  .max(RECENT_LIMIT);
export type Recent = z.infer<typeof recentSchema>[number];

/** Newest first, each link once, at most 12. */
export function remember(list: Recent[], entry: Recent): Recent[] {
  return [entry, ...list.filter((item) => item.href !== entry.href)].slice(0, RECENT_LIMIT);
}
