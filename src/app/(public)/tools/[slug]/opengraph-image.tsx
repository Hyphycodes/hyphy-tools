import { ImageResponse } from 'next/og';
import { accountLabel, privacyFacts, routableTools, statusLabel, toolBySlug } from '@/lib/catalog';

/** The card a tool's link shows when it's shared: its name, its promise, its accent. */
export const alt = 'A Hyphy tool';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return routableTools.map((tool) => ({ slug: tool.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const tool = toolBySlug((await params).slug);
  const accent = tool?.accent ?? '#8f9bff';
  const facts = tool
    ? [
        tool.status === 'available' ? 'Free' : statusLabel[tool.status],
        privacyFacts(tool).local ? 'Runs on your device' : 'With an account',
        accountLabel(tool),
      ]
    : [];
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        background: `radial-gradient(circle at 88% 12%, ${accent}55, transparent 46%), radial-gradient(circle at 0% 100%, ${accent}22, transparent 50%), #0b0b0a`,
        color: '#ece8df',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 30 }}>
        <span style={{ letterSpacing: 2 }}>HYPHY</span>
        <span style={{ width: 2, height: 26, background: '#3a3934' }} />
        <span style={{ color: '#9a958a' }}>Tools</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            letterSpacing: 4,
            color: '#9a958a',
            textTransform: 'uppercase',
          }}
        >
          {tool?.kind ?? 'Tools'}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 112,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          {tool?.name ?? 'Hyphy Tools'}
        </div>
        <div style={{ display: 'flex', fontSize: 40, color: '#cfcabf', maxWidth: 980 }}>
          {tool?.tagline ?? 'Useful little things. Serious systems.'}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: accent }} />
        <div style={{ display: 'flex', fontSize: 26, color: '#9a958a' }}>{facts.join('  ·  ')}</div>
      </div>
    </div>,
    size,
  );
}
