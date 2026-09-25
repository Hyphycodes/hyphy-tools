'use client';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { approveSubmissions } from '@/app/(app)/[space]/actions';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import {
  describeCount,
  flagLabel,
  groupBySubmitter,
  type Submission,
} from '@/lib/platform/approvals';
import { formatCurrency, formatMiles, formatRelative } from '@/lib/platform/format';
import { inboxLook } from '@/lib/platform/inbox';
import type { InboxItem, Person } from '@/lib/platform/types';
import { ApproveAll, ReviewActions } from './review';

type Row = InboxItem & { submission: Submission };

const amounts = (items: Pick<Submission, 'kind' | 'value'>[]) => {
  const dollars = items.filter((i) => i.kind === 'receipt').reduce((sum, i) => sum + i.value, 0);
  const miles = items.filter((i) => i.kind === 'mileage').reduce((sum, i) => sum + i.value, 0);
  return [
    dollars ? formatCurrency(dollars) : undefined,
    miles ? formatMiles(Math.round(miles * 10) / 10) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * The owner's work queue: what's waiting, grouped by who sent it, so routine weeks clear in a few
 * taps. Each person's group can be approved together (with a confirm step); any mix can be
 * selected and approved at once. Returning is always one at a time, with a note.
 */
export function ApprovalQueue({
  items,
  people,
  base,
  slug,
  timezone,
}: {
  items: Row[];
  people: Person[];
  base: string;
  slug: string;
  timezone: string;
}) {
  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const toast = useToast();
  const groups = groupBySubmitter(items.map((item) => ({ ...item.submission, row: item })));
  const chosen = items.filter((item) => selected.has(item.submission.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = items.length > 0 && chosen.length === items.length;
  const approveSelected = () =>
    start(async () => {
      const result = await approveSubmissions(
        slug,
        chosen.map((item) => ({ kind: item.submission.kind, id: item.submission.id })),
      );
      if (result.ok) setSelected(new Set());
      toast(
        result.ok
          ? {
              title: result.message ?? 'Approved',
              description: amounts(chosen.map((i) => i.submission)),
            }
          : { title: result.error, icon: 'alert' },
      );
    });

  return (
    <div>
      {items.length > 1 && (
        <label className="flex cursor-pointer items-center gap-2.5 border-b border-line px-4 py-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) =>
              setSelected(
                event.target.checked ? new Set(items.map((item) => item.submission.id)) : new Set(),
              )
            }
            className="size-[18px] accent-[var(--color-ink)]"
          />
          Select all {items.length}
        </label>
      )}
      {groups.map((group) => {
        const person = byId.get(group.personId);
        const refs = group.items.map((item) => ({ kind: item.kind, id: item.id }));
        return (
          <section
            key={group.personId}
            aria-label={`From ${person?.name ?? 'someone'}`}
            className="border-b border-line last:border-b-0"
          >
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-subtle/60 px-4 py-2.5">
              {person && <Avatar person={person} size="sm" />}
              <p className="min-w-0 flex-1 text-[13px] leading-tight">
                <Link
                  href={`${base}/people/${group.personId}`}
                  className="font-semibold text-ink hover:underline"
                >
                  {person?.name ?? 'Someone'}
                </Link>
                <span className="block text-[12px] text-muted sm:ml-1.5 sm:inline">
                  {describeCount(group.items)} · {amounts(group.items)}
                </span>
              </p>
              {group.items.length > 1 && (
                <ApproveAll
                  slug={slug}
                  refs={refs}
                  label={`Approve all ${group.items.length}`}
                  summary={`${describeCount(group.items)} from ${person?.firstName ?? 'them'} · ${amounts(group.items)}`}
                />
              )}
            </header>
            <ul className="row-divide">
              {group.items.map(({ row }) => {
                const submission = row.submission;
                const look = inboxLook(row);
                const on = selected.has(submission.id);
                const flags = submission.flags.filter((flag) => flag !== 'resubmitted');
                return (
                  <li
                    key={row.id}
                    data-inbox-item={row.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 pr-4 pl-2 sm:flex-nowrap',
                      on && 'bg-signal-soft/50',
                    )}
                  >
                    <label className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-ink/5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(event) => toggle(submission.id, event.target.checked)}
                        aria-label={`Select ${submission.title}`}
                        className="size-[18px] accent-[var(--color-ink)]"
                      />
                    </label>
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-[11px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.06)]"
                      style={{ background: look.bg, color: look.fg }}
                      aria-hidden="true"
                    >
                      <Icon name={look.icon} size={17} strokeWidth={1.9} />
                    </span>
                    <div className="min-w-0 flex-1 basis-[50%]">
                      <p className="truncate text-[14px] leading-snug font-medium text-ink">
                        <Link
                          href={`${base}${submission.kind === 'receipt' ? `/tools/receipts?receipt=${submission.id}` : `/tools/mileage?trip=${submission.id}`}`}
                          scroll={false}
                          className="hover:underline"
                        >
                          {row.title}
                        </Link>
                      </p>
                      <p className="truncate text-[12.5px] text-muted">{row.detail}</p>
                      {(flags.length > 0 || submission.flags.includes('resubmitted')) && (
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px]">
                          {submission.flags.includes('resubmitted') && submission.returnReason && (
                            <span className="text-ink-2">
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
                    <span className="hidden shrink-0 text-[12px] whitespace-nowrap text-faint sm:block">
                      {formatRelative(row.at, timezone)}
                    </span>
                    <div className="flex basis-full justify-end pl-[92px] sm:basis-auto sm:pl-0">
                      <ReviewActions
                        slug={slug}
                        subject={{
                          kind: submission.kind,
                          id: submission.id,
                          title: submission.title,
                          amount: submission.amount,
                        }}
                        from={person}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {chosen.length > 0 && (
        <div
          role="region"
          aria-label="Selected"
          className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-20 mx-3 my-3 flex animate-rise items-center gap-3 rounded-[16px] bg-night px-4 py-2.5 text-white shadow-pop lg:bottom-4"
        >
          <p className="min-w-0 flex-1 text-[13.5px]">
            <span className="font-semibold">{chosen.length} selected</span>
            <span className="block truncate text-[12px] text-white/60 sm:ml-2 sm:inline">
              {amounts(chosen.map((item) => item.submission))}
            </span>
          </p>
          <Button
            size="sm"
            variant="inverse"
            onClick={() => setSelected(new Set())}
            disabled={pending}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="!bg-white !text-ink hover:!bg-white/90"
            onClick={approveSelected}
            disabled={pending}
          >
            <Icon name="check" size={14} strokeWidth={2.2} />
            {pending ? 'Approving…' : `Approve ${chosen.length}`}
          </Button>
        </div>
      )}
    </div>
  );
}
