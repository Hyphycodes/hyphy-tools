'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { decodeState, clearHash, linkFor, newId } from '@/lib/share/link-state';
import { useLocalState } from '@/lib/share/local';
import {
  computeSplit,
  CURRENCIES,
  formatMoney,
  newBill,
  splitBillSchema,
  splitSummary,
  type SplitBill,
} from '@/lib/tools/split';
import { CopyButton, IconButton, Label, Note, Surface } from './kit';
import { MoneyInput } from './money-input';
import { ShareLinkCard } from './share-link';

/*
 * Split: who had what, shared plates split between the people who shared them, tax and tip in
 * proportion, every total exact to the cent. The bill is kept in this browser; sharing puts a
 * read-only copy inside a link.
 */

const COLORS = [
  '#b8f35a',
  '#8f9bff',
  '#ff8ad8',
  '#ffc53d',
  '#7ce0c3',
  '#ff9e7a',
  '#c7b5ff',
  '#7fd4ff',
];
const TIPS = [15, 18, 20, 22];

const colorOf = (bill: SplitBill, personId: string) =>
  COLORS[
    Math.max(
      0,
      bill.people.findIndex((person) => person.id === personId),
    ) % COLORS.length
  ];
const nameOf = (bill: SplitBill, personId: string) => {
  const index = bill.people.findIndex((person) => person.id === personId);
  return bill.people[index]?.name.trim() || `Person ${index + 1}`;
};

function PersonDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2.5 shrink-0 rounded-full', className)}
      style={{ background: color }}
    />
  );
}

