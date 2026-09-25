import { createClock } from '../clock';
import { abc } from './abc';
import { fields, memberships, people, pins, spaces } from './core';
import { hyphy } from './hyphy';
import { personal } from './personal';
import { saltAndEmber } from './salt-and-ember';
import type { Dataset, SeedSlice } from './types';
import type { ApprovalEvent } from '@/lib/platform/types';

export { people, perspectives, personalSpaceId } from './core';
export type { Perspective } from './core';
export type { Dataset, TableName } from './types';

const slices: ((clock: ReturnType<typeof createClock>) => SeedSlice)[] = [
  personal,
  hyphy,
  abc,
  saltAndEmber,
];

let cached: { minute: number; data: Dataset } | null = null;

/**
 * The seeded world, anchored to the current minute so "3h ago" stays true. Built fresh each
 * minute and never mutated — Demo Mode layers the visitor's own changes on top (see journal.ts).
 */
export function seed(now = Date.now()): Dataset {
  const minute = Math.floor(now / 60000);
  if (cached?.minute === minute) return cached.data;
  const clock = createClock(minute * 60000);
  const data: Dataset = {
    people,
    spaces: spaces(clock),
    memberships: memberships(clock),
    projects: [],
    vehicles: [],
    receipts: [],
    mileage: [],
    files: [],
    qrCodes: [],
    linkPages: [],
    activity: [],
    inbox: [],
    approvalEvents: [],
    fields: fields(clock),
    pins: pins(),
  };
  for (const slice of slices.map((make) => make(clock))) {
    for (const [table, rows] of Object.entries(slice) as [keyof SeedSlice, unknown[]][]) {
      (data[table] as unknown[]).push(...rows);
    }
  }
  // Each business trip carries the rate it was logged at (as the database stamps it).
  const bySpace = new Map(data.spaces.map((space) => [space.id, space]));
  data.mileage = data.mileage.map((entry) => {
    const space = bySpace.get(entry.spaceId);
    return space?.kind === 'business' ? { ...entry, rate: space.mileageRate ?? 0 } : entry;
  });
  data.approvalEvents = historyOf(data, clock);
  cached = { minute, data };
  return data;
}

/**
 * The approval history the seeded receipts and trips would have: each was submitted when it was
 * created, then approved or returned (with its reason) by its reviewer.
 */
function historyOf(data: Dataset, clock: ReturnType<typeof createClock>): ApprovalEvent[] {
  const events: ApprovalEvent[] = [];
  const later = (iso: string, hours: number) =>
    new Date(
      Math.min(new Date(iso).getTime() + hours * 3_600_000, clock.now - 60_000),
    ).toISOString();
  const rows = [
    ...data.receipts.map((row) => ({ row, type: 'receipt' as const })),
    ...data.mileage.map((row) => ({ row, type: 'mileage' as const })),
  ];
  for (const { row, type } of rows) {
    if (row.status === 'draft') continue;
    const base = { spaceId: row.spaceId, submissionType: type, submissionId: row.id };
    events.push({
      ...base,
      id: `ae_${row.id}_s`,
      action: 'submitted',
      actorId: row.createdBy,
      at: row.createdAt,
    });
    const by = row.reviewedBy;
    if (!by || by === row.createdBy) continue;
    if (row.status === 'returned')
      events.push({
        ...base,
        id: `ae_${row.id}_r`,
        action: 'returned',
        actorId: by,
        reason: row.returnReason,
        at: row.reviewedAt ?? later(row.createdAt, 2),
      });
    if (row.status === 'approved')
      events.push({
        ...base,
        id: `ae_${row.id}_a`,
        action: 'approved',
        actorId: by,
        at: row.reviewedAt ?? later(row.createdAt, 2),
      });
  }
  return events;
}
