import Link from 'next/link';
import { InboxList, inboxKinds } from '@/components/records/inbox-list';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import { formatCurrency, plural } from '@/lib/platform/format';
import { roles } from '@/lib/platform/roles';
import type { InboxItem } from '@/lib/platform/types';

export const metadata = { title: 'Inbox' };

const groups = ['Approvals', 'Documents', 'People', 'Mentions', 'Updates'] as const;

/** Needs Attention: approvals, documents, requests and mentions — only the ones for this person. */
export default async function InboxPage({ params, searchParams }: PageProps<'/[space]/inbox'>) {
  const { workspace, repo, base, directory, can } = await openPage(params);
  const view = String((await searchParams).view ?? 'open').toLowerCase();
  const [all, receipts] = await Promise.all([
    repo.inbox({ includeDone: true }),
    repo.receipts({ status: 'submitted' }),
  ]);
  const open = all.filter((item) => item.status === 'open');
  const groupOf = (item: InboxItem) => inboxKinds[item.kind].label;
  const counts = new Map(
    groups.map((group) => [group, open.filter((item) => groupOf(item) === group).length]),
  );
  const shown =
    view === 'done'
      ? all.filter((item) => item.status === 'done')
      : view === 'open'
        ? open
        : open.filter((item) => groupOf(item).toLowerCase() === view);
  const business = workspace.space.kind === 'business';
  const canApprove = can('expenses.approve');

  // Grouped so the eye lands on one kind of decision at a time; anything urgent leads.
  const sections =
    view === 'open' || view === 'done'
      ? groups
          .map((group) => ({ group, items: shown.filter((item) => groupOf(item) === group) }))
          .filter((section) => section.items.length)
          .sort(
            (a, b) =>
              Number(b.items.some((item) => item.priority === 'high')) -
              Number(a.items.some((item) => item.priority === 'high')),
          )
      : [
          {
            group: groups.find((group) => group.toLowerCase() === view) ?? 'Approvals',
            items: shown,
          },
        ];
  const waiting = receipts.reduce((sum, receipt) => sum + receipt.total, 0);
  const summary = (group: string, items: InboxItem[]) =>
    group === 'Approvals' && canApprove && waiting
      ? `${plural(items.length, 'item')} · ${formatCurrency(waiting)} in receipts`
      : plural(items.length, 'item');

  return (
    <Page narrow>
      <PageHeader
        title="Inbox"
        description={
          open.length
            ? business
              ? `${plural(open.length, 'thing')} ${open.length === 1 ? 'needs' : 'need'} you in ${workspace.space.name}. Approve, answer or clear them here.`
              : 'Reminders about your own things: documents running out, receipts missing details.'
            : 'Nothing needs you right now.'
        }
      />
      <div className="mb-4">
        <Chips
          active={view}
          items={[
            { id: 'open', label: 'Needs attention', href: `${base}/inbox`, count: open.length },
            ...groups
              .filter((group) => counts.get(group))
              .map((group) => ({
                id: group.toLowerCase(),
                label: group,
                href: `${base}/inbox?view=${group.toLowerCase()}`,
                count: counts.get(group),
              })),
            { id: 'done', label: 'Done', href: `${base}/inbox?view=done` },
          ]}
        />
      </div>

      {shown.length ? (
        <div className="grid gap-4">
          {sections.map((section) => (
            <Panel key={section.group} aria-label={section.group}>
              <header className="flex items-baseline gap-2 px-4 pt-3.5 pb-1">
                <h2 className="text-[14px] font-semibold text-ink">{section.group}</h2>
                <span className="text-[12.5px] text-muted">
                  {summary(section.group, section.items)}
                </span>
              </header>
              <InboxList
                items={section.items}
                people={directory}
                base={base}
                slug={workspace.space.slug}
                canApprove={canApprove}
                timezone={workspace.space.timezone}
              />
            </Panel>
          ))}
        </div>
      ) : (
        <Panel>
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span
              className={cn(
                'mb-5 grid size-16 place-items-center rounded-full',
                view === 'done' ? 'bg-well text-muted' : 'bg-positive-soft text-positive',
              )}
            >
              <Icon name={view === 'done' ? 'archive' : 'check'} size={28} strokeWidth={2.2} />
            </span>
            <p className="display text-[26px] text-ink">
              {view === 'done' ? 'Nothing cleared yet' : 'You’re all caught up'}
            </p>
            <p className="mt-2 max-w-[42ch] text-[14.5px] leading-relaxed text-muted">
              {view === 'done'
                ? 'Items you approve or mark done move here.'
                : 'New approvals, documents and mentions arrive here first.'}
            </p>
            {view !== 'done' && (
              <Link
                href={`${base}/activity`}
                className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink-2 hover:text-ink"
              >
                See what happened today <Icon name="arrow-right" size={14} />
              </Link>
            )}
          </div>
        </Panel>
      )}

      {business && (
        <p className="mt-5 flex items-start gap-2 px-1 text-[12.5px] leading-relaxed text-muted">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0" />
          <span>
            You’re{' '}
            {workspace.membership.role === 'owner' || workspace.membership.role === 'admin'
              ? 'an'
              : 'a'}{' '}
            {roles[workspace.membership.role].label} here, so you see{' '}
            {canApprove
              ? 'approvals, documents and anything meant for you.'
              : 'only what’s meant for you.'}{' '}
            Mentions and returned items go only to the person they’re for.
          </span>
        </p>
      )}
    </Page>
  );
}
