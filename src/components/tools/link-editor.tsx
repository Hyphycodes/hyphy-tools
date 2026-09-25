'use client';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { createLinkPageQr, saveLinkPage } from '@/app/(app)/[space]/actions';
import { QrMini } from '@/components/records/qr-mini';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import type { LinkItem, LinkPage, QrCode } from '@/lib/platform/types';

const THEMES: Record<
  LinkPage['theme'],
  { name: string; bg: string; fg: string; button: string; buttonFg: string; avatar: string }
> = {
  paper: {
    name: 'Paper',
    bg: '#F3F1EB',
    fg: '#16150F',
    button: '#FFFFFF',
    buttonFg: '#16150F',
    avatar: '#16150F',
  },
  ink: {
    name: 'Ink',
    bg: '#16150F',
    fg: '#FFFFFF',
    button: 'rgba(255,255,255,.1)',
    buttonFg: '#FFFFFF',
    avatar: '#E4FF3A',
  },
  signal: {
    name: 'Signal',
    bg: '#3240FF',
    fg: '#FFFFFF',
    button: '#FFFFFF',
    buttonFg: '#1F28B8',
    avatar: '#FF8AD8',
  },
  ember: {
    name: 'Ember',
    bg: '#2A120E',
    fg: '#FFF7EF',
    button: 'rgba(255,247,239,.12)',
    buttonFg: '#FFF7EF',
    avatar: '#E0492F',
  },
};

/** Inputs that look like the page they're editing: no box until you're in them. */
const inline =
  'w-full bg-transparent text-center outline-none rounded-[10px] placeholder:text-current placeholder:opacity-45 transition-shadow focus:shadow-[0_0_0_2px_currentColor]';

/**
 * Link Pages: one link for everything. You edit the page itself — tap the name, the bio or a
 * link on the phone and type. Page-wide choices (finish, address) sit beside it.
 */
