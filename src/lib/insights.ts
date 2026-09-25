import { formatCurrency, formatMiles, startOfMonth } from '@/lib/platform/format';
import type {
  ActivityEvent,
  FileRecord,
  LinkPage,
  MileageEntry,
  Person,
  Project,
  QrCode,
  Receipt,
  ReceiptCategory,
  Vehicle,
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
  const trips = mileage.filter((entry) => inMonth(entry.date) && entry.status !== 'returned');
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
    if (!id || receipt.status === 'returned' || receipt.status === 'draft') continue;
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

/* ---------- money on a project ---------- */

export type ProjectMoney = {
  /** What the customer pays, if the business recorded it. */
  value?: number;
  /** The business's own target for tracked costs, only if it set one. */
  allowance?: number;
  /** Everything recorded through Hyphy that still counts: approved and waiting. */
  tracked: number;
  /** The part of `tracked` still waiting for approval. */
  pending: number;
  /** Where it went: receipt categories, then trips paid back by the mile. */
  lines: { label: string; total: number }[];
  /** Miles in people's own vehicles, paid back at the rate each trip was logged at. */
  reimbursedMiles: number;
  /** That rate, when every one of those trips shares it (for "12 mi × $0.70"). */
  rate?: number;
};

/**
 * What a trip pays back: miles in a personal vehicle × the rate it was logged at. `fallback` (the
 * business's current rate) only covers a trip that has no rate of its own.
 */
export function paidBack(
  entry: Pick<MileageEntry, 'miles' | 'vehicleId' | 'rate'>,
  fallback = 0,
): number {
  return entry.vehicleId ? 0 : entry.miles * (entry.rate ?? fallback);
}

const counts = (status: string) => status === 'approved' || status === 'submitted';

/**
 * Tracked costs are what Hyphy saw: receipts filed to the project and trips in people's own
 * vehicles (company vehicles cost fuel, which arrives as receipts). Labor and subcontracts aren't
 * here, so this is never presented as the project's full cost or margin.
 */
export function projectMoney(
  project: Pick<Project, 'value' | 'costAllowance'>,
  receipts: Receipt[],
  mileage: MileageEntry[],
  rate = 0,
): ProjectMoney {
  const kept = receipts.filter((receipt) => counts(receipt.status));
  const byCategory = new Map<ReceiptCategory, number>();
  for (const receipt of kept)
    byCategory.set(receipt.category, (byCategory.get(receipt.category) ?? 0) + receipt.total);
  const ownCar = mileage.filter((entry) => !entry.vehicleId && counts(entry.status));
  const reimbursedMiles = ownCar.reduce((sum, entry) => sum + entry.miles, 0);
  const lines = [...byCategory.entries()]
    .map(([category, total]) => ({ label: categoryLabel[category], total }))
    .sort((a, b) => b.total - a.total);
  const paid = ownCar.reduce((sum, entry) => sum + paidBack(entry, rate), 0);
  if (reimbursedMiles && paid) lines.push({ label: 'Mileage paid back', total: paid });
  const rates = new Set(ownCar.map((entry) => entry.rate ?? rate));
  const pending =
    kept.filter((receipt) => receipt.status === 'submitted').reduce((sum, r) => sum + r.total, 0) +
    ownCar
      .filter((entry) => entry.status === 'submitted')
      .reduce((sum, entry) => sum + paidBack(entry, rate), 0);
  return {
    value: project.value,
    allowance: project.costAllowance,
    tracked: lines.reduce((sum, line) => sum + line.total, 0),
    pending,
    lines,
    reimbursedMiles: Math.round(reimbursedMiles * 10) / 10,
    rate: rates.size === 1 ? [...rates][0] || undefined : undefined,
  };
}

/* ---------- what's connected to what ---------- */

/** Vehicles that worked on a project: its trips and fuel, plus trucks that usually park there. */
export function vehiclesOn(
  projectId: string,
  vehicles: Vehicle[],
  receipts: Receipt[],
  mileage: MileageEntry[],
) {
  const uses = new Map<string, number>();
  for (const row of [...receipts, ...mileage])
    if (row.projectId === projectId && row.vehicleId && row.status !== 'returned')
      uses.set(row.vehicleId, (uses.get(row.vehicleId) ?? 0) + 1);
  return vehicles
    .filter((vehicle) => uses.has(vehicle.id) || vehicle.custom?.home_site === projectId)
    .map((vehicle) => ({ vehicle, uses: uses.get(vehicle.id) ?? 0 }))
    .sort((a, b) => b.uses - a.uses);
}

/** Where a vehicle is working: the project of its latest trip or fill-up, else its usual site. */
export function vehicleProject(
  vehicle: Vehicle,
  projects: Project[],
  receipts: Receipt[],
  mileage: MileageEntry[],
) {
  const open = (id?: string) =>
    projects.find((project) => project.id === id && project.status !== 'done');
  const latest = [...receipts, ...mileage]
    .filter((row) => row.vehicleId === vehicle.id && open(row.projectId))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return open(latest?.projectId) ?? open(vehicle.custom?.home_site as string | undefined);
}

export function thisMonth<T extends { date: string }>(rows: T[], timezone: string) {
  const since = startOfMonth(timezone);
  return rows.filter((row) => new Date(row.date).getTime() >= since);
}

/* ---------- personal: what gets used ---------- */

/**
 * How recently and how often this person made something with each tool here, read from what
 * they made (no tracking beyond the records themselves). Home uses it to put the tools someone
 * actually uses within reach.
 */
export function toolUsage(
  personId: string,
  records: {
    receipts: Receipt[];
    mileage: MileageEntry[];
    files: FileRecord[];
    qrCodes: QrCode[];
    linkPages: LinkPage[];
  },
  now = Date.now(),
) {
  const usage = new Map<string, { last: string; recent: number }>();
  const note = (tool: string, at: string) => {
    const entry = usage.get(tool) ?? { last: at, recent: 0 };
    if (at > entry.last) entry.last = at;
    if (now - new Date(at).getTime() < 30 * 86_400_000) entry.recent += 1;
    usage.set(tool, entry);
  };
  for (const row of records.receipts)
    if (row.createdBy === personId) note('receipts', row.createdAt);
  for (const row of records.mileage) if (row.createdBy === personId) note('mileage', row.createdAt);
  for (const row of records.files)
    if (row.createdBy === personId && (row.source === 'pdf' || row.source === 'images'))
      note(row.source, row.createdAt);
  for (const row of records.qrCodes) if (row.createdBy === personId) note('qr', row.createdAt);
  for (const row of records.linkPages) if (row.createdBy === personId) note('links', row.updatedAt);
  return usage;
}

/* ---------- owners: the week, and what deserves a look ---------- */

export type WeekSummary = {
  receipts: number;
  miles: number;
  /** Receipts plus own-vehicle miles paid back, recorded this week. */
  tracked: number;
  activeProjects: number;
  waiting: number;
  busiest?: { project: Project; events: number };
};

/** The last seven days, from the same records the rest of the product shows. */
export function weekSummary(
  data: {
    receipts: Receipt[];
    mileage: MileageEntry[];
    projects: Project[];
    activity: ActivityEvent[];
  },
  rate = 0,
  now = Date.now(),
): WeekSummary {
  const inWeek = (iso: string) => now - new Date(iso).getTime() < 7 * 86_400_000;
  const receipts = data.receipts.filter((row) => inWeek(row.createdAt) && row.status !== 'draft');
  const trips = data.mileage.filter((row) => inWeek(row.createdAt) && row.status !== 'returned');
  const events = new Map<string, number>();
  for (const event of data.activity) {
    if (!inWeek(event.at)) continue;
    const ref = [event.context, event.object].find((item) => item?.type === 'project');
    if (ref) events.set(ref.id, (events.get(ref.id) ?? 0) + 1);
  }
  const top = [...events.entries()].sort((a, b) => b[1] - a[1])[0];
  const project = top && data.projects.find((item) => item.id === top[0]);
  return {
    receipts: receipts.length,
    miles: Math.round(trips.reduce((sum, row) => sum + row.miles, 0) * 10) / 10,
    tracked:
      receipts.filter((row) => row.status !== 'returned').reduce((sum, row) => sum + row.total, 0) +
      trips.reduce((sum, row) => sum + paidBack(row, rate), 0),
    activeProjects: data.projects.filter((item) => item.status === 'active').length,
    waiting: [...data.receipts, ...data.mileage].filter((row) => row.status === 'submitted').length,
    busiest: project && top ? { project, events: top[1] } : undefined,
  };
}

export type Exception = {
  id: string;
  rule: 'returned' | 'unassigned' | 'own-vehicle' | 'expiring' | 'allowance' | 'no-total';
  title: string;
  detail: string;
  /** A path inside the Space. */
  path: string;
  tone: 'caution' | 'critical' | 'neutral';
};

/**
 * What an owner should look at without reading every transaction. Plain rules, no scoring:
 * something waiting on someone else, missing where it belongs, about to lapse, or off-pattern.
 * `skip` holds record ids the Inbox already shows, so nothing is said twice.
 */
export function exceptionsFor(
  data: {
    receipts: Receipt[];
    mileage: MileageEntry[];
    files: FileRecord[];
    projects: Project[];
    vehicles: Vehicle[];
    people: Map<string, Person>;
  },
  options: { rate?: number; skip?: Set<string>; now?: number } = {},
): Exception[] {
  const now = options.now ?? Date.now();
  const skip = options.skip ?? new Set<string>();
  const name = (id: string) => data.people.get(id)?.firstName ?? 'Someone';
  const list: Exception[] = [];

  const returned = [...data.receipts, ...data.mileage].filter(
    (row) => row.status === 'returned' && !row.returnSeenAt,
  );
  if (returned.length) {
    const who = [...new Set(returned.map((row) => name(row.createdBy)))];
    const first = returned[0];
    list.push({
      id: 'returned',
      rule: 'returned',
      title: `${returned.length} returned ${returned.length === 1 ? 'item is' : 'items are'} waiting on ${who.join(' and ')}`,
      detail: first.returnReason ? `“${first.returnReason}”` : 'Sent back for a fix',
      path:
        'vendor' in first
          ? `/tools/receipts?receipt=${first.id}`
          : `/tools/mileage?trip=${first.id}`,
      tone: 'neutral',
    });
  }

  for (const receipt of data.receipts) {
    if (skip.has(receipt.id) || receipt.status === 'returned' || receipt.status === 'draft')
      continue;
    if (now - new Date(receipt.date).getTime() > 30 * 86_400_000) continue;
    if (!receipt.projectId && !receipt.vehicleId)
      list.push({
        id: `unassigned-${receipt.id}`,
        rule: 'unassigned',
        title: `${receipt.vendor} receipt has no project or vehicle`,
        detail: `${name(receipt.createdBy)} · ${formatCurrency(receipt.total)}${receipt.category === 'fuel' ? ' · fuel' : ''}`,
        path: `/tools/receipts?receipt=${receipt.id}`,
        tone: 'caution',
      });
    else if (receipt.status === 'submitted' && !receipt.total)
      list.push({
        id: `no-total-${receipt.id}`,
        rule: 'no-total',
        title: `${receipt.vendor} receipt has no total`,
        detail: name(receipt.createdBy),
        path: `/tools/receipts?receipt=${receipt.id}`,
        tone: 'caution',
      });
  }

  for (const entry of data.mileage) {
    if (skip.has(entry.id) || entry.status !== 'submitted' || entry.vehicleId) continue;
    const assigned = data.vehicles.find((vehicle) => vehicle.assignedTo === entry.createdBy);
    if (assigned)
      list.push({
        id: `own-${entry.id}`,
        rule: 'own-vehicle',
        title: `${name(entry.createdBy)} logged ${formatMiles(entry.miles)} in a personal vehicle`,
        detail: `${assigned.name} is assigned to ${name(entry.createdBy)} · paid back by the mile`,
        path: `/tools/mileage?trip=${entry.id}`,
        tone: 'caution',
      });
  }

  for (const project of data.projects) {
    if (!project.costAllowance || project.status === 'done') continue;
    const { tracked } = projectMoney(
      project,
      data.receipts.filter((row) => row.projectId === project.id),
      data.mileage.filter((row) => row.projectId === project.id),
      options.rate,
    );
    const share = tracked / project.costAllowance;
    if (share >= 0.85)
      list.push({
        id: `allowance-${project.id}`,
        rule: 'allowance',
        title: `${project.name} is at ${Math.round(share * 100)}% of its cost allowance`,
        detail: `${formatCurrency(tracked, { cents: false })} of ${formatCurrency(project.costAllowance, { cents: false })}`,
        path: `/projects/${project.id}`,
        tone: share > 1 ? 'critical' : 'caution',
      });
  }

  for (const file of data.files) {
    if (!file.expiresAt || skip.has(file.id) || file.attachedTo.some((ref) => skip.has(ref.id)))
      continue;
    const days = Math.ceil((new Date(file.expiresAt).getTime() - now) / 86_400_000);
    if (days <= 30)
      list.push({
        id: `expiring-${file.id}`,
        rule: 'expiring',
        title: `${file.name.replace(/\.[a-z]+$/i, '')} ${days <= 0 ? 'has expired' : `expires in ${days} days`}`,
        detail: 'Upload the renewed copy when it arrives',
        path: `/files?file=${file.id}`,
        tone: days <= 14 ? 'critical' : 'caution',
      });
  }

  const order: Exception['rule'][] = [
    'allowance',
    'own-vehicle',
    'unassigned',
    'no-total',
    'expiring',
    'returned',
  ];
  return list.sort((a, b) => order.indexOf(a.rule) - order.indexOf(b.rule));
}
