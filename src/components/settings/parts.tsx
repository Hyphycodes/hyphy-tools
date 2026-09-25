'use client';
import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Segmented } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import type { FieldDefinition } from '@/lib/platform/types';

/**
 * One rule, said as a question with its answers beside it: "Job · Required | Optional". The
 * whole settings area is made of these instead of checkboxes with database words.
 */
export function RuleRow<T extends string>({
  label,
  line,
  value,
  options,
  onChange,
  off,
  name,
}: {
  label: string;
  line?: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Why this rule doesn't apply right now ("Jobs are off"), instead of the choices. */
  off?: string;
  name: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">{label}</p>
        {(off || line) && (
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{off ?? line}</p>
        )}
      </div>
      {off ? (
        <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-faint">
          <Icon name="lock" size={13} /> Off
        </span>
      ) : (
        <div role="group" aria-label={label} className="w-full shrink-0 sm:w-auto sm:min-w-[220px]">
          <Segmented name={name} value={value} options={options} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export type PreviewRow = {
  label: string;
  /** What the field looks like: a value, or a hint of what's asked. */
  sample?: string;
  required?: boolean;
  /** Hyphy's own fields stay quiet; the business's own read like them. */
  kind?: 'choice' | 'text' | 'yesno';
};

/**
 * What an employee's form looks like with these rules — a picture of the real form, so an owner
 * sees "Mike will be asked for Job, Truck and Cost Code" without building anything.
 */
export function EmployeePreview({
  title,
  who,
  rows,
  footer,
}: {
  title: string;
  who: string;
  rows: PreviewRow[];
  footer: string;
}) {
  return (
    <section
      aria-label="Employee preview"
      className="overflow-hidden rounded-[22px] bg-ink p-2 shadow-lift"
    >
      <div className="flex items-center justify-between px-3 pt-1.5 pb-2.5 text-[11.5px] font-medium text-white/60">
        <span>Employee preview</span>
        <span>{who}</span>
      </div>
      <div className="rounded-[16px] bg-surface px-4 pt-4 pb-3">
        <p className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{title}</p>
        <ul className="mt-3 grid gap-2.5" data-preview-fields>
          {rows.map((row) => (
            <li key={row.label} data-preview-field={row.label}>
              <p className="flex items-baseline justify-between text-[12px] font-medium text-ink-2">
                <span>
                  {row.label}
                  {row.required && (
                    <span className="text-critical" aria-label="required">
                      {' '}
                      *
                    </span>
                  )}
                </span>
                {!row.required && (
                  <span className="text-[11px] font-normal text-faint">Optional</span>
                )}
              </p>
              {row.kind === 'yesno' ? (
                <span className="mt-1 grid grid-cols-2 gap-1 rounded-[9px] bg-well p-0.5 text-center text-[11.5px] text-muted">
                  <span className="rounded-[7px] bg-surface py-1 text-ink shadow-card">Yes</span>
                  <span className="py-1">No</span>
                </span>
              ) : (
                <span
                  className={cn(
                    'mt-1 flex h-8 items-center justify-between rounded-[9px] px-2.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-line-strong)]',
                    row.sample ? 'text-ink' : 'text-faint',
                  )}
                >
                  <span className="truncate">{row.sample ?? ' '}</span>
                  {row.kind === 'choice' && <Icon name="chevron-down" size={13} />}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 grid h-9 place-items-center rounded-[10px] bg-ink text-[13px] font-medium text-white">
          {footer}
        </p>
      </div>
    </section>
  );
}

/** A business field as a preview row. */
export function previewRow(
  field: FieldDefinition,
  words: { project: string; vehicle: string },
): PreviewRow {
  return {
    label: field.label,
    required: field.required,
    kind:
      field.type === 'boolean'
        ? 'yesno'
        : ['select', 'person', 'project', 'vehicle'].includes(field.type)
          ? 'choice'
          : 'text',
    sample:
      field.type === 'select'
        ? field.options?.[0]
        : field.type === 'project'
          ? `Pick a ${words.project.toLowerCase()}`
          : field.type === 'vehicle'
            ? `Pick a ${words.vehicle.toLowerCase()}`
            : field.type === 'person'
              ? 'Pick someone'
              : undefined,
  };
}

/** A small "saved / unsaved" footer for a rules panel. */
export function SaveBar({
  dirty,
  pending,
  label,
  onSave,
  onUndo,
}: {
  dirty: boolean;
  pending: boolean;
  label: string;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
      <p className="mr-auto text-[12.5px] text-muted" aria-live="polite">
        {dirty ? 'Not saved yet' : 'Saved'}
      </p>
      {dirty && (
        <button
          type="button"
          onClick={onUndo}
          className="rounded-[9px] px-2.5 py-1.5 text-[13px] text-muted hover:bg-ink/5 hover:text-ink"
        >
          Undo
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || pending}
        className="h-8 rounded-[9px] bg-ink px-3 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
      >
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
