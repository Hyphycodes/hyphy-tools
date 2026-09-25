import { CreateButton } from '@/components/create/create-button';
import { Relations, relationsOf } from '@/components/records/relations';
import { ReturnedNotice, ReviewActions } from '@/components/records/review';
import { MileageRow } from '@/components/records/rows';
import { ApprovalBadge } from '@/components/records/status';
import { SubmissionTimeline } from '@/components/records/timeline';
import { ToolGlyph } from '@/components/ui/marks';
import { UrlSheet } from '@/components/ui/url-sheet';
import { CsvButton } from '@/components/tools/csv-button';
import { ToolHeader } from '@/components/tools/tool-header';
import { EmptyState } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { cn } from '@/components/ui/cn';
import { tripTitle } from '@/lib/platform/approvals';
import {
  formatCurrency,
  formatDateLong,
  formatMiles,
  formatNumber,
  formatRelative,
  plural,
} from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';
import type { MileageEntry } from '@/lib/platform/types';

export const metadata = { title: 'Mileage' };

/** Logged in the last couple of minutes: shown arriving, so the trip visibly lands. */
function isFresh(at: string) {
  return Date.now() - new Date(at).getTime() < 120_000;
}

export default async function MileagePage({
  params,
  searchParams,
}: PageProps<'/[space]/tools/mileage'>) {
  const { workspace, repo, people, tz, can, base } = await openPage(params, 'mileage');
  const query = await searchParams;
  const [entries, vehicles, projects] = await Promise.all([
    repo.mileage(),
    repo.vehicles(),
    repo.projects(),
  ]);
  const business = workspace.space.kind === 'business';
  const approver = business && can('expenses.approve');
  const pending = entries.filter((entry) => entry.status === 'submitted');
  const me = workspace.person.id;
  const selected =
    typeof query.trip === 'string' ? entries.find((entry) => entry.id === query.trip) : undefined;
  const history = selected
    ? await repo.activity({ about: { type: 'mileage', id: selected.id } })
    : [];
  const tripHref = (id?: string) => `${base}/tools/mileage${id ? `?trip=${id}` : ''}`;
  const context = (entry: MileageEntry) =>
    business
      ? [
          vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.name ?? 'Personal vehicle',
          projects.find((project) => project.id === entry.projectId)?.name,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;
  const rate = workspace.space.mileageRate;

  const monthKey = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: tz }).format(
      new Date(iso),
    );
  const months = new Map<string, MileageEntry[]>();
  for (const entry of entries)
    months.set(monthKey(entry.date), [...(months.get(monthKey(entry.date)) ?? []), entry]);
  const counted = (list: MileageEntry[]) =>
    list
      .filter((entry) => entry.status !== 'returned')
      .reduce((sum, entry) => sum + entry.miles, 0);
  const thisMonth = months.get(monthKey(new Date().toISOString())) ?? [];
  const latest = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
  const year = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: tz }).format(new Date(iso));
  const thisYear = entries.filter((entry) => year(entry.date) === year(new Date().toISOString()));
  // Trips in someone's own car are the ones a business pays back.
  const ownCar = thisYear.filter((entry) => !entry.vehicleId);
  const destinations = new Map<string, number>();
  for (const entry of entries) destinations.set(entry.to, (destinations.get(entry.to) ?? 0) + 1);
  const often = [...destinations.entries()].sort((a, b) => b[1] - a[1])[0];

  const csv: (string | number)[][] = [
    [
      'Date',
      'Person',
      'From',
      'To',
      'Miles',
      'Round trip',
      'Purpose',
      'Vehicle',
      'Project',
      'Status',
    ],
    ...entries.map((entry) => [
      new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(entry.date)),
      people.get(entry.createdBy)?.name ?? '',
      entry.from,
      entry.to,
      entry.miles,
      entry.roundTrip ? 'yes' : 'no',
      entry.purpose,
      vehicles.find((vehicle) => vehicle.id === entry.vehicleId)?.name ?? 'Own car',
      projects.find((project) => project.id === entry.projectId)?.name ?? '',
      entry.status,
    ]),
  ];

  return (
    <Page wide>
      <ToolHeader
        tool={getTool('mileage')!}
        actions={
          <CreateButton request="mileage" variant="primary" icon="route">
            Log a trip
          </CreateButton>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-line shadow-card sm:grid-cols-4">
        {(
          [
            [
              'This month',
              formatMiles(Math.round(counted(thisMonth) * 10) / 10),
              plural(thisMonth.length, 'trip'),
            ],
            business
              ? [
                  approver ? 'Waiting on you' : 'Waiting for approval',
                  String(pending.length),
                  pending.length
                    ? formatMiles(Math.round(counted(pending) * 10) / 10)
                    : 'All caught up',
                  pending.length ? 'signal' : undefined,
                ]
              : [
                  'Most often',
                  often ? often[0].split(',')[0] : '—',
                  often ? plural(often[1], 'trip') : 'No trips yet',
                ],
            [
              'Last trip',
              latest ? formatMiles(latest.miles) : '—',
              latest ? `${latest.to.split(',')[0]} · ${formatRelative(latest.date, tz)}` : '',
            ],
            [
              'This year',
              formatMiles(Math.round(counted(thisYear) * 10) / 10),
              business
                ? `${formatMiles(Math.round(counted(ownCar) * 10) / 10)} in people’s own cars`
                : 'for taxes and reimbursement',
            ],
          ] as [string, string, string, string?][]
        ).map(([label, value, note, tone], index) => (
          <div key={label} className={cn('bg-surface px-4 py-3.5', index > 1 && 'hidden sm:block')}>
            <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
              {tone && <span className="size-1.5 rounded-full bg-signal" aria-hidden="true" />}
              {label}
            </p>
            <p
              className={cn(
                'mt-1 truncate text-[22px] leading-none font-semibold tracking-[-0.02em]',
                tone && 'text-signal-ink',
              )}
            >
              {value}
            </p>
            <p className="mt-1 truncate text-[12px] text-faint">{note}</p>
          </div>
        ))}
      </div>

      {entries.length === 0 ? (
        <Panel>
          <EmptyState
            icon="route"
            title="No trips yet"
            action={
              <CreateButton request="mileage" variant="primary">
                Log your first trip
              </CreateButton>
            }
          >
            Log trips as you go and you’ll have a dated record when it’s time to reimburse or file.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-5">
          {[...months.entries()].map(([month, list], index) => (
            <Panel key={month}>
              <PanelHeader title={month} count={list.length}>
                <span className="ml-auto flex items-center gap-3">
                  <span className="text-[13px] font-medium">
                    {formatNumber(Math.round(counted(list) * 10) / 10, 1)} mi
                  </span>
                  {index === 0 && (
                    <CsvButton rows={csv} name={`mileage-${workspace.space.slug}.csv`} />
                  )}
                </span>
              </PanelHeader>
              <div className="row-divide pb-1.5">
                {[...list]
                  .sort(
                    (a, b) =>
                      Number(approver && b.status === 'submitted') -
                      Number(approver && a.status === 'submitted'),
                  )
                  .map((entry) => (
                    <div key={entry.id} data-fresh={isFresh(entry.createdAt) || undefined}>
                      <MileageRow
                        entry={entry}
                        people={people}
                        timezone={tz}
                        kind={workspace.space.kind}
                        context={context(entry)}
                        href={tripHref(entry.id)}
                        actions={
                          approver && entry.status === 'submitted' && entry.createdBy !== me ? (
                            <ReviewActions
                              slug={workspace.space.slug}
                              subject={{
                                kind: 'mileage',
                                id: entry.id,
                                title: tripTitle(entry),
                                amount: formatMiles(entry.miles),
                              }}
                              from={people.get(entry.createdBy)}
                            />
                          ) : undefined
                        }
                      />
                    </div>
                  ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      {selected && (
        <UrlSheet
          key={selected.id}
          closeHref={tripHref()}
          title={tripTitle(selected)}
          description={`${formatDateLong(selected.date, tz)}${selected.purpose ? ` · ${selected.purpose}` : ''}`}
          leading={<ToolGlyph tool={getTool('mileage')!} size="md" />}
          footer={
            approver && selected.status === 'submitted' && selected.createdBy !== me ? (
              <ReviewActions
                slug={workspace.space.slug}
                size="md"
                subject={{
                  kind: 'mileage',
                  id: selected.id,
                  title: tripTitle(selected),
                  amount: formatMiles(selected.miles),
                }}
                from={people.get(selected.createdBy)}
              />
            ) : undefined
          }
        >
          <div className="grid gap-5 pt-1">
            {selected.createdBy === me && selected.status === 'returned' && (
              <ReturnedNotice
                slug={workspace.space.slug}
                inboxId={`rt_${selected.id}`}
                reason={selected.returnReason || undefined}
                reviewer={selected.reviewedBy ? people.get(selected.reviewedBy) : undefined}
                edit={{ kind: 'mileage', record: selected }}
              />
            )}
            <div className="flex items-center justify-between gap-4 rounded-[18px] bg-tool-miles/35 p-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] sm:p-5">
              <div className="min-w-0">
                <p className="label !text-ink/55">Distance</p>
                <p className="display num mt-1 text-[34px] leading-none text-ink">
                  {formatMiles(selected.miles)}
                </p>
                <p className="mt-1.5 text-[13px] text-ink/60">
                  {selected.roundTrip ? 'Round trip' : 'One way'}
                  {business && !selected.vehicleId && rate
                    ? ` · ${formatCurrency(selected.miles * rate)} paid back at ${formatCurrency(rate)}/mi`
                    : ''}
                </p>
              </div>
              <ApprovalBadge status={selected.status} kind={workspace.space.kind} />
            </div>
            {business && (
              <Relations
                label="Belongs to"
                base={base}
                items={relationsOf(selected, { people, projects, vehicles, trip: true })}
                canOpen={{ person: can('people.view') }}
              />
            )}
            <dl className="row-divide rounded-[14px] bg-subtle px-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
              {[
                ['From', selected.from],
                ['To', selected.to],
                ['Purpose', selected.purpose || '—'],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 py-2.5 text-[13.5px]"
                >
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 truncate text-right font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
            {business && (
              <SubmissionTimeline
                record={selected}
                events={history}
                people={people}
                timezone={tz}
                approvedNote="Counted on its project"
              />
            )}
          </div>
        </UrlSheet>
      )}
    </Page>
  );
}
