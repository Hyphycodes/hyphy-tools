import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import { can as roleCan, ROLE_ORDER, roles, type Permission } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';

export const metadata = { title: 'People' };

const matrix: { label: string; permission: Permission }[] = [
  { label: 'Submit receipts and miles', permission: 'expenses.submit' },
  { label: 'Upload files and photos', permission: 'files.upload' },
  { label: 'See every project', permission: 'projects.view_all' },
  { label: 'Approve receipts and miles', permission: 'expenses.approve' },
  { label: 'Manage vehicles', permission: 'vehicles.manage' },
  { label: 'Add people and change roles', permission: 'people.manage' },
  { label: 'Turn tools on and off', permission: 'space.manage' },
  { label: 'Change the plan', permission: 'space.billing' },
];

export default async function PeoplePage({ params, searchParams }: PageProps<'/[space]/people'>) {
  const { workspace, repo, base, can } = await openPage(params, 'people');
  const view = String((await searchParams).role ?? 'all');
  const [members, projects, vehicles] = await Promise.all([
    repo.members(),
    repo.projects(),
    repo.vehicles(),
  ]);
  const shown = members
    .filter((member) => view === 'all' || member.role === view)
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.person.name.localeCompare(b.person.name),
    );
  const counts = new Map(
    ROLE_ORDER.map((role) => [role, members.filter((member) => member.role === role).length]),
  );

  return (
    <Page wide>
      <PageHeader
        title="People"
        description={`Everyone in ${workspace.space.name}, and what each of them can see.`}
        actions={
          <CreateButton request="person" variant="primary" icon="user-plus">
            Add person
          </CreateButton>
        }
      />
      <div className="mb-5">
        <Chips
          active={view}
          items={[
            { id: 'all', label: 'Everyone', href: `${base}/people`, count: members.length },
            ...ROLE_ORDER.filter((role) => counts.get(role)).map((role) => ({
              id: role,
              label: `${roles[role].label}s`,
              href: `${base}/people?role=${role}`,
              count: counts.get(role),
            })),
          ]}
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel className="self-start overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_110px] gap-4 border-b border-line bg-subtle px-4 py-2.5 lg:grid">
            {['Person', 'Working on', 'Vehicle', 'Role'].map((heading) => (
              <span key={heading} className="label">
                {heading}
              </span>
            ))}
          </div>
          <ul className="row-divide">
            {shown.map((member) => {
              const working = projects.filter(
                (project) =>
                  project.status !== 'done' &&
                  (project.teamIds.includes(member.personId) ||
                    member.projectIds?.includes(project.id)),
              );
              const vehicle = vehicles.find((item) => item.assignedTo === member.personId);
              return (
                <li key={member.id}>
                  <Link
                    href={`${base}/people/${member.personId}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 transition-colors hover:bg-subtle lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_110px_110px]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar person={member.person} size="md" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                          <span className="truncate">{member.person.name}</span>
                          {member.personId === workspace.person.id && (
                            <span className="text-[12px] font-normal text-faint">You</span>
                          )}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted">
                          {member.title}
                          {member.status === 'invited' && ' · Invited'}
                        </span>
                      </span>
                    </span>
                    <span className="hidden truncate text-[13px] text-ink-2 lg:block">
                      {working.length ? (
                        working.map((project) => project.name).join(', ')
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </span>
                    <span className="hidden truncate text-[13px] text-ink-2 lg:block">
                      {vehicle?.name ?? <span className="text-faint">—</span>}
                    </span>
                    <span className="flex justify-end lg:justify-start">
                      {member.status === 'invited' ? (
                        <Badge tone="outline">Invited</Badge>
                      ) : (
                        <Badge
                          tone={
                            member.role === 'guest'
                              ? 'signal'
                              : member.role === 'owner'
                                ? 'ink'
                                : 'neutral'
                          }
                        >
                          {roles[member.role].label}
                        </Badge>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel className="self-start">
          <PanelHeader title="Who can do what" />
          <p className="px-4 text-[13px] text-muted">
            Five roles, in plain words. A role belongs to a Space, not a person.
          </p>
          <div className="mt-3 overflow-x-auto px-2 pb-3">
            <table className="w-full min-w-[320px] text-[12.5px]">
              <thead>
                <tr>
                  <th className="sr-only">Can</th>
                  {ROLE_ORDER.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className="px-1 pb-2 text-center font-medium text-muted"
                    >
                      <span
                        className={cn(
                          'inline-block',
                          workspace.membership.role === role &&
                            'rounded-full bg-ink px-1.5 text-white',
                        )}
                      >
                        {roles[role].label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.permission} className="border-t border-line">
                    <th scope="row" className="py-2 pr-2 pl-2 text-left font-normal text-ink-2">
                      {row.label}
                    </th>
                    {ROLE_ORDER.map((role: Role) => (
                      <td key={role} className="text-center">
                        {roleCan({ role }, row.permission) ? (
                          <Icon
                            name="check"
                            size={15}
                            className="mx-auto text-positive"
                            label="Yes"
                          />
                        ) : (
                          <span className="text-faint" aria-label="No">
                            ·
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 px-2 text-[12px] leading-snug text-faint">
              Guests only open projects shared with them.{' '}
              {can('people.manage')
                ? 'Change anyone’s role from their profile.'
                : 'Owners and admins manage roles.'}
            </p>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
