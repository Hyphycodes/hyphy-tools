'use client';
import { useId, useState } from 'react';
import {
  addField,
  moveField,
  removeField,
  setFieldArchived,
  updateField,
} from '@/app/(app)/[space]/actions';
import { Toggle } from '@/components/create/parts';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import {
  CREATABLE_TYPES,
  fieldTypes,
  MAX_FIELDS,
  typeLabel,
  typeNeeds,
} from '@/lib/platform/custom-fields';
import type { FieldDefinition, FieldType, RecordType } from '@/lib/platform/types';

/**
 * "What else does your company track?" — a business's own fields for one kind of record, in plain
 * words: a list of what's asked today, one button to add, and a small sheet to say what employees
 * should enter. No schema words, no builder: a name, a kind of answer, whether it's required.
 */
export function FieldEditor({
  appliesTo,
  fields,
  inUse,
  title,
  intro,
  always,
  noun,
  listable = true,
}: {
  appliesTo: RecordType;
  /** Every field for this record type, archived ones too. */
  fields: FieldDefinition[];
  /** Keys that some record already has an answer for. */
  inUse: string[];
  title: string;
  intro: string;
  /** What Hyphy itself always records, so it's clear the business only adds. */
  always: string;
  noun: string;
  listable?: boolean;
}) {
  const workspace = useWorkspace();
  const { pending, run } = useTeamAction();
  const [editing, setEditing] = useState<FieldDefinition | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const active = fields.filter((field) => !field.archivedAt);
  const archived = fields.filter((field) => field.archivedAt);
  const slug = workspace.space.slug;
  const words = { project: workspace.labels.project, vehicle: workspace.labels.vehicle };

  return (
    <section aria-label={title} className="min-w-0 rounded-[16px] bg-surface shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] text-muted">{intro}</p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setEditing('new')}
          disabled={active.length >= MAX_FIELDS}
        >
          <Icon name="plus" size={14} /> Add field
        </Button>
      </header>
      <p className="mx-4 mb-2 flex items-start gap-2 rounded-[10px] bg-subtle px-3 py-2 text-[12.5px] leading-snug text-muted">
        <Icon name="lock" size={13} className="mt-0.5 shrink-0" />
        <span>{always}</span>
      </p>
      {active.length ? (
        <ol className="row-divide" aria-label={`${title}: in use`}>
          {active.map((field, index) => (
            <li
              key={field.id}
              className="flex items-center gap-2 px-4 py-2.5"
              data-field-row={field.label}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium text-ink">
                  {field.label}
                  {field.required ? (
                    <Badge tone="signal">Required</Badge>
                  ) : (
                    <span className="text-[12px] font-normal text-faint">Optional</span>
                  )}
                  {field.showInList && <Badge tone="outline">On lists</Badge>}
                </p>
                <p className="truncate text-[12.5px] text-muted">
                  {typeLabel(field.type, words)}
                  {field.type === 'select' && field.options
                    ? ` · ${field.options.slice(0, 3).join(', ')}${field.options.length > 3 ? ` +${field.options.length - 3}` : ''}`
                    : ''}
                  {typeNeeds[field.type] &&
                  !workspace.space.modules.includes(typeNeeds[field.type]!)
                    ? ' · not asked while that tool is off'
                    : ''}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${field.label} up`}
                disabled={index === 0 || pending}
                onClick={() => run(() => moveField(slug, appliesTo, field.id, -1))}
              >
                <Icon name="arrow-up" size={15} />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Move ${field.label} down`}
                disabled={index === active.length - 1 || pending}
                onClick={() => run(() => moveField(slug, appliesTo, field.id, 1))}
              >
                <Icon name="arrow-down" size={15} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(field)}>
                Edit<span className="sr-only"> {field.label}</span>
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 pt-1 pb-4 text-[13.5px] text-muted">
          Nothing extra yet. Employees fill in only what Hyphy asks.
        </p>
      )}
      {archived.length > 0 && (
        <div className="border-t border-line px-4 py-2.5">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            aria-expanded={showArchived}
            className="flex items-center gap-1.5 text-[13px] text-muted hover:text-ink"
          >
            <Icon
              name="chevron-right"
              size={14}
              className={cn('transition-transform', showArchived && 'rotate-90')}
            />
            No longer asked ({archived.length})
          </button>
          {showArchived && (
            <ul className="mt-2 grid gap-1.5">
              {archived.map((field) => (
                <li
                  key={field.id}
                  className="flex items-center justify-between gap-3 rounded-[10px] bg-subtle px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] text-ink-2">{field.label}</span>
                    <span className="block text-[12px] text-faint">
                      Kept on the {noun}s that have an answer
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => run(() => setFieldArchived(slug, appliesTo, field.id, false))}
                  >
                    <Icon name="restore" size={14} /> Use again
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && (
        <FieldSheet
          key={editing === 'new' ? 'new' : editing.id}
          appliesTo={appliesTo}
          field={editing === 'new' ? undefined : editing}
          used={editing !== 'new' && inUse.includes(editing.id)}
          noun={noun}
          listable={listable}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function FieldSheet({
  appliesTo,
  field,
  used,
  noun,
  listable,
  onClose,
}: {
  appliesTo: RecordType;
  field?: FieldDefinition;
  used: boolean;
  noun: string;
  listable: boolean;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const [label, setLabel] = useState(field?.label ?? '');
  const [type, setType] = useState<FieldType>(field?.type ?? 'text');
  const [options, setOptions] = useState<string[]>(field?.options?.length ? field.options : ['']);
  const [required, setRequired] = useState(Boolean(field?.required));
  const [showInList, setShowInList] = useState(Boolean(field?.showInList));
  const [help, setHelp] = useState(field?.help ?? '');
  const [confirming, setConfirming] = useState(false);
  const slug = workspace.space.slug;
  const words = { project: workspace.labels.project, vehicle: workspace.labels.vehicle };
  const kept = new Set(used ? (field?.options ?? []) : []);
  const types = CREATABLE_TYPES.filter((option) => {
    const needs = typeNeeds[option];
    return !needs || workspace.space.modules.includes(needs) || option === field?.type;
  });
  const who = appliesTo === 'receipts' || appliesTo === 'mileage' ? 'employees' : 'your team';
  const values = {
    label,
    type,
    options: options.map((option) => option.trim()).filter(Boolean),
    required,
    showInList,
    help,
  };
  const save = () =>
    run(
      () =>
        field
          ? updateField(slug, appliesTo, field.id, values)
          : addField(slug, { ...values, appliesTo }),
      onClose,
    );

  return (
    <Sheet
      open
      onClose={onClose}
      width="md"
      title={field ? `Edit ${field.label}` : `Add a ${noun} field`}
      description={
        field
          ? used
            ? `Some ${noun}s already have an answer, so its kind stays the same.`
            : `Nothing uses it yet, so anything can change.`
          : `Something your business wants on every ${noun}.`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={pending || !label.trim()}>
            {pending ? 'Saving…' : field ? 'Save field' : 'Add field'}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-5 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field
          label={`What should ${who} enter?`}
          htmlFor={`${id}-label`}
          hint="The name people see on the form, like Cost Code or PO Number."
        >
          <Input
            id={`${id}-label`}
            value={label}
            maxLength={40}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={appliesTo === 'receipts' ? 'Cost Code' : 'Job Number'}
            data-autofocus
            autoComplete="off"
          />
        </Field>

        <fieldset>
          <legend className="mb-2 text-[13.5px] font-medium text-ink-2">
            What kind of answer?
          </legend>
          {used ? (
            <p className="flex items-center gap-2 rounded-[12px] bg-subtle px-3.5 py-3 text-[13.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <Icon name="lock" size={14} className="text-muted" />
              {typeLabel(type, words)} — already used, so it stays this kind.
            </p>
          ) : (
            <div
              role="radiogroup"
              aria-label="Kind of answer"
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {types.map((option) => {
                const on = type === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setType(option)}
                    className={cn(
                      'rounded-[12px] px-3 py-2.5 text-left transition-all',
                      on
                        ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                        : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                    )}
                  >
                    <span className="block text-[13.5px] font-semibold text-ink">
                      {typeLabel(option, words)}
                    </span>
                    <span className="line-clamp-2 block text-[12px] leading-snug text-muted">
                      {option === 'project'
                        ? `One of your ${workspace.labels.projects.toLowerCase()}`
                        : option === 'vehicle'
                          ? `One of your ${workspace.labels.vehicles.toLowerCase()}`
                          : fieldTypes[option].line}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        {type === 'select' && (
          <fieldset>
            <legend className="mb-2 text-[13.5px] font-medium text-ink-2">Choices</legend>
            <ol className="grid gap-2">
              {options.map((option, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Choice ${index + 1}`}
                    value={option}
                    maxLength={60}
                    disabled={kept.has(option) && option !== ''}
                    onChange={(event) =>
                      setOptions((current) =>
                        current.map((item, at) => (at === index ? event.target.value : item)),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        setOptions((current) => [...current, '']);
                      }
                    }}
                    placeholder={
                      ['100 — General', '200 — Materials', '300 — Equipment'][index] ?? ''
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove choice ${index + 1}`}
                    disabled={kept.has(option) || options.length === 1}
                    onClick={() => setOptions((current) => current.filter((_, at) => at !== index))}
                  >
                    <Icon name="x" size={15} />
                  </Button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, ''])}
              className="mt-2 flex items-center gap-1.5 rounded-[10px] px-1 py-1 text-[13.5px] font-medium text-signal-ink hover:underline"
            >
              <Icon name="plus" size={14} /> Add a choice
            </button>
            {kept.size > 0 && (
              <p className="mt-1 text-[12.5px] text-muted">
                Choices already picked on a {noun} stay. You can always add more.
              </p>
            )}
          </fieldset>
        )}

        <div className="grid gap-2">
          <Toggle
            checked={required}
            onChange={setRequired}
            label="Required"
            description={
              field && !field.required && required
                ? `From now on. ${noun[0].toUpperCase()}${noun.slice(1)}s already saved aren’t changed.`
                : `${who[0].toUpperCase()}${who.slice(1)} can’t send a ${noun} without it.`
            }
          />
          {listable && (
            <Toggle
              checked={showInList}
              onChange={setShowInList}
              label="Show on lists"
              description="Shown on each row, next to the name. Up to two fields."
            />
          )}
        </div>

        <Field label="A hint under the field" htmlFor={`${id}-help`} optional>
          <Input
            id={`${id}-help`}
            value={help}
            maxLength={120}
            onChange={(event) => setHelp(event.target.value)}
            placeholder="From the job folder"
          />
        </Field>

        {field && (
          <div className="rounded-[14px] bg-subtle p-3.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {confirming ? (
              <div className="grid gap-2">
                <p className="text-[13.5px] text-ink">
                  {used
                    ? `Stop asking for ${field.label}? ${noun[0].toUpperCase()}${noun.slice(1)}s that have an answer keep it, and you can use it again any time.`
                    : `Remove ${field.label}? Nothing uses it yet.`}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                    Keep it
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          used
                            ? setFieldArchived(slug, appliesTo, field.id, true)
                            : removeField(slug, appliesTo, field.id),
                        onClose,
                      )
                    }
                  >
                    {used ? 'Stop using it' : 'Remove it'}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="flex items-center gap-2 text-[13.5px] font-medium text-critical"
              >
                <Icon name={used ? 'archive' : 'trash'} size={15} />
                {used ? 'Stop using this field' : 'Remove this field'}
              </button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  );
}
