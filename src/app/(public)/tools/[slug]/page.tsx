import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ToolRuntime } from '@/components/marketplace/tool-runtime';
import { ComingSoon, Related, ToolDetails, ToolHeader } from '@/components/marketplace/tool-page';
import { isReady, routableTools, toolBySlug } from '@/lib/catalog';

/**
 * One page per tool, generated from the registry at build time. Unknown addresses are 404s
 * through notFound() below, not `dynamicParams = false`: Spaces revalidate every page after a
 * change, and a regenerated page under `dynamicParams = false` falls through to the Spaces route.
 */
export function generateStaticParams() {
  return routableTools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: PageProps<'/tools/[slug]'>): Promise<Metadata> {
  const tool = toolBySlug((await params).slug);
  if (!tool) return {};
  return {
    title: `${tool.name} — ${tool.kind}`,
    description: `${tool.tagline} ${tool.description}`,
    alternates: { canonical: `tools/${tool.slug}` },
    robots: tool.visibility === 'unlisted' ? { index: false, follow: false } : undefined,
    openGraph: {
      title: `${tool.name} · Hyphy Tools`,
      description: tool.tagline,
      type: 'website',
    },
  };
}

export default async function ToolPage({ params }: PageProps<'/tools/[slug]'>) {
  const tool = toolBySlug((await params).slug);
  if (!tool) notFound();
  return (
    <article style={{ '--accent': tool.accent } as React.CSSProperties}>
      <ToolHeader tool={tool} />
      <section
        id="tool"
        aria-label={isReady(tool) ? `${tool.name}, the tool` : `${tool.name} is coming soon`}
        className="mx-auto w-full max-w-[1320px] scroll-mt-20 px-3 sm:px-6 lg:px-8"
      >
        {isReady(tool) ? <ToolRuntime id={tool.id} /> : <ComingSoon tool={tool} />}
      </section>
      <ToolDetails tool={tool} />
      <Related tool={tool} />
    </article>
  );
}
