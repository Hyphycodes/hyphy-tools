'use server';
import { getRepository } from '@/lib/data';
import { type MileageInput, type ReceiptInput } from '@/lib/data/repository';
import type { Workspace } from '@/lib/identity/types';
import type { SubmissionKind, SubmissionRef } from '@/lib/platform/approvals';
import { ACCENTS, scannableColor, withAccent } from '@/lib/platform/brand';
import {
  parseSettings,
  RECEIPT_CATEGORIES,
  submissionProblem,
  type SpaceSettings,
} from '@/lib/platform/business-settings';
import {
  checkValues,
  cleanOptions,
  CREATABLE_TYPES,
  isRecordType,
  problemText,
  recordTypes,
} from '@/lib/platform/custom-fields';
import type { Permission } from '@/lib/platform/roles';
import { grantableRoles, roles } from '@/lib/platform/roles';
import { isBusinessType, presetAdditions } from '@/lib/platform/business-types';
import { plans } from '@/lib/platform/plans';
import { cleanLabels, vehicleWords } from '@/lib/platform/terms';
import { teamFor } from '@/lib/teams';
import { availability, tools } from '@/lib/platform/tools';
import { workProfile } from '@/lib/platform/work';
import type {
  FieldType,
  FieldValue,
  LinkPage,
  ModuleId,
  PinTarget,
  ProjectStatus,
  RecordType,
  Role,
} from '@/lib/platform/types';

import {
  InputError,
  open,
  requireTool,
  run,
  visibleProject,
  visibleVehicle,
  type ActionResult,
} from './action-kit';

export type { ActionResult };

/*
 * Every change goes through here: resolve the Workspace from the URL, check the permission on
 * the server, validate, then write through the scoped repository. The same functions will run
 * unchanged against Supabase, where RLS checks everything a second time.
 */

/* ---------- validation ---------- */

type Input = Record<string, unknown>;

function text(input: Input, key: string, { max = 200, required = true } = {}) {
  const value = typeof input[key] === 'string' ? (input[key] as string).trim() : '';
  if (!value && required) throw new InputError(`Add ${key === 'name' ? 'a name' : `the ${key}`}.`);
  if (value.length > max) throw new InputError(`That ${key} is too long.`);
  return value || undefined;
}

function number(input: Input, key: string, { min = 0, max = 1e9, required = false } = {}) {
  const raw = input[key];
  if (raw === '' || raw === undefined || raw === null) {
    if (required) throw new InputError(`Add the ${key}.`);
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max)
    throw new InputError(`Check the ${key}.`);
  return value;
}

function date(input: Input, key: string, required = true) {
  const raw = typeof input[key] === 'string' ? (input[key] as string) : '';
  if (!raw) {
    if (required) throw new InputError(`Add the ${key}.`);
    return undefined;
  }
  // Date-only values are read as local noon so they don't slip a day across timezones.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00-05:00`) : new Date(raw);
  if (Number.isNaN(value.getTime())) throw new InputError(`Check the ${key}.`);
  return value.toISOString();
}

function oneOf<T extends string>(
  input: Input,
  key: string,
  options: readonly T[],
  fallback?: T,
): T {
  const value = input[key];
  if (options.includes(value as T)) return value as T;
  if (fallback) return fallback;
  throw new InputError(`Choose a ${key}.`);
}

/* ---------- the business's fields and rules, on every record they apply to ---------- */

type Repo = ReturnType<typeof getRepository>;

/**
 * The business's own fields on a record: checked against its definitions (only fields in use,
 * each its own kind, pointing only at people, projects and vehicles this person can see), with
 * answers to fields it stopped using kept as they were. `require` asks for every required field.
 */
async function customValues(
  repo: Repo,
  workspace: Workspace,
  appliesTo: RecordType,
  input: unknown,
  options: { previous?: Record<string, FieldValue>; require: boolean },
) {
  const [fields, members, projects, vehicles] = await Promise.all([
    repo.fields(appliesTo),
    repo.members(),
    repo.projects(),
    repo.vehicles(),
  ]);
  const exists = (type: FieldType, id: string) =>
    type === 'person'
      ? members.some((member) => member.personId === id && member.status === 'active')
      : type === 'project'
        ? projects.some((project) => project.id === id)
        : type === 'vehicle'
          ? vehicles.some((vehicle) => vehicle.id === id)
          : false;
  const { values, errors } = checkValues(fields, appliesTo, input, {
    ...options,
    exists,
    modules: workspace.space.modules,
  });
  const [key, message] = Object.entries(errors)[0] ?? [];
  if (key)
    throw new InputError(
      problemText(
        fields.find((field) => field.id === key)!,
        message,
      ),
    );
  return values;
}

