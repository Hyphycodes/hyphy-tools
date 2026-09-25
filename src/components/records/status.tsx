import { Badge, type Tone } from '@/components/ui/badge';
import type { ApprovalStatus, ProjectStatus, SpaceKind, VehicleStatus } from '@/lib/platform/types';

export function approvalBadge(
  status: ApprovalStatus,
  kind: SpaceKind,
): { tone: Tone; label: string } {
  if (kind === 'personal')
    return status === 'draft'
      ? { tone: 'caution', label: 'Needs details' }
      : { tone: 'neutral', label: 'Saved' };
  switch (status) {
    case 'draft':
      return { tone: 'outline', label: 'Draft' };
    case 'submitted':
      return { tone: 'caution', label: 'Pending' };
    case 'approved':
      return { tone: 'positive', label: 'Approved' };
    case 'returned':
      return { tone: 'critical', label: 'Returned' };
  }
}

export function ApprovalBadge({ status, kind }: { status: ApprovalStatus; kind: SpaceKind }) {
  const { tone, label } = approvalBadge(status, kind);
  return (
    <Badge tone={tone} dot={tone !== 'neutral' && tone !== 'outline'}>
      {label}
    </Badge>
  );
}

const projectStatus: Record<ProjectStatus, { tone: Tone; label: string }> = {
  planning: { tone: 'signal', label: 'Planning' },
  active: { tone: 'positive', label: 'Active' },
  'on-hold': { tone: 'caution', label: 'On hold' },
  done: { tone: 'neutral', label: 'Done' },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { tone, label } = projectStatus[status];
  return (
    <Badge tone={tone} dot={status !== 'done'}>
      {label}
    </Badge>
  );
}

const vehicleStatus: Record<VehicleStatus, { tone: Tone; label: string }> = {
  active: { tone: 'positive', label: 'In use' },
  available: { tone: 'signal', label: 'Available' },
  'in-shop': { tone: 'caution', label: 'In the shop' },
};

export function VehicleStatusBadge({ status }: { status: VehicleStatus }) {
  const { tone, label } = vehicleStatus[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
