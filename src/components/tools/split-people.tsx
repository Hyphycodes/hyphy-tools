'use client';
import { useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { newId } from '@/lib/share/link-state';
import { allocate, type SplitBill } from '@/lib/tools/split';
import { Avatar, colorOf, initialOf, Paper } from './split-art';
import { ACCENT, nameOf, Title, type Money, type Result, type Update } from './split-parts';

/*
 * The people at the table, then who had what. Assigning works like a highlighter: pick someone
 * at the bottom (under the thumb) and tap the lines they had; each one lights up in their color.
 * Tap a line with a second person to share it. The dots on each line say who has it, and can be
 * tapped too.
 */

/* ---------------- names you split with before ---------------- */

const NAMES_KEY = 'hyphy.split.names';

function recentNames(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NAMES_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

export function rememberNames(names: string[]) {
  try {
    const seen = new Set<string>();
    const keep = [...names.map((name) => name.trim()), ...recentNames()].filter((name) => {
      const key = name.toLowerCase();
      if (!name || /^(you|me)$/i.test(name) || /^person \d+$/i.test(name) || seen.has(key))
        return false;
      seen.add(key);
      return true;
    });
    localStorage.setItem(NAMES_KEY, JSON.stringify(keep.slice(0, 8)));
  } catch {
    // Private mode or storage off: suggestions are a nicety.
  }
}

/* ---------------- who's splitting ---------------- */

export function PeopleView({ bill, update }: { bill: SplitBill; update: Update }) {
  const [name, setName] = useState('');
  // Only ever shown after the bill loads, so reading storage here never meets the server's HTML.
  const [recent] = useState(recentNames);
  const input = useRef<HTMLInputElement>(null);
  const full = bill.people.length >= 30;
  const add = (value = name) => {
    if (full) return;
    update({ people: [...bill.people, { id: `p${newId(6)}`, name: value.trim() }] });
    setName('');
    requestAnimationFrame(() => input.current?.focus());
  };
  const remove = (personId: string) =>
    update({
      people: bill.people.filter((person) => person.id !== personId),
      items: bill.items.map((item) => ({
        ...item,
        people: item.people.filter((sharer) => sharer !== personId),
      })),
    });

  const taken = new Set(bill.people.map((person) => person.name.trim().toLowerCase()));
  let guest = 'Guest';
  for (let number = 2; taken.has(guest.toLowerCase()); number += 1) guest = `Guest ${number}`;
  const suggestions = [
    ...(taken.has('you') || taken.has('me') ? [] : ['Me']),
    ...recent.filter((entry) => !taken.has(entry.toLowerCase())).slice(0, 5),
    guest,
  ];

  return (
    <div>
      <Title lead="Tap a name to change it.">Who’s splitting?</Title>

      <ul
        className="flex flex-wrap justify-center gap-x-2 gap-y-4 px-1 py-2"
        aria-label="At the table"
      >
        {bill.people.map((person, index) => {
          const shown = nameOf(bill, index);
          return (
            <li key={person.id} className="fx-pop relative flex w-[80px] flex-col items-center">
              <Avatar index={index} name={shown} size={64} className="text-[26px]" />
              {bill.people.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove ${shown}`}
                  title="Remove"
                  onClick={() => remove(person.id)}
                  className="absolute -top-2 -right-0.5 grid size-8 place-items-center rounded-full text-faint transition-colors hover:text-critical"
                >
                  <span className="grid size-6 place-items-center rounded-full bg-surface shadow-card">
                    <Icon name="x" size={12} strokeWidth={2.4} />
                  </span>
                </button>
              )}
              <input
                aria-label={`Person ${index + 1}’s name`}
                value={person.name}
                placeholder={index === 0 ? 'You' : `Person ${index + 1}`}
                maxLength={40}
                autoCapitalize="words"
                autoComplete="off"
                onChange={(event) =>
                  update({
                    people: bill.people.map((entry) =>
                      entry.id === person.id ? { ...entry, name: event.target.value } : entry,
                    ),
                  })
                }
                className="mt-1.5 h-9 w-full min-w-0 truncate rounded-[10px] bg-transparent px-1 text-center text-[15px] font-semibold text-ink outline-none placeholder:text-ink-2 focus:bg-ink/[.06]"
              />
            </li>
          );
        })}
        {!full && (
          <li className="flex w-[80px] flex-col items-center">
            <button
              type="button"
              aria-label="Add someone"
              onClick={() => input.current?.focus()}
              className="grid size-16 place-items-center rounded-full border-2 border-dashed border-line-strong text-muted transition-colors hover:border-ink/40 hover:text-ink"
            >
              <Icon name="plus" size={24} />
            </button>
          </li>
        )}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) add();
        }}
        className="mt-5 flex h-[60px] items-center gap-2.5 rounded-[20px] bg-surface pr-1.5 pl-2 shadow-card transition-shadow focus-within:shadow-[inset_0_0_0_2px_var(--accent-ink)]"
      >
        <Avatar index={bill.people.length} name={name.trim() || '+'} size={42} />
        <input
          ref={input}
          aria-label="Add a name"
          placeholder={full ? 'That’s a full table' : 'Add a name'}
          disabled={full}
          value={name}
          maxLength={40}
          autoCapitalize="words"
          autoComplete="off"
          enterKeyHint="next"
          autoFocus={bill.people.length < 2}
          onChange={(event) => setName(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={!name.trim() || full}
          className="h-11 shrink-0 rounded-[14px] px-5 text-[15px] font-semibold text-[var(--on-accent,#12110d)] transition-opacity disabled:opacity-30"
          style={{ background: ACCENT }}
        >
          Add
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2 px-1" role="group" aria-label="Quick add">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={full}
            onClick={() => add(suggestion)}
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-ink/[.06] px-4 text-[15px] font-medium text-ink-2 transition-[background-color,color,transform] hover:bg-ink/10 hover:text-ink active:scale-[.96] disabled:opacity-40"
          >
            <Icon name="plus" size={14} /> {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- who had what ---------------- */

const mix = (color: string, amount: number) =>
  `color-mix(in oklab, ${color} ${amount}%, transparent)`;

/** A line's highlight: one color, or stripes of everyone who shared it. */
function highlight(colors: string[]): CSSProperties | undefined {
  if (!colors.length) return undefined;
  if (colors.length === 1) return { background: mix(colors[0], 38) };
  const step = 100 / colors.length;
  const stops = colors.map(
    (color, index) => `${mix(color, 42)} ${index * step}% ${(index + 1) * step}%`,
  );
  return { background: `linear-gradient(90deg, ${stops.join(', ')})` };
}

export function AssignView({
  bill,
  update,
  money,
  result,
  onNext,
}: {
  bill: SplitBill;
  update: Update;
  money: Money;
  result: Result;
  onNext: () => void;
}) {
  /** Who's being painted: a person's id, or everyone (clears a line back to shared). */
  const [brush, setBrush] = useState<string>(() => bill.people[0]?.id ?? 'all');
  const [ping, setPing] = useState<{ id: string; n: number } | null>(null);
  const index = new Map(bill.people.map((person, position) => [person.id, position]));
  // Someone removed since? Back to the first person.
  const painting: number | null =
    brush === 'all' ? null : (index.get(brush) ?? (bill.people.length ? 0 : null));
  const brushId = painting === null ? 'all' : bill.people[painting].id;

  const setPeople = (itemId: string, people: (current: string[]) => string[]) => {
    update({
      items: bill.items.map((item) =>
        item.id === itemId ? { ...item, people: people(item.people) } : item,
      ),
    });
    setPing((last) => ({ id: itemId, n: (last?.n ?? 0) + 1 }));
  };
  const toggle = (itemId: string, personId: string) =>
    setPeople(itemId, (current) =>
      current.includes(personId)
        ? current.filter((entry) => entry !== personId)
        : [...current, personId],
    );
  const paint = (itemId: string) =>
    brushId === 'all' ? setPeople(itemId, () => []) : toggle(itemId, brushId);

  const priced = bill.items.filter((item) => item.price > 0);
  const left = priced.filter((item) => !item.people.some((personId) => index.has(personId))).length;
  const brushName = painting === null ? null : nameOf(bill, painting);

  return (
    <div>
      <Title lead="Pick someone below, then tap what they had.">Who had what?</Title>

      <Paper edges="both" className="px-2 pt-6 pb-7 sm:px-4">
        {bill.title.trim() && (
          <p className="mb-2 text-center font-display text-[17px] font-bold tracking-[-0.01em] uppercase opacity-80">
            {bill.title}
          </p>
        )}
        <div className="mx-2 mb-1 border-t-2 border-dashed border-current/20" />
        <ul className="grid grid-cols-1 gap-1" aria-label="Items">
          {bill.items.map((item) => {
            const sharers = item.people.filter((personId) => index.has(personId));
            const everyone = sharers.length === 0;
            const count = everyone ? bill.people.length : sharers.length;
            const parts = allocate(
              item.price,
              Array.from({ length: count }, () => 1),
            );
            const each = parts.length
              ? `${parts[0] === parts[parts.length - 1] ? '' : '~'}${money(parts[0])} each`
              : '';
            const colors = sharers.map((personId) => colorOf(index.get(personId)!));
            const mine = brushId !== 'all' && item.people.includes(brushId);
            const label = item.name || 'Item';
            return (
              <li
                key={item.id}
                className="fx-move relative rounded-[12px]"
                style={highlight(colors)}
              >
                {ping?.id === item.id && (
                  <span
                    key={ping.n}
                    aria-hidden="true"
                    className="fx-ping pointer-events-none absolute inset-0 rounded-[12px]"
                  />
                )}
                <button
                  type="button"
                  aria-pressed={brushId === 'all' ? everyone : mine}
                  aria-label={`${label}, ${money(item.price)}: ${
                    brushId === 'all' ? 'share with everyone' : `${brushName} had it`
                  }`}
                  onClick={() => paint(item.id)}
                  className="flex min-h-11 w-full items-baseline gap-3 rounded-[12px] px-3 pt-2.5 pb-0 text-left active:scale-[.99]"
                >
                  <span className="min-w-0 flex-1 text-[16.5px] leading-snug font-semibold">
                    {item.qty && item.qty > 1 ? (
                      <span className="mono-num mr-1 text-[13px] opacity-55">{item.qty}×</span>
                    ) : null}
                    {label}
                  </span>
                  <span className="mono-num shrink-0 text-[15px] font-semibold">
                    {money(item.price)}
                  </span>
                </button>
                <div className="flex items-center gap-2 pr-3 pb-0.5 pl-1">
                  <div
                    role="group"
                    aria-label={`Who had ${item.name || 'this'}`}
                    className="flex flex-wrap"
                  >
                    {bill.people.map((person, position) => {
                      const on = item.people.includes(person.id);
                      const who = nameOf(bill, position);
                      return (
                        <button
                          key={person.id}
                          type="button"
                          aria-pressed={on}
                          aria-label={who}
                          title={who}
                          onClick={() => toggle(item.id, person.id)}
                          className="grid size-10 place-items-center rounded-full"
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'fx-move grid size-[26px] place-items-center rounded-full text-[11.5px] font-bold',
                              on
                                ? 'scale-110 text-[var(--on-accent,#12110d)] shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)]'
                                : 'opacity-25 shadow-[inset_0_0_0_1.5px_currentColor]',
                            )}
                            style={on ? { background: colorOf(position) } : undefined}
                          >
                            {initialOf(who)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <span className="mono-num ml-auto shrink-0 text-right text-[11.5px] opacity-55">
                    {!everyone && count > 1 ? `${count} ways · ${each}` : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Paper>
      <p className="mt-3 px-1 text-center text-[13px] text-muted">
        Lines nobody claims are shared by everyone.
      </p>

      {/* The brush, under the thumb. */}
      <div className="sticky bottom-0 z-20 -mx-3 mt-2 bg-gradient-to-t from-canvas from-70% to-transparent px-3 pt-6 pb-[max(10px,env(safe-area-inset-bottom))] sm:mx-0 sm:px-0">
        <div className="mb-1.5 flex items-center justify-between gap-3 px-1 text-[13.5px]">
          <p aria-live="polite" className="min-w-0 truncate text-ink-2">
            {brushName === null ? (
              'Tap a line to share it with everyone'
            ) : (
              <>
                Tap what{' '}
                <span className="font-semibold text-ink">
                  {brushName === 'You' ? 'you' : brushName}
                </span>{' '}
                had
                <span className="mono-num ml-1.5 text-muted">
                  {money(result.people[painting!]?.subtotal ?? 0)}
                </span>
              </>
            )}
          </p>
          <p
            className={cn(
              'shrink-0 font-semibold',
              left ? 'text-muted' : 'text-[var(--accent-ink)]',
            )}
          >
            {left ? (
              `${left} left`
            ) : (
              <span className="fx-pop inline-flex items-center gap-1">
                <Icon name="check" size={14} strokeWidth={2.8} /> All claimed
              </span>
            )}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div
            role="radiogroup"
            aria-label="Tapping for"
            className="scrollbar-none -my-1 flex min-w-0 flex-1 gap-0.5 overflow-x-auto py-1 pl-1"
          >
            {bill.people.map((person, position) => {
              const on = painting === position;
              const who = nameOf(bill, position);
              return (
                <button
                  key={person.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setBrush(person.id)}
                  className="flex w-[50px] shrink-0 flex-col items-center gap-1 rounded-[14px] pt-1 pb-0.5"
                >
                  <Avatar
                    index={position}
                    name={who}
                    size={40}
                    className={cn(
                      'fx-move',
                      on
                        ? '-translate-y-0.5 ring-[3px] ring-ink ring-offset-2 ring-offset-[var(--color-canvas)]'
                        : 'opacity-80',
                    )}
                  />
                  <span
                    className={cn(
                      'w-full truncate text-center text-[11.5px]',
                      on ? 'font-semibold text-ink' : 'text-muted',
                    )}
                  >
                    {who}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              role="radio"
              aria-checked={painting === null}
              onClick={() => setBrush('all')}
              className="flex w-[50px] shrink-0 flex-col items-center gap-1 rounded-[14px] pt-1 pb-0.5"
            >
              <span
                className={cn(
                  'fx-move grid size-10 place-items-center rounded-full bg-ink/[.07] text-ink-2',
                  painting === null &&
                    '-translate-y-0.5 ring-[3px] ring-ink ring-offset-2 ring-offset-[var(--color-canvas)]',
                )}
              >
                <Icon name="people" size={19} />
              </span>
              <span
                className={cn(
                  'text-[11.5px]',
                  painting === null ? 'font-semibold text-ink' : 'text-muted',
                )}
              >
                All
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={onNext}
            className="mb-1 flex h-14 shrink-0 items-center gap-1.5 rounded-[18px] px-4 text-[15.5px] font-semibold text-[var(--on-accent,#12110d)] shadow-[0_14px_30px_-14px_var(--accent,transparent)] active:scale-[.97]"
            style={{ background: ACCENT }}
          >
            Tax and tip <Icon name="arrow-right" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
