import type { IconName } from '@/components/ui/icon';
import { formatCurrency, formatMiles } from './format';
import type { ApprovalStatus, MileageEntry, Receipt, Review } from './types';

/**
 * Approvals, one way for everything that gets submitted.
 *
 * A submission is any record that carries a `Review` (status, reviewer, return reason). Receipts
 * and trips are the two kinds today; a form entry or an expense report joins by adding an entry to
 * `submissionKinds` and a `toSubmission` case. The Inbox, dashboards, people and projects all read
 * `Submission`, so they list, approve and return every kind the same way.
 *
 * The lifecycle is deliberately short:
 *
 *   draft ─▶ submitted ─▶ approved
 *                │  ▲
 *                ▼  │ (edit & resubmit)
 *             returned ── (with a reason)
 */

export type SubmissionKind = 'receipt' | 'mileage';

export type SubmissionRef = { kind: SubmissionKind; id: string };

/** What an approver should notice before saying yes. Plain rules, no scoring. */
export type SubmissionFlag =
  'unassigned' | 'no-vehicle' | 'own-vehicle' | 'no-total' | 'resubmitted';

export type Submission = Review & {
  kind: SubmissionKind;
  id: string;
  spaceId: string;
  createdBy: string;
  createdAt: string;
  /** When it happened (the purchase, the drive), not when it was entered. */
  date: string;
  /** "Shell", "Shop → Oak Brook Remodel" */
  title: string;
  /** "$71.42", "14.2 mi" */
  amount: string;
  /** Dollars for receipts, miles for trips. */
  value: number;
  projectId?: string;
  vehicleId?: string;
  flags: SubmissionFlag[];
};

export const submissionKinds: Record<
  SubmissionKind,
  {
    table: 'receipts' | 'mileage';
    /** The tool it's made with, for color and glyph. */
    tool: 'receipts' | 'mileage';
    noun: string;
    plural: string;
    icon: IconName;
    /** Where one opens, relative to the Space. */
    path: (id: string) => string;
    /** Reasons reviewers reach for most, offered as one-tap starts. */
    reasons: string[];
  }
> = {
  receipt: {
    table: 'receipts',
    tool: 'receipts',
    noun: 'receipt',
    plural: 'receipts',
    icon: 'receipt',
    path: (id) => `/tools/receipts?receipt=${id}`,
    reasons: [
      'Please pick the project this was for.',
      'The photo is hard to read — could you retake it?',
      'This one should go on the company card.',
    ],
  },
  mileage: {
    table: 'mileage',
    tool: 'mileage',
    noun: 'trip',
    plural: 'trips',
    icon: 'route',
    path: (id) => `/tools/mileage?trip=${id}`,
    reasons: [
      'Please use your company vehicle instead of a personal vehicle.',
      'Please pick the project this trip was for.',
      'The miles look high — could you check them?',
    ],
  },
};

/** "Oak Brook Remodel" from "Oak Brook Remodel, Hinsdale": the part people say out loud. */
export const shortPlace = (place: string) => place.split(',')[0].trim();

export function tripTitle(entry: Pick<MileageEntry, 'from' | 'to'>) {
  return `${shortPlace(entry.from)} → ${shortPlace(entry.to)}`;
}

function review(record: Review): Review {
  return {
    status: record.status,
    reviewedBy: record.reviewedBy,
    reviewedAt: record.reviewedAt,
    returnReason: record.returnReason,
    resubmittedAt: record.resubmittedAt,
    returnSeenAt: record.returnSeenAt,
  };
}