/** Whether this person has a vehicle they could pick (a vehicle rule only asks them if so). */
async function hasVehicle(repo: Repo, workspace: Workspace) {
  return workspace.space.modules.includes('vehicles') && (await repo.vehicles()).length > 0;
}

/** Whether this person can see a project to pick (a project rule only asks them if so). */
async function hasProject(repo: Repo, workspace: Workspace) {
  return workspace.space.modules.includes('projects') && (await repo.projects()).length > 0;
}

/** The business's rules for something being sent, in its own words. */
async function checkRules(
  repo: Repo,
  workspace: Workspace,
  kind: 'receipt' | 'mileage',
  record: Parameters<typeof submissionProblem>[2],
) {
  const problem = submissionProblem(
    workspace.space,
    kind,
    record,
    {
      project: workProfile(workspace.space).singular,
      vehicle: vehicleWords(workspace.space).singular,
    },
    await hasVehicle(repo, workspace),
    await hasProject(repo, workspace),
  );
  if (problem) throw new InputError(problem);
}

/* ---------- actions ---------- */

const CATEGORIES = RECEIPT_CATEGORIES;

async function receiptFields(
  repo: Repo,
  workspace: Workspace,
  input: Input,
  draft: boolean,
  previous?: Record<string, FieldValue>,
): Promise<ReceiptInput> {
  const fields: ReceiptInput = {
    vendor: text(input, 'vendor', { max: 80 })!,
    category: oneOf(input, 'category', CATEGORIES, 'other'),
    total: number(input, 'total', { min: 0, max: 100000, required: !draft }) ?? 0,
    date: date(input, 'date')!,
    gallons: number(input, 'gallons', { max: 500 }),
    odometer: number(input, 'odometer', { max: 2_000_000 }),
    vehicleId: workspace.space.modules.includes('vehicles')
      ? await visibleVehicle(repo, input.vehicleId)
      : undefined,
    projectId: workspace.space.modules.includes('projects')
      ? await visibleProject(repo, input.projectId)
      : undefined,
    paymentMethod: text(input, 'paymentMethod', { max: 60, required: false }),
    notes: text(input, 'notes', { max: 500, required: false }),
    // The photo was uploaded first (file-actions.ts); the repository and the database check it's
    // this person's own finished file.
    fileId:
      typeof input.fileId === 'string' && input.fileId ? input.fileId.slice(0, 64) : undefined,
    // A draft may be unfinished; anything sent answers every required field.
    custom: await customValues(repo, workspace, 'receipts', input.custom, {
      previous,
      require: !draft,
    }),
    draft,
  };
  if (!draft) await checkRules(repo, workspace, 'receipt', fields);
  return fields;
}

async function mileageFields(
  repo: Repo,
  workspace: Workspace,
  input: Input,
  previous?: Record<string, FieldValue>,
): Promise<MileageInput> {
  const fields: MileageInput = {
    date: date(input, 'date')!,
    from: text(input, 'from', { max: 120 })!,
    to: text(input, 'to', { max: 120 })!,
    miles: number(input, 'miles', { min: 0.1, max: 2000, required: true })!,
    roundTrip: input.roundTrip === true,
    purpose: text(input, 'purpose', { max: 200, required: false }) ?? '',
    vehicleId: workspace.space.modules.includes('vehicles')
      ? await visibleVehicle(repo, input.vehicleId)
      : undefined,
    projectId: workspace.space.modules.includes('projects')
      ? await visibleProject(repo, input.projectId)
      : undefined,
    custom: await customValues(repo, workspace, 'mileage', input.custom, {
      previous,
      require: true,
    }),
  };
  await checkRules(repo, workspace, 'mileage', fields);
  return fields;
}

