import { BASE_PATH } from '@/lib/base-path';

/**
 * The account pages, and what the proxy and pages need to know about them. Paths are inside the
 * app (Next.js adds the `/platform` base path).
 */
export const authRoutes = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  confirm: '/auth/confirm',
  authError: '/auth/error',
  welcome: '/welcome',
  createBusiness: '/create-business',
} as const;

/** The pages that let someone in: never somewhere to be sent back to afterwards. */
const ACCOUNT_PAGES = [
  authRoutes.signIn,
  authRoutes.signUp,
  authRoutes.forgotPassword,
  authRoutes.resetPassword,
  '/auth',
];

/** Open to everyone: the account pages, and invitation links (read before signing in). */
const PUBLIC = [...ACCOUNT_PAGES, '/invite'];

/** Only for people who aren't signed in; a signed-in visit goes home. */
const SIGNED_OUT_ONLY = [authRoutes.signIn, authRoutes.signUp, authRoutes.forgotPassword];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export const isPublicPath = (path: string) => PUBLIC.some((prefix) => under(path, prefix));
export const isSignedOutOnlyPath = (path: string) =>
  SIGNED_OUT_ONLY.some((prefix) => under(path, prefix));

/**
 * URL segments a Space can never use as its address, because the app owns them. Kept in step with
 * the `spaces_slug_not_reserved` check in supabase/migrations.
 */
export const reservedSlugs = [
  'personal',
  'auth',
  'sign-in',
  'sign-up',
  'sign-out',
  'forgot-password',
  'reset-password',
  'welcome',
  'account',
  'api',
  'platform',
  'invite',
  'invites',
  'create-business',
  'new',
  'dev',
  'settings',
  'help',
] as const;

/** `/abc/projects` → `abc`, for remembering the last Space someone used. */
export function spaceSegment(path: string): string | null {
  const first = path.split('/')[1] ?? '';
  if (!/^[a-z0-9-]{2,48}$/.test(first)) return null;
  if (first !== 'personal' && (reservedSlugs as readonly string[]).includes(first)) return null;
  return first;
}

/**
 * Only somewhere inside Hyphy Tools: a path on this site, never another origin (`//evil.example`,
 * `/\evil.example`, `https:…`), never back into the sign-in pages, and without the base path, which
 * `redirect` adds. Anything else becomes `fallback`.
 */
export function safeNext(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return fallback;
  // Control characters and backslashes are how browsers get tricked into another origin.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  let url: URL;
  try {
    url = new URL(raw, 'https://hyphy.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'https://hyphy.invalid') return fallback;
  let path = url.pathname;
  if (under(path, BASE_PATH)) path = path.slice(BASE_PATH.length) || '/';
  // `/..//evil.example` resolves to `//evil.example`: another origin once it's a Location.
  if (path.startsWith('//') || ACCOUNT_PAGES.some((prefix) => under(path, prefix))) return fallback;
  return `${path}${url.search}${url.hash}`;
}

/** Sign-in, coming back to `next` afterwards. */
export function signInPath(next?: string) {
  const back = next ? safeNext(next, '') : '';
  return back && back !== '/'
    ? `${authRoutes.signIn}?next=${encodeURIComponent(back)}`
    : authRoutes.signIn;
}
