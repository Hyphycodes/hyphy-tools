'use client';
import { useId, useState } from 'react';
import {
  changeBusinessType,
  saveAccent,
  saveTerms,
  updateBusiness,
} from '@/app/(app)/[space]/actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Sheet } from '@/components/ui/sheet';
import { ACCENTS, findAccent } from '@/lib/platform/brand';
import {
  BUSINESS_TYPES,
  businessTypes,
  hasAdditions,
  presetAdditions,
  type BusinessType,
} from '@/lib/platform/business-types';
import { termChoices, termQuestions, type TermKey } from '@/lib/platform/terms';
import { getTool } from '@/lib/platform/tools';
import type { FieldDefinition } from '@/lib/platform/types';

export function NameForm() {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const [name, setName] = useState(workspace.space.name);
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        run(() => updateBusiness(workspace.space.slug, { name }));
      }}
    >
      <Field label="Business name" htmlFor={`${id}-name`} className="flex-1">
        <Input
          id={`${id}-name`}
          value={name}
          maxLength={80}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        disabled={pending || !name.trim() || name.trim() === workspace.space.name}
      >
        Save name
      </Button>
    </form>
  );
}

/**
 * The kind of business. Changing it never quietly rewrites anything: the owner sees what the new
 * kind would add (tools, suggested fields, its words) and chooses to add it or keep what they
 * have. Nothing is ever turned off, archived or removed.
 */
