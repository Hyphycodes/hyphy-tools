import type { SpaceSettings } from './business-settings';
import type {
  FieldDefinition,
  ModuleId,
  ModuleLabel,
  RecordType,
  Space,
  SpaceLabels,
  WorkStyle,
} from './types';

/**
 * What kind of business a Space is. One choice at creation that gives a useful starting setup —
 * words, tools, a few suggested fields and sensible rules — never a separate structure: every
 * business runs on the same Projects, People, Files and tools, and can change any of it later in
 * Settings. A preset is where a business starts, not a box it's kept in.
 */
export const BUSINESS_TYPES = [
  'construction',
  'hospitality',
  'real-estate',
  'creative',
  'field-services',
  'professional',
  'retail',
  'other',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** A field a kind of business usually wants. Added as an ordinary field the owner can change. */
export type PresetField = Pick<
  FieldDefinition,
  'id' | 'label' | 'type' | 'options' | 'required' | 'help' | 'showInList'
> & { appliesTo: RecordType };

export type BusinessPreset = {
  id: BusinessType;
  label: string;
  /** A few words under the name, for recognizing the choice. */
  line: string;
  workStyle: WorkStyle;
  /** What its projects are called, when not the work style's default. */
  projects?: ModuleLabel;
  /** Who the work is for, and what the vehicles are called, when it's worth saying. */
  customer?: ModuleLabel;
  vehicles?: ModuleLabel;
  /** Tools on to start with. Files and People are always on in a business. */
  modules: ModuleId[];
  /** Suggested fields: what this kind of business usually tracks. */
  fields: PresetField[];
  /** Starting rules. Never a mileage rate: the business chooses what it pays back. */
  settings: SpaceSettings;
};

const COST_CODES = ['100 — General', '200 — Materials', '300 — Equipment'];

export const businessTypes: Record<BusinessType, BusinessPreset> = {
  construction: {
    id: 'construction',
    label: 'Construction / Trades',
    line: 'Jobs, crews, trucks and receipts',
    workStyle: 'jobs',
    projects: { singular: 'Job', plural: 'Jobs' },
    customer: { singular: 'Customer', plural: 'Customers' },
    modules: ['projects', 'people', 'vehicles', 'receipts', 'mileage', 'files', 'qr'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'job_number',
        label: 'Job Number',
        type: 'text',
        showInList: true,
      },
      { appliesTo: 'projects', id: 'foreman', label: 'Foreman', type: 'person' },
      {
        appliesTo: 'receipts',
        id: 'cost_code',
        label: 'Cost Code',
        type: 'select',
        options: COST_CODES,
      },
      { appliesTo: 'receipts', id: 'reimbursable', label: 'Reimbursable?', type: 'boolean' },
    ],
    settings: { receipts: { requireProject: true } },
  },
  hospitality: {
    id: 'hospitality',
    label: 'Restaurant / Hospitality',
    line: 'Events, staff, menus and QR',
    workStyle: 'events',
    customer: { singular: 'Client', plural: 'Clients' },
    modules: ['projects', 'people', 'receipts', 'files', 'qr', 'links'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'room',
        label: 'Room',
        type: 'select',
        options: ['Dining room', 'Private room', 'Bar & patio'],
        showInList: true,
      },
      { appliesTo: 'projects', id: 'host', label: 'Host', type: 'person' },
      { appliesTo: 'projects', id: 'expected_guests', label: 'Expected Guests', type: 'number' },
      {
        appliesTo: 'receipts',
        id: 'department',
        label: 'Department',
        type: 'select',
        options: ['Kitchen', 'Bar', 'Front of house'],
      },
    ],
    settings: {},
  },
  'real-estate': {
    id: 'real-estate',
    label: 'Real Estate',
    line: 'Properties, showings and documents',
    workStyle: 'engagements',
    projects: { singular: 'Property', plural: 'Properties' },
    customer: { singular: 'Client', plural: 'Clients' },
    modules: ['projects', 'people', 'mileage', 'files', 'pdf', 'images', 'qr', 'links'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'mls_number',
        label: 'MLS Number',
        type: 'text',
        showInList: true,
      },
      {
        appliesTo: 'projects',
        id: 'property_type',
        label: 'Property Type',
        type: 'select',
        options: ['Single-family', 'Condo', 'Townhome', 'Multi-family', 'Land', 'Commercial'],
      },
      { appliesTo: 'projects', id: 'agent', label: 'Agent', type: 'person' },
    ],
    // Showings and closings are why the miles happen; saying which keeps the log useful.
    settings: { mileage: { requirePurpose: true } },
  },
  creative: {
    id: 'creative',
    label: 'Creative / Agency',
    line: 'Client projects, files and links',
    workStyle: 'engagements',
    modules: ['projects', 'people', 'files', 'pdf', 'images', 'qr', 'links', 'receipts'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'engagement',
        label: 'Engagement',
        type: 'select',
        options: ['Retainer', 'Project', 'Pitch'],
        showInList: true,
      },
      { appliesTo: 'receipts', id: 'billable', label: 'Bill to client?', type: 'boolean' },
    ],
    settings: {},
  },
  'field-services': {
    id: 'field-services',
    label: 'Transportation / Field Services',
    line: 'Jobs, vehicles, miles and fuel',
    workStyle: 'jobs',
    projects: { singular: 'Job', plural: 'Jobs' },
    customer: { singular: 'Customer', plural: 'Customers' },
    vehicles: { singular: 'Unit', plural: 'Units' },
    modules: ['projects', 'people', 'vehicles', 'mileage', 'receipts', 'files'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'work_order',
        label: 'Work Order #',
        type: 'text',
        showInList: true,
      },
      { appliesTo: 'vehicles', id: 'inspection_date', label: 'Inspection Date', type: 'date' },
      { appliesTo: 'receipts', id: 'reimbursable', label: 'Reimbursable?', type: 'boolean' },
    ],
    settings: { mileage: { requireProject: true } },
  },
  professional: {
    id: 'professional',
    label: 'Professional Services',
    line: 'Clients, documents and expenses',
    workStyle: 'engagements',
    projects: { singular: 'Engagement', plural: 'Engagements' },
    customer: { singular: 'Client', plural: 'Clients' },
    modules: ['projects', 'people', 'files', 'pdf', 'receipts', 'mileage'],
    fields: [
      {
        appliesTo: 'projects',
        id: 'reference',
        label: 'Reference #',
        type: 'text',
        showInList: true,
      },
      { appliesTo: 'receipts', id: 'billable', label: 'Bill to client?', type: 'boolean' },
    ],
    settings: { mileage: { requirePurpose: true } },
  },
  retail: {
    id: 'retail',
    label: 'Retail',
    line: 'Staff, receipts, signage and links',
    workStyle: 'engagements',
    modules: ['people', 'receipts', 'files', 'qr', 'links', 'images', 'pdf'],
    fields: [
      {
        appliesTo: 'receipts',
        id: 'department',
        label: 'Department',
        type: 'select',
        options: ['Sales floor', 'Stockroom', 'Office'],
      },
    ],
    settings: {},
  },
  other: {
    id: 'other',
    label: 'Something else',
    line: 'Start simple; add tools any time',
    workStyle: 'engagements',
    modules: ['projects', 'people', 'files', 'receipts', 'qr', 'pdf'],
    fields: [],
    settings: {},
  },
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/** Tools a business starts with: the preset's, plus the two every business needs. */
export function presetModules(type: BusinessType): ModuleId[] {
  return Array.from(new Set<ModuleId>([...businessTypes[type].modules, 'files', 'people']));
}

