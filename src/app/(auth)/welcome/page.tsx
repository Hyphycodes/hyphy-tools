import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthCard, AuthColumn, AuthHeading } from '@/components/auth/frame';
import { DisplayNameForm } from '@/components/auth/forms';
import { Starters } from '@/components/auth/starters';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { authRoutes } from '@/lib/auth/routes';
import { getWorkspace, requireSession } from '@/lib/identity';

export const metadata: Metadata = { title: 'Welcome' };

/**
 * The first stop after confirming an account. Their Personal Space already exists (the account
 * bootstrap made it); this only checks the name and offers a first thing to do. No company
 * questions — those belong to creating a Business Space.
 */
export default async function WelcomePage() {
  const session = await requireSession(authRoutes.welcome);
  const workspace = await getWorkspace('personal');
  if (!workspace) notFound();
  const { person, space } = workspace;
  return (
    <AuthColumn wide>
      <AuthHeading eyebrow="Welcome to Hyphy" title={`Hi, ${person.firstName || 'there'}.`}>
        Your Personal Space is ready. It’s private — just for you — and everything you make with
        Hyphy is kept there.
      </AuthHeading>

      <AuthCard className="mb-8">
        <div className="mb-5 flex items-center gap-3">
          <SpaceMark space={space} size="lg" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Personal</p>
            <p className="truncate text-[13px] text-muted">
              {session.account?.email ?? person.email} · Owner
            </p>
          </div>
        </div>
        {session.account ? (
          <DisplayNameForm name={person.name} compact />
        ) : (
          <p className="text-[13.5px] text-muted">
            In Demo Mode you’re {person.name}; a real account sets its own name here.
          </p>
        )}
      </AuthCard>

      <h2 className="label mb-3 px-1">What would you like to do first?</h2>
      <Starters workspace={workspace} />
      <Link
        href="/create-business"
        className="mt-6 flex items-center gap-3.5 rounded-[16px] bg-ink p-4 text-white shadow-lift transition-transform active:scale-[.99]"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-white/10">
          <Icon name="building" size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Running a business?</span>
          <span className="block text-[13px] text-white/65">
            Create a shared Space for your team — it takes a few seconds.
          </span>
        </span>
        <Icon name="arrow-right" size={17} />
      </Link>
      <p className="mt-7 text-center">
        <Link
          href="/personal"
          className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[14px] font-medium text-muted transition-colors hover:text-ink"
        >
          Skip to Home
        </Link>
      </p>
    </AuthColumn>
  );
}
