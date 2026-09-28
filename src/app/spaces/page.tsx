import { redirect } from 'next/navigation';
import { landingFor, requireSession } from '@/lib/identity';

/**
 * Open Spaces and land in yours. Demo Mode always has someone (no sign-in); with real accounts,
 * nobody signed in goes to Sign In.
 */
export default async function SpacesHome() {
  const session = await requireSession('/spaces');
  redirect(await landingFor(session));
}
