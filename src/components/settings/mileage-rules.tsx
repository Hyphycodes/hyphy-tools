'use client';
import { useId, useState, type ReactNode } from 'react';
import { saveMileageRules } from '@/app/(app)/[space]/actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { Input } from '@/components/ui/form';
import { describeApproval, type ResolvedSettings } from '@/lib/platform/business-settings';
import { formFields } from '@/lib/platform/custom-fields';
import { formatCurrency } from '@/lib/platform/format';
import type { FieldDefinition } from '@/lib/platform/types';
import { EmployeePreview, previewRow, RuleRow, SaveBar } from './parts';

type Rules = ResolvedSettings['mileage'];

/**
 * How mileage works here: the rate this business pays back (its own choice — Hyphy never assumes a
 * tax table), what a trip must say, whether personal cars count, and whether trips need a yes.
 */
export function MileageRules({
  rules,
  rate,
  fields,
  approvers,
  children,
}: {
  rules: Rules;
  rate?: number;
  fields: FieldDefinition[];
  approvers: string;
  children: ReactNode;
}) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, run } = useTeamAction();
  const [draft, setDraft] = useState(rules);
  const initialRate = rate ? rate.toFixed(2) : '';
  const [rateText, setRateText] = useState(initialRate);
  const modules = workspace.space.modules;
  const { project, vehicle, vehicles, projects } = workspace.labels;
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules) || rateText !== initialRate;
  const set = <K extends keyof Rules>(key: K, value: Rules[K]) =>
    setDraft((state) => ({ ...state, [key]: value }));
  const save = () =>
    run(() =>
      saveMileageRules(workspace.space.slug, {
        rate: rateText,
        requireProject: draft.requireProject,
        requirePurpose: draft.requirePurpose,
        allowPersonalVehicles: draft.allowPersonalVehicles,
        approval: draft.approval.mode,
      }),
    );
  const perMile = Number(rateText);
  const extra = formFields(fields, 'mileage', modules);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-5">
        <section
          aria-label="How mileage works here"
          className="rounded-[16px] bg-surface shadow-card"
        >
          <header className="px-4 pt-4 pb-1">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              How mileage works here
            </h2>
            <p className="mt-0.5 text-[13px] text-muted">
              Where from, where to, the miles and the date are always asked.
            </p>
          </header>
          <div className="row-divide">
            <div className="flex flex-col gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <label htmlFor={`${id}-rate`} className="text-[14px] font-medium text-ink">
                  What you pay back per mile
                </label>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
                  For trips in someone’s own car. Your rate — Hyphy doesn’t assume a tax rate. Leave
                  it empty to track miles without paying them back. Trips already logged keep their
                  rate.
                </p>
              </div>
              <div className="relative w-full sm:w-[150px]">
                <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                  $
                </span>
                <Input
                  id={`${id}-rate`}
                  value={rateText}
                  inputMode="decimal"
                  placeholder="0.67"
                  className="num pr-14 pl-7"
                  onChange={(event) => setRateText(event.target.value.replace(/[^0-9.]/g, ''))}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[12.5px] text-muted">
                  / mile
                </span>
              </div>
            </div>
            <RuleRow
              name={`${id}-personal`}
              label="Trips in personal vehicles"
              line={
                draft.allowPersonalVehicles
                  ? 'Paid back at your rate.'
                  : `Only company ${vehicles.toLowerCase()}. People without one can’t log trips.`
              }
              off={
                modules.includes('vehicles')
                  ? undefined
                  : `Without ${vehicles}, every trip is in a personal vehicle.`
              }
              value={draft.allowPersonalVehicles ? 'yes' : 'no'}
              onChange={(value) => set('allowPersonalVehicles', value === 'yes')}
              options={[
                { value: 'yes', label: 'Allowed' },
                { value: 'no', label: 'Not allowed' },
              ]}
            />
            <RuleRow
              name={`${id}-project`}
              label={`A ${project.toLowerCase()} on every trip`}
              off={modules.includes('projects') ? undefined : `${projects} are off.`}
              value={draft.requireProject ? 'yes' : 'no'}
              onChange={(value) => set('requireProject', value === 'yes')}
              options={[
                { value: 'yes', label: 'Required' },
                { value: 'no', label: 'Optional' },
              ]}
            />
            <RuleRow
              name={`${id}-purpose`}
              label="What the trip was for"
              line="Site visit, supply run, showing."
              value={draft.requirePurpose ? 'yes' : 'no'}
              onChange={(value) => set('requirePurpose', value === 'yes')}
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
              label="Trips need approval"
              line={
                draft.approval.mode === 'never'
                  ? 'Every trip is filed right away.'
                  : 'A manager approves each trip before it counts.'
              }
              value={draft.approval.mode === 'never' ? 'never' : 'always'}
              onChange={(mode) => set('approval', { mode })}
              options={[
                { value: 'always', label: 'Every trip' },
                { value: 'never', label: 'Not needed' },
              ]}
            />
          </div>
          <SaveBar
            dirty={dirty}
            pending={pending}
            label="Save mileage rules"
            onSave={save}
            onUndo={() => {
              setDraft(rules);
              setRateText(initialRate);
            }}
          />
        </section>
        {children}
      </div>

      <div className="lg:sticky lg:top-6">
        <EmployeePreview
          title="Log mileage"
          who="What employees see"
          footer={draft.approval.mode === 'never' ? 'Save trip' : 'Submit trip'}
          rows={[
            {
              label: 'Miles',
              sample:
                perMile > 0 && draft.allowPersonalVehicles
                  ? `12 mi · ${formatCurrency(12 * perMile)} back at ${formatCurrency(perMile)}/mi`
                  : '12 mi',
              required: true,
            },
            { label: 'From → To', sample: 'Shop → Oak Brook', required: true },
            { label: 'Date', sample: 'Today', required: true },
            ...(modules.includes('vehicles')
              ? [
                  {
                    label: vehicle,
                    sample: draft.allowPersonalVehicles
                      ? 'Personal vehicle'
                      : `Company ${vehicle.toLowerCase()}`,
                    required: !draft.allowPersonalVehicles,
                    kind: 'choice' as const,
                  },
                ]
              : []),
            ...(modules.includes('projects')
              ? [{ label: project, required: draft.requireProject, kind: 'choice' as const }]
              : []),
            { label: 'Purpose', required: draft.requirePurpose },
            ...extra.map((field) => previewRow(field, { project, vehicle })),
          ]}
        />
        <p className="mt-3 px-1 text-[12.5px] leading-snug text-muted">
          Approval:{' '}
          <span className="font-medium text-ink-2">{describeApproval(draft.approval, 'trip')}</span>
        </p>
      </div>
    </div>
  );
}
