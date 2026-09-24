import 'server-only';
import { cookies } from 'next/headers';
import type { JournalOp } from './journal-types';

/**
 * Demo Mode's memory: the visitor's own changes, layered over the seed. Kept in a cookie so the
 * demo needs no database, works on any host and is private to each browser. "Reset demo" clears
 * it. Only the demo repository reads or writes this file.
 */
export type { JournalOp, PendingOp } from './journal-types';
export { applyJournal, newId } from './journal-apply';

const NAME = 'hyphy_demo_journal';
const CHUNK = 3800;
const CHUNKS = 2;
const MAX = CHUNK * CHUNKS;

function encode(ops: JournalOp[]) {
  return Buffer.from(JSON.stringify(ops), 'utf8').toString('base64url');
}

function decode(value: string): JournalOp[] {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return Array.isArray(parsed)
      ? parsed.filter((op) => op && (op.k === 'add' || op.k === 'set') && typeof op.t === 'string')
      : [];
  } catch {
    return [];
  }
}

export async function readJournal(): Promise<JournalOp[]> {
  const store = await cookies();
  const value = Array.from(
    { length: CHUNKS },
    (_, index) => store.get(`${NAME}.${index}`)?.value ?? '',
  ).join('');
  return value ? decode(value) : [];
}

/** Writes the whole journal, dropping the oldest changes if it outgrows the cookie budget. */
export async function writeJournal(ops: JournalOp[]) {
  const store = await cookies();
  let kept = ops;
  let value = encode(kept);
  while (value.length > MAX && kept.length > 1) {
    kept = kept.slice(1);
    value = encode(kept);
  }
  for (let index = 0; index < CHUNKS; index += 1) {
    const part = value.slice(index * CHUNK, (index + 1) * CHUNK);
    if (part)
      store.set(`${NAME}.${index}`, part, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        secure: process.env.NODE_ENV === 'production',
      });
    else store.delete(`${NAME}.${index}`);
  }
  return kept.length;
}

export async function clearJournal() {
  const store = await cookies();
  for (let index = 0; index < CHUNKS; index += 1) store.delete(`${NAME}.${index}`);
}
