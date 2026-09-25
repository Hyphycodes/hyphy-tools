import { CreateButton } from '@/components/create/create-button';
import { ReviewButtons } from '@/components/records/inbox-actions';
import { MileageRow } from '@/components/records/rows';
import { CsvButton } from '@/components/tools/csv-button';
import { ToolHeader } from '@/components/tools/tool-header';
import { EmptyState } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { cn } from '@/components/ui/cn';
import { formatMiles, formatNumber, formatRelative, plural } from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';
import type { MileageEntry } from '@/lib/platform/types';

export const metadata = { title: 'Mileage' };

/** Logged in the last couple of minutes: shown arriving, so the trip visibly lands. */
function isFresh(at: string) {
  return Date.now() - new Date(at).getTime() < 120_000;
}

export default async function MileagePage({ params }: PageProps<'/[space]/tools/mileage'>) {
  const { workspace, repo, people, tz, can } = await openPage(params, 'mileage');
  const [entries, vehicles, projects] = await Promise.all([
    repo.mileage(),
    repo.vehicles(),
    repo.projects(),
  ]);
  const business = workspace.space.kind === 'business';
  const approver = business && can('expenses.approve');
  const pending = entries.filter((entry) => entry.status === 'submitted');

  const monthKey = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: tz }).format(
      new Date(iso),
    );
  const months = new Map<string, MileageEntry[]>();
  for (const entry of entries)
    months.set(monthKey(entry.date), [...(months.get(monthKey(entry.date)) ?? []), entry]);
  const counted = (list: MileageEntry[]) =>
    list
      .filter((entry) => entry.status !== 'rejected')
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
                        actions={
                          approver && entry.status === 'submitted' ? (
                            <ReviewButtons
                              slug={workspace.space.slug}
                              table="mileage"
                              id={entry.id}
                              label={`${formatMiles(entry.miles)} · ${entry.to}`}
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
    </Page>
  );
}
