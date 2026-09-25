import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { Icon, type IconName } from '@/components/ui/icon';
import { formatRelative, formatTime } from '@/lib/platform/format';
import type { ActivityEvent, ActivityVerb, ObjectRef, Person } from '@/lib/platform/types';

const verbs: Record<ActivityVerb, string> = {
  created: 'created',
  updated: 'updated',
  uploaded: 'added',
  submitted: 'submitted',
  approved: 'approved',
  rejected: 'returned',
  logged: 'logged',
  assigned: 'assigned',
  joined: 'joined',
  invited: 'invited',
  commented: 'commented on',
  completed: 'completed',
  merged: 'merged',
  generated: 'made',
};

const verbIcon: Partial<Record<ActivityVerb, IconName>> = {
  approved: 'check',
  rejected: 'arrow-left',
  logged: 'route',
  uploaded: 'upload',
  created: 'plus',
  invited: 'user-plus',
  merged: 'pdf',
  generated: 'sparkles',
  completed: 'check-circle',
};

/** Where an activity's object lives inside the Space. */
export function refHref(base: string, ref: Pick<ObjectRef, 'type' | 'id'>) {
  switch (ref.type) {
    case 'project':
      return `${base}/projects/${ref.id}`;
    case 'vehicle':
      return `${base}/vehicles/${ref.id}`;
    case 'person':
      return `${base}/people/${ref.id}`;
    case 'file':
      return `${base}/files?file=${ref.id}`;
    case 'receipt':
      return `${base}/tools/receipts?receipt=${ref.id}`;
    case 'mileage':
      return `${base}/tools/mileage`;
    case 'qr':
      return `${base}/tools/qr`;
    case 'link':
      return `${base}/tools/links`;
    default:
      return `${base}/settings`;
  }
}

function dayLabel(iso: string, timezone: string, now = Date.now()) {
  const day = (value: number | string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(value));
  if (day(iso) === day(now)) return 'Today';
  if (day(iso) === day(now - 86400000)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * The shared activity feed. Every module renders the same component with a different filter,
 * so a receipt submitted on a project shows on the dashboard, the project and the person.
 */
export function ActivityList({
  events,
  people,
  base,
  viewerId,
  timezone,
  grouped = false,
  compact = false,
}: {
  events: ActivityEvent[];
  people: Person[];
  base: string;
  viewerId: string;
  timezone: string;
  grouped?: boolean;
  compact?: boolean;
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const groups: { label: string; items: ActivityEvent[] }[] = [];
  for (const event of events) {
    const label = grouped ? dayLabel(event.at, timezone) : '';
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(event);
    else groups.push({ label, items: [event] });
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.label || 'all'}>
          {group.label && <p className="label px-4 pt-4 pb-1.5">{group.label}</p>}
          <ol className="relative">
            {group.items.map((event, index) => {
              const actor = byId.get(event.actorId);
              const you = event.actorId === viewerId;
              const icon = verbIcon[event.verb];
              return (
                <li key={event.id} className="relative flex gap-3 px-4 py-2.5">
                  {index < group.items.length - 1 && (
                    <span
                      className="absolute top-10 bottom-0 left-[31px] w-px bg-line"
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative mt-0.5">
                    {actor ? (
                      <Avatar person={actor} size="md" />
                    ) : (
                      <span className="block size-8 rounded-full bg-well" />
                    )}
                    {icon && (
                      <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full bg-surface text-ink-2 shadow-[0_0_0_1.5px_var(--color-surface),inset_0_0_0_1px_var(--color-line-strong)]">
                        <Icon name={icon} size={10} strokeWidth={2.4} />
                      </span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={
                        compact ? 'text-[13.5px] leading-snug' : 'text-[14px] leading-snug'
                      }
                    >
                      <span className="font-medium text-ink">
                        {you ? 'You' : (actor?.firstName ?? 'Someone')}
                      </span>{' '}
                      <span className="text-muted">{verbs[event.verb]}</span>{' '}
                      <Link
                        href={refHref(base, event.object)}
                        className="font-medium text-ink hover:underline"
                      >
                        {event.object.label}
                      </Link>
                    </p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted">
                      {[
                        event.detail,
                        event.context?.label,
                        grouped ? undefined : formatRelative(event.at, timezone),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {grouped && (
                    <time
                      dateTime={event.at}
                      className="mono-num shrink-0 pt-0.5 text-[11px] text-faint"
                    >
                      {formatTime(event.at, timezone)}
                    </time>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