export function receiptSubmission(receipt: Receipt, business = true): Submission {
  const flags: SubmissionFlag[] = [];
  if (business && !receipt.projectId && !receipt.vehicleId) flags.push('unassigned');
  if (business && receipt.category === 'fuel' && !receipt.vehicleId && receipt.projectId)
    flags.push('no-vehicle');
  if (!receipt.total) flags.push('no-total');
  if (receipt.status === 'submitted' && receipt.resubmittedAt) flags.push('resubmitted');
  return {
    ...review(receipt),
    kind: 'receipt',
    id: receipt.id,
    spaceId: receipt.spaceId,
    createdBy: receipt.createdBy,
    createdAt: receipt.createdAt,
    date: receipt.date,
    title: receipt.vendor,
    amount: receipt.total ? formatCurrency(receipt.total) : 'No total',
    value: receipt.total,
    projectId: receipt.projectId,
    vehicleId: receipt.vehicleId,
    flags,
  };
}

/**
 * `assigned` is the company vehicle this person drives, if any: a trip in their own car while
 * they have one is worth a second look, because the business pays it back by the mile.
 */
export function mileageSubmission(entry: MileageEntry, assigned?: string): Submission {
  const flags: SubmissionFlag[] = [];
  if (!entry.vehicleId && assigned) flags.push('own-vehicle');
  if (!entry.projectId && !entry.vehicleId) flags.push('unassigned');
  if (entry.status === 'submitted' && entry.resubmittedAt) flags.push('resubmitted');
  return {
    ...review(entry),
    kind: 'mileage',
    id: entry.id,
    spaceId: entry.spaceId,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    date: entry.date,
    title: tripTitle(entry),
    amount: `${formatMiles(entry.miles)}${entry.roundTrip ? ' round trip' : ''}`,
    value: entry.miles,
    projectId: entry.projectId,
    vehicleId: entry.vehicleId,
    flags,
  };
}

export const flagLabel: Record<SubmissionFlag, string> = {
  unassigned: 'No project or vehicle',
  'no-vehicle': 'Fuel with no vehicle',
  'own-vehicle': 'Personal vehicle',
  'no-total': 'No total',
  resubmitted: 'Resubmitted',
};

/** Words for a status, from the submitter's side and the reviewer's. */
export function statusWords(status: ApprovalStatus, reviewer = false) {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'submitted':
      return reviewer ? 'Waiting on you' : 'Waiting for approval';
    case 'approved':
      return 'Approved';
    case 'returned':
      return 'Returned';
  }
}

/** Only the person who submitted it can fix and resend it, and only once it came back. */
export function canResubmit(
  submission: Pick<Submission, 'status' | 'createdBy'>,
  personId: string,
) {
  return submission.createdBy === personId && submission.status === 'returned';
}

/** A returned item still asks something of its submitter until they resubmit or set it aside. */
export function awaitingFix(record: Review & { createdBy: string }, personId: string) {
  return (
    record.createdBy === personId &&
    record.status === 'returned' &&
    (!record.returnSeenAt || (record.reviewedAt ?? '') > record.returnSeenAt)
  );
}

/** Pending submissions grouped by who sent them, largest queue first, for batch approval. */
export function groupBySubmitter<T extends Pick<Submission, 'createdBy' | 'kind' | 'value'>>(
  items: T[],
) {
  const groups = new Map<string, T[]>();
  for (const item of items)
    groups.set(item.createdBy, [...(groups.get(item.createdBy) ?? []), item]);
  return [...groups.entries()]
    .map(([personId, list]) => ({
      personId,
      items: list,
      dollars: list.filter((item) => item.kind === 'receipt').reduce((sum, i) => sum + i.value, 0),
      miles: list.filter((item) => item.kind === 'mileage').reduce((sum, i) => sum + i.value, 0),
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

/** "2 receipts and 3 trips", "4 receipts", "1 trip" */
export function describeCount(items: Pick<Submission, 'kind'>[]) {
  const receipts = items.filter((item) => item.kind === 'receipt').length;
  const trips = items.filter((item) => item.kind === 'mileage').length;
  const part = (count: number, kind: SubmissionKind) =>
    count
      ? `${count} ${count === 1 ? submissionKinds[kind].noun : submissionKinds[kind].plural}`
      : '';
  return [part(receipts, 'receipt'), part(trips, 'mileage')].filter(Boolean).join(' and ');
}