export function LinkEditor({
  slug,
  page,
  base,
  code,
  brand,
  starter,
}: {
  slug: string;
  page?: LinkPage;
  /** A business's first page starts from what it already told Hyphy: its name and line. */
  starter?: { title: string; handle: string; bio: string };
  base: string;
  /** The saved QR code that opens this page, if one was made. */
  code?: QrCode;
  /** The Space's color, which a new code for the page wears. */
  brand: string;
}) {
  const id = useId();
  const toast = useToast();
  const [saving, start] = useTransition();
  const [making, startMaking] = useTransition();
  const makeCode = () =>
    page &&
    startMaking(async () => {
      const result = await createLinkPageQr(slug, page.id);
      toast(
        result.ok
          ? { title: `QR code for @${page.handle}`, description: result.message, icon: 'qr' }
          : { title: result.error, icon: 'alert' },
      );
    });
  const [title, setTitle] = useState(page?.title ?? starter?.title ?? '');
  const [handle, setHandle] = useState(page?.handle ?? starter?.handle ?? '');
  const [bio, setBio] = useState(page?.bio ?? starter?.bio ?? '');
  const [theme, setTheme] = useState<LinkPage['theme']>(page?.theme ?? 'paper');
  const [links, setLinks] = useState<LinkItem[]>(
    page?.links ?? [{ id: 'l1', label: '', url: 'https://' }],
  );
  const [selected, setSelected] = useState<string | null>(null);
  // A page that was never saved (even one started from the business's name) is always savable.
  const [savedState, setSavedState] = useState(() =>
    page ? JSON.stringify({ title, handle, bio, theme, links }) : '',
  );
  const style = THEMES[theme];
  const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9-]/g, '');
  const dirty = JSON.stringify({ title, handle, bio, theme, links }) !== savedState;

  const update = (linkId: string, patch: Partial<LinkItem>) =>
    setLinks((current) =>
      current.map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
    );
  const move = (linkId: string, direction: number) =>
    setLinks((current) => {
      const index = current.findIndex((link) => link.id === linkId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const remove = (linkId: string) => {
    setLinks((current) => current.filter((link) => link.id !== linkId));
    setSelected(null);
  };
  const add = () => {
    const next = { id: `l${Date.now()}`, label: '', url: 'https://' };
    setLinks((current) => [...current, next]);
    setSelected(next.id);
    // Focus the new pill's label once it renders.
    requestAnimationFrame(() =>
      document.getElementById(`${id}-label-${next.id}`)?.focus({ preventScroll: false }),
    );
  };

  const save = () =>
    start(async () => {
      const kept = links.filter((link) => link.label.trim() && link.url.trim());
      const result = await saveLinkPage(slug, {
        id: page?.id,
        title,
        handle: cleanHandle,
        bio,
        theme,
        links: kept,
      });
      if (result.ok) setSavedState(JSON.stringify({ title, handle, bio, theme, links }));
      toast(
        result.ok
          ? { title: `@${cleanHandle} saved`, description: `${kept.length} links · ${style.name}` }
          : { title: result.error, icon: 'alert' },
      );
    });

  const empty = links.filter((link) => !link.label.trim() || link.url.trim() === 'https://');

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
      {/* The page itself, edited in place. */}
      <div className="relative overflow-hidden rounded-[26px] bg-subtle px-3 py-6 shadow-[inset_0_0_0_1px_var(--color-line)] sm:px-6 sm:py-8 [background-image:radial-gradient(rgb(22_21_15/.07)_1px,transparent_1px)] [background-size:18px_18px]">
        <p className="mb-4 flex items-center justify-center gap-1.5 text-[12.5px] text-muted">
          <Icon name="pencil" size={13} /> Tap anything on the page to change it
        </p>
        <div className="mx-auto w-full max-w-[330px] rounded-[46px] bg-ink p-2.5 shadow-pop">
          <div
            className="scrollbar-none relative flex min-h-[580px] flex-col overflow-y-auto rounded-[38px] px-5 pt-12 pb-6 transition-colors duration-500"
            style={{ background: style.bg, color: style.fg }}
          >
            <span
              className="absolute top-3 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-ink"
              aria-hidden="true"
            />
            <span
              className="mx-auto grid size-16 shrink-0 place-items-center rounded-full text-[22px] font-bold transition-colors duration-500"
              style={{ background: style.avatar, color: theme === 'paper' ? '#fff' : '#16150F' }}
              aria-hidden="true"
            >
              {(title || 'H').slice(0, 1).toUpperCase()}
            </span>
            <input
              aria-label="Name"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Your name"
              maxLength={60}
              className={cn(inline, 'mt-3 py-0.5 text-[17px] font-semibold')}
            />
            <div className="flex items-center justify-center text-[12px] opacity-60">
              <span aria-hidden="true">@</span>
              <input
                aria-label="Handle"
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                placeholder="handle"
                maxLength={30}
                autoCapitalize="off"
                spellCheck={false}
                className={cn(inline, 'w-auto max-w-[180px] py-0.5 text-left')}
                style={{ width: `${Math.max(6, (handle || 'handle').length) + 1}ch` }}
              />
            </div>
            <textarea
              aria-label="Bio"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="A line about you — what people should know"
              maxLength={160}
              rows={bio.length > 70 ? 3 : 2}
              className={cn(
                inline,
                'mt-2.5 resize-none px-1 py-1 text-[12.5px] leading-snug opacity-85',
              )}
            />
            <ol className="mt-4 grid gap-2.5">
              {links.map((link, index) => {
                const on = selected === link.id;
                return (
                  <li key={link.id} className="animate-rise">
                    <div
                      className={cn(
                        'rounded-[22px] transition-shadow',
                        on && 'shadow-[0_0_0_2px_currentColor]',
                      )}
                      style={{
                        background: style.button,
                        color: style.buttonFg,
                        boxShadow:
                          !on && theme === 'paper'
                            ? 'inset 0 0 0 1px rgba(22,21,15,.12)'
                            : undefined,
                      }}
                    >
                      <input
                        id={`${id}-label-${link.id}`}
                        aria-label={`Link ${index + 1} label`}
                        value={link.label}
                        onFocus={() => setSelected(link.id)}
                        onChange={(event) => update(link.id, { label: event.target.value })}
                        placeholder="Name this link"
                        maxLength={60}
                        className="w-full bg-transparent px-4 py-3 text-center text-[13px] font-medium outline-none placeholder:text-current placeholder:opacity-45"
                      />
                      {on && (
                        <div className="animate-fade px-2 pb-2">
                          <input
                            aria-label={`Link ${index + 1} address`}
                            value={link.url}
                            onChange={(event) => update(link.id, { url: event.target.value })}
                            placeholder="https://"
                            inputMode="url"
                            autoCapitalize="off"
                            spellCheck={false}
                            className="w-full rounded-[12px] bg-black/[.06] px-3 py-2 text-center text-[12px] outline-none placeholder:text-current placeholder:opacity-45 focus:bg-black/[.1]"
                            style={
                              theme === 'paper' || theme === 'signal'
                                ? undefined
                                : { background: 'rgba(255,255,255,.1)' }
                            }
                          />
                          <div className="mt-1.5 flex items-center justify-center gap-0.5">
                            {[
                              {
                                label: 'Move up',
                                icon: 'arrow-left' as const,
                                rotate: 'rotate-90',
                                onClick: () => move(link.id, -1),
                                disabled: index === 0,
                              },
                              {
                                label: 'Move down',
                                icon: 'arrow-left' as const,
                                rotate: '-rotate-90',
                                onClick: () => move(link.id, 1),
                                disabled: index === links.length - 1,
                              },
                              {
                                label: 'Remove link',
                                icon: 'trash' as const,
                                rotate: '',
                                onClick: () => remove(link.id),
                                disabled: false,
                              },
                              {
                                label: 'Done',
                                icon: 'check' as const,
                                rotate: '',
                                onClick: () => setSelected(null),
                                disabled: false,
                              },
                            ].map((tool) => (
                              <button
                                key={tool.label}
                                type="button"
                                aria-label={tool.label}
                                title={tool.label}
                                disabled={tool.disabled}
                                onClick={tool.onClick}
                                className="grid size-8 place-items-center rounded-full opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 disabled:opacity-20"
                              >
                                <Icon name={tool.icon} size={14} className={tool.rotate} />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {links.length < 12 && (
              <button
                type="button"
                onClick={add}
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-[22px] border-[1.5px] border-dashed border-current py-3 text-[13px] font-medium opacity-55 transition-opacity hover:opacity-100"
              >
                <Icon name="plus" size={14} /> Add a link
              </button>
            )}
            <p className="mt-auto pt-8 text-center text-[10.5px] opacity-40">
              Made with Hyphy Tools
            </p>
          </div>
        </div>
      </div>

      {/* The page-wide choices. */}
      <div className="grid content-start gap-4 lg:sticky lg:top-6 lg:self-start">
        <section
          aria-labelledby={`${id}-finish`}
          className="rounded-[20px] bg-surface p-4 shadow-card"
        >
          <h2 id={`${id}-finish`} className="label mb-3">
            Finish
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(THEMES) as LinkPage['theme'][]).map((key) => {
              const option = THEMES[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={theme === key}
                  onClick={() => setTheme(key)}
                  className="group grid justify-items-center gap-1.5 text-[12px]"
                >
                  <span
                    className={cn(
                      'flex h-[74px] w-full flex-col items-center gap-1 rounded-[14px] px-2 pt-3 transition-all',
                      theme === key
                        ? 'ring-2 ring-signal ring-offset-2'
                        : 'shadow-[inset_0_0_0_1px_rgb(0_0_0/.1)] group-hover:-translate-y-0.5',
                    )}
                    style={{ background: option.bg }}
                  >
                    <span className="size-3.5 rounded-full" style={{ background: option.avatar }} />
                    {[0, 1, 2].map((bar) => (
                      <span
                        key={bar}
                        className="h-2 w-full rounded-full"
                        style={{
                          background: option.button,
                          boxShadow:
                            key === 'paper' ? 'inset 0 0 0 1px rgba(22,21,15,.12)' : undefined,
                        }}
                      />
                    ))}
                  </span>
                  <span className={theme === key ? 'font-medium text-ink' : 'text-muted'}>
                    {option.name}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-[20px] bg-surface p-4 shadow-card">
          <h2 className="label mb-2">Address</h2>
          <p className="truncate rounded-[12px] bg-subtle px-3 py-2.5 font-mono text-[12.5px] text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
            hyphy.example/<span className="text-ink">@{cleanHandle || 'handle'}</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">
            Publishing to this address arrives with accounts. Saving keeps the page in this Space.
          </p>
          {empty.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-[12.5px] text-caution">
              <Icon name="alert" size={14} />
              {empty.length === 1 ? 'One link needs' : `${empty.length} links need`} a name and an
              address — {empty.length === 1 ? 'it' : 'they'} won’t be saved until then.
            </p>
          )}
          <div className="mt-4 grid gap-2">
            {dirty || saving ? (
              <Button variant="primary" onClick={save} disabled={saving || !title || !cleanHandle}>
                {saving ? 'Saving…' : 'Save link page'}
              </Button>
            ) : (
              // Nothing to save is a state, not a disabled button.
              <p
                role="status"
                className="flex h-11 animate-fade items-center justify-center gap-2 rounded-[11px] bg-positive-soft text-[14px] font-medium text-positive lg:h-9 lg:text-[13.5px]"
              >
                <Icon name="check" size={16} strokeWidth={2.2} /> Saved in{' '}
                {slug === 'personal' ? 'Personal' : 'this Space'}
              </p>
            )}
          </div>
          {dirty && (
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-muted">
              <span className="size-1.5 rounded-full bg-caution" aria-hidden="true" /> Unsaved
              changes
            </p>
          )}
        </section>

        {/* The page, its code and the Space belong together: one tap makes the printed way in. */}
        <section
          className="rounded-[20px] bg-surface p-4 shadow-card"
          aria-label="QR code for this page"
        >
          <h2 className="label mb-3">QR code</h2>
          {code ? (
            <div className="flex items-center gap-3.5">
              <span className="block w-[88px] shrink-0 rounded-[12px] bg-white p-1.5 shadow-card">
                <QrMini content={code.content} fg={code.fg} bg={code.bg} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-ink">{code.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-snug text-muted">
                  Opens @{page?.handle}. Saved in {slug === 'personal' ? 'Personal' : 'this Space'}{' '}
                  with your other codes.
                </p>
                <Link
                  href={`${base}/tools/qr?code=${code.id}`}
                  className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-signal-ink hover:underline"
                >
                  Download or restyle <Icon name="arrow-right" size={13} />
                </Link>
              </div>
            </div>
          ) : page ? (
            <>
              <p className="text-[13px] leading-snug text-muted">
                For a table tent, a flyer or the shop window: a code that opens @{page.handle}, in
                your Space’s color.
              </p>
              <div className="mt-3 grid gap-2">
                <Button onClick={makeCode} disabled={making}>
                  <span
                    className="size-3.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.15)]"
                    style={{ background: brand }}
                    aria-hidden="true"
                  />
                  {making ? 'Making it…' : 'Create QR for this page'}
                </Button>
                {cleanHandle && (
                  <Link
                    href={`${base}/tools/qr?content=${encodeURIComponent(`https://hyphy.example/@${cleanHandle}`)}&label=${encodeURIComponent(`@${cleanHandle} link page`)}`}
                    className="text-center text-[12.5px] text-muted hover:text-ink"
                  >
                    Or design it yourself in QR Codes
                  </Link>
                )}
              </div>
            </>
          ) : (
            <p className="text-[13px] text-muted">
              Save the page first, then make its QR code here.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
