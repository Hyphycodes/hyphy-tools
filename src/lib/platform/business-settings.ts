import { isPersonalPayment } from './payments';
import type { Membership, ModuleId, ReceiptCategory, Role, Space } from './types';

/**
 * How a business runs its receipts, mileage and approvals.
 *
 * Hyphy supplies the structure; the business supplies a handful of rules. Each rule is a plain
 * question with a default that matches how Hyphy has always behaved, so a business that never
 * opens Settings works exactly as before — and only what a business changed is stored
 * (`space_settings.settings`, one small validated document per Space).
 *
 * Rules decide what a *form* asks for and what a *submission* needs. They never touch what a
 * receipt is: amount, date, who sent it and its approval status stay Hyphy's.
 *
 * The same rules run in three places: the forms (what to show and mark required), the server
 * actions (what to accept) and the database (`private.check_submission_rules`,
 * `public.needs_approval` — supabase/migrations/20260930000000_business_customization.sql).
 */

export const RECEIPT_CATEGORIES: ReceiptCategory[] = [
  'fuel',
  'materials',
  'meals',
  'supplies',
  'equipment',
  'other',
];

/** When something needs a manager's yes: always, never, or only above an amount (receipts). */
export type ApprovalRule = { mode: 'always' | 'never' | 'over'; over?: number };

export type ReceiptSettings = {
  /** Every receipt names the job it was for. */
  requireProject?: boolean;
  /** Every receipt names a vehicle — when the person has one to pick. */
  requireVehicle?: boolean;
  /** People may pay with their own card and be paid back. */
  allowPersonal?: boolean;
  /** The category a new receipt starts on. */
  defaultCategory?: ReceiptCategory;
  approval?: ApprovalRule;
};

export type MileageSettings = {
  requireProject?: boolean;
  requirePurpose?: boolean;
  /** Trips in someone's own car (paid back by the mile). Off: company vehicles only. */
  allowPersonalVehicles?: boolean;
  approval?: ApprovalRule;
};

export type ApprovalSettings = {
  /** Who says yes: owners and admins, or managers too. */
  approvers?: 'managers' | 'admins';
};

export type SpaceSettings = {
  receipts?: ReceiptSettings;
  mileage?: MileageSettings;
  approvals?: ApprovalSettings;
};

export type ResolvedSettings = {
  receipts: Required<Omit<ReceiptSettings, 'defaultCategory'>> & {
    defaultCategory?: ReceiptCategory;
  };
  mileage: Required<MileageSettings>;
  approvals: Required<ApprovalSettings>;
};

/** Hyphy's own behavior before any business changed anything. */
export const DEFAULT_SETTINGS: ResolvedSettings = {
  receipts: {
    requireProject: false,
    requireVehicle: false,
    allowPersonal: true,
    approval: { mode: 'always' },
  },
  mileage: {
    requireProject: false,
    requirePurpose: false,
    allowPersonalVehicles: true,
    approval: { mode: 'always' },
  },
  approvals: { approvers: 'managers' },
};

export const MAX_THRESHOLD = 100_000;

export class SettingsError extends Error {}

const bool = (value: unknown, name: string) => {
  if (typeof value !== 'boolean') throw new SettingsError(`Choose yes or no for ${name}.`);
  return value;
};

function approvalRule(value: unknown, allowThreshold: boolean): ApprovalRule {
  const rule = value as ApprovalRule | undefined;
  if (!rule || typeof rule !== 'object') throw new SettingsError('Choose when approval is needed.');
  if (rule.mode === 'always' || rule.mode === 'never') return { mode: rule.mode };
  if (rule.mode === 'over' && allowThreshold) {
    const over = Number(rule.over);
    if (!Number.isFinite(over) || over <= 0 || over > MAX_THRESHOLD)
      throw new SettingsError('Choose an amount between $1 and $100,000.');
    return { mode: 'over', over: Math.round(over * 100) / 100 };
  }
  throw new SettingsError('Choose when approval is needed.');
}

/**
 * A settings document as a business may store it: only known questions, each with an allowed
 * answer. Anything else is refused, never silently kept — so what's stored can always be
 * explained on the settings screen. The database checks the same shape
 * (`private.valid_space_settings`).
 */
