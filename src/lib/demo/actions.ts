'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { clearJournal } from '@/lib/data/demo/journal';
import { seed } from '@/lib/data/demo/seed';
import { PREVIEW_COOKIE } from '@/lib/identity/demo-source';

/**
 * Demo Mode controls. They exist only while the identity source is the demo one, and they are
 * the only code that changes "who you are" without signing in. Delete this file (and
 * components/demo) when real sign-in ships.
 */
function assertDemo() {
  if (process.env.HYPHY_IDENTITY === 'supabase') throw new Error('Demo Mode is off.');
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
  await clearJournal();
  const back = String(formData.get('back') ?? '/');
  redirect(back.startsWith('/') && !back.startsWith('//') ? back : '/');
}
