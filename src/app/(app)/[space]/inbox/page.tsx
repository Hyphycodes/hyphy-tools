import { InboxList, inboxKinds } from '@/components/records/inbox-list';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import { permissionsFor, roles, type Permission } from '@/lib/platform/roles';
import type { Role } from '@/lib/platform/types';

export const metadata = { title: 'Inbox' };

const groups = ['Approvals', 'Documents', 'People', 'Mentions', 'Updates'] as const;

/** Needs Attention: approvals, documents, requests and mentions — only the ones for this person. */
export default async function InboxPage({ params, searchParams }: PageProps<'/[space]/inbox'>) {
  const { workspace, repo, base, directory, can } = await openPage(params);
  const view = String((await searchParams).view ?? 'open');
  const all = await repo.inbox({ includeDone: true });
  const open = all.filter((item) => item.status === 'open');
  const counts = new Map(
    groups.map((group) => [
      group,
      open.filter((item) => inboxKinds[item.kind].label === group).length,
    ]),
  );
  const shown =
    view === 'done'
      ? all.filter((item) => item.status === 'done')
      : view === 'open'
        ? open
        : open.filter((item) => inboxKinds[item.kind].label === view);

  const audience = (permission: Permission) =>
    (Object.keys(roles) as Role[])
      .filter((role) => role !== 'guest' && permissionHolders[role].includes(permission))
      .map((role) => roles[role].label);
  const business = workspace.space.kind === 'business';

  return (
    <Page wide>
      <PageHeader
        title="Inbox"
        description={
          business
            ? `What needs you in ${workspace.space.name}. Approve, answer or clear it here.`
            : 'Reminders about your own things: documents running out, receipts missing details.'
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-4">
            <Chips
              active={view}
              items={[
                { id: 'open', label: 'Needs attention', href: `${base}/inbox`, count: open.length },
                ...groups
                  .filter((group) => counts.get(group))
                  .map((group) => ({
                    id: group,
                    label: group,
                    href: `${base}/inbox?view=${group}`,
                    count: counts.get(group),
                  })),
                { id: 'done', label: 'Done', href: `${base}/inbox?view=done` },
              ]}
            />
          </div>
          <Panel>
            {shown.length ? (
              <InboxList
                items={shown}
                people={directory}
                base={base}
                slug={workspace.space.slug}
                canApprove={can('expenses.approve')}
                timezone={workspace.space.timezone}
              />
            ) : (
              <EmptyState
                icon="check-circle"
                title={view === 'done' ? 'Nothing cleared yet' : 'You’re all caught up'}
              >
                {view === 'done'
                  ? 'Items you approve or mark done move here.'
                  : 'New approvals, documents and mentions arrive here first.'}
              </EmptyState>
            )}
          </Panel>
        </div>
        {business && (
          <aside className="grid content-start gap-3">
            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="shield" size={16} className="text-muted" /> Who sees what here
              </p>
              <ul className="mt-3 grid gap-3 text-[13px] leading-snug">
                <li>
                  <span className="font-medium text-ink">Approvals</span>
                  <span className="block text-muted">
                    {audience('expenses.approve').join(', ')}
                  </span>
                </li>
                <li>
                  <span className="font-medium text-ink">Documents</span>
                  <span className="block text-muted">{audience('files.manage').join(', ')}</span>
                </li>
                <li>
                  <span className="font-medium text-ink">Access requests</span>
                  <span className="block text-muted">{audience('people.manage').join(', ')}</span>
                </li>
                <li>
                  <span className="font-medium text-ink">Mentions and returned items</span>
                  <span className="block text-muted">Only the person they’re for</span>
                </li>
              </ul>
              <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-muted">
                You’re a{' '}
                <span className="font-medium text-ink">
                  {roles[workspace.membership.role].label}
                </span>{' '}
                here, so you see{' '}
                {can('expenses.approve')
                  ? 'approvals and your own items.'
                  : 'only items meant for you.'}
              </p>
            </Panel>
          </aside>
        )}
      </div>
    </Page>
  );
}

const permissionHolders = Object.fromEntries(
  (Object.keys(roles) as Role[]).map((role) => [role, permissionsFor({ role })]),
) as Record<Role, Permission[]>;
