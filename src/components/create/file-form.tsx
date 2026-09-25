'use client';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { DropZone, UploadList, useUploadQueue } from '@/components/files/uploader';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/components/shell/workspace-context';
import { MAX_FILES_AT_ONCE } from '@/lib/files/rules';
import type { FormProps } from './create-sheets';
import { FormFooter, Section } from './parts';

/**
 * Upload files (or photos) and say what they belong to. Each file goes through the one upload
 * pipeline (lib/files/upload.ts) with its own progress, Cancel and Try again; the sheet closes
 * once they're all in.
 */
export function FileForm({ request, onDone, formId, photos }: FormProps & { photos?: boolean }) {
  const workspace = useWorkspace();
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const guest = workspace.role === 'guest';
  const activeProjects = workspace.options.projects.filter((project) => project.status !== 'done');
  const defaultTarget = request.attachTo
    ? `${request.attachTo.type}:${request.attachTo.id}`
    : photos || guest
      ? activeProjects[0]
        ? `project:${activeProjects[0].id}`
        : ''
      : '';
  const [target, setTarget] = useState(defaultTarget);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [type, targetId] = target.split(':');
  const queue = useUploadQueue(workspace.space.slug, {
    purpose: photos ? 'photo' : 'file',
    attachTo:
      type && targetId ? { type: type as 'project' | 'vehicle' | 'person', id: targetId } : null,
    folder: folder || undefined,
  });
  const waiting = queue.items.filter((item) => item.stage === 'waiting');
  const failed = queue.items.filter((item) => item.stage === 'failed');
  const device = workspace.fileStorage === 'device';

  async function upload() {
    setError('');
    if (guest && !target) return setError('Choose the project these belong to.');
    if (!waiting.length) return setError('Choose at least one file.');
    const done = await queue.start(waiting);
    if (!done.length) return;
    router.refresh();
    toast({
      title: done.length === 1 ? done[0].name : `${done.length} files uploaded`,
      description: done.length === 1 ? 'Uploaded' : undefined,
      href:
        done.length === 1
          ? workspace.href(`/files?file=${done[0].fileId}`)
          : workspace.href('/files'),
    });
    // Anything that didn't make it stays in the list, with its reason and Try again.
    if (done.length === waiting.length) onDone();
  }

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        void upload();
      }}
    >
      <DropZone
        purpose={photos ? 'photo' : 'file'}
        capture={photos}
        icon={photos ? 'camera' : 'upload'}
        title={photos ? 'Take or choose photos' : 'Choose files'}
        hint={
          photos
            ? `Up to ${MAX_FILES_AT_ONCE} at a time · JPG, PNG, WebP or HEIC up to 20 MB`
            : `or drag them here · up to ${MAX_FILES_AT_ONCE} · PDF up to 50 MB, photos 20 MB`
        }
        onFiles={(files) => {
          setError('');
          queue.add(files);
        }}
      />
      <UploadList
        items={queue.items}
        onCancel={queue.cancel}
        onRetry={(key) => void queue.retry(key).then((file) => file && router.refresh())}
        onRemove={queue.remove}
      />

      <Section title="Attach to">
        <Field
          label="Belongs to"
          htmlFor={`${id}-target`}
          hint={guest ? 'Guests add files to projects shared with them.' : undefined}
        >
          <Select
            id={`${id}-target`}
            value={target}
            disabled={queue.busy}
            onChange={(event) => setTarget(event.target.value)}
          >
            {!guest && <option value="">Nothing — just Files</option>}
            {activeProjects.length > 0 && (
              <optgroup label={workspace.labels.projects}>
                {activeProjects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
            )}
            {!guest && workspace.options.vehicles.length > 0 && (
              <optgroup label={workspace.labels.vehicles}>
                {workspace.options.vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={`vehicle:${vehicle.id}`}>
                    {vehicle.name}
                  </option>
                ))}
              </optgroup>
            )}
            {request.attachTo?.type === 'person' && (
              <option value={`person:${request.attachTo.id}`}>
                {workspace.options.people.find((person) => person.id === request.attachTo!.id)
                  ?.name ?? 'This person'}
              </option>
            )}
          </Select>
        </Field>
        {!photos && !guest && (
          <Field label="Folder" htmlFor={`${id}-folder`} optional>
            <Input
              id={`${id}-folder`}
              value={folder}
              disabled={queue.busy}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Uploads"
              list={`${id}-folders`}
            />
            <datalist id={`${id}-folders`}>
              {['Contracts', 'Permits', 'Plans', 'Insurance', 'Company', 'Photos'].map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        )}
      </Section>

      <FormFooter
        error={error}
        note={
          device
            ? 'Preview: the files stay in this browser; Hyphy keeps their details.'
            : 'Private to this Space. Only people who can see what they belong to can open them.'
        }
      >
        <Button type="submit" variant="primary" disabled={queue.busy || !waiting.length}>
          {queue.busy
            ? 'Uploading…'
            : failed.length && !waiting.length
              ? 'Fix or remove the files above'
              : waiting.length > 1
                ? `Upload ${waiting.length} files`
                : photos
                  ? 'Upload photos'
                  : 'Upload'}
        </Button>
      </FormFooter>
    </form>
  );
}
