import { startOfMonth } from '@/lib/platform/format';
import type { FileRecord, MileageEntry, Receipt, ReceiptCategory } from '@/lib/platform/types';

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
  for (const receipt of counted)
    byCategory.set(receipt.category, (byCategory.get(receipt.category) ?? 0) + receipt.total);
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
