import type { Sql } from 'postgres';
import { perspectives, seed, type Dataset } from '../demo/seed';
import { demoUuid } from './rows';

/*
 * The development world, as SQL. Generated from the same seed Demo Mode reads (src/lib/data/demo/
 * seed), relative to "now", so both backends start from the same story: Mike's returned trip,
 * Dana's queue, Jerry's four roles. Used by Reset, `npm run db:seed` and the integration tests.
 *
 * DEVELOPMENT ONLY. The SQL starts by checking the database is marked as the development world
 * (supabase/dev/dev_tools.sql) and aborts otherwise — a production database has no `dev` schema.
 */

const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

function lit(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return q(String(value));
}
const jsonb = (value: unknown) => `${q(JSON.stringify(value ?? {}))}::jsonb`;
const uuids = (values: string[]) =>
  values.length ? `array[${values.map(q).join(', ')}]::uuid[]` : `'{}'::uuid[]`;
const texts = (values: string[]) =>
  values.length ? `array[${values.map(q).join(', ')}]::text[]` : `'{}'::text[]`;

function insert(table: string, rows: Record<string, string>[], suffix = '') {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const values = rows.map((row) => `(${cols.map((col) => row[col]).join(', ')})`);
  return `insert into ${table} (${cols.map((col) => `"${col}"`).join(', ')}) values\n  ${values.join(',\n  ')}${suffix};\n`;
}

/** The ids of every seeded record, so references can be rewritten as the same uuids. */
function idsOf(data: Dataset) {
  const ids = new Set<string>();
  for (const table of [
    'people',
    'spaces',
    'memberships',
    'projects',
    'vehicles',
    'receipts',
    'mileage',
    'files',
    'qrCodes',
    'linkPages',
    'activity',
    'inbox',
    'approvalEvents',
  ] as const)
    for (const row of data[table] as { id: string }[]) ids.add(row.id);
  return ids;
}

