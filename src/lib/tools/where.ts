import * as z from 'zod/mini';
import { bump, distinctIds, idSchema, MAX_REMOVED, mergeEntries, stampSchema } from './claims';
import { PLACE_KINDS, placeKind, type Place } from './places';

/*
 * Where?: "we want to go somewhere — where?" A round is a question, a few places as cards and
 * everyone's votes. It lives in its link: people vote, send the link back, and copies merge:
 *
 * - Places: every place either copy has, matched by id; the later edit wins; removed stays gone.
 * - Votes: one record per person (their device id), the later change wins.
 * - The pick: the organizer can settle it; the later pick (or un-pick) wins.
 *
 * A vote is Love it (2), Works for me (1) or Not this one (0, and it's counted as a no). The place
 * with the most points leads; fewer no's break a tie. Pure and tested (tests/lib-where.spec.ts).
 */

export const MAX_OPTIONS = 16;
export const MAX_VOTERS = 40;

export const ROUND_KINDS = ['eat', 'drinks', 'coffee', 'do', 'date', 'trip', 'any'] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const ROUND_LOOK: Record<RoundKind, { label: string; question: string }> = {
  eat: { label: 'Eat', question: 'Where should we eat?' },
  drinks: { label: 'Drinks', question: 'Where should we get drinks?' },
  coffee: { label: 'Coffee', question: 'Where should we get coffee?' },
  do: { label: 'Something to do', question: 'What should we do?' },
  date: { label: 'Date night', question: 'Where should we go for date night?' },
  trip: { label: 'A trip', question: 'Where should we go?' },
  any: { label: 'Anywhere', question: 'Where should we go?' },
};

/** Tap-to-add ideas, so the first cards cost no typing. */
export const IDEAS: Record<RoundKind, string[]> = {
  eat: ['Tacos', 'Sushi', 'Pizza', 'Thai', 'Burgers', 'Italian', 'Ramen', 'Korean BBQ'],
  drinks: ['Rooftop bar', 'Wine bar', 'Brewery', 'Cocktail lounge', 'Dive bar', 'Beer garden'],
  coffee: ['Café nearby', 'Bakery café', 'Tea house', 'Brunch spot'],
  do: ['Bowling', 'Movies', 'Mini golf', 'Museum', 'Karaoke', 'Escape room', 'The park'],
  date: ['Wine bar', 'Italian', 'Comedy show', 'Sushi', 'Jazz club', 'Cocktails'],
  trip: ['Beach', 'Mountains', 'A new city', 'Road trip', 'Lake house', 'Camping'],
  any: ['Dinner out', 'Drinks', 'A movie', 'The park', 'Bowling', 'Coffee'],
};

export const VOTES = ['love', 'ok', 'no'] as const;
export type Vote = (typeof VOTES)[number];
export const VOTE_POINTS: Record<Vote, number> = { love: 2, ok: 1, no: 0 };

export const optionSchema = z.object({
  id: idSchema,
  name: z.string().check(z.minLength(1), z.maxLength(60)),
  note: z.string().check(z.maxLength(60)),
  url: z.string().check(z.maxLength(600)),
  kind: z.enum(PLACE_KINDS),
  /** Who added it: a device id, or '' for the organizer's first cards. */
  by: z.string().check(z.maxLength(24)),
  updated: stampSchema,
});
export type WhereOption = z.infer<typeof optionSchema>;

export const voterSchema = z.object({
  name: z.string().check(z.maxLength(40)),
  t: stampSchema,
  picks: z.record(idSchema, z.enum(VOTES)),
});
export type Voter = z.infer<typeof voterSchema>;

export const whereSchema = z
  .object({
    v: z.literal(1),
    id: idSchema,
    kind: z.enum(ROUND_KINDS),
    title: z.string().check(z.maxLength(80)),
    /** When it's for, in the organizer's words: "Friday night". */
    when: z.string().check(z.maxLength(60)),
    edited: stampSchema,
    options: z.array(optionSchema).check(z.maxLength(MAX_OPTIONS)),
    removed: z.array(idSchema).check(z.maxLength(MAX_REMOVED)),
    votes: z
      .record(idSchema, voterSchema)
      .check(z.refine((votes) => Object.keys(votes).length <= MAX_VOTERS, 'Too many voters')),
    /** The organizer settled it: an option id, or '' for not yet. */
    pick: z.string().check(z.maxLength(24)),
    pickedAt: stampSchema,
  })
  .check(z.refine((round) => distinctIds(round.options), 'Each place needs its own id'));
export type WhereRound = z.infer<typeof whereSchema>;

