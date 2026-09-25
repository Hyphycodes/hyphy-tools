import type { Sql } from 'postgres';
import { perspectives, seed, type Dataset } from '../demo/seed';
import { demoUuid } from './rows';

/*
 * The development world, as rows. Generated from the same seed Demo Mode reads (src/lib/data/demo/
 * seed), relative to "now", so every backend starts from the same story: Mike's returned trip,
 * Dana's queue, Jerry's four roles. Ids become stable uuids (`demoUuid`), so the same persona is
 * the same person on every database.
 *
 * DEVELOPMENT ONLY. The rows are handed to `dev.reset_world()` (supabase/dev/dev_tools.sql), which
 * refuses unless the database is marked as the development world — a production database has no
 * `dev` schema — and which the app's database role can call without any write access of its own.
 */

/** Table (schema-qualified) → rows, in the order `dev.reset_world` inserts them. */
export type World = { seededAt: string; tables: Record<string, Record<string, unknown>[]> };

const v = (value: unknown) =>
  value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;

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

export function worldRows(now = Date.now()): World {
  const data = seed(now);
  const known = idsOf(data);
  const u = (id: string | undefined) => (id ? demoUuid(id) : null);
  const ref = (id: string | undefined) => (id && known.has(id) ? demoUuid(id) : (id ?? null));
  // Custom field values that point at records (a file, a usual job site) move with their record.
  const custom = (value: Record<string, unknown> | undefined) =>
    Object.fromEntries(
      Object.entries(value ?? {}).map(([key, entry]) => [
        key,
        typeof entry === 'string' && known.has(entry) ? demoUuid(entry) : entry,
      ]),
    );
  const t = (iso: string | undefined) => iso ?? null;
  const tables: World['tables'] = {};
  const add = (table: string, rows: Record<string, unknown>[]) => {
    tables[table] = rows;
  };

  add(
    'auth.users',
    data.people.map((person) => ({ id: u(person.id), email: v(person.email) })),
  );
  add(
    'public.profiles',
    data.people.map((person) => ({
      id: u(person.id),
      name: v(person.name),
      email: v(person.email),
      hue: v(person.hue),
      headline: v(person.headline),
      phone: v(person.phone),
      timezone: v(person.timezone),
    })),
  );
  add(
    'public.spaces',
    data.spaces.map((space) => ({
      id: u(space.id),
      slug: space.kind === 'personal' ? null : v(space.slug),
      kind: v(space.kind),
      name: v(space.name),
      descriptor: v(space.descriptor),
      plan: v(space.plan),
      modules: space.modules,
      labels: space.labels ?? {},
      brand: space.brand,
      custom_fields: space.customFields ?? {},
      timezone: v(space.timezone),
      owner_id: u(space.ownerId),
      work_style: v(space.workStyle),
      mileage_rate: v(space.mileageRate),
      created_at: t(space.createdAt),
    })),
  );
  add(
    'public.space_members',
    data.memberships.map((item) => ({
      id: u(item.id),
      space_id: u(item.spaceId),
      person_id: u(item.personId),
      role: v(item.role),
      title: v(item.title),
      status: v(item.status),
      project_ids: (item.projectIds ?? []).map((id) => demoUuid(id)),
      custom: custom(item.custom),
      joined_at: t(item.joinedAt),
      department: v(item.department),
    })),
  );
  add(
    'public.projects',
    data.projects.map((project) => ({
      id: u(project.id),
      space_id: u(project.spaceId),
      created_by: u(project.createdBy),
      created_at: t(project.createdAt),
      name: v(project.name),
      location: v(project.location),
      client: v(project.client),
      status: v(project.status),
      summary: v(project.summary),
      lead_id: u(project.leadId),
      team_ids: project.teamIds.map((id) => demoUuid(id)),
      start_date: t(project.startDate),
      due_date: t(project.dueDate),
      progress: v(project.progress),
      value: v(project.value),
      cost_allowance: v(project.costAllowance),
      color: v(project.color),
      custom: custom(project.custom),
    })),
  );
  add(
    'public.vehicles',
    data.vehicles.map((vehicle) => ({
      id: u(vehicle.id),
      space_id: u(vehicle.spaceId),
      created_by: u(vehicle.createdBy),
      created_at: t(vehicle.createdAt),
      name: v(vehicle.name),
      year: v(vehicle.year),
      make: v(vehicle.make),
      model: v(vehicle.model),
      plate: v(vehicle.plate),
      vin_last6: v(vehicle.vinLast6),
      odometer: v(vehicle.odometer),
      fuel: v(vehicle.fuel),
      status: v(vehicle.status),
      assigned_to: u(vehicle.assignedTo),
      fuel_card_last4: v(vehicle.fuelCardLast4),
      next_service_miles: v(vehicle.nextServiceMiles),
      color: v(vehicle.color),
      custom: custom(vehicle.custom),
    })),
  );
  add(
    'public.files',
    data.files.map((file) => ({
      id: u(file.id),
      space_id: u(file.spaceId),
      created_by: u(file.createdBy),
      created_at: t(file.createdAt),
      name: v(file.name),
      kind: v(file.kind),
      size: v(file.size),
      pages: v(file.pages),
      folder: v(file.folder),
      access: v(file.access),
      expires_at: t(file.expiresAt),
      source: v(file.source),
      preview: v(file.preview),
    })),
  );
  add(
    'public.file_attachments',
    data.files.flatMap((file) =>
      file.attachedTo.map((item) => ({
        file_id: u(file.id),
        record_type: v(item.type),
        record_id: u(item.id),
      })),
    ),
  );
  const review = (row: Dataset['receipts'][number] | Dataset['mileage'][number]) => ({
    status: v(row.status),
    reviewed_by: u(row.reviewedBy),
    reviewed_at: t(row.reviewedAt),
    return_reason: v(row.returnReason),
    resubmitted_at: t(row.resubmittedAt),
    return_seen_at: t(row.returnSeenAt),
  });
  add(
    'public.receipts',
    data.receipts.map((receipt) => ({
      id: u(receipt.id),
      space_id: u(receipt.spaceId),
      created_by: u(receipt.createdBy),
      created_at: t(receipt.createdAt),
      vendor: v(receipt.vendor),
      category: v(receipt.category),
      total: v(receipt.total),
      date: t(receipt.date),
      payment_method: v(receipt.paymentMethod),
      gallons: v(receipt.gallons),
      odometer: v(receipt.odometer),
      vehicle_id: u(receipt.vehicleId),
      project_id: u(receipt.projectId),
      notes: v(receipt.notes),
      ...review(receipt),
    })),
  );
  add(
    'public.mileage_entries',
    data.mileage.map((entry) => ({
      id: u(entry.id),
      space_id: u(entry.spaceId),
      created_by: u(entry.createdBy),
      created_at: t(entry.createdAt),
      date: t(entry.date),
      from: v(entry.from),
      to: v(entry.to),
      miles: v(entry.miles),
      round_trip: v(Boolean(entry.roundTrip)),
      purpose: v(entry.purpose),
      vehicle_id: u(entry.vehicleId),
      project_id: u(entry.projectId),
      ...review(entry),
    })),
  );
  add(
    'public.link_pages',
    data.linkPages.map((page) => ({
      id: u(page.id),
      space_id: u(page.spaceId),
      created_by: u(page.createdBy),
      created_at: t(page.createdAt),
      updated_at: t(page.updatedAt),
      title: v(page.title),
      handle: v(page.handle),
      bio: v(page.bio),
      theme: v(page.theme),
      links: page.links,
    })),
  );
  add(
    'public.qr_codes',
    data.qrCodes.map((code) => ({
      id: u(code.id),
      space_id: u(code.spaceId),
      created_by: u(code.createdBy),
      created_at: t(code.createdAt),
      label: v(code.label),
      content: v(code.content),
      fg: v(code.fg),
      bg: v(code.bg),
      placement: v(code.placement),
      project_id: u(code.projectId),
      link_page_id: u(code.linkPageId),
    })),
  );
  add(
    'public.activity',
    data.activity.map((event) => ({
      id: u(event.id),
      space_id: u(event.spaceId),
      actor_id: u(event.actorId),
      verb: v(event.verb),
      object_type: v(event.object.type),
      object_id: ref(event.object.id),
      object_label: v(event.object.label),
      context_type: v(event.context?.type),
      context_id: event.context ? ref(event.context.id) : null,
      context_label: v(event.context?.label),
      detail: v(event.detail),
      at: t(event.at),
    })),
  );
  add(
    'public.inbox_items',
    data.inbox.map((item) => ({
      id: u(item.id),
      space_id: u(item.spaceId),
      kind: v(item.kind),
      title: v(item.title),
      detail: v(item.detail),
      at: t(item.at),
      subject_type: v(item.subject.type),
      subject_id: ref(item.subject.id),
      subject_label: v(item.subject.label),
      audience: v(item.audience),
      recipient_id: u(item.recipientId),
      from_id: u(item.fromId),
      priority: v(item.priority),
      status: v(item.status),
    })),
  );
  add(
    'public.approval_events',
    data.approvalEvents.map((event) => ({
      id: u(event.id),
      space_id: u(event.spaceId),
      submission_type: v(event.submissionType),
      submission_id: u(event.submissionId),
      action: v(event.action),
      actor_id: u(event.actorId),
      reason: v(event.reason),
      at: t(event.at),
    })),
  );
  add(
    'public.pins',
    data.pins.map((pin, index) => ({
      space_id: u(pin.spaceId),
      person_id: u(pin.personId),
      target_type: v(pin.type),
      target_id: v(pin.type === 'project' ? demoUuid(pin.id) : pin.id),
      created_at: new Date(now - 86_400_000 + index * 1000).toISOString(),
    })),
  );
  add(
    'dev.personas',
    data.people.map((person) => ({ key: v(person.id), person_id: u(person.id) })),
  );
  return { seededAt: new Date(now).toISOString(), tables };
}

/**
 * Seeds the development world in one call: `dev.reset_world` checks the marker, takes every lock
 * up front, truncates and inserts in one transaction. A page read that collides with it can
 * still win a deadlock race; if the reset is the one Postgres cancels, try again.
 */
export async function applyWorld(sql: Sql, now = Date.now()) {
  const world = JSON.stringify(worldRows(now));
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`select dev.reset_world(${world}::text::jsonb)`;
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if ((code !== '40P01' && code !== '55P03') || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}

/** The same call as SQL text, for applying through a console (`node scripts/db.mjs sql`). */
export function worldSql(now = Date.now()) {
  const world = JSON.stringify(worldRows(now)).replace(/'/g, "''");
  return `select dev.reset_world('${world}'::jsonb);\n`;
}

/** Persona keys Preview As offers, in order. */
export const personaKeys = [...new Set(perspectives.map((item) => item.personId))];
