import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Workspace } from '@/lib/identity/types';
import type { PinTarget } from '@/lib/platform/types';
import { DataUnavailableError, RuleError, type Member } from '../repository';
import type { Change, DataSource, Visible } from '../source';
import { asPerson, type Tx } from './db';
import {
  activityFrom,
  approvalEventFrom,
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
  const cache = new Map<keyof Visible, Promise<unknown>>();
  let pinned: Promise<PinTarget[]> | null = null;

  const run = <T>(work: (tx: Tx) => Promise<T>) => asPerson(me, work).catch(translate);

  const queries: { [K in keyof Visible]: (tx: Tx) => Promise<Visible[K]> } = {
    projects: async (tx) =>
      (await tx`select * from projects where space_id = ${space.id}`).map(projectFrom),
    vehicles: async (tx) =>
      (await tx`select * from vehicles where space_id = ${space.id}`).map(vehicleFrom),
    receipts: async (tx) =>
      (await tx`select * from receipts where space_id = ${space.id}`).map(receiptFrom),
    mileage: async (tx) =>
      (await tx`select * from mileage_entries where space_id = ${space.id}`).map(mileageFrom),
    files: async (tx) =>
      (
        await tx`
          select f.*, coalesce(
            (select json_agg(json_build_object('type', a.record_type, 'id', a.record_id)
                             order by a.record_type desc)
             from file_attachments a where a.file_id = f.id), '[]'::json) as attached_to
          from files f where f.space_id = ${space.id}`
      ).map(fileFrom),
    qrCodes: async (tx) =>
      (await tx`select * from qr_codes where space_id = ${space.id}`).map(qrFrom),
    linkPages: async (tx) =>
      (await tx`select * from link_pages where space_id = ${space.id}`).map(linkPageFrom),
    activity: async (tx) =>
      (
        await tx`select * from activity where space_id = ${space.id}
                 order by at desc limit ${ACTIVITY_WINDOW}`
      ).map(activityFrom),
    inbox: async (tx) =>
      (await tx`select * from inbox_items where space_id = ${space.id}`).map(inboxFrom),
    members: async (tx) =>
      (
        await tx`
          select m.*, to_jsonb(p) as person from space_members m
          join profiles p on p.id = m.person_id
          where m.space_id = ${space.id}`
      ).map((row) => ({ ...membershipFrom(row), person: personFrom(row.person) }) as Member),
    directory: async (tx) => (await tx`select * from space_directory(${space.id})`).map(personFrom),
    approvalEvents: async (tx) =>
      (await tx`select * from approval_events where space_id = ${space.id}`).map(approvalEventFrom),
  };

  /*
   * Everything a render asks for in the same moment is read together: one transaction as this
   * person, the queries pipelined on one connection — not a round trip (or a transaction) each.
   */
  let pending: {
    key: keyof Visible;
    resolve: (rows: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  function flush() {
    const batch = pending;
    pending = [];
    run((tx) => Promise.all(batch.map((item) => queries[item.key](tx).then(item.resolve)))).catch(
      (error) => {
        for (const item of batch) {
          item.reject(error);
          cache.delete(item.key);
        }
      },
    );
  }

  async function apply(tx: Tx, change: Change) {
    const table = tableName[change.table];
    if (change.op === 'insert') {
      const values = toColumns(change.table, change.row);
      await tx`insert into ${tx(table)} ${tx(values as Record<string, never>)}`;
      if (change.table === 'files') {
        const refs = (change.row.attachedTo as { type: string; id: string }[] | undefined) ?? [];
        for (const ref of refs)
          await tx`insert into file_attachments (file_id, record_type, record_id)
                   values (${String(change.row.id)}, ${ref.type}, ${ref.id})`;
      }
      return;
    }
    const values = toColumns(change.table, change.patch);
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
      if (!cache.has(key))
        cache.set(
          key,
          new Promise((resolve, reject) => {
            pending.push({ key, resolve, reject });
            if (pending.length === 1) setImmediate(flush);
          }),
        );
      return cache.get(key) as Promise<Visible[typeof key]>;
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
    pins() {
      pinned ??= run(async (tx) =>
        (
          await tx`select target_type, target_id from pins
                   where space_id = ${space.id} and person_id = ${me}
                   order by created_at, target_id`
        ).map((row) => ({ type: row.target_type, id: row.target_id }) as PinTarget),
      );
      return pinned;
    },
    async setPins(pins) {
      pinned = null;
      await run(async (tx) => {
        await tx`delete from pins where space_id = ${space.id} and person_id = ${me}`;
        for (const [index, pin] of pins.entries())
          await tx`insert into pins (space_id, person_id, target_type, target_id, created_at)
                   values (${space.id}, ${me}, ${pin.type}, ${pin.id},
                           now() + make_interval(secs => ${index} * 0.001))`;
      });
    },
  };
}

/** Database refusals become product messages; an unreachable database says so. */
function translate(error: unknown): never {
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
    ].includes(code ?? '') ||
    code?.startsWith('08') ||
    code === '57P01'
  )
    throw new DataUnavailableError(error);
  throw error;
}
