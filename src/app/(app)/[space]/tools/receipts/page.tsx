import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreateButton } from '@/components/create/create-button';
import { fieldRows, listLine } from '@/components/fields/field-facts';
import { Relations, relationsOf } from '@/components/records/relations';
import { ReturnedNotice, ReviewActions } from '@/components/records/review';
import { ReceiptPhoto } from '@/components/files/receipt-photo';
import { ReceiptPaper } from '@/components/records/receipt-paper';
import { ReceiptRow } from '@/components/records/rows';
import { SubmissionTimeline } from '@/components/records/timeline';
import { ApprovalBadge } from '@/components/records/status';
import { CsvButton } from '@/components/tools/csv-button';
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
import { viewsFor, type FileView } from '@/lib/files/access';
import { openPage } from '@/lib/page';
import { formatCurrency, formatDateLong, formatNumber } from '@/lib/platform/format';
import { exportField, fieldsFor } from '@/lib/platform/custom-fields';
import { getTool } from '@/lib/platform/tools';
import type {
  ApprovalEvent,
  ApprovalStatus,
  FieldType,
  FileRecord,
  Person,
  Receipt,
} from '@/lib/platform/types';

export const metadata = { title: 'Receipts' };

const views: { id: 'all' | ApprovalStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'submitted', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'returned', label: 'Returned' },
  { id: 'draft', label: 'Drafts' },
];