export async function createReceipt(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.submit');
    requireTool(workspace, 'receipts');
    const draft = input.draft === true;
    const receipt = await repo.createReceipt(await receiptFields(repo, workspace, input, draft));
    const business = workspace.space.kind === 'business';
    return {
      ok: true,
      id: receipt.id,
      message:
        receipt.status === 'submitted'
          ? 'Sent for approval'
          : draft
            ? 'Saved as a draft'
            : business && receipt.reviewedBy
              ? 'Filed and approved'
              : business
                ? 'Filed — no approval needed'
                : 'Saved to your receipts',
    };
  });
}

export async function createMileage(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.submit');
    requireTool(workspace, 'mileage');
    const entry = await repo.createMileage(await mileageFields(repo, workspace, input));
    return {
      ok: true,
      id: entry.id,
      message: entry.status === 'submitted' ? 'Sent for approval' : 'Trip saved',
    };
  });
}

/** The submitter's fix for a returned receipt, or a draft finished and sent. */
export async function resubmitReceipt(slug: string, id: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.submit');
    const current = await repo.receipt(String(id));
    const receipt = await repo.resubmitReceipt(
      String(id),
      await receiptFields(repo, workspace, input, false, current?.custom),
    );
    return {
      ok: true,
      id: receipt.id,
      message: receipt.status === 'submitted' ? 'Sent back for approval' : 'Saved',
    };
  });
}

export async function resubmitMileage(slug: string, id: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.submit');
    const current = (await repo.mileage()).find((entry) => entry.id === String(id));
    const entry = await repo.resubmitMileage(
      String(id),
      await mileageFields(repo, workspace, input, current?.custom),
    );
    return {
      ok: true,
      id: entry.id,
      message: entry.status === 'submitted' ? 'Sent back for approval' : 'Trip saved',
    };
  });
}

const STATUSES: ProjectStatus[] = ['planning', 'active', 'on-hold', 'done'];

export async function createProject(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'projects.manage');
    requireTool(workspace, 'projects');
    const members = await repo.members();
    const ids = new Set(members.map((member) => member.personId));
    const team = Array.isArray(input.teamIds)
      ? input.teamIds.map(String).filter((id) => ids.has(id))
      : [];
    const lead = ids.has(String(input.leadId)) ? String(input.leadId) : workspace.person.id;
    const project = await repo.createProject({
      name: text(input, 'name', { max: 80 })!,
      location: text(input, 'location', { max: 120, required: false }),
      client: text(input, 'client', { max: 80, required: false }),
      summary: text(input, 'summary', { max: 400, required: false }) ?? '',
      dueDate: date(input, 'dueDate', false),
      leadId: lead,
      teamIds: Array.from(new Set([lead, ...team])),
      value: number(input, 'value', { max: 1e9 }),
      costAllowance: number(input, 'costAllowance', { max: 1e8 }),
      status: oneOf(input, 'status', STATUSES, 'planning'),
      custom: await customValues(repo, workspace, 'projects', input.custom, { require: true }),
      // An event happens on its date; a job runs until it.
      ...(workspace.space.workStyle === 'events'
        ? { startDate: date(input, 'dueDate', false) }
        : {}),
    });
    return { ok: true, id: project.id };
  });
}

export async function invitePerson(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'people.manage');
    if (workspace.space.kind !== 'business')
      throw new InputError('Your Personal Space is just for you. Invite people to a business.');
    const role = oneOf<Role>(input, 'role', grantableRoles(workspace.membership.role));
    const email = text(input, 'email', { max: 254 })!.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Check the email address.');
    const projects = await repo.projects();
    const projectIds = Array.isArray(input.projectIds)
      ? input.projectIds.map(String).filter((id) => projects.some((project) => project.id === id))
      : [];
    if (role === 'guest' && projectIds.length === 0)
      throw new InputError('Pick at least one project a guest can see.');
    const team = teamFor(workspace);
    const { invitation, emailed } = await team.invite({
      // A name is how Demo Mode shows its fictional person; real people name themselves.
      name: text(input, 'name', { max: 80, required: !team.real }),
      email,
      role,
      title: text(input, 'title', { max: 80, required: false }),
      projectIds: projectIds.length ? projectIds : undefined,
      note: text(input, 'note', { max: 280, required: false }),
    });
    return {
      ok: true,
      id: invitation.id,
      message: !team.real
        ? `Invite ready for ${invitation.name.split(' ')[0]}`
        : emailed
          ? `Invitation sent to ${invitation.email}`
          : `Invitation ready for ${invitation.email} — share its link from People`,
    };
  });
}

