import { LinkEditor } from '@/components/tools/link-editor';
import { ToolHeader } from '@/components/tools/tool-header';
import { Page } from '@/components/ui/page';
import { openPage } from '@/lib/page';
import { getTool } from '@/lib/platform/tools';

export const metadata = { title: 'Link Pages' };

export default async function LinksPage({ params }: PageProps<'/[space]/tools/links'>) {
  const { workspace, repo, base } = await openPage(params, 'links');
  const [[page], codes] = await Promise.all([repo.linkPages(), repo.qrCodes()]);
  const code = page ? codes.find((item) => item.linkPageId === page.id) : undefined;
  return (
    <Page wide>
      <ToolHeader tool={getTool('links')!} />
      <LinkEditor
        key={page?.id ?? 'new'}
        slug={workspace.space.slug}
        page={page}
        base={base}
        code={code}
        brand={workspace.space.brand.color}
      />
    </Page>
  );
}
