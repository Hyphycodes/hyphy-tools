import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { AuthCard, AuthColumn, AuthHeading } from '@/components/auth/frame';
import { CreateBusinessForm } from '@/components/business/create-form';
import { authRoutes } from '@/lib/auth/routes';
import { landingFor, requireSession } from '@/lib/identity';

export const metadata: Metadata = { title: 'Create a business' };

/** A new Business Space, owned by whoever creates it. Their Personal Space stays as it is. */
export default async function CreateBusinessPage() {
  const session = await requireSession(authRoutes.createBusiness);
  const host = (await headers()).get('host')?.replace(/:\d+$/, '') ?? 'hyphy-studio.com';
  const back = await landingFor(session);
  return (
    <AuthColumn wide>
      <AuthHeading eyebrow="New business" title="Create a business.">
        A shared Space for your team: people, projects, files and approvals. Your Personal Space
        stays just yours.
      </AuthHeading>
      <AuthCard>
        <CreateBusinessForm host={host} />
      </AuthCard>
      <p className="mt-6 text-center">
        <Link
          href={back}
          className="rounded-[8px] px-2 py-1 text-[14px] font-medium text-muted transition-colors hover:text-ink"
        >
          Not now
        </Link>
      </p>
    </AuthColumn>
  );
}
