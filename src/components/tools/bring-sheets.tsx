'use client';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { Sheet } from '@/components/ui/sheet';
import { CATEGORIES, CATEGORY_NAMES, type BringItem, type Category } from '@/lib/tools/bring';
import type { Claim, Claimer } from '@/lib/tools/claims';
import { CategoryMark, PersonDot } from './bring-art';

/*
 * Tap a thing on the list: who's bringing it (you, someone already on the list, or someone new),
 * and, for the organizer, the thing itself (name, how much, what kind, where, or gone).
 */

const nameOf = (item: Pick<BringItem, 'name'> | undefined) => item?.name.trim() || 'Something';

/** "2 bags" → "3 bags"; "" → "2". Null when the amount isn't a number to count up or down. */
export function stepQty(qty: string, delta: 1 | -1): string | null {
  const text = qty.trim();
  if (!text) return delta > 0 ? '2' : null;
  const match = text.match(/^(\d{1,4})(\s.*)?$/);
  if (!match) return null;
  const from = Number(match[1]);
  const to = from + delta;
  if (to < 1) return '';
  let rest = match[2] ?? '';
  if (to === 1 && /[^s]s$/i.test(rest)) rest = rest.slice(0, -1);
  else if (from === 1 && to > 1 && /[a-z]$/i.test(rest) && !/s$/i.test(rest)) rest += 's';
  return `${to}${rest}`.slice(0, 30);
}

const field =
  'h-11 w-full min-w-0 rounded-[12px] bg-surface px-3 text-[16px] text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] outline-none placeholder:text-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] lg:text-[14.5px]';

function PersonChip({
  name,
  label,
  on = false,
  onClick,
}: {
  name: string;
  label?: string;
  on?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-12 items-center gap-2 rounded-full py-1.5 pr-4 pl-1.5 text-[15px] font-medium transition-[background-color,box-shadow,transform] active:scale-[.97]',
        on
          ? 'bg-signal-soft text-ink shadow-[inset_0_0_0_1.5px_var(--accent-ink,var(--color-ink))]'
          : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
      )}
    >
      <PersonDot name={name} size={34} />
      {label ?? name}
    </button>
  );
}

/** A name typed right there, with its own button: "Your name" or "Someone else". */
function NameEntry({
  label,
  placeholder,
  action,
  onSave,
  onCancel,
  autoFocus = true,
}: {
  label: string;
  placeholder: string;
  action: string;
  onSave: (name: string) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSave(name.trim());
  };
  return (
    <form onSubmit={submit} className="fx-rise flex w-full gap-2">
      <input
        aria-label={label}
        value={name}
        maxLength={40}
        placeholder={placeholder}
        autoComplete="given-name"
        enterKeyHint="done"
        autoFocus={autoFocus}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onCancel) {
            event.stopPropagation();
            onCancel();
          }
        }}
        className={cn(field, 'h-12 flex-1')}
      />
      <button
        type="submit"
        disabled={!name.trim()}
        className="inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[12px] px-4 text-[15px] font-semibold text-[var(--on-accent,#12110d)] transition-opacity disabled:opacity-40"
        style={{ background: 'var(--accent, var(--color-ink))' }}
      >
        {action}
      </button>
    </form>
  );
}

