import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import type { Tool, ToolId } from '@/lib/catalog';

/*
 * Tool artwork: every tool gets its own composition, drawn from what it actually makes (a receipt
 * cut three ways, a week lit where everyone's free, a real QR code), on a charcoal stage lit in
 * its accent. One stage, many pictures: related tools rhyme, nothing is a generic card.
 *
 * Drawn in a 400×300 box and centred, so the same art sits in a wide card, a tall one or a hero.
 * Pure SVG, no scripts, no ids: safe to render anywhere, any number of times.
 */

const PAPER = '#efebe2';
const INK = '#12110d';
const DIM = 'rgba(236,232,223,.42)';
const FAINT = 'rgba(236,232,223,.16)';
const EDGE = 'rgba(255,255,255,.09)';
const CARD = '#1a1a17';
const mono: CSSProperties = { fontFamily: 'var(--font-martian), ui-monospace, monospace' };
const sans: CSSProperties = { fontFamily: 'var(--font-mona), system-ui, sans-serif' };
const display: CSSProperties = {
  fontFamily: 'var(--font-hubot), var(--font-mona), sans-serif',
  fontVariationSettings: "'wdth' 112",
};

type Draw = (accent: string) => ReactNode;

/** A few grey bars: text, abstracted. */
function Bars({
  x,
  y,
  widths,
  gap = 11,
  fill = 'rgba(18,17,13,.16)',
  h = 4,
}: {
  x: number;
  y: number;
  widths: number[];
  gap?: number;
  fill?: string;
  h?: number;
}) {
  return (
    <>
      {widths.map((width, index) => (
        <rect
          key={index}
          x={x}
          y={y + index * gap}
          width={width}
          height={h}
          rx={h / 2}
          fill={fill}
        />
      ))}
    </>
  );
}

/** A small landscape photo, drawn: sky, sun, two hills. */
function Photo({
  x,
  y,
  w,
  h,
  r = 8,
  sky = ['#f6b77a', '#f7d9a8'],
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  sky?: [string, string];
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={sky[1]} />
      <rect x={x} y={y} width={w} height={h * 0.45} rx={r} fill={sky[0]} opacity={0.85} />
      <circle cx={x + w * 0.68} cy={y + h * 0.38} r={Math.min(w, h) * 0.11} fill="#fff4d6" />
      <path
        d={`M${x} ${y + h * 0.7} Q ${x + w * 0.3} ${y + h * 0.48} ${x + w * 0.55} ${y + h * 0.66} T ${x + w} ${y + h * 0.58} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} Z`}
        fill="#8a6a4f"
      />
      <path
        d={`M${x} ${y + h * 0.84} Q ${x + w * 0.45} ${y + h * 0.7} ${x + w} ${y + h * 0.86} V ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} H ${x + r} Q ${x} ${y + h} ${x} ${y + h - r} Z`}
        fill="#3a3129"
      />
    </g>
  );
}

const QR_ROWS = [
  '1111111011001111101111111',
  '1000001000010100101000001',
  '1011101001110001001011101',
  '1011101011000111001011101',
  '1011101011001011101011101',
  '1000001011111110001000001',
  '1111111010101010101111111',
  '0000000011111011000000000',
  '1000101110111000111111001',
  '0001100101001011110011010',
  '1001111001010111011001100',
  '0110000100100010100010110',
  '1111111011100010111101111',
  '1101010000001011110010010',
  '0000101110011111010111100',
  '0001000101110001010110110',
  '1110001001101001111111100',
  '0000000010100110100010000',
  '1111111010100100101010000',
  '1000001000001011100011110',
  '1011101011111000111111100',
  '1011101001001011011100111',
  '1011101001111111011001010',
  '1000001001011010011111110',
  '1111111011011001001000111',
];

const inFinder = (row: number, col: number) =>
  (row < 7 && col < 7) || (row < 7 && col > 17) || (row > 17 && col < 7);
const inLogo = (row: number, col: number) => row >= 10 && row <= 14 && col >= 10 && col <= 14;

