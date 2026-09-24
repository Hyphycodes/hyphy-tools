import Link from 'next/link';
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
          <p className="text-[13.5px] text-muted">{person.email}</p>
          <p className="mt-1 text-[12.5px] text-faint">{person.headline}</p>
        </div>
        {session.source === 'demo' && <Badge tone="caution">Demo identity</Badge>}
      </Panel>
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
      <p className="mt-5 text-[13px] leading-relaxed text-muted">
        {session.source === 'demo'
          ? 'You’re using a Demo Mode identity. When sign-in arrives, this page shows your real account, and the same Spaces and roles come from your memberships.'
          : 'Signed in.'}
      </p>
    </Page>
  );
}
