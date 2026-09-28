'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { IntentLink } from '@/components/marketplace/intent-link';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { QuickButton } from './quick';

/**
 * On a phone, the home and the full catalog get a small dock under the thumb: Home, the "+",
 * All tools. Three things, not five: search stays in the header, and My Tools *is* the home.
 * Tool pages don't get it: their own main action lives at the bottom of the screen.
 */
export function Dock() {
  const pathname = usePathname();
  const home = pathname === '/tools';
  const all = pathname === '/tools/all';
  const shown = home || all;
  // The footer leaves room for the dock (html[data-tools-dock]).
  useEffect(() => {
    if (!shown) return;
    const root = document.documentElement;
    root.dataset.toolsDock = '';
    return () => {
      delete root.dataset.toolsDock;
    };
  }, [shown]);
  if (!shown) return null;
  return (
    <nav aria-label="Hyphy Tools" className="dock fixed inset-x-0 bottom-0 z-40 md:hidden">
      <div className="mx-auto flex max-w-[420px] items-center justify-between gap-2 px-6 pt-2 pb-[max(10px,env(safe-area-inset-bottom))]">
        <DockLink href="/tools" icon="home" label="Home" current={home} />
        <QuickButton variant="round" className="-mt-5 shadow-[0_14px_30px_-12px_rgb(0_0_0/.55)]" />
        <DockLink href="/tools/all" icon="grid" label="All tools" current={all} />
      </div>
    </nav>
  );
}

function DockLink({
  href,
  icon,
  label,
  current,
}: {
  href: string;
  icon: IconName;
  label: string;
  current: boolean;
}) {
  return (
    <IntentLink
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={() => current && window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={cn(
        'flex h-12 min-w-[88px] flex-col items-center justify-center gap-0.5 rounded-[16px] text-[11.5px] font-semibold transition-colors',
        current ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon name={icon} size={21} strokeWidth={current ? 2.3 : 1.9} />
      {label}
    </IntentLink>
  );
}
