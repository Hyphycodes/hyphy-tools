import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import type { Membership, Person } from '@/lib/platform/types';
import { RuleError, type Member } from '../repository';
import type { Change, DataSource, Visible } from '../source';
import { newId, readJournal, writeJournal, type JournalOp, type PendingOp } from './journal';
import { readPins, writePins } from './prefs';
import type { TableName } from './seed';
import { getDemoData } from './store';
import { visibleTo } from './visibility';

/**
 * Demo Mode's data: the seed plus this browser's journal, seen through `visibleTo` — the same
 * rules the database's Row Level Security applies to the Supabase source.
 */
export function createDemoSource(workspace: Workspace): DataSource {
  const { space, person } = workspace;
  const me = person.id;
  let cached: Promise<Visible> | null = null;
  const rows = () => (cached ??= getDemoData().then((data) => visibleTo(workspace, data)));

  const table: Record<Change['table'], TableName> = {
    projects: 'projects',
    vehicles: 'vehicles',
    receipts: 'receipts',
    mileage: 'mileage',
    files: 'files',
    qrCodes: 'qrCodes',
    linkPages: 'linkPages',
    inbox: 'inbox',
    spaces: 'spaces',
  };

  async function commit(ops: PendingOp[]) {
    const at = new Date().toISOString();
    const journal = await readJournal();
    journal.push(...ops.map((op) => ({ ...op, by: me, at }) as JournalOp));
    await writeJournal(journal);
    cached = null;
  }

  return {
    kind: 'demo',
    async load(key) {
      return (await rows())[key];
    },
    newId,
    async write(changes) {
      const visibleRows = await rows();
      for (const change of changes) {
        if (change.op !== 'update' || change.table === 'spaces') continue;
        const list = visibleRows[change.table as keyof Visible] as { id: string }[];
        if (!list.some((row) => row.id === change.id))
          throw new RuleError('That item isn’t available to you.');
      }
      await commit(
        changes.map((change) =>
          change.op === 'insert'
            ? { k: 'add', t: table[change.table], row: change.row }
            : { k: 'set', t: table[change.table], id: change.id, patch: change.patch },
        ),
      );
    },
    async invite(input): Promise<Member> {
      const data = await getDemoData();
      const existing = data.people.find(
        (item) => item.email.toLowerCase() === input.email.toLowerCase(),
      );
      const parts = input.name.trim().split(/\s+/);
      const newcomer: Person = existing ?? {
        id: newId('p'),
        name: input.name.trim(),
        firstName: parts[0],
        initials: (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase(),
        email: input.email.trim(),
        hue: ['#0E7490', '#7C3AED', '#B45309', '#15803D', '#BE123C'][data.people.length % 5],
        timezone: space.timezone,
      };
      const membership: Membership = {
        id: newId('mem'),
        spaceId: space.id,
        personId: newcomer.id,
        role: input.role,
        title: input.title,
        status: 'invited',
        joinedAt: new Date().toISOString(),
        projectIds: input.projectIds,
      };
      await commit([
        ...(existing ? [] : [{ k: 'add' as const, t: 'people' as const, row: newcomer }]),
        { k: 'add', t: 'memberships', row: membership },
      ]);
      return { ...membership, person: newcomer };
    },
    async pins() {
      const data = await getDemoData();
      return (
        (await readPins(space.id, me)) ??
        data.pins
          .filter((pin) => pin.spaceId === space.id && pin.personId === me)
          .map(({ type, id }) => ({ type, id }))
      );
    },
    async setPins(pins) {
      await writePins(space.id, me, pins);
    },
  };
}
