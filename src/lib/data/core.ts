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
  MileageEntry,
  ObjectRef,
  Project,
  QrCode,
  Receipt,
  Vehicle,
} from '@/lib/platform/types';
import { RuleError, type RecordFilter, type Repository } from './repository';
import type { Change, DataSource, Visible } from './source';

const byNewest =
  <T>(key: keyof T) =>
  (a: T, b: T) =>
    String(b[key]).localeCompare(String(a[key]));

type Names = Pick<
  Visible,
  'projects' | 'vehicles' | 'directory' | 'files' | 'receipts' | 'mileage'
>;

/**
 * The repository both backends share. It never decides what someone may *see* — its source
 * already returned only that (code rules in Demo Mode, Row Level Security in Supabase). It
 * decides what the product means: what a submission is, what waits on whom, how a decision is
 * written, what an inbox item says. Rules that protect data are checked here for clear messages
 * and again by the database.
 */
export function createRepository(workspace: Workspace, source: DataSource): Repository {
  const { space, person, permissions } = workspace;
  const me = person.id;
  const has = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const business = space.kind === 'business';
  const approver = business && has('expenses.approve');
  const now = () => new Date().toISOString();
  /** Personal Spaces and approvers file straight through; everyone else waits for a decision. */
  const filedStatus = () =>
    space.kind === 'personal' || has('expenses.approve') ? 'approved' : 'submitted';
  const owned = (prefix: string) => ({
    id: source.newId(prefix),
    spaceId: space.id,
    createdBy: me,
    createdAt: now(),
  });
  const insert = (table: Change['table'], row: object): Change => ({
    op: 'insert',
    table,
    row: row as Record<string, unknown>,
  });

  async function names(): Promise<Names> {
    const [projects, vehicles, directory, files, receipts, mileage] = await Promise.all([
      source.load('projects'),
      source.load('vehicles'),
      source.load('directory'),
      source.load('files'),
      source.load('receipts'),
      source.load('mileage'),
    ]);
    return { projects, vehicles, directory, files, receipts, mileage };
  }

  /**
   * Names are read from the records themselves, never from copies: rename a project and every
   * activity line and inbox item that mentions it follows.
   */
  function relabel(ref: ObjectRef, rows: Names): ObjectRef {
    const find = <T extends { id: string }>(list: T[]) => list.find((row) => row.id === ref.id);
    let label: string | undefined;
    switch (ref.type) {
      case 'project':
        label = find(rows.projects)?.name;
        break;
      case 'vehicle':
        label = find(rows.vehicles)?.name;
        break;
      case 'person':
        label = find(rows.directory)?.name;
        break;
      case 'file':
        label = find(rows.files)?.name;
        break;
      case 'receipt': {
        const receipt = find(rows.receipts);
        label = receipt && `${receipt.vendor} receipt`;
        break;
      }
      case 'mileage': {
        const entry = find(rows.mileage);
        label = entry && tripTitle(entry);
        break;
      }
    }
    return label ? { ...ref, label } : ref;
  }

  const matches =
    (filter: RecordFilter) =>
    (row: { projectId?: string; vehicleId?: string; createdBy: string; status: string }) =>
      (!filter.projectId || row.projectId === filter.projectId) &&
      (!filter.vehicleId || row.vehicleId === filter.vehicleId) &&
      (!filter.createdBy || row.createdBy === filter.createdBy) &&
      (!filter.status || row.status === filter.status);

  function toSubmissions(rows: Names, filter: RecordFilter = {}): Submission[] {
    const assigned = (personId: string) =>
      rows.vehicles.find((vehicle) => vehicle.assignedTo === personId)?.id;
    return [
      ...rows.receipts
        .filter(matches(filter))
        .map((receipt) => receiptSubmission(receipt, business)),
      ...rows.mileage
        .filter(matches(filter))
        .map((entry) => mileageSubmission(entry, business ? assigned(entry.createdBy) : undefined)),
    ].sort((a, b) => b.date.localeCompare(a.date));
  }

  /** "Shell · $71.42 · Truck 24 · Oak Brook Remodel", from the records as they are now. */
  function describe(item: Submission, rows: Names) {
    const vehicle = item.vehicleId
      ? rows.vehicles.find((row) => row.id === item.vehicleId)?.name
      : item.kind === 'mileage' && business
        ? 'Personal vehicle'
        : undefined;
    const project = rows.projects.find((row) => row.id === item.projectId)?.name;
    return item.kind === 'receipt'
      ? [item.title, item.amount, vehicle, project].filter(Boolean).join(' · ')
      : [item.amount, item.title, vehicle, project].filter(Boolean).join(' · ');
  }

  /** The inbox items that are really just views of submissions. */
  function derivedInbox(rows: Names, includeDone: boolean): InboxItem[] {
    const items: InboxItem[] = [];
    const subject = (item: Submission) =>
      relabel({ type: item.kind, id: item.id, label: item.title }, rows);
    for (const item of toSubmissions(rows)) {
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
          detail: describe(item, rows),
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
          detail: describe(item, rows),
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
            : `${describe(item, rows)} · no note given`,
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
            rows.receipts.find((row) => row.id === item.id)?.notes ??
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
  async function decidable(kind: SubmissionKind, id: string) {
    const table = submissionKinds[kind].table;
    const rows = (await source.load(table)) as (Receipt | MileageEntry)[];
    const record = rows.find((row) => row.id === id);
    if (!record) throw new RuleError('That item isn’t in this Space.');
    if (record.createdBy === me) throw new RuleError('Someone else approves your own submissions.');
    if (record.status !== 'submitted') throw new RuleError('That one has already been decided.');
    return { table, record };
  }

  /** The submitter's own returned item or draft, ready to be sent again. */
  function fixable<T extends Receipt | MileageEntry>(rows: T[], id: string) {
    const record = rows.find((row) => row.id === id);
    if (!record || record.createdBy !== me)
      throw new RuleError('Only the person who sent it can resend it.');
    if (record.status !== 'returned' && record.status !== 'draft')
      throw new RuleError('Only returned items and drafts can be sent again.');
    const at = now();
    return {
      record,
      patch: {
        status: filedStatus(),
        ...(record.status === 'returned' ? { resubmittedAt: at } : {}),
        ...(has('expenses.approve') && business ? { reviewedBy: me, reviewedAt: at } : {}),
      },
    };
  }

  async function members() {
    return (await source.load('members')).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  }

  return {
    members,
    async member(personId) {
      return (await members()).find((item) => item.personId === personId) ?? null;
    },
    async directory() {
      return source.load('directory');
    },

    async projects() {
      return [...(await source.load('projects'))].sort(byNewest<Project>('createdAt'));
    },
    async project(id) {
      return (await source.load('projects')).find((project) => project.id === id) ?? null;
    },
    async vehicles() {
      return [...(await source.load('vehicles'))].sort((a: Vehicle, b: Vehicle) =>
        a.name.localeCompare(b.name, 'en', { numeric: true }),
      );
    },
    async vehicle(id) {
      return (await source.load('vehicles')).find((vehicle) => vehicle.id === id) ?? null;
    },

    async receipts(filter = {}) {
      return (await source.load('receipts'))
        .filter(matches(filter))
        .sort(byNewest<Receipt>('date'));
    },
    async receipt(id) {
      return (await source.load('receipts')).find((row) => row.id === id) ?? null;
    },
    async mileage(filter = {}) {
      return (await source.load('mileage'))
        .filter(matches(filter))
        .sort(byNewest<MileageEntry>('date'));
    },

    async files(filter = {}) {
      const ref = filter.attachedTo;
      return (await source.load('files'))
        .filter(
          (file) =>
            !ref || file.attachedTo.some((item) => item.type === ref.type && item.id === ref.id),
        )
        .sort(byNewest<FileRecord>('createdAt'));
    },
    async qrCodes() {
      return [...(await source.load('qrCodes'))].sort(byNewest<QrCode>('createdAt'));
    },
    async linkPages() {
      return [...(await source.load('linkPages'))].sort(byNewest<LinkPage>('updatedAt'));
    },

    async submissions(filter = {}) {
      return toSubmissions(await names(), filter);
    },
    async approvalHistory(id) {
      return (await source.load('approvalEvents'))
        .filter((event) => event.submissionId === id)
        .sort((a, b) => a.at.localeCompare(b.at));
    },

    async activity(filter = {}) {
      const [all, rows] = await Promise.all([source.load('activity'), names()]);
      let events = all;
      if (filter.about)
        events = events.filter((event) =>
          [event.object, event.context].some(
            (ref) => ref?.type === filter.about!.type && ref.id === filter.about!.id,
          ),
        );
      if (filter.actorId) events = events.filter((event) => event.actorId === filter.actorId);
      events = [...events].sort(byNewest<ActivityEvent>('at'));
      return (filter.limit ? events.slice(0, filter.limit) : events).map((event) => ({
        ...event,
        object: relabel(event.object, rows),
        context: event.context && relabel(event.context, rows),
      }));
    },

    async inbox(options = {}) {
      const [all, rows] = await Promise.all([source.load('inbox'), names()]);
      const stored = all
        .filter((item) => options.includeDone || item.status === 'open')
        .map((item) => ({ ...item, subject: relabel(item.subject, rows) }));
      return [...stored, ...derivedInbox(rows, Boolean(options.includeDone))].sort((a, b) =>
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

    async pins() {
      return (await source.pins()).map((target) => ({
        type: target.type,
        id: target.id,
        spaceId: space.id,
        personId: me,
      }));
    },

    async createReceipt(input) {
      const { draft, ...fields } = input;
      const receipt: Receipt = {
        ...owned('rc'),
        ...fields,
        status: draft ? 'draft' : filedStatus(),
        ...(has('expenses.approve') && business && !draft
          ? { reviewedBy: me, reviewedAt: now() }
          : {}),
      };
      await source.write([insert('receipts', receipt)]);
      return receipt;
    },
    async createMileage(input) {
      const entry: MileageEntry = {
        ...owned('mi'),
        ...input,
        status: filedStatus(),
        ...(has('expenses.approve') && business ? { reviewedBy: me, reviewedAt: now() } : {}),
      };
      await source.write([insert('mileage', entry)]);
      return entry;
    },
    async createProject(input) {
      const project: Project = {
        ...owned('prj'),
        ...input,
        startDate: input.startDate ?? now(),
        ...(space.workStyle === 'events' ? {} : { progress: 0 }),
        color: space.brand.color,
      };
      await source.write([insert('projects', project)]);
      return project;
    },
    async invite(input) {
      return source.invite(input);
    },
    async createVehicle(input) {
      const vehicle: Vehicle = {
        ...owned('veh'),
        ...input,
        vinLast6: '—',
        status: input.assignedTo ? 'active' : 'available',
        color: '#E8E4DA',
      };
      await source.write([insert('vehicles', vehicle)]);
      return vehicle;
    },
    async addFiles(inputs) {
      const files: FileRecord[] = inputs.map((input) => ({ ...owned('fl'), ...input }));
      await source.write(files.map((file) => insert('files', file)));
      return files;
    },
    async saveQrCode(input) {
      const code: QrCode = { ...owned('qr'), ...input };
      await source.write([insert('qrCodes', code)]);
      return code;
    },
    async saveLinkPage(input) {
      const { id, ...fields } = input;
      const at = now();
      if (id) {
        const existing = (await source.load('linkPages')).find((page) => page.id === id);
        if (existing) {
          await source.write([
            { op: 'update', table: 'linkPages', id, patch: { ...fields, updatedAt: at } },
          ]);
          return { ...existing, ...fields, updatedAt: at };
        }
      }
      const page: LinkPage = { ...owned('lp'), ...fields, updatedAt: at };
      await source.write([insert('linkPages', page)]);
      return page;
    },
    async review(kind, id, decision, reason) {
      const { table } = await decidable(kind, id);
      await source.write([
        {
          op: 'update',
          table,
          id,
          patch: {
            status: decision,
            reviewedBy: me,
            reviewedAt: now(),
            // A new return replaces any earlier note; an approval keeps it as history.
            ...(decision === 'returned' ? { returnReason: reason?.trim() ?? '' } : {}),
          },
        },
      ]);
    },
    async approveMany(refs) {
      const at = now();
      const changes: Change[] = [];
      for (const ref of refs) {
        try {
          const { table } = await decidable(ref.kind, ref.id);
          if (changes.some((change) => change.op === 'update' && change.id === ref.id)) continue;
          changes.push({
            op: 'update',
            table,
            id: ref.id,
            patch: { status: 'approved', reviewedBy: me, reviewedAt: at },
          });
        } catch {
          // Already decided (or someone's own): leave it out, approve the rest.
        }
      }
      if (changes.length) await source.write(changes);
      return changes.length;
    },
    async resubmitReceipt(id, input) {
      const fields: Partial<typeof input> = { ...input };
      delete fields.draft;
      const { record, patch } = fixable(await source.load('receipts'), id);
      await source.write([{ op: 'update', table: 'receipts', id, patch: { ...fields, ...patch } }]);
      return { ...record, ...fields, ...patch } as Receipt;
    },
    async resubmitMileage(id, input) {
      const { record, patch } = fixable(await source.load('mileage'), id);
      await source.write([{ op: 'update', table: 'mileage', id, patch: { ...input, ...patch } }]);
      return { ...record, ...input, ...patch } as MileageEntry;
    },
    async resolveInbox(id) {
      // A returned item is "resolved" by reading it and leaving it as it is.
      if (id.startsWith('rt_')) {
        const recordId = id.slice(3);
        const [receipts, mileage] = await Promise.all([
          source.load('receipts'),
          source.load('mileage'),
        ]);
        const receipt = receipts.find((row) => row.id === recordId);
        const record = receipt ?? mileage.find((row) => row.id === recordId);
        if (!record || !awaitingFix(record, me))
          throw new RuleError('That item is already handled.');
        await source.write([
          {
            op: 'update',
            table: receipt ? 'receipts' : 'mileage',
            id: recordId,
            patch: { returnSeenAt: now() },
          },
        ]);
        return;
      }
      const item = (await source.load('inbox')).find((entry) => entry.id === id);
      if (!item) throw new RuleError('That item is decided on its own page.');
      await source.write([{ op: 'update', table: 'inbox', id, patch: { status: 'done' } }]);
    },
    async setPinned(target, pinned) {
      const current = await source.pins();
      const rest = current.filter((pin) => !(pin.type === target.type && pin.id === target.id));
      await source.setPins(pinned ? [...rest, target] : rest);
    },
    async setModules(modules) {
      await source.write([{ op: 'update', table: 'spaces', id: space.id, patch: { modules } }]);
    },
  };
}
