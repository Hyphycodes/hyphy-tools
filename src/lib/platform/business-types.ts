import type { ModuleId, ModuleLabel, Space, WorkStyle } from './types';

/**
 * What kind of business a Space is. One choice at creation that sets sensible starting words and
 * tools — never a separate structure: every business runs on the same Projects, People, Files and
 * tools, and can change its type, words or tools later in Settings.
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

export type BusinessPreset = {
  id: BusinessType;
  label: string;
  /** A few words under the name, for recognizing the choice. */
  line: string;
  workStyle: WorkStyle;
  /** What its projects are called, when not the work style's default. */
  projects?: ModuleLabel;
  /** Tools on to start with. Files and People are always on in a business. */
  modules: ModuleId[];
};

export const businessTypes: Record<BusinessType, BusinessPreset> = {
  construction: {
    id: 'construction',
    label: 'Construction / Trades',
    line: 'Jobs, crews, trucks and receipts',
    workStyle: 'jobs',
    projects: { singular: 'Job', plural: 'Jobs' },
    modules: ['projects', 'people', 'vehicles', 'receipts', 'mileage', 'files', 'qr'],
  },
  hospitality: {
    id: 'hospitality',
    label: 'Restaurant / Hospitality',
    line: 'Events, staff, menus and QR',
    workStyle: 'events',
    modules: ['projects', 'people', 'receipts', 'files', 'qr', 'links'],
  },
  'real-estate': {
    id: 'real-estate',
    label: 'Real Estate',
    line: 'Properties, showings and documents',
    workStyle: 'engagements',
    projects: { singular: 'Property', plural: 'Properties' },
    modules: ['projects', 'people', 'mileage', 'files', 'pdf', 'images', 'qr', 'links'],
  },
  creative: {
    id: 'creative',
    label: 'Creative / Agency',
    line: 'Client projects, files and links',
    workStyle: 'engagements',
    modules: ['projects', 'people', 'files', 'pdf', 'images', 'qr', 'links', 'receipts'],
  },
  'field-services': {
    id: 'field-services',
    label: 'Transportation / Field Services',
    line: 'Jobs, vehicles, miles and fuel',
    workStyle: 'jobs',
    projects: { singular: 'Job', plural: 'Jobs' },
    modules: ['projects', 'people', 'vehicles', 'mileage', 'receipts', 'files'],
  },
  professional: {
    id: 'professional',
    label: 'Professional Services',
    line: 'Clients, documents and expenses',
    workStyle: 'engagements',
    modules: ['projects', 'people', 'files', 'pdf', 'receipts', 'mileage'],
  },
  retail: {
    id: 'retail',
    label: 'Retail',
    line: 'Staff, receipts, signage and links',
    workStyle: 'engagements',
    modules: ['people', 'receipts', 'files', 'qr', 'links', 'images', 'pdf'],
  },
  other: {
    id: 'other',
    label: 'Something else',
    line: 'Start simple; add tools any time',
    workStyle: 'engagements',
    modules: ['projects', 'people', 'files', 'receipts', 'qr', 'pdf'],
  },
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/** Tools a business starts with: the preset's, plus the two every business needs. */
export function presetModules(type: BusinessType): ModuleId[] {
  return Array.from(new Set<ModuleId>([...businessTypes[type].modules, 'files', 'people']));
}

/** The words for its projects: `labels.projects` when the type names them itself. */
export function presetLabels(type: BusinessType): Space['labels'] {
  const projects = businessTypes[type].projects;
  return projects ? { projects } : {};
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