/** The words a business of this type starts with: only the ones the type names itself. */
export function presetLabels(type: BusinessType): SpaceLabels {
  const { projects, customer, vehicles } = businessTypes[type];
  return {
    ...(projects ? { projects } : {}),
    ...(customer ? { customer } : {}),
    ...(vehicles ? { vehicles } : {}),
  };
}

/**
 * The suggested fields as definitions for a new business. Only for tools the business has on:
 * a Foreman field is only suggested where there are Jobs.
 */
export function presetFields(
  type: BusinessType,
  spaceId: string,
  modules: ModuleId[] = presetModules(type),
): FieldDefinition[] {
  const counts: Partial<Record<RecordType, number>> = {};
  return businessTypes[type].fields
    .filter(
      (field) => modules.includes(field.appliesTo as ModuleId) || field.appliesTo === 'people',
    )
    .filter((field) => field.type !== 'project' || modules.includes('projects'))
    .filter((field) => field.type !== 'vehicle' || modules.includes('vehicles'))
    .map((field) => {
      const position = counts[field.appliesTo] ?? 0;
      counts[field.appliesTo] = position + 1;
      return { ...field, spaceId, position };
    });
}

export type PresetAdditions = {
  /** Tools the new kind usually has that are off here. */
  modules: ModuleId[];
  /** Suggested fields this business doesn't have (by key or by name, used or not). */
  fields: PresetField[];
  /** New words, when the kind names things differently from what the business uses now. */
  labels: SpaceLabels;
};