export function parseSettings(raw: unknown): SpaceSettings {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SettingsError('Unknown settings.');
  const input = raw as Record<string, Record<string, unknown> | undefined>;
  const out: SpaceSettings = {};
  for (const key of Object.keys(input))
    if (!['receipts', 'mileage', 'approvals'].includes(key))
      throw new SettingsError('Unknown settings.');
  const only = (section: Record<string, unknown>, allowed: string[]) => {
    for (const key of Object.keys(section))
      if (!allowed.includes(key)) throw new SettingsError('Unknown settings.');
  };
  if (input.receipts) {
    const r = input.receipts;
    only(r, ['requireProject', 'requireVehicle', 'allowPersonal', 'defaultCategory', 'approval']);
    out.receipts = {};
    if (r.requireProject !== undefined)
      out.receipts.requireProject = bool(r.requireProject, 'a project on every receipt');
    if (r.requireVehicle !== undefined)
      out.receipts.requireVehicle = bool(r.requireVehicle, 'a vehicle on every receipt');
    if (r.allowPersonal !== undefined)
      out.receipts.allowPersonal = bool(r.allowPersonal, 'personal expenses');
    if (r.defaultCategory !== undefined) {
      if (!RECEIPT_CATEGORIES.includes(r.defaultCategory as ReceiptCategory))
        throw new SettingsError('Choose one of the categories.');
      out.receipts.defaultCategory = r.defaultCategory as ReceiptCategory;
    }
    if (r.approval !== undefined) out.receipts.approval = approvalRule(r.approval, true);
  }
  if (input.mileage) {
    const m = input.mileage;
    only(m, ['requireProject', 'requirePurpose', 'allowPersonalVehicles', 'approval']);
    out.mileage = {};
    if (m.requireProject !== undefined)
      out.mileage.requireProject = bool(m.requireProject, 'a project on every trip');
    if (m.requirePurpose !== undefined)
      out.mileage.requirePurpose = bool(m.requirePurpose, 'a purpose on every trip');
    if (m.allowPersonalVehicles !== undefined)
      out.mileage.allowPersonalVehicles = bool(m.allowPersonalVehicles, 'personal vehicles');
    if (m.approval !== undefined) out.mileage.approval = approvalRule(m.approval, false);
  }
  if (input.approvals) {
    const a = input.approvals;
    only(a, ['approvers']);
    out.approvals = {};
    if (a.approvers !== undefined) {
      if (a.approvers !== 'managers' && a.approvers !== 'admins')
        throw new SettingsError('Choose who approves.');
      out.approvals.approvers = a.approvers;
    }
  }
  return out;
}

/** Stored settings plus a change to them, section by section. The result is parsed again. */
export function mergeSettings(current: SpaceSettings | undefined, patch: SpaceSettings) {
  const base = current ?? {};
  return parseSettings({
    ...base,
    ...(patch.receipts ? { receipts: { ...base.receipts, ...patch.receipts } } : {}),
    ...(patch.mileage ? { mileage: { ...base.mileage, ...patch.mileage } } : {}),
    ...(patch.approvals ? { approvals: { ...base.approvals, ...patch.approvals } } : {}),
  });
}

/** Every rule answered: the business's choice where it made one, Hyphy's default elsewhere. */
export function resolveSettings(space: Pick<Space, 'settings'>): ResolvedSettings {
  const stored = space.settings ?? {};
  return {
    receipts: { ...DEFAULT_SETTINGS.receipts, ...stored.receipts },
    mileage: { ...DEFAULT_SETTINGS.mileage, ...stored.mileage },
    approvals: { ...DEFAULT_SETTINGS.approvals, ...stored.approvals },
  };
}

/* ---------- approvals ---------- */

/** The roles that approve in this Space. Owners and admins always do. */
export function approverRoles(space: Pick<Space, 'kind' | 'settings'>): Role[] {
  if (space.kind === 'personal') return ['owner'];
  return resolveSettings(space).approvals.approvers === 'admins'
    ? ['owner', 'admin']
    : ['owner', 'admin', 'manager'];
}

export function isApprover(
  space: Pick<Space, 'kind' | 'settings'>,
  membership: Pick<Membership, 'role'>,
) {
  return approverRoles(space).includes(membership.role);
}

/**
 * Whether a receipt or trip from someone who isn't an approver waits for one. Personal Spaces
 * never wait. A receipt under the business's amount files straight through.
 */