/* ---------- the team: invitations and memberships (checked again by the database) ---------- */

async function team(slug: string, permission?: Permission) {
  const { workspace } = await open(slug, permission);
  return { workspace, team: teamFor(workspace) };
}

function id(value: unknown) {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(text)) throw new InputError('That isn’t available to you.');
  return text;
}

export async function resendInvitation(slug: string, invitationId: string) {
  return run(slug, async () => {
    const { team: t } = await team(slug, 'people.manage');
    const { emailed } = await t.resend(id(invitationId));
    return {
      ok: true,
      message: emailed ? 'Sent again, with a new link' : 'New link ready — copy it to share',
    };
  });
}

export async function shareInvitationLink(slug: string, invitationId: string) {
  return run(slug, async () => {
    const { team: t } = await team(slug, 'people.manage');
    return { ok: true, link: await t.shareLink(id(invitationId)), message: 'Link copied' };
  });
}

export async function revokeInvitation(slug: string, invitationId: string) {
  return run(slug, async () => {
    const { team: t } = await team(slug, 'people.manage');
    await t.revoke(id(invitationId));
    return { ok: true, message: 'Invitation revoked' };
  });
}

export async function setInvitationRole(slug: string, invitationId: string, role: string) {
  return run(slug, async () => {
    const { team: t, workspace } = await team(slug, 'people.manage');
    const next = oneOf<Role>({ role }, 'role', grantableRoles(workspace.membership.role));
    await t.setInvitationRole(id(invitationId), next);
    return { ok: true, message: `They’ll join as ${roles[next].label}` };
  });
}

export async function setMemberRole(slug: string, personId: string, role: string) {
  return run(slug, async () => {
    const { team: t, workspace } = await team(slug, 'people.manage');
    const next = oneOf<Role>({ role }, 'role', grantableRoles(workspace.membership.role));
    await t.setMemberRole(id(personId), next);
    return { ok: true, message: `Now ${roles[next].label}` };
  });
}

export async function removeMember(slug: string, personId: string) {
  return run(slug, async () => {
    const { team: t, workspace } = await team(slug, 'people.manage');
    await t.removeMember(id(personId));
    return {
      ok: true,
      message: `Removed from ${workspace.space.name}`,
      href: `/${workspace.space.slug}/people`,
    };
  });
}

export async function leaveSpace(slug: string) {
  return run(slug, async () => {
    const { team: t, workspace } = await team(slug);
    await t.leave();
    return { ok: true, message: `You left ${workspace.space.name}`, href: '/personal' };
  });
}

export async function transferOwnership(slug: string, personId: string, confirmName: string) {
  return run(slug, async () => {
    const { team: t, workspace } = await team(slug);
    if (workspace.membership.role !== 'owner')
      throw new InputError('Only the owner can transfer the business.');
    // The owner types the business's name: this is never a slip of a dropdown.
    if (confirmName.trim().toLowerCase() !== workspace.space.name.trim().toLowerCase())
      throw new InputError(`Type ${workspace.space.name} to confirm.`);
    await t.transferOwnership(id(personId));
    return { ok: true, message: 'Ownership transferred. You’re an admin now.' };
  });
}

/* ---------- the business itself: its setup (owners and admins) ---------- */

/** Business setup is for owners and admins of a business; everyone else uses it. */
async function setup(slug: string) {
  const context = await open(slug, 'space.manage');
  if (context.workspace.space.kind !== 'business')
    throw new InputError('That’s for business Spaces.');
  return context;
}

export async function updateBusiness(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await setup(slug);
    await repo.updateSpace({ name: text(input, 'name', { max: 80 })! });
    return { ok: true, message: 'Business name saved' };
  });
}

