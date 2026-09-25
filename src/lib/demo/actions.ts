'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { dataBackend } from '@/lib/data';
import { clearConfig } from '@/lib/data/demo/config';
import { clearJournal } from '@/lib/data/demo/journal';
import { clearPins } from '@/lib/data/demo/prefs';
import { seed } from '@/lib/data/demo/seed';
import { resetWorld } from '@/lib/data/supabase/dev';
import { PREVIEW_COOKIE } from '@/lib/identity/demo-source';
import { identityMode } from '@/lib/identity/mode';

/**
 * Demo Mode controls. They exist only while the identity source is the demo one, and they are
 * the only code that changes "who you are" without signing in. Delete this file (and
 * components/demo) when real sign-in ships.
 */
function assertDemo() {
  if (identityMode() !== 'demo') throw new Error('Demo Mode is off.');
}

export async function previewAs(formData: FormData) {
  assertDemo();
  const personId = String(formData.get('personId') ?? '');
  const spaceSlug = String(formData.get('space') ?? '');
  const data = seed();
  if (!data.people.some((person) => person.id === personId)) return;
  (await cookies()).set(PREVIEW_COOKIE, personId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production',
  });
  redirect(/^[a-z0-9-]+$/.test(spaceSlug) ? `/${spaceSlug}` : '/');
}

export async function resetDemo(formData: FormData) {
  assertDemo();
  if (dataBackend() === 'supabase') {
    // The shared development database goes back to its seeded story. `resetWorld` refuses unless
    // the server allows it (HYPHY_DEMO_RESET=on) and the database is marked as development.
    await resetWorld();
  } else {
    // Everything this browser changed goes: records, decisions, business setup and pins.
    await clearJournal();
    await clearConfig();
    await clearPins();
  }
  // Every page was showing the old world. (Clearing cookies refreshes them; a database reset
  // changes no cookie, so say so explicitly.)
  revalidatePath('/', 'layout');
  const back = String(formData.get('back') ?? '/');
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}
