import { createHash } from 'node:crypto';
import type {
  ActivityEvent,
  ApprovalEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  Person,
  Project,
  QrCode,
  Receipt,
  Space,
  Vehicle,
} from '@/lib/platform/types';

/*
 * Domain records ⇄ database rows. The database uses snake_case, uuids and nulls; the product
 * uses camelCase, string ids and absent fields. Nothing outside src/lib/data/supabase sees a row.
 */

/**
 * The seeded development world's ids, as uuids. Deterministic, so "mike" or "prj_oakbrook" is
 * the same row after every reset, and tests can address seeded records on either backend.
 */
export function demoUuid(key: string) {
  const hex = createHash('sha256').update(`hyphy-demo:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type Row = Record<string, unknown>;

const iso = (value: unknown) =>
  value === null || value === undefined
    ? undefined
    : value instanceof Date
      ? value.toISOString()
      : new Date(String(value)).toISOString();
const num = (value: unknown) => (value === null || value === undefined ? undefined : Number(value));
const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value));
const json = <T>(value: unknown, fallback: T): T =>
  value === null || value === undefined
    ? fallback
    : typeof value === 'string'
      ? (JSON.parse(value) as T)
      : (value as T);

/** Drops undefined keys, so optional fields stay absent the way they are in Demo Mode. */
function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function personFrom(row: Row): Person {
  const name = String(row.name ?? '');
  const parts = name.trim().split(/\s+/);
  return clean({
    id: String(row.id),
    name,
    firstName: parts[0] ?? name,
    initials: ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase(),
    email: String(row.email),
    hue: String(row.hue),
    headline: str(row.headline),
    phone: str(row.phone),
    timezone: String(row.timezone),
  });
}

export function spaceFrom(row: Row): Space {
  return clean({
    id: String(row.id),
    slug: row.kind === 'personal' ? 'personal' : String(row.slug),
    kind: row.kind as Space['kind'],
    name: String(row.name),
    descriptor: String(row.descriptor ?? ''),
    plan: row.plan as Space['plan'],
    modules: json<Space['modules']>(row.modules, []),
    labels: Object.keys(json(row.labels, {})).length ? json(row.labels, {}) : undefined,
    workStyle: (row.work_style as Space['workStyle']) ?? undefined,
    mileageRate: num(row.mileage_rate),
    brand: json<Space['brand']>(row.brand, { color: '#3240FF', ink: 'light', monogram: 'H' }),
    timezone: String(row.timezone),
    ownerId: str(row.owner_id),
    customFields: Object.keys(json(row.custom_fields, {})).length
      ? json(row.custom_fields, {})
      : undefined,
    createdAt: iso(row.created_at)!,
  });
}

export function membershipFrom(row: Row): Membership {
  const projectIds = json<string[]>(row.project_ids, []);
  const custom = json<Record<string, string | number | boolean | null>>(row.custom, {});
  return clean({
    id: String(row.id),
    spaceId: String(row.space_id),
    personId: String(row.person_id),
    role: row.role as Membership['role'],
    title: String(row.title ?? ''),
    status: row.status as Membership['status'],
    joinedAt: iso(row.joined_at)!,
    projectIds: projectIds.length ? projectIds : undefined,
    department: str(row.department),
    custom: Object.keys(custom).length ? custom : undefined,
  });
}

const owned = (row: Row) => ({
  id: String(row.id),
  spaceId: String(row.space_id),
  createdBy: String(row.created_by),
  createdAt: iso(row.created_at)!,
});

const review = (row: Row) => ({
  status: row.status as Receipt['status'],
  reviewedBy: str(row.reviewed_by),
  reviewedAt: iso(row.reviewed_at),
  returnReason: str(row.return_reason),
  resubmittedAt: iso(row.resubmitted_at),
  returnSeenAt: iso(row.return_seen_at),
});

export function projectFrom(row: Row): Project {
  const custom = json<Project['custom']>(row.custom, {});
  return clean({
    ...owned(row),
    name: String(row.name),
    location: str(row.location),
    client: str(row.client),
    status: row.status as Project['status'],
    summary: String(row.summary ?? ''),
    leadId: String(row.lead_id),
    teamIds: json<string[]>(row.team_ids, []),
    startDate: iso(row.start_date)!,
    dueDate: iso(row.due_date),
    progress: num(row.progress),
    value: num(row.value),
    costAllowance: num(row.cost_allowance),
    color: String(row.color),
    custom: custom && Object.keys(custom).length ? custom : undefined,
  });
}

export function vehicleFrom(row: Row): Vehicle {
  const custom = json<Vehicle['custom']>(row.custom, {});
  return clean({
    ...owned(row),
    name: String(row.name),
    year: Number(row.year),
    make: String(row.make ?? ''),
    model: String(row.model ?? ''),
    plate: String(row.plate ?? '—'),
    vinLast6: String(row.vin_last6 ?? '—'),
    odometer: Number(row.odometer),
    fuel: row.fuel as Vehicle['fuel'],
    status: row.status as Vehicle['status'],
    assignedTo: str(row.assigned_to),
    fuelCardLast4: str(row.fuel_card_last4),
    nextServiceMiles: num(row.next_service_miles),
    color: String(row.color),
    custom: custom && Object.keys(custom).length ? custom : undefined,
  });
}

export function receiptFrom(row: Row): Receipt {
  return clean({
    ...owned(row),
    ...review(row),
    vendor: String(row.vendor),
    category: row.category as Receipt['category'],
    total: Number(row.total),
    date: iso(row.date)!,
    paymentMethod: str(row.payment_method),
    gallons: num(row.gallons),
    odometer: num(row.odometer),
    vehicleId: str(row.vehicle_id),
    projectId: str(row.project_id),
    fileId: str(row.file_id),
    notes: str(row.notes),
  });
}

export function mileageFrom(row: Row): MileageEntry {
  return clean({
    ...owned(row),
    ...review(row),
    date: iso(row.date)!,
    from: String(row.from),
    to: String(row.to),
    miles: Number(row.miles),
    purpose: String(row.purpose ?? ''),
    roundTrip: row.round_trip ? true : undefined,
    vehicleId: str(row.vehicle_id),
    projectId: str(row.project_id),
  });
}

export function fileFrom(row: Row): FileRecord {
  return clean({
    ...owned(row),
    name: String(row.name),
    kind: row.kind as FileRecord['kind'],
    size: Number(row.size),
    folder: String(row.folder),
    attachedTo: json<FileRecord['attachedTo']>(row.attached_to, []),
    access: row.access as FileRecord['access'],
    expiresAt: iso(row.expires_at),
    preview: str(row.preview),
    pages: num(row.pages),
    source: (row.source as FileRecord['source']) ?? undefined,
  });
}

export function qrFrom(row: Row): QrCode {
  return clean({
    ...owned(row),
    label: String(row.label),
    content: String(row.content),
    fg: String(row.fg),
    bg: String(row.bg),
    placement: str(row.placement),
    projectId: str(row.project_id),
    linkPageId: str(row.link_page_id),
  });
}

export function linkPageFrom(row: Row): LinkPage {
  return {
    ...owned(row),
    title: String(row.title),
    handle: String(row.handle),
    bio: String(row.bio ?? ''),
    theme: row.theme as LinkPage['theme'],
    links: json<LinkPage['links']>(row.links, []),
    updatedAt: iso(row.updated_at)!,
  };
}

export function activityFrom(row: Row): ActivityEvent {
  return clean({
    id: String(row.id),
    spaceId: String(row.space_id),
    actorId: String(row.actor_id),
    verb: row.verb as ActivityEvent['verb'],
    object: {
      type: row.object_type as ActivityEvent['object']['type'],
      id: String(row.object_id),
      label: String(row.object_label),
    },
    context: row.context_id
      ? {
          type: row.context_type as ActivityEvent['object']['type'],
          id: String(row.context_id),
          label: String(row.context_label ?? ''),
        }
      : undefined,
    detail: str(row.detail),
    at: iso(row.at)!,
  });
}

export function inboxFrom(row: Row): InboxItem {
  return clean({
    id: String(row.id),
    spaceId: String(row.space_id),
    kind: row.kind as InboxItem['kind'],
    title: String(row.title),
    detail: String(row.detail ?? ''),
    at: iso(row.at)!,
    subject: {
      type: row.subject_type as InboxItem['subject']['type'],
      id: String(row.subject_id),
      label: String(row.subject_label),
    },
    audience: (row.audience as InboxItem['audience']) ?? undefined,
    recipientId: str(row.recipient_id),
    fromId: str(row.from_id),
    priority: row.priority as InboxItem['priority'],
    status: row.status as InboxItem['status'],
  });
}

export function approvalEventFrom(row: Row): ApprovalEvent {
  return clean({
    id: String(row.id),
    spaceId: String(row.space_id),
    submissionType: row.submission_type as ApprovalEvent['submissionType'],
    submissionId: String(row.submission_id),
    action: row.action as ApprovalEvent['action'],
    actorId: String(row.actor_id),
    reason: str(row.reason),
    at: iso(row.at)!,
  });
}

/* ---------- writing ---------- */

/** Domain field → column, per table. Fields not listed aren't stored in that table. */
export const columns = {
  projects: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    name: 'name',
    location: 'location',
    client: 'client',
    status: 'status',
    summary: 'summary',
    leadId: 'lead_id',
    teamIds: 'team_ids',
    startDate: 'start_date',
    dueDate: 'due_date',
    progress: 'progress',
    value: 'value',
    costAllowance: 'cost_allowance',
    color: 'color',
    custom: 'custom',
  },
  vehicles: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    name: 'name',
    year: 'year',
    make: 'make',
    model: 'model',
    plate: 'plate',
    vinLast6: 'vin_last6',
    odometer: 'odometer',
    fuel: 'fuel',
    status: 'status',
    assignedTo: 'assigned_to',
    fuelCardLast4: 'fuel_card_last4',
    nextServiceMiles: 'next_service_miles',
    color: 'color',
    custom: 'custom',
  },
  receipts: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    vendor: 'vendor',
    category: 'category',
    total: 'total',
    date: 'date',
    status: 'status',
    paymentMethod: 'payment_method',
    gallons: 'gallons',
    odometer: 'odometer',
    vehicleId: 'vehicle_id',
    projectId: 'project_id',
    fileId: 'file_id',
    notes: 'notes',
    reviewedBy: 'reviewed_by',
    reviewedAt: 'reviewed_at',
    returnReason: 'return_reason',
    resubmittedAt: 'resubmitted_at',
    returnSeenAt: 'return_seen_at',
  },
  mileage: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    date: 'date',
    from: 'from',
    to: 'to',
    miles: 'miles',
    purpose: 'purpose',
    roundTrip: 'round_trip',
    vehicleId: 'vehicle_id',
    projectId: 'project_id',
    status: 'status',
    reviewedBy: 'reviewed_by',
    reviewedAt: 'reviewed_at',
    returnReason: 'return_reason',
    resubmittedAt: 'resubmitted_at',
    returnSeenAt: 'return_seen_at',
  },
  files: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    name: 'name',
    kind: 'kind',
    size: 'size',
    pages: 'pages',
    folder: 'folder',
    access: 'access',
    expiresAt: 'expires_at',
    source: 'source',
    preview: 'preview',
  },
  qrCodes: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    label: 'label',
    content: 'content',
    fg: 'fg',
    bg: 'bg',
    placement: 'placement',
    projectId: 'project_id',
    linkPageId: 'link_page_id',
  },
  linkPages: {
    id: 'id',
    spaceId: 'space_id',
    createdBy: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    title: 'title',
    handle: 'handle',
    bio: 'bio',
    theme: 'theme',
    links: 'links',
  },
  inbox: {
    id: 'id',
    spaceId: 'space_id',
    kind: 'kind',
    title: 'title',
    detail: 'detail',
    at: 'at',
    audience: 'audience',
    recipientId: 'recipient_id',
    fromId: 'from_id',
    priority: 'priority',
    status: 'status',
  },
  spaces: {
    id: 'id',
    slug: 'slug',
    kind: 'kind',
    name: 'name',
    descriptor: 'descriptor',
    plan: 'plan',
    modules: 'modules',
    labels: 'labels',
    brand: 'brand',
    customFields: 'custom_fields',
    timezone: 'timezone',
    ownerId: 'owner_id',
    workStyle: 'work_style',
    mileageRate: 'mileage_rate',
    createdAt: 'created_at',
  },
} as const;

export const tableName = {
  projects: 'projects',
  vehicles: 'vehicles',
  receipts: 'receipts',
  mileage: 'mileage_entries',
  files: 'files',
  qrCodes: 'qr_codes',
  linkPages: 'link_pages',
  inbox: 'inbox_items',
  spaces: 'spaces',
} as const;

/** A domain record (or patch) as column → value, dropping fields the table doesn't store. */
export function toColumns(table: keyof typeof columns, record: Record<string, unknown>) {
  const map = columns[table] as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    const column = map[field];
    if (!column || value === undefined) continue;
    out[column] = value === '' && column.endsWith('_id') ? null : value;
  }
  if (table === 'spaces' && out.slug === 'personal') out.slug = null;
  return out;
}
