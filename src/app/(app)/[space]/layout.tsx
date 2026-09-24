import type { Metadata } from 'next';
import { AppShell } from '@/components/shell/app-shell';
import { getRepository } from '@/lib/data';
import { demoModel } from '@/lib/demo/model';
import { getWorkspace, requireWorkspace } from '@/lib/identity';
import { buildSearchIndex } from '@/lib/search';
import { buildShellModel } from '@/lib/shell';

export async function generateMetadata({ params }: LayoutProps<'/[space]'>): Promise<Metadata> {
  const workspace = await getWorkspace((await params).space);
  return {
    title: {
      default: workspace?.space.name ?? 'Hyphy Tools',
      template: `%s · ${workspace?.space.name ?? 'Hyphy Tools'}`,
    },
  };
}

/** Every page inside a Space: resolve who's here and what they can do, then draw the shell. */
export default async function SpaceLayout({ children, params }: LayoutProps<'/[space]'>) {
  const workspace = await requireWorkspace((await params).space);
  const repo = getRepository(workspace);
  const demo = workspace.session.source === 'demo' ? await demoModel(workspace) : null;
  const model = await buildShellModel(workspace, repo);
  const search = await buildSearchIndex(workspace, repo, model.nav, model.actions, demo);
  return (
    <AppShell model={model} search={search} demo={demo}>
      {children}
    </AppShell>
  );
}
