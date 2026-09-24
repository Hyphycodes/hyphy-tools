import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import type {
  ActivityEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  Person,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';
import type { Member, Repository } from '../repository';
import { newId, readJournal, writeJournal, type JournalOp, type PendingOp } from './journal';
import type { Dataset, TableName } from './seed';
import { getDemoData } from './store';

const byNewest =
  <T>(key: keyof T) =>
  (a: T, b: T) =>
    String(b[key]).localeCompare(String(a[key]));

/**
 * Demo repository. Reads the seed plus this browser's journal; writes to the journal.
 *
 * The visibility rules below are the ones Row Level Security will enforce in production (see
 * supabase/migrations). They live here, in one place, and nowhere in the interface.
 */
export function createDemoRepository(workspace: Workspace): Repository {
  const { space, person, membership, permissions } = workspace;
  const me = person.id;
  const has = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const isGuest = membership.role === 'guest';

  async function data() {
    return getDemoData();
  }
  const inSpace = <T extends { spaceId: string }>(rows: T[]) =>
    rows.filter((row) => row.spaceId === space.id);

  async function visibleProjects(source?: Dataset) {
    const all = inSpace((source ?? (await data())).projects);
    if (has('projects.view_all')) return all;
    return all.filter(
      (project) => project.teamIds.includes(me) || membership.projectIds?.includes(project.id),
    );
  }

  async function visibleVehicles(source?: Dataset) {
    if (isGuest) return [];
    const all = inSpace((source ?? (await data())).vehicles);
    return has('vehicles.view_all') ? all : all.filter((vehicle) => vehicle.assignedTo === me);
  }

  const ownOrAll = <T extends { createdBy: string }>(rows: T[]) =>
    has('expenses.view_all') ? rows : rows.filter((row) => row.createdBy === me);

  async function visibleFiles(source?: Dataset) {
    const dataset = source ?? (await data());
    const all = inSpace(dataset.files);
    if (has('files.view_all'))
      return all.filter((file) => file.access !== 'private' || file.createdBy === me);
    const projects = new Set((await visibleProjects(dataset)).map((project) => project.id));
    const vehicles = new Set((await visibleVehicles(dataset)).map((vehicle) => vehicle.id));
    return all.filter((file) => {
      if (file.createdBy === me) return true;
      if (file.access === 'private' || file.access === 'managers') return false;
      if (file.attachedTo.length === 0) return !isGuest && file.access === 'team';
      return file.attachedTo.some(
        (ref) =>
          (ref.type === 'project' && projects.has(ref.id)) ||
          (ref.type === 'vehicle' && vehicles.has(ref.id)) ||
          (ref.type === 'person' && ref.id === me),
      );
    });
  }

  async function commit(...ops: PendingOp[]) {
    const at = new Date().toISOString();
    const journal = await readJournal();
    journal.push(...ops.map((op) => ({ ...op, by: me, at }) as JournalOp));
    await writeJournal(journal);
  }
  const add = (t: TableName, row: object) => ({
    k: 'add' as const,
    t,
    row: row as Record<string, unknown>,
  });
  const owned = (prefix: string) => ({
    id: newId(prefix),
    spaceId: space.id,
    createdBy: me,
    createdAt: new Date().toISOString(),
  });

  async function members(): Promise<Member[]> {
    const dataset = await data();
    const all = inSpace(dataset.memberships).map((item) => ({
      ...item,
      person: dataset.people.find((entry) => entry.id === item.personId)!,
    }));
    if (!isGuest) return all;
    const team = new Set((await visibleProjects(dataset)).flatMap((project) => project.teamIds));
    return all.filter((item) => team.has(item.personId) && item.role !== 'guest');
  }

  return {
    members,
    async member(personId) {
      return (await members()).find((item) => item.personId === personId) ?? null;
    },
    async directory() {
      const dataset = await data();
      const ids = new Set(inSpace(dataset.memberships).map((item) => item.personId));
      return dataset.people.filter((item) => ids.has(item.id));
    },

    async projects() {
      return (await visibleProjects()).sort(byNewest<Project>('createdAt'));
    },
    async project(id) {
      return (await visibleProjects()).find((project) => project.id === id) ?? null;
    },
    async vehicles() {
      return (await visibleVehicles()).sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { numeric: true }),
      );
    },
    async vehicle(id) {
      return (await visibleVehicles()).find((vehicle) => vehicle.id === id) ?? null;
    },

    async receipts(filter = {}) {
      return ownOrAll(inSpace((await data()).receipts))
        .filter((row) => !filter.projectId || row.projectId === filter.projectId)
        .filter((row) => !filter.vehicleId || row.vehicleId === filter.vehicleId)
        .filter((row) => !filter.createdBy || row.createdBy === filter.createdBy)
        .filter((row) => !filter.status || row.status === filter.status)
        .sort(byNewest<Receipt>('date'));
    },
    async receipt(id) {
      return ownOrAll(inSpace((await data()).receipts)).find((row) => row.id === id) ?? null;
    },
    async mileage(filter = {}) {
      return ownOrAll(inSpace((await data()).mileage))
        .filter((row) => !filter.projectId || row.projectId === filter.projectId)
        .filter((row) => !filter.vehicleId || row.vehicleId === filter.vehicleId)
        .filter((row) => !filter.createdBy || row.createdBy === filter.createdBy)
        .filter((row) => !filter.status || row.status === filter.status)
        .sort(byNewest<MileageEntry>('date'));
    },

    async files(filter = {}) {
      const ref = filter.attachedTo;
      return (await visibleFiles())
        .filter(
          (file) =>
            !ref || file.attachedTo.some((item) => item.type === ref.type && item.id === ref.id),
        )
        .sort(byNewest<FileRecord>('createdAt'));
    },
    async qrCodes() {
      if (isGuest) return [];
      return inSpace((await data()).qrCodes).sort(byNewest<QrCode>('createdAt'));
    },
    async linkPages() {
      if (isGuest) return [];
      return inSpace((await data()).linkPages).sort(byNewest<LinkPage>('updatedAt'));
    },

    async activity(filter = {}) {
      const dataset = await data();
      let events = inSpace(dataset.activity);
      if (!has('activity.view_all')) {
        const projects = new Set((await visibleProjects(dataset)).map((project) => project.id));
        const vehicles = new Set((await visibleVehicles(dataset)).map((vehicle) => vehicle.id));
        const money = new Set(['receipt', 'mileage']);
        events = events.filter((event) => {
          if (event.actorId === me) return true;
          if (money.has(event.object.type)) return false;
          const refs = [event.object, event.context].filter(Boolean) as ActivityEvent['object'][];
          return refs.some(
            (ref) =>
              (ref.type === 'project' && projects.has(ref.id)) ||
              (ref.type === 'vehicle' && vehicles.has(ref.id)),
          );
        });
      }
      if (filter.about)
        events = events.filter((event) =>
          [event.object, event.context].some(
            (ref) => ref?.type === filter.about!.type && ref.id === filter.about!.id,
          ),
        );
      if (filter.actorId) events = events.filter((event) => event.actorId === filter.actorId);
      events.sort(byNewest<ActivityEvent>('at'));
      return filter.limit ? events.slice(0, filter.limit) : events;
    },

    async inbox(options = {}) {
      return inSpace((await data()).inbox)
        .filter((item) => item.recipientId === me || (item.audience && has(item.audience)))
        .filter((item) => options.includeDone || item.status === 'open')
        .sort((a, b) =>
          a.status !== b.status
            ? a.status === 'open'
              ? -1
              : 1
            : a.priority !== b.priority
              ? a.priority === 'high'
                ? -1
                : 1
              : byNewest<InboxItem>('at')(a, b),
        );
    },

    async createReceipt(input) {
      const { draft, ...fields } = input;
      const receipt: Receipt = {
        ...owned('rc'),
        ...fields,
        status: draft
          ? 'draft'
          : space.kind === 'personal' || has('expenses.approve')
            ? 'approved'
            : 'submitted',
        ...(has('expenses.approve') && space.kind === 'business' ? { reviewedBy: me } : {}),
      };
      await commit(add('receipts', receipt));
      return receipt;
    },
    async createMileage(input) {
      const entry: MileageEntry = {
        ...owned('mi'),
        ...input,
        status: space.kind === 'personal' || has('expenses.approve') ? 'approved' : 'submitted',
      };
      await commit(add('mileage', entry));
      return entry;
    },
    async createProject(input) {
      const project: Project = {
        ...owned('prj'),
        ...input,
        startDate: new Date().toISOString(),
        progress: 0,
        color: space.brand.color,
      };
      await commit(add('projects', project));
      return project;
    },
    async invite(input) {
      const dataset = await data();
      const existing = dataset.people.find(
        (item) => item.email.toLowerCase() === input.email.toLowerCase(),
      );
      const parts = input.name.trim().split(/\s+/);
      const newcomer: Person = existing ?? {
        id: newId('p'),
        name: input.name.trim(),
        firstName: parts[0],
        initials: (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase(),
        email: input.email.trim(),
        hue: ['#0E7490', '#7C3AED', '#B45309', '#15803D', '#BE123C'][dataset.people.length % 5],
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
      await commit(...(existing ? [] : [add('people', newcomer)]), add('memberships', membership));
      return { ...membership, person: newcomer };
    },
    async createVehicle(input) {
      const vehicle: Vehicle = {
        ...owned('veh'),
        ...input,
        vinLast6: '—',
        status: input.assignedTo ? 'active' : 'available',
        color: '#E8E4DA',
      };
      await commit(add('vehicles', vehicle));
      return vehicle;
    },
    async addFiles(inputs) {
      const files: FileRecord[] = inputs.map((input) => ({ ...owned('fl'), ...input }));
      await commit(...files.map((file) => add('files', file)));
      return files;
    },
    async saveQrCode(input) {
      const code: QrCode = { ...owned('qr'), ...input };
      await commit(add('qrCodes', code));
      return code;
    },
    async saveLinkPage(input) {
      const { id, ...fields } = input;
      const now = new Date().toISOString();
      if (id) {
        const existing = inSpace((await data()).linkPages).find((page) => page.id === id);
        if (existing) {
          await commit({ k: 'set', t: 'linkPages', id, patch: { ...fields, updatedAt: now } });
          return { ...existing, ...fields, updatedAt: now };
        }
      }
      const page: LinkPage = { ...owned('lp'), ...fields, updatedAt: now };
      await commit(add('linkPages', page));
      return page;
    },
    async review(table, id, decision) {
      const rows = inSpace((await data())[table] as (Receipt | MileageEntry)[]);
      if (!rows.some((row) => row.id === id)) throw new Error('Not found in this Space.');
      await commit({ k: 'set', t: table, id, patch: { status: decision, reviewedBy: me } });
    },
    async resolveInbox(id) {
      const item = inSpace((await data()).inbox).find((entry) => entry.id === id);
      if (!item) throw new Error('Not found in this Space.');
      await commit({ k: 'set', t: 'inbox', id, patch: { status: 'done' } });
    },
    async setModules(modules) {
      await commit({ k: 'set', t: 'spaces', id: space.id, patch: { modules } });
    },
  };
}