export function KindChooser({ fields }: { fields: FieldDefinition[] }) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const current = workspace.space.businessType;
  const [choice, setChoice] = useState<BusinessType | ''>(current ?? '');
  const [asking, setAsking] = useState(false);
  const additions = choice ? presetAdditions(workspace.space, fields, choice) : null;
  const change = (apply: boolean) =>
    run(
      () => changeBusinessType(workspace.space.slug, choice, apply),
      () => setAsking(false),
    );
  const toolName = (module: string) =>
    getTool(module === 'links' ? 'links' : module)?.name ?? module;
  const words = additions
    ? Object.values(additions.labels)
        .map((term) => term!.plural)
        .join(', ')
    : '';
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="Kind of business" htmlFor={`${id}-kind`} className="flex-1">
        <Select
          id={`${id}-kind`}
          value={choice}
          onChange={(event) => setChoice(event.target.value as BusinessType)}
        >
          {!current && <option value="">Not set</option>}
          {BUSINESS_TYPES.map((type) => (
            <option key={type} value={type}>
              {businessTypes[type].label}
            </option>
          ))}
        </Select>
      </Field>
      <Button
        variant="primary"
        disabled={pending || !choice || choice === current}
        onClick={() => (additions && hasAdditions(additions) ? setAsking(true) : change(false))}
      >
        Change
      </Button>
      {choice && additions && (
        <Sheet
          open={asking}
          onClose={() => setAsking(false)}
          width="sm"
          title="Update recommended setup?"
          description={`${businessTypes[choice].label} businesses usually start with a little more. Nothing you have is changed or removed either way.`}
          footer={
            <>
              <Button variant="ghost" onClick={() => change(false)} disabled={pending}>
                Keep my current setup
              </Button>
              <Button variant="primary" onClick={() => change(true)} disabled={pending}>
                Apply recommended additions
              </Button>
            </>
          }
        >
          <ul className="grid gap-2.5 pt-1 text-[13.5px] text-ink-2">
            {additions.modules.length > 0 && (
              <li className="flex gap-2.5">
                <Icon name="tools" size={16} className="mt-0.5 shrink-0 text-muted" />
                <span>
                  Turn on <b className="text-ink">{additions.modules.map(toolName).join(', ')}</b>
                </span>
              </li>
            )}
            {additions.fields.length > 0 && (
              <li className="flex gap-2.5">
                <Icon name="list" size={16} className="mt-0.5 shrink-0 text-muted" />
                <span>
                  Add fields:{' '}
                  <b className="text-ink">
                    {additions.fields.map((field) => field.label).join(', ')}
                  </b>{' '}
                  <span className="text-muted">(optional to start)</span>
                </span>
              </li>
            )}
            {words && (
              <li className="flex gap-2.5">
                <Icon name="pencil" size={16} className="mt-0.5 shrink-0 text-muted" />
                <span>
                  Use the words <b className="text-ink">{words}</b>
                </span>
              </li>
            )}
            <li className="flex gap-2.5 text-muted">
              <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
              Your fields, answers, rules and records all stay as they are.
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/** The few words a business chooses — from short lists, so the product stays recognizable. */
export function TermsForm() {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const initial = {
    projects: workspace.labels.project,
    customer: workspace.labels.customer,
    vehicles: workspace.labels.vehicle,
  };
  const [terms, setTerms] = useState(initial);
  const keys: TermKey[] = [
    ...(workspace.space.modules.includes('projects') ? (['projects', 'customer'] as const) : []),
    ...(workspace.space.modules.includes('vehicles') ? (['vehicles'] as const) : []),
  ];
  if (!keys.length)
    return (
      <p className="text-[13.5px] text-muted">
        Turn on Projects or Vehicles to choose what they’re called.
      </p>
    );
  const dirty = keys.some((key) => terms[key] !== initial[key]);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Only the words that changed: the rest keep following the business's defaults.
        const changed = Object.fromEntries(
          keys.filter((key) => terms[key] !== initial[key]).map((key) => [key, terms[key]]),
        );
        run(() => saveTerms(workspace.space.slug, changed));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {keys.map((key) => {
          const choices = termChoices[key];
          const value = terms[key];
          return (
            <Field
              key={key}
              label={termQuestions[key].question}
              hint={termQuestions[key].hint}
              htmlFor={`${id}-${key}`}
            >
              <Select
                id={`${id}-${key}`}
                value={value}
                onChange={(event) => setTerms((state) => ({ ...state, [key]: event.target.value }))}
              >
                {!choices.some((choice) => choice.singular === value) && (
                  <option value={value}>{value}</option>
                )}
                {choices.map((choice) => (
                  <option key={choice.singular} value={choice.singular}>
                    {key === 'customer' ? choice.singular : choice.plural}
                  </option>
                ))}
              </Select>
            </Field>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          Changes the menu, pages and forms for everyone. Records stay as they are.
        </p>
        <Button type="submit" variant="primary" disabled={pending || !dirty}>
          Save words
        </Button>
      </div>
    </form>
  );
}

/**
 * One accent from a short list, each readable with its mark. It shows on the business's mark (the
 * Space switcher, the header) and is the default for its QR codes — never a theme for the app.
 */
export function AccentPicker() {
  const workspace = useWorkspace();
  const { pending, run } = useTeamAction();
  const { space } = workspace;
  const current = findAccent(space.brand.color);
  const [picked, setPicked] = useState(current?.id ?? '');
  const preview = ACCENTS.find((accent) => accent.id === picked);
  const brand = preview ? { ...space.brand, color: preview.color, ink: preview.ink } : space.brand;
  return (
    <div className="grid gap-4">
      <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
        {!current && (
          <span
            className="grid size-10 place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)]"
            style={{ background: space.brand.color }}
            title="Current color"
          >
            {!picked && <Icon name="check" size={16} className="text-white" />}
          </span>
        )}
        {ACCENTS.map((accent) => (
          <button
            key={accent.id}
            type="button"
            role="radio"
            aria-checked={picked === accent.id}
            aria-label={accent.name}
            disabled={pending}
            onClick={() => {
              setPicked(accent.id);
              run(() => saveAccent(space.slug, accent.id));
            }}
            className={cn(
              'grid size-10 place-items-center rounded-full transition-transform hover:scale-105',
              picked === accent.id
                ? 'shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]'
                : 'shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)]',
            )}
            style={{ background: accent.color }}
          >
            {picked === accent.id && (
              <Icon
                name="check"
                size={16}
                className={accent.ink === 'light' ? 'text-white' : 'text-ink'}
              />
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-[14px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <SpaceMark space={{ ...space, brand }} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-ink">{space.name}</p>
          <p className="text-[12.5px] text-muted">
            How your mark looks in the Space switcher and on your QR codes.
          </p>
        </div>
      </div>
    </div>
  );
}
