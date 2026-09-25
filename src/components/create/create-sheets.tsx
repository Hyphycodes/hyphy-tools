'use client';
import { useState, useTransition } from 'react';
import type { ActionResult } from '@/app/(app)/[space]/actions';
import { Sheet } from '@/components/ui/sheet';
import { ToolGlyph } from '@/components/ui/marks';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/components/shell/workspace-context';
import type { CreateRequest } from './create-context';
import { MileageForm, PersonForm, ProjectForm, VehicleForm } from './forms';
import { FileForm } from './file-form';
import { ReceiptForm } from './receipt-form';

/** Shared submit plumbing: pending state, errors, a toast, then close. */
export function useSubmit(onDone: () => void) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const toast = useToast();
  const submit = (work: () => Promise<ActionResult>, success: { title: string; href?: string }) => {
    setError('');
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: success.title, description: result.message, href: success.href });
      onDone();
    });
  };
  /** A problem found before sending (a required answer missing), said where the server's would be. */
  const fail = (message: string) => setError(message);
  return { pending, error, submit, fail };
}

export type FormProps = { request: CreateRequest; onDone: () => void; formId: string };

const titles: Record<string, { title: string; description: string }> = {
  receipt: { title: 'Receipt', description: 'Snap it, check it, file it.' },
  mileage: { title: 'Log mileage', description: 'Where you went and why.' },
  project: { title: 'New project', description: 'Costs, files and people will gather here.' },
  person: {
    title: 'Add a person',
    description: 'Pick what they can see. You can change it later.',
  },
  vehicle: { title: 'Add a vehicle', description: 'Assign it and its costs follow it.' },
  file: { title: 'Upload files', description: 'Attach them to the work they belong to.' },
  photos: { title: 'Upload photos', description: 'Straight into the project, by date.' },
};

export function CreateSheets({
  request,
  onClose,
}: {
  request: CreateRequest | null;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const action = request ? workspace.actions.find((item) => item.id === request.id) : undefined;
  const form = action?.target.type === 'form' ? action.target.form : undefined;
  const copy = form ? titles[form] : undefined;
  const formId = `create-${form}`;
  const project = workspace.labels.project;

  return (
    <Sheet
      open={Boolean(request && form)}
      onClose={onClose}
      title={
        request?.edit
          ? 'Fix and resubmit'
          : form === 'project'
            ? `New ${project.toLowerCase()}`
            : form === 'receipt'
              ? action!.label
              : (copy?.title ?? '')
      }
      description={
        request?.edit
          ? request.edit.record.status === 'draft'
            ? 'Finish it and send it.'
            : 'Change what was asked, then send it back.'
          : copy?.description
      }
      width={form === 'person' ? 'md' : 'md'}
      leading={
        action && (
          <ToolGlyph tool={{ color: action.color, ink: action.ink, icon: action.icon }} size="md" />
        )
      }
    >
      {request && form === 'receipt' && (
        <ReceiptForm request={request} onDone={onClose} formId={formId} />
      )}
      {request && form === 'mileage' && (
        <MileageForm request={request} onDone={onClose} formId={formId} />
      )}
      {request && form === 'project' && (
        <ProjectForm request={request} onDone={onClose} formId={formId} />
      )}
      {request && form === 'person' && (
        <PersonForm request={request} onDone={onClose} formId={formId} />
      )}
      {request && form === 'vehicle' && (
        <VehicleForm request={request} onDone={onClose} formId={formId} />
      )}
      {request && (form === 'file' || form === 'photos') && (
        <FileForm request={request} onDone={onClose} formId={formId} photos={form === 'photos'} />
      )}
    </Sheet>
  );
}
