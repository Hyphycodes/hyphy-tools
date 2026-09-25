import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { categoryLabel } from '@/lib/insights';
import type { Person, Project, ReceiptCategory, Vehicle } from '@/lib/platform/types';

/**
 * Relationship chips: the one way Hyphy shows what a record belongs to — a person, a vehicle, a
 * project, a category. Each chip opens what it names, when the viewer can open it. Used where a
 * record is looked at on its own (a receipt, a trip, a file), not in every list row: rows say the
 * same things in their quiet second line.
 */
export type Relation =
  | { type: 'person'; id: string; label: string; person: Pick<Person, 'initials' | 'hue' | 'name'> }
  | { type: 'project'; id: string; label: string; color: string }
  | { type: 'vehicle'; id: string; label: string }
  | { type: 'category'; id: string; label: string; icon: IconName }
  | { type: 'personal-vehicle'; id: string; label: string }
  | { type: 'link'; id: string; label: string };

const categoryIcon: Record<ReceiptCategory, IconName> = {
  fuel: 'fuel',
  materials: 'wrench',
  meals: 'receipt',
  supplies: 'archive',
  equipment: 'wrench',
  other: 'receipt',
};

function hrefFor(base: string, relation: Relation) {
  switch (relation.type) {
    case 'person':
      return `${base}/people/${relation.id}`;
    case 'project':
      return `${base}/projects/${relation.id}`;
    case 'vehicle':
      return `${base}/vehicles/${relation.id}`;
    case 'link':
      return `${base}/tools/links`;
    default:
      return undefined;
  }
}

export const chipClass =
  'inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full bg-surface pr-3 pl-1 text-[13.5px] font-medium text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] lg:h-7 lg:text-[13px]';

export function RelationChip({
  relation,
  base,
  linked = true,
}: {
  relation: Relation;
  base: string;
  /** False when the viewer can't open what it names (a member can't open a vehicle list). */
  linked?: boolean;
}) {
  const lead =
    relation.type === 'person' ? (
      <Avatar person={relation.person} size="xs" />
    ) : relation.type === 'project' ? (
      <span
        className="ml-1 size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)]"
        style={{ background: relation.color }}
        aria-hidden="true"
      />
    ) : (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-well text-ink-2">
        <Icon
          name={
            relation.type === 'category'
              ? relation.icon
              : relation.type === 'link'
                ? 'link'
                : relation.type === 'personal-vehicle'
                  ? 'car'
                  : 'truck'
          }
          size={12}
          strokeWidth={2}
        />
      </span>
    );
  const href = linked ? hrefFor(base, relation) : undefined;
  const body = (
    <>
      {lead}
      <span className="truncate">{relation.label}</span>
    </>
  );
  return href ? (
    <Link
      href={href}
      data-relation={relation.type}
      className={cn(
        chipClass,
        'transition-colors hover:bg-subtle hover:shadow-[inset_0_0_0_1px_var(--color-ink-2)]',
      )}
    >
      {body}
    </Link>
  ) : (
    <span data-relation={relation.type} className={cn(chipClass, 'text-ink-2')}>
      {body}
    </span>
  );
}

export function Relations({
  items,
  base,
  canOpen,
  className,
  label = 'Connected to',
}: {
  items: Relation[];
  base: string;
  /** Which kinds this viewer can open; the rest render as plain chips. */
  canOpen?: Partial<Record<Relation['type'], boolean>>;
  className?: string;
  label?: string;
}) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map((relation) => (
        <li key={`${relation.type}-${relation.id}`} className="min-w-0">
          <RelationChip
            relation={relation}
            base={base}
            linked={canOpen ? canOpen[relation.type] !== false : true}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * The relations of a receipt or trip, resolved from the records the viewer can see. A missing
 * project or vehicle simply isn't shown: it's either not set or not theirs to see.
 */
export function relationsOf(
  record: {
    createdBy: string;
    projectId?: string;
    vehicleId?: string;
    category?: ReceiptCategory;
  },
  lookup: {
    people: Map<string, Person>;
    projects: Pick<Project, 'id' | 'name' | 'color'>[];
    vehicles: Pick<Vehicle, 'id' | 'name'>[];
    /** Trips with no company vehicle say so. */
    trip?: boolean;
  },
  include: { person?: boolean } = { person: true },
): Relation[] {
  const person = lookup.people.get(record.createdBy);
  const vehicle = lookup.vehicles.find((item) => item.id === record.vehicleId);
  const project = lookup.projects.find((item) => item.id === record.projectId);
  return [
    ...(include.person && person
      ? [{ type: 'person' as const, id: person.id, label: person.name, person }]
      : []),
    ...(vehicle
      ? [{ type: 'vehicle' as const, id: vehicle.id, label: vehicle.name }]
      : lookup.trip && !record.vehicleId
        ? [{ type: 'personal-vehicle' as const, id: 'own', label: 'Personal vehicle' }]
        : []),
    ...(project
      ? [{ type: 'project' as const, id: project.id, label: project.name, color: project.color }]
      : []),
    ...(record.category
      ? [
          {
            type: 'category' as const,
            id: record.category,
            label: categoryLabel[record.category],
            icon: categoryIcon[record.category],
          },
        ]
      : []),
  ];
}
