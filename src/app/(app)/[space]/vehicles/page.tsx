import Link from 'next/link';
import { CreateButton } from '@/components/create/create-button';
import { VehicleSwatch } from '@/components/records/rows';
import { VehicleStatusBadge } from '@/components/records/status';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty';
import { Icon } from '@/components/ui/icon';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { daysUntil, formatCurrency, formatNumber, startOfMonth } from '@/lib/platform/format';

export const metadata = { title: 'Vehicles' };

export default async function VehiclesPage({ params }: PageProps<'/[space]/vehicles'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'vehicles');
  const [vehicles, receipts, mileage, files] = await Promise.all([
    repo.vehicles(),
    repo.receipts(),
    repo.mileage(),
    repo.files(),
  ]);
  const since = startOfMonth(tz);
  const month = (iso: string) => new Date(iso).getTime() >= since;

  return (
    <Page wide>
      <PageHeader
        title="Vehicles"
        description={
          can('vehicles.view_all')
            ? `Who has which vehicle, what it’s costing and what’s coming due in ${workspace.space.name}.`
            : 'The vehicle assigned to you.'
        }
        actions={
          <CreateButton request="vehicle" variant="primary" icon="plus">
            Add vehicle
          </CreateButton>
        }
      />
      {vehicles.length === 0 ? (
        <Panel>
          <EmptyState icon="truck" title="No vehicle assigned to you">
            When a manager assigns you a vehicle, its fuel, miles and papers show up here.
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {vehicles.map((vehicle, index) => {
            const driver = vehicle.assignedTo ? people.get(vehicle.assignedTo) : undefined;
            const fuel = receipts.filter(
              (receipt) =>
                receipt.vehicleId === vehicle.id &&
                month(receipt.date) &&
                receipt.status !== 'returned',
            );
            const miles = mileage
              .filter((entry) => entry.vehicleId === vehicle.id && month(entry.date))
              .reduce((sum, entry) => sum + entry.miles, 0);
            const toService = vehicle.nextServiceMiles
              ? vehicle.nextServiceMiles - vehicle.odometer
              : null;
            const expiring = files
              .filter(
                (file) => file.expiresAt && file.attachedTo.some((ref) => ref.id === vehicle.id),
              )
              .map((file) => daysUntil(file.expiresAt!))
              .filter((days) => days <= 30);
            return (
              <Link
                key={vehicle.id}
                href={`${base}/vehicles/${vehicle.id}`}
                className="group flex min-w-0 animate-rise flex-col rounded-[18px] bg-surface p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <div className="flex items-start gap-3">
                  <VehicleSwatch vehicle={vehicle} size="lg" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{vehicle.name}</h2>
                    <p className="truncate text-[13px] text-muted">
                      {vehicle.year} {vehicle.make} {vehicle.model}
                    </p>
                    <p className="mono-num mt-1 text-[11.5px] text-faint">{vehicle.plate}</p>
                  </div>
                  <VehicleStatusBadge status={vehicle.status} />
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 rounded-[12px] bg-subtle p-3 text-[12px]">
                  <div>
                    <dt className="text-muted">Odometer</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold">
                      {formatNumber(vehicle.odometer)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Fuel · month</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold">
                      {formatCurrency(
                        fuel.reduce((sum, receipt) => sum + receipt.total, 0),
                        { cents: false },
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Miles · month</dt>
                    <dd className="mt-0.5 text-[14px] font-semibold">
                      {formatNumber(Math.round(miles))}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  {driver ? (
                    <span className="flex items-center gap-2 text-[13px]">
                      <Avatar person={driver} size="sm" /> {driver.name}
                    </span>
                  ) : (
                    <span className="text-[13px] text-muted">Shared · unassigned</span>
                  )}
                  <span className="flex gap-1.5">
                    {toService !== null && toService < 1000 && (
                      <span className="flex items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution">
                        <Icon name="wrench" size={12} /> {formatNumber(toService)} mi to service
                      </span>
                    )}
                    {expiring.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-critical-soft px-2 py-0.5 text-[11.5px] font-medium text-critical">
                        <Icon name="clock" size={12} /> Papers due
                      </span>
                    )}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
