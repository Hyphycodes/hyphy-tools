'use client';
import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { clearHash, decodeState, encodeState, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  addPeople,
  BUDGETS,
  budgetLabel,
  drawNames,
  drawProblem,
  EMPTY_STORE,
  keepSlip,
  newExchange,
  NOTE_IDEAS,
  parseNames,
  removePerson,
  slipFor,
  slipMessage,
  slipSchema,
  storeSchema,
  titleOf,
  togglePair,
  type Exchange,
  type SantaStore,
  type Slip,
} from '@/lib/tools/secret-santa';
import { countdown, longDay, todayHere } from '@/lib/tools/plan';
import { IntentLink } from '@/components/marketplace/intent-link';
import { PersonDot } from './bring-art';
import { useCanShare } from './group-share';
import { ActionBar, ActionButton, IconButton, MoreOptions, Note, Surface } from './kit';
import { Envelope, Felt, MatchCard, Seal, Shuffle } from './santa-parts';

/*
 * Secret Santa: who's in, who shouldn't draw whom, then the draw. The organizer's page never
 * shows anyone's match: each person gets a private link with their own envelope, and opening it
 * is the payoff. The exchange stays in the organizer's browser (lib/tools/secret-santa).
 */

type Phase = 'setup' | 'drawing' | 'who' | 'send';
const noop = () => () => {};

