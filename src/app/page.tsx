import { redirect } from 'next/navigation';
import { landingFor, requireSession } from '@/lib/identity';

/**
 * Open the app and land in your Space. Demo Mode always has someone (no sign-in); with real
 * accounts, nobody signed in goes to Sign In.
 */
export default async function Home() {
  const session = await requireSession();
  redirect(await landingFor(session));
}
