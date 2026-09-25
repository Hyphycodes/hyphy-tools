'use client';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { CreateProvider, useCreate } from '@/components/create/create-context';
import { DemoBar } from '@/components/demo/demo-bar';
import type { DemoModel } from '@/lib/demo/model';
import type { SearchItem } from '@/lib/search';
import { Avatar } from '@/components/ui/avatar';
import { Count } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { Icon, type IconName } from '@/components/ui/icon';
import { Kbd } from '@/components/ui/kbd';
import { SpaceMark } from '@/components/ui/marks';
import { MenuItem, menuItemClass, Popover } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/sheet';
import { ToastProvider } from '@/components/ui/toast';
import { CommandProvider, useCommand } from './command-palette';
import { CREATE_TRIGGER_ID, CreateMenu } from './create-menu';
import type { ShellModel } from './model';
import { NavLink, ToolLink, useActive } from './nav';
import { SpaceSwitcher } from './space-switcher';
import { useWorkspace, WorkspaceProvider } from './workspace-context';

export function AppShell({
  model,
  search,
  demo,
  children,
}: {
  model: ShellModel;
  search: SearchItem[];
  demo: DemoModel | null;
  children: ReactNode;
}) {
  return (
    <WorkspaceProvider value={model}>
      <ToastProvider>
        <CreateProvider>
          <CommandProvider items={search}>
            {demo && <DemoBar demo={demo} />}
            <div className="lg:flex">
              <Sidebar />
              <div className="min-w-0 flex-1">
                <MobileTopBar />
                <main
                  id="main"
                  className="min-h-[calc(100dvh-56px)] lg:my-2 lg:mr-2 lg:min-h-[calc(100dvh-16px)] lg:rounded-[20px] lg:bg-surface lg:shadow-card"
                >
                  {children}
                </main>
              </div>
            </div>
            <MobileTabBar />
            <CreateMenu variant="mobile" />
          </CommandProvider>
        </CreateProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}

/* ---------- desktop sidebar ---------- */

function Sidebar() {
  const workspace = useWorkspace();
  const command = useCommand();
  const create = useCreate();
  const { nav } = workspace;
  const primary = nav.primary.map((item) =>
    item.id === 'inbox' ? { ...item, count: workspace.inboxCount } : item,
  );

  return (
    <aside
      className="sticky top-0 z-30 hidden h-dvh w-[252px] shrink-0 flex-col px-3 pt-3 pb-3 lg:flex"
      aria-label="Main"
    >
      <SpaceSwitcher />

      <div className="mt-3 grid gap-1.5 px-0.5">
        <button
          type="button"
          onClick={command.open}
          className="flex h-9 items-center gap-2 rounded-[10px] bg-surface/70 px-2.5 text-[13px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-surface hover:text-ink-2"
        >
          <Icon name="search" size={15} />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
        {workspace.actions.length > 0 && (
          <div className="relative">
            <button
              id={CREATE_TRIGGER_ID}
              type="button"
              onClick={() => create.setMenuOpen(!create.menuOpen)}
              aria-expanded={create.menuOpen}
              className={cn(
                'group flex h-9 w-full items-center gap-2 rounded-[10px] bg-signal px-2.5 text-[13.5px] font-medium text-white transition-all',
                'shadow-[inset_0_1px_0_rgb(255_255_255/.22),0_6px_16px_-8px_rgb(50_64_255/.8)] hover:bg-signal-hover',
              )}
            >
              <Icon
                name="plus"
                size={16}
                strokeWidth={2.2}
                className={cn('transition-transform duration-300', create.menuOpen && 'rotate-45')}
              />
              <span className="flex-1 text-left">Create</span>
              <kbd className="mono-num grid h-5 min-w-5 place-items-center rounded-[5px] bg-white/15 px-1 text-[10.5px] text-white/80">
                C
              </kbd>
            </button>
            <CreateMenu variant="desktop" />
          </div>
        )}
      </div>

      <nav className="mt-4 flex min-h-0 flex-1 flex-col overflow-y-auto" aria-label="Sections">
        <div className="grid gap-0.5">
          {primary.map((item) => (
            <NavLink key={item.id} item={item} />
          ))}
        </div>

        {nav.space.length > 0 && (
          <div className="mt-5">
            <p className="label mb-1.5 truncate px-2.5">
              {workspace.space.kind === 'personal' ? 'Yours' : workspace.space.name}
            </p>
            <div className="grid gap-0.5">
              {nav.space.map((item) => (
                <NavLink key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}

        {nav.tools.length > 0 && (
          <div className="mt-5">
            <p className="label mb-1.5 px-2.5">Tools</p>
            <div className="grid gap-0.5">
              {nav.tools.map((tool) => (
                <ToolLink key={tool.id} tool={tool} />
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="mt-3 grid gap-0.5 border-t border-line pt-3">
        {nav.settings && <NavLink item={nav.settings} />}
        <ProfileMenu />
      </div>
    </aside>
  );
}

function ProfileMenu({ compact }: { compact?: boolean }) {
  const workspace = useWorkspace();
  const { person } = workspace;
  return (
    <Popover
      title={person.name}
      side={compact ? 'bottom' : 'top'}
      align={compact ? 'end' : 'start'}
      width={260}
      trigger={({ toggle, open, ...aria }) =>
        compact ? (
          <button
            type="button"
            onClick={toggle}
            {...aria}
            className="grid size-11 place-items-center rounded-full"
            aria-label="Your profile"
          >
            <Avatar person={person} size="md" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            {...aria}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[10px] p-1.5 text-left transition-colors hover:bg-ink/[.045]',
              open && 'bg-ink/[.045]',
            )}
          >
            <Avatar person={person} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {person.name}
              </span>
              <span className="block truncate text-[12px] text-muted">{workspace.title}</span>
            </span>
            <Icon name="more" size={16} className="text-faint" />
          </button>
        )
      }
    >
      {() => (
        <div>
          <div className="flex items-center gap-3 px-3 pt-2 pb-3 lg:px-2.5">
            <Avatar person={person} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold lg:text-[14px]">{person.name}</p>
              <p className="truncate text-[12.5px] text-muted">{person.email}</p>
            </div>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link href={workspace.href('/profile')} className={menuItemClass}>
              <Icon name="user" size={17} className="text-muted" /> Profile & Spaces
            </Link>
            <MenuItem disabled className="opacity-50">
              <Icon name="logout" size={17} className="text-muted" />
              <span className="flex-1">Sign out</span>
              <span className="text-[11.5px] text-faint">No sign-in yet</span>
            </MenuItem>
          </div>
        </div>
      )}
    </Popover>
  );
}

/* ---------- phones ---------- */

function MobileTopBar() {
  const command = useCommand();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-line bg-canvas/88 px-2 backdrop-blur-xl lg:hidden">
      <div className="min-w-0 flex-1">
        <SpaceSwitcher compact />
      </div>
      <button
        type="button"
        onClick={command.open}
        className="grid size-11 place-items-center rounded-full text-ink-2 active:bg-ink/5"
        aria-label="Search"
      >
        <Icon name="search" size={21} />
      </button>
      <ProfileMenu compact />
    </header>
  );
}

function Tab({
  href,
  icon,
  label,
  count,
}: {
  href: string;
  icon: IconName;
  label: string;
  count?: number;
}) {
  const on = useActive()(href);
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'relative flex flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium',
        on ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon name={icon} size={23} strokeWidth={on ? 2 : 1.7} />
      {label}
      {count ? (
        <span className="absolute top-1 left-[calc(50%+6px)]">
          <Count value={count} tone="signal" />
        </span>
      ) : null}
    </Link>
  );
}

function MobileTabBar() {
  const workspace = useWorkspace();
  const create = useCreate();
  const [menu, setMenu] = useState(false);
  const { nav } = workspace;
  const find = (id: string) => [...nav.primary, ...nav.space].find((item) => item.id === id);
  const second = find('tools') ?? find('projects') ?? find('files');
  const tabs = [find('home'), second].filter(Boolean) as NonNullable<ReturnType<typeof find>>[];
  const inbox = find('inbox');

  return (
    <>
      <nav
        aria-label="Tabs"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/92 backdrop-blur-xl lg:hidden"
      >
        <div className="grid h-[62px] grid-cols-5">
          {tabs.map((item) => (
            <Tab key={item.id} href={item.href} icon={item.icon} label={item.label} />
          ))}
          <div className="grid place-items-center">
            {workspace.actions.length > 0 ? (
              <button
                type="button"
                onClick={() => create.setMenuOpen(true)}
                aria-label="Create"
                className="-mt-5 grid size-14 place-items-center rounded-[18px] bg-signal text-white shadow-[inset_0_1px_0_rgb(255_255_255/.25),0_10px_24px_-8px_rgb(50_64_255/.85)] transition-transform active:scale-95"
              >
                <Icon name="plus" size={26} strokeWidth={2.3} />
              </button>
            ) : null}
          </div>
          {inbox && (
            <Tab href={inbox.href} icon="inbox" label="Inbox" count={workspace.inboxCount} />
          )}
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="flex flex-col items-center justify-center gap-0.5 pt-1.5 text-[10.5px] font-medium text-muted"
          >
            <Icon name="more" size={23} strokeWidth={1.7} />
            More
          </button>
        </div>
      </nav>
      <Sheet
        open={menu}
        onClose={() => setMenu(false)}
        title={workspace.space.name}
        description={`${workspace.roleLabel} · ${workspace.planName}`}
        leading={<SpaceMark space={workspace.space} size="lg" />}
      >
        <div className="grid gap-0.5">
          {[...nav.primary, ...nav.space]
            .filter((item) => !tabs.includes(item) && item.id !== 'inbox')
            .map((item) => (
              <NavLink key={item.id} item={item} onNavigate={() => setMenu(false)} />
            ))}
          {nav.settings && <NavLink item={nav.settings} onNavigate={() => setMenu(false)} />}
        </div>
        {nav.tools.length > 0 && (
          <>
            <p className="label mt-5 mb-1.5 px-3">Tools</p>
            <div className="grid grid-cols-2 gap-0.5">
              {nav.tools.map((tool) => (
                <ToolLink key={tool.id} tool={tool} onNavigate={() => setMenu(false)} />
              ))}
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}
