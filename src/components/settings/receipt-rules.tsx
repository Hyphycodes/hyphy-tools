'use client';
import { useId, useState, type ReactNode } from 'react';
import { saveReceiptRules } from '@/app/(app)/[space]/actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { Input, Select } from '@/components/ui/form';
import { categoryLabel } from '@/lib/insights';
import {
  describeApproval,
  RECEIPT_CATEGORIES,
  type ResolvedSettings,
} from '@/lib/platform/business-settings';
import { formFields } from '@/lib/platform/custom-fields';
import type { FieldDefinition, ReceiptCategory } from '@/lib/platform/types';
import { EmployeePreview, previewRow, RuleRow, SaveBar } from './parts';

type Rules = ResolvedSettings['receipts'];

/**
 * Receipts, set up in the business's words: what every receipt must name, whether people are
 * paid back for their own cards, when a manager says yes — with the form an employee will see,
 * updating as the owner decides.
 */
export function ReceiptRules({
  rules,
  fields,
  approvers,
  children,
}: {
  rules: Rules;
  /** The business's receipt fields, for the preview. */
  fields: FieldDefinition[];
  approvers: string;
  /** The field editor, between the rules and the approval. */
  children: ReactNode;
}) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const [draft, setDraft] = useState(rules);
  const [over, setOver] = useState(String(rules.approval.over ?? 250));
  const modules = workspace.space.modules;
  const { project, vehicle, vehicles } = workspace.labels;
  const saved = JSON.stringify({ ...rules, approval: rules.approval });
  const current = {
    ...draft,
    approval:
      draft.approval.mode === 'over'
        ? { mode: 'over' as const, over: Number(over) || 0 }
        : { mode: draft.approval.mode },
  };
  const dirty = JSON.stringify(current) !== saved;
  const set = <K extends keyof Rules>(key: K, value: Rules[K]) =>
    setDraft((state) => ({ ...state, [key]: value }));
  const save = () =>
    run(() =>
      saveReceiptRules(workspace.space.slug, {
        requireProject: draft.requireProject,
        requireVehicle: draft.requireVehicle,
        allowPersonal: draft.allowPersonal,
        requirePhoto: draft.requirePhoto,
        defaultCategory: draft.defaultCategory ?? '',
        approval: draft.approval.mode,
        over,
      }),
    );
  const words = { project, vehicle };
  const extra = formFields(fields, 'receipts', modules);
  const approval = describeApproval(current.approval, 'receipt');

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-5">
        <section
          aria-label="What every receipt needs"
          className="rounded-[16px] bg-surface shadow-card"
        >
          <header className="px-4 pt-4 pb-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              What every receipt needs
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Where, the total and the date are always asked. These are up to you.
            </p>
          </header>
          <div className="row-divide">
            <RuleRow
              name={`${id}-project`}
              label={`A ${project.toLowerCase()} on every receipt`}
              line={`So costs land on the right ${project.toLowerCase()}.`}
              off={
                modules.includes('projects') ? undefined : `${workspace.labels.projects} are off.`
              }
              value={draft.requireProject ? 'yes' : 'no'}
              onChange={(value) => set('requireProject', value === 'yes')}
              options={[
                { value: 'yes', label: 'Required' },
                { value: 'no', label: 'Optional' },
              ]}
            />
            <RuleRow
              name={`${id}-vehicle`}
              label={`A ${vehicle.toLowerCase()} on every receipt`}
              line={`Asked of people who have a ${vehicle.toLowerCase()} to pick.`}
              off={modules.includes('vehicles') ? undefined : `${vehicles} are off.`}
              value={draft.requireVehicle ? 'yes' : 'no'}
              onChange={(value) => set('requireVehicle', value === 'yes')}
              options={[
                { value: 'yes', label: 'Required' },
                { value: 'no', label: 'Optional' },
              ]}
            />
            <RuleRow
              name={`${id}-personal`}
              label="Personal expenses"
              line="People pay with their own card and are paid back."
              value={draft.allowPersonal ? 'yes' : 'no'}
              onChange={(value) => set('allowPersonal', value === 'yes')}
              options={[
                { value: 'yes', label: 'Allowed' },
                { value: 'no', label: 'Not allowed' },
              ]}
            />
            <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <label htmlFor={`${id}-category`} className="text-[14px] font-medium text-ink">
                  New receipts start on
                </label>
                <p className="mt-0.5 text-[12.5px] text-muted">A category people can change.</p>
              </div>
              <div className="w-full sm:w-[220px]">
                <Select
                  id={`${id}-category`}
                  value={draft.defaultCategory ?? ''}
                  onChange={(event) =>
                    set('defaultCategory', (event.target.value || undefined) as ReceiptCategory)
                  }
                >
                  <option value="">Hyphy’s guess</option>
                  {RECEIPT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {categoryLabel[category]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <RuleRow
              name={`${id}-photo`}
              label="A photo of the receipt"
              line="Taken or chosen on the phone, stored with the receipt for whoever approves it."
              value={draft.requirePhoto ? 'yes' : 'no'}
              onChange={(value) => set('requirePhoto', value === 'yes')}
              options={[
                { value: 'yes', label: 'Required' },
                { value: 'no', label: 'Optional' },
              ]}
            />
            <p className="px-4 pt-4 pb-0 text-[12.5px] font-medium text-muted">
              Approval · {approvers} approve, never their own
            </p>
            <RuleRow
              name={`${id}-approval`}
              label="Receipts that need a yes"
              line={
                draft.approval.mode === 'over'
                  ? 'Smaller ones are filed right away.'
                  : draft.approval.mode === 'never'
                    ? 'Every receipt is filed right away.'
                    : 'A manager approves each one before it counts.'
              }
              value={draft.approval.mode}
              onChange={(mode) => set('approval', { mode, over: Number(over) || undefined })}
              options={[
                { value: 'always', label: 'Every one' },
                { value: 'over', label: 'Over…' },
                { value: 'never', label: 'None' },
              ]}
            />
            {draft.approval.mode === 'over' && (
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <label htmlFor={`${id}-over`} className="text-[14px] text-ink-2">
                  Receipts over
                </label>
                <div className="relative w-[140px]">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                    $
                  </span>
                  <Input
                    id={`${id}-over`}
                    value={over}
                    inputMode="decimal"
                    className="num pl-7"
                    onChange={(event) => setOver(event.target.value.replace(/[^0-9.]/g, ''))}
                  />
                </div>
              </div>
            )}
          </div>
          <SaveBar
            dirty={dirty}
            pending={pending}
            label="Save receipt rules"
            onSave={save}
            onUndo={() => {
              setDraft(rules);
              setOver(String(rules.approval.over ?? 250));
            }}
          />
        </section>

        {children}
      </div>

      <div className="lg:sticky lg:top-6">
        <EmployeePreview
          title="Receipt"
          who="What employees see"
          footer={approval === 'Not needed' ? 'Save receipt' : 'Submit for approval'}
          rows={[
            { label: 'Photo', sample: 'Receipt photo', required: current.requirePhoto },
            { label: 'Where', sample: 'Home Depot', required: true },
            { label: 'Total', sample: '$142.00', required: true },
            { label: 'Date', sample: 'Today', required: true },
            ...(modules.includes('projects')
              ? [{ label: project, required: current.requireProject, kind: 'choice' as const }]
              : []),
            ...(modules.includes('vehicles')
              ? [{ label: vehicle, required: current.requireVehicle, kind: 'choice' as const }]
              : []),
            ...extra.map((field) => previewRow(field, words)),
            {
              label: 'Paid with',
              sample: current.allowPersonal ? 'Company card or personal' : 'Company card',
              required: true,
              kind: 'choice' as const,
            },
            { label: 'Note' },
          ]}
        />
        <p className="mt-3 px-1 text-[12.5px] leading-snug text-muted">
          Approval: <span className="font-medium text-ink-2">{approval}</span>
        </p>
      </div>
    </div>
  );
}
