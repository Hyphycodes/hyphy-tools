'use client';
import { useState } from 'react';
import { saveApprovers } from '@/app/(app)/[space]/actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';

/** Who says yes to receipts and trips: owners and admins, or managers too. Nothing more. */
export function ApproversForm({ approvers }: { approvers: 'managers' | 'admins' }) {
  const workspace = useWorkspace();
  const { pending, run } = useTeamAction();
  const [value, setValue] = useState(approvers);
  const options = [
    {
      value: 'managers' as const,
      title: 'Owners, admins and managers',
      line: 'Managers approve day-to-day receipts and trips.',
    },
    {
      value: 'admins' as const,
      title: 'Owners and admins',
      line: 'Managers still see everything; they just don’t approve.',
    },
  ];
  return (
    <div role="radiogroup" aria-label="Who approves" className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const on = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={pending}
            onClick={() => {
              if (on) return;
              setValue(option.value);
              run(() => saveApprovers(workspace.space.slug, option.value));
            }}
            className={cn(
              'flex gap-3 rounded-[14px] px-3.5 py-3 text-left transition-all',
              on
                ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
            )}
          >
            <span
              className={cn(
                'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
                on ? 'border-signal bg-signal' : 'border-line-strong',
              )}
            >
              {on && <Icon name="check" size={11} strokeWidth={3} className="text-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold text-ink">{option.title}</span>
              <span className="block text-[13px] text-muted">{option.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
