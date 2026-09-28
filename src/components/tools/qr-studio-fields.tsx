'use client';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { normalizeLink, type Contact, type QrKind } from '@/lib/tools/qr-payloads';
import { Choices } from './kit';
import { pickContact, useCanPaste, useCanPickContacts } from './qr-studio-parts';

/*
 * Only the fields the chosen kind needs, each as short as it can be. Optional details fold to one
 * line until they're wanted; a phone can paste a link or pick a contact instead of typing.
 */

export type Wifi = {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
};

export type Fields = {
  url: string;
  text: string;
  wifi: Wifi;
  contact: Contact;
  phone: string;
  sms: { number: string; message: string };
  email: { to: string; subject: string; body: string };
};

const quiet = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const;

/** An optional field, folded to one line until it's wanted (or already has something in it). */
function Extra({
  label,
  filled,
  children,
}: {
  label: string;
  filled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(filled);
  const box = useRef<HTMLDivElement>(null);
  // Once something's in it, it stays open.
  if (filled && !open) setOpen(true);
  if (open)
    return (
      <div ref={box} className="fx-rise grid gap-3">
        {children}
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
        requestAnimationFrame(() =>
          box.current?.querySelector<HTMLElement>('input, textarea')?.focus(),
        );
      }}
      className="-ml-1 flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-[14px] font-medium text-[var(--accent-ink,var(--color-ink))] transition-colors hover:text-ink"
    >
      <span className="grid size-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent,var(--color-ink))_22%,transparent)]">
        <Icon name="plus" size={14} />
      </span>
      {label}
    </button>
  );
}

/** A small action inside a field's row: Paste, From contacts. */
function FieldAction({
  icon,
  children,
  onClick,
}: {
  icon: 'clipboard' | 'contact';
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fx-move inline-flex h-12 shrink-0 items-center gap-1.5 rounded-[11px] bg-ink/[.06] px-3.5 text-[14px] font-semibold text-ink-2 hover:bg-ink/10 hover:text-ink active:scale-[.96] lg:h-10 lg:text-[13.5px]"
    >
      <Icon name={icon} size={16} />
      {children}
    </button>
  );
}

