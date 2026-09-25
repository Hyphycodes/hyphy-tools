import 'server-only';
import { headers } from 'next/headers';
import { BASE_PATH } from './base-path';
import { IdentityConfigError } from './identity/mode';

/**
 * The address people use to reach Hyphy Tools, for links in emails. HYPHY_SITE_URL in production
 * (e.g. https://hyphy-studio.com — the /platform base path is added here); a Vercel deployment's
 * own address otherwise; the request's host only in development.
 */
export async function siteOrigin() {
  const configured = process.env.HYPHY_SITE_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NODE_ENV !== 'production') {
    const list = await headers();
    const host = list.get('host');
    if (host) return `${list.get('x-forwarded-proto') ?? 'http'}://${host}`;
  }
  throw new IdentityConfigError('Set HYPHY_SITE_URL so emails can link back to Hyphy.');
}

/** An absolute link to a path inside the app. */
export async function appUrl(path: string) {
  return `${await siteOrigin()}${BASE_PATH}${path}`;
}
