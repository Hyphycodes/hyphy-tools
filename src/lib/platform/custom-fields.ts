import type { FieldDefinition, FieldType, FieldValue } from './types';
import { formatCurrency, formatDate } from './format';

/**
 * Custom fields — architecture only in Phase 1.
 *
 * A business will be able to add its own fields to Projects, Vehicles and People without Hyphy
 * turning into a database builder. A field is a definition on the Space
 * (`space.customFields.projects`) plus a value on the record (`project.custom[field.id]`).
 * Reference types (`person`, `project`, `vehicle`, `file`) store the referenced record's id, so
 * the same values work as relationships in the database later (a `custom_field_values` table, or
 * a JSONB column validated by these definitions).
 *
 * The demo shows definitions and values read-only; editing comes with the settings work.
 */
export const fieldTypes: Record<FieldType, { label: string; example: string }> = {
  text: { label: 'Text', example: 'Permit #BP-24-0817' },
  number: { label: 'Number', example: '42' },
  currency: { label: 'Currency', example: '$18,400' },
  date: { label: 'Date', example: 'Oct 3' },
  boolean: { label: 'Yes / No', example: 'Yes' },
  select: { label: 'Dropdown', example: 'Residential' },
  person: { label: 'Person', example: 'Mike Rodriguez' },
  project: { label: 'Project', example: 'Oak Brook Remodel' },
  vehicle: { label: 'Vehicle', example: 'Truck 24' },
  file: { label: 'File', example: 'insurance-certificate.pdf' },
};

/** Checks a value against its definition. Returns a message, or null when it's valid. */
export function validateField(field: FieldDefinition, value: FieldValue): string | null {
  if (value === null || value === '') return field.required ? `${field.label} is required.` : null;
  switch (field.type) {
    case 'number':
    case 'currency':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Enter a number.';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Choose yes or no.';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'Enter a date.';
    case 'select':
      return field.options?.includes(String(value)) ? null : 'Choose one of the options.';
    default:
      return typeof value === 'string' ? null : 'Enter text.';
  }
}

/** Display text for a value. References resolve through `lookup` (id → name). */
export function formatField(
  field: FieldDefinition,
  value: FieldValue | undefined,
  lookup: (type: FieldType, id: string) => string | undefined = () => undefined,
  timezone?: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field.type) {
    case 'currency':
      return formatCurrency(Number(value), { cents: false });
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'date':
      return formatDate(String(value), timezone);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'person':
    case 'project':
    case 'vehicle':
    case 'file':
      return lookup(field.type, String(value)) ?? 'Unknown';
    default:
      return String(value);
  }
}
