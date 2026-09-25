import Link from 'next/link';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { formatRelative } from '@/lib/platform/format';
import type { InboxItem, InboxKind, Person } from '@/lib/platform/types';
import { refHref } from './activity-list';
import { InboxActions } from './inbox-actions';

export const inboxKinds: Record<
  InboxKind,
  { icon: IconName; bg: string; fg: string; label: string }
> = {
  'receipt-approval': {
    icon: 'receipt',
    bg: 'var(--color-tool-receipt)',
    fg: '#16150F',
    label: 'Approvals',
  },
  'unassigned-receipt': {
    icon: 'receipt',
    bg: 'var(--color-caution-soft)',
    fg: 'var(--color-caution)',
    label: 'Approvals',
  },
  'mileage-review': {
    icon: 'route',
    bg: 'var(--color-tool-miles)',
    fg: '#16150F',
    label: 'Approvals',
  },
  'receipt-returned': {
    icon: 'arrow-left',
    bg: 'var(--color-critical-soft)',
    fg: 'var(--color-critical)',
    label: 'Updates',
  },
  'document-uploaded': {
    icon: 'file-text',
    bg: 'var(--color-tool-files)',
    fg: '#16150F',
    label: 'Documents',
  },
  'document-expiring': {
    icon: 'clock',
    bg: 'var(--color-caution-soft)',
    fg: 'var(--color-caution)',
    label: 'Documents',
  },
  'access-request': {
    icon: 'user-plus',
    bg: 'var(--color-signal-soft)',
    fg: 'var(--color-signal-ink)',
    label: 'People',
  },
  mention: {
    icon: 'message',
    bg: 'var(--color-well)',
    fg: 'var(--color-ink-2)',
    label: 'Mentions',
  },
};

export function InboxGlyph({ kind, size = 'md' }: { kind: InboxKind; size?: 'md' | 'lg' }) {
  const spec = inboxKinds[kind];
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center shadow-[inset_0_0_0_1px_rgb(0_0_0/.06)]',
        size === 'lg' ? 'size-11 rounded-[13px]' : 'size-9 rounded-[11px]',
      )}
      style={{ background: spec.bg, color: spec.fg }}
      aria-hidden="true"
    >
      <Icon name={spec.icon} size={size === 'lg' ? 20 : 17} strokeWidth={1.9} />
    </span>
  );
}

export function InboxList({
  items,
  people,
  base,
  slug,
  canApprove,
  timezone,
  limit,
  stacked = false,
}: {
  items: InboxItem[];
  people: Person[];
  base: string;
  slug: string;
  canApprove: boolean;
  timezone: string;
  limit?: number;
  /** For narrow panels: actions sit under the text instead of beside it. */
  stacked?: boolean;
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="row-divide">
      {shown.map((item) => {
        const from = item.fromId ? byId.get(item.fromId) : undefined;
        const done = item.status === 'done';
        return (
          <li
            key={item.id}
            data-inbox-item={item.id}
            className={cn(
              'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3',
              !stacked && 'sm:flex-nowrap',
              done && 'opacity-55',
            )}
          >
            <InboxGlyph kind={item.kind} />
            <div className="min-w-0 flex-1 basis-[60%]">
              <p className="flex items-center gap-2 text-[14px] font-medium text-ink">
                <Link href={refHref(base, item.subject)} className="truncate hover:underline">
                  {item.title}
                </Link>
                {item.priority === 'high' && !done && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-critical"
                    aria-label="Urgent"
                  />
                )}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-muted">
                {from && <Avatar person={from} size="xs" />}
                <span className="truncate">
                  {from ? `${from.firstName} · ` : ''}
                  {item.detail}
                </span>
              </p>
            </div>
            <span
              className={cn(
                'shrink-0 self-start pt-0.5 text-[12px] text-faint',
                stacked ? 'block' : 'hidden sm:block sm:self-center sm:pt-0',
              )}
            >
              {formatRelative(item.at, timezone)}
            </span>
            {!done && (
              <div className={cn('flex basis-full pl-[38px]', !stacked && 'sm:basis-auto sm:pl-0')}>
                <InboxActions
                  slug={slug}
                  id={item.id}
                  kind={item.kind}
                  subject={item.subject}
                  canApprove={canApprove}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
