'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Count } from '@/components/ui/badge';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import type { NavItem } from '@/lib/platform/navigation';
import { useWorkspace } from './workspace-context';

export function useActive() {
  const pathname = usePathname();
  const workspace = useWorkspace();
  const home = workspace.href();
  return (href: string) =>
    href === home ? pathname === home : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const isActive = useActive()(item.href);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors lg:h-[34px] lg:gap-2.5 lg:rounded-[9px] lg:px-2.5 lg:text-[13.5px]',
        isActive
          ? 'bg-surface font-medium text-ink shadow-card'
          : 'text-ink-2 hover:bg-ink/[.045] hover:text-ink',
      )}
    >
      <Icon
        name={item.icon}
        size={18}
        className={cn(
          'transition-colors',
          isActive ? 'text-ink' : 'text-muted group-hover:text-ink-2',
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.count ? (
        <Count value={item.count} tone={item.id === 'inbox' ? 'signal' : 'neutral'} />
      ) : null}
    </Link>
  );
}

export function ToolLink({
  tool,
  onNavigate,
}: {
  tool: {
    id: string;
    label: string;
    href: string;
    icon: NavItem['icon'];
    color: string;
    ink: 'dark' | 'light';
    pinned?: boolean;
  };
  onNavigate?: () => void;
}) {
  const isActive = useActive()(tool.href);
  return (
    <Link
      href={tool.href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] transition-colors lg:h-[32px] lg:gap-2.5 lg:rounded-[9px] lg:px-2.5 lg:text-[13.5px]',
        isActive
          ? 'bg-surface font-medium text-ink shadow-card'
          : 'text-ink-2 hover:bg-ink/[.045] hover:text-ink',
      )}
    >
      <span
        className="grid size-[22px] place-items-center rounded-[6px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.08)] transition-transform group-hover:scale-105 lg:size-[18px] lg:rounded-[5px]"
        style={{ background: tool.color, color: tool.ink === 'light' ? '#fff' : '#16150F' }}
        aria-hidden="true"
      >
        <Icon name={tool.icon} size={12} strokeWidth={2.1} />
      </span>
      <span className="flex-1 truncate">{tool.label}</span>
      {tool.pinned && <Icon name="pin" size={12} className="shrink-0 text-faint" />}
    </Link>
  );
}
