import { CreateButton } from '@/components/create/create-button';
import { ReviewButtons } from '@/components/records/inbox-actions';
import { MileageRow } from '@/components/records/rows';
import { CsvButton } from '@/components/tools/csv-button';
import { ToolHeader } from '@/components/tools/tool-header';
import { EmptyState } from '@/components/ui/empty';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { formatMiles, formatNumber } from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';
import type { MileageEntry } from '@/lib/platform/types';

export const metadata = { title: 'Mileage' };

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
        {[
          [
            'This month',
            formatMiles(Math.round(counted(thisMonth) * 10) / 10),
            `${thisMonth.length} trips`,
          ],
          [
            'All time here',
            formatMiles(Math.round(counted(entries) * 10) / 10),
            `${entries.length} trips`,
          ],
          [
            business ? 'Pending' : 'Round trips',
            String(business ? pending.length : entries.filter((entry) => entry.roundTrip).length),
            business ? (approver ? 'waiting on you' : 'awaiting approval') : 'this Space',
          ],
          [
            'Longest trip',
            entries.length ? formatMiles(Math.max(...entries.map((entry) => entry.miles))) : '—',
            '',
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

      {approver && pending.length > 0 && (
        <Panel className="mb-5">
          <PanelHeader title="Waiting on you" count={pending.length} />
          <ul className="row-divide pb-1">
            {pending.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:pr-4"
              >
                <div className="min-w-0 flex-1">
                  <MileageRow entry={entry} people={people} timezone={tz} kind="business" />
                </div>
                <div className="ml-[68px] pb-3 sm:ml-0 sm:pb-0">
                  <ReviewButtons
                    slug={workspace.space.slug}
                    table="mileage"
                    id={entry.id}
                    label={`${formatMiles(entry.miles)} · ${entry.to}`}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

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
                {list.map((entry) => (
                  <MileageRow
                    key={entry.id}
                    entry={entry}
                    people={people}
                    timezone={tz}
                    kind={workspace.space.kind}
                  />
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </Page>
  );
}