export function needsApproval(
  space: Pick<Space, 'kind' | 'settings'>,
  kind: 'receipt' | 'mileage',
  amount = 0,
) {
  if (space.kind !== 'business') return false;
  const rule =
    kind === 'receipt'
      ? resolveSettings(space).receipts.approval
      : resolveSettings(space).mileage.approval;
  if (rule.mode === 'never') return false;
  if (rule.mode === 'over') return amount > (rule.over ?? 0);
  return true;
}

/** "Receipts over $250", "Every receipt", "Not needed" */
export function describeApproval(rule: ApprovalRule, noun: 'receipt' | 'trip') {
  if (rule.mode === 'never') return 'Not needed';
  if (rule.mode === 'over') return `Over $${(rule.over ?? 0).toLocaleString('en-US')}`;
  return noun === 'receipt' ? 'Every receipt' : 'Every trip';
}

/* ---------- what the forms ask for ---------- */

export type Requirement = 'required' | 'optional' | 'off';

export type FormRules = {
  receipts: {
    project: Requirement;
    vehicle: Requirement;
    /** Whether "Personal card (reimburse me)" is offered. */
    personalPayment: boolean;
    defaultCategory?: ReceiptCategory;
  };
  mileage: {
    project: Requirement;
    purpose: Requirement;
    /** Whether a trip can be in the person's own car. */
    personalVehicle: boolean;
  };
};

/**
 * What a business's forms ask for, given its rules and the tools it has on. A rule about a tool
 * that's off asks for nothing: turning Vehicles off never leaves "Vehicle *" on a receipt nobody
 * can fill in. `hasVehicle` / `hasProject`: whether this person has one they could pick — a rule
 * never asks for something the form has no way to choose.
 */
export function formRules(
  space: Pick<Space, 'kind' | 'settings' | 'modules'>,
  hasVehicle = true,
  hasProject = true,
): FormRules {
  const settings = resolveSettings(space);
  const business = space.kind === 'business';
  const on = (module: ModuleId) => space.modules.includes(module);
  const pick = (enabled: boolean, required: boolean): Requirement =>
    !enabled ? 'off' : required && business ? 'required' : 'optional';
  return {
    receipts: {
      project: pick(on('projects'), settings.receipts.requireProject && hasProject),
      vehicle: pick(on('vehicles'), settings.receipts.requireVehicle && hasVehicle),
      personalPayment: !business || settings.receipts.allowPersonal,
      defaultCategory: settings.receipts.defaultCategory,
    },
    mileage: {
      project: pick(on('projects'), settings.mileage.requireProject && hasProject),
      purpose: settings.mileage.requirePurpose && business ? 'required' : 'optional',
      personalVehicle: !business || !on('vehicles') || settings.mileage.allowPersonalVehicles,
    },
  };
}

/**
 * What a submission is missing under the business's rules, in words for the person — or null.
 * The server actions call this before writing; the database checks the same again.
 */
export function submissionProblem(
  space: Pick<Space, 'kind' | 'settings' | 'modules'>,
  kind: 'receipt' | 'mileage',
  record: {
    projectId?: string;
    vehicleId?: string;
    paymentMethod?: string;
    purpose?: string;
  },
  words: { project: string; vehicle: string },
  hasVehicle: boolean,
  hasProject = true,
): string | null {
  const rules = formRules(space, hasVehicle, hasProject);
  if (kind === 'receipt') {
    if (rules.receipts.project === 'required' && !record.projectId)
      return `Choose the ${words.project.toLowerCase()} this receipt is for.`;
    if (rules.receipts.vehicle === 'required' && !record.vehicleId)
      return `Choose the ${words.vehicle.toLowerCase()} this receipt is for.`;
    if (!rules.receipts.personalPayment && isPersonalPayment(record.paymentMethod))
      return 'This business doesn’t pay back personal expenses. Use a company card.';
    return null;
  }
  if (rules.mileage.project === 'required' && !record.projectId)
    return `Choose the ${words.project.toLowerCase()} this trip was for.`;
  if (rules.mileage.purpose === 'required' && !record.purpose?.trim())
    return 'Add what the trip was for.';
  if (!rules.mileage.personalVehicle && !record.vehicleId)
    return hasVehicle
      ? `Trips here are logged in a company ${words.vehicle.toLowerCase()}.`
      : `Trips here are logged in a company ${words.vehicle.toLowerCase()}, and none is assigned to you yet.`;
  return null;
}