export default async function ReceiptsPage({
  params,
  searchParams,
}: PageProps<'/[space]/tools/receipts'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'receipts');
  const query = await searchParams;
  const view = String(query.view ?? 'all');
  const [receipts, projects, vehicles, fields] = await Promise.all([
    repo.receipts(),
    repo.projects(),
    repo.vehicles(),
    repo.fields('receipts'),
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
  const lookup = (type: FieldType, value: string) =>
    type === 'person'
      ? people.get(value)?.name
      : type === 'project'
        ? projectName(value)
        : type === 'vehicle'
          ? vehicleName(value)
          : undefined;
  const context = (receipt: Receipt) =>
    [
      vehicleName(receipt.vehicleId),
      projectName(receipt.projectId),
      ...listLine(fields, 'receipts', receipt.custom, lookup, tz),
    ]
      .filter(Boolean)
      .join(' · ') || (business ? 'Not assigned' : undefined);
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
  const history = selected ? await repo.approvalHistory(selected.id) : [];
  // The receipt's own photo, as the person looking may open it (the photo follows the receipt).
  const photo = selected?.fileId ? await repo.file(selected.fileId) : null;
  const photoView = photo ? (await viewsFor(workspace, [photo]))[photo.id] : undefined;
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
    .filter((receipt) => receipt.gallons && receipt.status !== 'returned')
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

  // The complete records, with every field the business asks for (or asked for, where answered).
  const exported = fields.filter(
    (field) =>
      !field.archivedAt ||
      receipts.some((receipt) => fieldsFor([field], 'receipts', receipt.custom).length),
  );
  const csv: (string | number)[][] = [
    [
      'Date',
      'Person',
      'Vendor',
      'Category',
      'Total',
      'Paid with',
      'Vehicle',
      'Project',
      'Status',
      'Note',
      ...exported.map((field) => field.label),
    ],
    ...receipts.map((receipt) => [
      new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(receipt.date)),
      people.get(receipt.createdBy)?.name ?? '',
      receipt.vendor,
      categoryLabel[receipt.category],
      receipt.total.toFixed(2),
      receipt.paymentMethod ?? '',
      vehicleName(receipt.vehicleId) ?? '',
      projectName(receipt.projectId) ?? '',
      receipt.status,
      receipt.notes ?? '',
      ...exported.map((field) => exportField(field, receipt.custom?.[field.id], lookup)),
    ]),
  ];

  return (
    <Page wide>
      <ToolHeader
        tool={getTool('receipts')!}
        actions={
          <>
            {/* An export is a desk job; on phones the one big action stays alone. */}
            <span className="hidden sm:contents">
              <CsvButton rows={csv} name={`receipts-${workspace.space.slug}.csv`} />
            </span>
            <CreateButton request="receipt" variant="primary" icon="camera">
              {business && !approver ? 'Submit receipt' : 'Scan receipt'}
            </CreateButton>
          </>
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
                      approver &&
                      receipt.status === 'submitted' &&
                      receipt.createdBy !== workspace.person.id ? (
                        <ReviewActions
                          slug={workspace.space.slug}
                          subject={{
                            kind: 'receipt',
                            id: receipt.id,
                            title: receipt.vendor,
                            amount: formatCurrency(receipt.total),
                          }}
                          from={people.get(receipt.createdBy)}
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
            approver &&
            selected.status === 'submitted' &&
            selected.createdBy !== workspace.person.id ? (
              <ReviewActions
                slug={workspace.space.slug}
                size="md"
                subject={{
                  kind: 'receipt',
                  id: selected.id,
                  title: selected.vendor,
                  amount: formatCurrency(selected.total),
                }}
                from={people.get(selected.createdBy)}
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
            slug={workspace.space.slug}
            viewerId={workspace.person.id}
            relations={relationsOf(selected, { people, projects, vehicles })}
            canOpenPeople={can('people.view') && workspace.space.modules.includes('people')}
            history={history}
            extra={fieldRows(fields, 'receipts', selected.custom, lookup, tz)}
            photo={photo && (photo.status ?? 'ready') === 'ready' ? photo : null}
            photoView={photoView}
          />
        </UrlSheet>
      )}
    </Page>
  );
}

function ReceiptDetail({
  receipt,
  tz,
  business,
  people,
  base,
  slug,
  viewerId,
  relations,
  canOpenPeople,
  history,
  extra,
  photo,
  photoView,
}: {
  receipt: Receipt;
  photo: FileRecord | null;
  photoView: FileView | undefined;
  base: string;
  tz: string;
  business: boolean;
  people: Map<string, Person>;
  slug: string;
  viewerId: string;
  relations: ReturnType<typeof relationsOf>;
  canOpenPeople: boolean;
  history: ApprovalEvent[];
  /** What the business asks for on a receipt, answered: "Cost Code · 200 — Materials". */
  extra: [string, string][];
}) {
  const reviewer = receipt.reviewedBy ? people.get(receipt.reviewedBy) : undefined;
  const rows: [string, ReactNode][] = [
    ...extra,
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
  ];
  const mine = receipt.createdBy === viewerId;

  return (
    <div className="grid gap-5 pt-1">
      {mine && (receipt.status === 'returned' || receipt.status === 'draft') && (
        <ReturnedNotice
          slug={slug}
          inboxId={receipt.status === 'returned' ? `rt_${receipt.id}` : undefined}
          reason={receipt.status === 'returned' ? receipt.returnReason || undefined : undefined}
          reviewer={receipt.status === 'returned' ? reviewer : undefined}
          edit={{ kind: 'receipt', record: receipt }}
          draft={receipt.status === 'draft'}
        />
      )}
      {photo && <ReceiptPhoto file={photo} view={photoView} />}
      <div className="flex items-center gap-5 rounded-[18px] bg-tool-receipt/30 p-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] sm:p-5">
        {!photo && <ReceiptPaper receipt={receipt} timezone={tz} className="-rotate-2" />}
        <div className="min-w-0">
          <p className="label !text-ink/55">Total</p>
          <p className="display mt-1 text-[34px] leading-none text-ink">
            {receipt.total ? formatCurrency(receipt.total) : '—'}
          </p>
          <div className="mt-3">
            <ApprovalBadge status={receipt.status} kind={business ? 'business' : 'personal'} />
          </div>
        </div>
      </div>

      {relations.length > 0 && (
        <Relations
          items={relations}
          base={base}
          canOpen={{ person: canOpenPeople && business }}
          label="Belongs to"
        />
      )}

      <dl className="row-divide rounded-[14px] bg-subtle px-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      {receipt.notes && (
        <p className="rounded-[14px] bg-subtle px-3.5 py-3 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
          “{receipt.notes}”
        </p>
      )}

      {business && (
        <SubmissionTimeline record={receipt} events={history} people={people} timezone={tz} />
      )}

      {!photo && (
        <p className="text-[12px] text-faint">
          {receipt.fileId
            ? 'Its photo isn’t available to you.'
            : 'No photo with this receipt — the paper above is drawn from its details.'}
        </p>
      )}
    </div>
  );
}
