'use client';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { saveLinkPage } from '@/app/(app)/[space]/actions';
import { Button, buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import type { LinkItem, LinkPage } from '@/lib/platform/types';

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

/** Link Pages: one link for everything, edited with a live phone preview. */
export function LinkEditor({ slug, page, base }: { slug: string; page?: LinkPage; base: string }) {
  const id = useId();
  const toast = useToast();
  const [saving, start] = useTransition();
  const [title, setTitle] = useState(page?.title ?? '');
  const [handle, setHandle] = useState(page?.handle ?? '');
  const [bio, setBio] = useState(page?.bio ?? '');
  const [theme, setTheme] = useState<LinkPage['theme']>(page?.theme ?? 'paper');
  const [links, setLinks] = useState<LinkItem[]>(
    page?.links ?? [{ id: 'l1', label: '', url: 'https://' }],
  );
  const style = THEMES[theme];
  const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9-]/g, '');

  const update = (index: number, patch: Partial<LinkItem>) =>
    setLinks((current) =>
      current.map((link, position) => (position === index ? { ...link, ...patch } : link)),
    );
  const move = (index: number, direction: number) =>
    setLinks((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });

  const save = () =>
    start(async () => {
      const result = await saveLinkPage(slug, {
        id: page?.id,
        title,
        handle: cleanHandle,
        bio,
        theme,
        links: links.filter((link) => link.label && link.url),
      });
      toast(
        result.ok
          ? { title: `@${cleanHandle} saved`, description: result.message }
          : { title: result.error, icon: 'alert' },
      );
    });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid content-start gap-5 rounded-[20px] bg-surface p-5 shadow-card">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={`${id}-title`}>
            <Input
              id={`${id}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Your name or business"
            />
          </Field>
          <Field label="Handle" htmlFor={`${id}-handle`}>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">
                @
              </span>
              <Input
                id={`${id}-handle`}
                value={handle}
                onChange={(event) => setHandle(event.target.value)}
                className="pl-7 lg:pl-7"
                autoCapitalize="off"
              />
            </div>
          </Field>
        </div>
        <Field label="Bio" htmlFor={`${id}-bio`} optional>
          <Textarea
            id={`${id}-bio`}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={2}
            maxLength={160}
          />
        </Field>
        <div>
          <p className="mb-2 text-[13.5px] font-medium text-ink-2">Finish</p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(THEMES) as LinkPage['theme'][]).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={theme === key}
                onClick={() => setTheme(key)}
                className={cn(
                  'flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13px] transition-all',
                  theme === key ? 'bg-ink text-white' : 'bg-well text-ink-2 hover:bg-ink/10',
                )}
              >
                <span
                  className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)]"
                  style={{ background: THEMES[key].bg }}
                />
                {THEMES[key].name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13.5px] font-medium text-ink-2">Links</p>
            <span className="mono-num text-[11px] text-faint">{links.length}/12</span>
          </div>
          <ol className="grid gap-2">
            {links.map((link, index) => (
              <li
                key={link.id}
                className="flex items-start gap-2 rounded-[14px] bg-subtle p-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-ink/5 disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={15} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === links.length - 1}
                    onClick={() => move(index, 1)}
                    className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-ink/5 disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={15} />
                  </button>
                </div>
                <div className="grid min-w-0 flex-1 gap-1.5">
                  <Input
                    aria-label="Label"
                    value={link.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    placeholder="Label"
                  />
                  <Input
                    aria-label="Link"
                    value={link.url}
                    onChange={(event) => update(index, { url: event.target.value })}
                    placeholder="https://"
                    className="text-muted"
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() =>
                    setLinks((current) => current.filter((_, position) => position !== index))
                  }
                  className="grid size-8 place-items-center rounded-[8px] text-muted hover:bg-ink/5"
                >
                  <Icon name="x" size={15} />
                </button>
              </li>
            ))}
          </ol>
          {links.length < 12 && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() =>
                setLinks((current) => [
                  ...current,
                  { id: `l${Date.now()}`, label: '', url: 'https://' },
                ])
              }
            >
              <Icon name="plus" size={15} /> Add a link
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={save} disabled={saving || !title || !cleanHandle}>
            {saving ? 'Saving…' : 'Save link page'}
          </Button>
          {cleanHandle && (
            <Link
              href={`${base}/tools/qr?content=${encodeURIComponent(`https://hyphy.example/@${cleanHandle}`)}`}
              className={buttonClass()}
            >
              <Icon name="qr" size={16} /> Make a QR code
            </Link>
          )}
        </div>
        <p className="text-[12.5px] text-faint">
          Publishing to a public address arrives with accounts. Saving keeps it in this Space.
        </p>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <div className="mx-auto w-[300px] rounded-[44px] bg-ink p-2.5 shadow-pop">
          <div
            className="relative h-[560px] overflow-hidden rounded-[36px] px-5 pt-12"
            style={{ background: style.bg, color: style.fg }}
          >
            <span
              className="absolute top-3 left-1/2 h-5 w-20 -translate-x-1/2 rounded-full bg-ink"
              aria-hidden="true"
            />
            <span
              className="mx-auto grid size-16 place-items-center rounded-full text-[22px] font-bold"
              style={{ background: style.avatar, color: theme === 'paper' ? '#fff' : '#16150F' }}
            >
              {(title || 'H').slice(0, 1)}
            </span>
            <p className="mt-3 text-center text-[17px] font-semibold">{title || 'Your name'}</p>
            <p className="text-center text-[12px] opacity-60">@{cleanHandle || 'handle'}</p>
            {bio && <p className="mt-3 text-center text-[12.5px] leading-snug opacity-80">{bio}</p>}
            <div className="mt-5 grid gap-2.5">
              {links
                .filter((link) => link.label)
                .map((link) => (
                  <span
                    key={link.id}
                    className="block truncate rounded-full px-4 py-3 text-center text-[13px] font-medium"
                    style={{
                      background: style.button,
                      color: style.buttonFg,
                      boxShadow:
                        theme === 'paper' ? 'inset 0 0 0 1px rgba(22,21,15,.12)' : undefined,
                    }}
                  >
                    {link.label}
                  </span>
                ))}
            </div>
            <p className="absolute inset-x-0 bottom-5 text-center text-[10.5px] opacity-40">
              Made with Hyphy Tools
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