export function newRound(id: string, now: number, kind: RoundKind = 'eat'): WhereRound {
  return {
    v: 1,
    id,
    kind,
    title: '',
    when: '',
    edited: now,
    options: [],
    removed: [],
    votes: {},
    pick: '',
    pickedAt: 0,
  };
}

/** The question on the card: the organizer's words, or the kind's. */
export const questionOf = (round: Pick<WhereRound, 'title' | 'kind'>) =>
  round.title.trim() || ROUND_LOOK[round.kind].question;

/* ---------------- merging ---------------- */

export function mergeWhere(a: WhereRound, b: WhereRound): WhereRound {
  const newer = b.edited > a.edited ? b : a;
  const { items, removed } = mergeEntries(
    { edited: a.edited, items: a.options, removed: a.removed },
    { edited: b.edited, items: b.options, removed: b.removed },
    MAX_OPTIONS,
  );
  const live = new Set(items.map((option) => option.id));
  const votes: Record<string, Voter> = {};
  for (const id of new Set([...Object.keys(a.votes), ...Object.keys(b.votes)])) {
    const mine = a.votes[id];
    const theirs = b.votes[id];
    const winner =
      !mine || (theirs && (theirs.t > mine.t || (theirs.t === mine.t && theirs.name > mine.name)))
        ? theirs
        : mine;
    votes[id] = {
      ...winner,
      picks: Object.fromEntries(
        Object.entries(winner.picks).filter(([option]) => live.has(option)),
      ),
    };
  }
  const picked = b.pickedAt > a.pickedAt ? b : a;
  return {
    v: 1,
    id: a.id,
    kind: newer.kind,
    title: newer.title,
    when: newer.when,
    edited: Math.max(a.edited, b.edited),
    options: items,
    removed,
    votes: Object.fromEntries(Object.entries(votes).slice(0, MAX_VOTERS)),
    pick: picked.pick && live.has(picked.pick) ? picked.pick : '',
    pickedAt: picked.pickedAt,
  };
}

/* ---------------- changes ---------------- */

