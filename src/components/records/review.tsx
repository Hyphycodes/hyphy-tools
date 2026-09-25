'use client';
import { useId, useState, useTransition, type MouseEvent } from 'react';
import {
  approveSubmissions,
  resolveInboxItem,
  reviewSubmission,
} from '@/app/(app)/[space]/actions';
import { useCreate } from '@/components/create/create-context';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { submissionKinds, type SubmissionKind, type SubmissionRef } from '@/lib/platform/approvals';
import type { MileageEntry, Person, Receipt } from '@/lib/platform/types';

/*
 * The shared approval interactions. Every place a submission is decided — the Inbox, a receipt,
 * a trip, a person, a project — uses these, so approving and returning feel the same everywhere.
 */

type Subject = { kind: SubmissionKind; id: string; title: string; amount: string };

/** Marks the row a decision came from, so it tints and slides away while the server confirms. */
function leaving(event: MouseEvent<HTMLElement> | null, outcome: string) {
  const row = event?.currentTarget.closest<HTMLElement>('[data-inbox-item],[data-submission]');
  row?.setAttribute('data-leaving', outcome);
  return () => row?.removeAttribute('data-leaving');
}

export function ReviewActions({
  slug,
  subject,
  from,
  size = 'sm',
  className,
}: {
  slug: string;
  subject: Subject;
  /** Who sent it, so the return note reads as a note to a person. */
  from?: Pick<Person, 'firstName' | 'name' | 'initials' | 'hue'>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [returning, setReturning] = useState(false);
  const toast = useToast();
  const approve = (event: MouseEvent<HTMLElement>) => {
    const undo = leaving(event, 'approved');
    start(async () => {
      const result = await reviewSubmission(slug, subject.kind, subject.id, 'approved');
      if (!result.ok) undo();
      toast(
        result.ok
          ? { title: 'Approved', description: `${subject.title} · ${subject.amount}` }
          : { title: result.error, icon: 'alert' },
      );
    });
  };
  return (
    <div className={cn('flex shrink-0 gap-1.5', className)}>
      <Button size={size} variant="ghost" disabled={pending} onClick={() => setReturning(true)}>
        Return
      </Button>
      <Button size={size} variant="primary" disabled={pending} onClick={approve}>
        Approve
      </Button>
      <ReturnSheet
        open={returning}
        onClose={() => setReturning(false)}
        slug={slug}
        subject={subject}
        from={from}
      />
    </div>
  );
}

/**
 * Sending something back is a note to a colleague, not a rejection: say what to change, and they
 * get an Edit & resubmit button beside it. The note is optional; a one-tap start is offered.
 */
export function ReturnSheet({
  open,
  onClose,
  slug,
  subject,
  from,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  subject: Subject;
  from?: Pick<Person, 'firstName' | 'name' | 'initials' | 'hue'>;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();
  const spec = submissionKinds[subject.kind];
  const send = () =>
    start(async () => {
      setError('');
      const result = await reviewSubmission(slug, subject.kind, subject.id, 'returned', reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: `Returned to ${from?.firstName ?? 'sender'}`,
        description: reason.trim() ? `“${reason.trim()}”` : `${subject.title} · ${subject.amount}`,
        icon: 'arrow-left',
      });
      setReason('');
      onClose();
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="sm"
      title={`Return this ${spec.noun}`}
      description={`${subject.title} · ${subject.amount}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} disabled={pending}>
            <Icon name="arrow-left" size={15} />
            {pending ? 'Returning…' : `Return to ${from?.firstName ?? 'sender'}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 pt-1">
        <p className="flex items-start gap-2.5 rounded-[14px] bg-subtle px-3.5 py-3 text-[13.5px] leading-snug text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {from && <Avatar person={from} size="sm" />}
          <span>
            {from ? `${from.firstName} gets` : 'They get'} it back with your note and an{' '}
            <span className="font-medium text-ink">Edit & resubmit</span> button. Nothing is
            deleted.
          </span>
        </p>
        <div className="grid gap-1.5">
          <label
            htmlFor={`${id}-reason`}
            className="flex items-baseline justify-between text-[13.5px] font-medium text-ink-2"
          >
            What should change?
            <span className="text-[12px] font-normal text-faint">Optional</span>
          </label>
          <Textarea
            id={`${id}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 280))}
            rows={3}
            placeholder={spec.reasons[0]}
            data-autofocus
          />
        </div>
        <div>
          <p className="mb-2 text-[12.5px] text-muted">Or start from</p>
          <div className="flex flex-wrap gap-1.5">
            {spec.reasons.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setReason(text)}
                aria-pressed={reason === text}
                className={cn(
                  'rounded-[12px] px-3 py-2 text-left text-[13px] leading-snug transition-colors',
                  reason === text
                    ? 'bg-ink text-white'
                    : 'bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="flex items-center gap-2 rounded-[10px] bg-critical-soft px-3 py-2 text-[13.5px] text-critical"
          >
            <Icon name="alert" size={15} /> {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

/**
 * "Approve all 4 from Mike". Batch approval takes two taps on purpose: the first says exactly
 * what will happen, the second does it. Returning is never done in bulk.
 */
export function ApproveAll({
  slug,
  refs,
  label,
  summary,
  size = 'sm',
  variant = 'secondary',
  onApproved,
  className,
}: {
  slug: string;
  refs: SubmissionRef[];
  label: string;
  /** What the confirm step says: "4 items · $201.21 · 51.2 mi". */
  summary: string;
  size?: 'sm' | 'md';
  variant?: 'secondary' | 'primary';
  onApproved?: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  if (!refs.length) return null;
  const go = () =>
    start(async () => {
      const result = await approveSubmissions(slug, refs);
      setConfirming(false);
      if (result.ok) onApproved?.();
      toast(
        result.ok
          ? { title: result.message ?? 'Approved', description: summary }
          : { title: result.error, icon: 'alert' },
      );
    });
  if (!confirming)
    return (
      <Button
        size={size}
        variant={variant}
        className={className}
        onClick={() => setConfirming(true)}
        data-approve-all
      >
        <Icon name="check" size={14} strokeWidth={2.2} /> {label}
      </Button>
    );
  return (
    <span
      role="group"
      aria-label="Confirm approval"
      className={cn('inline-flex animate-fade items-center gap-1.5', className)}
    >
      <span className="hidden text-[12.5px] text-muted sm:inline">{summary}</span>
      <Button size={size} variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button size={size} variant="primary" disabled={pending} onClick={go}>
        {pending ? 'Approving…' : `Yes, approve ${refs.length}`}
      </Button>
    </span>
  );
}

/**
 * What a submitter sees on something that came back: who returned it, their note in their own
 * words, and the way forward. Supportive, not a red error.
 */
export function ReturnedNotice({
  slug,
  inboxId,
  reason,
  reviewer,
  edit,
  compact = false,
  draft = false,
}: {
  slug: string;
  /** The derived inbox id (`rt_…`), to set it aside without resubmitting. */
  inboxId?: string;
  reason?: string;
  reviewer?: Pick<Person, 'firstName' | 'name' | 'initials' | 'hue'>;
  edit: { kind: 'receipt'; record: Receipt } | { kind: 'mileage'; record: MileageEntry };
  compact?: boolean;
  /** An unfinished draft rather than a return. */
  draft?: boolean;
}) {
  const create = useCreate();
  const toast = useToast();
  const [pending, start] = useTransition();
  const setAside = () =>
    inboxId &&
    start(async () => {
      const result = await resolveInboxItem(slug, inboxId);
      toast(result.ok ? { title: 'Left as returned' } : { title: result.error, icon: 'alert' });
    });
  return (
    <div
      className={cn(
        'rounded-[16px] bg-caution-soft/70 shadow-[inset_0_0_0_1px_rgb(180_83_9/.14)]',
        compact ? 'p-3' : 'p-4',
      )}
      data-returned-notice
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-caution">
        <Icon name={draft ? 'pencil' : 'arrow-left'} size={14} strokeWidth={2.2} />
        {draft ? 'Not sent yet' : `Returned${reviewer ? ` by ${reviewer.firstName}` : ''}`}
      </p>
      <div className="mt-2 flex items-start gap-2.5">
        {reviewer && <Avatar person={reviewer} size="sm" />}
        <p className="min-w-0 text-[14.5px] leading-snug text-ink">
          {draft ? (
            <span className="text-ink-2">Finish the details and it’s filed.</span>
          ) : reason ? (
            <>
              <span className="sr-only">Reason: </span>“{reason}”
            </>
          ) : (
            <span className="text-ink-2">No note — check the details and send it again.</span>
          )}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={() =>
            create.start({
              id: edit.kind === 'receipt' ? 'receipt' : 'mileage',
              edit: { ...edit, reason, reviewer: reviewer?.firstName },
            })
          }
        >
          <Icon name="pencil" size={14} /> {draft ? 'Finish' : 'Edit & resubmit'}
        </Button>
        {inboxId && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={setAside}>
            Leave it
          </Button>
        )}
      </div>
    </div>
  );
}