export function ContentFields({
  kind,
  fields,
  set,
  idFor,
  linkWarning,
}: {
  kind: QrKind;
  fields: Fields;
  set: <K extends keyof Fields>(key: K, value: Fields[K]) => void;
  idFor: (name: string) => string;
  linkWarning: string;
}) {
  const canPaste = useCanPaste();
  const canPick = useCanPickContacts();
  const [problem, setProblem] = useState('');
  const { url, text, wifi, contact, phone, sms, email } = fields;

  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim();
      if (clip) set('url', normalizeLink(clip).slice(0, 2900));
      setProblem('');
    } catch {
      setProblem('Couldn’t read the clipboard. Long-press the field and paste instead.');
    }
  };

  const fromContacts = async (into: 'contact' | 'phone' | 'sms') => {
    try {
      const picked = await pickContact();
      if (!picked) return;
      if (into === 'phone') set('phone', picked.tel);
      else if (into === 'sms') set('sms', { ...sms, number: picked.tel });
      else {
        const [first, ...rest] = picked.name.split(/\s+/);
        set('contact', {
          ...contact,
          first: first ?? '',
          last: rest.join(' '),
          phone: picked.tel || contact.phone,
          email: picked.email || contact.email,
        });
      }
    } catch {
      setProblem('Couldn’t open your contacts. Type it in instead.');
    }
  };

  const problemLine = problem && <p className="text-[12.5px] text-critical">{problem}</p>;

  switch (kind) {
    case 'link':
      return (
        <div className="grid gap-2">
          <Field label="Link" htmlFor={idFor('url')} error={linkWarning || undefined}>
            <div className="flex gap-2">
              <Input
                id={idFor('url')}
                data-first-field
                aria-label="Link or text"
                type="url"
                inputMode="url"
                enterKeyHint="done"
                autoComplete="url"
                {...quiet}
                placeholder="yourshop.example/menu"
                value={url}
                onChange={(event) => set('url', event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                onBlur={() => url.trim() && set('url', normalizeLink(url))}
              />
              {canPaste && !url && (
                <FieldAction icon="clipboard" onClick={paste}>
                  Paste
                </FieldAction>
              )}
            </div>
          </Field>
          {problemLine}
        </div>
      );

    case 'text':
      return (
        <Field label="What it says" htmlFor={idFor('text')}>
          <Textarea
            id={idFor('text')}
            data-first-field
            rows={4}
            maxLength={1000}
            value={text}
            onChange={(event) => set('text', event.target.value)}
            placeholder="Welcome in! Ask us about today’s specials."
          />
        </Field>
      );

    case 'wifi':
      return (
        <div className="grid gap-4">
          <Field label="Network name" htmlFor={idFor('ssid')}>
            <Input
              id={idFor('ssid')}
              data-first-field
              autoComplete="off"
              enterKeyHint="next"
              {...quiet}
              placeholder="Salt & Ember Guest"
              value={wifi.ssid}
              onChange={(event) => set('wifi', { ...wifi, ssid: event.target.value })}
            />
          </Field>
          <Choices
            label="Security"
            value={wifi.security === 'nopass' ? 'nopass' : 'password'}
            onChange={(next) =>
              set('wifi', {
                ...wifi,
                security: next === 'nopass' ? 'nopass' : wifi.security === 'WEP' ? 'WEP' : 'WPA',
              })
            }
            options={[
              { value: 'password', label: 'Has a password', icon: 'lock' },
              { value: 'nopass', label: 'Open network' },
            ]}
          />
          {wifi.security !== 'nopass' && (
            <Field label="Password" htmlFor={idFor('pass')}>
              <Input
                id={idFor('pass')}
                autoComplete="off"
                enterKeyHint="done"
                {...quiet}
                value={wifi.password}
                onChange={(event) => set('wifi', { ...wifi, password: event.target.value })}
              />
            </Field>
          )}
          <Extra label="Hidden or older network?" filled={wifi.hidden || wifi.security === 'WEP'}>
            <div className="grid">
              <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-ink-2">
                <input
                  type="checkbox"
                  checked={wifi.hidden}
                  onChange={(event) => set('wifi', { ...wifi, hidden: event.target.checked })}
                  className="size-4.5 accent-[var(--accent-ink,var(--color-ink))]"
                />
                The network is hidden
              </label>
              <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-ink-2">
                <input
                  type="checkbox"
                  checked={wifi.security === 'WEP'}
                  onChange={(event) =>
                    set('wifi', { ...wifi, security: event.target.checked ? 'WEP' : 'WPA' })
                  }
                  className="size-4.5 accent-[var(--accent-ink,var(--color-ink))]"
                />
                <span>
                  It uses older security <span className="text-muted">(WEP)</span>
                </span>
              </label>
            </div>
          </Extra>
        </div>
      );

    case 'contact':
      return (
        <div className="grid grid-cols-2 gap-3">
          {canPick && (
            <div className="col-span-2">
              <FieldAction icon="contact" onClick={() => fromContacts('contact')}>
                Pick from my contacts
              </FieldAction>
            </div>
          )}
          <Field label="First name" htmlFor={idFor('c-first')}>
            <Input
              id={idFor('c-first')}
              data-first-field
              autoComplete="given-name"
              enterKeyHint="next"
              placeholder="Rosa"
              value={contact.first}
              onChange={(event) => set('contact', { ...contact, first: event.target.value })}
            />
          </Field>
          <Field label="Last name" htmlFor={idFor('c-last')}>
            <Input
              id={idFor('c-last')}
              autoComplete="family-name"
              enterKeyHint="next"
              placeholder="Delgado"
              value={contact.last}
              onChange={(event) => set('contact', { ...contact, last: event.target.value })}
            />
          </Field>
          <Field label="Phone" htmlFor={idFor('c-phone')} className="col-span-2">
            <Input
              id={idFor('c-phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              placeholder="+1 555 010 0199"
              value={contact.phone}
              onChange={(event) => set('contact', { ...contact, phone: event.target.value })}
            />
          </Field>
          <Field label="Email" htmlFor={idFor('c-email')} className="col-span-2">
            <Input
              id={idFor('c-email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="done"
              {...quiet}
              placeholder="rosa@saltandember.example"
              value={contact.email}
              onChange={(event) => set('contact', { ...contact, email: event.target.value })}
            />
          </Field>
          <div className="col-span-2 grid">
            <Extra
              label="Add company, website or a note"
              filled={Boolean(contact.org || contact.title || contact.url || contact.note)}
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Company" htmlFor={idFor('c-org')}>
                  <Input
                    id={idFor('c-org')}
                    autoComplete="organization"
                    enterKeyHint="next"
                    placeholder="Salt & Ember"
                    value={contact.org}
                    onChange={(event) => set('contact', { ...contact, org: event.target.value })}
                  />
                </Field>
                <Field label="Job title" htmlFor={idFor('c-title')}>
                  <Input
                    id={idFor('c-title')}
                    autoComplete="organization-title"
                    enterKeyHint="next"
                    placeholder="Owner"
                    value={contact.title}
                    onChange={(event) => set('contact', { ...contact, title: event.target.value })}
                  />
                </Field>
                <Field label="Website" htmlFor={idFor('c-url')} className="col-span-2">
                  <Input
                    id={idFor('c-url')}
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    enterKeyHint="next"
                    {...quiet}
                    placeholder="saltandember.example"
                    value={contact.url}
                    onChange={(event) => set('contact', { ...contact, url: event.target.value })}
                  />
                </Field>
                <Field label="Note" htmlFor={idFor('c-note')} className="col-span-2">
                  <Input
                    id={idFor('c-note')}
                    enterKeyHint="done"
                    value={contact.note}
                    onChange={(event) => set('contact', { ...contact, note: event.target.value })}
                  />
                </Field>
              </div>
            </Extra>
          </div>
          <div className="col-span-2 empty:hidden">{problemLine}</div>
        </div>
      );

    case 'phone':
      return (
        <div className="grid gap-2">
          <Field
            label="Phone number"
            htmlFor={idFor('phone')}
            hint="Add the country code for callers abroad."
          >
            <div className="flex gap-2">
              <Input
                id={idFor('phone')}
                data-first-field
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
                placeholder="+1 555 010 0199"
                value={phone}
                onChange={(event) => set('phone', event.target.value)}
              />
              {canPick && !phone && (
                <FieldAction icon="contact" onClick={() => fromContacts('phone')}>
                  Contacts
                </FieldAction>
              )}
            </div>
          </Field>
          {problemLine}
        </div>
      );

    case 'sms':
      return (
        <div className="grid gap-4">
          <Field label="Send to" htmlFor={idFor('sms-to')}>
            <div className="flex gap-2">
              <Input
                id={idFor('sms-to')}
                data-first-field
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
                placeholder="+1 555 010 0199"
                value={sms.number}
                onChange={(event) => set('sms', { ...sms, number: event.target.value })}
              />
              {canPick && !sms.number && (
                <FieldAction icon="contact" onClick={() => fromContacts('sms')}>
                  Contacts
                </FieldAction>
              )}
            </div>
          </Field>
          {problemLine}
          <Extra label="Add a ready-to-send message" filled={Boolean(sms.message)}>
            <Field label="Message" htmlFor={idFor('sms-body')} optional>
              <Textarea
                id={idFor('sms-body')}
                rows={3}
                maxLength={300}
                placeholder="Table for 4 tonight at 7?"
                value={sms.message}
                onChange={(event) => set('sms', { ...sms, message: event.target.value })}
              />
            </Field>
          </Extra>
        </div>
      );

    case 'email':
      return (
        <div className={cn('grid gap-4')}>
          <Field label="Email address" htmlFor={idFor('mail-to')}>
            <Input
              id={idFor('mail-to')}
              data-first-field
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="done"
              {...quiet}
              placeholder="hello@yourshop.example"
              value={email.to}
              onChange={(event) => set('email', { ...email, to: event.target.value })}
            />
          </Field>
          <Extra label="Add a subject and message" filled={Boolean(email.subject || email.body)}>
            <Field label="Subject" htmlFor={idFor('mail-subject')} optional>
              <Input
                id={idFor('mail-subject')}
                enterKeyHint="next"
                placeholder="Catering inquiry"
                value={email.subject}
                onChange={(event) => set('email', { ...email, subject: event.target.value })}
              />
            </Field>
            <Field label="Message" htmlFor={idFor('mail-body')} optional>
              <Textarea
                id={idFor('mail-body')}
                rows={3}
                value={email.body}
                onChange={(event) => set('email', { ...email, body: event.target.value })}
              />
            </Field>
          </Extra>
        </div>
      );
  }
}