/**
 * What switching to another kind of business would add — never what it would take away. Nothing
 * is turned off, no field is archived or changed, and words change only if the owner says so.
 */
export function presetAdditions(
  space: Pick<Space, 'modules' | 'labels'>,
  fields: Pick<FieldDefinition, 'id' | 'appliesTo' | 'label'>[],
  type: BusinessType,
): PresetAdditions {
  const preset = businessTypes[type];
  const modules = presetModules(type).filter((module) => !space.modules.includes(module));
  const after = new Set([...space.modules, ...modules]);
  const has = (field: PresetField) =>
    fields.some(
      (existing) =>
        existing.appliesTo === field.appliesTo &&
        (existing.id === field.id || existing.label.toLowerCase() === field.label.toLowerCase()),
    );
  const labels: SpaceLabels = {};
  for (const key of ['projects', 'customer', 'vehicles'] as const) {
    const next = preset[key];
    if (next && space.labels?.[key]?.singular !== next.singular) labels[key] = next;
  }
  return {
    modules,
    fields: preset.fields
      .filter((field) => !has(field))
      .filter((field) => after.has(field.appliesTo as ModuleId) || field.appliesTo === 'people')
      .filter((field) => field.type !== 'vehicle' || after.has('vehicles')),
    labels,
  };
}

export function hasAdditions(additions: PresetAdditions) {
  return (
    additions.modules.length > 0 ||
    additions.fields.length > 0 ||
    Object.keys(additions.labels).length > 0
  );
}

/**
 * "ABC Construction" → "abc-construction": a Space address people can read. Accents are folded,
 * anything else becomes a single dash, and it's cut to 48 characters.
 */
export function slugify(name: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug.length >= 2 ? slug : slug ? `${slug}-co` : '';
}

export const ADDRESS_PATTERN = /^[a-z0-9][a-z0-9-]{0,46}[a-z0-9]$/;

export function checkAddress(address: string): string | null {
  if (!ADDRESS_PATTERN.test(address) || address.includes('--'))
    return 'Use 2–48 lowercase letters, numbers and single dashes.';
  return null;
}

/** A starting mark: one of the Hyphy colors, picked from the name, with its first letter. */
const MARK_COLORS = ['#3240FF', '#16150F', '#13784A', '#C3301A', '#955800', '#7A3CE0', '#0A6C8C'];
export function brandFor(name: string): Space['brand'] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const letter =
    name
      .trim()
      .match(/[\p{L}\p{N}]/u)?.[0]
      ?.toUpperCase() ?? 'H';
  return { color: MARK_COLORS[hash % MARK_COLORS.length], ink: 'light', monogram: letter };
}
