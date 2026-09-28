import * as z from 'zod/mini';
import { attachmentSchema, CONNECTED, type Attachment, type Connected } from '@/lib/share/handoff';
import { bump, idSchema, stampSchema } from './claims';
import { placeSchema, type Place } from './places';
import { addDays, formatDay, formatTime, localDay, weekdayOf } from './when';

/*
 * Plan: the shared card for something people are doing together — what, when, where, who, and
 * the few things around it. It's the hub of the group tools: When? can find the time, Where? the
 * place, Bring what everyone brings and Split the bill after, each attached by its link. Nothing
 * is required but a name.
 *
 * The plan lives in its link; copies merge like the other group tools:
 * - The details (name, kind, day, time, place, note): the copy edited last wins.
 * - People: one record each, the later change wins. An invited name someone answered for
 *   ("that's me") points to their record (`as`), so they're counted once.
 * - Attached tools: per tool, the later attachment wins.
 * Pure and tested (tests/lib-plan.spec.ts).
 */

export const MAX_PEOPLE = 60;

export const PLAN_KINDS = ['dinner', 'party', 'birthday', 'trip', 'hangout', 'other'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_LOOK: Record<
  PlanKind,
  {
    label: string;
    hint: string;
    example: string;
    icon: 'utensils' | 'party' | 'cake' | 'plane' | 'coffee' | 'sparkles';
  }
> = {
  dinner: {
    label: 'Dinner',
    hint: 'A table for the group',
    example: 'Friday dinner',
    icon: 'utensils',
  },
  party: { label: 'Party', hint: 'Music, snacks, people', example: 'Housewarming', icon: 'party' },
  birthday: {
    label: 'Birthday',
    hint: 'Someone’s day',
    example: 'Kamila’s birthday',
    icon: 'cake',
  },
  trip: { label: 'Trip', hint: 'A weekend or longer', example: 'Lake weekend', icon: 'plane' },
  hangout: {
    label: 'Hangout',
    hint: 'Games, a movie, a walk',
    example: 'Game night',
    icon: 'coffee',
  },
  other: {
    label: 'Something else',
    hint: 'Anything with people',
    example: 'Something fun',
    icon: 'sparkles',
  },
};

export const RSVPS = ['in', 'maybe', 'out', 'invited'] as const;
export type Rsvp = (typeof RSVPS)[number];

export const personSchema = z.object({
  name: z.string().check(z.maxLength(40)),
  rsvp: z.enum(RSVPS),
  t: stampSchema,
  /** The person who made the plan. */
  host: z.optional(z.boolean()),
  /** An invited name answered by someone on their own device: their record's id. */
  as: z.optional(idSchema),
  /** Taken off the list by the host. */
  gone: z.optional(z.boolean()),
});
export type PlanPerson = z.infer<typeof personSchema>;

const day = z.string().check(z.regex(/^(\d{4}-\d{2}-\d{2})?$/));

export const planSchema = z.object({
  v: z.literal(1),
  id: idSchema,
  kind: z.enum(PLAN_KINDS),
  title: z.string().check(z.maxLength(80)),
  edited: stampSchema,
  /** The day (YYYY-MM-DD), or '' for not yet. */
  date: day,
  /** A trip's last day, or ''. */
  end: day,
  /** Minutes after midnight, or -1 for no time yet. */
  time: z.int().check(z.minimum(-1), z.maximum(1439)),
  place: z.nullable(placeSchema),
  note: z.string().check(z.maxLength(400)),
  people: z
    .record(idSchema, personSchema)
    .check(z.refine((people) => Object.keys(people).length <= MAX_PEOPLE * 2, 'Too many people')),
  links: z.partialRecord(z.enum(CONNECTED), attachmentSchema),
});
export type Plan = z.infer<typeof planSchema>;

export function newPlan(id: string, now: number, kind: PlanKind = 'other'): Plan {
  return {
    v: 1,
    id,
    kind,
    title: '',
    edited: now,
    date: '',
    end: '',
    time: -1,
    place: null,
    note: '',
    people: {},
    links: {},
  };
}

export const titleOf = (plan: Pick<Plan, 'title' | 'kind'>) =>
  plan.title.trim() || PLAN_LOOK[plan.kind].label;

/* ---------------- merging ---------------- */

export function mergePlan(a: Plan, b: Plan): Plan {
  const newer = b.edited > a.edited ? b : a;
  const people: Record<string, PlanPerson> = {};
  for (const id of new Set([...Object.keys(a.people), ...Object.keys(b.people)])) {
    const mine = a.people[id];
    const theirs = b.people[id];
    people[id] =
      !mine ||
      (theirs &&
        (theirs.t > mine.t ||
          (theirs.t === mine.t && JSON.stringify(theirs) > JSON.stringify(mine))))
        ? theirs
        : mine;
  }
  const links: Plan['links'] = {};
  for (const tool of CONNECTED) {
    const mine = a.links[tool];
    const theirs = b.links[tool];
    const winner = !mine ? theirs : !theirs ? mine : theirs.t > mine.t ? theirs : mine;
    if (winner) links[tool] = winner;
  }
  return {
    v: 1,
    id: a.id,
    kind: newer.kind,
    title: newer.title,
    edited: Math.max(a.edited, b.edited),
    date: newer.date,
    end: newer.end,
    time: newer.time,
    place: newer.place,
    note: newer.note,
    people: Object.fromEntries(Object.entries(people).slice(0, MAX_PEOPLE * 2)),
    links,
  };
}

/* ---------------- the host's changes ---------------- */

export type Details = Partial<
  Pick<Plan, 'kind' | 'title' | 'date' | 'end' | 'time' | 'place' | 'note'>
>;

export function setDetails(plan: Plan, details: Details, now: number): Plan {
  const next = { ...plan, ...details, edited: bump(plan.edited, now) };
  next.title = next.title.slice(0, 80);
  next.note = next.note.slice(0, 400);
  if (!next.date) next.end = '';
  if (next.end && next.end <= next.date) next.end = '';
  return next;
}

/** Everyone on the list, in the order they matter: the host, who's in, maybe, invited, out. */
export function peopleOf(plan: Plan) {
  const order: Record<Rsvp, number> = { in: 1, maybe: 2, invited: 3, out: 4 };
  return Object.entries(plan.people)
    .filter(([, person]) => !person.as && !person.gone && person.name.trim())
    .map(([id, person]) => ({ id, ...person }))
    .sort(
      (a, b) =>
        Number(Boolean(b.host)) - Number(Boolean(a.host)) ||
        order[a.rsvp] - order[b.rsvp] ||
        a.t - b.t,
    );
}

/** Add names (the host's invite list). Names already there are skipped. */
export function addPeople(plan: Plan, names: string[], ids: string[], now: number) {
  const known = new Set(peopleOf(plan).map((person) => person.name.trim().toLowerCase()));
  const people = { ...plan.people };
  let added = 0;
  names.forEach((raw, index) => {
    const name = raw.trim().slice(0, 40);
    const id = ids[index];
    if (!name || !id || people[id] || known.has(name.toLowerCase())) return;
    if (peopleOf({ ...plan, people }).length >= MAX_PEOPLE) return;
    known.add(name.toLowerCase());
    people[id] = { name, rsvp: 'invited', t: now };
    added += 1;
  });
  return { plan: added ? { ...plan, people } : plan, added };
}

/** The host takes someone off the list. */
export function removePerson(plan: Plan, personId: string, now: number): Plan {
  const person = plan.people[personId];
  if (!person) return plan;
  return {
    ...plan,
    people: { ...plan.people, [personId]: { ...person, gone: true, t: bump(person.t, now) } },
  };
}

/**
 * Someone answers for themselves: in, maybe or out. `invite` is the invited name they said is
 * them ("that's me"), which then points to their own record.
 */
export function answer(
  plan: Plan,
  who: { id: string; name: string },
  rsvp: Exclude<Rsvp, 'invited'>,
  now: number,
  options: { invite?: string; host?: boolean } = {},
): Plan {
  const people = { ...plan.people };
  const current = people[who.id];
  people[who.id] = {
    name: who.name.slice(0, 40),
    rsvp,
    t: bump(current?.t ?? 0, now),
    ...(current?.host || options.host ? { host: true } : {}),
  };
  const invite = options.invite ? people[options.invite] : undefined;
  if (invite && options.invite !== who.id && !invite.as)
    people[options.invite!] = { ...invite, as: who.id, t: bump(invite.t, now) };
  return { ...plan, people };
}

/** A name fixed on this device shows on this plan too. */
export function renamePerson(plan: Plan, personId: string, name: string, now: number): Plan {
  const person = plan.people[personId];
  if (!person || person.name === name) return plan;
  return {
    ...plan,
    people: {
      ...plan.people,
      [personId]: { ...person, name: name.slice(0, 40), t: bump(person.t, now) },
    },
  };
}

/**
 * A connected tool's result arrives. Where? brings its place and When? its day and time: they
 * become the plan's, since the host asked for them.
 */
export function attach(plan: Plan, tool: Connected, attachment: Attachment, now: number): Plan {
  let next: Plan = { ...plan, links: { ...plan.links, [tool]: attachment } };
  const details: Details = {};
  if (attachment.place) details.place = attachment.place;
  if (attachment.date) {
    details.date = attachment.date;
    details.time = attachment.time ?? plan.time;
  }
  if (Object.keys(details).length) next = setDetails(next, details, now);
  return next;
}

export function detach(plan: Plan, tool: Connected): Plan {
  const links = { ...plan.links };
  delete links[tool];
  return { ...plan, links };
}

/* ---------------- reading it ---------------- */

export type Headcount = { in: number; maybe: number; out: number; invited: number; total: number };

export function headcount(plan: Plan): Headcount {
  const count: Headcount = { in: 0, maybe: 0, out: 0, invited: 0, total: 0 };
  for (const person of peopleOf(plan)) {
    count[person.rsvp] += 1;
    if (person.rsvp !== 'out') count.total += 1;
  }
  return count;
}

/** "Saturday, October 17 · 7:30 PM", "Fri, Oct 16 – Sun, Oct 18", or '' before a day is set. */
export function whenLine(plan: Pick<Plan, 'date' | 'end' | 'time'>) {
  if (!plan.date) return '';
  const days = plan.end ? `${formatDay(plan.date)} – ${formatDay(plan.end)}` : longDay(plan.date);
  return plan.time >= 0 ? `${days} · ${formatTime(plan.time)}` : days;
}

const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** 'Saturday, October 17' */
export function longDay(date: string) {
  const [year, month, dayOfMonth] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return `${LONG_DAYS[weekday]}, ${LONG_MONTHS[month - 1]} ${dayOfMonth}`;
}

/** "Today", "Tomorrow", "In 5 days", "3 days ago": how far the day is from today. */
export function countdown(date: string, today: string) {
  if (!date) return '';
  const diff = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1) return diff < 14 ? `In ${diff} days` : `In ${Math.round(diff / 7)} weeks`;
  return `${-diff} days ago`;
}

