import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ToolGlyph } from '@/components/ui/marks';
import type { Workspace } from '@/lib/identity/types';
import { availability, tools } from '@/lib/platform/tools';

/** The first things worth doing in a Personal Space, in the words someone would use. */
const firsts: { id: string; line: string }[] = [
  { id: 'pdf', line: 'Work with a PDF' },
  { id: 'qr', line: 'Create a QR code' },
  { id: 'images', line: 'Resize an image' },
  { id: 'mileage', line: 'Track mileage' },
  { id: 'receipts', line: 'Save a receipt' },
  { id: 'links', line: 'Make a Link Page' },
];

/** "What would you like to do?" — each a real tool in this Space, ready to use. */
export function Starters({ workspace, className }: { workspace: Workspace; className?: string }) {
  const base = `/${workspace.space.slug}`;
  const items = firsts
    .map(({ id, line }) => ({ line, tool: tools.find((tool) => tool.id === id)! }))
    .filter(
      ({ tool }) =>
        tool?.path && availability(tool, workspace.space, workspace.membership).state === 'ready',
    );
  return (
    <ul className={className ?? 'grid gap-2.5 sm:grid-cols-2'}>
      {items.map(({ tool, line }) => (
        <li key={tool.id}>
          <Link
            href={`${base}${tool.path}`}
            className="group flex items-center gap-3.5 rounded-[16px] bg-surface p-3.5 shadow-card transition-[box-shadow,transform] duration-200 hover:shadow-lift active:scale-[.99]"
          >
            <ToolGlyph tool={tool} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-ink">{line}</span>
              <span className="block truncate text-[12.5px] text-muted">{tool.tagline}</span>
            </span>
            <Icon
              name="arrow-right"
              size={16}
              className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
