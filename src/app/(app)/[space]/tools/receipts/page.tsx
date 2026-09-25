import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreateButton } from '@/components/create/create-button';
import { ReviewButtons } from '@/components/records/inbox-actions';
import { ReceiptPaper } from '@/components/records/receipt-paper';
import { ReceiptRow } from '@/components/records/rows';
import { ApprovalBadge } from '@/components/records/status';
import { ToolHeader } from '@/components/tools/tool-header';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import { Page } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Chips } from '@/components/ui/tabs';
import { UrlSheet } from '@/components/ui/url-sheet';
import { categoryLabel, monthSummary } from '@/lib/insights';
import { openPage } from '@/lib/page';
import {
  formatCurrency,
  formatDateLong,
  formatNumber,
  formatRelative,
} from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';
import type { ApprovalStatus, Person, Receipt } from '@/lib/platform/types';

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
  const query = await searchParams;
  const view = String(query.view ?? 'all');
  const [receipts, projects, vehicles] = await Promise.all([
    repo.receipts(),
    repo.projects(),
    repo.vehicles(),
  ]);
  const business = workspace.space.kind === 'business';
  const approver = business && can('expenses.approve');
  const month = monthSummary({ receipts, mileage: [], files: [] }, tz);
  const pending = receipts.filter((receipt) => receipt.status === 'submitted');
  // Waiting items lead the list, so an approver works top-down without a second list.
  const shown = receipts
    .filter((receipt) => view === 'all' || receipt.status === view)
    .sort(
      (a, b) =>
        Number(approver && b.status === 'submitted') -
          Number(approver && a.status === 'submitted') || b.date.localeCompare(a.date),
    );
  const vehicleName = (id?: string) => vehicles.find((vehicle) => vehicle.id === id)?.name;
  const projectName = (id?: string) => projects.find((project) => project.id === id)?.name;
  const context = (receipt: Receipt) =>
    [vehicleName(receipt.vehicleId), projectName(receipt.projectId)].filter(Boolean).join(' · ') ||
    (business ? 'Not assigned' : undefined);
  const href = (params: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({
      view: view === 'all' ? undefined : view,
      ...params,
    }))
      if (value) next.set(key, value);
    const text = next.toString();
    return `${base}/tools/receipts${text ? `?${text}` : ''}`;
  };

  const selected =
    typeof query.receipt === 'string' ? await repo.receipt(query.receipt) : undefined;
  const history = selected
    ? await repo.activity({ about: { type: 'receipt', id: selected.id } })
    : [];
  // Who is waiting on a decision, and for how much — an approver's real queue.
  const waitingBy = [
    ...pending
      .reduce((map, receipt) => {
        const entry = map.get(receipt.createdBy) ?? { count: 0, total: 0 };
        map.set(receipt.createdBy, { count: entry.count + 1, total: entry.total + receipt.total });
        return map;
      }, new Map<string, { count: number; total: number }>())
      .entries(),
  ]
    .map(([id, entry]) => ({ person: people.get(id), ...entry }))
    .filter((entry): entry is { person: Person; count: number; total: number } =>
      Boolean(entry.person),
    )
    .sort((a, b) => b.total - a.total);
  const gallons = receipts
    .filter((receipt) => receipt.gallons && receipt.status !== 'rejected')
    .reduce((sum, receipt) => sum + (receipt.gallons ?? 0), 0);

  const stats: [string, string, string, string?][] = [
    ['This month', formatCurrency(month.spend, { cents: false }), `${month.receipts} receipts`],
    business
      ? [
          approver ? 'Waiting on you' : 'Waiting for approval',
          String(pending.length),
          pending.length
            ? formatCurrency(pending.reduce((sum, receipt) => sum + receipt.total, 0))
            : 'All caught up',
          pending.length ? 'signal' : undefined,
        ]
      : [
          'Needs details',
          String(receipts.filter((receipt) => receipt.status === 'draft').length),
          'drafts',
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
      `${formatNumber(gallons, 1)} gal logged`,
    ],
  ];

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
        {stats.map(([label, value, note, tone], index) => (
          <div key={label} className={cn('bg-surface px-4 py-3.5', index > 1 && 'hidden sm:block')}>
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              {tone && <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />}
              {label}
            </p>
            <p
              className={cn(
                'mt-1 text-[22px] leading-none font-semibold tracking-[-0.02em]',
                tone && 'text-signal-ink',
              )}
            >
              {value}
            </p>
            <p className="mt-1 text-[12px] text-faint">{note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
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
                  label: business ? item.label : item.id === 'draft' ? 'Needs details' : item.label,
                  href: href({ view: item.id === 'all' ? undefined : item.id }),
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
                    context={context(receipt)}
                    href={href({ receipt: receipt.id })}
                    actions={
                      approver && receipt.status === 'submitted' ? (
                        <ReviewButtons
                          slug={workspace.space.slug}
                          table="receipts"
                          id={receipt.id}
                          label={`${receipt.vendor} · ${formatCurrency(receipt.total)}`}
                        />
                      ) : undefined
                    }
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon="receipt"
                title={view === 'all' ? 'No receipts yet' : 'Nothing here'}
                action={
                  view === 'all' ? (
                    <CreateButton request="receipt" variant="primary">
                      Add your first
                    </CreateButton>
                  ) : undefined
                }
              >
                {view === 'all'
                  ? `Snap a receipt and it’s filed here${business ? ', with the vehicle and project it belongs to' : ''}.`
                  : 'No receipts with this status.'}
              </EmptyState>
            )}
          </Panel>
        </div>
        <aside className="hidden content-start gap-4 xl:grid">
          {approver && waitingBy.length > 0 && (
            <Panel className="p-4">
              <p className="flex items-baseline justify-between gap-2 text-[14px] font-semibold">
                Waiting, by person
                <span className="text-[12.5px] font-normal text-muted">
                  {formatCurrency(pending.reduce((sum, receipt) => sum + receipt.total, 0))}
                </span>
              </p>
              <ul className="mt-2.5 grid gap-0.5">
                {waitingBy.map(({ person, count, total }) => (
                  <li key={person.id}>
                    <Link
                      href={
                        can('people.view')
                          ? `${base}/people/${person.id}`
                          : href({ view: 'submitted' })
                      }
                      className="-mx-2 flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 transition-colors hover:bg-subtle"
                    >
                      <Avatar person={person} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                        {person.name}
                      </span>
                      <span className="text-[12px] text-muted">{count}</span>
                      <span className="num w-[68px] text-right text-[13px] font-medium">
                        {formatCurrency(total)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-snug text-faint">
                Approved receipts count toward their project and vehicle; returned ones go back with
                your note.
              </p>
            </Panel>
          )}
          {business && !approver ? (
            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="shield" size={15} className="text-muted" /> How approval works
              </p>
              <ol className="mt-3 grid gap-2.5 text-[13px] text-ink-2">
                {[
                  ['Submit', 'A photo, the total and where it goes.'],
                  ['Review', 'A manager approves it or sends it back with a note.'],
                  ['Counted', 'Approved receipts add up on projects and vehicles.'],
                ].map(([title, line], index) => (
                  <li key={title} className="flex gap-2.5">
                    <span className="mono-num grid size-5 shrink-0 place-items-center rounded-full bg-tool-receipt text-[10px] font-semibold text-ink">
                      {index + 1}
                    </span>
                    <span>
                      <span className="font-medium text-ink">{title}.</span>{' '}
                      <span className="text-muted">{line}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 border-t border-line pt-3 text-[12.5px] text-faint">
                {can('expenses.view_all')
                  ? 'You see everyone’s receipts here.'
                  : 'You see your own receipts here.'}
              </p>
            </Panel>
          ) : business ? null : (
            <Panel className="p-4">
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Icon name="lock" size={15} className="text-muted" /> Just for you
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Receipts in your Personal Space are private. Export them at tax time, or keep a
                running record of what the car and the side business cost.
              </p>
            </Panel>
          )}
        </aside>
      </div>

      {selected && (
        <UrlSheet
          key={selected.id}
          closeHref={href({ receipt: undefined })}
          title={selected.vendor}
          description={`${formatDateLong(selected.date, tz)} · ${categoryLabel[selected.category]}`}
          leading={<ToolGlyph tool={getTool('receipts')!} size="md" />}
          footer={
            approver && selected.status === 'submitted' ? (
              <ReviewButtons
                slug={workspace.space.slug}
                table="receipts"
                id={selected.id}
                label={`${selected.vendor} · ${formatCurrency(selected.total)}`}
              />
            ) : undefined
          }
        >
          <ReceiptDetail
            receipt={selected}
            base={base}
            tz={tz}
            business={business}
            people={people}
            vehicle={vehicleName(selected.vehicleId)}
            project={projectName(selected.projectId)}
            reviewedAt={
              history.find((event) => event.verb === 'approved' || event.verb === 'rejected')?.at
            }
          />
        </UrlSheet>
      )}
    </Page>
  );
}

function ReceiptDetail({
  receipt,
  base,
  tz,
  business,
  people,
  vehicle,
  project,
  reviewedAt,
}: {
  receipt: Receipt;
  base: string;
  tz: string;
  business: boolean;
  people: Map<string, Person>;
  vehicle?: string;
  project?: string;
  reviewedAt?: string;
}) {
  const by = people.get(receipt.createdBy);
  const reviewer = receipt.reviewedBy ? people.get(receipt.reviewedBy) : undefined;
  const rows: [string, ReactNode][] = [
    ['Paid with', receipt.paymentMethod ?? '—'],
    ...(receipt.gallons
      ? ([
          ['Gallons', `${receipt.gallons} gal`],
          [
            'Price per gallon',
            receipt.total ? `$${(receipt.total / receipt.gallons).toFixed(3)}` : '—',
          ],
        ] as [string, ReactNode][])
      : []),
    ...(receipt.odometer
      ? ([['Odometer', `${formatNumber(receipt.odometer)} mi`]] as [string, ReactNode][])
      : []),
    ...(business
      ? ([
          [
            'Vehicle',
            vehicle && receipt.vehicleId ? (
              <Link href={`${base}/vehicles/${receipt.vehicleId}`} className="hover:underline">
                {vehicle}
              </Link>
            ) : (
              <span className="text-muted">None</span>
            ),
          ],
          [
            'Project',
            project && receipt.projectId ? (
              <Link href={`${base}/projects/${receipt.projectId}`} className="hover:underline">
                {project}
              </Link>
            ) : (
              <span className="text-muted">None</span>
            ),
          ],
        ] as [string, ReactNode][])
      : []),
  ];
  const steps: { label: string; detail: string; done: boolean; tone?: 'critical' }[] = business
    ? [
        {
          label:
            receipt.status === 'draft'
              ? 'Saved as a draft'
              : `Submitted by ${by?.firstName ?? 'someone'}`,
          detail: formatRelative(receipt.createdAt, tz),
          done: true,
        },
        receipt.status === 'approved'
          ? {
              label: `Approved${reviewer ? ` by ${reviewer.firstName}` : ''}`,
              detail: reviewedAt
                ? formatRelative(reviewedAt, tz)
                : 'Counted on its project and vehicle',
              done: true,
            }
          : receipt.status === 'rejected'
            ? {
                label: `Returned${reviewer ? ` by ${reviewer.firstName}` : ''}`,
                detail: receipt.notes ?? (reviewedAt ? formatRelative(reviewedAt, tz) : ''),
                done: true,
                tone: 'critical',
              }
            : {
                label: receipt.status === 'draft' ? 'Not sent yet' : 'Waiting for a manager',
                detail:
                  receipt.status === 'draft'
                    ? 'Add the total, then submit'
                    : 'Usually within a day',
                done: false,
              },
      ]
    : [];

  return (
    <div className="grid gap-5 pt-1">
      <div className="flex items-center gap-5 rounded-[18px] bg-tool-receipt/30 p-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] sm:p-5">
        <ReceiptPaper receipt={receipt} timezone={tz} className="-rotate-2" />
        <div className="min-w-0">
          <p className="label !text-ink/55">Total</p>
          <p className="display mt-1 text-[34px] leading-none text-ink">
            {receipt.total ? formatCurrency(receipt.total) : '—'}
          </p>
          <div className="mt-3">
            <ApprovalBadge status={receipt.status} kind={business ? 'business' : 'personal'} />
          </div>
          {by && business && (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-ink/60">
              <Avatar person={by} size="xs" /> {by.name}
            </p>
          )}
        </div>
      </div>

      <dl className="row-divide rounded-[14px] bg-subtle px-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {receipt.notes && receipt.status !== 'rejected' && (
        <p className="rounded-[14px] bg-subtle px-3.5 py-3 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
          “{receipt.notes}”
        </p>
      )}

      {steps.length > 0 && (
        <section aria-label="Status">
          <p className="label mb-2.5">Status</p>
          <ol className="grid gap-0">
            {steps.map((step, index) => (
              <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                {index < steps.length - 1 && (
                  <span
                    className="absolute top-6 bottom-0 left-[11px] w-px bg-line-strong"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    'relative grid size-6 shrink-0 place-items-center rounded-full',
                    step.done
                      ? step.tone === 'critical'
                        ? 'bg-critical text-white'
                        : 'bg-ink text-white'
                      : 'bg-surface text-muted shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
                  )}
                >
                  <Icon
                    name={step.done ? (step.tone === 'critical' ? 'arrow-left' : 'check') : 'clock'}
                    size={12}
                    strokeWidth={2.4}
                  />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-[14px] font-medium text-ink">{step.label}</span>
                  {step.detail && (
                    <span className="block text-[12.5px] text-muted">{step.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-[12px] text-faint">
        In this preview, Hyphy keeps a receipt’s details, not the photo.
      </p>
    </div>
  );
}
