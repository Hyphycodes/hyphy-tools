import type { Person } from '@/lib/platform/types';
import { cn } from './cn';

const sizes = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-[12px]',
  lg: 'size-11 text-[15px]',
  xl: 'size-16 text-[22px]',
} as const;

export function Avatar({
  person,
  size = 'md',
  className,
  ring,
}: {
  person: Pick<Person, 'initials' | 'hue' | 'name'>;
  size?: keyof typeof sizes;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      title={person.name}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-semibold tracking-[-0.01em] text-white select-none',
        'shadow-[inset_0_0_0_1px_rgb(0_0_0/.08),inset_0_1px_0_rgb(255_255_255/.18)]',
        ring && 'ring-2 ring-surface',
        sizes[size],
        className,
      )}
      style={{ background: person.hue }}
    >
      <span aria-hidden="true">{person.initials}</span>
      <span className="sr-only">{person.name}</span>
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
}: {
  people: Pick<Person, 'initials' | 'hue' | 'name' | 'id'>[];
  max?: number;
  size?: keyof typeof sizes;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className="flex items-center -space-x-1.5">
      {shown.map((person) => (
        <Avatar key={person.id} person={person} size={size} ring />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-grid place-items-center rounded-full bg-well font-medium text-muted ring-2 ring-surface',
            sizes[size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