/** The few words a business chooses, each from Hyphy's short lists (`lib/platform/terms.ts`). */
export async function saveTerms(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    const wanted = cleanLabels({
      projects: { singular: input.projects },
      customer: { singular: input.customer },
      vehicles: { singular: input.vehicles },
    });
    for (const key of ['projects', 'customer', 'vehicles'] as const)
      if (input[key] !== undefined && input[key] !== '' && !wanted[key])
        throw new InputError('Choose the words from the list.');
    await repo.updateSpace({ labels: { ...workspace.space.labels, ...wanted } });
    return { ok: true, message: 'Words saved' };
  });
}

export async function saveAccent(slug: string, accentId: string) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    const accent = ACCENTS.find((item) => item.id === accentId);
    if (!accent) throw new InputError('Choose one of the accent colors.');
    await repo.updateSpace({ brand: withAccent(workspace.space.brand, accent) });
    return { ok: true, message: `${accent.name} it is` };
  });
}

/**
 * A new kind of business. Nothing is ever taken away: with `apply`, the new kind's missing tools,
 * suggested fields and words are added; without, only the kind changes.
 */
export async function changeBusinessType(slug: string, type: string, apply: boolean) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    if (!isBusinessType(type)) throw new InputError('Choose what kind of business this is.');
    const { space } = workspace;
    if (!apply) {
      await repo.updateSpace({ businessType: type });
      return { ok: true, message: 'Kind of business saved. Your setup stayed as it was.' };
    }
    const additions = presetAdditions(space, await repo.fields(), type);
    // Only tools the plan includes; the rest wait for a plan that has them.
    const inPlan = additions.modules.filter((module) =>
      plans[space.plan].includes.includes(module),
    );
    const modules = Array.from(new Set([...space.modules, ...inPlan]));
    await repo.updateSpace({
      businessType: type,
      ...(additions.workStyle ? { workStyle: additions.workStyle } : {}),
      labels: { ...space.labels, ...additions.labels },
      ...(inPlan.length ? { modules } : {}),
    });
    let added = 0;
    for (const field of additions.fields) {
      const needs = recordTypes[field.appliesTo].module;
      if (!modules.includes(needs)) continue;
      await repo.addField({ ...field, required: false });
      added += 1;
    }
    const parts = [
      inPlan.length ? `${inPlan.length} ${inPlan.length === 1 ? 'tool' : 'tools'} on` : '',
      added ? `${added} ${added === 1 ? 'field' : 'fields'} added` : '',
    ].filter(Boolean);
    return {
      ok: true,
      message: parts.length ? `Updated: ${parts.join(', ')}` : 'Kind of business saved',
    };
  });
}

const yes = (value: unknown) => value === true || value === 'true';

/** What receipts must name here, whether personal cards are paid back, when approval is needed. */
export async function saveReceiptRules(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo } = await setup(slug);
    const approval = String(input.approval ?? 'always');
    const receipts = parseSettings({
      receipts: {
        requireProject: yes(input.requireProject),
        requireVehicle: yes(input.requireVehicle),
        allowPersonal: yes(input.allowPersonal),
        requirePhoto: yes(input.requirePhoto),
        ...(input.defaultCategory ? { defaultCategory: input.defaultCategory } : {}),
        approval:
          approval === 'over'
            ? { mode: 'over', over: Number(String(input.over ?? '').replace(/[$,\s]/g, '')) }
            : { mode: approval },
      },
    }).receipts;
    await repo.updateSettings({
      receipts: { ...receipts, defaultCategory: receipts?.defaultCategory },
    });
    return { ok: true, message: 'Receipt rules saved' };
  });
}

/** The business's own mileage rate (never a tax table's), and what trips must say. */
export async function saveMileageRules(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    const raw = String(input.rate ?? '').replace(/[$,\s]/g, '');
    // Kept to a tenth of a cent, and never rounded down to nothing.
    const rate = raw === '' ? null : Math.round(Number(raw) * 1000) / 1000;
    if (rate !== null && (!Number.isFinite(rate) || rate < 0.01 || rate > 5))
      throw new InputError('Choose a rate between $0.01 and $5.00 a mile.');
    const mileage = parseSettings({
      mileage: {
        requireProject: yes(input.requireProject),
        requirePurpose: yes(input.requirePurpose),
        allowPersonalVehicles: yes(input.allowPersonalVehicles),
        approval: { mode: input.approval === 'never' ? 'never' : 'always' },
      },
    }).mileage;
    await repo.updateSettings({ mileage });
    if (rate !== (workspace.space.mileageRate ?? null))
      await repo.updateSpace({ mileageRate: rate as number });
    return { ok: true, message: 'Mileage rules saved' };
  });
}

