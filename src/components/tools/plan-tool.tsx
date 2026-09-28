'use client';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { takeAttachments, toolForPlan, type Connected } from '@/lib/share/handoff';
import { newId } from '@/lib/share/link-state';
import { directionsUrl, type Place } from '@/lib/tools/places';
import {
  addPeople,
  answer,
  attach,
  detach,
  headcount,
  mergePlan,
  newPlan,
  PLAN_KINDS,
  PLAN_LOOK,
  peopleOf,
  planSchema,
  planText,
  removePerson,
  renamePerson,
  setDetails,
  titleOf,
  todayHere,
  whenLine,
  type Plan,
  type PlanKind,
  type Rsvp,
} from '@/lib/tools/plan';
import { PersonDot } from './bring-art';
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
import { forgetHandoff } from './plan-return';
import { ActionBar, ActionButton, ChoiceCards, MoreOptions, Note, Surface } from './kit';
import {
  InviteCard,
  Module,
  PeopleEditor,
  Phase,
  PlaceEditor,
  RSVP_WORD,
  RsvpButtons,
  Sky,
  WhenEditor,
} from './plan-parts';

/*
 * Plan: the shared card for something people are doing together. Start from what it is, name
 * it, and add the day, the place and the people only if you know them. The plan is an
 * invitation; under it, the few things around it on a light timeline — find a time (When?),
 * choose a place (Where?), what to bring (Bring), and after, split the bill (Split). Guests say
 * if they're in without an account and send the link back. It lives in its link (lib/tools/plan).
 */

type Step = 'kind' | 'name' | 'when' | 'where' | 'who' | 'done';
type Editing = 'when' | 'where' | 'title' | 'note' | 'people' | null;

const noop = () => () => {};
const TOOL_NAME: Record<Connected, string> = {
  when: 'When?',
  where: 'Where?',
  bring: 'Bring',
  split: 'Split',
};

