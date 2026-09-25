import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import {
  awaitingFix,
  mileageSubmission,
  receiptSubmission,
  submissionKinds,
  tripTitle,
  type Submission,
  type SubmissionKind,
} from '@/lib/platform/approvals';
import type {
  ActivityEvent,
  FileRecord,
  InboxItem,
  LinkPage,
  Membership,
  MileageEntry,
  ObjectRef,
  Person,
  PinTarget,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';
import { RuleError, type Member, type RecordFilter, type Repository } from '../repository';
import { newId, readJournal, writeJournal, type JournalOp, type PendingOp } from './journal';
import { readPins, writePins } from './prefs';
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

  const business = space.kind === 'business';
  const approver = business && has('expenses.approve');
  /** Personal Spaces and approvers file straight through; everyone else waits for a decision. */
  const filedStatus = () =>
    space.kind === 'personal' || has('expenses.approve') ? 'approved' : 'submitted';

  /**
   * Names are read from the records themselves, never from copies: rename a project and every
   * activity line and inbox item that mentions it follows.
   */
  function relabel(ref: ObjectRef, dataset: Dataset): ObjectRef {
    const find = <T extends { id: string }>(rows: T[]) => rows.find((row) => row.id === ref.id);
    let label: string | undefined;
    switch (ref.type) {
      case 'project':
        label = find(dataset.projects)?.name;
        break;
      case 'vehicle':
        label = find(dataset.vehicles)?.name;
        break;
      case 'person':
        label = find(dataset.people)?.name;
        break;
      case 'file':
        label = find(dataset.files)?.name;
        break;
      case 'receipt': {
        const receipt = find(dataset.receipts);
        label = receipt && `${receipt.vendor} receipt`;
        break;
      }
      case 'mileage': {
        const entry = find(dataset.mileage);
        label = entry && tripTitle(entry);
        break;
      }
    }
    return label ? { ...ref, label } : ref;
  }

  function toSubmissions(dataset: Dataset, filter: RecordFilter = {}): Submission[] {
    const assigned = (personId: string) =>
      inSpace(dataset.vehicles).find((vehicle) => vehicle.assignedTo === personId)?.id;
    const match = (row: {
      projectId?: string;
      vehicleId?: string;
      createdBy: string;
      status: string;
    }) =>
      (!filter.projectId || row.projectId === filter.projectId) &&
      (!filter.vehicleId || row.vehicleId === filter.vehicleId) &&
      (!filter.createdBy || row.createdBy === filter.createdBy) &&
      (!filter.status || row.status === filter.status);
    return [
      ...ownOrAll(inSpace(dataset.receipts))
        .filter(match)
        .map((receipt) => receiptSubmission(receipt, business)),
      ...ownOrAll(inSpace(dataset.mileage))
        .filter(match)
        .map((entry) => mileageSubmission(entry, business ? assigned(entry.createdBy) : undefined)),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  /** "Shell · $71.42 · Truck 24 · Oak Brook Remodel", from the records as they are now. */
  function describe(item: Submission, dataset: Dataset) {
    const vehicle = item.vehicleId
      ? inSpace(dataset.vehicles).find((row) => row.id === item.vehicleId)?.name
      : item.kind === 'mileage' && business
        ? 'Personal vehicle'
        : undefined;
    const project = inSpace(dataset.projects).find((row) => row.id === item.projectId)?.name;
    return item.kind === 'receipt'
      ? [item.title, item.amount, vehicle, project].filter(Boolean).join(' · ')
      : [item.amount, item.title, vehicle, project].filter(Boolean).join(' · ');
  }

  /** The inbox items that are really just views of submissions. */
  function derivedInbox(dataset: Dataset, includeDone: boolean): InboxItem[] {
    const items: InboxItem[] = [];
    const all = toSubmissions(dataset);
    const subject = (item: Submission) =>
      relabel({ type: item.kind, id: item.id, label: item.title }, dataset);
    for (const item of all) {
      const noun = submissionKinds[item.kind].noun;
      const Noun = item.kind === 'mileage' ? 'Mileage' : 'Receipt';
      if (approver && item.status === 'submitted' && item.createdBy !== me)
        items.push({
          id: `ap_${item.id}`,
          spaceId: space.id,
          kind: 'approval',
          title: item.flags.includes('resubmitted')
            ? `${Noun} resubmitted`
            : item.flags.includes('unassigned') && item.kind === 'receipt'
              ? 'Receipt isn’t assigned'
              : item.kind === 'receipt'
                ? 'Receipt needs approval'
                : 'Mileage submitted',
          detail: describe(item, dataset),
          at: item.resubmittedAt ?? item.createdAt,
          subject: subject(item),
          audience: 'expenses.approve',
          fromId: item.createdBy,
          priority: 'normal',
          status: 'open',
          submission: item,
        });
      else if (
        includeDone &&
        approver &&
        item.reviewedBy === me &&
        item.reviewedAt &&
        (item.status === 'approved' || item.status === 'returned') &&
        Date.now() - new Date(item.reviewedAt).getTime() < 14 * 86_400_000
      )
        items.push({
          id: `ap_${item.id}`,
          spaceId: space.id,
          kind: 'approval',
          title: `${Noun} ${item.status === 'approved' ? 'approved' : 'returned'}`,
          detail: describe(item, dataset),
          at: item.reviewedAt,
          subject: subject(item),
          audience: 'expenses.approve',
          fromId: item.createdBy,
          priority: 'normal',
          status: 'done',
          submission: item,
        });
      if (item.createdBy !== me) continue;
      if (awaitingFix(item, me))
        items.push({
          id: `rt_${item.id}`,
          spaceId: space.id,
          kind: 'returned',
          title: `${Noun} returned`,
          detail: item.returnReason
            ? `“${item.returnReason}”`
            : `${describe(item, dataset)} · no note given`,
          at: item.reviewedAt ?? item.createdAt,
          subject: subject(item),
          recipientId: me,
          fromId: item.reviewedBy,
          priority: 'normal',
          status: 'open',
          submission: item,
        });
      if (item.status === 'draft')
        items.push({
          id: `in_${item.id}`,
          spaceId: space.id,
          kind: 'incomplete',
          title: item.value
            ? `${item.title} ${noun} isn’t sent`
            : `${item.title} ${noun} needs a total`,
          detail:
            dataset.receipts.find((row) => row.id === item.id)?.notes ??
            'Finish it when you have a minute.',
          at: item.createdAt,
          subject: subject(item),
          recipientId: me,
          priority: 'normal',
          status: 'open',
          submission: item,
        });
    }
    return items;
  }

  /** A submission this person may decide on: in this Space, waiting, and not their own. */
  function decidable(dataset: Dataset, kind: SubmissionKind, id: string) {
    const table = submissionKinds[kind].table;
    const record = inSpace(dataset[table] as (Receipt | MileageEntry)[]).find(
      (row) => row.id === id,
    );
    if (!record) throw new RuleError('That item isn’t in this Space.');
    if (record.createdBy === me) throw new RuleError('Someone else approves your own submissions.');
    if (record.status !== 'submitted') throw new RuleError('That one has already been decided.');
    return { table, record };
  }

  /** The submitter's own returned item or draft, ready to be sent again. */
  function fixable<T extends Receipt | MileageEntry>(rows: T[], id: string) {
    const record = inSpace(rows).find((row) => row.id === id);
    if (!record || record.createdBy !== me)
      throw new RuleError('Only the person who sent it can resend it.');
    if (record.status !== 'returned' && record.status !== 'draft')
      throw new RuleError('Only returned items and drafts can be sent again.');
    const now = new Date().toISOString();
    return {
      record,
      patch: {
        status: filedStatus(),
        ...(record.status === 'returned' ? { resubmittedAt: now } : {}),
        ...(has('expenses.approve') && business ? { reviewedBy: me, reviewedAt: now } : {}),
      },
    };
  }

  async function pins() {
    const dataset = await data();
    const chosen =
      (await readPins(space.id, me)) ??
      dataset.pins.filter((pin) => pin.spaceId === space.id && pin.personId === me);
    return chosen.map((target) => ({
      type: target.type,
      id: target.id,
      spaceId: space.id,
      personId: me,
    }));
  }

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

    async submissions(filter = {}) {
      return toSubmissions(await data(), filter);
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
      return (filter.limit ? events.slice(0, filter.limit) : events).map((event) => ({
        ...event,
        object: relabel(event.object, dataset),
        context: event.context && relabel(event.context, dataset),
      }));
    },

    async inbox(options = {}) {
      const dataset = await data();
      const stored = inSpace(dataset.inbox)
        .filter((item) => item.recipientId === me || (item.audience && has(item.audience)))
        .filter((item) => options.includeDone || item.status === 'open')
        .map((item) => ({ ...item, subject: relabel(item.subject, dataset) }));
      return [...stored, ...derivedInbox(dataset, Boolean(options.includeDone))].sort((a, b) =>
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

    pins,

    async createReceipt(input) {
      const { draft, ...fields } = input;
      const receipt: Receipt = {
        ...owned('rc'),
        ...fields,
        status: draft ? 'draft' : filedStatus(),
        ...(has('expenses.approve') && business && !draft
          ? { reviewedBy: me, reviewedAt: new Date().toISOString() }
          : {}),
      };
      await commit(add('receipts', receipt));
      return receipt;
    },
    async createMileage(input) {
      const entry: MileageEntry = {
        ...owned('mi'),
        ...input,
        status: filedStatus(),
        ...(has('expenses.approve') && business
          ? { reviewedBy: me, reviewedAt: new Date().toISOString() }
          : {}),
      };
      await commit(add('mileage', entry));
      return entry;
    },
    async createProject(input) {
      const project: Project = {
        ...owned('prj'),
        ...input,
        startDate: input.startDate ?? new Date().toISOString(),
        ...(space.workStyle === 'events' ? {} : { progress: 0 }),
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
    async review(kind, id, decision, reason) {
      const { table } = decidable(await data(), kind, id);
      await commit({
        k: 'set',
        t: table,
        id,
        patch: {
          status: decision,
          reviewedBy: me,
          reviewedAt: new Date().toISOString(),
          // A new return replaces any earlier note; an approval keeps it as history.
          ...(decision === 'returned' ? { returnReason: reason?.trim() ?? '' } : {}),
        },
      });
    },
    async approveMany(refs) {
      const dataset = await data();
      const at = new Date().toISOString();
      const ops: PendingOp[] = [];
      for (const ref of refs) {
        try {
          const { table } = decidable(dataset, ref.kind, ref.id);
          if (ops.some((op) => op.k === 'set' && op.id === ref.id)) continue;
          ops.push({
            k: 'set',
            t: table,
            id: ref.id,
            patch: { status: 'approved', reviewedBy: me, reviewedAt: at },
          });
        } catch {
          // Already decided (or someone's own): leave it out, approve the rest.
        }
      }
      if (ops.length) await commit(...ops);
      return ops.length;
    },
    async resubmitReceipt(id, input) {
      const fields: Partial<typeof input> = { ...input };
      delete fields.draft;
      const { record, patch } = fixable(inSpace((await data()).receipts), id);
      await commit({ k: 'set', t: 'receipts', id, patch: { ...fields, ...patch } });
      return { ...record, ...fields, ...patch } as Receipt;
    },
    async resubmitMileage(id, input) {
      const { record, patch } = fixable(inSpace((await data()).mileage), id);
      await commit({ k: 'set', t: 'mileage', id, patch: { ...input, ...patch } });
      return { ...record, ...input, ...patch } as MileageEntry;
    },
    async resolveInbox(id) {
      const dataset = await data();
      // A returned item is "resolved" by reading it and leaving it as it is.
      if (id.startsWith('rt_')) {
        const recordId = id.slice(3);
        const table = dataset.receipts.some((row) => row.id === recordId) ? 'receipts' : 'mileage';
        const record = inSpace(dataset[table] as (Receipt | MileageEntry)[]).find(
          (row) => row.id === recordId,
        );
        if (!record || !awaitingFix(record, me))
          throw new RuleError('That item is already handled.');
        await commit({
          k: 'set',
          t: table,
          id: recordId,
          patch: { returnSeenAt: new Date().toISOString() },
        });
        return;
      }
      const item = inSpace(dataset.inbox).find((entry) => entry.id === id);
      if (!item) throw new RuleError('That item is decided on its own page.');
      await commit({ k: 'set', t: 'inbox', id, patch: { status: 'done' } });
    },
    async setPinned(target, pinned) {
      const current = (await pins()).map(({ type, id }) => ({ type, id }) as PinTarget);
      const rest = current.filter((pin) => !(pin.type === target.type && pin.id === target.id));
      await writePins(space.id, me, pinned ? [...rest, target] : rest);
    },
    async setModules(modules) {
      await commit({ k: 'set', t: 'spaces', id: space.id, patch: { modules } });
    },
  };
}
