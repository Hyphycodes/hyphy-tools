/**
 * Hyphy Studio is the umbrella, and this app is served inside it at /platform (a rewrite in Studio's
 * vercel.json). Links back to Studio are absolute, because they leave this app.
 *
 * NEXT_PUBLIC_STUDIO_URL is Studio's public address. Until its custom domain is live, Studio runs at
 * its Vercel address, which is the default here and keeps working after a domain is added.
 */
export const STUDIO_URL = (
  process.env.NEXT_PUBLIC_STUDIO_URL?.trim() || 'https://hyphy-studio.vercel.app'
).replace(/\/+$/, '');

export const studio = {
  home: STUDIO_URL,
  work: `${STUDIO_URL}/work`,
  contact: `${STUDIO_URL}/contact`,
  privacy: `${STUDIO_URL}/privacy`,
} as const;