export function SplitTool() {
  const id = useId();
  const [bill, setBill, { loaded, reset }] = useLocalState<SplitBill>(
    'hyphy.split.v1',
    splitBillSchema,
    newBill(),
  );
  const [shared, setShared] = useState<SplitBill | null>(null);
  const [newName, setNewName] = useState('');
  const [addPrice, setAddPrice] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const itemName = useRef<HTMLInputElement>(null);

  // A shared bill arrives in the link: show it, read-only, until someone makes a copy.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.length < 3) return;
    void decodeState(hash, splitBillSchema).then((value) => value && setShared(value));
  }, []);

  const view = shared ?? bill;
  const editable = !shared;
  const result = useMemo(() => computeSplit(view), [view]);
  const money = (amount: number) => formatMoney(amount, view.currency);
  const update = (patch: Partial<SplitBill>) => setBill((current) => ({ ...current, ...patch }));

  const addPerson = (name = '') => {
    if (bill.people.length >= 30) return;
    update({ people: [...bill.people, { id: `p${newId(6)}`, name }] });
  };
  const addItem = () => {
    const name = newName.trim();
    const price = addPrice;
    if (!name && !price) return;
    update({
      items: [
        ...bill.items,
        { id: `i${newId(6)}`, name: name || `Item ${bill.items.length + 1}`, price, people: [] },
      ],
    });
    setNewName('');
    setAddPrice(0);
    requestAnimationFrame(() => itemName.current?.focus());
  };
  const toggleSharer = (itemId: string, personId: string) =>
    update({
      items: bill.items.map((item) => {
        if (item.id !== itemId) return item;
        const on = item.people.includes(personId);
        const next = on
          ? item.people.filter((person) => person !== personId)
          : [...item.people, personId];
        // Everyone ticked is the same as "everyone".
        return { ...item, people: next.length === bill.people.length ? [] : next };
      }),
    });

  const unnamed = view.people.filter((person) => !person.name.trim()).length;
  const emptyBill = view.mode === 'items' ? view.items.length === 0 : view.total === 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,.9fr)] lg:items-start">
      <div className="grid min-w-0 gap-5">
        {shared && (
          <Note icon="link" className="!items-center">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span>
                A bill someone shared with you. Find your name on the right to see what you owe.
              </span>
              <button
                type="button"
                onClick={() => {
                  setBill({ ...shared });
                  setShared(null);
                  clearHash();
                }}
                className="font-semibold text-ink underline underline-offset-2"
              >
                Edit a copy
              </button>
            </span>
          </Note>
        )}

        <Surface className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              aria-label="What’s the bill for?"
              placeholder="What’s it for? Dinner at Rosa’s"
              value={view.title}
              disabled={!editable}
              maxLength={80}
              onChange={(event) => update({ title: event.target.value })}
              className="h-12 min-w-0 rounded-[12px] bg-transparent px-1 text-[20px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint focus:bg-subtle focus:px-3 disabled:opacity-100"
            />
            <div className="flex gap-2">
              <div
                role="radiogroup"
                aria-label="How to split"
                className="flex rounded-[12px] bg-well p-1"
              >
                {(
                  [
                    ['items', 'By item'],
                    ['even', 'Evenly'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={view.mode === mode}
                    disabled={!editable}
                    onClick={() => update({ mode })}
                    className={cn(
                      'h-9 rounded-[9px] px-3.5 text-[13.5px] font-medium transition-colors',
                      view.mode === mode
                        ? 'bg-surface text-ink shadow-card'
                        : 'text-muted hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                aria-label="Currency"
                value={view.currency}
                disabled={!editable}
                onChange={(event) => update({ currency: event.target.value })}
                className="h-11 rounded-[12px] bg-well px-2.5 text-[13.5px] text-ink-2 outline-none"
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <section aria-labelledby={`${id}-people`} className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label id={`${id}-people`}>Who’s splitting · {view.people.length}</Label>
              {unnamed > 0 && editable && (
                <span className="text-[12px] text-muted">Tap a name to change it</span>
              )}
            </div>
            <ul className="flex flex-wrap gap-2">
              {view.people.map((person, index) => (
                <li
                  key={person.id}
                  className="flex h-11 items-center gap-2 rounded-full bg-subtle pr-1 pl-3 shadow-[inset_0_0_0_1px_var(--color-line)] lg:h-10"
                >
                  <PersonDot color={COLORS[index % COLORS.length]} />
                  <input
                    aria-label={`Person ${index + 1}’s name`}
                    value={person.name}
                    disabled={!editable}
                    placeholder={`Person ${index + 1}`}
                    maxLength={40}
                    onChange={(event) =>
                      update({
                        people: bill.people.map((item) =>
                          item.id === person.id ? { ...item, name: event.target.value } : item,
                        ),
                      })
                    }
                    style={{
                      width: `${Math.max(7, (person.name || `Person ${index + 1}`).length + 1)}ch`,
                    }}
                    className="min-w-0 bg-transparent text-[14.5px] text-ink outline-none placeholder:text-faint"
                  />
                  {editable && view.people.length > 1 && (
                    <IconButton
                      icon="x"
                      size="sm"
                      label={`Remove ${nameOf(view, person.id)}`}
                      onClick={() =>
                        update({
                          people: bill.people.filter((item) => item.id !== person.id),
                          items: bill.items.map((item) => ({
                            ...item,
                            people: item.people.filter((sharer) => sharer !== person.id),
                          })),
                        })
                      }
                      className="!size-8 !rounded-full"
                    />
                  )}
                </li>
              ))}
              {editable && (
                <li>
                  <button
                    type="button"
                    onClick={() => addPerson()}
                    className="flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-ink/5 hover:text-ink lg:h-10"
                  >
                    <Icon name="user-plus" size={15} /> Add a person
                  </button>
                </li>
              )}
            </ul>
          </section>

          {view.mode === 'items' ? (
            <section aria-labelledby={`${id}-items`} className="grid gap-3">
              <div className="flex items-center justify-between">
                <Label id={`${id}-items`}>What everyone had</Label>
                <span className="mono-num text-[12px] text-muted">
                  {view.items.length} {view.items.length === 1 ? 'item' : 'items'} ·{' '}
                  {money(result.subtotal)}
                </span>
              </div>
              {view.items.length > 0 && (
                <ul className="grid gap-2">
                  {view.items.map((item) => (
                    <li
                      key={item.id}
                      className="grid gap-2.5 rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          aria-label="Item"
                          value={item.name}
                          disabled={!editable}
                          maxLength={80}
                          onChange={(event) =>
                            update({
                              items: bill.items.map((entry) =>
                                entry.id === item.id
                                  ? { ...entry, name: event.target.value }
                                  : entry,
                              ),
                            })
                          }
                          className="h-10 min-w-0 flex-1 rounded-[10px] bg-transparent px-1 text-[15px] font-medium text-ink outline-none focus:bg-surface focus:px-2.5"
                        />
                        {editable ? (
                          <MoneyInput
                            label={`Price of ${item.name}`}
                            value={item.price}
                            currency={view.currency}
                            onChange={(price) =>
                              update({
                                items: bill.items.map((entry) =>
                                  entry.id === item.id ? { ...entry, price } : entry,
                                ),
                              })
                            }
                            className="w-[112px]"
                          />
                        ) : (
                          <span className="mono-num px-2 text-[14px] text-ink">
                            {money(item.price)}
                          </span>
                        )}
                        {editable && (
                          <IconButton
                            icon="trash"
                            tone="danger"
                            label={`Remove ${item.name}`}
                            onClick={() =>
                              update({ items: bill.items.filter((entry) => entry.id !== item.id) })
                            }
                          />
                        )}
                      </div>
                      <div
                        className="flex flex-wrap items-center gap-1.5"
                        role="group"
                        aria-label={`Who had ${item.name}`}
                      >
                        <button
                          type="button"
                          aria-pressed={item.people.length === 0}
                          disabled={!editable}
                          onClick={() =>
                            update({
                              items: bill.items.map((entry) =>
                                entry.id === item.id ? { ...entry, people: [] } : entry,
                              ),
                            })
                          }
                          className={cn(
                            'h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors',
                            item.people.length === 0
                              ? 'bg-ink text-on-ink'
                              : 'bg-well text-muted hover:text-ink',
                          )}
                        >
                          Everyone
                        </button>
                        {view.people.map((person, index) => {
                          const on = item.people.includes(person.id);
                          return (
                            <button
                              key={person.id}
                              type="button"
                              aria-pressed={on}
                              disabled={!editable}
                              onClick={() => toggleSharer(item.id, person.id)}
                              className={cn(
                                'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium transition-colors',
                                on
                                  ? 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]'
                                  : 'bg-well text-muted hover:text-ink',
                              )}
                            >
                              <PersonDot
                                color={COLORS[index % COLORS.length]}
                                className="!size-2"
                              />
                              {nameOf(view, person.id)}
                            </button>
                          );
                        })}
                        {item.people.length > 1 && item.price > 0 && (
                          <span className="mono-num ml-auto text-[11.5px] text-muted">
                            {money(Math.floor(item.price / item.people.length))} each
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {editable && (
                <div className="flex flex-wrap items-center gap-2 rounded-[16px] p-1">
                  <input
                    ref={itemName}
                    aria-label="New item"
                    placeholder={
                      view.items.length ? 'Add another item' : 'Add the first item — Margherita'
                    }
                    value={newName}
                    maxLength={80}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        document.getElementById(`${id}-new-price`)?.focus();
                      }
                    }}
                    className="h-11 min-w-0 flex-1 basis-[180px] rounded-[11px] bg-subtle px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14.5px]"
                  />
                  <MoneyInput
                    key={`add-${view.items.length}-${view.currency}`}
                    id={`${id}-new-price`}
                    label="New item’s price"
                    value={addPrice}
                    currency={view.currency}
                    onChange={setAddPrice}
                    onEnter={addItem}
                    className="w-[120px]"
                  />
                  <button
                    type="button"
                    onClick={addItem}
                    disabled={!newName.trim() && !addPrice}
                    className="inline-flex h-11 items-center gap-1.5 rounded-[11px] bg-ink px-4 text-[14.5px] font-medium text-on-ink disabled:opacity-40 lg:h-10"
                  >
                    <Icon name="plus" size={16} /> Add
                  </button>
                </div>
              )}
            </section>
          ) : (
            <section aria-labelledby={`${id}-total`} className="grid gap-3">
              <Label id={`${id}-total`}>The amount to split</Label>
              {editable ? (
                <MoneyInput
                  label="Amount to split"
                  value={view.total}
                  currency={view.currency}
                  onChange={(total) => update({ total })}
                  inputClassName="!h-14 !text-[24px] font-semibold"
                />
              ) : (
                <p className="mono-num text-[24px] font-semibold text-ink">{money(view.total)}</p>
              )}
              <p className="text-[13px] text-muted">
                Before tax and tip, or leave those at zero if the total already has them.
              </p>
            </section>
          )}

          {editable && (
            <section
              aria-labelledby={`${id}-extras`}
              className="grid gap-4 border-t border-line pt-5"
            >
              <Label id={`${id}-extras`}>Tax and tip</Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid content-start gap-2">
                  <span className="text-[13.5px] font-medium text-ink-2">Tax</span>
                  <div className="flex gap-2">
                    {view.tax.mode === 'amount' ? (
                      <MoneyInput
                        key={`tax-${view.currency}`}
                        label="Tax amount"
                        value={view.tax.value}
                        currency={view.currency}
                        onChange={(value) => update({ tax: { mode: 'amount', value } })}
                        className="flex-1"
                      />
                    ) : (
                      <PercentInput
                        label="Tax rate"
                        value={view.tax.value}
                        disabled={!editable}
                        onChange={(value) => update({ tax: { mode: 'percent', value } })}
                      />
                    )}
                    <UnitToggle
                      value={view.tax.mode === 'amount' ? 'amount' : 'percent'}
                      disabled={!editable}
                      onChange={(mode) => update({ tax: { mode, value: 0 } })}
                      label="Tax as"
                    />
                  </div>
                </div>
                <div className="grid content-start gap-2">
                  <span className="text-[13.5px] font-medium text-ink-2">Tip</span>
                  <div className="flex flex-wrap gap-1.5">
                    {TIPS.map((tip) => (
                      <button
                        key={tip}
                        type="button"
                        disabled={!editable}
                        aria-pressed={view.tip.mode === 'percent' && view.tip.value === tip}
                        onClick={() =>
                          update({ tip: { ...view.tip, mode: 'percent', value: tip } })
                        }
                        className={cn(
                          'h-10 min-w-[52px] rounded-[10px] px-2 text-[13.5px] font-medium transition-colors',
                          view.tip.mode === 'percent' && view.tip.value === tip
                            ? 'bg-ink text-on-ink'
                            : 'bg-well text-ink-2 hover:bg-ink/10',
                        )}
                      >
                        {tip}%
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={!editable}
                      aria-pressed={view.tip.value === 0}
                      onClick={() => update({ tip: { ...view.tip, mode: 'percent', value: 0 } })}
                      className={cn(
                        'h-10 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors',
                        view.tip.value === 0
                          ? 'bg-ink text-on-ink'
                          : 'bg-well text-ink-2 hover:bg-ink/10',
                      )}
                    >
                      None
                    </button>
                  </div>
                  <div className="flex gap-2">
                    {view.tip.mode === 'amount' ? (
                      <MoneyInput
                        key={`tip-${view.currency}`}
                        label="Tip amount"
                        value={view.tip.value}
                        currency={view.currency}
                        onChange={(value) =>
                          update({ tip: { ...view.tip, mode: 'amount', value } })
                        }
                        className="flex-1"
                      />
                    ) : (
                      <PercentInput
                        label="Tip percent"
                        value={view.tip.value}
                        disabled={!editable}
                        onChange={(value) =>
                          update({ tip: { ...view.tip, mode: 'percent', value } })
                        }
                      />
                    )}
                    <UnitToggle
                      value={view.tip.mode}
                      disabled={!editable}
                      onChange={(mode) =>
                        update({ tip: { ...view.tip, mode, value: mode === 'percent' ? 18 : 0 } })
                      }
                      label="Tip as"
                    />
                  </div>
                  {view.tip.mode === 'percent' && (
                    <label className="flex items-center gap-2 text-[13px] text-muted">
                      <input
                        type="checkbox"
                        checked={view.tip.afterTax}
                        disabled={!editable}
                        onChange={(event) =>
                          update({ tip: { ...view.tip, afterTax: event.target.checked } })
                        }
                        className="size-4 accent-[var(--color-ink)]"
                      />
                      Tip on the total with tax
                    </label>
                  )}
                </div>
              </div>
            </section>
          )}
        </Surface>
      </div>

      {/* The answer: what each person pays. Sticky beside the bill on a big screen. */}
      <aside aria-label="Totals" className="grid gap-4 lg:sticky lg:top-24">
        <Surface className="grid gap-5 !p-5 sm:!p-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="label">Total</p>
              <p
                className="mt-1 font-display text-[40px] leading-none font-extrabold tracking-[-0.04em] text-ink"
                style={{ fontVariationSettings: "'wdth' 110" }}
              >
                {money(result.total)}
              </p>
            </div>
            <p className="mono-num text-right text-[12px] leading-relaxed text-muted">
              {money(result.subtotal)} before extras
              {result.tax > 0 && (
                <>
                  <br />+ {money(result.tax)} tax
                </>
              )}
              {result.tip > 0 && (
                <>
                  <br />+ {money(result.tip)} tip
                </>
              )}
            </p>
          </div>
          <ul className="grid gap-1.5" aria-live="polite">
            {result.people.map((person, index) => {
              const expanded = open === person.id;
              return (
                <li
                  key={person.id}
                  className="rounded-[14px] bg-subtle shadow-[inset_0_0_0_1px_var(--color-line)]"
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : person.id)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                  >
                    <PersonDot color={colorOf(view, person.id)} className="!size-3" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
                      {person.name.trim() || `Person ${index + 1}`}
                    </span>
                    <span className="mono-num text-[17px] font-semibold text-ink">
                      {money(person.total)}
                    </span>
                    <Icon
                      name="chevron-down"
                      size={15}
                      className={cn('text-muted transition-transform', expanded && 'rotate-180')}
                    />
                  </button>
                  {expanded && (
                    <div className="grid animate-fade gap-1 border-t border-line px-3.5 py-3 text-[13px]">
                      {person.items.length === 0 && view.mode === 'items' && (
                        <p className="text-muted">Nothing assigned yet.</p>
                      )}
                      {person.items.map((line) => (
                        <p key={line.id} className="flex justify-between gap-3 text-ink-2">
                          <span className="truncate">
                            {line.name}
                            {line.split > 1 && (
                              <span className="text-muted"> · shared by {line.split}</span>
                            )}
                          </span>
                          <span className="mono-num">{money(line.share)}</span>
                        </p>
                      ))}
                      {view.mode === 'even' && (
                        <p className="flex justify-between text-ink-2">
                          <span>An even share</span>
                          <span className="mono-num">{money(person.subtotal)}</span>
                        </p>
                      )}
                      {person.tax > 0 && (
                        <p className="flex justify-between text-muted">
                          <span>Tax</span>
                          <span className="mono-num">{money(person.tax)}</span>
                        </p>
                      )}
                      {person.tip > 0 && (
                        <p className="flex justify-between text-muted">
                          <span>Tip</span>
                          <span className="mono-num">{money(person.tip)}</span>
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {emptyBill ? (
            <p className="text-[13.5px] text-muted">
              {view.mode === 'items'
                ? 'Add what everyone had and the totals fill in as you type.'
                : 'Type the amount to split.'}
            </p>
          ) : (
            <div className="grid gap-3 border-t border-line pt-4">
              <CopyButton
                text={splitSummary(view, result)}
                label="Copy the totals for the group chat"
                what="Totals copied — paste them in the chat"
                variant="solid"
                className="!h-11 w-full"
              />
              {editable && (
                <ShareLinkCard
                  title={view.title || 'Our bill'}
                  cta="Share the bill as a link"
                  build={() => linkFor(bill)}
                />
              )}
            </div>
          )}
        </Surface>
        {editable && loaded && !emptyBill && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('Start a new bill? This one will be cleared from this browser.'))
                reset(newBill());
            }}
            className="justify-self-start px-1 text-[13.5px] text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            Start a new bill
          </button>
        )}
      </aside>
    </div>
  );
}

function PercentInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative flex-1">
      <input
        aria-label={label}
        inputMode="decimal"
        disabled={disabled}
        value={focused ? text : value ? String(value) : ''}
        placeholder="0"
        onFocus={() => {
          setText(value ? String(value) : '');
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value.replace(',', '.'));
          onChange(Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 100) : 0);
        }}
        className="num h-11 w-full rounded-[11px] bg-subtle pr-8 pl-3 text-right text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:h-10 lg:text-[14.5px]"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] text-muted">
        %
      </span>
    </div>
  );
}

function UnitToggle({
  value,
  onChange,
  label,
  disabled,
}: {
  value: 'amount' | 'percent';
  onChange: (value: 'amount' | 'percent') => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-[11px] bg-well p-1">
      {(
        [
          ['amount', '$'],
          ['percent', '%'],
        ] as const
      ).map(([unit, text]) => (
        <button
          key={unit}
          type="button"
          role="radio"
          aria-checked={value === unit}
          aria-label={unit === 'amount' ? 'An amount' : 'A percent'}
          disabled={disabled}
          onClick={() => value !== unit && onChange(unit)}
          className={cn(
            'size-9 rounded-[8px] text-[14px] font-semibold transition-colors lg:size-8',
            value === unit ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