export async function saveApprovers(slug: string, approvers: string) {
  return run(slug, async () => {
    const { repo } = await setup(slug);
    const settings: SpaceSettings = parseSettings({ approvals: { approvers } });
    await repo.updateSettings(settings);
    return {
      ok: true,
      message: approvers === 'admins' ? 'Owners and admins approve' : 'Managers approve too',
    };
  });
}

/* ---------- the business's own fields ---------- */

function recordType(value: unknown, workspace: Workspace): RecordType {
  if (!isRecordType(value)) throw new InputError('Choose where the field goes.');
  const needs = recordTypes[value].module;
  if (!workspace.space.modules.includes(needs))
    throw new InputError(
      `Turn on ${tools.find((tool) => tool.module === needs)?.name ?? 'the tool'} first.`,
    );
  return value;
}

async function fieldDraft(repo: Repo, appliesTo: RecordType, input: Input, id?: string) {
  const options = cleanOptions(
    Array.isArray(input.options) ? input.options : String(input.options ?? '').split('\n'),
  );
  const showInList = yes(input.showInList);
  if (showInList) {
    const listed = (await repo.fields(appliesTo)).filter(
      (field) => field.showInList && !field.archivedAt && field.id !== id,
    );
    if (listed.length >= 2)
      throw new InputError('Lists show up to two fields. Take one off first.');
  }
  return {
    label: text(input, 'label', { max: 40, required: false }) ?? '',
    options,
    required: yes(input.required),
    help: text(input, 'help', { max: 120, required: false }),
    showInList,
  };
}

export async function addField(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    const appliesTo = recordType(input.appliesTo, workspace);
    const type = oneOf(input, 'type', CREATABLE_TYPES);
    const draft = await fieldDraft(repo, appliesTo, input);
    const field = await repo.addField({
      appliesTo,
      type,
      ...draft,
      options: type === 'select' ? draft.options : undefined,
    });
    return { ok: true, id: field.id, message: `${field.label} added` };
  });
}

export async function updateField(slug: string, appliesTo: string, id: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    const kind = recordType(appliesTo, workspace);
    const type = oneOf(input, 'type', CREATABLE_TYPES);
    const draft = await fieldDraft(repo, kind, input, String(id));
    const field = await repo.updateField(kind, String(id), {
      ...draft,
      type,
      options: type === 'select' ? draft.options : undefined,
    });
    return { ok: true, id: field.id, message: `${field.label} saved` };
  });
}

export async function setFieldArchived(
  slug: string,
  appliesTo: string,
  id: string,
  archived: boolean,
) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    await repo.setFieldArchived(recordType(appliesTo, workspace), String(id), archived === true);
    return {
      ok: true,
      message: archived
        ? 'No longer asked for. Saved answers stay on their records.'
        : 'Asked for again',
    };
  });
}

export async function removeField(slug: string, appliesTo: string, id: string) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    await repo.removeField(recordType(appliesTo, workspace), String(id));
    return { ok: true, message: 'Field removed' };
  });
}

export async function moveField(slug: string, appliesTo: string, id: string, direction: number) {
  return run(slug, async () => {
    const { repo, workspace } = await setup(slug);
    await repo.moveField(recordType(appliesTo, workspace), String(id), direction < 0 ? -1 : 1);
    return { ok: true };
  });
}

/** The business's own answers on a project, vehicle or person — by whoever manages those. */
export async function saveRecordFields(
  slug: string,
  type: 'projects' | 'vehicles' | 'people',
  id: string,
  values: Input,
) {
  return run(slug, async () => {
    const permission: Permission =
      type === 'projects'
        ? 'projects.manage'
        : type === 'vehicles'
          ? 'vehicles.manage'
          : 'people.manage';
    const { repo, workspace } = await open(slug, permission);
    if (type === 'people') {
      const member = await repo.member(String(id));
      if (!member || member.status === 'removed') throw new InputError('That person isn’t here.');
      const custom = await customValues(repo, workspace, 'people', values, {
        previous: member.custom,
        require: true,
      });
      await repo.setMemberFields(member.personId, custom);
      return { ok: true, message: 'Details saved' };
    }
    if (type !== 'projects' && type !== 'vehicles') throw new InputError('Unknown record.');
    const record =
      type === 'projects' ? await repo.project(String(id)) : await repo.vehicle(String(id));
    if (!record) throw new InputError('That isn’t available to you.');
    const custom = await customValues(repo, workspace, type, values, {
      previous: record.custom,
      require: true,
    });
    await repo.setRecordFields(type, record.id, custom);
    return { ok: true, message: 'Details saved' };
  });
}

