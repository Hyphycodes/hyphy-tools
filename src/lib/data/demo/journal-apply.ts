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
    if (op.k === 'add') {
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

  function derive(
    op: JournalOp,
    current?: Record<string, unknown>,
    before?: Record<string, unknown>,
  ) {
    const row = (op.k === 'add' ? op.row : current) as Record<string, string & number>;
    const id = `${op.k}_${op.t}_${row.id}_${op.at}`;
    const space = spaceOf(row.spaceId ?? (op.t === 'spaces' ? row.id : ''));
    const business = space?.kind === 'business';
    const activity = (entry: Omit<Dataset['activity'][number], 'id' | 'spaceId' | 'at'>) =>
      data.activity.push({ id: `ac_${id}`, spaceId: space?.id ?? '', at: op.at, ...entry });
    const resolveInbox = (subjectId: string) => {
      data.inbox = data.inbox.map((item) =>
        item.subject.id === subjectId && item.kind !== 'mention'
          ? { ...item, status: 'done' }
          : item,
      );
    };

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
        case 'files': {
          const attached = (row.attachedTo as unknown as { type: string; id: string }[])?.[0];
          activity({
            actorId: op.by,
            verb: row.source ? 'generated' : 'uploaded',
            object: { type: 'file', id: row.id, label: row.name },
            context:
              attached?.type === 'project'
                ? projectRef(attached.id)
                : attached?.type === 'vehicle'
                  ? vehicleRef(attached.id)
                  : undefined,
          });
          break;
        }
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
      // The submitter fixed a returned item (or finished a draft) and sent it again.
      if ((was === 'returned' || was === 'draft') && op.by === row.createdBy)
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
    if (op.t === 'inbox' && status === 'done' && row.subject)
      resolveInbox((row.subject as unknown as { id: string }).id);
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
