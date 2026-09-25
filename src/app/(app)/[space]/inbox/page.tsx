import Link from 'next/link';
import { ApprovalQueue } from '@/components/records/approval-queue';
import { InboxList } from '@/components/records/inbox-list';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { openPage } from '@/lib/page';
import type { Submission } from '@/lib/platform/approvals';
import { formatCurrency, plural } from '@/lib/platform/format';
import { inboxGroups, inboxLook, type InboxGroup } from '@/lib/platform/inbox';
import { roles } from '@/lib/platform/roles';
import type { InboxItem } from '@/lib/platform/types';

export const metadata = { title: 'Inbox' };

const groups = inboxGroups;
/** `to fix` → `to-fix`, for URLs. */
const slugOf = (group: string) => group.toLowerCase().replace(/\s+/g, '-');

/**
 * Needs Attention: the owner's work queue and everyone's to-do list. Approvals, things sent back
 * to fix, documents, requests and mentions — only the ones for this person.
 */
export default async function InboxPage({ params, searchParams }: PageProps<'/[space]/inbox'>) {
  const { workspace, repo, base, directory, can, people } = await openPage(params);
  const query = await searchParams;
  const view = String(query.view ?? 'open').toLowerCase();
  // "View pending submissions" from a person's page lands here, filtered to them.
  const from = typeof query.from === 'string' ? query.from : undefined;
  const me = workspace.person.id;
  const [everything, receipts, mine, myTrips] = await Promise.all([
    repo.inbox({ includeDone: true }),
    repo.receipts({ status: 'submitted' }),
    repo.receipts({ createdBy: me }),
    repo.mileage({ createdBy: me }),
  ]);
  const all = from ? everything.filter((item) => item.fromId === from) : everything;
  const open = all.filter((item) => item.status === 'open');
  const groupOf = (item: InboxItem): InboxGroup => inboxLook(item).group;
  const counts = new Map(
    groups.map((group) => [group, open.filter((item) => groupOf(item) === group).length]),
  );
  const shown =
    view === 'done'
      ? all.filter((item) => item.status === 'done')
      : view === 'open'
        ? open
        : open.filter((item) => slugOf(groupOf(item)) === view);
  const business = workspace.space.kind === 'business';
  const canApprove = can('expenses.approve');

  // Grouped so the eye lands on one kind of decision at a time: what you must fix, then what
  // waits on your decision, then anything urgent, then the rest.
  const rank = (section: { group: InboxGroup; items: InboxItem[] }) =>
    section.group === 'To fix'
      ? 0
      : section.group === 'Approvals'
        ? 1
        : section.items.some((item) => item.priority === 'high')
          ? 2
          : 3;
  const sections =
    view === 'open' || view === 'done'
      ? groups
          .map((group) => ({ group, items: shown.filter((item) => groupOf(item) === group) }))
          .filter((section) => section.items.length)
          .sort((a, b) => rank(a) - rank(b))
      : [
          {
            group: groups.find((group) => slugOf(group) === view) ?? 'Approvals',
            items: shown,
          },
        ];
  const waiting = receipts
    .filter((receipt) => !from || receipt.createdBy === from)
    .reduce((sum, receipt) => sum + receipt.total, 0);
  const sender = from ? people.get(from) : undefined;
  const summary = (group: string, items: InboxItem[]) =>
    group === 'Approvals' && canApprove && waiting
      ? `${plural(items.length, 'item')} · ${formatCurrency(waiting)} in receipts`
      : plural(items.length, 'item');

  return (
    <Page narrow>
      <PageHeader
        title="Inbox"
        description={
          sender
            ? `What ${sender.firstName} sent that ${open.length === 1 ? 'needs' : 'need'} you.`
            : open.length
              ? business
                ? `${plural(open.length, 'thing')} ${open.length === 1 ? 'needs' : 'need'} you in ${workspace.space.name}. Approve, answer or clear them here.`
                : 'Reminders about your own things: documents running out, receipts missing details.'
              : 'Nothing needs you right now.'
        }
      />
      <div className="mb-4">
        <Chips
          active={sender && view === 'open' ? 'from' : view}
          items={[
            ...(sender
              ? [{ id: 'from', label: `From ${sender.firstName} ✕`, href: `${base}/inbox` }]
              : []),
            { id: 'open', label: 'Needs attention', href: `${base}/inbox`, count: open.length },
            ...groups
              .filter((group) => counts.get(group))
              .map((group) => ({
                id: slugOf(group),
                label: group,
                href: `${base}/inbox?view=${slugOf(group)}`,
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
              {section.group === 'Approvals' && canApprove && view !== 'done' ? (
                <ApprovalQueue
                  items={section.items as (InboxItem & { submission: Submission })[]}
                  people={directory}
                  base={base}
                  slug={workspace.space.slug}
                  timezone={workspace.space.timezone}
                />
              ) : (
                <InboxList
                  items={section.items}
                  people={directory}
                  base={base}
                  slug={workspace.space.slug}
                  canApprove={canApprove}
                  timezone={workspace.space.timezone}
                  records={{ receipts: mine, mileage: myTrips }}
                />
              )}
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
