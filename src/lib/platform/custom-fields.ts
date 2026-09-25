import type { FieldDefinition, FieldType, FieldValue, ModuleId, RecordType } from './types';
import { formatCurrency, formatDate } from './format';

/**
 * Custom fields: what a business tracks beyond what Hyphy already knows.
 *
 * One engine for every record that takes them (projects, vehicles, receipts, trips, people). A
 * field is a definition — label, type, required, order — kept per Space and record type
 * (`custom_fields`), plus a value on the record itself (`receipt.custom[field.id]`). Values live on
 * the record, so they come and go with it: whoever can see the receipt sees its Cost Code, and
 * nobody else can, without a second set of access rules.
 *
 * What a business can't do is redefine the record. Amount, date, who sent it and whether it was
 * approved belong to Hyphy; a field only ever adds.
 *
 * The lifecycle is conservative, because records outlive settings:
 *   - a field's key never changes, so saved values always find their field;
 *   - once any record has a value, its type is fixed and a dropdown can only gain choices;
 *   - "Stop using" archives it: forms stop asking, records keep (and still show) their value;
 *   - only a field nothing has used can be removed outright.
 *
 * The same rules are checked by the database (`private.check_custom_values`).
 */

/** At most this many fields in use per record type: enough for a real business, not a database. */
export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 50;
export const MAX_TEXT = 200;

export const fieldTypes: Record<
  FieldType,
  { label: string; example: string; line: string; creatable: boolean }
> = {
  text: { label: 'Text', example: 'PO-4471', line: 'A few words or a number', creatable: true },
  number: {
    label: 'Number',
    example: '42',
    line: 'A count, like units or guests',
    creatable: true,
  },
  currency: { label: 'Money', example: '$18,400', line: 'An amount in dollars', creatable: true },
  date: { label: 'Date', example: 'Oct 3', line: 'A day, like an inspection', creatable: true },
  boolean: { label: 'Yes / No', example: 'Yes', line: 'A simple yes or no', creatable: true },
  select: {
    label: 'Dropdown',
    example: '200 — Materials',
    line: 'One choice from your list',
    creatable: true,
  },
  person: {
    label: 'Person',
    example: 'Mike Rodriguez',
    line: 'Someone on your team',
    creatable: true,
  },
  project: { label: 'Project', example: 'Oak Brook Remodel', line: 'One of your', creatable: true },
  vehicle: { label: 'Vehicle', example: 'Truck 24', line: 'One of your', creatable: true },
  // Kept for fields made before Phase 2C; new ones wait for file storage.
  file: { label: 'File', example: 'insurance-certificate.pdf', line: 'A file', creatable: false },
};

export const CREATABLE_TYPES = (Object.keys(fieldTypes) as FieldType[]).filter(
  (type) => fieldTypes[type].creatable,
);

/** Which types need a tool that's on: a Vehicle field means nothing without Vehicles. */
export const typeNeeds: Partial<Record<FieldType, 'projects' | 'vehicles'>> = {
  project: 'projects',
  vehicle: 'vehicles',
};

export const RECORD_TYPES: RecordType[] = ['projects', 'receipts', 'mileage', 'vehicles', 'people'];

export const recordTypes: Record<
  RecordType,
  { module: 'projects' | 'receipts' | 'mileage' | 'vehicles' | 'people'; noun: string }
> = {
  projects: { module: 'projects', noun: 'project' },
  receipts: { module: 'receipts', noun: 'receipt' },
  mileage: { module: 'mileage', noun: 'trip' },
  vehicles: { module: 'vehicles', noun: 'vehicle' },
  people: { module: 'people', noun: 'person' },
};

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (RECORD_TYPES as string[]).includes(value);
}

/* ---------- which fields ---------- */

const byPosition = (a: FieldDefinition, b: FieldDefinition) =>
  a.position - b.position || a.label.localeCompare(b.label);

/** The fields in use today for this kind of record, in order. */
export function activeFields(fields: FieldDefinition[], appliesTo: RecordType) {
  return fields
    .filter((field) => field.appliesTo === appliesTo && !field.archivedAt)
    .sort(byPosition);
}

/** Whether a field can be answered with the tools that are on: no Truck field without Vehicles. */
export function fieldUsable(field: Pick<FieldDefinition, 'type'>, modules: ModuleId[]) {
  const needs = typeNeeds[field.type];
  return !needs || modules.includes(needs);
}

/** The fields a form asks for: in use, and answerable with the tools that are on. */
export function formFields(fields: FieldDefinition[], appliesTo: RecordType, modules: ModuleId[]) {
  return activeFields(fields, appliesTo).filter((field) => fieldUsable(field, modules));
}