export function worldSql(now = Date.now()) {
  const data = seed(now);
  const known = idsOf(data);
  const u = (id: string | undefined) => (id ? q(demoUuid(id)) : 'null');
  const ref = (id: string | undefined) => (id && known.has(id) ? demoUuid(id) : id);
  // Custom field values that point at records (a file, a usual job site) move with their record.
  const custom = (value: Record<string, unknown> | undefined) =>
    jsonb(
      Object.fromEntries(
        Object.entries(value ?? {}).map(([key, entry]) => [
          key,
          typeof entry === 'string' && known.has(entry) ? demoUuid(entry) : entry,
        ]),
      ),
    );
  const t = (iso: string | undefined) => (iso ? `${q(iso)}::timestamptz` : 'null');

  let sql = `-- Hyphy Tools development world, generated ${new Date(now).toISOString()}.
do $$ begin
  if to_regclass('dev.environment') is null
     or not exists (select 1 from dev.environment where kind = 'development') then
    raise exception 'Refusing to seed: this database is not the Hyphy Tools development world.';
  end if;
end $$;
set local hyphy.seeding = 'on';
set local lock_timeout = '10s';
-- Every lock at once, in one statement, before touching anything: pages being read while this
-- runs wait for it instead of deadlocking with it.
lock table public.pins, public.approval_events, public.activity, public.inbox_items,
  public.file_attachments, public.qr_codes, public.link_pages, public.receipts,
  public.mileage_entries, public.files, public.vehicles, public.projects, public.space_members,
  public.spaces, public.profiles, dev.personas in access exclusive mode;
truncate table public.pins, public.approval_events, public.activity, public.inbox_items,
  public.file_attachments, public.qr_codes, public.link_pages, public.receipts,
  public.mileage_entries, public.files, public.vehicles, public.projects, public.space_members,
  public.spaces, public.profiles cascade;
delete from dev.personas;
delete from auth.users where id <> all (${uuids(data.people.map((person) => demoUuid(person.id)))});
`;

  sql += insert(
    'auth.users',
    data.people.map((person) => ({ id: u(person.id), email: lit(person.email) })),
    ' on conflict (id) do nothing',
  );
  sql += insert(
    'public.profiles',
    data.people.map((person) => ({
      id: u(person.id),
      name: lit(person.name),
      email: lit(person.email),
      hue: lit(person.hue),
      headline: lit(person.headline),
      phone: lit(person.phone),
      timezone: lit(person.timezone),
    })),
  );
  sql += insert(
    'public.spaces',
    data.spaces.map((space) => ({
      id: u(space.id),
      slug: space.kind === 'personal' ? 'null' : lit(space.slug),
      kind: lit(space.kind),
      name: lit(space.name),
      descriptor: lit(space.descriptor),
      plan: lit(space.plan),
      modules: texts(space.modules),
      labels: jsonb(space.labels ?? {}),
      brand: jsonb(space.brand),
      custom_fields: jsonb(space.customFields ?? {}),
      timezone: lit(space.timezone),
      owner_id: u(space.ownerId),
      work_style: lit(space.workStyle),
      mileage_rate: lit(space.mileageRate),
      created_at: t(space.createdAt),
    })),
  );
  sql += insert(
    'public.space_members',
    data.memberships.map((item) => ({
      id: u(item.id),
      space_id: u(item.spaceId),
      person_id: u(item.personId),
      role: lit(item.role),
      title: lit(item.title),
      status: lit(item.status),
      project_ids: uuids((item.projectIds ?? []).map((id) => demoUuid(id))),
      custom: custom(item.custom),
      joined_at: t(item.joinedAt),
      department: lit(item.department),
    })),
  );
  sql += insert(
    'public.projects',
    data.projects.map((project) => ({
      id: u(project.id),
      space_id: u(project.spaceId),
      created_by: u(project.createdBy),
      created_at: t(project.createdAt),
      name: lit(project.name),
      location: lit(project.location),
      client: lit(project.client),
      status: lit(project.status),
      summary: lit(project.summary),
      lead_id: u(project.leadId),
      team_ids: uuids(project.teamIds.map((id) => demoUuid(id))),
      start_date: t(project.startDate),
      due_date: t(project.dueDate),
      progress: lit(project.progress),
      value: lit(project.value),
      cost_allowance: lit(project.costAllowance),
      color: lit(project.color),
      custom: custom(project.custom),
    })),
  );
  sql += insert(
    'public.vehicles',
    data.vehicles.map((vehicle) => ({
      id: u(vehicle.id),
      space_id: u(vehicle.spaceId),
      created_by: u(vehicle.createdBy),
      created_at: t(vehicle.createdAt),
      name: lit(vehicle.name),
      year: lit(vehicle.year),
      make: lit(vehicle.make),
      model: lit(vehicle.model),
      plate: lit(vehicle.plate),
      vin_last6: lit(vehicle.vinLast6),
      odometer: lit(vehicle.odometer),
      fuel: lit(vehicle.fuel),
      status: lit(vehicle.status),
      assigned_to: u(vehicle.assignedTo),
      fuel_card_last4: lit(vehicle.fuelCardLast4),
      next_service_miles: lit(vehicle.nextServiceMiles),
      color: lit(vehicle.color),
      custom: custom(vehicle.custom),
    })),
  );
  sql += insert(
    'public.files',
    data.files.map((file) => ({
      id: u(file.id),
      space_id: u(file.spaceId),
      created_by: u(file.createdBy),
      created_at: t(file.createdAt),
      name: lit(file.name),
      kind: lit(file.kind),
      size: lit(file.size),
      pages: lit(file.pages),
      folder: lit(file.folder),
      access: lit(file.access),
      expires_at: t(file.expiresAt),
      source: lit(file.source),
      preview: lit(file.preview),
    })),
  );
  sql += insert(
    'public.file_attachments',
    data.files.flatMap((file) =>
      file.attachedTo.map((item) => ({
        file_id: u(file.id),
        record_type: lit(item.type),
        record_id: u(item.id),
      })),
    ),
  );
  const review = (row: Dataset['receipts'][number] | Dataset['mileage'][number]) => ({
    status: lit(row.status),
    reviewed_by: u(row.reviewedBy),
    reviewed_at: t(row.reviewedAt),
    return_reason: lit(row.returnReason),
    resubmitted_at: t(row.resubmittedAt),
    return_seen_at: t(row.returnSeenAt),
  });
  sql += insert(
    'public.receipts',
    data.receipts.map((receipt) => ({
      id: u(receipt.id),
      space_id: u(receipt.spaceId),
      created_by: u(receipt.createdBy),
      created_at: t(receipt.createdAt),
      vendor: lit(receipt.vendor),
      category: lit(receipt.category),
      total: lit(receipt.total),
      date: t(receipt.date),
      payment_method: lit(receipt.paymentMethod),
      gallons: lit(receipt.gallons),
      odometer: lit(receipt.odometer),
      vehicle_id: u(receipt.vehicleId),
      project_id: u(receipt.projectId),
      notes: lit(receipt.notes),
      ...review(receipt),
    })),
  );
  sql += insert(
    'public.mileage_entries',
    data.mileage.map((entry) => ({
      id: u(entry.id),
      space_id: u(entry.spaceId),
      created_by: u(entry.createdBy),
      created_at: t(entry.createdAt),
      date: t(entry.date),
      from: lit(entry.from),
      to: lit(entry.to),
      miles: lit(entry.miles),
      round_trip: lit(Boolean(entry.roundTrip)),
      purpose: lit(entry.purpose),
      vehicle_id: u(entry.vehicleId),
      project_id: u(entry.projectId),
      ...review(entry),
    })),
  );
  sql += insert(
    'public.link_pages',
    data.linkPages.map((page) => ({
      id: u(page.id),
      space_id: u(page.spaceId),
      created_by: u(page.createdBy),
      created_at: t(page.createdAt),
      updated_at: t(page.updatedAt),
      title: lit(page.title),
      handle: lit(page.handle),
      bio: lit(page.bio),
      theme: lit(page.theme),
      links: jsonb(page.links),
    })),
  );
  sql += insert(
    'public.qr_codes',
    data.qrCodes.map((code) => ({
      id: u(code.id),
      space_id: u(code.spaceId),
      created_by: u(code.createdBy),
      created_at: t(code.createdAt),
      label: lit(code.label),
      content: lit(code.content),
      fg: lit(code.fg),
      bg: lit(code.bg),
      placement: lit(code.placement),
      project_id: u(code.projectId),
      link_page_id: u(code.linkPageId),
    })),
  );
  sql += insert(
    'public.activity',
    data.activity.map((event) => ({
      id: u(event.id),
      space_id: u(event.spaceId),
      actor_id: u(event.actorId),
      verb: lit(event.verb),
      object_type: lit(event.object.type),
      object_id: q(ref(event.object.id)!),
      object_label: lit(event.object.label),
      context_type: lit(event.context?.type),
      context_id: event.context ? q(ref(event.context.id)!) : 'null',
      context_label: lit(event.context?.label),
      detail: lit(event.detail),
      at: t(event.at),
    })),
  );
  sql += insert(
    'public.inbox_items',
    data.inbox.map((item) => ({
      id: u(item.id),
      space_id: u(item.spaceId),
      kind: lit(item.kind),
      title: lit(item.title),
      detail: lit(item.detail),
      at: t(item.at),
      subject_type: lit(item.subject.type),
      subject_id: q(ref(item.subject.id)!),
      subject_label: lit(item.subject.label),
      audience: lit(item.audience),
      recipient_id: u(item.recipientId),
      from_id: u(item.fromId),
      priority: lit(item.priority),
      status: lit(item.status),
    })),
  );
  sql += insert(
    'public.approval_events',
    data.approvalEvents.map((event) => ({
      id: u(event.id),
      space_id: u(event.spaceId),
      submission_type: lit(event.submissionType),
      submission_id: u(event.submissionId),
      action: lit(event.action),
      actor_id: u(event.actorId),
      reason: lit(event.reason),
      at: t(event.at),
    })),
  );
  sql += insert(
    'public.pins',
    data.pins.map((pin, index) => ({
      space_id: u(pin.spaceId),
      person_id: u(pin.personId),
      target_type: lit(pin.type),
      target_id: lit(pin.type === 'project' ? demoUuid(pin.id) : pin.id),
      created_at: `${t(new Date(now - 86_400_000 + index * 1000).toISOString())}`,
    })),
  );
  sql += insert(
    'dev.personas',
    data.people.map((person) => ({ key: lit(person.id), person_id: u(person.id) })),
  );
  sql += `update dev.environment set seeded_at = ${t(new Date(now).toISOString())};\n`;
  return sql;
}

/**
 * Seeds the development world in one transaction. A page read that collides with it can still
 * lose a deadlock race to it, or win one; if the seed is the one Postgres cancels, try again.
 */
export async function applyWorld(sql: Sql, now = Date.now()) {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql.begin((tx) => tx.unsafe(worldSql(now)));
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if ((code !== '40P01' && code !== '55P03') || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

/** Persona keys Preview As offers, in order. */
export const personaKeys = [...new Set(perspectives.map((item) => item.personId))];
