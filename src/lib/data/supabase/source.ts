import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@/lib/identity/types';
import type { PinTarget } from '@/lib/platform/types';
import { DataUnavailableError, RuleError, type Member, type UploadOutcome } from '../repository';
import type { Change, DataSource, FieldChange, Visible } from '../source';
import { asPerson, readAsPerson, uuidLiteral, type Tx } from './db';
import {
  activityFrom,
  approvalEventFrom,
  fieldColumns,
  fieldFrom,
  fileFrom,
  inboxFrom,
  linkPageFrom,
  membershipFrom,
  mileageFrom,
  personFrom,
  projectFrom,
  qrFrom,
  receiptFrom,
  tableName,
  toColumns,
  vehicleFrom,
} from './rows';

type Row = Record<string, unknown>;

/** How far back activity is read; older lines stay in the database. */
const ACTIVITY_WINDOW = 400;

/**
 * The Supabase source: every read and write runs as the workspace's person, so Row Level
 * Security — not this file — decides what they see and what they may change. Each kind of row is
 * read once per request, in one query scoped to the Space, and shared by everything that needs it.
 */
export function createSupabaseSource(workspace: Workspace): DataSource {
  const { space, person } = workspace;
  const me = person.id;
  const run = <T>(work: (tx: Tx) => Promise<T>) => asPerson(me, work).catch(translate);

  /*
   * Everything a render asks for in the same moment is read in one statement — one round trip —
   * as this person: a JSON object with one entry per kind of row. Each entry is an ordinary query
   * scoped to the Space, so Row Level Security filters it exactly as it would on its own.
   */
  const S = uuidLiteral(space.id);
  const ME = uuidLiteral(me);
  const list = (select: string) => `(select coalesce(json_agg(t), '[]'::json) from (${select}) t)`;
  type Key = keyof Visible | 'pins';
  const reads: Record<Key, { sql: string; map: (rows: Row[]) => unknown }> = {
    projects: {
      sql: list(`select * from projects where space_id = ${S}`),
      map: (r) => r.map(projectFrom),
    },
    vehicles: {
      sql: list(`select * from vehicles where space_id = ${S}`),
      map: (r) => r.map(vehicleFrom),
    },
    receipts: {
      sql: list(`select * from receipts where space_id = ${S}`),
      map: (r) => r.map(receiptFrom),
    },
    mileage: {
      sql: list(`select * from mileage_entries where space_id = ${S}`),
      map: (r) => r.map(mileageFrom),
    },
    files: {
      sql: list(`
        select f.*, coalesce(
          (select json_agg(json_build_object('type', a.record_type, 'id', a.record_id)
                           order by a.record_type desc)
           from file_attachments a where a.file_id = f.id), '[]'::json) as attached_to
        from files f where f.space_id = ${S}`),
      map: (r) => r.map(fileFrom),
    },
    qrCodes: {
      sql: list(`select * from qr_codes where space_id = ${S}`),
      map: (r) => r.map(qrFrom),
    },
    linkPages: {
      sql: list(`select * from link_pages where space_id = ${S}`),
      map: (r) => r.map(linkPageFrom),
    },
    activity: {
      sql: list(
        `select * from activity where space_id = ${S} order by at desc limit ${ACTIVITY_WINDOW}`,
      ),
      map: (r) => r.map(activityFrom),
    },
    inbox: {
      sql: list(`select * from inbox_items where space_id = ${S}`),
      map: (r) => r.map(inboxFrom),
    },
    members: {
      sql: list(`
        select m.*, to_jsonb(p) as person from space_members m
        join profiles p on p.id = m.person_id
        where m.space_id = ${S} and m.status <> 'removed'`),
      map: (r) =>
        r.map(
          (row) => ({ ...membershipFrom(row), person: personFrom(row.person as Row) }) as Member,
        ),
    },
    directory: { sql: list(`select * from space_directory(${S})`), map: (r) => r.map(personFrom) },
    approvalEvents: {
      sql: list(`select * from approval_events where space_id = ${S}`),
      map: (r) => r.map(approvalEventFrom),
    },
    // Row Level Security gives a guest only what their shared projects need.
    fields: {
      sql: list(`select * from custom_fields where space_id = ${S}`),
      map: (r) => r.map(fieldFrom),
    },
    pins: {
      sql: list(`
        select target_type, target_id from pins
        where space_id = ${S} and person_id = ${ME} order by created_at, target_id`),
      map: (r) => r.map((row) => ({ type: row.target_type, id: row.target_id }) as PinTarget),
    },
  };

  const cache = new Map<Key, Promise<unknown>>();
  let pending: { key: Key; resolve: (rows: unknown) => void; reject: (error: unknown) => void }[] =
    [];
  function flush() {
    const batch = pending;
    pending = [];
    const fields = batch.map(({ key }) => `'${key}', ${reads[key].sql}`).join(',\n');
    readAsPerson<{ data: Record<Key, Row[]> }>(me, `select json_build_object(${fields}) as data`)
      .then(([row]) => {
        for (const item of batch) item.resolve(reads[item.key].map(row.data[item.key] ?? []));
      })
      .catch((error) => {
        for (const item of batch) cache.delete(item.key);
        try {
          translate(error);
        } catch (translated) {
          for (const item of batch) item.reject(translated);
        }
      });
  }
  function read<T>(key: Key): Promise<T> {
    if (!cache.has(key))
      cache.set(
        key,
        new Promise((resolve, reject) => {
          pending.push({ key, resolve, reject });
          if (pending.length === 1) setImmediate(flush);
        }),
      );
    return cache.get(key) as Promise<T>;
  }

  async function apply(tx: Tx, change: Change) {
    if (change.op === 'delete') {
      const deleted = await tx`
        delete from files where id = ${change.id} and space_id = ${space.id} returning id`;
      if (!deleted.length) throw new RuleError('That file isn’t available to you.');
      return;
    }
    if (change.table === 'fileAttachments') {
      if (change.op !== 'insert') throw new RuleError('Attachments are only added.');
      const { fileId, type, id } = change.row as { fileId: string; type: string; id: string };
      await tx`insert into file_attachments (file_id, record_type, record_id)
               values (${fileId}, ${type}, ${id}) on conflict do nothing`;
      return;
    }
    const kind = change.table as Exclude<typeof change.table, 'fileAttachments'>;
    const table = tableName[kind];
    // A business's rules live beside its Space row, in `space_settings` (one per Space).
    if (change.op === 'update' && change.table === 'spaces' && 'settings' in change.patch) {
      const { settings, ...rest } = change.patch;
      await tx`
        insert into space_settings (space_id, settings) values (${space.id}, ${tx.json(settings as never)})
        on conflict (space_id) do update set settings = excluded.settings`;
      if (!Object.keys(toColumns('spaces', rest)).length) return;
      change = { ...change, patch: rest };
    }
    if (change.op === 'insert') {
      const values = toColumns(kind, change.row);
      await tx`insert into ${tx(table)} ${tx(values as Record<string, never>)}`;
      if (change.table === 'files') {
        const refs = (change.row.attachedTo as { type: string; id: string }[] | undefined) ?? [];
        for (const ref of refs)
          await tx`insert into file_attachments (file_id, record_type, record_id)
                   values (${String(change.row.id)}, ${ref.type}, ${ref.id})`;
      }
      return;
    }
    const values = toColumns(kind, change.patch);
    const updated = await tx`
      update ${tx(table)} set ${tx(values as Record<string, never>)}
      where id = ${change.id} ${change.table === 'spaces' ? tx`` : tx`and space_id = ${space.id}`}
      returning id`;
    // Nothing matched: the row isn't there or isn't theirs to change. RLS said no quietly.
    if (!updated.length) throw new RuleError('That item isn’t available to you.');
  }

  return {
    kind: 'supabase',
    load(key) {
      return read<Visible[typeof key]>(key);
    },
    newId: () => randomUUID(),
    async write(changes) {
      await run(async (tx) => {
        for (const change of changes) await apply(tx, change);
      });
      cache.clear();
    },
    async invite(input) {
      const personId = await run(async (tx) => {
        const [row] = await tx`
          select invite_member(${space.id}, ${input.name.trim()}, ${input.email.trim()},
                               ${input.role}, ${input.title}, ${input.projectIds ?? []}::uuid[]) as id`;
        return String(row.id);
      });
      cache.clear();
      const member = (await this.load('members')).find((item) => item.personId === personId);
      if (!member) throw new RuleError('The invitation couldn’t be read back.');
      return member;
    },
    async writeFields(changes: FieldChange[]) {
      await run(async (tx) => {
        for (const change of changes) {
          if (change.op === 'insert') {
            const values = asJson(tx, fieldColumns(change.field));
            await tx`insert into custom_fields ${tx(values as Record<string, never>)}`;
            continue;
          }
          const where = tx`space_id = ${space.id} and applies_to = ${change.appliesTo} and key = ${change.id}`;
          const done =
            change.op === 'delete'
              ? await tx`delete from custom_fields where ${where} returning key`
              : await tx`
                  update custom_fields set ${tx(asJson(tx, fieldColumns(change.patch)) as Record<string, never>)}
                  where ${where} returning key`;
          if (!done.length) throw new RuleError('That field isn’t part of this business.');
        }
      });
      cache.delete('fields');
    },
    async setMemberFields(personId, custom) {
      await run(async (tx) => {
        await tx`select public.set_member_fields(${space.id}, ${personId}, ${tx.json(custom)})`;
      });
      cache.delete('members');
    },
    pins() {
      return read<PinTarget[]>('pins');
    },
    async finishUpload(id) {
      const outcome = await run(
        async (tx) =>
          (await tx`select public.finish_upload(${id}) as outcome`)[0].outcome as string,
      );
      cache.clear();
      return outcome as UploadOutcome;
    },
    async setLogo(fileId) {
      const previous = await run(
        async (tx) =>
          (await tx`select public.set_space_logo(${space.id}, ${fileId}) as previous`)[0]
            .previous as string | null,
      );
      cache.clear();
      return previous ?? null;
    },
    async storageBytes() {
      const [row] = await readAsPerson<{ bytes: string | null }>(
        me,
        `select public.space_storage_bytes(${S}) as bytes`,
      );
      return row?.bytes === null || row?.bytes === undefined ? null : Number(row.bytes);
    },
    async setPins(pins) {
      await run(async (tx) => {
        await tx`delete from pins where space_id = ${space.id} and person_id = ${me}`;
        for (const [index, pin] of pins.entries())
          await tx`insert into pins (space_id, person_id, target_type, target_id, created_at)
                   values (${space.id}, ${me}, ${pin.type}, ${pin.id},
                           now() + make_interval(secs => ${index} * 0.001))`;
      });
      cache.delete('pins');
    },
  };
}

