'use client';
import { CreateButton } from '@/components/create/create-button';
import { useWorkspace } from '@/components/shell/workspace-context';
import { Icon, type IconName } from '@/components/ui/icon';
import type { CreateActionId } from '@/lib/platform/actions';

/**
 * A new business's first steps: each opens the same Create sheet as everywhere else, and each
 * appears only when its tool is on and this person's role can do it.
 */
export function BusinessStarters() {
  const workspace = useWorkspace();
  const project = workspace.labels.projects.replace(/s$/, '').toLowerCase();
  const items: { id: CreateActionId; icon: IconName; title: string; line: string }[] = [
    {
      id: 'project',
      icon: 'projects',
      title: `Create your first ${project}`,
      line: 'Where the team’s work, files and costs come together.',
    },
    {
      id: 'person',
      icon: 'user-plus',
      title: 'Invite your team',
      line: 'They join with their own account and a role you choose.',
    },
    {
      id: 'vehicle',
      icon: 'truck',
      title: 'Add a vehicle',
      line: 'Trips, fuel and service in one place.',
    },
    {
      id: 'file',
      icon: 'upload',
      title: 'Upload a file',
      line: 'Plans, contracts and photos, shared.',
    },
    { id: 'qr', icon: 'qr', title: 'Create a QR code', line: 'For a menu, a job sign or a link.' },
    {
      id: 'receipt',
      icon: 'receipt',
      title: 'Save a receipt',
      line: 'Snap it; it lands where it belongs.',
    },
  ];
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id} className="empty:hidden">
          <CreateButton
            request={item.id}
            className="h-auto w-full items-start justify-start gap-3.5 rounded-[16px] p-3.5 text-left !whitespace-normal lg:h-auto lg:rounded-[16px] lg:p-3.5"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-well text-ink-2">
              <Icon name={item.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink lg:text-[14.5px]">
                {item.title}
              </span>
              <span className="block text-[12.5px] leading-snug font-normal text-muted">
                {item.line}
              </span>
            </span>
          </CreateButton>
        </li>
      ))}
    </ul>
  );
}
