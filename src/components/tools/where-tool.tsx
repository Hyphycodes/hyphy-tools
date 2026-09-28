'use client';
import { useCallback, useId, useState, type FormEvent } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { BASE_PATH } from '@/lib/base-path';
import { linkFor, newId } from '@/lib/share/link-state';
import { directionsUrl, linkSource, type Place } from '@/lib/tools/places';
import {
  addOption,
  castVote,
  editOption,
  MAX_OPTIONS,
  mergeWhere,
  newRound,
  pickOption,
  questionOf,
  removeOption,
  renameVoter,
  resultText,
  ROUND_KINDS,
  ROUND_LOOK,
  setDetails,
  tally,
  whereSchema,
  whereText,
  type RoundKind,
  type Vote,
  type WhereOption,
  type WhereRound,
} from '@/lib/tools/where';
import { PeopleStack } from './bring-art';
import { useGroupSession, type Received } from './group-session';
import {
  AskName,
  CombineLink,
  DeviceSessions,
  joinNames,
  LinkExtras,
  SendBackBar,
  SentMark,
  useSendLink,
  type SendResult,
} from './group-share';
import { ActionBar, ActionButton, Choices, MoreOptions, Note, Surface } from './kit';
import { PlaceArt } from './place-card';
import { PlanReturn, usePlanHandoff } from './plan-return';
import {
  AddPlace,
  NightSky,
  OptionCard,
  Standings,
  TicketButton,
  VOTE_LOOK,
  WinnerTicket,
} from './where-parts';

/*
 * Where?: "we want to go somewhere — where?" Ask the question, drop in a few places (type one,
 * paste a Maps or Yelp link, or tap an idea), send it to the group. Everyone taps Love it, Works
 * for me or Not this one and sends the link back; the bars show where it's going and a clear
 * favorite becomes a ticket with directions. The round lives in its link (lib/tools/where).
 */

const WHEN_IDEAS = ['Tonight', 'Tomorrow', 'Friday night', 'This weekend'];

/** What goes back to a Plan: the link, the winner (or how many places), the place itself. */
function handBack(round: WhereRound, link: string) {
  const lead = tally(round).leader;
  const count = round.options.length;
  return {
    url: link,
    summary: lead ? lead.option.name : `${count} ${count === 1 ? 'place' : 'places'} to vote on`,
    t: Date.now(),
    place: lead
      ? { name: lead.option.name, note: lead.option.note, url: lead.option.url }
      : undefined,
  };
}