/** The address of someone's envelope. */
async function slipLink(slip: Slip) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${await encodeState(slip)}`;
}

export function SantaTool() {
  const toast = useToast();
  const [store, setStore, { loaded }] = useLocalState<SantaStore>(
    'hyphy.santa.v1',
    storeSchema,
    EMPTY_STORE,
  );
  const [slip, setSlip] = useState<Slip | null>(null);
  const [broken, setBroken] = useState(false);
  const [phase, setPhase] = useState<Phase>('setup');
  const [picking, setPicking] = useState<string | null>(null);

  const exchange = store.exchanges.find((entry) => entry.id === store.current) ?? null;

  // A private link carries one envelope.
  useEffect(() => {
    if (!loaded) return;
    const open = () => {
      const fragment = window.location.hash;
      if (fragment.length <= 1) {
        setSlip(null);
        return;
      }
      void decodeState(fragment, slipSchema).then((found) => {
        if (!found) {
          setBroken(true);
          return;
        }
        setBroken(false);
        setSlip(found);
        setStore((current) => keepSlip(current, found));
      });
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [loaded, setStore]);

  // Back on a drawn exchange: straight to sending.
  useEffect(() => {
    // The phase follows the saved exchange once storage is read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (loaded && exchange?.drawn && phase === 'setup') setPhase('send');
    // Only when a different exchange comes on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, exchange?.id]);

  // Each stage of the draw opens at the table, not wherever the button was.
  useEffect(() => {
    if (phase === 'setup') return;
    const tool = document.getElementById('tool');
    if (!tool) return;
    const top = tool.getBoundingClientRect().top + window.scrollY - 72;
    if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
  }, [phase]);

  const edit = (change: (exchange: Exchange, now: number) => Exchange) => {
    const now = Date.now();
    setStore((current) => {
      const on = current.exchanges.find((entry) => entry.id === current.current);
      const base = on ?? newExchange(newId(), now);
      const next = change(base, now);
      return {
        ...current,
        current: next.id,
        exchanges: [next, ...current.exchanges.filter((entry) => entry.id !== next.id)].slice(
          0,
          12,
        ),
      };
    });
  };

  const draw = () => {
    if (!exchange) return;
    const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    const match = drawNames(exchange, random);
    if (!match) {
      toast({
        title: 'No way to draw with those pairs. Let one pair draw each other.',
        icon: 'alert',
      });
      return;
    }
    edit((current, now) => ({ ...current, drawn: { at: now, match }, sent: [] }));
    setPhase('drawing');
  };

  const startNew = () => {
    setStore((current) => ({ ...current, current: null }));
    setPhase('setup');
    clearHash();
    setSlip(null);
  };

  if (!loaded) return <div aria-busy="true" className="skeleton h-[420px] !rounded-[28px]" />;

  if (slip)
    return (
      <SlipView
        key={`${slip.x}.${slip.p}`}
        slip={slip}
        others={store.slips.filter((entry) => !(entry.x === slip.x && entry.p === slip.p))}
        onOpen={(other) => void slipLink(other).then((url) => window.location.assign(url))}
        onOrganize={() => {
          clearHash();
          setSlip(null);
        }}
      />
    );

  return (
    <div className="mx-auto grid w-full max-w-[860px] gap-5">
      {broken && (
        <Note icon="alert" tone="caution">
          That envelope link got cut off. Ask for it again.
        </Note>
      )}

      {phase === 'setup' || !exchange?.drawn ? (
        <Setup
          exchange={exchange}
          picking={picking}
          onPick={setPicking}
          onEdit={edit}
          onDraw={draw}
        />
      ) : phase === 'drawing' ? (
        <Felt className="grid gap-4 px-5 py-10 text-center sm:py-14">
          <Shuffle count={exchange.people.length} onDone={() => setPhase('who')} />
          <p className="font-display text-[26px] font-bold tracking-[-0.02em]" role="status">
            Drawing names…
          </p>
        </Felt>
      ) : phase === 'who' ? (
        <WhoAreYou
          exchange={exchange}
          onHost={(personId) =>
            edit((current, now) => ({ ...current, host: personId, edited: now }))
          }
          onNext={() => setPhase('send')}
        />
      ) : (
        <Send
          exchange={exchange}
          onSent={(personId) =>
            edit((current) => ({
              ...current,
              sent: current.sent.includes(personId) ? current.sent : [...current.sent, personId],
            }))
          }
          onMe={() => setPhase('who')}
          onRedraw={() => {
            if (
              window.confirm(
                'Draw again? Everyone gets a new match, and links you already sent stop matching.',
              )
            )
              draw();
          }}
          onChangePeople={() => {
            if (
              window.confirm(
                'Change who’s in? That means drawing again, and links you already sent stop matching.',
              )
            ) {
              edit((current, now) => ({ ...current, drawn: null, sent: [], edited: now }));
              setPhase('setup');
            }
          }}
          onStartNew={startNew}
        />
      )}

      {(store.exchanges.length > 1 || (!exchange && store.exchanges.length > 0)) && (
        <Surface className="grid gap-2">
          <p className="label">Your exchanges</p>
          <ul className="grid gap-1">
            {store.exchanges.map((entry) => (
              <li key={entry.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setStore((current) => ({ ...current, current: entry.id }));
                    setPhase(entry.drawn ? 'send' : 'setup');
                  }}
                  aria-current={entry.id === store.current ? 'true' : undefined}
                  className={cn(
                    'min-h-12 min-w-0 flex-1 rounded-[12px] px-3 py-2 text-left hover:bg-ink/5',
                    entry.id === store.current && 'bg-subtle',
                  )}
                >
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {titleOf(entry)}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {entry.people.length} people · {entry.drawn ? 'drawn' : 'not drawn yet'}
                  </span>
                </button>
                <IconButton
                  icon="x"
                  label={`Remove ${titleOf(entry)} from this device`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove “${titleOf(entry)}” from this device? Links you sent keep working.`,
                      )
                    )
                      setStore((current) => ({
                        ...current,
                        current: current.current === entry.id ? null : current.current,
                        exchanges: current.exchanges.filter((item) => item.id !== entry.id),
                      }));
                  }}
                />
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {store.slips.length > 0 && !exchange && (
        <Surface className="grid gap-2">
          <p className="label">Envelopes opened here</p>
          {store.slips.map((entry) => (
            <button
              key={`${entry.x}.${entry.p}`}
              type="button"
              onClick={() => void slipLink(entry).then((url) => window.location.assign(url))}
              className="flex min-h-12 items-center gap-3 rounded-[12px] px-3 text-left hover:bg-ink/5"
            >
              <Seal size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                {entry.title} · for {entry.for}
              </span>
              <Icon name="chevron-right" size={16} className="text-muted" />
            </button>
          ))}
        </Surface>
      )}
    </div>
  );
}

