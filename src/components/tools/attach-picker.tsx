'use client';
import { useId } from 'react';
import { useWorkspace } from '@/components/shell/workspace-context';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';

/**
 * Where a tool's result goes when it's saved. Files is the one shared output layer; in a business
 * Space the result can also belong to a project, so it shows up there too. Hidden where there are
 * no projects to pick.
 */
export function AttachPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (projectId: string) => void;
  className?: string;
}) {
  const id = useId();
  const workspace = useWorkspace();
  const projects = workspace.options.projects.filter((project) => project.status !== 'done');
  if (workspace.space.kind !== 'business' || !projects.length) return null;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex h-11 items-center gap-2 rounded-[11px] bg-white/70 px-3 text-[14px] shadow-[inset_0_0_0_1px_rgb(22_21_15/.1)] lg:h-9 lg:text-[13px]',
        className,
      )}
    >
      <Icon name="projects" size={15} className="shrink-0 text-muted" />
      <span className="shrink-0 text-muted">Attach to</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 truncate bg-transparent font-medium text-ink outline-none"
      >
        <option value="">No {workspace.labels.project.toLowerCase()}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}
