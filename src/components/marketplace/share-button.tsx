'use client';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';

/**
 * Share a page: the phone's own share sheet where there is one, otherwise the link is copied.
 * Shares the page's address only, never anything typed into a tool.
 */
export function ShareButton({
  title,
  text,
  className,
  label = 'Share',
  compact = false,
}: {
  title: string;
  text?: string;
  className?: string;
  label?: string;
  /** Just the icon on a phone; the word from `sm` up. */
  compact?: boolean;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ title: 'Link copied', description: url.replace(/^https?:\/\//, '') });
    } catch {
      toast({ title: 'Couldn’t copy the link', description: url, icon: 'alert' });
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      aria-label={compact ? label : undefined}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full bg-white/[.06] px-4 text-[14px] font-medium text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)] transition-colors hover:bg-white/10 hover:text-ink',
        className,
      )}
    >
      <Icon name={copied ? 'check' : 'share'} size={16} />
      <span className={cn(compact && 'max-sm:sr-only')}>{copied ? 'Copied' : label}</span>
    </button>
  );
}