/** The end of the short setup after creating a business: its tools, then (optionally) its team. */
export async function finishSetup(slug: string) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'space.manage');
    if (!workspace.space.setupDoneAt)
      await repo.updateSpace({ setupDoneAt: new Date().toISOString() });
    return { ok: true, href: `/${workspace.space.slug}` };
  });
}

export async function createVehicle(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'vehicles.manage');
    requireTool(workspace, 'vehicles');
    const members = await repo.members();
    const assignedTo = members.some((member) => member.personId === input.assignedTo)
      ? String(input.assignedTo)
      : undefined;
    const vehicle = await repo.createVehicle({
      name: text(input, 'name', { max: 40 })!,
      year: number(input, 'year', { min: 1980, max: 2030, required: true })!,
      make: text(input, 'make', { max: 40 })!,
      model: text(input, 'model', { max: 60 })!,
      plate: text(input, 'plate', { max: 16, required: false }) ?? '—',
      fuel: oneOf(input, 'fuel', ['gas', 'diesel', 'electric'] as const, 'gas'),
      odometer: number(input, 'odometer', { max: 2_000_000 }) ?? 0,
      assignedTo,
      custom: await customValues(repo, workspace, 'vehicles', input.custom, { require: true }),
    });
    return { ok: true, id: vehicle.id };
  });
}

export async function saveQrCode(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'tools.use');
    requireTool(workspace, 'qr');
    const hex = /^#[0-9a-f]{6}$/i;
    const pages = await repo.linkPages();
    const code = await repo.saveQrCode({
      label: text(input, 'label', { max: 60 })!,
      content: text(input, 'content', { max: 1000 })!,
      fg: hex.test(String(input.fg)) ? String(input.fg) : '#0F0F0E',
      bg: hex.test(String(input.bg)) ? String(input.bg) : '#FFFFFF',
      placement: text(input, 'placement', { max: 60, required: false }),
      projectId: await visibleProject(repo, input.projectId),
      linkPageId: pages.find((page) => page.id === input.linkPageId)?.id,
    });
    return { ok: true, id: code.id, message: 'Saved to this Space' };
  });
}

const THEMES: LinkPage['theme'][] = ['paper', 'ink', 'signal', 'ember'];

export async function saveLinkPage(slug: string, input: Input) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'tools.use');
    requireTool(workspace, 'links');
    const links = (Array.isArray(input.links) ? input.links : [])
      .slice(0, 12)
      .map((link: Input, index: number) => ({
        id: String(link.id ?? `l${index}`),
        label: text(link, 'label', { max: 60 })!,
        url: text(link, 'url', { max: 300 })!,
      }));
    const handle = (text(input, 'handle', { max: 30 }) ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');
    if (!handle) throw new InputError('Pick a handle with letters or numbers.');
    const page = await repo.saveLinkPage({
      id: typeof input.id === 'string' ? input.id : undefined,
      title: text(input, 'title', { max: 60 })!,
      handle,
      bio: text(input, 'bio', { max: 160, required: false }) ?? '',
      theme: oneOf(input, 'theme', THEMES, 'paper'),
      links,
    });
    return { ok: true, id: page.id, message: 'Link page saved' };
  });
}

const KINDS_SUBMITTED: SubmissionKind[] = ['receipt', 'mileage'];

