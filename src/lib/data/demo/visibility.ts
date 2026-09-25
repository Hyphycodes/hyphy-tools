import type { Workspace } from '@/lib/identity/types';
import type { ActivityEvent } from '@/lib/platform/types';
import type { Visible } from '../source';
import type { Dataset } from './seed';

/**
 * What a person may see of their Space, in Demo Mode. These are the rules the database enforces
 * with Row Level Security for the Supabase source (supabase/migrations); tests/data.spec.ts
 * checks both give every persona the same rows.
 */
export function visibleTo(workspace: Workspace, data: Dataset): Visible {
  const { space, person, membership, permissions } = workspace;
  const me = person.id;
  const has = (permission: (typeof permissions)[number]) => permissions.includes(permission);
  const isGuest = membership.role === 'guest';
  const inSpace = <T extends { spaceId: string }>(rows: T[]) =>
    rows.filter((row) => row.spaceId === space.id);

  const projects = inSpace(data.projects).filter(
    (project) =>
      has('projects.view_all') ||
      project.teamIds.includes(me) ||
      membership.projectIds?.includes(project.id),
  );
  const vehicles = isGuest
    ? []
    : inSpace(data.vehicles).filter(
        (vehicle) => has('vehicles.view_all') || vehicle.assignedTo === me,
      );
  const ownOrAll = <T extends { createdBy: string }>(rows: T[]) =>
    has('expenses.view_all') ? rows : rows.filter((row) => row.createdBy === me);
  const projectIds = new Set(projects.map((project) => project.id));
  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const files = inSpace(data.files).filter((file) => {
    if (has('files.view_all')) return file.access !== 'private' || file.createdBy === me;
    if (file.createdBy === me) return true;
    if (file.access === 'private' || file.access === 'managers') return false;
    if (file.attachedTo.length === 0) return !isGuest && file.access === 'team';
    return file.attachedTo.some(
      (ref) =>
        (ref.type === 'project' && projectIds.has(ref.id)) ||
        (ref.type === 'vehicle' && vehicleIds.has(ref.id)) ||
        (ref.type === 'person' && ref.id === me),
    );
  });
  const money = new Set(['receipt', 'mileage']);
  const activity = inSpace(data.activity).filter((event) => {
    if (has('activity.view_all') || event.actorId === me) return true;
    if (money.has(event.object.type)) return false;
    return ([event.object, event.context].filter(Boolean) as ActivityEvent['object'][]).some(
      (ref) =>
        (ref.type === 'project' && projectIds.has(ref.id)) ||
        (ref.type === 'vehicle' && vehicleIds.has(ref.id)),
    );
  });
  const receipts = ownOrAll(inSpace(data.receipts));
  const mileage = ownOrAll(inSpace(data.mileage));
  const submissions = new Set([...receipts, ...mileage].map((row) => row.id));
  const all = inSpace(data.memberships).map((item) => ({
    ...item,
    person: data.people.find((entry) => entry.id === item.personId)!,
  }));
  const team = new Set(projects.flatMap((project) => project.teamIds));
  const members = has('people.view')
    ? all
    : all.filter(
        (item) => item.personId === me || (team.has(item.personId) && item.role !== 'guest'),
      );
  const everyone = new Set(inSpace(data.memberships).map((item) => item.personId));
  return {
    projects,
    vehicles,
    receipts,
    mileage,
    files,
    activity,
    qrCodes: has('tools.use') ? inSpace(data.qrCodes) : [],
    linkPages: has('tools.use') ? inSpace(data.linkPages) : [],
    inbox: inSpace(data.inbox).filter(
      (item) => item.recipientId === me || (item.audience && has(item.audience)),
    ),
    members,
    directory: data.people.filter((item) => everyone.has(item.id)),
    approvalEvents: inSpace(data.approvalEvents).filter((event) =>
      submissions.has(event.submissionId),
    ),
  };
}
