import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthAside, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { ButtonLink } from '@/components/ui/button';
import { authRoutes } from '@/lib/auth/routes';

export const metadata: Metadata = { title: 'Link problem' };

const copy = {
  expired: {
    title: 'This link has expired.',
    body: 'Links in our emails work once, for a short while. If you already confirmed your account, just sign in.',
  },
  invalid: {
    title: 'This link didn’t work.',
    body: 'It may be incomplete, or it was opened in a different browser from the one you started in. Sign in, or ask for a new link.',
  },
  preview: {
    title: 'Sign-in isn’t on yet.',
    body: 'This preview of Hyphy Tools runs in Demo Mode, so email links don’t do anything here.',
  },
} as const;

/** Where a confirmation or reset link that didn't work ends up: what happened, and the way on. */
export default async function AuthErrorPage({ searchParams }: PageProps<'/auth/error'>) {
  const params = await searchParams;
  const reason =
    params.reason === 'expired' || params.reason === 'preview' ? params.reason : 'invalid';
  const reset = params.for === 'reset';
  const { title, body } =
    reset && reason !== 'preview'
      ? {
          title:
            reason === 'expired' ? 'This reset link has expired.' : 'This reset link didn’t work.',
          body: 'Reset links work once, for a short while. Ask for a new one and use the newest email.',
        }
      : copy[reason];
  return (
    <AuthColumn>
      <span className="mb-5 ml-1 grid size-12 place-items-center rounded-[14px] bg-caution-soft text-caution">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-[22px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 4 8M8 12h5M3 3l18 18" />
        </svg>
      </span>
      <AuthHeading title={title}>{body}</AuthHeading>
      {reason === 'preview' ? (
        <ButtonLink href="/" variant="primary" size="lg" className="w-full">
          Open Hyphy Tools
        </ButtonLink>
      ) : reset ? (
        <ButtonLink href={authRoutes.forgotPassword} variant="primary" size="lg" className="w-full">
          Send a new link
        </ButtonLink>
      ) : (
        <ButtonLink href={authRoutes.signIn} variant="primary" size="lg" className="w-full">
          Sign in
        </ButtonLink>
      )}
      {reason !== 'preview' && (
        <AuthAside>
          {reset ? 'Remembered it? ' : 'No account yet? '}
          <Link href={reset ? authRoutes.signIn : authRoutes.signUp} className={inlineLink}>
            {reset ? 'Sign in' : 'Create one'}
          </Link>
        </AuthAside>
      )}
    </AuthColumn>
  );
}