/** Approve or return one submission. A return can carry a short, optional reason. */
export async function reviewSubmission(
  slug: string,
  kind: SubmissionKind,
  id: string,
  decision: 'approved' | 'returned',
  reason?: string,
) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.approve');
    if (workspace.space.kind !== 'business') throw new InputError('Nothing to approve here.');
    if (!KINDS_SUBMITTED.includes(kind)) throw new InputError('Unknown item.');
    if (decision !== 'approved' && decision !== 'returned')
      throw new InputError('Unknown decision.');
    const note = typeof reason === 'string' ? reason.trim() : '';
    if (note.length > 280) throw new InputError('Keep the note under 280 characters.');
    await repo.review(kind, String(id), decision, note || undefined);
    return {
      ok: true,
      message: decision === 'approved' ? 'Approved' : 'Returned with your note',
    };
  });
}

/** Approve several at once. There is deliberately no bulk return: each one deserves a note. */
export async function approveSubmissions(slug: string, refs: SubmissionRef[]) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'expenses.approve');
    if (workspace.space.kind !== 'business') throw new InputError('Nothing to approve here.');
    if (!Array.isArray(refs) || refs.length === 0) throw new InputError('Pick something first.');
    if (refs.length > 50) throw new InputError('Up to 50 at a time.');
    const clean = refs
      .filter((ref) => KINDS_SUBMITTED.includes(ref?.kind))
      .map((ref) => ({ kind: ref.kind, id: String(ref.id) }));
    const approved = await repo.approveMany(clean);
    if (!approved) throw new InputError('Those were already decided.');
    return { ok: true, message: `${approved} approved` };
  });
}

export async function resolveInboxItem(slug: string, id: string) {
  return run(slug, async () => {
    const { repo } = await open(slug);
    const item = (await repo.inbox()).find((entry) => entry.id === id);
    if (!item) throw new InputError('That item is already handled.');
    await repo.resolveInbox(id);
    return { ok: true, message: item.kind === 'returned' ? 'Left as returned' : 'Marked as done' };
  });
}

/** Keep a tool or a project within reach. Pins are personal: nobody else sees them. */
export async function setPinned(slug: string, target: PinTarget, pinned: boolean) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug);
    if (target?.type === 'project') {
      if (!(await repo.project(String(target.id))))
        throw new InputError('That project isn’t available to you.');
    } else if (target?.type === 'tool') {
      const tool = tools.find((item) => item.id === target.id);
      if (!tool || availability(tool, workspace.space, workspace.membership).state !== 'ready')
        throw new InputError('That tool isn’t on here.');
    } else throw new InputError('Unknown item.');
    await repo.setPinned({ type: target.type, id: String(target.id) }, pinned === true);
    return { ok: true, message: pinned ? 'Pinned' : 'Unpinned' };
  });
}

/**
 * A QR code for one of this Space's link pages, in the Space's own color. Saved with the page
 * it opens, so the page, the code and the Space stay connected.
 */
export async function createLinkPageQr(slug: string, pageId: string) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'tools.use');
    requireTool(workspace, 'links');
    requireTool(workspace, 'qr');
    const page = (await repo.linkPages()).find((item) => item.id === pageId);
    if (!page) throw new InputError('Save the link page first.');
    const existing = (await repo.qrCodes()).find((code) => code.linkPageId === page.id);
    if (existing) return { ok: true, id: existing.id, message: 'Already has a code' };
    const code = await repo.saveQrCode({
      label: `@${page.handle} link page`,
      content: `https://hyphy.example/@${page.handle}`,
      fg: scannableColor(workspace.space.brand.color),
      bg: '#FFFFFF',
      placement: 'Anywhere people find you',
      linkPageId: page.id,
    });
    return { ok: true, id: code.id, message: 'QR code saved to this Space' };
  });
}

export async function setModules(slug: string, modules: string[]) {
  return run(slug, async () => {
    const { repo, workspace } = await open(slug, 'space.manage');
    const known = new Set(tools.flatMap((tool) => (tool.module ? [tool.module] : [])));
    const next = Array.from(
      new Set(modules.filter((id): id is ModuleId => known.has(id as ModuleId))),
    );
    // Files and People keep a business Space working; they can't be switched off here.
    const required: ModuleId[] =
      workspace.space.kind === 'business' ? ['files', 'people'] : ['files'];
    // Turning a tool off hides it; nothing it holds is deleted, and turning it on brings it back.
    await repo.setModules(Array.from(new Set([...required, ...next])));
    return { ok: true, message: 'Tools updated' };
  });
}

export type { Workspace };
