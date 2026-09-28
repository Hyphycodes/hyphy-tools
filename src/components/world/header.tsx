'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { studio } from '@/lib/public';
import { openSearch } from './search';
import { Wordmark } from './wordmark';

function onScroll(notify: () => void) {
  window.addEventListener('scroll', notify, { passive: true });
  return () => window.removeEventListener('scroll', notify);
}
const never = () => () => {};
const isMac = () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/**
 * The public world's header: Hyphy's umbrella (Work lives on Studio), this world (Tools, Drops)
 * and search. Clear over the marketplace's opening, glass once you scroll.
 */
export function WorldHeader() {
  const pathname = usePathname();
  const scrolled = useSyncExternalStore(
    onScroll,
    () => window.scrollY > 12,
    () => false,
  );
  const mac = useSyncExternalStore(never, isMac, () => true);
  const home = pathname === '/tools';
  const [menu, setMenu] = useState(false);
  // Any navigation closes the phone menu.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenu(false);
  }

  const solid = scrolled || !home || menu;
  const nav = [
    { label: 'Work', href: studio.work, external: true },
    { label: 'Tools', href: '/tools', current: pathname.startsWith('/tools') },
  ];

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300',
        solid
          ? 'bg-[rgb(11_11_10/.72)] shadow-[0_1px_0_rgb(255_255_255/.06)] backdrop-blur-xl backdrop-saturate-150'
          : 'bg-transparent',
      )}
    >
      <div className="safe-top mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/tools" aria-label="Hyphy Tools — all tools" className="rounded-[10px]">
          <Wordmark />
        </Link>
        <nav aria-label="Hyphy" className="ml-6 hidden items-center gap-1 md:flex">
          {nav.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.href}
                className="rounded-full px-3 py-1.5 text-[14px] text-muted transition-colors hover:text-ink"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                aria-current={item.current ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[14px] transition-colors',
                  item.current ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => openSearch()}
            className="flex h-10 items-center gap-2.5 rounded-full bg-white/[.06] pr-2 pl-3.5 text-[14px] text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] transition-colors hover:bg-white/[.1] hover:text-ink sm:pr-2.5"
          >
            <Icon name="search" size={16} />
            <span className="hidden sm:inline">Search tools</span>
            <span className="hidden sm:inline-flex">
              <Kbd className="!bg-white/10 !text-muted">{mac ? '⌘K' : 'Ctrl K'}</Kbd>
            </span>
          </button>
          <a
            href={studio.home}
            className="hidden h-10 items-center gap-1.5 rounded-full px-3 text-[14px] text-muted transition-colors hover:text-ink lg:flex"
          >
            Hyphy Studio <Icon name="arrow-up-right" size={15} />
          </a>
          <button
            type="button"
            aria-expanded={menu}
            aria-controls="world-menu"
            aria-label={menu ? 'Close menu' : 'Menu'}
            onClick={() => setMenu((open) => !open)}
            className="grid size-10 place-items-center rounded-full bg-white/[.06] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.06)] md:hidden"
          >
            <Icon name={menu ? 'x' : 'menu'} size={18} />
          </button>
        </div>
      </div>
      {menu && (
        <nav
          id="world-menu"
          aria-label="Hyphy"
          className="animate-fade border-t border-line px-4 pt-2 pb-5 md:hidden"
        >
          <ul className="grid">
            {[...nav, { label: 'Hyphy Studio', href: studio.home, external: true }].map((item) => (
              <li key={item.label}>
                {item.external ? (
                  <a
                    href={item.href}
                    className="flex h-12 items-center justify-between text-[17px] text-ink-2"
                  >
                    {item.label} <Icon name="arrow-up-right" size={16} className="text-muted" />
                  </a>
                ) : (
                  <Link
                    href={item.href}
                    onClick={() => setMenu(false)}
                    className="flex h-12 items-center text-[17px] text-ink"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
