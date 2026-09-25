import Link from 'next/link';
import { DisplayNameForm, NewPasswordForm } from '@/components/auth/forms';
import { signOut } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { plans } from '@/lib/platform/plans';
import { roles } from '@/lib/platform/roles';

export const metadata = { title: 'Profile' };

/** One person, many Spaces: the identity that stays the same wherever you are. */
export default async function ProfilePage({ params }: PageProps<'/[space]/profile'>) {
  const { workspace } = await openPage(params);
  const { person, session } = workspace;
  const { account } = session;
  return (
    <Page>
      <PageHeader
        title="Profile & Spaces"
        description="One identity. Your role changes with the Space you’re in."
      />
      <Panel className="mb-5 flex items-center gap-4 p-5">
        <Avatar person={person} size="xl" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold">{person.name}</h2>
          <p className="text-[13.5px] text-muted">{account?.email ?? person.email}</p>
          <p className="mt-1 text-[12.5px] text-faint">{person.headline}</p>
        </div>
        {!account && <Badge tone="caution">Demo identity</Badge>}
      </Panel>
      {account && (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Account" />
            <div className="grid gap-5 px-4 pb-5">
              <DisplayNameForm name={person.name} compact />
              <div className="grid gap-1.5">
                <p className="text-[13.5px] font-medium text-ink-2">Email</p>
                <div className="flex min-w-0 items-center justify-between gap-3 rounded-[11px] bg-subtle px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
                  <span className="truncate text-[15px] lg:text-[14px]">{account.email}</span>
                  <span className="shrink-0 text-[12px] text-muted">Managed by your account</span>
                </div>
                <p className="text-[12.5px] leading-snug text-muted">
                  The address you sign in with. It’s the same in every Space.
                </p>
              </div>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Password" />
            <div className="px-4 pb-5">
              <NewPasswordForm intent="change-password" />
            </div>
          </Panel>
        </div>
      )}
      <Panel>
        <PanelHeader title="Your Spaces" count={session.memberships.length} />
        <ul className="row-divide">
          {session.memberships.map((membership) => (
            <li key={membership.id}>
              <Link
                href={`/${membership.space.slug}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-subtle"
              >
                <SpaceMark space={membership.space} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{membership.space.name}</span>
                  <span className="block truncate text-[12.5px] text-muted">
                    {membership.space.kind === 'personal' ? 'Just you' : membership.title} ·{' '}
                    {plans[membership.space.plan].name}
                  </span>
                </span>
                <Badge
                  tone={
                    membership.role === 'owner'
                      ? 'ink'
                      : membership.role === 'guest'
                        ? 'signal'
                        : 'neutral'
                  }
                >
                  {membership.space.kind === 'personal' ? 'Personal' : roles[membership.role].label}
                </Badge>
                <Icon name="chevron-right" size={16} className="text-faint" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      {account ? (
        <form action={signOut} className="mt-5 flex items-center justify-between gap-4">
          <p className="text-[13px] leading-relaxed text-muted">
            Signing out ends this session on this device. Your Spaces and work stay as they are.
          </p>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      ) : (
        <p className="mt-5 text-[13px] leading-relaxed text-muted">
          You’re using a Demo Mode identity. With real accounts, this page shows your account —
          name, sign-in email and password — and the same Spaces and roles come from your
          memberships.
        </p>
      )}
    </Page>
  );
}