/** A field's choices go to the database as JSON, not as a Postgres array. */
export function asJson(tx: Tx, values: Record<string, unknown>) {
  return 'options' in values ? { ...values, options: tx.json(values.options as never) } : values;
}

/** Database refusals become product messages; an unreachable database says so. */
export function translate(error: unknown): never {
  if (error instanceof RuleError) throw error;
  const code = (error as { code?: string })?.code;
  const message = (error as { message?: string })?.message ?? '';
  if (code === '42501' || code === 'P0001')
    throw new RuleError(
      /row-level security|permission denied/i.test(message)
        ? 'Your role in this Space can’t do that.'
        : message,
    );
  if (code === '23505') throw new RuleError('That’s already taken — try another.');
  if (code === '23503' || code === '23514' || code === '22P02')
    throw new RuleError('Something in that doesn’t match this Space. Check it and try again.');
  if (
    [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND',
      'CONNECT_TIMEOUT',
      'CONNECTION_CLOSED',
      'CONNECTION_ENDED',
      'CONNECTION_DESTROYED',
      // Lost a deadlock to a development Reset: nothing was saved.
      '40P01',
    ].includes(code ?? '') ||
    code?.startsWith('08') ||
    code === '57P01'
  )
    throw new DataUnavailableError(error);
  throw error;
}