function describeNews({ before, after }: Received<Plan>, meId: string | null) {
  if (!before) return null;
  const said: string[] = [];
  for (const [id, person] of Object.entries(after.people)) {
    if (id === meId || person.as || person.gone || person.rsvp === 'invited') continue;
    const was = before.people[id];
    if (was && was.t >= person.t) continue;
    if (was?.rsvp === person.rsvp) continue;
    said.push(
      person.rsvp === 'in'
        ? `${person.name} is in`
        : person.rsvp === 'maybe'
          ? `${person.name} is a maybe`
          : `${person.name} can’t make it`,
    );
  }
  if (after.edited > before.edited) said.push('the plan changed');
  if (!said.length) return 'That link had nothing new.';
  const line = joinNames(said.slice(0, 4));
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

export function PlanTool() {
  const id = useId();
  const toast = useToast();
  const router = useRouter();
  const send = useSendLink();
  const today = useSyncExternalStore(noop, todayHere, () => '');
  const [news, setNews] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('kind');
  const [draft, setDraft] = useState<{ kind: PlanKind; title: string }>({
    kind: 'dinner',
    title: '',
  });
  const [prefill, setPrefill] = useState<Place | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [asking, setAsking] = useState<Exclude<Rsvp, 'invited'> | null>(null);
  const [naming, setNaming] = useState(false);
  const [answeredNow, setAnsweredNow] = useState(false);
  const [sent, setSent] = useState<{ plan: Plan; how: 'shared' | 'copied' } | null>(null);
  const meRef = useRef<string | null>(null);

  const fresh = useCallback((planId: string, now: number) => newPlan(planId, now), []);
  const session = useGroupSession<Plan>({
    key: 'hyphy.plan.v1',
    schema: planSchema,
    merge: mergePlan,
    fresh,
    wrongLink: 'This link doesn’t hold a plan, or part of it got cut off. Ask for it again.',
    onReceive: (received) => {
      setNews(describeNews(received, meRef.current));
      setAnsweredNow(false);
    },
  });
  const { data: plan, organizer, me, link, update } = session;
  useEffect(() => {
    meRef.current = me?.id ?? null;
  }, [me]);

  // Arriving from another tool: open the plan it was for (`?open=`), or start one with the
  // place Where? picked (`?place=`). Then the address is tidied.
  const arrived = useRef(false);
  useEffect(() => {
    if (!session.ready || arrived.current) return;
    arrived.current = true;
    forgetHandoff();
    const params = new URLSearchParams(window.location.search);
    const open = params.get('open');
    const place = params.get('place');
    if (open && session.store.sessions.some((entry) => entry.data.id === open)) session.open(open);
    if (place && !open) {
      session.startNew();
      // Reading the address is this effect's job: it runs once, on arrival.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefill({
        name: place.slice(0, 60),
        note: (params.get('placeNote') ?? '').slice(0, 60),
        url: (params.get('placeUrl') ?? '').slice(0, 600),
      });
      setStep('kind');
    }
    if (open || place)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`);
  }, [session]);

  // What connected tools left for this plan in this browser (lib/share/handoff).
  const planId = plan?.id;
  useEffect(() => {
    if (!planId) return;
    const waiting = takeAttachments(planId);
    const tools = Object.keys(waiting) as Connected[];
    if (!tools.length) return;
    update((current, now) =>
      tools.reduce((next, tool) => attach(next, tool, waiting[tool]!, now), current),
    );
    // Taking from storage is the effect's job; this tells the host what arrived.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNews(
      `Added from ${joinNames(tools.map((tool) => TOOL_NAME[tool]))}: ${tools
        .map((tool) => waiting[tool]!.summary)
        .join(' · ')}`,
    );
  }, [planId, update]);

  const inFlow = !plan || (organizer && step !== 'kind' && step !== 'name' && flowOpen(step));

  /* ---------------- changes ---------------- */

  const create = () => {
    const title = draft.title.trim() || PLAN_LOOK[draft.kind].example;
    update(
      (current, now) =>
        setDetails(
          current,
          { kind: draft.kind, title, ...(prefill ? { place: prefill } : {}) },
          now,
        ),
      { create: true },
    );
    if (me?.name.trim())
      update((current, now) => answer(current, me, 'in', now, { host: true }), { create: true });
    setStep('when');
  };

  const nextStep = (from: Step) => {
    const order: Step[] = ['when', 'where', 'who'];
    let next = order[order.indexOf(from) + 1];
    if (next === 'where' && plan?.place) next = 'who';
    setStep(next ?? 'done');
  };

  const go = (tool: Connected) => {
    if (!plan) return;
    router.push(toolForPlan(tool, plan.id, titleOf(plan)));
  };

  const saveName = (name: string) => {
    const who = session.setName(name);
    update((current, now) => renamePerson(current, who.id, who.name, now));
    return who;
  };

  const rsvp = (choice: Exclude<Rsvp, 'invited'>, who = me, invite?: string) => {
    if (!who?.name.trim()) {
      setAsking(choice);
      return;
    }
    update((current, now) =>
      answer(current, who, choice, now, { invite, host: organizer && !current.people[who.id] }),
    );
    if (!organizer) setAnsweredNow(true);
  };

  const shareNow = async (): Promise<SendResult> => {
    if (!link || !plan) return null;
    const outcome = await send(link, titleOf(plan), planText(plan));
    if (outcome === 'shared' || outcome === 'copied') setSent({ plan, how: outcome });
    if (outcome === 'copied') toast({ title: 'Link copied. Paste it in the group chat.' });
    if (outcome === 'failed') toast({ title: 'Couldn’t share or copy here.', icon: 'alert' });
    return outcome;
  };

  const startNew = () => {
    session.startNew();
    setStep('kind');
    setDraft({ kind: 'dinner', title: '' });
    setPrefill(null);
    setNews(null);
    setSent(null);
  };

  /* ---------------- the first steps ---------------- */

  if (!plan || inFlow) {
    return (
      <div className="mx-auto grid w-full max-w-[720px] gap-4">
        {session.problem && (
          <Note icon="alert" tone="caution">
            {session.problem}
          </Note>
        )}
        <Flow
          step={plan ? step : step === 'name' ? 'name' : 'kind'}
          plan={plan}
          today={today}
          draft={draft}
          prefill={prefill}
          onDraft={setDraft}
          onKind={(kind) => {
            setDraft((current) => ({ ...current, kind }));
            setStep('name');
          }}
          onBack={() => setStep('kind')}
          onCreate={create}
          onWhen={(next) => update((current, now) => setDetails(current, next, now))}
          onPlace={(place) => update((current, now) => setDetails(current, { place }, now))}
          onVote={() => go('where')}
          onPeople={(names) =>
            update(
              (current, now) =>
                addPeople(
                  current,
                  names,
                  names.map(() => newId(8)),
                  now,
                ).plan,
            )
          }
          onRemove={(personId) => update((current, now) => removePerson(current, personId, now))}
          me={me?.name ?? ''}
          onHost={(name) => {
            const who = saveName(name);
            update((current, now) => answer(current, who, 'in', now, { host: true }));
          }}
          onNext={nextStep}
          onDone={() => setStep('done')}
          onFindTime={() => go('when')}
        />
        {!plan && session.store.sessions.length > 0 && (
          <Sessions session={session} onStartNew={startNew} />
        )}
      </div>
    );
  }

  /* ---------------- the plan ---------------- */

  const count = headcount(plan);
  const people = peopleOf(plan);
  const mine = me ? plan.people[me.id] : undefined;
  const invited = people.filter((person) => person.rsvp === 'invited').map((person) => person);
  const status = sent ? { how: sent.how, current: sent.plan === plan } : null;
  const links = plan.links;
  const host = people.find((person) => person.host);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
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

        <InviteCard
          plan={plan}
          today={today}
          onEditTitle={organizer ? () => setEditing('title') : undefined}
          onEditWhen={organizer ? () => setEditing('when') : undefined}
          onEditPlace={organizer ? () => setEditing('where') : undefined}
        >
          {!organizer && (
            <div className="mt-6 grid gap-3 border-t border-dashed border-line-strong pt-5">
              <p className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
                {mine && mine.rsvp !== 'invited'
                  ? mine.rsvp === 'in'
                    ? `You’re in, ${mine.name}.`
                    : mine.rsvp === 'maybe'
                      ? 'You’re a maybe.'
                      : 'You can’t make it.'
                  : 'Are you in?'}
              </p>
              <RsvpButtons
                value={mine && mine.rsvp !== 'invited' ? mine.rsvp : null}
                onAnswer={(choice) => rsvp(choice)}
              />
            </div>
          )}
          {organizer && people.length === 0 && (
            <button
              type="button"
              onClick={() => setEditing('people')}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-well px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/10"
            >
              <Icon name="user-plus" size={16} /> Who’s coming?
            </button>
          )}
        </InviteCard>

        <div className="grid gap-5 px-1">
          <Phase label="Before">
            <Module
              icon="calendar-clock"
              label="When"
              tone="#ffb35c"
              value={whenLine(plan) || links.when?.summary}
              empty={organizer ? 'Not sure yet? Find a time with everyone' : 'Day to be decided'}
              action={
                organizer
                  ? plan.date
                    ? 'Change'
                    : links.when
                      ? 'Open'
                      : 'Find a time'
                  : links.when
                    ? 'Open'
                    : undefined
              }
              onAction={organizer ? () => (plan.date ? setEditing('when') : go('when')) : undefined}
              href={!organizer || (!plan.date && links.when) ? links.when?.url : undefined}
              secondary={
                organizer && links.when ? (
                  <a
                    href={links.when.url}
                    className="hidden h-11 items-center rounded-full px-3 text-[13.5px] font-medium text-muted hover:text-ink sm:inline-flex"
                  >
                    Answers
                  </a>
                ) : undefined
              }
            />
            <Module
              icon="map-pin"
              label="Where"
              tone="#ff6b5b"
              value={plan.place?.name ?? links.where?.summary}
              empty={organizer ? 'Choose a place, or let everyone vote' : 'Place to be decided'}
              action={
                organizer ? (plan.place ? 'Change' : 'Choose') : links.where ? 'Vote' : undefined
              }
              onAction={organizer ? () => setEditing('where') : undefined}
              href={!organizer ? links.where?.url : undefined}
              secondary={
                links.where && organizer ? (
                  <a
                    href={links.where.url}
                    className="hidden h-11 items-center rounded-full px-3 text-[13.5px] font-medium text-muted hover:text-ink sm:inline-flex"
                  >
                    Votes
                  </a>
                ) : undefined
              }
            />
            {(organizer || links.bring) && (
              <Module
                icon="basket"
                label="Bring"
                tone="#8ee0a0"
                value={links.bring?.summary}
                empty="What should everyone bring?"
                action={links.bring ? 'Open' : 'Make a list'}
                href={links.bring?.url}
                onAction={links.bring ? undefined : () => go('bring')}
              />
            )}
          </Phase>

          <Phase
            label={plan.date ? `The day · ${whenLine({ ...plan, time: -1, end: '' })}` : 'The day'}
          >
            {plan.place && (
              <Module
                icon="navigation"
                label="Getting there"
                tone="#4f7cff"
                value={plan.place.name}
                empty=""
                action="Directions"
                href={directionsUrl(plan.place)}
              />
            )}
            {organizer ? (
              <Module
                icon="message"
                label="A note for everyone"
                tone="#ffd84d"
                value={plan.note.trim() ? plan.note.trim().split('\n')[0] : undefined}
                empty="Parking, dress code, the gate code…"
                action={plan.note.trim() ? 'Edit' : 'Add'}
                onAction={() => setEditing('note')}
              />
            ) : (
              !plan.place && (
                <p className="text-[14px] text-muted">The details land here as they’re decided.</p>
              )
            )}
          </Phase>

          {(organizer || links.split) && (
            <Phase label="After">
              <Module
                icon="receipt-text"
                label="Split"
                tone="#b8f35a"
                value={links.split?.summary}
                empty="Nothing yet. Start after dinner."
                action={links.split ? 'Open' : 'Split the bill'}
                href={links.split?.url}
                onAction={links.split ? undefined : () => go('split')}
              />
            </Phase>
          )}
        </div>

        {organizer && (
          <ActionBar className="lg:hidden">
            <ActionButton icon="send" disabled={!link} onClick={() => void shareNow()}>
              {status?.current ? 'Sent · send again' : 'Send the invite'}
            </ActionButton>
          </ActionBar>
        )}
      </div>

      <aside aria-label="Sharing and people" className="grid min-w-0 gap-4 lg:sticky lg:top-24">
        {organizer ? (
          <section
            aria-labelledby={`${id}-send`}
            className="grid gap-4 overflow-hidden rounded-[24px] bg-surface pb-5 shadow-lift"
          >
            <Sky className="h-3" />
            <div className="grid gap-4 px-5">
              <h2 id={`${id}-send`} className="sr-only">
                Send the invite
              </h2>
              {status?.current ? (
                <SentMark
                  key={status.how}
                  title={status.how === 'shared' ? 'Invite sent' : 'Link copied'}
                  line="Open the links people send back here and their answers land on the plan."
                />
              ) : (
                <div className="text-center">
                  <p className="font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink">
                    Send the invite
                  </p>
                  <p className="mt-1 text-[13.5px] text-muted">
                    Everyone opens the plan and taps if they’re in. No sign-up.
                  </p>
                </div>
              )}
              {status && !status.current && (
                <p className="flex items-center justify-center gap-1.5 text-[13px] text-ink-2">
                  <Icon name="refresh" size={13} className="text-muted" /> Changed since you sent it
                </p>
              )}
              <ActionButton icon="send" disabled={!link} onClick={() => void shareNow()}>
                {!link
                  ? 'Getting the link…'
                  : status?.current
                    ? 'Send it again'
                    : status
                      ? 'Send the update'
                      : 'Send the invite'}
              </ActionButton>
              <LinkExtras link={link} text={planText(plan, link ?? undefined)} />
            </div>
          </section>
        ) : (
          mine &&
          mine.rsvp !== 'invited' && (
            <section className="grid gap-3 rounded-[24px] bg-surface px-5 pt-6 pb-5 shadow-lift">
              {status?.current ? (
                <SentMark
                  key={status.how}
                  title={status.how === 'shared' ? 'Sent back' : 'Link copied'}
                  line={`Send it to ${host?.name ?? 'whoever sent it'} so the plan knows.`}
                />
              ) : (
                <p className="text-center text-[15px] text-ink-2">
                  Your answer travels with the link. Send it back to{' '}
                  {host?.name ?? 'whoever sent it'}.
                </p>
              )}
              <ActionButton icon="send" disabled={!link} onClick={() => void shareNow()}>
                {status?.current ? 'Send it again' : 'Send it back'}
              </ActionButton>
            </section>
          )
        )}

        <Surface className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-[19px] font-bold tracking-[-0.02em] text-ink">
              Who’s coming
            </h2>
            {organizer && (
              <button
                type="button"
                onClick={() => setEditing('people')}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10"
              >
                <Icon name="user-plus" size={14} /> Add
              </button>
            )}
          </div>
          {people.length ? (
            <>
              <p className="text-[13.5px] text-muted">
                {[
                  count.in && `${count.in} in`,
                  count.maybe && `${count.maybe} maybe`,
                  count.invited && `${count.invited} haven’t said`,
                  count.out && `${count.out} can’t`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <ul className="grid gap-1">
                {people.map((person) => (
                  <li key={person.id} className="flex min-h-11 items-center gap-3">
                    <PersonDot name={person.name} size={32} />
                    <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                      {person.name}
                      {person.id === me?.id && <span className="text-muted"> (you)</span>}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-[12px] font-semibold',
                        person.rsvp === 'in'
                          ? 'bg-signal-soft text-[var(--accent-ink)]'
                          : person.rsvp === 'out'
                            ? 'bg-well text-faint line-through'
                            : 'bg-well text-muted',
                      )}
                    >
                      {person.host ? 'Host' : RSVP_WORD[person.rsvp]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[14px] text-muted">
              {organizer
                ? 'Add names, or just send the invite: people add themselves.'
                : 'Nobody has answered yet.'}
            </p>
          )}
        </Surface>

        <Sessions session={session} onStartNew={startNew} onRename={() => setNaming(true)} />
      </aside>

      {!organizer && answeredNow && (
        <SendBackBar
          message={
            mine?.rsvp === 'in'
              ? `You’re in! Send it back so ${host?.name ?? 'they'} knows.`
              : 'Got it. Send it back so the plan knows.'
          }
          link={link}
          onSend={() => shareNow()}
          onDone={() => setAnsweredNow(false)}
        />
      )}

      <Sheet
        open={editing === 'when'}
        onClose={() => setEditing(null)}
        width="sm"
        title="When is it?"
      >
        <div className="grid gap-4">
          <WhenEditor
            today={today}
            date={plan.date}
            end={plan.end}
            time={plan.time}
            trip={plan.kind === 'trip'}
            onChange={(next) => update((current, now) => setDetails(current, next, now))}
          />
          <FindTime onClick={() => go('when')} />
          {plan.date && (
            <button
              type="button"
              onClick={() => {
                update((current, now) => setDetails(current, { date: '', end: '', time: -1 }, now));
                setEditing(null);
              }}
              className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-muted hover:bg-ink/5"
            >
              Not decided yet
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={editing === 'where'} onClose={() => setEditing(null)} width="sm" title="Where?">
        <PlaceEditor
          place={plan.place}
          onPlace={(place) => {
            update((current, now) => setDetails(current, { place }, now));
            if (place) setEditing(null);
          }}
          onVote={() => go('where')}
        />
        {links.where && (
          <button
            type="button"
            onClick={() => update((current) => detach(current, 'where'))}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13.5px] text-muted hover:bg-ink/5"
          >
            <Icon name="x" size={14} /> Remove the vote from the plan
          </button>
        )}
      </Sheet>

      <Sheet
        open={editing === 'people'}
        onClose={() => setEditing(null)}
        width="sm"
        title="Who’s coming?"
      >
        <PeopleEditor
          plan={plan}
          onAdd={(names) =>
            update(
              (current, now) =>
                addPeople(
                  current,
                  names,
                  names.map(() => newId(8)),
                  now,
                ).plan,
            )
          }
          onRemove={(personId) => update((current, now) => removePerson(current, personId, now))}
        />
      </Sheet>

      <TextSheet
        open={editing === 'title'}
        title="Name it"
        label="The plan’s name"
        initial={plan.title}
        max={80}
        onSave={(text) => update((current, now) => setDetails(current, { title: text }, now))}
        onClose={() => setEditing(null)}
      />
      <TextSheet
        open={editing === 'note'}
        title="A note for everyone"
        label="The note"
        initial={plan.note}
        max={400}
        multiline
        onSave={(text) => update((current, now) => setDetails(current, { note: text }, now))}
        onClose={() => setEditing(null)}
      />

      <AskName
        open={Boolean(asking) || naming}
        title={asking && invited.length ? 'Which one is you?' : 'What should we call you?'}
        lead={asking ? 'So everyone knows who’s coming. No sign-up.' : undefined}
        names={asking ? invited.map((person) => person.name) : undefined}
        initial={me?.name ?? ''}
        cta={asking ? 'That’s me' : 'Save'}
        onName={(name) => {
          const who = saveName(name);
          const invite = invited.find(
            (person) => person.name.trim().toLowerCase() === name.trim().toLowerCase(),
          );
          if (asking) rsvp(asking, who, invite?.id);
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

const flowOpen = (step: Step) => step === 'when' || step === 'where' || step === 'who';

/* ---------------- the first steps ---------------- */

function Flow({
  step,
  plan,
  today,
  draft,
  prefill,
  me,
  onDraft,
  onKind,
  onBack,
  onCreate,
  onWhen,
  onPlace,
  onVote,
  onPeople,
  onRemove,
  onHost,
  onNext,
  onDone,
  onFindTime,
}: {
  step: Step;
  plan: Plan | null;
  today: string;
  draft: { kind: PlanKind; title: string };
  prefill: Place | null;
  me: string;
  onDraft: (draft: { kind: PlanKind; title: string }) => void;
  onKind: (kind: PlanKind) => void;
  onBack: () => void;
  onCreate: () => void;
  onWhen: (next: { date: string; end: string; time: number }) => void;
  onPlace: (place: Place | null) => void;
  onVote: () => void;
  onPeople: (names: string[]) => void;
  onRemove: (personId: string) => void;
  onHost: (name: string) => void;
  onNext: (from: Step) => void;
  onDone: () => void;
  onFindTime: () => void;
}) {
  const id = useId();
  const [hostName, setHostName] = useState(me);
  const steps: Step[] = ['when', 'where', 'who'];
  const at = steps.indexOf(step);

  const shell = (title: ReactNode, lead: ReactNode, body: ReactNode, footer?: ReactNode) => (
    <section
      aria-labelledby={`${id}-title`}
      className="fx-rise relative isolate overflow-hidden rounded-[30px] bg-surface shadow-lift"
    >
      <Sky className="h-[92px] sm:h-[108px]">
        {plan && (
          <p className="absolute bottom-4 left-5 max-w-[80%] truncate font-display text-[20px] font-bold text-white sm:left-7">
            {titleOf(plan)}
          </p>
        )}
        {at >= 0 && (
          <ol className="absolute top-4 right-5 flex gap-1.5" aria-label={`Step ${at + 1} of 3`}>
            {steps.map((entry, index) => (
              <li
                key={entry}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  index <= at ? 'w-6 bg-white' : 'w-3 bg-white/45',
                )}
              />
            ))}
          </ol>
        )}
      </Sky>
      <div className="grid gap-5 px-5 pt-6 pb-6 sm:px-8 sm:pb-8">
        <div>
          <h2
            id={`${id}-title`}
            className="font-display text-[30px] leading-[1] font-extrabold tracking-[-0.035em] text-balance text-ink sm:text-[38px]"
            style={{ fontVariationSettings: "'wdth' 110" }}
          >
            {title}
          </h2>
          {lead && <p className="mt-2 text-[15.5px] leading-snug text-muted">{lead}</p>}
        </div>
        {body}
        {footer}
      </div>
    </section>
  );

  const skip = (label = 'Skip') => (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onDone}
        className="inline-flex min-h-11 items-center rounded-full px-3 text-[14.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
      >
        See the plan
      </button>
      <button
        type="button"
        onClick={() => onNext(step)}
        className="inline-flex h-12 items-center gap-1.5 rounded-full px-6 text-[15.5px] font-semibold text-[var(--on-accent)]"
        style={{ background: 'var(--accent)' }}
      >
        {label} <Icon name="arrow-right" size={16} />
      </button>
    </div>
  );

  if (step === 'kind')
    return shell(
      'What are we planning?',
      prefill ? (
        <>
          At <span className="font-semibold text-ink">{prefill.name}</span>. Start with the one
          thing you know.
        </>
      ) : (
        'Start with the one thing you know.'
      ),
      <ChoiceCards
        label="What are we planning?"
        columns={3}
        selected={draft.title ? [draft.kind] : []}
        onToggle={(kind) => onKind(kind)}
        options={PLAN_KINDS.map((kind) => ({
          value: kind,
          label: PLAN_LOOK[kind].label,
          icon: PLAN_LOOK[kind].icon,
          hint: PLAN_LOOK[kind].hint,
        }))}
      />,
    );

  if (step === 'name') {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      onCreate();
    };
    return shell(
      'Name it',
      'Something everyone will recognize.',
      <form onSubmit={submit} className="grid gap-4">
        <label htmlFor={`${id}-name`} className="sr-only">
          The plan’s name
        </label>
        <input
          id={`${id}-name`}
          autoFocus
          value={draft.title}
          maxLength={80}
          autoComplete="off"
          placeholder={PLAN_LOOK[draft.kind].example}
          onChange={(event) => onDraft({ ...draft, title: event.target.value })}
          className="h-16 w-full rounded-[18px] bg-subtle px-5 font-display text-[24px] font-bold text-ink shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] outline-none placeholder:font-normal placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
        />
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-[14.5px] font-medium text-muted hover:bg-ink/5 hover:text-ink"
          >
            <Icon name="chevron-left" size={16} /> {PLAN_LOOK[draft.kind].label}
          </button>
          <button
            type="submit"
            className="inline-flex h-12 items-center gap-1.5 rounded-full px-6 text-[15.5px] font-semibold text-[var(--on-accent)]"
            style={{ background: 'var(--accent)' }}
          >
            Next <Icon name="arrow-right" size={16} />
          </button>
        </div>
      </form>,
    );
  }

  if (!plan) return null;

  if (step === 'when')
    return shell(
      plan.kind === 'trip' ? 'When are you going?' : 'When?',
      'Tap a day. Skip it if you don’t know yet.',
      <div className="grid gap-4">
        <WhenEditor
          today={today}
          date={plan.date}
          end={plan.end}
          time={plan.time}
          trip={plan.kind === 'trip'}
          onChange={onWhen}
        />
        <FindTime onClick={onFindTime} />
      </div>,
      skip(plan.date ? 'Next' : 'Skip'),
    );

  if (step === 'where')
    return shell(
      'Where?',
      'A name or a pasted Maps link. Or let the group decide.',
      <PlaceEditor place={plan.place} onPlace={onPlace} onVote={onVote} />,
      skip(plan.place ? 'Next' : 'Skip'),
    );

  // Who
  const hasPeople = peopleOf(plan).length > 0;
  return shell(
    'Who’s coming?',
    'Add names now, or just send the invite: people add themselves.',
    <div className="grid gap-4">
      {!me && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (hostName.trim()) onHost(hostName);
          }}
          className="flex gap-2"
        >
          <label htmlFor={`${id}-host`} className="sr-only">
            Your name
          </label>
          <input
            id={`${id}-host`}
            value={hostName}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Your name (you’re hosting)"
            onChange={(event) => setHostName(event.target.value)}
            className="h-12 w-0 min-w-0 flex-1 rounded-[14px] bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
          />
          <button
            type="submit"
            disabled={!hostName.trim()}
            className="h-12 shrink-0 rounded-[14px] bg-ink px-4 text-[15px] font-semibold text-on-ink disabled:opacity-40"
          >
            That’s me
          </button>
        </form>
      )}
      <PeopleEditor plan={plan} onAdd={onPeople} onRemove={onRemove} />
    </div>,
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onDone}
        className="inline-flex h-12 items-center gap-1.5 rounded-full px-6 text-[15.5px] font-semibold text-[var(--on-accent)]"
        style={{ background: 'var(--accent)' }}
      >
        {hasPeople ? 'See the plan' : 'Skip'} <Icon name="arrow-right" size={16} />
      </button>
    </div>,
  );
}

function FindTime({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-[18px] bg-[#ffb35c]/15 px-4 text-left text-[15px] font-semibold text-ink transition-colors hover:bg-[#ffb35c]/25"
    >
      <span className="grid size-9 place-items-center rounded-full bg-[#ffb35c] text-[#12110d]">
        <Icon name="calendar-clock" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        Not sure? Find a time with everyone
        <span className="block text-[13px] font-normal text-muted">Opens When?</span>
      </span>
      <Icon name="arrow-right" size={17} className="text-muted" />
    </button>
  );
}

function TextSheet({
  open,
  title,
  label,
  initial,
  max,
  multiline = false,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  initial: string;
  max: number;
  multiline?: boolean;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  return (
    <Sheet open={open} onClose={onClose} width="sm" title={title}>
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get('text');
            onSave(String(value ?? '').trim());
            onClose();
          }}
          className="grid gap-3"
        >
          <label htmlFor={`${id}-text`} className="sr-only">
            {label}
          </label>
          {multiline ? (
            <textarea
              id={`${id}-text`}
              name="text"
              data-autofocus
              defaultValue={initial}
              maxLength={max}
              rows={5}
              className="w-full rounded-[14px] bg-subtle p-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
            />
          ) : (
            <input
              id={`${id}-text`}
              name="text"
              data-autofocus
              defaultValue={initial}
              maxLength={max}
              className="h-12 w-full rounded-[14px] bg-subtle px-4 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none focus:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
            />
          )}
          <button
            type="submit"
            className="h-12 rounded-[14px] text-[15.5px] font-semibold text-[var(--on-accent)]"
            style={{ background: 'var(--accent)' }}
          >
            Save
          </button>
        </form>
      )}
    </Sheet>
  );
}

function Sessions({
  session,
  onStartNew,
  onRename,
}: {
  session: ReturnType<typeof useGroupSession<Plan>>;
  onStartNew: () => void;
  onRename?: () => void;
}) {
  const { store, data, organizer, me } = session;
  return (
    <>
      {store.sessions.length > (data ? 1 : 0) && (
        <DeviceSessions
          title="Your plans"
          current={store.current}
          newLabel="New plan"
          items={store.sessions.map((entry) => ({
            id: entry.data.id,
            title: titleOf(entry.data),
            line: [
              entry.role === 'organizer' ? 'You’re hosting' : 'You’re invited',
              whenLine({ ...entry.data, time: -1 }),
            ]
              .filter(Boolean)
              .join(' · '),
          }))}
          onOpen={session.open}
          onForget={(planId) => {
            const entry = store.sessions.find((item) => item.data.id === planId);
            if (
              window.confirm(
                `Remove “${entry ? titleOf(entry.data) : 'this plan'}” from this device? Everyone else keeps theirs.`,
              )
            )
              session.forget(planId);
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
                {me?.name.trim() && onRename && (
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
                    <Icon name="pencil" size={15} /> I’m hosting this
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStartNew}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
                >
                  <Icon name="plus" size={15} /> New plan
                </button>
              </div>
            </div>
          </MoreOptions>
        </Surface>
      )}
    </>
  );
}