/** What a link brought, in a line: who voted, what's new. */
function describeNews({ before, after }: Received<WhereRound>, meId: string | null) {
  if (!before) return null;
  const voted = Object.entries(after.votes)
    .filter(([id, voter]) => id !== meId && voter.t > (before.votes[id]?.t ?? -1))
    .map(([, voter]) => voter.name.trim() || 'Someone');
  const known = new Set(before.options.map((option) => option.id));
  const fresh = after.options.filter((option) => !known.has(option.id)).length;
  const parts = [
    voted.length
      ? `${joinNames(voted.slice(0, 4))}${voted.length > 4 ? ' and others' : ''} voted`
      : '',
    fresh ? `${fresh} new ${fresh === 1 ? 'place' : 'places'}` : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' · ')}.` : 'That link had nothing new.';
}

export function WhereTool() {
  const id = useId();
  const toast = useToast();
  const send = useSendLink();
  const handoff = usePlanHandoff();
  const [news, setNews] = useState<string | null>(null);
  const [kind, setKind] = useState<RoundKind>('eat');
  const [asking, setAsking] = useState<{ optionId: string; vote: Vote } | null>(null);
  const [naming, setNaming] = useState(false);
  const [votedNow, setVotedNow] = useState(false);
  const [openOption, setOpenOption] = useState<string | null>(null);
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [sent, setSent] = useState<{ round: WhereRound; how: 'shared' | 'copied' } | null>(null);

  const fresh = useCallback((roundId: string, now: number) => newRound(roundId, now), []);
  const session = useGroupSession<WhereRound>({
    key: 'hyphy.where.v1',
    schema: whereSchema,
    merge: mergeWhere,
    fresh,
    wrongLink:
      'This link doesn’t hold a Where? round, or part of it got cut off. Ask for it again.',
    onReceive: (received) => {
      setNews(describeNews(received, session.me?.id ?? null));
      setVotedNow(false);
    },
  });
  const { data: round, organizer, me, link, update } = session;

  const result = round ? tally(round) : null;
  const byOption = new Map(result?.standings.map((entry) => [entry.option.id, entry]) ?? []);
  const myPicks = (me && round?.votes[me.id]?.picks) || {};
  const options = round?.options ?? [];
  const activeKind = round?.kind ?? kind;
  const question = round
    ? questionOf(round)
    : handoff?.title
      ? `Where should we go for ${handoff.title}?`
      : ROUND_LOOK[kind].question;
  const lead = result?.leader ?? null;
  const picked = Boolean(round?.pick);
  const voters = Object.values(round?.votes ?? {})
    .filter((voter) => Object.keys(voter.picks).length)
    .map((voter) => voter.name.trim() || 'Someone');
  const canRemove = (option: WhereOption) => organizer || (me && option.by === me.id);

  /* ---------------- changes ---------------- */

  const add = (place: Place & { named: boolean }) => {
    const name = place.name.trim().toLowerCase();
    if (options.some((option) => option.name.trim().toLowerCase() === name)) {
      toast({ title: `${place.name} is already on here.`, icon: 'alert' });
      return;
    }
    if (options.length >= MAX_OPTIONS) {
      toast({ title: `A round holds ${MAX_OPTIONS} places. Remove one first.`, icon: 'alert' });
      return;
    }
    const optionId = newId(6);
    const by = organizer ? '' : (me?.id ?? '');
    update(
      (current, now) => {
        let base = current;
        // The first place settles what the round is about.
        if (!current.options.length && current.kind !== activeKind)
          base = setDetails(base, { kind: activeKind }, now);
        if (!current.options.length && !current.title && handoff?.title)
          base = setDetails(base, { title: question }, now);
        return addOption(base, place, optionId, by, now).round;
      },
      { create: true },
    );
    // A name guessed from a web address is worth a look: open the card to fix it.
    if (!place.named) setOpenOption(optionId);
  };

  const vote = (optionId: string, choice: Vote, who = me) => {
    if (!who?.name.trim()) {
      setAsking({ optionId, vote: choice });
      return;
    }
    update((current, now) => castVote(current, who, optionId, choice, now));
    if (!organizer) setVotedNow(true);
  };

  const saveName = (name: string) => {
    const who = session.setName(name);
    update((current, now) => renameVoter(current, who.id, who.name, now));
    return who;
  };

  const shareNow = async (text?: string): Promise<SendResult> => {
    if (!link || !round) return null;
    const outcome = await send(link, question, text ?? whereText(round));
    if (outcome === 'shared' || outcome === 'copied') setSent({ round, how: outcome });
    if (outcome === 'copied') toast({ title: 'Link copied. Paste it in the group chat.' });
    if (outcome === 'failed') toast({ title: 'Couldn’t share or copy here.', icon: 'alert' });
    return outcome;
  };

  const startNew = () => {
    session.startNew();
    setNews(null);
    setVotedNow(false);
    setSent(null);
    setEditingQuestion(false);
  };

  const toPlan = () => {
    if (!lead) return;
    const params = new URLSearchParams({ place: lead.option.name });
    if (lead.option.note) params.set('placeNote', lead.option.note);
    if (lead.option.url) params.set('placeUrl', lead.option.url);
    if (round?.when.trim()) params.set('when', round.when.trim());
    // A full navigation on purpose (see plan-return.tsx).
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`${BASE_PATH}/tools/plan?${params}`);
  };

  const openSheet = openOption ? options.find((option) => option.id === openOption) : undefined;
  const status = sent && round ? { how: sent.how, current: sent.round === round } : null;
  const hasVotes = Boolean(result && result.voters > 0);

  /* ---------------- the page ---------------- */

  return (
    <div
      className={cn(
        'grid gap-5',
        options.length
          ? 'lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,.85fr)] lg:items-start'
          : 'mx-auto w-full max-w-[860px]',
      )}
    >
      <div className="grid min-w-0 gap-4">
        {handoff && (
          <PlanReturn
            tool="where"
            ready={Boolean(lead)}
            attachment={async () => (round ? handBack(round, await linkFor(round)) : null)}
          />
        )}
        {session.problem && (
          <Note icon="alert" tone="caution">
            {session.problem}
          </Note>
        )}
        {news && (
          <Note icon="refresh" tone="positive">
            {news}
          </Note>
        )}

        <section
          aria-labelledby={`${id}-question`}
          className="relative isolate min-w-0 rounded-[30px] bg-surface p-2 shadow-lift sm:p-2.5"
        >
          <NightSky>
            <p className="text-[12px] font-bold tracking-[.16em] text-[#ffc9b0] uppercase">
              {round?.when.trim() || (organizer ? 'Where?' : 'You’re invited to vote')}
            </p>
            {editingQuestion && organizer ? (
              <QuestionEditor
                initial={question}
                onDone={(text) => {
                  update((current, now) => setDetails(current, { title: text }, now), {
                    create: true,
                  });
                  setEditingQuestion(false);
                }}
              />
            ) : (
              <h2
                id={`${id}-question`}
                className="mt-2 max-w-[18ch] font-display text-[34px] leading-[.98] font-extrabold tracking-[-0.035em] text-balance sm:text-[48px]"
                style={{ fontVariationSettings: "'wdth' 112" }}
              >
                {organizer ? (
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(true)}
                    className="group text-left"
                    aria-label={`${question} (change the question)`}
                  >
                    {question}
                    <Icon
                      name="pencil"
                      size={18}
                      className="ml-2 inline-block align-middle text-[#ffc9b0] opacity-60 group-hover:opacity-100"
                    />
                  </button>
                ) : (
                  question
                )}
              </h2>
            )}
            {voters.length > 0 && (
              <div className="mt-4 flex items-center gap-2.5">
                <PeopleStack names={voters} size={28} />
                <p className="text-[13.5px] text-[#fff4ea]/80">
                  {voters.length} {voters.length === 1 ? 'vote' : 'votes'} so far
                </p>
              </div>
            )}
          </NightSky>

          <div className="grid gap-5 px-2.5 pt-5 pb-3 sm:px-4 sm:pb-4">
            {organizer && !options.length && (
              <Choices
                label="What kind of place?"
                value={activeKind}
                scroll
                options={ROUND_KINDS.filter((entry) => entry !== 'any').map((entry) => ({
                  value: entry,
                  label: ROUND_LOOK[entry].label,
                }))}
                onChange={(next) => {
                  setKind(next);
                  if (round) update((current, now) => setDetails(current, { kind: next }, now));
                }}
              />
            )}

            {options.length > 0 ? (
              <>
                {!hasVotes && (
                  <p className="text-center text-[14px] text-muted">
                    Tap <Icon name="heart" size={13} className="inline align-[-2px]" /> on the
                    places you’d love. Tap a card for its details.
                  </p>
                )}
                <ul
                  className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3"
                  aria-label="The places"
                >
                  {options.map((option, index) => (
                    <OptionCard
                      key={option.id}
                      option={option}
                      index={index}
                      standing={byOption.get(option.id)}
                      mine={myPicks[option.id]}
                      leading={
                        !picked && lead?.option.id === option.id && result?.state === 'clear'
                      }
                      picked={round?.pick === option.id}
                      onVote={(choice) => vote(option.id, choice)}
                      onOpen={() => setOpenOption(option.id)}
                    />
                  ))}
                </ul>
              </>
            ) : (
              <EmptyPlaces />
            )}

            {(organizer || suggesting) && (
              <AddPlace
                kind={activeKind}
                taken={options.map((option) => option.name)}
                full={options.length >= MAX_OPTIONS}
                compact={options.length >= 4}
                onAdd={add}
              />
            )}
            {!organizer && !suggesting && options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={() => setSuggesting(true)}
                className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14.5px] font-medium text-[var(--accent-ink)] hover:bg-signal-soft"
              >
                <Icon name="plus" size={16} /> Suggest a place
              </button>
            )}

            {organizer && options.length > 0 && (
              <WhenChips
                value={round?.when ?? ''}
                onChange={(text) =>
                  update((current, now) => setDetails(current, { when: text }, now))
                }
              />
            )}

            {organizer && options.length >= 2 && (
              <ActionBar className="lg:hidden">
                <ActionButton icon="send" disabled={!link} onClick={() => void shareNow()}>
                  {status?.current ? 'Sent · send again' : 'Send this to the group'}
                </ActionButton>
              </ActionBar>
            )}
          </div>
        </section>
      </div>

      {options.length > 0 && round && result && (
        <aside aria-label="The vote" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
          {lead && result.state !== 'none' && (
            <WinnerTicket
              standing={lead}
              voters={result.voters}
              picked={picked}
              close={result.state === 'close' && !picked}
            >
              <TicketButton icon="navigation" href={directionsUrl(lead.option)} primary>
                Open directions
              </TicketButton>
              <div className="grid grid-cols-2 gap-2">
                <TicketButton icon="share" onClick={() => void shareNow(resultText(round, result))}>
                  Share result
                </TicketButton>
                {handoff ? (
                  <TicketButton icon="check" onClick={() => setOpenOption(lead.option.id)}>
                    Details
                  </TicketButton>
                ) : (
                  <TicketButton icon="party" onClick={toPlan}>
                    Add to Plan
                  </TicketButton>
                )}
              </div>
              {organizer && (
                <button
                  type="button"
                  onClick={() =>
                    update((current, now) => pickOption(current, picked ? '' : lead.option.id, now))
                  }
                  className="mx-auto mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-[#fff4ea]/80 hover:bg-white/10 hover:text-[#fff4ea]"
                >
                  <Icon name={picked ? 'undo' : 'check'} size={15} />
                  {picked ? 'Keep voting' : 'Lock it in'}
                </button>
              )}
            </WinnerTicket>
          )}

          {result.state === 'tie' && !picked && (
            <Surface className="grid gap-2 text-center">
              <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
                It’s a tie
              </p>
              <p className="text-[14px] text-muted">
                {joinNames(
                  result.standings
                    .filter((entry) => entry.points === result.standings[0].points)
                    .map((entry) => entry.option.name),
                )}{' '}
                are level.{' '}
                {organizer
                  ? 'Break it by locking one in from its card.'
                  : 'One more vote settles it.'}
              </p>
            </Surface>
          )}

          {organizer ? (
            <section
              aria-labelledby={`${id}-send`}
              className="relative grid gap-4 overflow-hidden rounded-[24px] bg-surface px-5 pt-6 pb-5 shadow-lift"
            >
              <h2 id={`${id}-send`} className="sr-only">
                Send this to the group
              </h2>
              {status?.current ? (
                <SentMark
                  key={status.how}
                  title={status.how === 'shared' ? 'Sent' : 'Link copied'}
                  line="Open the links people send back here and their votes land on the cards."
                />
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    {options.slice(0, 3).map((option) => (
                      <PlaceArt
                        key={option.id}
                        name={option.name}
                        kind={option.kind}
                        pin="sm"
                        className="size-12 rounded-[14px] shadow-[0_0_0_2.5px_var(--color-surface)]"
                      />
                    ))}
                  </div>
                  <div className="min-w-0">
                    <p className="font-display text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink">
                      Send this to the group
                    </p>
                    <p className="text-[13.5px] text-muted">
                      No sign-up. They tap, vote and send it back.
                    </p>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                {status && !status.current && (
                  <p className="flex items-center justify-center gap-1.5 text-[13px] text-ink-2">
                    <Icon name="refresh" size={13} className="text-muted" /> Changed since you sent
                    it
                  </p>
                )}
                <ActionButton
                  icon="send"
                  disabled={!link || options.length < 2}
                  onClick={() => void shareNow()}
                >
                  {options.length < 2
                    ? 'Add one more place'
                    : !link
                      ? 'Getting the link…'
                      : status?.current
                        ? 'Send it again'
                        : status
                          ? 'Send the update'
                          : 'Send this to the group'}
                </ActionButton>
                <LinkExtras link={link} text={whereText(round, link ?? undefined)} />
              </div>
            </section>
          ) : (
            Object.keys(myPicks).length > 0 && (
              <section className="grid gap-3 rounded-[24px] bg-surface px-5 pt-6 pb-5 shadow-lift">
                {status?.current ? (
                  <SentMark
                    key={status.how}
                    title={status.how === 'shared' ? 'Sent back' : 'Link copied'}
                    line="Your votes travel with the link: whoever opens it sees them."
                  />
                ) : (
                  <div className="text-center">
                    <p className="label">Your votes</p>
                    <p className="mt-1.5 text-[15.5px] leading-snug text-ink">
                      {Object.entries(myPicks)
                        .map(([optionId, choice]) => {
                          const option = options.find((entry) => entry.id === optionId);
                          return option ? `${VOTE_LOOK[choice].short} ${option.name}` : '';
                        })
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                )}
                <ActionButton icon="send" disabled={!link} onClick={() => void shareNow()}>
                  {status?.current ? 'Send it again' : 'Send your votes back'}
                </ActionButton>
              </section>
            )
          )}

          {hasVotes && (
            <Surface className="grid gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-ink">
                  How it’s looking
                </h2>
                <span className="text-[13px] text-muted">
                  {result.voters} {result.voters === 1 ? 'person' : 'people'} voted
                </span>
              </div>
              <Standings result={result} />
            </Surface>
          )}

          <SessionsAndMore
            session={session}
            onStartNew={startNew}
            onRename={() => setNaming(true)}
          />
        </aside>
      )}

      {!options.length && session.store.sessions.length > 0 && (
        <SessionsAndMore session={session} onStartNew={startNew} onRename={() => setNaming(true)} />
      )}

      {!organizer && votedNow && round && (
        <SendBackBar
          message="Your votes are in. Send them back so they count."
          link={link}
          cta="Send my votes back"
          onSend={() => shareNow()}
          onDone={() => setVotedNow(false)}
        />
      )}

      <OptionSheet
        option={openSheet}
        canRemove={Boolean(openSheet && canRemove(openSheet))}
        canEdit={Boolean(openSheet && (organizer || openSheet.by === me?.id))}
        organizer={organizer}
        isPick={Boolean(openSheet && round?.pick === openSheet.id)}
        onEdit={(change) =>
          openSheet && update((current, now) => editOption(current, openSheet.id, change, now))
        }
        onRemove={() => {
          if (!openSheet) return;
          update((current, now) => removeOption(current, openSheet.id, now));
          setOpenOption(null);
          toast({ title: `Removed ${openSheet.name}` });
        }}
        onPick={() =>
          openSheet &&
          update((current, now) =>
            pickOption(current, round?.pick === openSheet.id ? '' : openSheet.id, now),
          )
        }
        onClose={() => setOpenOption(null)}
      />

      <AskName
        open={Boolean(asking) || naming}
        lead={asking ? 'So the group knows whose vote this is. No sign-up.' : undefined}
        initial={me?.name ?? ''}
        cta={asking ? 'Vote' : 'Save'}
        onName={(name) => {
          const who = saveName(name);
          if (asking) vote(asking.optionId, asking.vote, who);
          setAsking(null);
          setNaming(false);
        }}
        onClose={() => {
          setAsking(null);
          setNaming(false);
        }}
      />
    </div>
  );
}

/* ---------------- pieces ---------------- */

function EmptyPlaces() {
  return (
    <div className="grid justify-items-center gap-3 py-2 text-center">
      <div className="flex -space-x-4" aria-hidden="true">
        {['Tacos', 'Rooftop bar', 'The park'].map((name, index) => (
          <PlaceArt
            key={name}
            name={name}
            pin="sm"
            className={cn(
              'size-16 rounded-[18px] opacity-80 shadow-[0_0_0_3px_var(--color-surface)]',
              index === 1 && '-translate-y-2 rotate-3',
              index === 0 && '-rotate-6',
              index === 2 && 'rotate-6',
            )}
          />
        ))}
      </div>
      <p className="font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink">
        Add somewhere you’d actually go.
      </p>
      <p className="max-w-[36ch] text-[14.5px] text-muted">
        Type a name, paste a Google Maps or Yelp link, or tap an idea. Two or three is plenty.
      </p>
    </div>
  );
}

function QuestionEditor({ initial, onDone }: { initial: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onDone(text.trim());
  };
  return (
    <form onSubmit={submit} className="mt-2 flex gap-2">
      <label htmlFor="where-question" className="sr-only">
        The question
      </label>
      <input
        id="where-question"
        autoFocus
        value={text}
        maxLength={80}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onDone(text.trim())}
        className="h-14 min-w-0 flex-1 rounded-[16px] bg-white/10 px-4 font-display text-[22px] font-bold text-[#fff4ea] outline-none placeholder:text-[#fff4ea]/50 focus:bg-white/15 sm:text-[26px]"
      />
      <button
        type="submit"
        className="h-14 shrink-0 rounded-[16px] bg-[#fff4ea] px-4 text-[15px] font-semibold text-[#2a1420]"
      >
        Done
      </button>
    </form>
  );
}

function WhenChips({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  return (
    <MoreOptions
      label="When is it?"
      summary={value || 'Optional'}
      defaultOpen={Boolean(value)}
      className="border-t border-line pt-2"
    >
      <div className="grid gap-2.5">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="When">
          {WHEN_IDEAS.map((idea) => {
            const on = value === idea;
            return (
              <button
                key={idea}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(on ? '' : idea)}
                className={cn(
                  'min-h-10 rounded-full px-3.5 text-[14px] font-medium transition-colors',
                  on
                    ? 'text-[var(--on-accent,#12110d)]'
                    : 'bg-ink/[.05] text-ink-2 hover:bg-ink/10',
                )}
                style={on ? { background: 'var(--accent)' } : undefined}
              >
                {idea}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCustom(true)}
            className="min-h-10 rounded-full bg-ink/[.05] px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
          >
            Something else
          </button>
        </div>
        {(custom || (value && !WHEN_IDEAS.includes(value))) && (
          <div>
            <label htmlFor={`${id}-when`} className="sr-only">
              When, in a few words
            </label>
            <Input
              id={`${id}-when`}
              value={value}
              maxLength={60}
              placeholder="Saturday after the game"
              onChange={(event) => onChange(event.target.value)}
            />
          </div>
        )}
      </div>
    </MoreOptions>
  );
}

function OptionSheet({
  option,
  canRemove,
  canEdit,
  organizer,
  isPick,
  onEdit,
  onRemove,
  onPick,
  onClose,
}: {
  option: WhereOption | undefined;
  canRemove: boolean;
  canEdit: boolean;
  organizer: boolean;
  isPick: boolean;
  onEdit: (change: Partial<Pick<WhereOption, 'name' | 'note' | 'url'>>) => void;
  onRemove: () => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const id = useId();
  return (
    <Sheet open={Boolean(option)} onClose={onClose} width="sm" title={option?.name ?? 'Place'}>
      {option && (
        <div className="grid gap-4">
          <PlaceArt
            name={option.name}
            kind={option.kind}
            pin="lg"
            className="h-36 rounded-[20px]"
          />
          {canEdit ? (
            <div className="grid gap-3">
              <Field label="Name" htmlFor={`${id}-name`}>
                <Input
                  id={`${id}-name`}
                  defaultValue={option.name}
                  maxLength={60}
                  onBlur={(event) =>
                    event.target.value.trim() && onEdit({ name: event.target.value })
                  }
                />
              </Field>
              <Field label="A few words" htmlFor={`${id}-note`} optional>
                <Input
                  id={`${id}-note`}
                  defaultValue={option.note}
                  maxLength={60}
                  placeholder="Italian · West Loop"
                  onBlur={(event) => onEdit({ note: event.target.value })}
                />
              </Field>
            </div>
          ) : (
            option.note && <p className="text-[15px] text-ink-2">{option.note}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={directionsUrl(option)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-ink text-[15px] font-semibold text-on-ink"
            >
              <Icon name="navigation" size={16} /> Directions
            </a>
            {option.url ? (
              <a
                href={option.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-well text-[15px] font-semibold text-ink-2"
              >
                <Icon name="external" size={16} /> {linkSource(option.url) || 'Open link'}
              </a>
            ) : (
              <span />
            )}
          </div>
          {organizer && (
            <button
              type="button"
              onClick={onPick}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] text-[15px] font-semibold text-[var(--on-accent,#12110d)]"
              style={{ background: 'var(--accent)' }}
            >
              <Icon name={isPick ? 'undo' : 'check'} size={16} />
              {isPick ? 'Unpick it' : 'Make this the pick'}
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-muted hover:bg-critical-soft hover:text-critical"
            >
              <Icon name="trash" size={15} /> Remove {option.name}
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

function SessionsAndMore({
  session,
  onStartNew,
  onRename,
}: {
  session: ReturnType<typeof useGroupSession<WhereRound>>;
  onStartNew: () => void;
  onRename: () => void;
}) {
  const { store, data, organizer, me } = session;
  return (
    <>
      {store.sessions.length > (data ? 1 : 0) && (
        <DeviceSessions
          title="Your rounds"
          current={store.current}
          newLabel="New round"
          items={store.sessions.map((entry) => ({
            id: entry.data.id,
            title: questionOf(entry.data),
            line: `${entry.role === 'organizer' ? 'You started it' : 'Shared with you'} · ${entry.data.options.length} places · ${tally(entry.data).voters} voted`,
          }))}
          onOpen={session.open}
          onForget={(roundId) => {
            const entry = store.sessions.find((item) => item.data.id === roundId);
            if (
              window.confirm(
                `Remove “${entry ? questionOf(entry.data) : 'this round'}” from this device? Everyone else keeps theirs.`,
              )
            )
              session.forget(roundId);
          }}
          onStartNew={onStartNew}
        />
      )}
      {data && (
        <Surface className="!py-2">
          <MoreOptions
            label="More"
            summary={me?.name.trim() ? `You’re ${me.name.trim()}` : undefined}
          >
            <div className="grid gap-4 pb-3">
              <CombineLink
                onCombine={async (text) => {
                  const outcome = await session.combine(text);
                  return 'error' in outcome ? outcome : { done: 'Combined.' };
                }}
              />
              <div className="flex flex-wrap gap-2">
                {me?.name.trim() && (
                  <button
                    type="button"
                    onClick={onRename}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
                  >
                    <Icon name="user" size={15} /> Change my name
                  </button>
                )}
                {!organizer && (
                  <button
                    type="button"
                    onClick={session.adopt}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
                  >
                    <Icon name="pencil" size={15} /> I’m organizing this
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStartNew}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
                >
                  <Icon name="plus" size={15} /> New round
                </button>
              </div>
            </div>
          </MoreOptions>
        </Surface>
      )}
    </>
  );
}