export function setDetails(
  round: WhereRound,
  details: Partial<Pick<WhereRound, 'kind' | 'title' | 'when'>>,
  now: number,
): WhereRound {
  return {
    ...round,
    kind: details.kind ?? round.kind,
    title: (details.title ?? round.title).slice(0, 80),
    when: (details.when ?? round.when).slice(0, 60),
    edited: bump(round.edited, now),
  };
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Add a place (anyone can). The same name twice is the same place; the round holds 16. */
export function addOption(
  round: WhereRound,
  place: Place,
  id: string,
  by: string,
  now: number,
): { round: WhereRound; added: WhereOption | null; reason?: 'full' | 'twin' } {
  const name = place.name.trim().slice(0, 60);
  if (!name) return { round, added: null };
  if (round.options.some((option) => sameName(option.name, name)))
    return { round, added: null, reason: 'twin' };
  if (round.options.length >= MAX_OPTIONS) return { round, added: null, reason: 'full' };
  if (round.options.some((option) => option.id === id) || round.removed.includes(id))
    return { round, added: null };
  const added: WhereOption = {
    id,
    name,
    note: place.note.trim().slice(0, 60),
    url: place.url.slice(0, 600),
    kind: placeKind(name, place.note),
    by,
    updated: now,
  };
  return {
    round: { ...round, options: [...round.options, added], edited: bump(round.edited, now) },
    added,
  };
}

export function editOption(
  round: WhereRound,
  optionId: string,
  change: Partial<Pick<WhereOption, 'name' | 'note' | 'url'>>,
  now: number,
): WhereRound {
  return {
    ...round,
    edited: bump(round.edited, now),
    options: round.options.map((option) => {
      if (option.id !== optionId) return option;
      const name = (change.name ?? option.name).trim().slice(0, 60) || option.name;
      const note = (change.note ?? option.note).trim().slice(0, 60);
      return {
        ...option,
        name,
        note,
        url: (change.url ?? option.url).slice(0, 600),
        kind: placeKind(name, note),
        updated: bump(option.updated, now),
      };
    }),
  };
}

export function removeOption(round: WhereRound, optionId: string, now: number): WhereRound {
  if (!round.options.some((option) => option.id === optionId)) return round;
  return {
    ...round,
    options: round.options.filter((option) => option.id !== optionId),
    removed: [...round.removed.filter((id) => id !== optionId), optionId].slice(-MAX_REMOVED),
    votes: Object.fromEntries(
      Object.entries(round.votes).map(([id, voter]) => [
        id,
        {
          ...voter,
          picks: Object.fromEntries(
            Object.entries(voter.picks).filter(([option]) => option !== optionId),
          ),
        },
      ]),
    ),
    pick: round.pick === optionId ? '' : round.pick,
    edited: bump(round.edited, now),
  };
}

/** Someone's vote on a place; the same vote again takes it back. */
export function castVote(
  round: WhereRound,
  voter: { id: string; name: string },
  optionId: string,
  vote: Vote,
  now: number,
): WhereRound {
  if (!round.options.some((option) => option.id === optionId)) return round;
  const record = round.votes[voter.id];
  if (!record && Object.keys(round.votes).length >= MAX_VOTERS) return round;
  const picks = { ...record?.picks };
  if (picks[optionId] === vote) delete picks[optionId];
  else picks[optionId] = vote;
  return {
    ...round,
    votes: {
      ...round.votes,
      [voter.id]: { name: voter.name.slice(0, 40), t: bump(record?.t ?? 0, now), picks },
    },
  };
}

/** A name fixed on this device shows on its votes too. */
export function renameVoter(round: WhereRound, voterId: string, name: string, now: number) {
  const record = round.votes[voterId];
  if (!record || record.name === name) return round;
  return {
    ...round,
    votes: {
      ...round.votes,
      [voterId]: { ...record, name: name.slice(0, 40), t: bump(record.t, now) },
    },
  };
}

/** The organizer settles it (or takes the pick back with ''). */
export function pickOption(round: WhereRound, optionId: string, now: number): WhereRound {
  if (optionId && !round.options.some((option) => option.id === optionId)) return round;
  return { ...round, pick: optionId, pickedAt: bump(round.pickedAt, now) };
}

/* ---------------- the result ---------------- */

export type Standing = {
  option: WhereOption;
  love: number;
  ok: number;
  no: number;
  /** love + ok: the people who'd go. */
  yes: number;
  points: number;
  /** Who voted on it, by name, love first. */
  names: { name: string; vote: Vote }[];
};

export type Tally = {
  standings: Standing[];
  /** People who voted on anything. */
  voters: number;
  /** The place in front, when there is one. */
  leader: Standing | null;
  /** 'none' before votes; 'tie' when the top two are level; 'close' by one point; 'clear'. */
  state: 'none' | 'tie' | 'close' | 'clear';
};

export function tally(round: WhereRound): Tally {
  const voters = Object.values(round.votes).filter((voter) => Object.keys(voter.picks).length);
  const standings = round.options.map((option, order) => {
    const standing: Standing & { order: number } = {
      option,
      love: 0,
      ok: 0,
      no: 0,
      yes: 0,
      points: 0,
      names: [],
      order,
    };
    for (const voter of voters) {
      const vote = voter.picks[option.id];
      if (!vote) continue;
      standing[vote] += 1;
      standing.points += VOTE_POINTS[vote];
      standing.names.push({ name: voter.name.trim() || 'Someone', vote });
    }
    standing.yes = standing.love + standing.ok;
    standing.names.sort((a, b) => VOTE_POINTS[b.vote] - VOTE_POINTS[a.vote]);
    return standing;
  });
  standings.sort((a, b) => b.points - a.points || a.no - b.no || a.order - b.order);
  const [first, second] = standings;
  const picked = round.pick ? standings.find((entry) => entry.option.id === round.pick) : null;
  let state: Tally['state'] = 'none';
  if (first && first.points > 0) {
    if (second && second.points === first.points && second.no === first.no) state = 'tie';
    else if (second && first.points - second.points <= 1 && voters.length > 1) state = 'close';
    else state = 'clear';
  }
  return {
    standings: standings.map((entry) => ({
      option: entry.option,
      love: entry.love,
      ok: entry.ok,
      no: entry.no,
      yes: entry.yes,
      points: entry.points,
      names: entry.names,
    })),
    voters: voters.length,
    leader: picked ?? (state === 'none' || state === 'tie' ? null : first),
    state: picked ? 'clear' : state,
  };
}

/** The round as text for a group chat. */
export function whereText(round: WhereRound, link?: string) {
  const lines = [questionOf(round)];
  if (round.when.trim()) lines.push(round.when.trim());
  lines.push('', ...round.options.map((option) => `• ${option.name}`));
  if (link) lines.push('', `Vote here: ${link}`);
  return lines.join('\n');
}

/** The result as text: the winner and the count. */
export function resultText(round: WhereRound, result: Tally, link?: string) {
  const leader = result.leader;
  if (!leader) return whereText(round, link);
  const lines = [
    `${questionOf(round)} → ${leader.option.name}`,
    `${leader.yes} of ${result.voters} are in`,
  ];
  if (link) lines.push('', link);
  return lines.join('\n');
}
