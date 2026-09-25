import { startOfMonth } from '@/lib/platform/format';
import type {
  ActivityEvent,
  FileRecord,
  MileageEntry,
  Project,
  Receipt,
  ReceiptCategory,
} from '@/lib/platform/types';

/**
 * Small roll-ups computed from what the repository already returned (so they respect the same
 * visibility). In production these become database views or RPCs; the shapes stay the same.
 */
export function monthSummary(
  {
    receipts,
    mileage,
    files,
  }: { receipts: Receipt[]; mileage: MileageEntry[]; files: FileRecord[] },
  timezone: string,
) {
  const since = startOfMonth(timezone);
  const inMonth = (iso: string) => new Date(iso).getTime() >= since;
  const counted = receipts.filter(
    (receipt) =>
      inMonth(receipt.date) && (receipt.status === 'approved' || receipt.status === 'submitted'),
  );
  const byCategory = new Map<ReceiptCategory, number>();
  const byProject = new Map<string, number>();
  for (const receipt of counted) {
    byCategory.set(receipt.category, (byCategory.get(receipt.category) ?? 0) + receipt.total);
    if (receipt.projectId)
      byProject.set(receipt.projectId, (byProject.get(receipt.projectId) ?? 0) + receipt.total);
  }
  const trips = mileage.filter((entry) => inMonth(entry.date) && entry.status !== 'rejected');
  return {
    spend: counted.reduce((sum, receipt) => sum + receipt.total, 0),
    receipts: counted.length,
    pendingReceipts: receipts.filter((receipt) => receipt.status === 'submitted').length,
    miles:
      Math.round(
        trips.reduce((sum, entry) => sum + (entry.roundTrip ? entry.miles : entry.miles), 0) * 10,
      ) / 10,
    trips: trips.length,
    files: files.filter((file) => inMonth(file.createdAt)).length,
    categories: [...byCategory.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
    projects: [...byProject.entries()]
      .map(([projectId, total]) => ({ projectId, total }))
      .sort((a, b) => b.total - a.total),
  };
}

export function spendBy<K extends 'projectId' | 'vehicleId'>(receipts: Receipt[], key: K) {
  const totals = new Map<string, number>();
  for (const receipt of receipts) {
    const id = receipt[key];
    if (!id || receipt.status === 'rejected' || receipt.status === 'draft') continue;
    totals.set(id, (totals.get(id) ?? 0) + receipt.total);
  }
  return totals;
}

export const categoryLabel: Record<ReceiptCategory, string> = {
  fuel: 'Fuel',
  materials: 'Materials',
  meals: 'Meals',
  supplies: 'Supplies',
  equipment: 'Equipment',
  other: 'Other',
};

/**
 * The project someone is working on right now: of the open projects they're on, the one their
 * latest activity was about, then the one they lead, then the soonest due. Dashboards, briefings
 * and profiles all use this so they never disagree.
 */
export function currentProjectFor(
  personId: string,
  projects: Project[],
  activity: ActivityEvent[],
): Project | undefined {
  const mine = projects.filter(
    (project) => project.status === 'active' && project.teamIds.includes(personId),
  );
  if (!mine.length) return undefined;
  const latest = [...activity]
    .sort((a, b) => b.at.localeCompare(a.at))
    .find(
      (event) =>
        event.actorId === personId &&
        event.context?.type === 'project' &&
        mine.some((project) => project.id === event.context?.id),
    );
  return (
    mine.find((project) => project.id === latest?.context?.id) ??
    mine.find((project) => project.leadId === personId) ??
    [...mine].sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9'))[0]
  );
}
