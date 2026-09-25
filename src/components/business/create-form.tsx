'use client';
import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { AuthField, Submit } from '@/components/auth/fields';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { createBusinessAction } from '@/lib/business/actions';
import { initialBusinessState } from '@/lib/business/form';
import { BASE_PATH } from '@/lib/base-path';
import { BUSINESS_TYPES, businessTypes, slugify } from '@/lib/platform/business-types';

/**
 * Create a business: a name, what kind it is, and (only if they want) its address. Seconds, not a
 * questionnaire. One request key per form, so a double submit makes one business.
 */
export function CreateBusinessForm({ host }: { host: string }) {
  const [state, action, pending] = useActionState(createBusinessAction, initialBusinessState);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(state.values?.name ?? '');
  const [type, setType] = useState(state.values?.type ?? '');
  const [chose, setChose] = useState(false);
  // Editing the address once they ask to, or once there's a problem with it.
  const editing = chose || Boolean(state.values?.address) || state.problem?.field === 'address';
  const [address, setAddress] = useState(state.values?.address ?? '');
  const form = useRef<HTMLFormElement>(null);
  const problemId = useId();
  const suggested = slugify(name);
  const shown = editing ? address : suggested;

  useEffect(() => {
    const field = state.problem?.field;
    if (!field) return;
    form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
  }, [state.at, state.problem?.field]);

  return (
    <form ref={form} action={action} noValidate className="grid gap-6">
      <input type="hidden" name="requestKey" value={requestKey} />
      <div id={problemId} role="alert" aria-live="assertive" className="empty:hidden">
        {state.problem && (
          <p
            className={cn(
              'flex gap-2.5 rounded-[12px] px-3.5 py-3 text-[14px] leading-snug animate-pop',
              /Demo Mode|real account/.test(state.problem.message)
                ? 'bg-caution-soft text-caution'
                : 'bg-critical-soft text-critical',
            )}
          >
            <Icon name="alert" size={17} className="mt-px" />
            <span>{state.problem.message}</span>
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <AuthField
          label="Business name"
          name="name"
          required
          maxLength={80}
          autoComplete="organization"
          autoCapitalize="words"
          placeholder="ABC Construction"
          value={name}
          onChange={(event) => setName(event.target.value)}
          invalid={state.problem?.field === 'name'}
          problemId={problemId}
        />
        <div className="flex min-w-0 items-center gap-2 px-0.5 text-[12.5px] text-muted">
          {editing ? (
            <label className="flex min-w-0 flex-1 items-center gap-1">
              <span className="shrink-0 text-faint">
                {host}
                {BASE_PATH}/
              </span>
              <input
                name="address"
                value={address}
                onChange={(event) =>
                  setAddress(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                maxLength={48}
                aria-label="Business address"
                aria-invalid={state.problem?.field === 'address' || undefined}
                autoCapitalize="none"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-[7px] bg-surface px-2 py-1 text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] focus:shadow-[inset_0_0_0_1.5px_var(--color-signal)] focus:outline-none"
              />
            </label>
          ) : (
            <>
              <span className="min-w-0 truncate">
                <span className="text-faint">
                  {host}
                  {BASE_PATH}/
                </span>
                <span className="text-ink-2">{shown || 'your-business'}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setAddress(suggested);
                  setChose(true);
                }}
                className="shrink-0 rounded-[6px] px-1 font-medium text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
              >
                Change
              </button>
            </>
          )}
        </div>
      </div>

      <fieldset className="grid gap-2.5">
        <legend className="mb-2.5 text-[13.5px] font-medium text-ink-2">
          What kind of business is it?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUSINESS_TYPES.map((id) => {
            const preset = businessTypes[id];
            const selected = type === id;
            return (
              <label
                key={id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[14px] px-3.5 py-3 transition-all',
                  selected
                    ? 'bg-signal-soft shadow-[inset_0_0_0_1.5px_var(--color-signal)]'
                    : 'bg-surface shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-subtle',
                )}
              >
                <input
                  type="radio"
                  name="type"
                  value={id}
                  checked={selected}
                  onChange={() => setType(id)}
                  className="sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2',
                    selected ? 'border-signal bg-signal' : 'border-line-strong',
                  )}
                >
                  {selected && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-semibold text-ink">{preset.label}</span>
                  <span className="block text-[12.5px] leading-snug text-muted">{preset.line}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="text-[12.5px] text-muted">
          This sets starting words and tools. You can change both later.
        </p>
      </fieldset>

      <Submit pending={pending} pendingLabel="Creating business…">
        Create business
      </Submit>
    </form>
  );
}
