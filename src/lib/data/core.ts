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
import { mergeSettings, needsApproval } from '@/lib/platform/business-settings';
import {
  activeFields,
  definitionProblem,
  fieldKey,
  fieldsFor,
  fieldsInUse,
  formatField,
  MAX_FIELDS,
} from '@/lib/platform/custom-fields';
import type {
  ActivityEvent,
  FieldDefinition,
  FieldType,
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
  'projects' | 'vehicles' | 'directory' | 'files' | 'receipts' | 'mileage' | 'fields'
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
  /**
   * Personal Spaces and approvers file straight through. Everyone else waits for a decision —
   * unless the business doesn't ask for one (no approval for trips, or none under an amount), in
   * which case it's filed with no reviewer: nobody approved it, nothing needed to.
   */
  const filedStatus = (kind: 'receipt' | 'mileage', amount: number) =>
    space.kind === 'personal' || has('expenses.approve') || !needsApproval(space, kind, amount)
      ? 'approved'
      : 'submitted';
  /** Who decided, for something filed now: the approver filing it, or nobody. */
  const filedBy = (status: string) =>
    status === 'approved' && business && has('expenses.approve')
      ? { reviewedBy: me, reviewedAt: now() }
      : {};
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
    const [projects, vehicles, directory, files, receipts, mileage, fields] = await Promise.all([
      source.load('projects'),
      source.load('vehicles'),
      source.load('directory'),
      source.load('files'),
      source.load('receipts'),
      source.load('mileage'),
      source.load('fields'),
    ]);
    return { projects, vehicles, directory, files, receipts, mileage, fields };
  }

  /** A reference value's name, from the rows this person can see. */
  function lookupIn(rows: Pick<Names, 'projects' | 'vehicles' | 'directory' | 'files'>) {
    return (type: FieldType, id: string) =>
      type === 'project'
        ? rows.projects.find((row) => row.id === id)?.name
        : type === 'vehicle'
          ? rows.vehicles.find((row) => row.id === id)?.name
          : type === 'person'
            ? rows.directory.find((row) => row.id === id)?.name
            : rows.files.find((row) => row.id === id)?.name;
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

  /**
   * "Shell · $71.42 · Truck 24 · Oak Brook Remodel · Cost Code: 200 — Materials", from the records
   * as they are now — with what the business asks for, so an approver sees it without opening it.
   */
  function describe(item: Submission, rows: Names) {
    const vehicle = item.vehicleId
      ? rows.vehicles.find((row) => row.id === item.vehicleId)?.name
      : item.kind === 'mileage' && business
        ? 'Personal vehicle'
        : undefined;
    const project = rows.projects.find((row) => row.id === item.projectId)?.name;
    const record =
      item.kind === 'receipt'
        ? rows.receipts.find((row) => row.id === item.id)
        : rows.mileage.find((row) => row.id === item.id);
    const extra = fieldsFor(
      rows.fields,
      item.kind === 'receipt' ? 'receipts' : 'mileage',
      record?.custom,
    )
      .filter((field) => record?.custom?.[field.id] !== undefined)
      .map(
        (field) =>
          `${field.label}: ${formatField(field, record?.custom?.[field.id], lookupIn(rows), space.timezone)}`,
      );
    return (
      item.kind === 'receipt'
        ? [item.title, item.amount, vehicle, project, ...extra]
        : [item.amount, item.title, vehicle, project, ...extra]
    )
      .filter(Boolean)
      .join(' · ');
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
  function fixable<T extends Receipt | MileageEntry>(
    rows: T[],
    id: string,
    kind: 'receipt' | 'mileage',
    amount: number,
  ) {
    const record = rows.find((row) => row.id === id);
    if (!record || record.createdBy !== me)
      throw new RuleError('Only the person who sent it can resend it.');
    if (record.status !== 'returned' && record.status !== 'draft')
      throw new RuleError('Only returned items and drafts can be sent again.');
    const at = now();
    const status = filedStatus(kind, amount);
    return {
      record,
      patch: {
        status,
        ...(record.status === 'returned' ? { resubmittedAt: at } : {}),
        ...(status === 'approved' && business
          ? has('expenses.approve')
            ? { reviewedBy: me, reviewedAt: at }
            : // Filed without needing anyone: whoever returned it earlier didn't approve it.
              { reviewedBy: null, reviewedAt: null }
          : {}),
      },
    };
  }

  /* ---------- the business's fields ---------- */

  async function allFields() {
    return source.load('fields');
  }

  async function findField(appliesTo: FieldDefinition['appliesTo'], id: string) {
    const field = (await allFields()).find(
      (item) => item.appliesTo === appliesTo && item.id === id,
    );
    if (!field) throw new RuleError('That field isn’t part of this business.');
    return field;
  }

  async function usage(appliesTo: FieldDefinition['appliesTo']) {
    switch (appliesTo) {
      case 'projects':
        return fieldsInUse(await source.load('projects'));
      case 'vehicles':
        return fieldsInUse(await source.load('vehicles'));
      case 'receipts':
        return fieldsInUse(await source.load('receipts'));
      case 'mileage':
        return fieldsInUse(await source.load('mileage'));
      case 'people':
        return fieldsInUse(await source.load('members'));
    }
  }

  /** A file this person may rename, move to Trash or delete: theirs, or any if they manage files. */
  async function changeable(id: string) {
    const file = (await source.load('files')).find((row) => row.id === id);
    if (!file || (file.status ?? 'ready') !== 'ready')
      throw new RuleError('That file isn’t available to you.');
    if (file.createdBy !== me && !has('files.manage'))
      throw new RuleError('Only whoever added it, or someone who manages files, can change it.');
    return file;
  }

  /**
   * A receipt's photo: a finished image or PDF this person added, here, not on another receipt.
   * The database checks the same (`private.check_receipt_photo`).
   */
  async function checkPhoto(fileId: string | undefined, receiptId?: string) {
    if (!fileId) return;
    const [files, receipts] = await Promise.all([source.load('files'), source.load('receipts')]);
    const file = files.find((row) => row.id === fileId);
    if (
      !file ||
      file.createdBy !== me ||
      (file.status ?? 'ready') !== 'ready' ||
      file.deletedAt ||
      !(file.kind === 'image' || file.kind === 'pdf')
    )
      throw new RuleError('That receipt photo isn’t available. Add it again.');
    if (receipts.some((row) => row.fileId === fileId && row.id !== receiptId))
      throw new RuleError('That photo is already on another receipt.');
  }

  /** An upload of this person's that didn't finish. */
  async function mineUnfinished(id: string) {
    const file = (await source.load('files')).find((row) => row.id === id);
    if (!file || file.createdBy !== me || (file.status ?? 'ready') === 'ready')
      throw new RuleError('That upload isn’t yours to cancel.');
    return file;
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
            (file.status ?? 'ready') === 'ready' &&
            Boolean(file.deletedAt) === Boolean(filter.trash) &&
            (!ref || file.attachedTo.some((item) => item.type === ref.type && item.id === ref.id)),
        )
        .sort(byNewest<FileRecord>(filter.trash ? 'deletedAt' : 'createdAt'));
    },
    async file(id) {
      return (await source.load('files')).find((file) => file.id === id) ?? null;
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
      await checkPhoto(input.fileId);
      const { draft, ...fields } = input;
      const status = draft ? 'draft' : filedStatus('receipt', input.total);
      const receipt: Receipt = { ...owned('rc'), ...fields, status, ...filedBy(status) };
      await source.write([insert('receipts', receipt)]);
      return receipt;
    },
    async createMileage(input) {
      const status = filedStatus('mileage', input.miles);
      // The rate it's paid back at is the business's rate now; a later change never re-prices it.
      const rate = business ? (space.mileageRate ?? 0) : undefined;
      const entry: MileageEntry = { ...owned('mi'), ...input, rate, status, ...filedBy(status) };
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
    newFileId: () => source.newId('fl'),
    async startUpload(input) {
      const file: FileRecord = { ...owned('fl'), ...input, status: 'pending' };
      await source.write([insert('files', file)]);
      return file;
    },
    async myUnfinishedUploads() {
      return (await source.load('files')).filter(
        (file) => file.createdBy === me && (file.status ?? 'ready') !== 'ready',
      );
    },
    finishUpload: (id) => source.finishUpload(id),
    async discardUpload(id) {
      const file = await mineUnfinished(id);
      await source.write([{ op: 'delete', table: 'files', id: file.id }]);
    },
    async renameFile(id, name) {
      await changeable(id);
      await source.write([{ op: 'update', table: 'files', id, patch: { name } }]);
    },
    async trashFile(id, trashed) {
      const file = await changeable(id);
      if (Boolean(file.deletedAt) === trashed) return;
      if (trashed && (await source.load('receipts')).some((row) => row.fileId === id))
        throw new RuleError('This photo belongs to a receipt, so it stays with the receipt.');
      if (trashed && space.logo?.fileId === id)
        throw new RuleError('This is the business logo. Change it in Settings.');
      await source.write([
        {
          op: 'update',
          table: 'files',
          id,
          patch: trashed
            ? { deletedAt: now(), deletedBy: me }
            : { deletedAt: null, deletedBy: null },
        },
      ]);
    },
    async deleteFile(id) {
      const file = await changeable(id);
      if (!file.deletedAt) throw new RuleError('Move it to Trash first.');
      await source.write([{ op: 'delete', table: 'files', id }]);
    },
    async attachFile(id, ref) {
      const file = await source.load('files').then((rows) => rows.find((row) => row.id === id));
      if (!file || (file.status ?? 'ready') !== 'ready' || file.deletedAt)
        throw new RuleError('That file isn’t available to you.');
      if (file.createdBy !== me && !has('files.manage'))
        throw new RuleError('Only whoever added it, or someone who manages files, can attach it.');
      if (file.attachedTo.some((item) => item.type === ref.type && item.id === ref.id)) return;
      await source.write([{ op: 'insert', table: 'fileAttachments', row: { fileId: id, ...ref } }]);
    },
    setLogo: (fileId) => source.setLogo(fileId),
    storageBytes: () => source.storageBytes(),
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
      await checkPhoto(input.fileId, id);
      const fields: Partial<typeof input> = { ...input };
      delete fields.draft;
      const { record, patch } = fixable(await source.load('receipts'), id, 'receipt', input.total);
      await source.write([{ op: 'update', table: 'receipts', id, patch: { ...fields, ...patch } }]);
      return { ...record, ...fields, ...patch } as Receipt;
    },
    async resubmitMileage(id, input) {
      const { record, patch } = fixable(await source.load('mileage'), id, 'mileage', input.miles);
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
    async updateSpace(patch) {
      await source.write([{ op: 'update', table: 'spaces', id: space.id, patch }]);
    },

    async fields(appliesTo) {
      return (await allFields())
        .filter((field) => !appliesTo || field.appliesTo === appliesTo)
        .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
    },
    fieldsInUse: usage,
    async addField(input) {
      const existing = (await allFields()).filter((field) => field.appliesTo === input.appliesTo);
      if (activeFields(existing, input.appliesTo).length >= MAX_FIELDS)
        throw new RuleError(`Up to ${MAX_FIELDS} fields at a time. Stop using one to add another.`);
      if (
        existing.some(
          (field) => field.label.trim().toLowerCase() === input.label.trim().toLowerCase(),
        )
      )
        throw new RuleError(`There’s already a field called ${input.label.trim()}.`);
      const problem = definitionProblem(input);
      if (problem) throw new RuleError(problem);
      const field: FieldDefinition = {
        id:
          input.id ??
          fieldKey(
            input.label,
            existing.map((item) => item.id),
          ),
        spaceId: space.id,
        appliesTo: input.appliesTo,
        label: input.label.trim(),
        type: input.type,
        ...(input.type === 'select' ? { options: input.options } : {}),
        ...(input.required ? { required: true } : {}),
        ...(input.help ? { help: input.help } : {}),
        ...(input.showInList ? { showInList: true } : {}),
        position: existing.reduce((max, item) => Math.max(max, item.position + 1), 0),
        createdBy: me,
        createdAt: now(),
      };
      await source.writeFields([{ op: 'insert', field }]);
      return field;
    },
    async updateField(appliesTo, id, patch) {
      const field = await findField(appliesTo, id);
      const next = { ...field, ...patch, label: (patch.label ?? field.label).trim() };
      const inUse = (await usage(appliesTo)).has(id);
      const problem = definitionProblem(next, field, inUse);
      if (problem) throw new RuleError(problem);
      const others = (await allFields()).filter(
        (item) => item.appliesTo === appliesTo && item.id !== id,
      );
      if (others.some((item) => item.label.toLowerCase() === next.label.toLowerCase()))
        throw new RuleError(`There’s already a field called ${next.label}.`);
      const clean = {
        label: next.label,
        type: next.type,
        options: next.type === 'select' ? (next.options ?? []) : [],
        required: Boolean(next.required),
        help: next.help ?? '',
        showInList: Boolean(next.showInList),
      };
      await source.writeFields([{ op: 'update', appliesTo, id, patch: clean }]);
      return { ...field, ...clean, options: clean.options.length ? clean.options : undefined };
    },
    async setFieldArchived(appliesTo, id, archived) {
      const field = await findField(appliesTo, id);
      if (Boolean(field.archivedAt) === archived) return;
      if (!archived) {
        const active = activeFields(await allFields(), appliesTo);
        if (active.length >= MAX_FIELDS)
          throw new RuleError(`Up to ${MAX_FIELDS} fields at a time. Stop using one first.`);
      }
      await source.writeFields([
        { op: 'update', appliesTo, id, patch: { archivedAt: archived ? now() : null } },
      ]);
    },
    async removeField(appliesTo, id) {
      await findField(appliesTo, id);
      if ((await usage(appliesTo)).has(id))
        throw new RuleError('Records already have answers for this field. Stop using it instead.');
      await source.writeFields([{ op: 'delete', appliesTo, id }]);
    },
    async moveField(appliesTo, id, direction) {
      const active = activeFields(await allFields(), appliesTo);
      const index = active.findIndex((field) => field.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= active.length) return;
      const order = [...active];
      [order[index], order[target]] = [order[target], order[index]];
      await source.writeFields(
        order
          .map((field, position) => ({ field, position }))
          .filter(({ field, position }) => field.position !== position)
          .map(({ field, position }) => ({
            op: 'update' as const,
            appliesTo,
            id: field.id,
            patch: { position },
          })),
      );
    },
    async updateSettings(patch) {
      const settings = mergeSettings(space.settings, patch);
      await source.write([{ op: 'update', table: 'spaces', id: space.id, patch: { settings } }]);
      return settings;
    },
    async setRecordFields(type, id, custom) {
      await source.write([{ op: 'update', table: type, id, patch: { custom } }]);
    },
    async setMemberFields(personId, custom) {
      await source.setMemberFields(personId, custom);
    },
  };
}
