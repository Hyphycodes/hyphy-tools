import { tripTitle } from '@/lib/platform/approvals';
import type { Dataset, TableName } from './seed';
import type { JournalOp } from './journal-types';

/*
 * The pure half of Demo Mode's journal: applying the visitor's changes to the seed. No cookies,
 * no Next.js — so it's unit-tested directly (tests/unit.spec.ts).
 */

export function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Journals written before approvals said "returned" used "rejected". */
function normalize(op: JournalOp): JournalOp {
  const fix = (value: Record<string, unknown>) =>
    value.status === 'rejected' ? { ...value, status: 'returned' } : value;
  if (op.k === 'del') return op;
  return op.k === 'add' ? { ...op, row: fix(op.row) } : { ...op, patch: fix(op.patch) };
}

/**
 * Applies the journal to the seed. Activity for the visitor's own changes is derived here rather
 * than stored, the way a database trigger would write it. Approvals and returns need no inbox
 * rows at all: the repository reads them straight from the submissions.
 */
export function applyJournal(base: Dataset, ops: JournalOp[]): Dataset {
  if (!ops.length) return base;
  const data = Object.fromEntries(
    Object.entries(base).map(([key, rows]) => [key, [...(rows as unknown[])]]),
  ) as Dataset;
  const table = (name: TableName) => data[name] as unknown as Record<string, unknown>[];
  const spaceOf = (spaceId: string) => data.spaces.find((space) => space.id === spaceId);

  for (const raw of ops) {
    const op = normalize(raw);
    if (op.k === 'del') {
      const rows = table(op.t);
      const index = rows.findIndex((row) => row.id === op.id);
      if (index !== -1) rows.splice(index, 1);
    } else if (op.k === 'add') {
      table(op.t).push(op.row);
      derive(op);
    } else {
      const rows = table(op.t);
      const index = rows.findIndex((row) => row.id === op.id);
      if (index === -1) continue;
      const before = rows[index];
      rows[index] = { ...before, ...op.patch };
      derive(op, rows[index], before);
    }
  }
  return data;

  function history(
    row: Record<string, unknown>,
    table: 'receipts' | 'mileage',
    action: 'submitted' | 'returned' | 'resubmitted' | 'approved',
    actorId: string,
    at: string,
  ) {
    data.approvalEvents.push({
      id: `ae_${row.id}_${action}_${at}`,
      spaceId: String(row.spaceId),
      submissionType: table === 'receipts' ? 'receipt' : 'mileage',
      submissionId: String(row.id),
      action,
      actorId,
      reason: action === 'returned' ? (row.returnReason as string) || undefined : undefined,
      at,
    });
  }

  function derive(
    op: Exclude<JournalOp, { k: 'del' }>,
    current?: Record<string, unknown>,
    before?: Record<string, unknown>,
  ) {
    const row = (op.k === 'add' ? op.row : current) as Record<string, string & number>;
    const id = `${op.k}_${op.t}_${row.id}_${op.at}`;
    const space = spaceOf(row.spaceId ?? (op.t === 'spaces' ? row.id : ''));
    const business = space?.kind === 'business';
    const activity = (entry: Omit<Dataset['activity'][number], 'id' | 'spaceId' | 'at'>) =>
      data.activity.push({ id: `ac_${id}`, spaceId: space?.id ?? '', at: op.at, ...entry });
    if (op.k === 'add' && (op.t === 'receipts' || op.t === 'mileage') && row.status !== 'draft') {
      history(row, op.t, 'submitted', op.by, op.at);
      if (row.status === 'approved' && row.reviewedBy && row.reviewedBy !== row.createdBy)
        history(row, op.t, 'approved', row.reviewedBy, op.at);
    }

    if (op.k === 'add') {
      switch (op.t) {
        case 'receipts': {
          const detail = row.total ? moneyFormat.format(Number(row.total)) : 'Needs a total';
          activity({
            actorId: op.by,
            verb: business && row.status !== 'draft' ? 'submitted' : 'uploaded',
            object: { type: 'receipt', id: row.id, label: `${row.vendor} receipt` },
            context: contextOf(row),
            detail,
          });
          if (row.fileId) attachPhoto(op, row, undefined);
          break;
        }
        case 'mileage':
          activity({
            actorId: op.by,
            verb: 'logged',
            object: {
              type: 'mileage',
              id: row.id,
              label: tripTitle({ from: String(row.from), to: String(row.to) }),
            },
            context: contextOf(row),
            detail: `${row.miles} mi`,
          });
          break;
        case 'files':
          // A file's line is written when its upload finishes (below), as the database does.
          if (row.status === 'pending') break;
          fileActivity(op, row, row.source ? 'generated' : 'uploaded');
          break;
        case 'projects':
          activity({
            actorId: op.by,
            verb: 'created',
            object: { type: 'project', id: row.id, label: row.name },
          });
          break;
        case 'vehicles':
          activity({
            actorId: op.by,
            verb: 'created',
            object: { type: 'vehicle', id: row.id, label: row.name },
          });
          break;
        case 'qrCodes':
          activity({
            actorId: op.by,
            verb: 'generated',
            object: { type: 'qr', id: row.id, label: row.label },
            context: row.projectId
              ? projectRef(row.projectId)
              : row.linkPageId
                ? linkRef(row.linkPageId)
                : undefined,
          });
          break;
        case 'linkPages':
          activity({
            actorId: op.by,
            verb: 'created',
            object: { type: 'link', id: row.id, label: row.title },
          });
          break;
        case 'memberships': {
          const person = data.people.find((item) => item.id === row.personId);
          activity({
            actorId: op.by,
            verb: 'invited',
            object: { type: 'person', id: row.personId, label: person?.name ?? 'Someone' },
            detail: row.title,
          });
          break;
        }
        case 'people':
        case 'pins':
          break;
      }
      return;
    }

    // Updates
    if (op.t === 'files') {
      if (op.patch.status === 'ready' && before?.status === 'pending') {
        if (row.source !== 'receipts' && row.source !== 'brand')
          fileActivity(op, row, row.source ? 'generated' : 'uploaded');
      } else if ('deletedAt' in op.patch && row.source !== 'brand') {
        fileActivity(op, row, op.patch.deletedAt ? 'deleted' : 'restored');
      } else if (op.patch.name && before && op.patch.name !== before.name) {
        fileActivity(op, row, 'renamed', `was ${before.name}`);
      }
      return;
    }
    if (op.t === 'receipts' && 'fileId' in op.patch && op.patch.fileId !== before?.fileId)
      attachPhoto(op, row, before?.fileId as string | undefined);
    const status = op.patch.status as string | undefined;
    if ((op.t === 'receipts' || op.t === 'mileage') && status) {
      const object =
        op.t === 'receipts'
          ? { type: 'receipt' as const, id: row.id, label: `${row.vendor} receipt` }
          : {
              type: 'mileage' as const,
              id: row.id,
              label: tripTitle({ from: String(row.from), to: String(row.to) }),
            };
      const amount =
        op.t === 'receipts' ? moneyFormat.format(Number(row.total)) : `${row.miles} mi`;
      const was = before?.status;
      if (status !== was) {
        const action =
          (was === 'returned' || was === 'draft') && op.by === row.createdBy
            ? was === 'returned'
              ? 'resubmitted'
              : 'submitted'
            : status === 'approved' || status === 'returned'
              ? status
              : undefined;
        if (action) history(row, op.t, action, op.by, op.at);
      }
      // The submitter fixed a returned item (or finished a draft) and sent it again.
      if (status === was) {
        // A change that isn't a decision (setting a return aside) writes nothing.
      } else if ((was === 'returned' || was === 'draft') && op.by === row.createdBy)
        activity({
          actorId: op.by,
          verb: was === 'returned' ? 'resubmitted' : 'submitted',
          object,
          context: contextOf(row),
          detail: amount,
        });
      else if (status === 'approved' || status === 'returned')
        activity({
          actorId: op.by,
          verb: status,
          object,
          context: contextOf(row),
          detail: status === 'returned' && row.returnReason ? `“${row.returnReason}”` : amount,
        });
    }
    if (op.t === 'linkPages')
      activity({
        actorId: op.by,
        verb: 'updated',
        object: { type: 'link', id: row.id, label: row.title },
      });
    if (op.t === 'spaces' && op.patch.modules)
      activity({
        actorId: op.by,
        verb: 'updated',
        object: { type: 'space', id: row.id, label: 'the tools in this Space' },
      });
  }

  /** "Dana uploaded Oak Brook Plans.pdf · Oak Brook Remodel" — the file's first project or vehicle. */
  function fileActivity(
    op: Exclude<JournalOp, { k: 'del' }>,
    row: Record<string, unknown>,
    verb: 'uploaded' | 'generated' | 'deleted' | 'restored' | 'renamed',
    detail?: string,
  ) {
    const refs = (row.attachedTo as { type: string; id: string }[] | undefined) ?? [];
    const place =
      refs.find((ref) => ref.type === 'project') ?? refs.find((ref) => ref.type === 'vehicle');
    data.activity.push({
      id: `ac_${op.k}_files_${row.id}_${op.at}`,
      spaceId: String(row.spaceId),
      at: op.at,
      actorId: op.by,
      verb,
      object: { type: 'file', id: String(row.id), label: String(row.name) },
      context:
        place?.type === 'project'
          ? projectRef(place.id)
          : place?.type === 'vehicle'
            ? vehicleRef(place.id)
            : undefined,
      detail,
    });
  }

  /** A receipt's photo is attached to it (and a replaced one no longer is), as the database does. */
  function attachPhoto(
    op: Exclude<JournalOp, { k: 'del' }>,
    receipt: Record<string, unknown>,
    previous: string | undefined,
  ) {
    const files = data.files as unknown as Record<string, unknown>[];
    const without = (refs: unknown) =>
      ((refs as { type: string; id: string }[]) ?? []).filter(
        (ref) => !(ref.type === 'receipt' && ref.id === receipt.id),
      );
    const old = files.findIndex((file) => file.id === previous);
    if (old !== -1) files[old] = { ...files[old], attachedTo: without(files[old].attachedTo) };
    const index = files.findIndex((file) => file.id === receipt.fileId);
    if (index === -1) return;
    files[index] = {
      ...files[index],
      attachedTo: [...without(files[index].attachedTo), { type: 'receipt', id: receipt.id }],
    };
    data.activity.push({
      id: `ac_${op.k}_photo_${receipt.id}_${op.at}`,
      spaceId: String(receipt.spaceId),
      at: op.at,
      actorId: op.by,
      verb: 'attached',
      object: { type: 'file', id: String(files[index].id), label: String(files[index].name) },
      context: { type: 'receipt', id: String(receipt.id), label: `${receipt.vendor} receipt` },
    });
  }

  function projectRef(projectId: string) {
    const project = data.projects.find((item) => item.id === projectId);
    return project ? { type: 'project' as const, id: project.id, label: project.name } : undefined;
  }
  function vehicleRef(vehicleId: string) {
    const vehicle = data.vehicles.find((item) => item.id === vehicleId);
    return vehicle ? { type: 'vehicle' as const, id: vehicle.id, label: vehicle.name } : undefined;
  }
  function linkRef(pageId: string) {
    const page = data.linkPages.find((item) => item.id === pageId);
    return page ? { type: 'link' as const, id: page.id, label: `@${page.handle}` } : undefined;
  }
  /** Where a receipt or trip happened: its project, else its vehicle. */
  function contextOf(row: Record<string, unknown>) {
    return (
      (row.projectId ? projectRef(String(row.projectId)) : undefined) ??
      (row.vehicleId ? vehicleRef(String(row.vehicleId)) : undefined)
    );
  }
}
