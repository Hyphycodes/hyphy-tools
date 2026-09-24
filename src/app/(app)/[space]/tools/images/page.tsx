import { ImageTool } from '@/components/tools/image-tool';
import { ToolHeader } from '@/components/tools/tool-header';
import { Page } from '@/components/ui/page';
import { openPage } from '@/lib/page';
import { getTool } from '@/lib/platform/tools';

export const metadata = { title: 'Image Resize' };

export default async function ImagesPage({ params }: PageProps<'/[space]/tools/images'>) {
  const { workspace, can } = await openPage(params, 'images');
  return (
    <Page wide>
      <ToolHeader tool={getTool('images')!} />
      <ImageTool slug={workspace.space.slug} canSave={can('files.upload')} />
    </Page>
  );
}
