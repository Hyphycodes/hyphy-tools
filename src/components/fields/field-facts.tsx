import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { fieldsFor, formatField, hasValue } from '@/lib/platform/custom-fields';
import type { FieldDefinition, FieldType, FieldValue, RecordType } from '@/lib/platform/types';

/*
 * The business's own fields, shown on a record the way Hyphy's own are: a label and its answer,
 * in the record's details. No "Custom fields" heading, no key/value dump — "Job Number 24-184"
 * reads exactly like "Customer Harrison Family".
 */

export type Lookup = (type: FieldType, id: string) => string | undefined;

/** Label → answer rows for a record: fields in use, and old ones it still has an answer for. */
export function fieldRows(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  values: Record<string, FieldValue> | undefined,
  lookup: Lookup,
  timezone: string,
  { withEmpty = false }: { withEmpty?: boolean } = {},
): [string, string][] {
  return fieldsFor(fields, appliesTo, values)
    .filter((field) => field.type !== 'file' || hasValue(values?.[field.id]))
    .filter((field) => withEmpty || hasValue(values?.[field.id]))
    .map((field) => [field.label, formatField(field, values?.[field.id], lookup, timezone)]);
}

/** The few answers a business chose to see on list rows ("24-184 · Residential"). */
export function listLine(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  values: Record<string, FieldValue> | undefined,
  lookup: Lookup,
  timezone: string,
) {
  return fields
    .filter((field) => field.appliesTo === appliesTo && field.showInList && !field.archivedAt)
    .filter((field) => hasValue(values?.[field.id]))
    .map((field) => formatField(field, values?.[field.id], lookup, timezone));
}

/** A record's details as a definition list; `rows` may mix Hyphy's fields and the business's. */
export function Facts({
  rows,
  className,
  children,
}: {
  rows: [string, ReactNode][];
  className?: string;
  children?: ReactNode;
}) {
  if (!rows.length && !children) return null;
  return (
    <dl className={cn('row-divide', className)}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-[13.5px]">
          <dt className="shrink-0 text-muted">{label}</dt>
          <dd className="min-w-0 text-right font-medium break-words text-ink">{value}</dd>
        </div>
      ))}
      {children}
    </dl>
  );
}
