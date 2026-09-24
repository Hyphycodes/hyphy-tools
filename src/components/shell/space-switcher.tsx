'use client';
import Link from 'next/link';
import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { SpaceMark } from '@/components/ui/marks';
import { Popover } from '@/components/ui/popover';
import { useWorkspace } from './workspace-context';

/**
 * The real product's Space switcher (separate from Demo Mode's Preview As): every Space this
 * person belongs to, with the role they hold in each.
 */
export function SpaceSwitcher({ compact }: { compact?: boolean }) {
  const workspace = useWorkspace();
  const { space } = workspace;
  const personal = workspace.spaces.filter((item) => item.kind === 'personal');
  const business = workspace.spaces.filter((item) => item.kind === 'business');

  return (
    <Popover
      title="Switch Space"
      width={300}
      trigger={({ toggle, open, ...aria }) => (
        <button
          type="button"
          onClick={toggle}
          {...aria}
          className={cn(
            'group flex min-w-0 items-center gap-2.5 rounded-[12px] text-left transition-colors',
            compact ? 'h-11 px-1.5 pr-2 hover:bg-ink/5' : 'w-full p-1.5 pr-2.5 hover:bg-ink/[.045]',
            open && 'bg-ink/[.045]',
          )}
        >
          <SpaceMark space={space} size={compact ? 'md' : 'md'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink lg:text-[14px]">
              {space.name}
            </span>
            {!compact && (
              <span className="block truncate text-[12px] leading-tight text-muted">
                {workspace.roleLabel} · {workspace.planName}
              </span>
            )}
          </span>
          <Icon
            name="chevrons"
            size={15}
            className="text-faint transition-colors group-hover:text-muted"
          />
        </button>
      )}
    >
      {(close) => (
        <div className="grid gap-1">
          {[
            { title: 'Personal', items: personal },
            { title: 'Businesses', items: business },
          ]
            .filter((group) => group.items.length)
            .map((group) => (
              <div key={group.title}>
                <p className="label px-3 pt-2 pb-1.5 lg:px-2.5">{group.title}</p>
                {group.items.map((item) => {
                  const current = item.id === space.id;
                  return (
                    <Link
                      key={item.id}
                      href={`/${item.slug}`}
                      onClick={close}
                      aria-current={current ? 'true' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-[10px] px-3 py-2.5 transition-colors hover:bg-ink/[.05] lg:gap-2.5 lg:px-2.5 lg:py-2',
                        current && 'bg-ink/[.05]',
                      )}
                    >
                      <SpaceMark space={item} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-ink lg:text-[13.5px]">
                          {item.name}
                        </span>
                        <span className="block truncate text-[12.5px] text-muted lg:text-[12px]">
                          {item.kind === 'personal' ? 'Just you' : item.roleLabel}
                        </span>
                      </span>
                      {current && <Icon name="check" size={16} className="text-signal" />}
                    </Link>
                  );
                })}
              </div>
            ))}
          <p className="mx-1 mt-1 border-t border-line px-2 pt-2.5 pb-1 text-[12px] leading-snug text-faint">
            One person, many Spaces. Your role changes with the Space you’re in.
          </p>
        </div>
      )}
    </Popover>
  );
}
