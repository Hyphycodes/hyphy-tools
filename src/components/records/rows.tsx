import Link from 'next/link';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import {
  daysUntil,
  formatBytes,
  formatCurrency,
  formatDate,
  formatMiles,
  formatNumber,
  formatRelative,
} from '@/lib/platform/format';
import type {
  FileRecord,
  MileageEntry,
  Person,
  Project,
  Receipt,
  SpaceKind,
  Vehicle,
} from '@/lib/platform/types';
import { ApprovalBadge, ProjectStatusBadge, VehicleStatusBadge } from './status';

/* ---------- files ---------- */

const fileIcon = {
  pdf: 'pdf',
  image: 'image',
  archive: 'archive',
  sheet: 'file-text',
  doc: 'file-text',
} as const;
const fileTint = {
  pdf: { bg: '#FFE4DA', fg: '#B8401C' },
  image: { bg: '#FFF1CC', fg: '#8A5A00' },
  archive: { bg: '#ECE6FF', fg: '#5B3FC4' },
  sheet: { bg: '#DDF5EA', fg: '#13784A' },
  doc: { bg: '#E6EAF2', fg: '#3B4A63' },
} as const;

export function FileThumb({
  file,
  size = 'md',
}: {
  file: Pick<FileRecord, 'kind' | 'preview' | 'name'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'lg'
      ? 'size-14 rounded-[14px]'
      : size === 'sm'
        ? 'size-8 rounded-[9px]'
        : 'size-10 rounded-[11px]';
  if (file.kind === 'image' && file.preview)
    return (
      <span
        className={cn('block shrink-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)]', box)}
        style={{ background: file.preview }}
        aria-hidden="true"
      />
    );
  const tint = fileTint[file.kind];
  return (
    <span
      className={cn('grid shrink-0 place-items-center', box)}
      style={{ background: tint.bg, color: tint.fg }}
      aria-hidden="true"
    >
      <Icon name={fileIcon[file.kind]} size={size === 'lg' ? 24 : size === 'sm' ? 15 : 18} />
    </span>
  );
}

export function FileRow({
  file,
  base,
  people,
  timezone,
  context,
}: {
  file: FileRecord;
  base: string;
  people: Map<string, Person>;
  timezone: string;
  context?: string;
}) {
  const by = people.get(file.createdBy);
  const expires = file.expiresAt ? daysUntil(file.expiresAt) : null;
  return (
    <Link
      href={`${base}/files?file=${file.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle"
    >
      <FileThumb file={file} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{file.name}</p>
        <p className="truncate text-[12.5px] text-muted">
          {[context, by?.firstName, formatRelative(file.createdAt, timezone)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {expires !== null && expires <= 30 && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution sm:flex">
          <Icon name="clock" size={12} /> {expires <= 0 ? 'Expired' : `${expires}d left`}
        </span>
      )}
      <span className="mono-num hidden shrink-0 text-[11.5px] text-faint sm:block">
        {formatBytes(file.size)}
      </span>
    </Link>
  );
}

/* ---------- projects ---------- */

export function ProjectRow({
  project,
  base,
  people,
  timezone,
  spent,
}: {
  project: Project;
  base: string;
  people: Map<string, Person>;
  timezone: string;
  spent?: number;
}) {
  const team = project.teamIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const due = project.dueDate ?? project.startDate;
  const days = daysUntil(due);
  const upcoming = !project.dueDate;
  return (
    <Link
      href={`${base}/projects/${project.id}`}
      className="group grid grid-cols-[4px_1fr_auto] items-center gap-x-3.5 px-4 py-3 transition-colors hover:bg-subtle sm:grid-cols-[4px_minmax(0,1fr)_150px_auto]"
    >
      <span
        className="h-9 w-1 rounded-full"
        style={{ background: project.color }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="flex items-center gap-2 truncate text-[14.5px] font-medium text-ink">
          <span className="truncate">{project.name}</span>
          {project.status !== 'active' && <ProjectStatusBadge status={project.status} />}
        </p>
        <p className="truncate text-[12.5px] text-muted">
          {[
            project.location,
            spent ? `${formatCurrency(spent, { cents: false })} spent` : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="hidden items-center gap-2.5 sm:flex">
        <Progress
          value={project.progress}
          color={project.color}
          className="flex-1"
          label={`${project.name} progress`}
        />
        <span className="w-8 text-right text-[12px] text-muted">{project.progress}%</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:block">
          <AvatarStack people={team} max={3} size="sm" />
        </span>
        <span
          className={cn(
            'w-[74px] text-right text-[12px]',
            !upcoming && days < 0 && project.status !== 'done' ? 'text-critical' : 'text-muted',
          )}
        >
          {project.status === 'done'
            ? formatDate(due, timezone)
            : upcoming
              ? days <= 0
                ? 'Today'
                : `In ${days}d`
              : days < 0
                ? `${-days}d late`
                : `Due in ${days}d`}
        </span>
      </div>
    </Link>
  );
}

/* ---------- vehicles ---------- */

export function VehicleSwatch({
  vehicle,
  size = 'md',
}: {
  vehicle: Pick<Vehicle, 'color' | 'name'>;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center text-ink-2 shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)]',
        size === 'lg' ? 'size-14 rounded-[15px]' : 'size-10 rounded-[11px]',
      )}
      style={{
        background: `linear-gradient(145deg, ${vehicle.color}, color-mix(in oklab, ${vehicle.color}, black 18%))`,
      }}
      aria-hidden="true"
    >
      <span className="grid size-[70%] place-items-center rounded-[9px] bg-white/85">
        <Icon name="truck" size={size === 'lg' ? 22 : 17} />
      </span>
    </span>
  );
}

export function VehicleRow({
  vehicle,
  base,
  people,
}: {
  vehicle: Vehicle;
  base: string;
  people: Map<string, Person>;
}) {
  const driver = vehicle.assignedTo ? people.get(vehicle.assignedTo) : undefined;
  const toService = vehicle.nextServiceMiles ? vehicle.nextServiceMiles - vehicle.odometer : null;
  return (
    <Link
      href={`${base}/vehicles/${vehicle.id}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle"
    >
      <VehicleSwatch vehicle={vehicle} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{vehicle.name}</p>
        <p className="truncate text-[12.5px] text-muted">
          {driver ? driver.name : vehicle.status === 'in-shop' ? 'In the shop' : 'Unassigned'} ·{' '}
          <span className="num">{formatNumber(vehicle.odometer)}</span> mi
        </p>
      </div>
      {toService !== null && toService < 1000 ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution">
          <Icon name="wrench" size={12} /> Service soon
        </span>
      ) : vehicle.status !== 'active' ? (
        <VehicleStatusBadge status={vehicle.status} />
      ) : driver ? (
        <Avatar person={driver} size="sm" />
      ) : null}
    </Link>
  );
}

/* ---------- expenses ---------- */

const categoryIcon = {
  fuel: 'fuel',
  materials: 'wrench',
  meals: 'receipt',
  supplies: 'archive',
  equipment: 'wrench',
  other: 'receipt',
} as const;

export function ReceiptRow({
  receipt,
  people,
  timezone,
  kind,
  showPerson = true,
  context,
}: {
  receipt: Receipt;
  people: Map<string, Person>;
  timezone: string;
  kind: SpaceKind;
  showPerson?: boolean;
  context?: string;
}) {
  const by = people.get(receipt.createdBy);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-tool-receipt/70 text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.05)]">
        <Icon name={categoryIcon[receipt.category]} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{receipt.vendor}</p>
        <p className="truncate text-[12.5px] text-muted">
          {[
            showPerson && kind === 'business' ? by?.firstName : undefined,
            context,
            receipt.gallons ? `${receipt.gallons} gal` : undefined,
            formatDate(receipt.date, timezone),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[14px] font-medium text-ink">
          {receipt.total ? formatCurrency(receipt.total) : '—'}
        </span>
        <ApprovalBadge status={receipt.status} kind={kind} />
      </div>
    </div>
  );
}

export function MileageRow({
  entry,
  people,
  timezone,
  kind,
  showPerson = true,
}: {
  entry: MileageEntry;
  people: Map<string, Person>;
  timezone: string;
  kind: SpaceKind;
  showPerson?: boolean;
}) {
  const by = people.get(entry.createdBy);
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-tool-miles/60 text-ink shadow-[inset_0_0_0_1px_rgb(0_0_0/.05)]">
        <Icon name="route" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">
          {entry.from} <span className="text-faint">→</span> {entry.to}
        </p>
        <p className="truncate text-[12.5px] text-muted">
          {[
            showPerson && kind === 'business' ? by?.firstName : undefined,
            entry.purpose,
            formatDate(entry.date, timezone),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-[14px] font-medium text-ink">
          {formatMiles(entry.miles)}
          {entry.roundTrip && <span className="ml-1 text-[11px] font-normal text-muted">RT</span>}
        </span>
        <ApprovalBadge status={entry.status} kind={kind} />
      </div>
    </div>
  );
}
