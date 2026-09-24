import { FileRow } from '@/components/records/rows';
import { PdfTool } from '@/components/tools/pdf-tool';
import { ToolHeader } from '@/components/tools/tool-header';
import { Page } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { openPage } from '@/lib/page';
import { getTool } from '@/lib/platform/tools';

export const metadata = { title: 'PDF' };

export default async function PdfPage({ params }: PageProps<'/[space]/tools/pdf'>) {
  const { workspace, repo, base, people, tz, can } = await openPage(params, 'pdf');
  const made = (await repo.files())
    .filter((file) => file.source === 'pdf' || file.kind === 'pdf')
    .slice(0, 6);
  return (
    <Page wide>
      <ToolHeader tool={getTool('pdf')!} />
      <PdfTool slug={workspace.space.slug} canSave={can('files.upload')} />
      {made.length > 0 && (
        <Panel className="mt-6">
          <PanelHeader
            title="Recent PDFs in this Space"
            href={`${base}/files`}
            action="All files"
          />
          <div className="pb-1.5">
            {made.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                base={base}
                people={people}
                timezone={tz}
                context={file.source === 'pdf' ? 'Made with PDF' : file.folder}
              />
            ))}
          </div>
        </Panel>
      )}
    </Page>
  );
}