export function ItemSheet({
  item,
  record,
  canRelease,
  organizer,
  me,
  people,
  canUp,
  canDown,
  onMe,
  onPerson,
  onRelease,
  onEdit,
  onMove,
  onRemove,
  onClose,
}: {
  item: BringItem | undefined;
  record: Claim | null;
  /** The claim was made on this device (yours, or someone you put down). */
  canRelease: boolean;
  organizer: boolean;
  me: Claimer | null;
  /** Other people to offer, by name. */
  people: string[];
  canUp: boolean;
  canDown: boolean;
  onMe: (name?: string) => void;
  onPerson: (name: string) => void;
  onRelease: () => void;
  onEdit: (change: { name?: string; qty?: string; cat?: Category }) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const name = nameOf(item);
  return (
    <Sheet
      open={Boolean(item)}
      onClose={onClose}
      width="sm"
      title={record ? name : `Who’s bringing ${name}?`}
      description={item?.qty.trim() || undefined}
    >
      {item && (
        <SheetBody
          key={item.id}
          item={item}
          record={record}
          canRelease={canRelease}
          organizer={organizer}
          me={me}
          people={people}
          canUp={canUp}
          canDown={canDown}
          onMe={onMe}
          onPerson={onPerson}
          onRelease={onRelease}
          onEdit={onEdit}
          onMove={onMove}
          onRemove={onRemove}
        />
      )}
    </Sheet>
  );
}

function SheetBody({
  item,
  record,
  canRelease,
  organizer,
  me,
  people,
  canUp,
  canDown,
  onMe,
  onPerson,
  onRelease,
  onEdit,
  onMove,
  onRemove,
}: Omit<Parameters<typeof ItemSheet>[0], 'item' | 'onClose'> & { item: BringItem }) {
  const id = useId();
  const [someone, setSomeone] = useState(false);
  const myName = me?.name.trim() ?? '';
  const holderName = record ? record.name.trim() || 'Someone' : '';
  const mine = Boolean(record && me && record.by === me.id);
  const others = people.filter((person) => person.toLowerCase() !== myName.toLowerCase());
  const choosing = !record || canRelease;
  const up = stepQty(item.qty, 1);
  const down = stepQty(item.qty, -1);

  return (
    <div className="grid gap-6 pt-1">
      {record && (
        <div className="fx-pop flex items-center gap-3 rounded-[18px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
          <PersonDot name={holderName} size={44} />
          <p className="min-w-0 flex-1 text-[16px] leading-snug font-semibold text-ink">
            {mine ? 'You’re bringing it' : `${holderName} is bringing it`}
          </p>
          {canRelease && (
            <button
              type="button"
              onClick={onRelease}
              className="inline-flex h-11 shrink-0 items-center rounded-full bg-well px-4 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              {mine ? 'Not anymore' : 'Nobody yet'}
            </button>
          )}
        </div>
      )}

      {choosing && (
        <section aria-labelledby={`${id}-who`} className="grid gap-3">
          <h3 id={`${id}-who`} className="label">
            {record ? 'Someone else instead?' : 'Tap who’s bringing it'}
          </h3>
          {!myName && !record ? (
            <NameEntry
              label="Your name"
              placeholder="Your name"
              action="That’s me"
              autoFocus={false}
              onSave={(name) => onMe(name)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {myName && !mine && <PersonChip name={myName} label="Me" onClick={() => onMe()} />}
            {others
              .filter((person) => person.toLowerCase() !== holderName.toLowerCase())
              .map((person) => (
                <PersonChip key={person} name={person} onClick={() => onPerson(person)} />
              ))}
            {!someone && (
              <button
                type="button"
                onClick={() => setSomeone(true)}
                className="inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-dashed border-line-strong py-1.5 pr-4 pl-1.5 text-[15px] font-medium text-ink-2 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <span className="grid size-[34px] place-items-center rounded-full bg-well">
                  <Icon name="plus" size={16} />
                </span>
                Someone else
              </button>
            )}
          </div>
          {someone && (
            <NameEntry
              label="Their name"
              placeholder="Their name"
              action="Save"
              onSave={onPerson}
              onCancel={() => setSomeone(false)}
            />
          )}
        </section>
      )}

      {organizer && (
        <section aria-labelledby={`${id}-item`} className="grid gap-3 border-t border-line pt-5">
          <h3 id={`${id}-item`} className="label">
            The item
          </h3>
          <input
            aria-label="What’s needed"
            value={item.name}
            maxLength={80}
            placeholder="What’s needed"
            onChange={(event) => onEdit({ name: event.target.value })}
            className={field}
          />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-well p-1">
              <button
                type="button"
                aria-label={`Fewer ${nameOf(item)}`}
                disabled={down === null}
                onClick={() => down !== null && onEdit({ qty: down })}
                className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
              >
                <Icon name="minus" size={16} />
              </button>
              <input
                aria-label={`How much ${nameOf(item)}`}
                value={item.qty}
                maxLength={30}
                placeholder="Any"
                onChange={(event) => onEdit({ qty: event.target.value })}
                className="h-10 w-[92px] min-w-0 bg-transparent text-center text-[15px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-faint"
              />
              <button
                type="button"
                aria-label={`More ${nameOf(item)}`}
                disabled={up === null}
                onClick={() => up !== null && onEdit({ qty: up })}
                className="grid size-10 place-items-center rounded-full text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
              >
                <Icon name="plus" size={16} />
              </button>
            </span>
          </div>
          <div role="radiogroup" aria-label="What kind" className="grid grid-cols-4 gap-1.5">
            {CATEGORIES.map((cat) => {
              const on = item.cat === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onEdit({ cat })}
                  className={cn(
                    'grid min-h-[68px] justify-items-center gap-1 rounded-[14px] p-2 text-[12.5px] font-medium transition-[background-color,box-shadow]',
                    on
                      ? 'bg-signal-soft text-ink shadow-[inset_0_0_0_1.5px_var(--accent-ink,var(--color-ink))]'
                      : 'bg-subtle text-ink-2 hover:bg-ink/[.06]',
                  )}
                >
                  <CategoryMark cat={cat} size={30} />
                  {CATEGORY_NAMES[cat]}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={`Move ${nameOf(item)} up`}
              disabled={!canUp}
              onClick={() => onMove(-1)}
              className="grid size-11 place-items-center rounded-full bg-well text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
            >
              <Icon name="arrow-up" size={17} />
            </button>
            <button
              type="button"
              aria-label={`Move ${nameOf(item)} down`}
              disabled={!canDown}
              onClick={() => onMove(1)}
              className="grid size-11 place-items-center rounded-full bg-well text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink disabled:opacity-30"
            >
              <Icon name="arrow-down" size={17} />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="ml-auto inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-muted transition-colors hover:bg-critical-soft hover:text-critical"
            >
              <Icon name="trash" size={15} /> Remove {nameOf(item)}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function NameSheet({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [name, setName] = useState(initial);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      width="sm"
      title="Your name on the list"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={`${id}-form`} disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form
        id={`${id}-form`}
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name);
        }}
        className="grid gap-3 pt-1"
      >
        <Field label="Your name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            data-autofocus
            value={name}
            maxLength={40}
            autoComplete="given-name"
            placeholder="Dana"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}
