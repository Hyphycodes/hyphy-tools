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

/**
 * Applies the journal to the seed. Activity and inbox entries for the visitor's own changes are
 * derived here rather than stored, the way a database trigger would write them.
 */
export function applyJournal(base: Dataset, ops: JournalOp[]): Dataset {
  if (!ops.length) return base;
  const data = Object.fromEntries(
    Object.entries(base).map(([key, rows]) => [key, [...(rows as unknown[])]]),
  ) as Dataset;
  const table = (name: TableName) => data[name] as unknown as Record<string, unknown>[];
  const spaceOf = (spaceId: string) => data.spaces.find((space) => space.id === spaceId);

  for (const op of ops) {
    if (op.k === 'add') {
      table(op.t).push(op.row);
      derive(op);
    } else {
      const rows = table(op.t);
      const index = rows.findIndex((row) => row.id === op.id);
      if (index === -1) continue;
      rows[index] = { ...rows[index], ...op.patch };
      derive(op, rows[index]);
    }
  }
  return data;

  function derive(op: JournalOp, current?: Record<string, unknown>) {
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
            verb: business ? 'submitted' : 'uploaded',
            object: { type: 'receipt', id: row.id, label: `${row.vendor} receipt` },
            context: row.projectId ? projectRef(row.projectId) : undefined,
            detail,
          });
          if (business && row.status === 'submitted')
            data.inbox.push({
              id: `in_${id}`,
              spaceId: row.spaceId,
              kind: row.projectId || row.vehicleId ? 'receipt-approval' : 'unassigned-receipt',
              title:
                row.projectId || row.vehicleId
                  ? 'Receipt needs approval'
                  : 'Receipt isn’t assigned',
              detail: `${row.vendor} · ${detail}`,
              at: op.at,
              subject: { type: 'receipt', id: row.id, label: `${row.vendor} receipt` },
              audience: 'expenses.approve',
              fromId: op.by,
              priority: 'normal',
              status: 'open',
            });
          break;
        }
        case 'mileage':
          activity({
            actorId: op.by,
            verb: 'logged',
            object: { type: 'mileage', id: row.id, label: `${row.from} → ${row.to}` },
            context: row.projectId ? projectRef(row.projectId) : undefined,
            detail: `${row.miles} mi`,
          });
          if (business && row.status === 'submitted')
            data.inbox.push({
              id: `in_${id}`,
              spaceId: row.spaceId,
              kind: 'mileage-review',
              title: 'Mileage submitted',
              detail: `${row.miles} mi · ${row.purpose || row.to}`,
              at: op.at,
              subject: { type: 'mileage', id: row.id, label: `${row.from} → ${row.to}` },
              audience: 'expenses.approve',
              fromId: op.by,
              priority: 'normal',
              status: 'open',
            });
          break;
        case 'files': {
          const attached = (row.attachedTo as unknown as { type: string; id: string }[])?.[0];
          activity({
            actorId: op.by,
            verb: row.source ? 'generated' : 'uploaded',
            object: { type: 'file', id: row.id, label: row.name },
            context: attached?.type === 'project' ? projectRef(attached.id) : undefined,
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
          break;
      }
      return;
    }

    // Updates
    const status = op.patch.status as string | undefined;
    if (
      (op.t === 'receipts' || op.t === 'mileage') &&
      (status === 'approved' || status === 'rejected')
    ) {
      activity({
        actorId: op.by,
        verb: status,
        object:
          op.t === 'receipts'
            ? { type: 'receipt', id: row.id, label: `${row.vendor} receipt` }
            : { type: 'mileage', id: row.id, label: `${row.from} → ${row.to}` },
        detail: op.t === 'receipts' ? moneyFormat.format(Number(row.total)) : `${row.miles} mi`,
      });
      resolveInbox(row.id);
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
}
