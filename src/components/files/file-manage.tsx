'use client';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import type { ActionResult } from '@/app/(app)/[space]/actions';
import {
  attachFile,
  deleteFileForGood,
  renameFile,
  trashFile,
} from '@/app/(app)/[space]/file-actions';
import { useWorkspace } from '@/components/shell/workspace-context';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { deleteDeviceFile } from '@/lib/files/device';
import type { AttachmentRef, FileRecord } from '@/lib/platform/types';

/**
 * What someone who may change a file can do with it: rename it (the name only — its bytes stay
 * put), attach it to one more project or vehicle (the same file, never a copy), move it to Trash,
 * and from Trash bring it back or delete it for good.
 */
export function FileManage({
  file,
  canChange,
  locked,
}: {
  file: Pick<FileRecord, 'id' | 'name' | 'deletedAt' | 'attachedTo' | 'storage'>;
  canChange: boolean;
  /** Why it can't go to Trash (a receipt's photo, the logo), if so. */
  locked?: string;
}) {
  const workspace = useWorkspace();
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [pending, start] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(file.name);
  const [attaching, setAttaching] = useState(false);
  const [target, setTarget] = useState('');
  const [confirm, setConfirm] = useState<'trash' | 'delete' | null>(null);
  const [error, setError] = useState('');
  const slug = workspace.space.slug;

  const act = (work: () => Promise<ActionResult>, after?: (result: ActionResult) => void) =>
    start(async () => {
      setError('');
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.message) toast({ title: result.message });
      after?.(result);
      if (result.ok && result.href) router.push(result.href, { scroll: false });
      else router.refresh();
    });

  if (!canChange) return null;
  const attached = new Set(file.attachedTo.map((ref) => `${ref.type}:${ref.id}`));
  const projects = workspace.options.projects.filter(
    (project) => project.status !== 'done' && !attached.has(`project:${project.id}`),
  );
  const vehicles =
    workspace.role === 'guest'
      ? []
      : workspace.options.vehicles.filter((vehicle) => !attached.has(`vehicle:${vehicle.id}`));

  if (file.deletedAt)
    return (
      <div className="grid gap-2">
        <p className="flex items-center gap-2 rounded-[10px] bg-caution-soft px-3 py-2 text-[13px] text-caution">
          <Icon name="trash" size={15} /> In Trash. Only you and people who manage files see it.
        </p>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={pending}
            onClick={() => act(() => trashFile(slug, file.id, false))}
          >
            <Icon name="restore" size={16} /> Restore
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={pending}
            onClick={() => setConfirm('delete')}
          >
            Delete for good
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-critical">
            {error}
          </p>
        )}
        <Sheet
          open={confirm === 'delete'}
          onClose={() => setConfirm(null)}
          title="Delete for good?"
          description={`${file.name} is removed from Hyphy's storage. This can't be undone.`}
          width="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  act(
                    () => deleteFileForGood(slug, file.id),
                    () => {
                      setConfirm(null);
                      if (file.storage === 'device') void deleteDeviceFile(file.id);
                      router.push(workspace.href('/files?view=trash'), { scroll: false });
                    },
                  )
                }
              >
                Delete for good
              </Button>
            </div>
          }
        >
          <span />
        </Sheet>
      </div>
    );

  return (
    <div className="grid gap-2">
      {renaming ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            act(
              () => renameFile(slug, file.id, name),
              () => setRenaming(false),
            );
          }}
        >
          <label htmlFor={`${id}-name`} className="text-[13px] font-medium text-ink-2">
            Name
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={140}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            aria-describedby={`${id}-name-hint`}
          />
          <p id={`${id}-name-hint`} className="text-[12px] text-faint">
            Renaming changes what people see. The file itself stays where it is.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
              Save name
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRenaming(false);
                setName(file.name);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : attaching ? (
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const [type, targetId] = target.split(':');
            if (!targetId) return setError('Choose where it also belongs.');
            act(
              () =>
                attachFile(slug, file.id, { type: type as AttachmentRef['type'], id: targetId }),
              () => setAttaching(false),
            );
          }}
        >
          <label htmlFor={`${id}-attach`} className="text-[13px] font-medium text-ink-2">
            Also belongs to
          </label>
          <Select
            id={`${id}-attach`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value="">Choose…</option>
            {projects.length > 0 && (
              <optgroup label={workspace.labels.projects}>
                {projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.name}
                  </option>
                ))}
              </optgroup>
            )}
            {vehicles.length > 0 && (
              <optgroup label={workspace.labels.vehicles}>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={`vehicle:${vehicle.id}`}>
                    {vehicle.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
          <p className="text-[12px] text-faint">
            The same file, shown in both places — not a copy.
          </p>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" className="flex-1" disabled={pending}>
              Attach
            </Button>
            <Button variant="ghost" onClick={() => setAttaching(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setRenaming(true)}>
            <Icon name="pencil" size={15} /> Rename
          </Button>
          {(projects.length > 0 || vehicles.length > 0) && (
            <Button size="sm" onClick={() => setAttaching(true)}>
              <Icon name="paperclip" size={15} /> Attach to…
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={Boolean(locked)}
            title={locked}
            onClick={() => setConfirm('trash')}
          >
            <Icon name="trash" size={15} /> Move to Trash
          </Button>
        </div>
      )}
      {locked && !renaming && !attaching && <p className="text-[12px] text-faint">{locked}</p>}
      {error && (
        <p role="alert" className="text-[13px] text-critical">
          {error}
        </p>
      )}
      <Sheet
        open={confirm === 'trash'}
        onClose={() => setConfirm(null)}
        title="Move to Trash?"
        description={
          file.attachedTo.length
            ? `${file.name} leaves the places it's attached to. You can restore it from Trash.`
            : `You can restore ${file.name} from Trash.`
        }
        width="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                act(
                  () => trashFile(slug, file.id, true),
                  () => setConfirm(null),
                )
              }
            >
              Move to Trash
            </Button>
          </div>
        }
      >
        <span />
      </Sheet>
    </div>
  );
}
