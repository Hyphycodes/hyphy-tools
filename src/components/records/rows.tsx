import Link from 'next/link';
import type { ReactNode } from 'react';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import {
  daysUntil,
  formatBytes,
  formatCompactMoney,
  formatCurrency,
  formatDate,
  formatMiles,
  formatNumber,
  formatRelative,
} from '@/lib/platform/format';
import type {
  AttachmentRef,
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

const refIcon = {
  project: 'projects',
  vehicle: 'truck',
  person: 'user',
  receipt: 'receipt',
} as const;

export const sourceName: Partial<Record<string, string>> = {
  pdf: 'PDF',
  images: 'Image Resize',
};

/**
 * A file, and what it belongs to. `links` are the records it's attached to (already resolved to
 * names the viewer may see); without them, `context` is shown as plain text.
 */
export function FileRow({
  file,
  base,
  people,
  timezone,
  context,
  links,
  compact = false,
}: {
  file: FileRecord;
  base: string;
  people: Map<string, Person>;
  timezone: string;
  context?: string;
  links?: { type: AttachmentRef['type']; label: string }[];
  /** For narrow panels: no size column. */
  compact?: boolean;
}) {
  const by = people.get(file.createdBy);
  const expires = file.expiresAt ? daysUntil(file.expiresAt) : null;
  const first = links?.[0];
  const made = file.source ? sourceName[file.source] : undefined;
  return (
    <Link
      href={`${base}/files?file=${file.id}`}
      scroll={false}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle"
    >
      <FileThumb file={file} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium text-ink">{file.name}</p>
        {/* Why it exists, then where it belongs, then who and when. */}
        <p className="flex min-w-0 items-center gap-1 text-[12.5px] text-muted">
          {made && (
            <span className="flex shrink-0 items-center gap-1 text-ink-2">
              <Icon name={file.source === 'pdf' ? 'pdf' : 'image'} size={12.5} />
              {first ? made : `Made with ${made}`}
            </span>
          )}
          {first ? (
            <span className="flex min-w-0 items-center gap-1 text-ink-2">
              {made && <span className="text-faint">·</span>}
              <Icon name={refIcon[first.type]} size={12.5} className="shrink-0 text-muted" />
              <span className="truncate">{first.label}</span>
              {links!.length > 1 && (
                <span className="shrink-0 text-faint">+{links!.length - 1}</span>
              )}
            </span>
          ) : !made && context ? (
            <span className="max-w-[60%] shrink-0 truncate">{context}</span>
          ) : null}
          <span className="min-w-0 truncate text-muted">
            {(first || made || context) && '· '}
            {[by?.firstName, formatRelative(file.createdAt, timezone)].filter(Boolean).join(' · ')}
          </span>
        </p>
      </div>
      {expires !== null && expires <= 30 && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-caution-soft px-2 py-0.5 text-[11.5px] font-medium text-caution">
          <Icon name="clock" size={12} /> {expires <= 0 ? 'Expired' : `${expires}d`}
          <span className="hidden sm:inline">{expires > 0 && ' left'}</span>
        </span>
      )}
      {!compact && (
        <span className="mono-num hidden shrink-0 text-[11.5px] text-faint sm:block">
          {formatBytes(file.size)}
        </span>
      )}
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
  compact,
  valueWord,
  pinned,
}: {
  project: Project;
  base: string;
  people: Map<string, Person>;
  timezone: string;
  /** Tracked costs, for people who see money. */
  spent?: number;
  /** What the value is called here ("contract", "booking"); value shows only when passed money. */
  valueWord?: string;
  pinned?: boolean;
  /** For narrow side panels: name and progress stacked, no team column. */
  compact?: boolean;
}) {
  const team = project.teamIds.map((id) => people.get(id)).filter(Boolean) as Person[];
  const due = project.dueDate ?? project.startDate;
  const days = daysUntil(due);
  const upcoming = !project.dueDate;
  const when =
    project.status === 'done'
      ? formatDate(due, timezone)
      : upcoming
        ? days <= 0
          ? 'Today'
          : `In ${days}d`
        : days < 0
          ? `${-days}d late`
          : `Due in ${days}d`;
  if (compact)
    return (
      <Link
        href={`${base}/projects/${project.id}`}
        className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle"
      >
        <span
          className="h-9 w-1 shrink-0 rounded-full"
          style={{ background: project.color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-ink">{project.name}</p>
          {project.progress !== undefined ? (
            <div className="mt-1.5 flex items-center gap-2">
              <Progress
                value={project.progress}
                color={project.color}
                className="flex-1"
                label={`${project.name} progress`}
              />
              <span className="mono-num w-8 text-right text-[11px] text-muted">
                {project.progress}%
              </span>
            </div>
          ) : (
            <p className="truncate text-[12.5px] text-muted">
              {[project.location, formatDate(due, timezone)].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[12px] text-muted">{when}</span>
      </Link>
    );
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
          {pinned && <Icon name="pin" size={13} className="shrink-0 text-faint" label="Pinned" />}
          {project.status !== 'active' && <ProjectStatusBadge status={project.status} />}
        </p>
        <p className="truncate text-[12.5px] text-muted">
          {[
            project.location,
            project.value && valueWord
              ? `${formatCompactMoney(project.value)} ${valueWord}`
              : undefined,
            spent ? `${formatCurrency(spent, { cents: false })} tracked` : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="hidden items-center gap-2.5 sm:flex">
        {project.progress !== undefined ? (
          <>
            <Progress
              value={project.progress}
              color={project.color}
              className="flex-1"
              label={`${project.name} progress`}
            />
            <span className="w-8 text-right text-[12px] text-muted">{project.progress}%</span>
          </>
        ) : (
          <span className="text-[12.5px] text-muted">{formatDate(due, timezone)}</span>
        )}
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
          {when}
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

/** A row with optional inline decisions: under the text on phones, beside it on wider screens. */
function WithActions({ row, actions }: { row: ReactNode; actions?: ReactNode }) {
  if (!actions) return row;
  return (
    <div className="flex flex-wrap items-center sm:flex-nowrap sm:pr-4">
      {row}
      <div className="basis-full pb-3 pl-[68px] sm:basis-auto sm:pb-0 sm:pl-0">{actions}</div>
    </div>
  );
}

function RowShell({ href, children }: { href?: string; children: ReactNode }) {
  const className = 'flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5';
  return href ? (
    <Link href={href} scroll={false} className={cn(className, 'transition-colors hover:bg-subtle')}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function ReceiptRow({
  receipt,
  people,
  timezone,
  kind,
  showPerson = true,
  context,
  href,
  actions,
}: {
  receipt: Receipt;
  people: Map<string, Person>;
  timezone: string;
  kind: SpaceKind;
  showPerson?: boolean;
  context?: string;
  /** Opens the receipt's details. */
  href?: string;
  actions?: ReactNode;
}) {
  const by = people.get(receipt.createdBy);
  return (
    <WithActions
      actions={actions}
      row={
        <RowShell href={href}>
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
            <span className="num text-[14px] font-medium text-ink">
              {receipt.total ? formatCurrency(receipt.total) : '—'}
            </span>
            {!actions && <ApprovalBadge status={receipt.status} kind={kind} />}
          </div>
        </RowShell>
      }
    />
  );
}

export function MileageRow({
  entry,
  people,
  timezone,
  kind,
  showPerson = true,
  context,
  href,
  actions,
}: {
  entry: MileageEntry;
  people: Map<string, Person>;
  timezone: string;
  kind: SpaceKind;
  showPerson?: boolean;
  /** What it belongs to, in words: "Truck 24 · Oak Brook Remodel". */
  context?: string;
  /** Opens the trip's details. */
  href?: string;
  actions?: ReactNode;
}) {
  const by = people.get(entry.createdBy);
  return (
    <WithActions
      actions={actions}
      row={
        <RowShell href={href}>
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
                context ?? entry.purpose,
                formatDate(entry.date, timezone),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="num text-[14px] font-medium text-ink">
              {formatMiles(entry.miles)}
              {entry.roundTrip && (
                <span className="ml-1 text-[11px] font-normal text-muted">RT</span>
              )}
            </span>
            {!actions && <ApprovalBadge status={entry.status} kind={kind} />}
          </div>
        </RowShell>
      }
    />
  );
}
