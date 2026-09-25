import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreateButton } from '@/components/create/create-button';
import { Facts, fieldRows } from '@/components/fields/field-facts';
import { EditRecordFields } from '@/components/fields/record-fields';
import { ActivityList } from '@/components/records/activity-list';
import { FileRow, MileageRow, ReceiptRow, VehicleSwatch } from '@/components/records/rows';
import { VehicleStatusBadge } from '@/components/records/status';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { thisMonth, vehicleProject } from '@/lib/insights';
import { viewsFor } from '@/lib/files/access';
import { openPage } from '@/lib/page';
import { formFields } from '@/lib/platform/custom-fields';
import { vehicleWords } from '@/lib/platform/terms';
import { formatCurrency, formatMiles, formatNumber, plural } from '@/lib/platform/format';
import type { FieldType } from '@/lib/platform/types';

export async function generateMetadata({ params }: PageProps<'/[space]/vehicles/[id]'>) {
  const { repo } = await openPage(params);
  return { title: (await repo.vehicle((await params).id))?.name ?? 'Vehicle' };
}

export default async function VehiclePage({ params }: PageProps<'/[space]/vehicles/[id]'>) {
  const { workspace, repo, base, people, tz, directory, can } = await openPage(params, 'vehicles');
  const { id } = await params;
  const vehicle = await repo.vehicle(id);
  if (!vehicle) notFound();
  const [receipts, mileage, files, activity, projects, fields, vehicles] = await Promise.all([
    repo.receipts({ vehicleId: id }),
    repo.mileage({ vehicleId: id }),
    repo.files({ attachedTo: { type: 'vehicle', id } }),
    repo.activity({ about: { type: 'vehicle', id } }),
    repo.projects(),
    repo.fields('vehicles'),
    repo.vehicles(),
  ]);
  const fileViews = await viewsFor(workspace, files);
  const driver = vehicle.assignedTo ? people.get(vehicle.assignedTo) : undefined;
  const fuel = receipts.filter(
    (receipt) => receipt.category === 'fuel' && receipt.status !== 'returned',
  );
  const monthFuel = thisMonth(fuel, tz);
  const monthTrips = thisMonth(
    mileage.filter((entry) => entry.status !== 'returned'),
    tz,
  );
  const monthMiles = Math.round(monthTrips.reduce((sum, entry) => sum + entry.miles, 0) * 10) / 10;
  const current = vehicleProject(vehicle, projects, receipts, mileage);
  const projectName = (projectId?: string) =>
    projects.find((project) => project.id === projectId)?.name;
  // Miles per gallon from consecutive fill-ups that recorded the odometer.
  const fills = fuel
    .filter((receipt) => receipt.odometer && receipt.gallons)
    .sort((a, b) => a.odometer! - b.odometer!);
  const mpg =
    fills.length > 1
      ? (fills.at(-1)!.odometer! - fills[0].odometer!) /
        fills.slice(1).reduce((sum, receipt) => sum + receipt.gallons!, 0)
      : null;
  const toService = vehicle.nextServiceMiles ? vehicle.nextServiceMiles - vehicle.odometer : null;
  const lookup = (type: FieldType, value: string) =>
    type === 'project'
      ? projects.find((project) => project.id === value)?.name
      : type === 'person'
        ? people.get(value)?.name
        : type === 'vehicle'
          ? vehicles.find((item) => item.id === value)?.name
          : undefined;
  const details = fieldRows(fields, 'vehicles', vehicle.custom, lookup, tz);
  const editable = can('vehicles.manage')
    ? formFields(fields, 'vehicles', workspace.space.modules)
    : [];
  const words = vehicleWords(workspace.space);

  return (
    <Page wide>
      <Link
        href={`${base}/vehicles`}
        className="group mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
      >
        <Icon
          name="arrow-left"
          size={15}
          className="transition-transform group-hover:-translate-x-0.5"
        />{' '}
        {words.plural}
      </Link>
      <header className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-4">
          <VehicleSwatch vehicle={vehicle} size="lg" />
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <VehicleStatusBadge status={vehicle.status} />
              <span className="mono-num text-[11.5px] text-faint">
                {vehicle.plate} · VIN …{vehicle.vinLast6}
              </span>
            </div>
            <h1 className="display text-[32px] sm:text-[40px]">{vehicle.name}</h1>
            <p className="text-[14px] text-muted">
              {vehicle.year} {vehicle.make} {vehicle.model} · {vehicle.fuel}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateButton
            request={{
              id: 'receipt',
              attachTo: { type: 'vehicle', id },
              preset: { category: 'fuel' },
            }}
            icon="fuel"
            size="sm"
          >
            Add fuel receipt
          </CreateButton>
          <CreateButton
            request={{ id: 'mileage', attachTo: { type: 'vehicle', id } }}
            icon="route"
            size="sm"
          >
            Log mileage
          </CreateButton>
          <CreateButton
            request={{ id: 'file', attachTo: { type: 'vehicle', id } }}
            icon="upload"
            size="sm"
            variant="primary"
          >
            Upload document
          </CreateButton>
        </div>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[16px] bg-line shadow-card sm:grid-cols-5">
        {[
          ['Odometer', `${formatNumber(vehicle.odometer)} mi`, 'last reported'],
          [
            'Next service',
            toService !== null ? `${formatNumber(toService)} mi` : '—',
            vehicle.nextServiceMiles ? `at ${formatNumber(vehicle.nextServiceMiles)}` : '',
          ],
          ['Miles this month', formatMiles(monthMiles), plural(monthTrips.length, 'trip')],
          [
            'Fuel this month',
            formatCurrency(monthFuel.reduce((sum, receipt) => sum + receipt.total, 0)),
            `${monthFuel.length} fill-ups`,
          ],
          [
            'Average',
            mpg ? `${mpg.toFixed(1)} mpg` : '—',
            mpg ? `over ${fills.length} fill-ups` : 'needs two fill-ups',
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-5">
          <Panel>
            <PanelHeader title="Fuel & expenses" count={receipts.length} />
            {receipts.length ? (
              <div className="row-divide pb-1.5">
                {receipts.map((receipt) => (
                  <ReceiptRow
                    key={receipt.id}
                    receipt={receipt}
                    people={people}
                    timezone={tz}
                    kind="business"
                    context={
                      [
                        projectName(receipt.projectId),
                        receipt.odometer ? `${formatNumber(receipt.odometer)} mi` : undefined,
                      ]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    href={`${base}/tools/receipts?receipt=${receipt.id}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState compact icon="fuel" title="No fuel receipts yet" />
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Trips" count={mileage.length} />
            {mileage.length ? (
              <div className="row-divide pb-1.5">
                {mileage.map((entry) => (
                  <MileageRow
                    key={entry.id}
                    entry={entry}
                    people={people}
                    timezone={tz}
                    kind="business"
                    context={projectName(entry.projectId) ?? entry.purpose}
                    href={`${base}/tools/mileage?trip=${entry.id}`}
                  />
                ))}
              </div>
            ) : (
              <EmptyState compact icon="route" title="No trips logged" />
            )}
          </Panel>
        </div>
        <aside className="grid content-start gap-5">
          <Panel className="p-4">
            <p className="label mb-3">Working on</p>
            {current ? (
              <Link
                href={`${base}/projects/${current.id}`}
                className="group flex items-center gap-2.5"
              >
                <span
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ background: current.color }}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold group-hover:underline">
                    {current.name}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted">
                    From its latest trips and fill-ups
                  </span>
                </span>
              </Link>
            ) : (
              <p className="text-[13.5px] text-muted">No open project right now.</p>
            )}
          </Panel>
          <Panel className="p-4">
            <p className="label mb-3">Assigned to</p>
            {driver ? (
              <Link
                href={can('people.view') ? `${base}/people/${driver.id}` : '#'}
                className="flex items-center gap-3"
              >
                <Avatar person={driver} size="lg" />
                <span>
                  <span className="block text-[15px] font-semibold">{driver.name}</span>
                  <span className="block text-[12.5px] text-muted">
                    Fuel card ••{vehicle.fuelCardLast4}
                  </span>
                </span>
              </Link>
            ) : (
              <p className="text-[13.5px] text-muted">
                Nobody — it’s a shared vehicle. Fuel card ••{vehicle.fuelCardLast4}.
              </p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Documents" count={files.length}>
              <CreateButton
                request={{ id: 'file', attachTo: { type: 'vehicle', id: vehicle.id } }}
                size="sm"
                variant="ghost"
                icon="upload"
              >
                Add
              </CreateButton>
            </PanelHeader>
            {files.length ? (
              <div className="pb-1.5">
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    base={base}
                    people={people}
                    timezone={tz}
                    context={file.folder}
                    view={fileViews[file.id]}
                    compact
                  />
                ))}
              </div>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted">
                Registration, insurance cards, inspection reports and photos live here.
              </p>
            )}
          </Panel>
          {(details.length > 0 || editable.length > 0) && (
            <Panel aria-label="Details">
              <PanelHeader title="Details">
                <EditRecordFields
                  type="vehicles"
                  id={vehicle.id}
                  fields={editable}
                  values={vehicle.custom}
                  title={vehicle.name}
                />
              </PanelHeader>
              {details.length ? (
                <Facts rows={details} className="px-4 pb-2" />
              ) : (
                <p className="px-4 pb-4 text-[13px] text-muted">Nothing filled in yet.</p>
              )}
            </Panel>
          )}
          <Panel>
            <PanelHeader title="Activity" />
            {activity.length ? (
              <div className="pb-2">
                <ActivityList
                  compact
                  events={activity.slice(0, 6)}
                  people={directory}
                  base={base}
                  viewerId={workspace.person.id}
                  timezone={tz}
                />
              </div>
            ) : (
              <p className="px-4 pb-4 text-[13px] text-muted">Nothing yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </Page>
  );
}
