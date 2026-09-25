'use client';
import { useState } from 'react';
import { saveRecordFields } from '@/app/(app)/[space]/actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { useTeamAction } from '@/components/team/use-team-action';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import type { FieldDefinition, FieldValue } from '@/lib/platform/types';
import { answerProblems, answersOf, FieldInputs, firstProblem } from './field-inputs';

/**
 * "Edit details" on a job, a vehicle or a person: the business's own questions about it, in one
 * small sheet. Hyphy's own fields (name, dates, the team) are edited where they always were.
 */
export function EditRecordFields({
  type,
  id,
  fields,
  values,
  title,
}: {
  type: 'projects' | 'vehicles' | 'people';
  id: string;
  /** The fields in use today for this kind of record. */
  fields: FieldDefinition[];
  values?: Record<string, FieldValue>;
  title: string;
}) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(() => answersOf(fields, values, workspace.space.timezone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { pending, run } = useTeamAction();
  if (!fields.length) return null;
  const save = () => {
    const problems = answerProblems(fields, type, answers);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    run(
      () => saveRecordFields(workspace.space.slug, type, id, answers),
      () => setOpen(false),
    );
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Icon name="pencil" size={14} /> Edit
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        width="sm"
        title={`Details · ${title}`}
        description={`What ${workspace.space.name} keeps about it.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save details'}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-4 pt-1"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <FieldInputs
            fields={fields}
            answers={answers}
            errors={errors}
            idPrefix={`edit-${type}`}
            onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
          />
          {Object.keys(errors).length > 0 && (
            <p role="alert" className="text-[13px] text-critical">
              {firstProblem(fields, errors)}
            </p>
          )}
        </form>
      </Sheet>
    </>
  );
}
