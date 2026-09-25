import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { formatRelative } from '@/lib/platform/format';
import type { ActivityEvent, Person, Review } from '@/lib/platform/types';

type Step = { label: string; detail?: string; done: boolean; tone?: 'caution'; icon: IconName };

/**
 * A submission's story, from its own activity: sent, returned with a note, fixed and sent again,
 * approved. The same component tells it for a receipt and a trip.
 */
export function SubmissionTimeline({
  record,
  events,
  people,
  timezone,
  approvedNote = 'Counted on its project and vehicle',
}: {
  record: Review & { createdBy: string; createdAt: string };
  /** Activity about this record, any order. */
  events: ActivityEvent[];
  people: Map<string, Person>;
  timezone: string;
  approvedNote?: string;
}) {
  const name = (id?: string) => (id ? people.get(id)?.firstName : undefined) ?? 'someone';
  const steps: Step[] = [
    {
      label:
        record.status === 'draft' ? 'Saved as a draft' : `Submitted by ${name(record.createdBy)}`,
      detail: formatRelative(record.createdAt, timezone),
      done: true,
      icon: 'check',
    },
  ];
  const story = [...events]
    .filter((event) => ['returned', 'resubmitted', 'approved'].includes(event.verb))
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const event of story)
    steps.push(
      event.verb === 'returned'
        ? {
            label: `Returned by ${name(event.actorId)}`,
            detail: event.detail ?? formatRelative(event.at, timezone),
            done: true,
            tone: 'caution',
            icon: 'arrow-left',
          }
        : event.verb === 'resubmitted'
          ? {
              label: `Fixed and sent again by ${name(event.actorId)}`,
              detail: formatRelative(event.at, timezone),
              done: true,
              icon: 'arrow-up-right',
            }
          : {
              label: `Approved by ${name(event.actorId)}`,
              detail: formatRelative(event.at, timezone),
              done: true,
              icon: 'check',
            },
    );
  const last = story.at(-1)?.verb;
  if (record.status === 'approved' && last !== 'approved')
    steps.push({
      label: `Approved${record.reviewedBy ? ` by ${name(record.reviewedBy)}` : ''}`,
      detail: record.reviewedAt ? formatRelative(record.reviewedAt, timezone) : approvedNote,
      done: true,
      icon: 'check',
    });
  if (record.status === 'returned' && last !== 'returned')
    steps.push({
      label: `Returned${record.reviewedBy ? ` by ${name(record.reviewedBy)}` : ''}`,
      detail: record.returnReason
        ? `“${record.returnReason}”`
        : record.reviewedAt
          ? formatRelative(record.reviewedAt, timezone)
          : undefined,
      done: true,
      tone: 'caution',
      icon: 'arrow-left',
    });
  if (record.status === 'submitted')
    steps.push({
      label: 'Waiting for a manager',
      detail: 'Usually within a day',
      done: false,
      icon: 'clock',
    });
  if (record.status === 'draft')
    steps.push({
      label: 'Not sent yet',
      detail: 'Finish it, then submit',
      done: false,
      icon: 'clock',
    });

  return (
    <section aria-label="Status">
      <p className="label mb-2.5">Status</p>
      <ol className="grid gap-0">
        {steps.map((step, index) => (
          <li key={`${step.label}-${index}`} className="relative flex gap-3 pb-4 last:pb-0">
            {index < steps.length - 1 && (
              <span
                className="absolute top-6 bottom-0 left-[11px] w-px bg-line-strong"
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'relative grid size-6 shrink-0 place-items-center rounded-full',
                step.done
                  ? step.tone === 'caution'
                    ? 'bg-caution text-white'
                    : 'bg-ink text-white'
                  : 'bg-surface text-muted shadow-[inset_0_0_0_1.5px_var(--color-line-strong)]',
              )}
            >
              <Icon name={step.icon} size={12} strokeWidth={2.4} />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[14px] font-medium text-ink">{step.label}</span>
              {step.detail && <span className="block text-[12.5px] text-muted">{step.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
