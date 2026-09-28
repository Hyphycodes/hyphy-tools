import { cn } from '@/components/ui/cn';

/*
 * Palette's pictures, drawn inline: a photo coming apart into swatches (the first screen) and
 * two small previews of the samples. Motion is transform/opacity only and stops for reduced motion.
 */

const SCENE = ['#2b1b4d', '#5a2462', '#8a2f6e', '#b8415f', '#e2555a', '#f7a24e', '#ffd166'];
const FAN = ['#2b1b4d', '#8a2f6e', '#e2555a', '#f7a24e', '#ffd166'];

/** The pixels leaving the photo: fewer and further apart the further they get. */
const PIXELS = (() => {
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const list: { x: number; y: number; size: number; fill: string; delay: number }[] = [];
  for (let col = 0; col < 7; col += 1)
    for (let row = 0; row < 10; row += 1) {
      if (random() > 0.92 - col * 0.11) continue;
      const band = Math.min(SCENE.length - 1, Math.floor((row / 10) * SCENE.length));
      list.push({
        x: 214 + col * 15 + col * col * 1.6 + (random() - 0.5) * 6,
        y: 44 + row * 15 + (random() - 0.5) * 8 - col * 2,
        size: Math.max(5, 12 - col * 1.1),
        fill: row > 8 ? '#1f3b63' : SCENE[band],
        delay: Math.round(random() * 2400),
      });
    }
  return list;
})();

export function PaletteArt({ busy = false }: { busy?: boolean }) {
  return (
    <svg
      viewBox="0 0 520 230"
      aria-hidden="true"
      className={cn('palette-art mx-auto block h-auto w-full max-w-[460px]', busy && 'is-busy')}
    >
      <style>{`
        .palette-art .px { animation: palette-drift 3.2s ease-in-out infinite alternate; transform-box: fill-box; }
        .palette-art .bar { animation: palette-sway 4.8s ease-in-out infinite alternate; transform-box: view-box; transform-origin: 410px 214px; }
        .palette-art.is-busy .px { animation-duration: .9s; }
        @keyframes palette-drift { from { transform: translate(0, 0); opacity: .95 } to { transform: translate(7px, -5px); opacity: .55 } }
        @keyframes palette-sway { from { transform: rotate(var(--a)) } to { transform: rotate(calc(var(--a) * 1.18)) } }
        @media (prefers-reduced-motion: reduce) { .palette-art .px, .palette-art .bar { animation: none } }
      `}</style>
      <defs>
        <linearGradient id="palette-art-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1b4d" />
          <stop offset=".45" stopColor="#8a2f6e" />
          <stop offset=".8" stopColor="#e2555a" />
          <stop offset="1" stopColor="#f7a24e" />
        </linearGradient>
        <linearGradient id="palette-art-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f3b63" />
          <stop offset="1" stopColor="#0d1b33" />
        </linearGradient>
        <clipPath id="palette-art-photo">
          <rect x="40" y="36" width="178" height="160" rx="16" />
        </clipPath>
      </defs>

      {/* The photo */}
      <g transform="rotate(-6 129 116)">
        <rect x="32" y="28" width="194" height="176" rx="22" fill="#fff" opacity=".92" />
        <g clipPath="url(#palette-art-photo)">
          <rect x="40" y="36" width="178" height="112" fill="url(#palette-art-sky)" />
          <circle cx="150" cy="148" r="26" fill="#ffd166" />
          <path d="M40 148 L40 112 Q70 96 96 118 T140 124 L140 148 Z" fill="#4a2358" />
          <rect x="40" y="148" width="178" height="48" fill="url(#palette-art-sea)" />
          <rect x="128" y="158" width="40" height="3" rx="1.5" fill="#ffd166" opacity=".8" />
          <rect x="136" y="168" width="26" height="3" rx="1.5" fill="#f7a24e" opacity=".7" />
          <rect x="142" y="178" width="16" height="3" rx="1.5" fill="#f7a24e" opacity=".5" />
        </g>
      </g>

      {/* Coming apart */}
      {PIXELS.map((pixel, index) => (
        <rect
          key={index}
          className="px"
          x={pixel.x}
          y={pixel.y}
          width={pixel.size}
          height={pixel.size}
          rx={2}
          fill={pixel.fill}
          style={{ animationDelay: `-${pixel.delay}ms` }}
        />
      ))}

      {/* ...into swatches */}
      {FAN.map((fill, index) => {
        const angle = (index - 2) * 11;
        return (
          <g key={fill} className="bar" style={{ ['--a' as string]: `${angle}deg` }}>
            <rect x="392" y="40" width="36" height="174" rx="12" fill={fill} />
            <rect
              x="392"
              y="40"
              width="36"
              height="174"
              rx="12"
              fill="none"
              stroke="#000"
              strokeOpacity=".18"
            />
            <circle cx="410" cy="196" r="4" fill="#fff" opacity=".85" />
          </g>
        );
      })}
    </svg>
  );
}

/** The sunset sample, small. */
export function SunsetThumb({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 110"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="palette-thumb-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2b1b4d" />
          <stop offset=".45" stopColor="#8a2f6e" />
          <stop offset=".75" stopColor="#e2555a" />
          <stop offset="1" stopColor="#f7a24e" />
        </linearGradient>
      </defs>
      <rect width="160" height="66" fill="url(#palette-thumb-sky)" />
      <circle cx="99" cy="66" r="15" fill="#ffd166" />
      <path d="M0 66 L0 44 Q24 32 44 48 T72 52 L72 66 Z" fill="#4a2358" />
      <rect y="66" width="160" height="44" fill="#1a3056" />
      <rect x="84" y="72" width="30" height="2.5" rx="1" fill="#ffd166" opacity=".8" />
      <rect x="90" y="80" width="18" height="2.5" rx="1" fill="#f7a24e" opacity=".7" />
      <path d="M0 110 Q48 92 99 104 T160 99 L160 110 Z" fill="#120c1f" />
    </svg>
  );
}

/** The logo sample, small. */
export function LogoThumb({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 110"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={className}
    >
      <rect width="160" height="110" fill="#F1FAEE" />
      <clipPath id="palette-thumb-logo">
        <circle cx="80" cy="48" r="34" />
      </clipPath>
      <circle cx="80" cy="48" r="34" fill="#E4572E" />
      <g clipPath="url(#palette-thumb-logo)">
        <path d="M40 58 Q52 52 62 58 T84 58 T106 58 T128 58 L128 90 L40 90 Z" fill="#1D3557" />
        <path
          d="M44 68 Q56 63 66 68 T88 68 T110 68"
          fill="none"
          stroke="#F1FAEE"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle cx="95" cy="31" r="7" fill="#F1FAEE" />
      </g>
      <rect x="46" y="92" width="68" height="7" rx="3.5" fill="#1D3557" />
    </svg>
  );
}
