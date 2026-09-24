import { redirect } from 'next/navigation';
import { getSession, homeFor } from '@/lib/identity';

/** Open the app and land in your Space. No sign-in in this preview. */
export default async function Home() {
  const session = await getSession();
  redirect(session ? homeFor(session) : '/personal');
}
