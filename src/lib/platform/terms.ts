import type { ModuleLabel, Space, SpaceLabels } from './types';

/**
 * The few words a business may choose, each from a short list. Hyphy doesn't let a business
 * rename everything: a person moving between two businesses should still recognize the product.
 * Three concepts are worth it — the work itself, the people it's for, and the vehicles.
 *
 * Words are stored on the Space (`spaces.labels`) and read through `termsFor`, never copied onto
 * records, so a change shows everywhere at once and old records read in the new words.
 */

export type TermKey = keyof SpaceLabels;

export const WORK_TERMS: ModuleLabel[] = [
  { singular: 'Project', plural: 'Projects' },
  { singular: 'Job', plural: 'Jobs' },
  { singular: 'Property', plural: 'Properties' },
  { singular: 'Event', plural: 'Events' },
  { singular: 'Engagement', plural: 'Engagements' },
  { singular: 'Case', plural: 'Cases' },
];

export const CUSTOMER_TERMS: ModuleLabel[] = [
  { singular: 'Client', plural: 'Clients' },
  { singular: 'Customer', plural: 'Customers' },
  { singular: 'Host', plural: 'Hosts' },
  { singular: 'Guest', plural: 'Guests' },
];

export const VEHICLE_TERMS: ModuleLabel[] = [
  { singular: 'Vehicle', plural: 'Vehicles' },
  { singular: 'Truck', plural: 'Trucks' },
  { singular: 'Unit', plural: 'Units' },
  { singular: 'Van', plural: 'Vans' },
];

export const termChoices: Record<TermKey, ModuleLabel[]> = {
  projects: WORK_TERMS,
  customer: CUSTOMER_TERMS,
  vehicles: VEHICLE_TERMS,
};

export const termQuestions: Record<TermKey, { question: string; hint: string }> = {
  projects: {
    question: 'What do you call your work?',
    hint: 'Used for the menu, pages and forms.',
  },
  customer: {
    question: 'Who is the work for?',
    hint: 'The name on each one: “Customer: Harrison Family”.',
  },
  vehicles: {
    question: 'What do you call your vehicles?',
    hint: 'Shown wherever vehicles are.',
  },
};

/** The curated choice with this singular word, if it is one. */
export function findTerm(key: TermKey, singular: unknown): ModuleLabel | undefined {
  if (typeof singular !== 'string') return undefined;
  return termChoices[key].find((term) => term.singular === singular.trim());
}

/**
 * Only curated words are kept: anything else (a typo, a crafted request) is dropped, so the
 * interface can't be made to say something Hyphy never offered.
 */
export function cleanLabels(labels: unknown): SpaceLabels {
  const out: SpaceLabels = {};
  if (!labels || typeof labels !== 'object') return out;
  for (const key of Object.keys(termChoices) as TermKey[]) {
    const term = findTerm(key, (labels as Record<string, { singular?: unknown }>)[key]?.singular);
    if (term) out[key] = term;
  }
  return out;
}

/** What this Space calls its vehicles: Vehicles unless it chose Trucks, Units or Vans. */
export function vehicleWords(space: Pick<Space, 'labels'>): ModuleLabel {
  return space.labels?.vehicles ?? VEHICLE_TERMS[0];
}

/** "Job" → "job", keeping acronyms and names as they are. */
export function lower(word: string) {
  return /^[A-Z][a-z]/.test(word) ? word.toLowerCase() : word;
}