/* ---------------- setting it up ---------------- */

const chip = (on: boolean) =>
  cn(
    'min-h-11 shrink-0 rounded-full px-4 text-[14.5px] font-medium transition-colors active:scale-[.97]',
    on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'bg-well text-ink-2 hover:bg-ink/10',
  );

function Setup({
  exchange,
  picking,
  onPick,
  onEdit,
  onDraw,
}: {
  exchange: Exchange | null;
  picking: string | null;
  onPick: (personId: string | null) => void;
  onEdit: (change: (exchange: Exchange, now: number) => Exchange) => void;
  onDraw: () => void;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [pairing, setPairing] = useState(false);
  const [customBudget, setCustomBudget] = useState(false);
  const today = useSyncExternalStore(noop, todayHere, () => '');
  const people = exchange?.people ?? [];
  const problem = exchange ? drawProblem(exchange) : { kind: 'few' as const };
  const name = (personId: string) => people.find((person) => person.id === personId)?.name ?? '';

  const add = (event: FormEvent) => {
    event.preventDefault();
    const names = parseNames(text);
    if (!names.length) return;
    onEdit(
      (current, now) =>
        addPeople(
          current,
          names,
          names.map(() => newId(8)),
          now,
        ).exchange,
    );
    setText('');
  };

  const tapPerson = (personId: string) => {
    if (!pairing) return;
    if (!picking) return onPick(personId);
    if (picking !== personId) onEdit((current, now) => togglePair(current, picking, personId, now));
    onPick(null);
  };

  return (
    <>
      <Felt className="px-5 pt-8 pb-7 sm:px-9 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[12px] font-bold tracking-[.16em] text-[#e2c77f] uppercase">
              {exchange?.title.trim() || 'Secret Santa'}
            </p>
            <h2
              className="mt-2 font-display text-[36px] leading-[.98] font-extrabold tracking-[-0.035em] text-balance sm:text-[48px]"
              style={{ fontVariationSettings: "'wdth' 110" }}
            >
              Who’s in?
            </h2>
          </div>
          <div className="relative hidden h-[88px] w-[140px] shrink-0 sm:block" aria-hidden="true">
            <Envelope width={96} tilt={-8} className="absolute top-2 left-0" />
            <Envelope width={96} tilt={6} className="absolute top-0 left-10" />
          </div>
        </div>

        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Who’s in">
          {people.map((person) => {
            const on = picking === person.id;
            return (
              <li key={person.id} className="fx-pop">
                <span
                  className={cn(
                    'inline-flex min-h-12 items-center gap-2 rounded-full py-1 pr-1.5 pl-1.5 text-[15px] font-semibold transition-colors',
                    on ? 'bg-[#f6eedb] text-[#1b2a22]' : 'bg-white/10 text-[#f6eedb]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => tapPerson(person.id)}
                    disabled={!pairing}
                    aria-pressed={pairing ? on : undefined}
                    className="inline-flex items-center gap-2 disabled:cursor-default"
                  >
                    <PersonDot name={person.name} size={34} />
                    {person.name}
                  </button>
                  {!pairing && (
                    <button
                      type="button"
                      aria-label={`Take ${person.name} out`}
                      onClick={() =>
                        onEdit((current, now) => removePerson(current, person.id, now))
                      }
                      className="grid size-9 place-items-center rounded-full text-[#f6eedb]/60 hover:bg-white/10 hover:text-[#f6eedb]"
                    >
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {!pairing && (
          <form onSubmit={add} className="mt-4 flex gap-2">
            <label htmlFor={`${id}-names`} className="sr-only">
              Add names
            </label>
            <input
              id={`${id}-names`}
              value={text}
              maxLength={2000}
              autoComplete="off"
              enterKeyHint="done"
              placeholder={people.length ? 'Add someone' : 'Jerry, Kamila, Emauri…'}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData('text');
                if (!/[\n,]/.test(pasted)) return;
                event.preventDefault();
                const names = parseNames(pasted);
                onEdit(
                  (current, now) =>
                    addPeople(
                      current,
                      names,
                      names.map(() => newId(8)),
                      now,
                    ).exchange,
                );
              }}
              className="h-13 w-0 min-w-0 flex-1 rounded-[16px] bg-white/95 px-4 text-[16px] text-[#1b2a22] outline-none placeholder:text-[#1b2a22]/45 focus:shadow-[0_0_0_3px_#c9a24c]"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="h-13 shrink-0 rounded-[16px] bg-[var(--accent)] px-5 text-[15px] font-semibold text-[var(--on-accent)] disabled:opacity-50"
            >
              Add
            </button>
          </form>
        )}
        {!people.length && (
          <p className="mt-4 text-[14.5px] text-[#f6eedb]/75">
            Add the crew. Paste a list or type names with commas.
          </p>
        )}
      </Felt>

      {people.length >= 2 && (
        <Surface className="grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
                Anyone who shouldn’t draw each other?
              </h3>
              <p className="mt-0.5 text-[14px] text-muted">
                Couples, the same household. Optional.
              </p>
            </div>
          </div>
          {exchange && exchange.pairs.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Kept apart">
              {exchange.pairs.map(([a, b]) => (
                <li
                  key={`${a}-${b}`}
                  className="fx-pop inline-flex min-h-11 items-center gap-2 rounded-full bg-well py-1 pr-1 pl-3 text-[14.5px] font-semibold text-ink"
                >
                  {name(a)} <Icon name="arrow-right" size={13} className="rotate-0 text-faint" />
                  <span className="sr-only">and</span>
                  {name(b)}
                  <button
                    type="button"
                    aria-label={`Let ${name(a)} and ${name(b)} draw each other`}
                    onClick={() => onEdit((current, now) => togglePair(current, a, b, now))}
                    className="grid size-9 place-items-center rounded-full text-muted hover:bg-ink/10 hover:text-ink"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pairing ? (
            <div className="grid gap-2">
              <p
                className="rounded-[14px] bg-signal-soft px-4 py-3 text-[14.5px] text-ink"
                role="status"
              >
                {picking
                  ? `Now tap who ${name(picking)} shouldn’t draw, up on the table.`
                  : 'Tap two people up on the table.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setPairing(false);
                  onPick(null);
                }}
                className="justify-self-start rounded-full bg-ink px-4 py-2.5 text-[14px] font-semibold text-on-ink"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPairing(true)}
              className="inline-flex min-h-11 items-center gap-2 justify-self-start rounded-full bg-well px-4 text-[14.5px] font-medium text-ink-2 hover:bg-ink/10"
            >
              <Icon name="plus" size={15} /> Keep two people apart
            </button>
          )}
        </Surface>
      )}

      {people.length >= 2 && (
        <Surface className="grid gap-5">
          <div className="grid gap-2">
            <h3 className="font-display text-[18px] font-bold text-ink">Gift budget</h3>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Gift budget">
              {BUDGETS.map((budget) => {
                const on = !customBudget && exchange?.budget === budget;
                return (
                  <button
                    key={budget}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setCustomBudget(false);
                      onEdit((current, now) => ({ ...current, budget, edited: now }));
                    }}
                    className={chip(on)}
                  >
                    {budget ? budgetLabel(budget) : 'None'}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCustomBudget(true)}
                className={chip(
                  customBudget || Boolean(exchange && !BUDGETS.includes(exchange.budget as 0)),
                )}
              >
                Custom
              </button>
            </div>
            {(customBudget || (exchange && !BUDGETS.includes(exchange.budget as 0))) && (
              <label className="flex h-12 max-w-[200px] items-center gap-2 rounded-[14px] bg-subtle px-3.5 shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
                <span className="text-muted">$</span>
                <span className="sr-only">Budget</span>
                <input
                  inputMode="numeric"
                  value={exchange?.budget || ''}
                  placeholder="40"
                  onChange={(event) => {
                    const value = Math.min(
                      100_000,
                      Number(event.target.value.replace(/\D/g, '')) || 0,
                    );
                    onEdit((current, now) => ({ ...current, budget: value, edited: now }));
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none"
                />
              </label>
            )}
          </div>

          <MoreOptions
            label="Date, a note, a name"
            summary={
              [
                exchange?.date && longDay(exchange.date),
                exchange?.note && 'note',
                exchange?.title && exchange.title,
              ]
                .filter(Boolean)
                .join(' · ') || 'Optional'
            }
          >
            <div className="grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-[13.5px] font-medium text-ink-2">Exchange day</span>
                <input
                  type="date"
                  value={exchange?.date ?? ''}
                  min={today || undefined}
                  onChange={(event) =>
                    onEdit((current, now) => ({
                      ...current,
                      date: event.target.value,
                      edited: now,
                    }))
                  }
                  className="h-12 max-w-[240px] rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]"
                />
              </label>
              <div className="grid gap-1.5">
                <span className="text-[13.5px] font-medium text-ink-2">A note for everyone</span>
                <div className="flex flex-wrap gap-1.5">
                  {NOTE_IDEAS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      onClick={() =>
                        onEdit((current, now) => ({
                          ...current,
                          note: current.note.includes(idea)
                            ? current.note
                                .replace(idea, '')
                                .replace(/^[.\s]+|[.\s]+$/g, '')
                                .replace(/\.\s*\./g, '.')
                            : [current.note.trim(), idea].filter(Boolean).join('. ').slice(0, 300),
                          edited: now,
                        }))
                      }
                      className={chip(Boolean(exchange?.note.includes(idea)))}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label="The note"
                  value={exchange?.note ?? ''}
                  maxLength={300}
                  rows={2}
                  placeholder="Anything else"
                  onChange={(event) =>
                    onEdit((current, now) => ({
                      ...current,
                      note: event.target.value,
                      edited: now,
                    }))
                  }
                  className="rounded-[14px] bg-subtle p-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none"
                />
              </div>
              <label className="grid gap-1.5">
                <span className="text-[13.5px] font-medium text-ink-2">Name it</span>
                <input
                  value={exchange?.title ?? ''}
                  maxLength={80}
                  placeholder="Family Secret Santa"
                  onChange={(event) =>
                    onEdit((current, now) => ({
                      ...current,
                      title: event.target.value,
                      edited: now,
                    }))
                  }
                  className="h-12 rounded-[14px] bg-subtle px-3.5 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none"
                />
              </label>
            </div>
          </MoreOptions>
        </Surface>
      )}

      <ActionBar>
        <ActionButton icon="shuffle" disabled={Boolean(problem)} onClick={onDraw}>
          {problem?.kind === 'few'
            ? `Add ${Math.max(1, 3 - people.length)} more to draw`
            : problem?.kind === 'stuck'
              ? `Nobody’s left for ${problem.name} to draw`
              : `Draw names for ${people.length}`}
        </ActionButton>
      </ActionBar>
    </>
  );
}

/* ---------------- after the draw ---------------- */

function WhoAreYou({
  exchange,
  onHost,
  onNext,
}: {
  exchange: Exchange;
  onHost: (personId: string) => void;
  onNext: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const host = exchange.people.find((person) => person.id === exchange.host);
  const match = host
    ? exchange.people.find((person) => person.id === exchange.drawn?.match[host.id])
    : null;

  if (!host)
    return (
      <Felt className="grid gap-5 px-5 py-9 text-center sm:px-10">
        <p
          className="font-display text-[15px] font-bold tracking-[.14em] text-[#e2c77f] uppercase"
          role="status"
        >
          Done. Everyone has someone.
        </p>
        <h2 className="font-display text-[32px] leading-tight font-extrabold tracking-[-0.03em] sm:text-[40px]">
          Which one is you?
        </h2>
        <div className="flex flex-wrap justify-center gap-2">
          {exchange.people.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => onHost(person.id)}
              className="inline-flex min-h-12 items-center gap-2 rounded-full bg-white/10 py-1 pr-4 pl-1.5 text-[15px] font-semibold hover:bg-white/20"
            >
              <PersonDot name={person.name} size={34} /> {person.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onNext}
          className="mx-auto inline-flex min-h-11 items-center rounded-full px-4 text-[14.5px] text-[#f6eedb]/75 hover:bg-white/10"
        >
          I’m not in it, just organizing
        </button>
      </Felt>
    );

  return (
    <Felt className="grid justify-items-center gap-5 px-5 pt-40 pb-9 text-center sm:px-10 sm:pt-44">
      <Envelope name={host.name} open={opened} width={260} className="fx-settle">
        {match && <MatchCard name={match.name} />}
      </Envelope>
      {opened ? (
        <div className="fx-rise grid gap-3">
          <p className="max-w-[32ch] text-[15px] text-[#f6eedb]/80">
            Keep it to yourself. Now send everyone else their envelope.
          </p>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-7 text-[16px] font-semibold text-[var(--on-accent)]"
          >
            Send the envelopes <Icon name="arrow-right" size={17} />
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="font-display text-[26px] font-bold tracking-[-0.02em]">This one’s yours.</p>
          <button
            type="button"
            onClick={() => setOpened(true)}
            className="inline-flex h-13 items-center justify-center gap-2 rounded-full bg-[#f6eedb] px-7 text-[16px] font-semibold text-[#1b2a22]"
          >
            <Icon name="mail-open" size={18} /> Open it
          </button>
          <button
            type="button"
            onClick={onNext}
            className="inline-flex min-h-11 items-center justify-center rounded-full px-4 text-[14px] text-[#f6eedb]/70 hover:bg-white/10"
          >
            Open it later
          </button>
        </div>
      )}
    </Felt>
  );
}

function Send({
  exchange,
  onSent,
  onMe,
  onRedraw,
  onChangePeople,
  onStartNew,
}: {
  exchange: Exchange;
  onSent: (personId: string) => void;
  onMe: () => void;
  onRedraw: () => void;
  onChangePeople: () => void;
  onStartNew: () => void;
}) {
  const toast = useToast();
  const canShare = useCanShare();
  const others = exchange.people.filter((person) => person.id !== exchange.host);
  const sentCount = others.filter((person) => exchange.sent.includes(person.id)).length;
  const host = exchange.people.find((person) => person.id === exchange.host);

  const pass = async (personId: string, how: 'copy' | 'share') => {
    const slip = slipFor(exchange, personId);
    if (!slip) return;
    const link = await slipLink(slip);
    const message = slipMessage(exchange, slip.for, link);
    if (how === 'share' && canShare) {
      try {
        await navigator.share({ title: `${slip.for}’s envelope`, text: message });
        onSent(personId);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(message);
      onSent(personId);
      toast({ title: `${slip.for}’s envelope copied. Send it to them only.` });
    } catch {
      toast({ title: 'Couldn’t copy here.', icon: 'alert' });
    }
  };

  return (
    <>
      <Felt className="px-5 pt-8 pb-6 sm:px-9">
        <p className="text-[12px] font-bold tracking-[.16em] text-[#e2c77f] uppercase">
          {titleOf(exchange)} · drawn
        </p>
        <h2
          className="mt-2 font-display text-[32px] leading-[1] font-extrabold tracking-[-0.035em] text-balance sm:text-[44px]"
          style={{ fontVariationSettings: "'wdth' 110" }}
        >
          Send each person their envelope
        </h2>
        <p className="mt-3 max-w-[46ch] text-[15px] text-[#f6eedb]/80">
          Every link opens one envelope with one name in it. This page never shows who got whom.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="fx-move h-full rounded-full bg-[#c9a24c]"
              style={{ width: `${others.length ? (sentCount / others.length) * 100 : 0}%` }}
            />
          </div>
          <p className="text-[14px] font-semibold" role="status">
            {sentCount === others.length && others.length
              ? 'All sent'
              : `${sentCount} of ${others.length} sent`}
          </p>
        </div>
        {[
          exchange.budget ? budgetLabel(exchange.budget, exchange.currency) : '',
          exchange.date ? longDay(exchange.date) : '',
        ].filter(Boolean).length > 0 && (
          <p className="mt-4 text-[14px] text-[#f6eedb]/75">
            {[
              exchange.budget ? budgetLabel(exchange.budget, exchange.currency) : '',
              exchange.date ? longDay(exchange.date) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </Felt>

      <Surface className="grid gap-1 !p-2 sm:!p-3">
        {host && (
          <div className="flex min-h-14 items-center gap-3 rounded-[16px] px-3">
            <PersonDot name={host.name} size={36} />
            <p className="min-w-0 flex-1 text-[15.5px] font-semibold text-ink">
              {host.name} <span className="font-normal text-muted">(you)</span>
            </p>
            <button
              type="button"
              onClick={onMe}
              className="inline-flex h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-semibold text-ink-2 hover:bg-ink/10"
            >
              <Icon name="mail-open" size={15} /> My envelope
            </button>
          </div>
        )}
        {others.map((person) => {
          const done = exchange.sent.includes(person.id);
          return (
            <div key={person.id} className="flex min-h-14 items-center gap-2 rounded-[16px] px-3">
              <PersonDot name={person.name} size={36} />
              <p className="min-w-0 flex-1 truncate text-[15.5px] font-semibold text-ink">
                {person.name}
                {done && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--accent-ink)]">
                    <Icon name="check" size={13} strokeWidth={2.6} /> Sent
                  </span>
                )}
              </p>
              {canShare && (
                <button
                  type="button"
                  onClick={() => void pass(person.id, 'share')}
                  aria-label={`Share ${person.name}’s envelope`}
                  className="grid size-11 place-items-center rounded-full bg-well text-ink-2 hover:bg-ink/10"
                >
                  <Icon name="share" size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => void pass(person.id, 'copy')}
                aria-label={`Copy ${person.name}’s envelope link`}
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold',
                  done ? 'bg-well text-ink-2' : 'bg-[var(--accent)] text-[var(--on-accent)]',
                )}
              >
                <Icon name={done ? 'copy' : 'link-2'} size={15} /> {done ? 'Again' : 'Copy'}
              </button>
            </div>
          );
        })}
      </Surface>

      <Note icon="lock">
        The draw is kept in this browser. If you open someone’s link yourself, you’ll see their
        match, so just send it.
      </Note>

      <Surface className="!py-2">
        <MoreOptions label="More">
          <div className="flex flex-wrap gap-2 pb-3">
            <button
              type="button"
              onClick={onChangePeople}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
            >
              <Icon name="people" size={15} /> Change who’s in
            </button>
            <button
              type="button"
              onClick={onRedraw}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
            >
              <Icon name="shuffle" size={15} /> Draw again
            </button>
            <button
              type="button"
              onClick={onStartNew}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 hover:bg-ink/10"
            >
              <Icon name="plus" size={15} /> New exchange
            </button>
          </div>
        </MoreOptions>
      </Surface>
    </>
  );
}

/* ---------------- someone's own envelope ---------------- */

function SlipView({
  slip,
  others,
  onOpen,
  onOrganize,
}: {
  slip: Slip;
  others: Slip[];
  onOpen: (slip: Slip) => void;
  onOrganize: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const today = useSyncExternalStore(noop, todayHere, () => '');
  const details: ReactNode[] = [
    slip.budget ? (
      <Detail
        key="budget"
        icon="wallet"
        text={`Up to ${budgetLabel(slip.budget, slip.currency)}`}
      />
    ) : null,
    slip.date ? (
      <Detail
        key="date"
        icon="calendar"
        text={`${longDay(slip.date)}${today ? ` · ${countdown(slip.date, today)}` : ''}`}
      />
    ) : null,
  ].filter(Boolean);
  return (
    <div className="mx-auto grid w-full max-w-[640px] gap-5">
      <Felt className="grid justify-items-center gap-5 px-5 pt-40 pb-9 text-center sm:pt-44">
        <p className="absolute top-7 inset-x-5 text-[12px] font-bold tracking-[.16em] text-[#e2c77f] uppercase">
          {slip.title}
          {slip.host && ` · from ${slip.host}`}
        </p>
        <Envelope name={slip.for} open={opened} width={280} className="fx-settle">
          <MatchCard name={slip.to} />
        </Envelope>
        {opened ? (
          <div className="fx-rise grid justify-items-center gap-4" aria-live="polite">
            <p className="sr-only">You’re giving a gift to {slip.to}.</p>
            <p className="max-w-[30ch] text-[15.5px] text-[#f6eedb]/85">
              Shh. Only you know. Keep it that way.
            </p>
            {details.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2">{details}</div>
            )}
            {slip.note.trim() && (
              <p className="max-w-[36ch] rounded-[14px] bg-white/10 px-4 py-2.5 text-[14.5px]">
                “{slip.note.trim()}”
              </p>
            )}
          </div>
        ) : (
          <div className="grid justify-items-center gap-3">
            <p className="font-display text-[26px] font-bold tracking-[-0.02em]">
              For {slip.for}, and only {slip.for}.
            </p>
            <button
              type="button"
              onClick={() => setOpened(true)}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#f6eedb] px-8 text-[17px] font-semibold text-[#1b2a22] shadow-[0_14px_30px_-14px_rgb(0_0_0/.6)] active:scale-[.98]"
            >
              <Icon name="mail-open" size={19} /> Open my envelope
            </button>
            <p className="text-[13px] text-[#f6eedb]/60">Not {slip.for}? Please close this one.</p>
          </div>
        )}
      </Felt>

      {opened && (
        <Surface className="fx-rise grid gap-3 [--i:2]">
          <p className="text-[15px] text-ink-2">
            Want {slip.to} to have an easier time too? Make a wish list and send it around.
          </p>
          <IntentLink
            href="/tools/christmas-list"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-well text-[15px] font-semibold text-ink hover:bg-ink/10"
          >
            <Icon name="gift" size={17} /> Make my wish list
          </IntentLink>
        </Surface>
      )}

      {others.length > 0 && (
        <Surface className="grid gap-1">
          <p className="label">Other envelopes on this device</p>
          {others.map((entry) => (
            <button
              key={`${entry.x}.${entry.p}`}
              type="button"
              onClick={() => onOpen(entry)}
              className="flex min-h-12 items-center gap-3 rounded-[12px] px-2 text-left hover:bg-ink/5"
            >
              <Seal size={28} />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                {entry.title} · for {entry.for}
              </span>
            </button>
          ))}
        </Surface>
      )}

      <button
        type="button"
        onClick={onOrganize}
        className="mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-muted hover:bg-ink/5 hover:text-ink"
      >
        <Icon name="plus" size={15} /> Organize your own exchange
      </button>
    </div>
  );
}

function Detail({ icon, text }: { icon: 'wallet' | 'calendar'; text: string }) {
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-full bg-white/10 px-4 text-[14px] font-medium">
      <Icon name={icon} size={15} className="text-[#e2c77f]" /> {text}
    </span>
  );
}
