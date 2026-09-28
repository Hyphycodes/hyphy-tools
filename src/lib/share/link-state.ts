import type { ZodType } from 'zod';

/*
 * Link-as-state: a plan, a list or a bill travels inside its own link, after the `#`. Browsers
 * never send that part of an address to a server, so Hyphy never receives what's in it — the
 * link is the whole plan, and anyone holding it can open it.
 *
 * Format: `#z` + base64url(deflate-raw(JSON)), or `#j` + base64url(JSON) where the browser can't
 * compress. Every payload is validated with its tool's schema before it's trusted: a link is
 * input from a stranger.
 */

const MAX_FRAGMENT = 60_000;

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '==='.slice((padded.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

const canCompress = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** State → the text after `#`. */
export async function encodeState(data: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (canCompress()) return `z${toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${toBase64Url(bytes)}`;
}

/** The text after `#` → validated state, or null when it isn't a valid link for this tool. */
export async function decodeState<T>(fragment: string, schema: ZodType<T>): Promise<T | null> {
  const text = fragment.replace(/^#/, '').trim();
  if (!text || text.length > MAX_FRAGMENT) return null;
  try {
    let bytes = fromBase64Url(text.slice(1));
    if (text[0] === 'z') {
      if (!canCompress()) return null;
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    } else if (text[0] !== 'j') return null;
    if (bytes.length > 400_000) return null;
    const parsed = schema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The full shareable address for this page with `state` inside it. */
export async function linkFor(data: unknown) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${await encodeState(data)}`;
}

/** Put `state` in the address bar (no navigation, no history entry). */
export async function writeHash(data: unknown) {
  const fragment = await encodeState(data);
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}#${fragment}`);
}

/** Take state out of the address bar (a fresh start). */
export function clearHash() {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', `${pathname}${search}`);
}

/** A short, unguessable id for a plan or a list. */
export function newId(length = 10) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}
