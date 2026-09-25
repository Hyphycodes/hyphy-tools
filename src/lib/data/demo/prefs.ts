import 'server-only';
import { cookies } from 'next/headers';
import type { PinTarget } from '@/lib/platform/types';

/**
 * Demo Mode's memory for personal choices (pins), kept apart from the journal so they never age
 * out when the journal fills up. One list per person per Space; a missing list means "use the
 * seeded defaults". Reset clears it with the journal. In production this is a `pins` table.
 */
const NAME = 'hyphy_demo_pins';
const MAX_PER_LIST = 12;

type Stored = Record<string, string[]>;

const key = (spaceId: string, personId: string) => `${spaceId}:${personId}`;
const encode = (target: PinTarget) => `${target.type}:${target.id}`;

export function decodePin(value: string): PinTarget | null {
  const [type, id] = value.split(':');
  return (type === 'tool' || type === 'project') && id ? { type, id } : null;
}

async function read(): Promise<Stored> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** This person's pins here, or null if they haven't changed the defaults. */
export async function readPins(spaceId: string, personId: string): Promise<PinTarget[] | null> {
  const list = (await read())[key(spaceId, personId)];
  if (!Array.isArray(list)) return null;
  return list.map(decodePin).filter((pin): pin is PinTarget => Boolean(pin));
}

export async function writePins(spaceId: string, personId: string, pins: PinTarget[]) {
  const stored = await read();
  stored[key(spaceId, personId)] = pins.slice(0, MAX_PER_LIST).map(encode);
  (await cookies()).set(NAME, Buffer.from(JSON.stringify(stored), 'utf8').toString('base64url'), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearPins() {
  (await cookies()).delete(NAME);
}
