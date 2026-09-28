import { cn } from '@/components/ui/cn';
import { Icon } from '@/components/ui/icon';
import { privacyFacts, statusLabel, type Tool } from '@/lib/catalog';

/*
 * The few facts every tool shows the same way: whether it's ready, whether it stays on your
 * device, and what it costs. Worded from the registry, never by hand.
 */

export function StatusPill({
  tool,
  className,
}: {
  tool: Pick<Tool, 'status'>;
  className?: string;
}) {
  if (tool.status === 'available') return null;
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
        tool.status === 'beta'
          ? 'bg-signal-soft text-signal-ink'
          : 'bg-white/[.07] text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]',
        className,
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          tool.status === 'beta' ? 'bg-signal-ink' : 'bg-muted/70',
        )}
      />
      {statusLabel[tool.status]}
    </span>
  );
}

export function PrivacyPill({
  tool,
  short = false,
  className,
}: {
  tool: Pick<Tool, 'privacy'>;
  short?: boolean;
  className?: string;
}) {
  const facts = privacyFacts(tool);
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
        facts.local
          ? 'bg-positive-soft text-positive'
          : 'bg-white/[.07] text-muted shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]',
        className,
      )}
    >
      <Icon name={facts.local ? 'lock' : 'shield'} size={12} strokeWidth={2} />
      {short ? (facts.local ? 'On your device' : 'With an account') : facts.label}
    </span>
  );
}

export function AccessPill({
  tool,
  className,
}: {
  tool: Pick<Tool, 'access' | 'later'>;
  className?: string;
}) {
  const pro = tool.access === 'pro';
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[11.5px] font-medium',
        pro
          ? 'bg-[#f5c451]/15 text-[#f5c451]'
          : 'bg-white/[.07] text-ink-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/.08)]',
        className,
      )}
    >
      {pro ? 'Pro' : tool.access === 'freemium' ? 'Free · Pro extras later' : 'Free'}
    </span>
  );
}
