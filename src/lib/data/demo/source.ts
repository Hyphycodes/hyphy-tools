import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import type { FieldDefinition, Membership, Person } from '@/lib/platform/types';
import { RuleError, type Member } from '../repository';
import type { Change, DataSource, FieldChange, Visible } from '../source';
import { readConfig, writeConfig } from './config';
import { fieldLine, lineEvent, spaceLines, type SpaceChanges } from './config-apply';
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

  /** Business setup goes to its own cookie (config.ts), with the activity lines it writes. */
  async function configure(
    changes: SpaceChanges | null,
    fields: FieldDefinition[] | null,
    lines: Parameters<typeof lineEvent>[0][],
  ) {
    const at = new Date().toISOString();
    const config = await readConfig();
    if (changes) config.spaces[space.id] = { ...config.spaces[space.id], ...changes };
    if (fields) config.fields[space.id] = fields;
    config.log.push(...lines.map((line, index) => lineEvent(line, space.id, me, at, index)));
    config.changes += 1;
    await writeConfig(config);
    cached = null;
  }

  return {
    kind: 'demo',
    async load(key) {
      return (await rows())[key];
    },
    newId,
    async write(all) {
      const spaceChanges = all.filter((change) => change.table === 'spaces');
      const changes = all.filter((change) => change.table !== 'spaces');
      if (spaceChanges.length) {
        const current = (await getDemoData()).spaces.find((item) => item.id === space.id)!;
        const patch = Object.assign(
          {},
          ...spaceChanges.map((change) => (change.op === 'update' ? change.patch : {})),
        ) as SpaceChanges;
        await configure(patch, null, spaceLines(current, patch));
      }
      if (!changes.length) return;
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
    async writeFields(changes: FieldChange[]) {
      const data = await getDemoData();
      let fields = data.fields.filter((field) => field.spaceId === space.id);
      const lines = [];
      for (const change of changes) {
        if (change.op === 'insert') {
          fields = [...fields, change.field];
          lines.push(fieldLine(undefined, change.field));
          continue;
        }
        const before = fields.find(
          (field) => field.appliesTo === change.appliesTo && field.id === change.id,
        );
        if (!before) throw new RuleError('That field isn’t part of this business.');
        if (change.op === 'delete') {
          fields = fields.filter((field) => field !== before);
          continue;
        }
        const after = { ...before, ...change.patch } as FieldDefinition;
        if (change.patch.archivedAt === null) delete after.archivedAt;
        if (!after.options?.length) delete after.options;
        if (!after.help) delete after.help;
        if (!after.required) delete after.required;
        if (!after.showInList) delete after.showInList;
        fields = fields.map((field) => (field === before ? after : field));
        lines.push(fieldLine(before, after));
      }
      await configure(
        null,
        fields,
        lines.filter((line) => line !== null),
      );
    },
    async setMemberFields(personId, custom) {
      const data = await getDemoData();
      const membership = data.memberships.find(
        (item) =>
          item.spaceId === space.id && item.personId === personId && item.status !== 'removed',
      );
      if (!membership) throw new RuleError('That person isn’t part of this business.');
      await commit([{ k: 'set', t: 'memberships', id: membership.id, patch: { custom } }]);
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
