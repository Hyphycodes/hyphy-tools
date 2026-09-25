import Link from 'next/link';
import type { EditTarget } from '@/components/create/create-context';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { flagLabel } from '@/lib/platform/approvals';
import { formatRelative } from '@/lib/platform/format';
import { inboxLook, isDecision } from '@/lib/platform/inbox';
import type { InboxItem, MileageEntry, Person, Receipt } from '@/lib/platform/types';
import { refHref } from './activity-list';
import { DoneButton, FixActions } from './inbox-actions';
import { ReviewActions } from './review';

export function InboxGlyph({
  item,
  size = 'md',
}: {
  item: Pick<InboxItem, 'kind' | 'submission'>;
  size?: 'md' | 'lg';
}) {
  const spec = inboxLook(item);
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

/**
 * Needs attention, one row per item. Approvals get Approve and Return; returned and unfinished
 * items get their fix; notifications are cleared. `records` holds the viewer's own returned and
 * draft submissions, so "Edit & resubmit" can open with what was sent.
 */
export function InboxList({
  items,
  people,
  base,
  slug,
  canApprove,
  timezone,
  limit,
  stacked = false,
  records,
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
  records?: { receipts: Receipt[]; mileage: MileageEntry[] };
}) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <ul className="row-divide">
      {shown.map((item) => {
        const from = item.fromId ? byId.get(item.fromId) : undefined;
        const done = item.status === 'done';
        const submission = item.submission;
        const decision = canApprove && isDecision(item);
        const record =
          submission &&
          (submission.kind === 'receipt'
            ? records?.receipts.find((row) => row.id === submission.id)
            : records?.mileage.find((row) => row.id === submission.id));
        const edit: EditTarget | undefined =
          record && submission && (item.kind === 'returned' || item.kind === 'incomplete')
            ? {
                ...(submission.kind === 'receipt'
                  ? { kind: 'receipt' as const, record: record as Receipt }
                  : { kind: 'mileage' as const, record: record as MileageEntry }),
                reason: submission.returnReason || undefined,
                reviewer: from?.firstName,
              }
            : undefined;
        const heavy = (decision || Boolean(edit)) && !done;
        const when = (
          <span className="text-[12px] whitespace-nowrap text-faint">
            {formatRelative(item.at, timezone)}
          </span>
        );
        const actions = decision ? (
          <ReviewActions
            slug={slug}
            subject={{
              kind: submission!.kind,
              id: submission!.id,
              title: submission!.title,
              amount: submission!.amount,
            }}
            from={from}
          />
        ) : edit ? (
          <FixActions
            slug={slug}
            inboxId={item.id}
            edit={edit}
            returned={item.kind === 'returned'}
          />
        ) : item.kind === 'approval' || item.kind === 'incomplete' ? null : (
          <DoneButton slug={slug} id={item.id} label={item.subject.label} />
        );
        const flags = decision ? submission!.flags.filter((flag) => flag !== 'resubmitted') : [];
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
            <InboxGlyph item={item} />
            <div className="min-w-0 flex-1 basis-[55%]">
              <p className="flex items-center gap-2 text-[14px] leading-snug font-medium text-ink">
                <Link
                  href={refHref(base, item.subject)}
                  scroll={false}
                  className={cn(
                    'hover:underline',
                    // Narrow rows keep the whole title: two lines rather than an ellipsis.
                    stacked ? 'line-clamp-2' : 'line-clamp-2 sm:line-clamp-none sm:truncate',
                  )}
                >
                  {item.title}
                </Link>
                {item.priority === 'high' && !done && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-critical"
                    aria-label="Urgent"
                  />
                )}
              </p>
              <p
                className={cn(
                  'mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted',
                  item.kind === 'returned' ? 'text-ink-2' : 'truncate',
                )}
              >
                {from && <Avatar person={from} size="xs" />}
                <span className={item.kind === 'returned' ? 'line-clamp-2' : 'truncate'}>
                  {from ? `${from.firstName} · ` : ''}
                  {item.detail}
                </span>
              </p>
              {(flags.length > 0 || (decision && submission?.flags.includes('resubmitted'))) && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                  {submission?.flags.includes('resubmitted') && submission.returnReason && (
                    <span className="text-ink-2">
                      <Icon name="arrow-up-right" size={12} className="mr-0.5 inline" />
                      Fixed after: “{submission.returnReason}”
                    </span>
                  )}
                  {flags.map((flag) => (
                    <span key={flag} className="font-medium text-caution">
                      {flagLabel[flag]}
                    </span>
                  ))}
                </p>
              )}
            </div>
            {heavy ? (
              <>
                {/* Two buttons need the width: on phones and in narrow panels they sit under the text. */}
                <span
                  className={cn(
                    'shrink-0 self-start pt-0.5',
                    stacked ? 'block' : 'hidden sm:block sm:self-center sm:pt-0',
                  )}
                >
                  {when}
                </span>
                <div
                  className={cn('flex basis-full pl-[48px]', !stacked && 'sm:basis-auto sm:pl-0')}
                >
                  {actions}
                </div>
              </>
            ) : (
              // One quiet control stays on the row, beside its time, at any width.
              <div
                className={cn(
                  'flex shrink-0 items-center gap-2',
                  stacked
                    ? 'flex-col items-end gap-1'
                    : 'max-sm:flex-col max-sm:items-end max-sm:gap-1',
                )}
              >
                {when}
                {!done && actions}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
