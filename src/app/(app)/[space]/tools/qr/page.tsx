import Link from 'next/link';
import { QrMini } from '@/components/records/qr-mini';
import { QrTool } from '@/components/tools/qr-tool';
import { ToolHeader } from '@/components/tools/tool-header';
import { cn } from '@/components/ui/cn';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { formatRelative } from '@/lib/platform/format';
import { getTool } from '@/lib/platform/tools';

export const metadata = { title: 'QR Codes' };

export default async function QrPage({ params, searchParams }: PageProps<'/[space]/tools/qr'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'qr');
  const query = await searchParams;
  const selectedId = query.code;
  const content = typeof query.content === 'string' ? query.content.slice(0, 1000) : undefined;
  const codes = await repo.qrCodes();
  const selected = codes.find((code) => code.id === selectedId);
  const tool = getTool('qr')!;

  return (
    <Page wide>
      <ToolHeader
        tool={tool}
        note={
          <span>
            Static codes: the link is printed into the code, so print it once and it works for good.
          </span>
        }
      />
      <QrTool
        key={selected?.id ?? content ?? 'new'}
        slug={workspace.space.slug}
        canSave={can('tools.use')}
        initial={
          selected
            ? { content: selected.content, fg: selected.fg, bg: selected.bg, label: selected.label }
            : {
                content:
                  content ??
                  (workspace.space.kind === 'personal' ? 'https://hyphy.example/jerry' : ''),
                fg: '#0f0f0e',
                bg: '#ffffff',
                label: '',
              }
        }
      />
      <Panel className="mt-6">
        <PanelHeader
          title={`Saved in ${workspace.space.kind === 'personal' ? 'Personal' : workspace.space.name}`}
          count={codes.length}
        />
        {codes.length ? (
          <ul className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-5">
            {codes.map((code) => (
              <li key={code.id}>
                <Link
                  href={`${base}/tools/qr?code=${code.id}`}
                  scroll={false}
                  className={cn(
                    'group block rounded-[16px] p-2.5 transition-colors hover:bg-subtle',
                    code.id === selected?.id && 'bg-signal-soft/70',
                  )}
                >
                  <span className="block rounded-[12px] bg-white p-2 shadow-card transition-transform group-hover:-translate-y-0.5">
                    <QrMini content={code.content} fg={code.fg} bg={code.bg} />
                  </span>
                  <span className="mt-2 block truncate text-[13.5px] font-medium">
                    {code.label}
                  </span>
                  <span className="block truncate text-[12px] text-muted">
                    {[
                      code.placement,
                      people.get(code.createdBy)?.firstName,
                      formatRelative(code.createdAt, tz),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 text-[13.5px] text-muted">
            Codes you save show up here for everyone in this Space.
          </p>
        )}
      </Panel>
    </Page>
  );
}