const compositions: Record<ToolId, Draw> = {
  split: (a) => (
    <>
      <g transform="rotate(-4 148 150)">
        <path
          d="M84 34h128a6 6 0 0 1 6 6v214l-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-6-6V40a6 6 0 0 1 6-6Z"
          fill={PAPER}
        />
        <text
          x="148"
          y="60"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill={INK}
          style={mono}
        >
          TABLE 12
        </text>
        {[
          { y: 84, w: 64, price: '$14.00', dots: [a] },
          { y: 104, w: 52, price: '$22.50', dots: ['#8f9bff'] },
          { y: 124, w: 72, price: '$9.00', dots: [a, '#ff8ad8'] },
          { y: 144, w: 44, price: '$18.00', dots: ['#ff8ad8'] },
          { y: 164, w: 58, price: '$11.50', dots: ['#8f9bff', a] },
        ].map((row) => (
          <g key={row.y}>
            {row.dots.map((dot, index) => (
              <circle
                key={index}
                cx={94 + index * 7}
                cy={row.y}
                r="3"
                fill={dot}
                stroke={INK}
                strokeOpacity=".2"
              />
            ))}
            <rect
              x="110"
              y={row.y - 2.5}
              width={row.w}
              height="5"
              rx="2.5"
              fill="rgba(18,17,13,.18)"
            />
            <text x="206" y={row.y + 3} textAnchor="end" fontSize="8.5" fill={INK} style={mono}>
              {row.price}
            </text>
          </g>
        ))}
        <path d="M92 186h114" stroke={INK} strokeOpacity=".25" strokeDasharray="3 3" />
        <Bars x={92} y={198} widths={[30, 26]} fill="rgba(18,17,13,.14)" />
        <text x="206" y="203" textAnchor="end" fontSize="8" fill={INK} opacity=".6" style={mono}>
          $6.18
        </text>
        <text x="206" y="214" textAnchor="end" fontSize="8" fill={INK} opacity=".6" style={mono}>
          $13.62
        </text>
        <text x="92" y="238" fontSize="10" fontWeight="700" fill={INK} style={mono}>
          TOTAL
        </text>
        <text
          x="206"
          y="238"
          textAnchor="end"
          fontSize="10"
          fontWeight="700"
          fill={INK}
          style={mono}
        >
          $94.80
        </text>
      </g>
      {[
        { y: 76, name: 'Ana', total: '$34.14', color: a, on: true },
        { y: 130, name: 'Ben', total: '$29.06', color: '#8f9bff' },
        { y: 184, name: 'Cam', total: '$31.60', color: '#ff8ad8' },
      ].map((person) => (
        <g key={person.name}>
          <rect
            x="238"
            y={person.y}
            width="124"
            height="42"
            rx="21"
            fill={CARD}
            stroke={person.on ? person.color : EDGE}
            strokeWidth={person.on ? 1.6 : 1}
          />
          <circle cx="259" cy={person.y + 21} r="12" fill={person.color} />
          <text
            x="259"
            y={person.y + 25}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill={INK}
            style={sans}
          >
            {person.name[0]}
          </text>
          <text x="278" y={person.y + 18} fontSize="10" fill={DIM} style={sans}>
            {person.name}
          </text>
          <text
            x="278"
            y={person.y + 31}
            fontSize="11.5"
            fontWeight="600"
            fill={PAPER}
            style={mono}
          >
            {person.total}
          </text>
        </g>
      ))}
    </>
  ),

  when: (a) => {
    const heat = [
      [0.1, 0.25, 0.15, 0.3, 0.2, 0.45, 0.2],
      [0.2, 0.4, 0.3, 0.35, 0.5, 0.72, 0.35],
      [0.15, 0.55, 0.45, 0.5, 0.66, 0.86, 0.5],
      [0.08, 0.35, 0.3, 0.6, 0.78, 1, 0.6],
      [0.05, 0.2, 0.25, 0.4, 0.55, 0.7, 0.4],
      [0, 0.1, 0.15, 0.2, 0.3, 0.45, 0.25],
    ];
    return (
      <>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, col) => (
          <text
            key={col}
            x={80 + col * 40}
            y="70"
            textAnchor="middle"
            fontSize="10"
            fill={DIM}
            style={mono}
          >
            {day}
          </text>
        ))}
        {heat.map((row, r) =>
          row.map((value, col) => (
            <rect
              key={`${r}-${col}`}
              x={63 + col * 40}
              y={82 + r * 29}
              width="34"
              height="23"
              rx="6"
              fill={value ? a : 'none'}
              fillOpacity={value ? 0.12 + value * 0.88 : 0}
              stroke={value ? 'none' : FAINT}
            />
          )),
        )}
        <rect
          x="263"
          y="167"
          width="34"
          height="23"
          rx="6"
          fill="none"
          stroke={PAPER}
          strokeWidth="2"
        />
        <g>
          <rect x="222" y="120" width="116" height="30" rx="15" fill={PAPER} />
          <path d="M276 150l4 6 4-6" fill={PAPER} />
          <text
            x="280"
            y="139"
            textAnchor="middle"
            fontSize="10.5"
            fontWeight="700"
            fill={INK}
            style={sans}
          >
            Sat 7 PM · 6 of 6
          </text>
        </g>
      </>
    );
  },

  bring: (a) => (
    <>
      <rect x="92" y="40" width="216" height="222" rx="20" fill={CARD} stroke={EDGE} />
      <text x="114" y="72" fontSize="14" fontWeight="700" fill={PAPER} style={display}>
        Saturday cookout
      </text>
      <text x="114" y="88" fontSize="8.5" fill={DIM} style={mono}>
        8 OF 9 CLAIMED
      </text>
      {[
        { item: 'Burgers & buns', who: 'D', color: '#8f9bff' },
        { item: 'Ice, lots of it', who: '', color: '' },
        { item: 'Chips & salsa', who: 'M', color: '#ff8ad8' },
        { item: 'Speaker', who: 'J', color: '#7ce0c3' },
        { item: 'Folding chairs', who: 'R', color: a },
      ].map((row, index) => {
        const y = 112 + index * 30;
        const open = !row.who;
        return (
          <g key={row.item}>
            {index > 0 && <path d={`M114 ${y - 15}h172`} stroke={EDGE} />}
            <circle
              cx="120"
              cy={y}
              r="7"
              fill={open ? 'none' : a}
              stroke={open ? DIM : 'none'}
              strokeDasharray={open ? '2 2' : undefined}
            />
            {!open && (
              <path
                d={`M116.5 ${y}l2.4 2.4 4.6-4.8`}
                stroke={INK}
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
            )}
            <text x="136" y={y + 4} fontSize="11.5" fill={open ? PAPER : DIM} style={sans}>
              {row.item}
            </text>
            {open ? (
              <g>
                <rect x="246" y={y - 10} width="44" height="20" rx="10" fill={a} />
                <text
                  x="268"
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill={INK}
                  style={sans}
                >
                  Claim
                </text>
              </g>
            ) : (
              <g>
                <circle cx="278" cy={y} r="10" fill={row.color} />
                <text
                  x="278"
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize="9.5"
                  fontWeight="700"
                  fill={INK}
                  style={sans}
                >
                  {row.who}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </>
  ),

  where: (a) => (
    <>
      {[44, 84, 124].map((r) => (
        <circle key={r} cx="200" cy="162" r={r} fill="none" stroke={FAINT} strokeDasharray="3 5" />
      ))}
      <circle cx="200" cy="162" r="6" fill={PAPER} />
      <circle cx="200" cy="162" r="12" fill="none" stroke={PAPER} strokeOpacity=".3" />
      {[
        { x: 262, y: 118, label: 'Ramen' },
        { x: 118, y: 214, label: 'Pizza' },
        { x: 288, y: 222, label: 'Thai' },
      ].map((pin) => (
        <g key={pin.label}>
          <path
            d={`M${pin.x} ${pin.y}c-7-9-11-14-11-19a11 11 0 0 1 22 0c0 5-4 10-11 19Z`}
            fill={DIM}
          />
          <text x={pin.x} y={pin.y + 16} textAnchor="middle" fontSize="9" fill={DIM} style={sans}>
            {pin.label}
          </text>
        </g>
      ))}
      <g>
        <path d="M136 106c-9-11-14-17-14-24a14 14 0 0 1 28 0c0 7-5 13-14 24Z" fill={a} />
        <circle cx="136" cy="82" r="5" fill={INK} />
        <rect x="156" y="62" width="132" height="30" rx="15" fill={PAPER} />
        <text
          x="222"
          y="81"
          textAnchor="middle"
          fontSize="10.5"
          fontWeight="700"
          fill={INK}
          style={sans}
        >
          Tacos · $$ · 0.8 mi
        </text>
      </g>
    </>
  ),

  plan: (a) => (
    <>
      <rect x="112" y="34" width="176" height="232" rx="22" fill={CARD} stroke={EDGE} />
      <path d="M112 56a22 22 0 0 1 22-22h132a22 22 0 0 1 22 22v80H112Z" fill={a} />
      <text x="134" y="68" fontSize="10" fontWeight="700" fill={INK} opacity=".7" style={mono}>
        SAT · OCT
      </text>
      <text x="132" y="122" fontSize="58" fontWeight="800" fill={INK} style={display}>
        14
      </text>
      <text x="134" y="166" fontSize="15" fontWeight="700" fill={PAPER} style={display}>
        Rosa turns 30
      </text>
      <Bars x={134} y={180} widths={[108, 84]} fill={FAINT} gap={12} />
      {[0, 1, 2, 3].map((index) => (
        <circle
          key={index}
          cx={146 + index * 16}
          cy="232"
          r="11"
          fill={['#8f9bff', '#7ce0c3', '#ffd166', '#ff8ad8'][index]}
          stroke={CARD}
          strokeWidth="2.5"
        />
      ))}
      <text x="214" y="236" fontSize="10.5" fill={DIM} style={sans}>
        +8 going
      </text>
    </>
  ),

  qr: (a) => {
    const size = 7;
    const x0 = 112;
    const y0 = 62;
    const finders = [
      [0, 0],
      [0, 18],
      [18, 0],
    ];
    return (
      <>
        <rect x="94" y="44" width="211" height="211" rx="28" fill="#f4f1ea" />
        {QR_ROWS.map((row, r) =>
          [...row].map((bit, c) =>
            bit === '1' && !inFinder(r, c) && !inLogo(r, c) ? (
              <circle
                key={`${r}-${c}`}
                cx={x0 + c * size + 3.5}
                cy={y0 + r * size + 3.5}
                r="3.05"
                fill={INK}
              />
            ) : null,
          ),
        )}
        {finders.map(([r, c]) => (
          <g key={`${r}-${c}`}>
            <rect
              x={x0 + c * size + 3.5}
              y={y0 + r * size + 3.5}
              width="42"
              height="42"
              rx="12"
              fill="none"
              stroke={INK}
              strokeWidth="7"
            />
            <rect
              x={x0 + (c + 2) * size}
              y={y0 + (r + 2) * size}
              width="21"
              height="21"
              rx="6"
              fill={INK}
            />
          </g>
        ))}
        <rect
          x={x0 + 10 * size + 1}
          y={y0 + 10 * size + 1}
          width="33"
          height="33"
          rx="9"
          fill={a}
        />
        <path
          d={`M${x0 + 87.5} ${y0 + 76}v23M${x0 + 76} ${y0 + 87.5}h23M${x0 + 79.4} ${y0 + 79.4}l16.2 16.2M${x0 + 95.6} ${y0 + 79.4}l-16.2 16.2`}
          stroke={INK}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <g>
          <rect x="246" y="226" width="118" height="34" rx="17" fill={CARD} stroke={EDGE} />
          <path
            d="M263 244a9 9 0 0 1 13 0M266.5 247.5a4 4 0 0 1 6 0"
            stroke={a}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="269.5" cy="251" r="1.6" fill={a} />
          <text x="284" y="247.5" fontSize="10.5" fontWeight="600" fill={PAPER} style={sans}>
            Guest Wi-Fi
          </text>
        </g>
      </>
    );
  },

  'signal-pages': (a) => (
    <>
      <rect
        x="140"
        y="22"
        width="120"
        height="258"
        rx="28"
        fill="#0c0c0b"
        stroke="rgba(255,255,255,.16)"
        strokeWidth="1.5"
      />
      <rect x="147" y="29" width="106" height="244" rx="22" fill={a} fillOpacity=".17" />
      <rect x="182" y="36" width="36" height="9" rx="4.5" fill="#0c0c0b" />
      <circle cx="200" cy="80" r="18" fill={a} />
      <text
        x="200"
        y="86"
        textAnchor="middle"
        fontSize="16"
        fontWeight="800"
        fill={INK}
        style={display}
      >
        R
      </text>
      <rect x="170" y="106" width="60" height="7" rx="3.5" fill={PAPER} />
      <rect x="182" y="118" width="36" height="4" rx="2" fill={DIM} />
      {[140, 168, 196, 224].map((y, index) => (
        <g key={y}>
          <rect
            x="158"
            y={y}
            width="84"
            height="21"
            rx="10.5"
            fill={index === 0 ? PAPER : 'rgba(255,255,255,.1)'}
          />
          <rect
            x="182"
            y={y + 8.5}
            width={[36, 30, 40, 26][index]}
            height="4"
            rx="2"
            fill={index === 0 ? 'rgba(18,17,13,.45)' : DIM}
          />
        </g>
      ))}
      {[0, 1, 2, 3].map((index) => (
        <circle key={index} cx={176 + index * 16} cy="258" r="4.5" fill="rgba(255,255,255,.28)" />
      ))}
      <g>
        <rect x="270" y="150" width="70" height="70" rx="14" fill="#f4f1ea" />
        {QR_ROWS.slice(0, 9).map((row, r) =>
          [...row.slice(0, 9)].map((bit, c) =>
            bit === '1' ? (
              <rect
                key={`${r}-${c}`}
                x={282 + c * 5}
                y={162 + r * 5}
                width="5"
                height="5"
                fill={INK}
              />
            ) : null,
          ),
        )}
      </g>
      <g>
        <rect x="52" y="92" width="80" height="28" rx="14" fill={CARD} stroke={EDGE} />
        <text
          x="92"
          y="110"
          textAnchor="middle"
          fontSize="10.5"
          fontWeight="600"
          fill={PAPER}
          style={sans}
        >
          @rosa.eats
        </text>
      </g>
    </>
  ),

  'signal-links': (a) => (
    <>
      <rect x="36" y="74" width="328" height="44" rx="14" fill={CARD} stroke={EDGE} />
      <circle cx="58" cy="96" r="5" fill="none" stroke={DIM} strokeWidth="1.5" />
      <text x="72" y="100" fontSize="11.5" fill={PAPER} style={mono}>
        yourshop.example/fall
        <tspan fill={a}>?utm_source=…</tspan>
      </text>
      {[
        { x: 36, w: 104, k: 'source', v: 'instagram' },
        { x: 148, w: 92, k: 'medium', v: 'story' },
        { x: 248, w: 116, k: 'campaign', v: 'fall-menu' },
      ].map((chip, index) => (
        <g key={chip.k}>
          <path
            d={`M${chip.x + chip.w / 2} 150 C ${chip.x + chip.w / 2} 134, ${250 + index * 20} 134, ${250 + index * 20} 118`}
            stroke={a}
            strokeOpacity=".5"
            fill="none"
          />
          <rect
            x={chip.x}
            y="150"
            width={chip.w}
            height="44"
            rx="12"
            fill={a}
            fillOpacity=".13"
            stroke={a}
            strokeOpacity=".6"
          />
          <text x={chip.x + 12} y="167" fontSize="8.5" fill={DIM} style={mono}>
            {chip.k.toUpperCase()}
          </text>
          <text x={chip.x + 12} y="183" fontSize="11.5" fontWeight="600" fill={PAPER} style={sans}>
            {chip.v}
          </text>
        </g>
      ))}
      <rect x="138" y="220" width="124" height="38" rx="19" fill={PAPER} />
      <rect
        x="160"
        y="232"
        width="10"
        height="12"
        rx="2"
        fill="none"
        stroke={INK}
        strokeWidth="1.6"
      />
      <rect
        x="164"
        y="229"
        width="10"
        height="12"
        rx="2"
        fill={PAPER}
        stroke={INK}
        strokeWidth="1.6"
      />
      <text x="184" y="243" fontSize="11.5" fontWeight="700" fill={INK} style={sans}>
        Copy link
      </text>
    </>
  ),

  pdf: (a) => (
    <>
      {[-15, -5, 5].map((rotate, index) => (
        <g key={rotate} transform={`rotate(${rotate} 200 270)`}>
          <rect
            x="152"
            y="64"
            width="96"
            height="124"
            rx="6"
            fill={PAPER}
            stroke="rgba(0,0,0,.2)"
          />
          <rect
            x="164"
            y="78"
            width={[40, 56, 48][index]}
            height="7"
            rx="3.5"
            fill={index === 2 ? a : 'rgba(18,17,13,.2)'}
          />
          <Bars x={164} y={96} widths={[70, 62, 72, 50, 66, 58]} gap={10} />
          <circle cx="236" cy="176" r="8" fill={INK} />
          <text
            x="236"
            y="179.5"
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill={PAPER}
            style={mono}
          >
            {index + 1}
          </text>
        </g>
      ))}
      <g transform="rotate(14 200 270)">
        <rect
          x="152"
          y="64"
          width="96"
          height="124"
          rx="6"
          fill={PAPER}
          stroke={a}
          strokeWidth="2"
        />
        <rect x="164" y="78" width="44" height="7" rx="3.5" fill="rgba(18,17,13,.2)" />
        <Bars x={164} y={96} widths={[64, 72, 56, 70, 48, 60]} gap={10} />
        <circle cx="236" cy="176" r="8" fill={a} />
        <text
          x="236"
          y="179.5"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill={INK}
          style={mono}
        >
          4
        </text>
      </g>
      <path
        d="M318 88a34 34 0 0 1-8 44"
        stroke={a}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M304 128l6 6 6-8"
        stroke={a}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="96" y="270" fontSize="10" fill={DIM} style={mono}>
        4 PAGES · 1 FILE
      </text>
    </>
  ),

  convert: (a) => (
    <>
      <g transform="rotate(-8 110 150)">
        <Photo x={58} y={92} w={104} h={74} />
      </g>
      <g transform="rotate(4 118 170)">
        <Photo x={64} y={132} w={104} h={74} sky={['#9ec5ff', '#e5eeff']} />
      </g>
      <path d="M190 150h36" stroke={a} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M218 141l10 9-10 9"
        stroke={a}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="250" y="70" width="104" height="138" rx="7" fill={PAPER} />
      <Photo x={262} y={84} w={80} h={52} r={4} />
      <Bars x={262} y={148} widths={[74, 60, 70]} gap={10} />
      <rect x="262" y="182" width="34" height="16" rx="8" fill={a} />
      <text
        x="279"
        y="193.5"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="800"
        fill={INK}
        style={mono}
      >
        PDF
      </text>
    </>
  ),

  clean: (a) => (
    <>
      <text x="44" y="70" fontSize="9" fill={DIM} style={mono}>
        BEFORE
      </text>
      <text x="214" y="70" fontSize="9" fill={DIM} style={mono}>
        AFTER
      </text>
      {[
        ['IMG_4471.JPG', '2026-09-28 Lake 01.jpg'],
        ['IMG_4472 (1).jpg', '2026-09-28 Lake 02.jpg'],
        ['Screen Shot 3.png', 'Receipt Sep 03.png'],
        ['DSC00912.JPG', '2026-09-28 Lake 03.jpg'],
      ].map(([before, after], index) => {
        const y = 100 + index * 44;
        return (
          <g key={before}>
            <text
              x="44"
              y={y + 4}
              fontSize="10.5"
              fill={DIM}
              style={mono}
              textDecoration="line-through"
            >
              {before}
            </text>
            <path d={`M186 ${y}h14`} stroke={a} strokeWidth="2" strokeLinecap="round" />
            <path
              d={`M196 ${y - 4}l4 4-4 4`}
              stroke={a}
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
            <rect
              x="208"
              y={y - 14}
              width="156"
              height="28"
              rx="9"
              fill={a}
              fillOpacity={index === 0 ? 0.22 : 0.1}
              stroke={index === 0 ? a : 'none'}
              strokeOpacity=".6"
            />
            <text x="218" y={y + 4} fontSize="10.5" fill={PAPER} style={mono}>
              {after}
            </text>
          </g>
        );
      })}
    </>
  ),

  duplicates: (a) => (
    <>
      <g opacity=".35">
        <rect x="64" y="96" width="70" height="92" rx="8" fill={CARD} stroke={EDGE} />
        <rect x="266" y="112" width="70" height="92" rx="8" fill={CARD} stroke={EDGE} />
      </g>
      <g transform="rotate(-7 162 150)">
        <rect x="104" y="72" width="116" height="150" rx="12" fill={CARD} stroke={EDGE} />
        <Photo x={114} y={82} w={96} h={96} r={6} />
        <Bars x={114} y={190} widths={[70, 44]} gap={10} fill={FAINT} />
      </g>
      <g transform="rotate(6 238 150)">
        <rect
          x="180"
          y="72"
          width="116"
          height="150"
          rx="12"
          fill={CARD}
          stroke={a}
          strokeWidth="1.6"
        />
        <Photo x={190} y={82} w={96} h={96} r={6} />
        <Bars x={190} y={190} widths={[70, 44]} gap={10} fill={FAINT} />
      </g>
      <circle cx="200" cy="146" r="20" fill={a} />
      <path d="M190 141h20M190 151h20" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      <text x="200" y="262" textAnchor="middle" fontSize="10" fill={DIM} style={mono}>
        SHA-256 9F2C…E41A · 2 COPIES
      </text>
    </>
  ),

  resize: (a) => (
    <>
      <Photo x={46} y={58} w={210} h={158} r={10} />
      <path
        d="M256 58 L300 150 M256 216 L300 212"
        stroke={a}
        strokeOpacity=".6"
        strokeDasharray="4 4"
      />
      <Photo x={300} y={150} w={82} h={62} r={6} />
      <rect x="300" y="150" width="82" height="62" rx="6" fill="none" stroke={a} strokeWidth="2" />
      <text x="46" y="240" fontSize="10" fill={DIM} style={mono}>
        4032 × 3024 · 4.8 MB
      </text>
      <text x="382" y="232" textAnchor="end" fontSize="10.5" fontWeight="700" fill={a} style={mono}>
        380 KB
      </text>
    </>
  ),

  'social-crop': (a) => (
    <>
      <Photo x={56} y={54} w={288} h={192} r={12} sky={['#f59e7c', '#fcd9b8']} />
      <rect x="56" y="54" width="288" height="192" rx="12" fill="rgba(0,0,0,.28)" />
      <rect
        x="70"
        y="72"
        width="260"
        height="146"
        rx="4"
        fill="none"
        stroke={PAPER}
        strokeOpacity=".55"
        strokeDasharray="5 5"
      />
      <rect x="176" y="84" width="124" height="124" rx="4" fill="none" stroke={a} strokeWidth="3" />
      <rect
        x="116"
        y="64"
        width="66"
        height="118"
        rx="4"
        fill="none"
        stroke={PAPER}
        strokeWidth="2"
      />
      {[
        { x: 70, y: 226, text: '16:9 · YouTube', fill: 'rgba(255,255,255,.14)', color: PAPER },
        { x: 176, y: 214, text: '1:1 · Post', fill: a, color: INK },
        { x: 116, y: 188, text: '9:16 · Story', fill: PAPER, color: INK },
      ].map((tag) => (
        <g key={tag.text}>
          <rect
            x={tag.x}
            y={tag.y}
            width={tag.text.length * 6.4 + 16}
            height="20"
            rx="10"
            fill={tag.fill}
          />
          <text
            x={tag.x + 8}
            y={tag.y + 13.5}
            fontSize="9.5"
            fontWeight="700"
            fill={tag.color}
            style={sans}
          >
            {tag.text}
          </text>
        </g>
      ))}
    </>
  ),

  palette: () => {
    const swatches = ['#e9c46a', '#f4a261', '#e76f51', '#2a9d8f', '#264653'];
    return (
      <>
        <rect x="70" y="36" width="260" height="150" rx="16" fill="#e9c46a" />
        <rect x="70" y="36" width="260" height="70" rx="16" fill="#f4a261" />
        <rect x="70" y="90" width="260" height="20" fill="#f4a261" opacity=".6" />
        <circle cx="262" cy="94" r="26" fill="#e76f51" />
        <path
          d="M70 150 Q150 108 220 138 T330 128 V170 Q330 186 314 186 H86 Q70 186 70 170 Z"
          fill="#2a9d8f"
        />
        <path
          d="M70 168 Q180 146 330 172 V170 Q330 186 314 186 H86 Q70 186 70 170 Z"
          fill="#264653"
        />
        <circle cx="262" cy="94" r="12" fill="none" stroke={PAPER} strokeWidth="2.5" />
        <path d="M271 103l22 22" stroke={PAPER} strokeWidth="2.5" strokeLinecap="round" />
        {swatches.map((color, index) => (
          <g key={color}>
            <rect x={62 + index * 57} y="202" width="50" height="62" rx="10" fill={color} />
            <text
              x={87 + index * 57}
              y="256"
              textAnchor="middle"
              fontSize="7.5"
              fontWeight="700"
              fill={index > 2 ? PAPER : INK}
              style={mono}
            >
              {color.slice(1).toUpperCase()}
            </text>
          </g>
        ))}
      </>
    );
  },

  subscriptions: (a) => (
    <>
      <rect x="86" y="30" width="228" height="240" rx="22" fill={CARD} stroke={EDGE} />
      <text x="108" y="62" fontSize="9" fill={DIM} style={mono}>
        EVERY MONTH
      </text>
      <text x="106" y="98" fontSize="34" fontWeight="800" fill={PAPER} style={display}>
        $86.97
      </text>
      <text x="108" y="116" fontSize="10" fill={DIM} style={sans}>
        $1,043.64 a year
      </text>
      {[
        { name: 'Music', price: '$11.99', color: '#7ce0c3', soon: true },
        { name: 'Streaming', price: '$22.99', color: '#ff7e5f' },
        { name: 'Gym', price: '$39.00', color: '#ffd166' },
        { name: 'Cloud storage', price: '$2.99', color: '#8f9bff' },
      ].map((row, index) => {
        const y = 144 + index * 30;
        return (
          <g key={row.name}>
            <rect x="108" y={y - 9} width="18" height="18" rx="5" fill={row.color} />
            <text x="136" y={y + 4} fontSize="11" fill={PAPER} style={sans}>
              {row.name}
            </text>
            {row.soon && (
              <g>
                <rect x="206" y={y - 8} width="44" height="16" rx="8" fill={a} fillOpacity=".2" />
                <text
                  x="228"
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="700"
                  fill={a}
                  style={sans}
                >
                  in 3 days
                </text>
              </g>
            )}
            <text x="292" y={y + 4} textAnchor="end" fontSize="10.5" fill={DIM} style={mono}>
              {row.price}
            </text>
          </g>
        );
      })}
    </>
  ),

  receipts: (a) => (
    <>
      {[
        { rotate: -9, x: 104, vendor: 'FUEL STOP', total: '$68.90' },
        { rotate: 7, x: 206, vendor: 'SUPPLY CO', total: '$143.27' },
        { rotate: -1, x: 152, vendor: 'HARDWARE', total: '$71.42', top: true },
      ].map((paper) => (
        <g key={paper.vendor} transform={`rotate(${paper.rotate} ${paper.x + 46} 150)`}>
          <path
            d={`M${paper.x} 60h92v176l-7.7 6-7.7-6-7.7 6-7.6-6-7.7 6-7.7-6-7.6 6-7.7-6-7.7 6-7.6-6-7.7 6-7.6-6Z`}
            fill={PAPER}
            stroke="rgba(0,0,0,.25)"
          />
          <text
            x={paper.x + 46}
            y="84"
            textAnchor="middle"
            fontSize="8.5"
            fontWeight="700"
            fill={INK}
            style={mono}
          >
            {paper.vendor}
          </text>
          <Bars x={paper.x + 12} y={98} widths={[62, 50, 68, 44, 58]} gap={12} />
          {paper.top && <rect x={paper.x + 8} y="200" width="76" height="18" rx="4" fill={a} />}
          <text x={paper.x + 12} y="213" fontSize="8.5" fontWeight="700" fill={INK} style={mono}>
            TOTAL
          </text>
          <text
            x={paper.x + 80}
            y="213"
            textAnchor="end"
            fontSize="8.5"
            fontWeight="700"
            fill={INK}
            style={mono}
          >
            {paper.total}
          </text>
        </g>
      ))}
    </>
  ),

  mileage: (a) => (
    <>
      <path
        d="M40 240 C 110 236, 96 150, 176 150 S 262 206, 360 70"
        stroke={FAINT}
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M40 240 C 110 236, 96 150, 176 150 S 262 206, 360 70"
        stroke={a}
        strokeWidth="3"
        strokeDasharray="1 9"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="40" cy="240" r="9" fill={CARD} stroke={a} strokeWidth="3" />
      <path
        d="M360 70c-8-10-12-16-12-21a12 12 0 0 1 24 0c0 5-4 11-12 21Z"
        transform="translate(0 -4)"
        fill={a}
      />
      <rect x="196" y="186" width="132" height="54" rx="16" fill={CARD} stroke={EDGE} />
      <text x="214" y="212" fontSize="20" fontWeight="800" fill={PAPER} style={display}>
        18.4 mi
      </text>
      <text x="214" y="229" fontSize="9" fill={DIM} style={mono}>
        ROUND TRIP ×2
      </text>
    </>
  ),

  wishlist: (a) => (
    <>
      {[
        [70, 70],
        [330, 90],
        [96, 236],
        [318, 238],
      ].map(([x, y], index) => (
        <path
          key={index}
          d={`M${x} ${y - 8}v16M${x - 8} ${y}h16M${x - 5.6} ${y - 5.6}l11.2 11.2M${x + 5.6} ${y - 5.6}l-11.2 11.2`}
          stroke={PAPER}
          strokeOpacity=".25"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      ))}
      <g transform="rotate(6 200 150)">
        <path
          d="M128 44h112l32 30v182a10 10 0 0 1-10 10H128a10 10 0 0 1-10-10V54a10 10 0 0 1 10-10Z"
          fill={PAPER}
        />
        <circle cx="246" cy="66" r="7" fill={CARD} />
        <path
          d="M246 66c30-18 50 6 70-10"
          stroke="#f5c451"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <text x="138" y="84" fontSize="16" fontWeight="800" fill={INK} style={display}>
          Maya’s list
        </text>
        {[
          { y: 112, w: 78, price: '$48' },
          { y: 146, w: 64, price: '$25' },
          { y: 180, w: 86, price: '$120' },
          { y: 214, w: 56, price: '$18' },
        ].map((item, index) => (
          <g key={item.y}>
            <rect
              x="138"
              y={item.y - 12}
              width="18"
              height="18"
              rx="5"
              fill={index === 1 ? a : 'rgba(18,17,13,.12)'}
            />
            <rect
              x="164"
              y={item.y - 7}
              width={item.w}
              height="6"
              rx="3"
              fill="rgba(18,17,13,.3)"
            />
            <rect
              x="164"
              y={item.y + 3}
              width={item.w * 0.6}
              height="4"
              rx="2"
              fill="rgba(18,17,13,.14)"
            />
            <text
              x="262"
              y={item.y + 2}
              textAnchor="end"
              fontSize="9"
              fill={INK}
              opacity=".55"
              style={mono}
            >
              {item.price}
            </text>
          </g>
        ))}
      </g>
      <g transform="rotate(-12 236 160)">
        <rect
          x="190"
          y="142"
          width="92"
          height="30"
          rx="6"
          fill="none"
          stroke={a}
          strokeWidth="2.5"
        />
        <text
          x="236"
          y="162"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill={a}
          style={mono}
        >
          CLAIMED
        </text>
      </g>
    </>
  ),

  'secret-santa': (a) => (
    <>
      {[-14, 12].map((rotate) => (
        <g key={rotate} transform={`rotate(${rotate} 200 170)`}>
          <rect x="140" y="92" width="120" height="84" rx="8" fill={CARD} stroke={EDGE} />
          <path d="M140 100l60 40 60-40" stroke={EDGE} fill="none" />
        </g>
      ))}
      <rect x="126" y="80" width="148" height="136" rx="12" fill={PAPER} />
      <text x="200" y="118" textAnchor="middle" fontSize="10" fill={INK} opacity=".6" style={sans}>
        You’re buying for
      </text>
      <text
        x="200"
        y="176"
        textAnchor="middle"
        fontSize="54"
        fontWeight="800"
        fill={a}
        style={display}
      >
        ?
      </text>
      <rect x="164" y="192" width="72" height="8" rx="4" fill="rgba(18,17,13,.14)" />
    </>
  ),
};

/**
 * A tool's artwork on its lit stage. `className` sizes it; the art keeps its proportions and
 * sits in the middle of whatever shape it's given.
 */
export function ToolArt({
  tool,
  className,
  quiet = false,
  fill = false,
  align = 'center',
}: {
  tool: Pick<Tool, 'id' | 'accent'>;
  className?: string;
  /** A calmer stage for small placements. */
  quiet?: boolean;
  /** Fill the positioned parent (a card the words sit on) instead of taking up space. */
  fill?: boolean;
  /**
   * Where the picture sits when words share the stage: `top` leaves the bottom for a title,
   * `side` leaves the left (the bottom on phones).
   */
  align?: 'center' | 'top' | 'side';
}) {
  const accent = tool.accent;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'isolate overflow-hidden bg-[#121211]',
        fill ? 'absolute inset-0' : 'relative',
        className,
      )}
      style={{ '--accent': accent } as CSSProperties}
    >
      <div
        className="absolute inset-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          opacity: quiet ? 0.7 : 0.92,
          background: `radial-gradient(90% 80% at 78% 8%, color-mix(in oklab, ${accent} 30%, transparent), transparent 62%), radial-gradient(70% 70% at 8% 100%, color-mix(in oklab, ${accent} 16%, transparent), transparent 70%)`,
        }}
      />
      <div
        className="absolute inset-0 opacity-60 [mask-image:radial-gradient(75%_75%_at_50%_45%,black,transparent)]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255 / .035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .035) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      />
      <svg
        viewBox="0 0 400 300"
        className={cn(
          'absolute transition-transform duration-700 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.035]',
          align === 'center' && 'inset-0 h-full w-full',
          align === 'top' && 'inset-x-0 top-[2%] h-[70%] w-full',
          align === 'side' &&
            'inset-x-0 top-[2%] h-[58%] w-full sm:inset-y-0 sm:top-0 sm:right-0 sm:left-auto sm:h-full sm:w-[62%]',
        )}
      >
        {compositions[tool.id](accent)}
      </svg>
    </div>
  );
}
