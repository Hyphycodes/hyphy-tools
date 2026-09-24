import { CreateButton } from '@/components/create/create-button';
import { ReviewButtons } from '@/components/records/inbox-actions';
import { ReceiptRow } from '@/components/records/rows';
import { ToolHeader } from '@/components/tools/tool-header';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { categoryLabel, monthSummary } from '@/lib/insights';
import { openPage } from '@/lib/page';
import { formatCurrency } from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';
import type { ApprovalStatus } from '@/lib/platform/types';

export const metadata = { title: 'Receipts' };

const views: { id: 'all' | ApprovalStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Returned' },
  { id: 'draft', label: 'Drafts' },
];

export default async function ReceiptsPage({
  params,
  searchParams,
}: PageProps<'/[space]/tools/receipts'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'receipts');
  const view = String((await searchParams).view ?? 'all');
  const [receipts, projects, vehicles] = await Promise.all([
    repo.receipts(),
    repo.projects(),
    repo.vehicles(),
  ]);
  const business = workspace.space.kind === 'business';
  const approver = business && can('expenses.approve');
  const month = monthSummary({ receipts, mileage: [], files: [] }, tz);
  const pending = receipts.filter((receipt) => receipt.status === 'submitted');
  const shown = receipts.filter((receipt) => view === 'all' || receipt.status === view);
  const context = (projectId?: string, vehicleId?: string) =>
    [
      vehicles.find((vehicle) => vehicle.id === vehicleId)?.name,
      projects.find((project) => project.id === projectId)?.name,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <Page wide>
      <ToolHeader
        tool={getTool('receipts')!}
        actions={
          <CreateButton request="receipt" variant="primary" icon="camera">
            {business && !approver ? 'Submit receipt' : 'Scan receipt'}
          </CreateButton>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-line shadow-card sm:grid-cols-4">
        {[
          [
            'This month',
            formatCurrency(month.spend, { cents: false }),
            `${month.receipts} receipts`,
          ],
          [
            business ? 'Pending' : 'Needs details',
            String(
              business
                ? pending.length
                : receipts.filter((receipt) => receipt.status === 'draft').length,
            ),
            business ? (approver ? 'waiting on you' : 'waiting on a manager') : 'drafts',
          ],
          [
            'Biggest category',
            month.categories[0] ? categoryLabel[month.categories[0].category] : '—',
            month.categories[0] ? formatCurrency(month.categories[0].total, { cents: false }) : '',
          ],
          [
            'Fuel',
            formatCurrency(month.categories.find((item) => item.category === 'fuel')?.total ?? 0, {
              cents: false,
            }),
            `${receipts
              .filter((receipt) => receipt.gallons)
              .reduce((sum, receipt) => sum + (receipt.gallons ?? 0), 0)
              .toFixed(1)} gal logged`,
          ],
        ].map(([label, value, note]) => (
          <div key={label} className="bg-surface px-4 py-3.5">
            <p className="text-[12.5px] text-muted">{label}</p>
            <p className="mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em]">
              {value}
            </p>
            <p className="mt-1 text-[12px] text-faint">{note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-5">
          {approver && pending.length > 0 && (
            <Panel>
              <PanelHeader title="Waiting on you" count={pending.length} />
              <ul className="row-divide pb-1">
                {pending.map((receipt) => (
                  <li
                    key={receipt.id}
                    className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:pr-4"
                  >
                    <div className="min-w-0 flex-1">
                      <ReceiptRow
                        receipt={receipt}
                        people={people}
                        timezone={tz}
                        kind="business"
                        context={context(receipt.projectId, receipt.vehicleId) ?? 'Not assigned'}
                      />
                    </div>
                    <div className="ml-[68px] pb-3 sm:ml-0 sm:pb-0">
                      <ReviewButtons
                        slug={workspace.space.slug}
                        table="receipts"
                        id={receipt.id}
                        label={`${receipt.vendor} · ${formatCurrency(receipt.total)}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <div className="min-w-0">
            <div className="mb-3">
              <Chips
                active={view}
                items={views
                  .filter(
                    (item) =>
                      item.id === 'all' || receipts.some((receipt) => receipt.status === item.id),
                  )
                  .filter((item) => business || item.id === 'all' || item.id === 'draft')
                  .map((item) => ({
                    id: item.id,
                    label: business
                      ? item.label
                      : item.id === 'draft'
                        ? 'Needs details'
                        : item.label,
                    href:
                      item.id === 'all'
                        ? `${base}/tools/receipts`
                        : `${base}/tools/receipts?view=${item.id}`,
                    count:
                      item.id === 'all'
                        ? receipts.length
                        : receipts.filter((receipt) => receipt.status === item.id).length,
                  }))}
              />
            </div>
            <Panel>
              {shown.length ? (
                <div className="row-divide py-1">
                  {shown.map((receipt) => (
                    <ReceiptRow
                      key={receipt.id}
                      receipt={receipt}
                      people={people}
                      timezone={tz}
                      kind={workspace.space.kind}
                      context={context(receipt.projectId, receipt.vehicleId)}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon="receipt"
                  title="No receipts yet"
                  action={
                    <CreateButton request="receipt" variant="primary">
                      Add your first
                    </CreateButton>
                  }
                >
                  Snap a receipt and it’s filed here
                  {business ? ', with the vehicle and project it belongs to' : ''}.
                </EmptyState>
              )}
            </Panel>
          </div>
        </div>
        <aside className="grid content-start gap-4">
          <Panel className="p-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <Icon name="sparkles" size={15} className="text-muted" /> Where Receipts comes from
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              Receipts grew out of Gas Receipts, first built for one field team to turn fuel receipt
              photos into spreadsheet rows. Reading the date, station, total and odometer
              automatically is the next piece to move into Hyphy Tools.
            </p>
          </Panel>
          {business && (
            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="shield" size={15} className="text-muted" /> How approval works
              </p>
              <ol className="mt-2 grid gap-1.5 text-[13px] text-muted">
                <li>1 · Members submit; it lands in managers’ Inbox.</li>
                <li>2 · A manager approves or returns it with a note.</li>
                <li>3 · Approved receipts count toward projects and vehicles.</li>
              </ol>
              <p className="mt-3 text-[12.5px] text-faint">
                {can('expenses.view_all')
                  ? 'You see everyone’s receipts.'
                  : 'You see only your own receipts.'}
              </p>
            </Panel>
          )}
        </aside>
      </div>
    </Page>
  );
}