/** Quick days to tap: this Friday, Saturday, Sunday, next Saturday (from today). */
export function quickDays(today: string) {
  const weekday = weekdayOf(today);
  const next = (target: number) => addDays(today, (target - weekday + 7) % 7);
  const friday = next(5);
  const saturday = next(6);
  const sunday = next(0);
  const picks = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Friday', date: friday },
    { label: 'Saturday', date: saturday },
    { label: 'Sunday', date: sunday },
    { label: 'Next Saturday', date: addDays(saturday, 7) },
  ];
  const seen = new Set<string>();
  return picks.filter((pick) => (seen.has(pick.date) ? false : (seen.add(pick.date), true)));
}

export const QUICK_TIMES = [
  { label: 'Noon', time: 720 },
  { label: '6 PM', time: 1080 },
  { label: '7 PM', time: 1140 },
  { label: '7:30 PM', time: 1170 },
  { label: '8 PM', time: 1200 },
  { label: '9 PM', time: 1260 },
];

/** Today, where the person is. */
export const todayHere = () => localDay(new Date());

/** The plan as a message for a group chat. */
export function planText(plan: Plan, link?: string) {
  const lines = [titleOf(plan)];
  const when = whenLine(plan);
  if (when) lines.push(when);
  if (plan.place) lines.push(plan.place.name);
  if (plan.note.trim()) lines.push('', plan.note.trim());
  if (link) lines.push('', `Are you in? ${link}`);
  return lines.join('\n');
}

export type { Place };
