import Link from 'next/link';
import { connection } from 'next/server';
import { AuthFrame } from '@/components/auth/frame';
import { identityMode } from '@/lib/identity/mode';

/**
 * Focused steps that sit outside any one Space (creating a business). Calm and single-purpose,
 * like the account pages; always rendered per request.
 */
export default async function FlowLayout({ children }: LayoutProps<'/'>) {
  await connection();
  return (
    <AuthFrame
      notice={
        identityMode() === 'demo' ? (
          <div className="border-b border-caution/15 bg-caution-soft/70 px-4 py-2.5 text-center text-[13px] text-caution">
            <span className="font-medium">Preview.</span> Creating a business needs a real account —{' '}
            <Link href="/" className="font-medium underline underline-offset-2">
              explore the demo businesses
            </Link>
            .
          </div>
        ) : undefined
      }
    >
      {children}
    </AuthFrame>
  );
}
