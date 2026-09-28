import { redirect } from 'next/navigation';
import { MARKETPLACE } from '@/lib/auth/routes';

/**
 * The front door is the public Tools marketplace: nobody is dropped into an account dashboard.
 * Spaces (the signed-in product) open from `/spaces`.
 */
export default function Home() {
  redirect(MARKETPLACE);
}
