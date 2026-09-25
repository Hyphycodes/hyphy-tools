'use client';
import { useWorkspace } from '@/components/shell/workspace-context';
import { Field, Input, Segmented, Select } from '@/components/ui/form';
import { checkValues, hasValue, problemText } from '@/lib/platform/custom-fields';
import type { FieldDefinition, FieldValue, RecordType } from '@/lib/platform/types';

/*
 * The business's own fields, as form inputs. Every form that takes them (receipts, trips, jobs,
 * vehicles, people) renders them with this one component, so a Cost Code looks and behaves the
 * same everywhere — and to the person filling it in, it's simply another question the business
 * asks, not a "custom field".
 */

/** A form's answers, as the text the inputs hold. */
export type FieldAnswers = Record<string, string>;

/** A saved value as an input's text: dates as yyyy-mm-dd, yes/no as "true"/"false". */
export function answerOf(field: FieldDefinition, value: FieldValue | undefined, timezone: string) {
  if (!hasValue(value)) return '';
  if (field.type === 'boolean') return value ? 'true' : 'false';
  if (field.type === 'date') {
    const text = String(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(text)
      ? text
      : new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(text));
  }
  return String(value);
}

export function answersOf(
  fields: FieldDefinition[],
  values: Record<string, FieldValue> | undefined,
  timezone: string,
): FieldAnswers {
  return Object.fromEntries(
    fields.map((field) => [field.id, answerOf(field, values?.[field.id], timezone)]),
  );
}

/**
 * What's missing or wrong before sending, in the same words the server would use. `require` is
 * false for drafts, which may be unfinished.
 */
export function answerProblems(
  fields: FieldDefinition[],
  appliesTo: RecordType,
  answers: FieldAnswers,
  require = true,
) {
  const { errors } = checkValues(fields, appliesTo, answers, { require });
  return errors;
}

export function firstProblem(fields: FieldDefinition[], errors: Record<string, string>) {
  const [id, message] = Object.entries(errors)[0] ?? [];
  const field = fields.find((item) => item.id === id);
  return field && message ? problemText(field, message) : undefined;
}

export function FieldInputs({
  fields,
  answers,
  onChange,
  idPrefix,
  errors = {},
}: {
  fields: FieldDefinition[];
  answers: FieldAnswers;
  onChange: (id: string, value: string) => void;
  idPrefix: string;
  errors?: Record<string, string>;
}) {
  const workspace = useWorkspace();
  const { options } = workspace;
  return (
    <>
      {fields.map((field) => {
        const id = `${idPrefix}-cf-${field.id}`;
        const value = answers[field.id] ?? '';
        const set = (next: string) => onChange(field.id, next);
        const common = {
          label: field.label,
          htmlFor: id,
          optional: !field.required,
          hint: field.help,
          error: errors[field.id],
        };
        switch (field.type) {
          case 'boolean':
            return (
              <Field key={field.id} {...common} htmlFor={undefined}>
                <Segmented
                  name={id}
                  value={value as 'true' | 'false'}
                  onChange={set}
                  options={[
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]}
                />
              </Field>
            );
          case 'select':
            return (
              <Field key={field.id} {...common}>
                <Select
                  id={id}
                  value={value}
                  required={field.required}
                  onChange={(event) => set(event.target.value)}
                >
                  <option value="">{field.required ? 'Choose one' : 'None'}</option>
                  {/* A choice the business retired still shows on a record that has it. */}
                  {value && !field.options?.includes(value) && (
                    <option value={value}>{value}</option>
                  )}
                  {field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          case 'person':
          case 'project':
          case 'vehicle': {
            const list =
              field.type === 'person'
                ? options.people
                    .filter((person) => person.role !== 'guest')
                    .map((person) => ({ id: person.id, name: person.name }))
                : field.type === 'project'
                  ? options.projects
                      .filter((project) => project.status !== 'done' || project.id === value)
                      .map((project) => ({ id: project.id, name: project.name }))
                  : options.vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name }));
            return (
              <Field key={field.id} {...common}>
                <Select
                  id={id}
                  value={value}
                  required={field.required}
                  onChange={(event) => set(event.target.value)}
                >
                  <option value="">{field.required ? 'Choose one' : 'None'}</option>
                  {list.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          }
          case 'date':
            return (
              <Field key={field.id} {...common}>
                <Input
                  id={id}
                  type="date"
                  value={value}
                  required={field.required}
                  onChange={(event) => set(event.target.value)}
                />
              </Field>
            );
          case 'number':
          case 'currency':
            return (
              <Field key={field.id} {...common}>
                <div className="relative">
                  {field.type === 'currency' && (
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                      $
                    </span>
                  )}
                  <Input
                    id={id}
                    value={value}
                    inputMode="decimal"
                    required={field.required}
                    onChange={(event) => set(event.target.value.replace(/[^0-9.-]/g, ''))}
                    className={field.type === 'currency' ? 'num pl-7' : 'num'}
                  />
                </div>
              </Field>
            );
          case 'file':
            // Legacy fields only; new ones wait for file storage. Shown, not edited.
            return null;
          default:
            return (
              <Field key={field.id} {...common}>
                <Input
                  id={id}
                  value={value}
                  maxLength={200}
                  required={field.required}
                  autoComplete="off"
                  onChange={(event) => set(event.target.value)}
                />
              </Field>
            );
        }
      })}
    </>
  );
}
