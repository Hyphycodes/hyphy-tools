'use client';
import { useId, useState, type DragEvent } from 'react';
import { addFiles } from '@/app/(app)/[space]/actions';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useWorkspace } from '@/components/shell/workspace-context';
import { formatBytes } from '@/lib/platform/format';
import type { FileKind } from '@/lib/platform/types';
import { useSubmit, type FormProps } from './create-sheets';
import { FormFooter, Section, SubmitButton } from './parts';

function kindOf(file: File): FileKind {
  if (file.type.startsWith('image/') || /\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name))
    return 'image';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return 'pdf';
  if (/\.(zip|rar|7z)$/i.test(file.name)) return 'archive';
  if (/\.(xlsx?|csv|numbers)$/i.test(file.name)) return 'sheet';
  return 'doc';
}

/**
 * Files and photos. In the preview the bytes stay on this device: Hyphy records the name, type
 * and size so Files, projects and activity behave exactly as they will with real storage.
 */
export function FileForm({ request, onDone, formId, photos }: FormProps & { photos?: boolean }) {
  const workspace = useWorkspace();
  const id = useId();
  const { pending, error, submit } = useSubmit(onDone);
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
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

  const add = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((file) => !photos || kindOf(file) === 'image');
    setFiles((current) => [...current, ...incoming].slice(0, 20));
  };
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault();
        const [type, targetId] = target.split(':');
        submit(
          () =>
            addFiles(workspace.space.slug, {
              files: files.map((file) => ({
                name: file.name,
                size: file.size,
                kind: kindOf(file),
              })),
              attachTo:
                type && targetId ? { type: type as 'project' | 'vehicle', id: targetId } : null,
              folder,
            }),
          {
            title: files.length === 1 ? files[0].name : `${files.length} files`,
            href: workspace.href('/files'),
          },
        );
      }}
    >
      <input
        id={`${id}-input`}
        type="file"
        multiple
        accept={photos ? 'image/*' : undefined}
        capture={photos ? 'environment' : undefined}
        className="sr-only"
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      <label
        htmlFor={`${id}-input`}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => hasFiles(event) && event.preventDefault()}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
        className={cn(
          'mt-1 flex flex-col items-center gap-2 rounded-[18px] border-[1.5px] border-dashed px-4 py-8 text-center transition-colors',
          over ? 'border-signal bg-signal-soft' : 'border-line-strong bg-subtle hover:bg-well/60',
        )}
      >
        <span className="grid size-12 place-items-center rounded-full bg-ink text-white">
          <Icon name={photos ? 'camera' : 'upload'} size={21} />
        </span>
        <span className="text-[15px] font-semibold text-ink">
          {over ? 'Drop to add' : photos ? 'Take or choose photos' : 'Choose files'}
        </span>
        <span className="text-[13px] text-muted">
          {photos ? 'Up to 20 at a time' : 'or drag them here · up to 20'}
        </span>
      </label>

      {files.length > 0 && (
        <ul className="row-divide mt-3 rounded-[14px] bg-surface shadow-card">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2.5">
              <Icon
                name={
                  kindOf(file) === 'image' ? 'image' : kindOf(file) === 'pdf' ? 'pdf' : 'file-text'
                }
                size={18}
                className="text-muted"
              />
              <span className="min-w-0 flex-1 truncate text-[14px]">{file.name}</span>
              <span className="mono-num text-[11.5px] text-faint">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() =>
                  setFiles((current) => current.filter((_, position) => position !== index))
                }
                className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
              >
                <Icon name="x" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Section title="Attach to">
        <Field
          label="Belongs to"
          htmlFor={`${id}-target`}
          hint={guest ? 'Guests add files to projects shared with them.' : undefined}
        >
          <Select
            id={`${id}-target`}
            value={target}
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
              <optgroup label="Vehicles">
                {workspace.options.vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={`vehicle:${vehicle.id}`}>
                    {vehicle.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        {!photos && !guest && (
          <Field label="Folder" htmlFor={`${id}-folder`} optional>
            <Input
              id={`${id}-folder`}
              value={folder}
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
        note="Preview: files stay on this device; Hyphy records the name and size."
      >
        <SubmitButton pending={pending}>
          {files.length > 1 ? `Add ${files.length} files` : photos ? 'Add photos' : 'Add file'}
        </SubmitButton>
      </FormFooter>
    </form>
  );
}