/**
 * The fields a record shows: every field in use today, plus any it has an old value for. A
 * receipt from before "Cost Code" was retired still says what its Cost Code was.
 */
export function fieldsFor(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  values: Record<string, FieldValue> | undefined,
) {
  return fields
    .filter(
      (field) =>
        field.appliesTo === appliesTo && (!field.archivedAt || hasValue(values?.[field.id])),
    )
    .sort(byPosition);
}

export function hasValue(value: FieldValue | undefined) {
  return value !== null && value !== undefined && value !== '';
}

/* ---------- definitions ---------- */

/** "Cost Code" → "cost_code", unique among `taken`. Keys never change once made. */
export function fieldKey(label: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base =
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'f_$1')
      .slice(0, 32) || 'field';
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base.slice(0, 29)}_${n}`;
  return key;
}

export const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/** A dropdown's choices, trimmed, without blanks or repeats. */
export function cleanOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const option = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!option || seen.has(option.toLowerCase())) continue;
    seen.add(option.toLowerCase());
    out.push(option);
  }
  return out;
}

export type DefinitionDraft = Pick<
  FieldDefinition,
  'label' | 'type' | 'options' | 'required' | 'help' | 'showInList'
>;

/**
 * Why a new or changed definition can't be saved, in the owner's words — or null. `inUse` is
 * whether any record already has a value for it.
 */
export function definitionProblem(
  next: DefinitionDraft,
  previous?: FieldDefinition,
  inUse = false,
): string | null {
  const label = next.label?.trim() ?? '';
  if (!label) return 'Give the field a name.';
  if (label.length > 40) return 'Keep the name under 40 characters.';
  if (!previous && !CREATABLE_TYPES.includes(next.type)) return 'Choose what kind of answer it is.';
  if (previous && next.type !== previous.type) {
    if (inUse)
      return `${previous.label} already has answers saved as ${fieldTypes[previous.type].label.toLowerCase()}, so its kind can’t change. Stop using it and add a new field instead.`;
    if (!CREATABLE_TYPES.includes(next.type)) return 'Choose what kind of answer it is.';
  }
  if (next.help && next.help.length > 120) return 'Keep the hint under 120 characters.';
  if (next.type === 'select') {
    const options = next.options ?? [];
    if (!options.length) return 'Add at least one choice.';
    if (options.length > MAX_OPTIONS) return `Keep it to ${MAX_OPTIONS} choices.`;
    if (options.some((option) => option.length > 60))
      return 'Keep each choice under 60 characters.';
    if (previous?.type === 'select' && inUse) {
      const missing = (previous.options ?? []).filter((option) => !options.includes(option));
      if (missing.length)
        return `Records already use ${missing.map((option) => `“${option}”`).join(', ')}, so ${missing.length === 1 ? 'it stays' : 'they stay'}. You can add choices.`;
    }
  }
  return null;
}

/* ---------- values ---------- */

/** Checks one value against its definition. A message, or null when it's valid. */
export function validateField(
  field: Pick<FieldDefinition, 'label' | 'type' | 'options' | 'required'> & { id?: string },
  value: FieldValue | undefined,
): string | null {
  if (!hasValue(value)) return field.required ? `${field.label} is required.` : null;
  switch (field.type) {
    case 'number':
    case 'currency':
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12
        ? null
        : 'Enter a number.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Choose yes or no.';
    case 'date':
      return typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(value) &&
        !Number.isNaN(Date.parse(value))
        ? null
        : 'Enter a date.';
    case 'select':
      return field.options?.includes(String(value)) ? null : 'Choose one of the options.';
    case 'person':
    case 'project':
    case 'vehicle':
    case 'file':
      return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)
        ? null
        : 'Choose one from the list.';
    default:
      return typeof value === 'string' && value.length <= MAX_TEXT
        ? null
        : `Keep it under ${MAX_TEXT} characters.`;
  }
}

/** A problem with a field, said with its name: "Cost Code: Choose one of the options." */
export function problemText(field: Pick<FieldDefinition, 'label'>, message: string) {
  return message.startsWith(field.label) ? message : `${field.label}: ${message}`;
}

/** A value from a form (strings, mostly) as the type the field stores. */
export function coerceValue(field: FieldDefinition, raw: unknown): FieldValue {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    if (field.type === 'number' || field.type === 'currency') {
      const number = Number(text.replace(/[$,\s]/g, ''));
      return Number.isFinite(number) ? number : text;
    }
    if (field.type === 'boolean') return text === 'true' ? true : text === 'false' ? false : text;
    return text;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  return String(raw);
}

export type ValueCheck = {
  /** The record's values after the change: what to store. */
  values: Record<string, FieldValue>;
  /** Problems by field id, in words for the form. */
  errors: Record<string, string>;
};

/**
 * Turns what a form sent into the values a record stores, checking every field the business has
 * for this kind of record:
 *
 * - only fields in use can be set; keys that aren't this business's fields are ignored, and a
 *   field it stopped using keeps whatever the record already had (it can't be set or cleared);
 * - each value must be the field's kind (a number, one of the dropdown's choices, someone or
 *   something `exists` knows about);
 * - with `require`, every required field needs an answer.
 */
export function checkValues(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  input: unknown,
  options: {
    previous?: Record<string, FieldValue>;
    require?: boolean;
    exists?: (type: FieldType, id: string) => boolean;
    /** The Space's tools: a field whose kind needs a tool that's off isn't asked for. */
    modules?: ModuleId[];
  } = {},
): ValueCheck {
  const submitted = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const previous = options.previous ?? {};
  const values: Record<string, FieldValue> = {};
  const errors: Record<string, string> = {};
  const mine = fields.filter((field) => field.appliesTo === appliesTo);
  for (const field of mine) {
    if (field.archivedAt || (options.modules && !fieldUsable(field, options.modules))) {
      if (hasValue(previous[field.id])) values[field.id] = previous[field.id];
      continue;
    }
    const value =
      field.id in submitted ? coerceValue(field, submitted[field.id]) : previous[field.id];
    const problem = validateField(
      { ...field, required: Boolean(field.required && options.require) },
      value ?? null,
    );
    if (problem) {
      errors[field.id] = problem;
      continue;
    }
    // An answer nobody changed isn't re-judged (the person it names may have left since), as in
    // the database.
    if (
      hasValue(value) &&
      value !== previous[field.id] &&
      (field.type === 'person' || field.type === 'project' || field.type === 'vehicle') &&
      options.exists &&
      !options.exists(field.type, String(value))
    ) {
      errors[field.id] = 'Choose one from the list.';
      continue;
    }
    if (hasValue(value)) values[field.id] = value as FieldValue;
  }
  return { values, errors };
}

/** Which of these fields some record already has an answer for. */
export function fieldsInUse(records: { custom?: Record<string, FieldValue> }[]) {
  const used = new Set<string>();
  for (const record of records)
    for (const [key, value] of Object.entries(record.custom ?? {}))
      if (hasValue(value)) used.add(key);
  return used;
}

/* ---------- showing values ---------- */

/** Display text for a value. References resolve through `lookup` (id → name). */
export function formatField(
  field: FieldDefinition,
  value: FieldValue | undefined,
  lookup: (type: FieldType, id: string) => string | undefined = () => undefined,
  timezone?: string,
): string {
  if (!hasValue(value)) return '—';
  switch (field.type) {
    case 'currency':
      return formatCurrency(Number(value), { cents: !Number.isInteger(Number(value)) });
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
        ? formatDate(`${value}T12:00:00Z`, 'UTC')
        : formatDate(String(value), timezone);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'person':
    case 'project':
    case 'vehicle':
    case 'file':
      return lookup(field.type, String(value)) ?? 'Not available';
    default:
      return String(value);
  }
}

/** A value for a spreadsheet: plain, unformatted where a number is a number. */
export function exportField(
  field: FieldDefinition,
  value: FieldValue | undefined,
  lookup: (type: FieldType, id: string) => string | undefined = () => undefined,
): string {
  if (!hasValue(value)) return '';
  switch (field.type) {
    case 'currency':
      return Number(value).toFixed(2);
    case 'number':
      return String(value);
    case 'date':
      return String(value).slice(0, 10);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'person':
    case 'project':
    case 'vehicle':
    case 'file':
      return lookup(field.type, String(value)) ?? '';
    default:
      return String(value);
  }
}

/**
 * The words a record's answers add to search: short text and dropdown answers (a Job Number, an
 * MLS number, a Cost Code) — the ones people type to find something. Only for records the person
 * can already see, so nothing is found that isn't theirs to open.
 */
export function searchWords(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  values: Record<string, FieldValue> | undefined,
) {
  return fields
    .filter(
      (field) =>
        field.appliesTo === appliesTo && (field.type === 'text' || field.type === 'select'),
    )
    .map((field) => values?.[field.id])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
}

/** What a field of this type is called here: "Job", "Truck". */
export function typeLabel(
  type: FieldType,
  words: { project: string; vehicle: string } = { project: 'Project', vehicle: 'Vehicle' },
) {
  if (type === 'project') return words.project;
  if (type === 'vehicle') return words.vehicle;
  return fieldTypes[type].label;
}
