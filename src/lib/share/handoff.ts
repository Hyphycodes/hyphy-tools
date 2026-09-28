import * as z from 'zod/mini';
import { placeSchema } from '@/lib/tools/places';
import { idSchema, stampSchema } from '@/lib/tools/claims';

/*
 * Handoffs between group tools: a Plan opens When?, Where?, Bring or Split for its occasion, and
 * what they made comes back to the Plan. Nothing goes through a server:
 *
 *   Plan → tool     /tools/when?plan=<plan id>&title=<the occasion>   (the tool starts titled)
 *   tool → Plan     the tool's link and a one-line summary are left in this browser under the
 *                   plan's id, then /tools/plan?open=<plan id> picks them up (`takeAttachments`).
 *
 * Where? can also start a new Plan from a winner: /tools/plan?place=<name>&placeUrl=<link>.
 * Pure except for the two storage helpers at the end. Tested in tests/lib-plan.spec.ts.
 */

export const CONNECTED = ['when', 'where', 'bring', 'split'] as const;
export type Connected = (typeof CONNECTED)[number];

/** What a tool leaves for a plan: its link, a summary, and what it settled. */
export const attachmentSchema = z.object({
  url: z.string().check(z.maxLength(16_000)),
  /** "Sat, Oct 17 · 7:30 PM", "Monteverde", "3 things still needed". */
  summary: z.string().check(z.maxLength(80)),
  t: stampSchema,
  /** Where? settled a place. */
  place: z.optional(placeSchema),
  /** When? settled a day (YYYY-MM-DD) and a start (minutes after midnight). */
  date: z.optional(z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))),
  time: z.optional(z.int().check(z.minimum(0), z.maximum(1439))),
});
export type Attachment = z.infer<typeof attachmentSchema>;

const pendingSchema = z.record(idSchema, z.partialRecord(z.enum(CONNECTED), attachmentSchema));
type Pending = z.infer<typeof pendingSchema>;

export const HANDOFF_KEY = 'hyphy.handoff.v1';

/** The plan a tool was opened for, from its address (`?plan=…&title=…`). */
export function handoffFrom(search: string): { plan: string; title: string } | null {
  const params = new URLSearchParams(search);
  const plan = params.get('plan') ?? '';
  if (!/^[a-z0-9]{1,24}$/.test(plan)) return null;
  return { plan, title: (params.get('title') ?? '').trim().slice(0, 80) };
}

/** The address that opens a tool for a plan. */
export function toolForPlan(tool: Connected, planId: string, title: string) {
  const params = new URLSearchParams({ plan: planId });
  if (title.trim()) params.set('title', title.trim());
  return `/tools/${tool}?${params}`;
}

/** Leave a tool's result for a plan (pure: returns the new pending map). */
export function leave(pending: Pending, planId: string, tool: Connected, attachment: Attachment) {
  return { ...pending, [planId]: { ...pending[planId], [tool]: attachment } };
}

/** Take what's waiting for a plan (pure). */
export function take(pending: Pending, planId: string) {
  const { [planId]: waiting, ...rest } = pending;
  return { waiting: waiting ?? {}, rest };
}

function readPending(): Pending {
  try {
    const raw = window.localStorage.getItem(HANDOFF_KEY);
    if (!raw) return {};
    const parsed = z.safeParse(pendingSchema, JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function writePending(pending: Pending) {
  try {
    if (Object.keys(pending).length)
      window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(HANDOFF_KEY);
  } catch {
    // Storage refused (a private window): the plan can still take the link by paste.
  }
}

/** In a tool opened for a plan: leave its result for the plan in this browser. */
export function leaveForPlan(planId: string, tool: Connected, attachment: Attachment) {
  writePending(leave(readPending(), planId, tool, attachment));
}

/** In Plan: take whatever tools left for this plan. */
export function takeAttachments(planId: string) {
  const { waiting, rest } = take(readPending(), planId);
  writePending(rest);
  return waiting;
}
