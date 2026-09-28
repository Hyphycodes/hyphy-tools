import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { isReady, type Tool, type ToolId } from '@/lib/catalog';
import { QR_ROWS, ToolArt, inFinder, inLogo } from './art';
import { worlds, type World } from './worlds';

/*
 * Mini tools: every marketplace card is a small version of the tool, in the tool's own world —
 * a receipt with who had what for Split, a lit week for When?, a real code for QR Studio,
 * "4.8 MB → 380 KB" for Resize. A card explains the tool before anyone reads its name.
 *
 * Drawn in a 400×300 box on the world's canvas and centred, so one picture serves a big card, a
 * small tile and a quick action. Pure SVG, no ids and no scripts: safe anywhere, any number of
 * times. Tools that aren't open yet keep their night artwork.
 */

type Draw = (world: World, accent: string) => ReactNode;

const mono: CSSProperties = { fontFamily: 'var(--font-martian), ui-monospace, monospace' };
const sans: CSSProperties = { fontFamily: 'var(--font-mona), system-ui, sans-serif' };
const display: CSSProperties = {
  fontFamily: 'var(--font-hubot), var(--font-mona), sans-serif',
  fontVariationSettings: "'wdth' 110",
};

/** Text, abstracted: a few rounded bars. */
function Bars({
  x,
  y,
  widths,
  gap = 12,
  fill,
  h = 5,
}: {
  x: number;
  y: number;
  widths: number[];
  gap?: number;
  fill: string;
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

/** A soft shadow under an object: a blurred-looking stack of translucent shapes, no filters. */
function Shadow({
  x,
  y,
  w,
  h,
  r = 12,
  ink,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  ink: string;
}) {
  return (
    <g fill={ink}>
      <rect x={x + 2} y={y + 10} width={w - 4} height={h} rx={r} opacity=".05" />
      <rect x={x + 4} y={y + 5} width={w - 8} height={h} rx={r} opacity=".06" />
    </g>
  );
}

/** A photo, drawn: a warm sky, a sun, two hills. */
function Photo({
  x,
  y,
  w,
  h,
  r = 10,
  sky = ['#f6b77a', '#fbe3b8'],
  hills = ['#c7825a', '#5b4636'],
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  sky?: [string, string];
  hills?: [string, string];
}) {
  const clip = (inner: ReactNode) => (
    <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="hidden">
      {inner}
    </svg>
  );
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={sky[1]} />
      {clip(
        <>
          <rect width={w} height={h * 0.5} fill={sky[0]} opacity=".85" />
          <circle cx={w * 0.7} cy={h * 0.36} r={Math.min(w, h) * 0.12} fill="#fff6dc" />
          <path
            d={`M0 ${h * 0.7} Q ${w * 0.3} ${h * 0.46} ${w * 0.56} ${h * 0.66} T ${w} ${h * 0.56} V ${h} H 0 Z`}
            fill={hills[0]}
          />
          <path
            d={`M0 ${h * 0.84} Q ${w * 0.45} ${h * 0.7} ${w} ${h * 0.88} V ${h} H 0 Z`}
            fill={hills[1]}
          />
        </>,
      )}
      <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke="#000" strokeOpacity=".06" />
    </g>
  );
}

/** A person: a colored circle with an initial. */
function Person({
  cx,
  cy,
  r = 11,
  color,
  initial,
  ink,
}: {
  cx: number;
  cy: number;
  r?: number;
  color: string;
  initial: string;
  ink: string;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} />
      <text
        x={cx}
        y={cy + r * 0.36}
        textAnchor="middle"
        fontSize={r * 0.95}
        fontWeight="700"
        fill={ink}
        style={sans}
      >
        {initial}
      </text>
    </g>
  );
}

const PEOPLE = ['#b8f35a', '#8fb0ff', '#ff9fcf', '#ffc66b'];

const minis: Record<ToolId, Draw | null> = {
  split: (w, a) => (
    <>
      <g transform="rotate(-3 140 150)">
        <Shadow x={62} y={26} w={156} h={246} r={4} ink={w.ink} />
        <path
          d="M62 30h156v230l-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8-8 8-8-8Z"
          fill={w.paper}
        />
        <text
          x="140"
          y="56"
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill={w.ink}
          style={mono}
        >
          TABLE 12
        </text>
        {[
          { y: 80, bar: 58, price: '14.00', who: [0] },
          { y: 102, bar: 46, price: '22.50', who: [1] },
          { y: 124, bar: 66, price: '9.00', who: [0, 2] },
          { y: 146, bar: 40, price: '18.00', who: [2], on: true },
          { y: 168, bar: 54, price: '11.50', who: [1] },
        ].map((row) => (
          <g key={row.y}>
            {row.on && (
              <rect x="68" y={row.y - 10} width="144" height="20" rx="5" fill={a} opacity=".55" />
            )}
            {row.who.map((p, i) => (
              <circle
                key={i}
                cx={78 + i * 7}
                cy={row.y}
                r="3.4"
                fill={PEOPLE[p]}
                stroke={w.ink}
                strokeOpacity=".25"
              />
            ))}
            <rect
              x="94"
              y={row.y - 2.5}
              width={row.bar}
              height="5"
              rx="2.5"
              fill={w.ink}
              opacity=".2"
            />
            <text x="208" y={row.y + 3} textAnchor="end" fontSize="8.5" fill={w.ink} style={mono}>
              {row.price}
            </text>
          </g>
        ))}
        <path d="M74 190h134" stroke={w.ink} strokeOpacity=".3" strokeDasharray="3 3" />
        <text x="74" y="210" fontSize="8" fill={w.ink} opacity=".55" style={mono}>
          TIP 18%
        </text>
        <text x="208" y="210" textAnchor="end" fontSize="8" fill={w.ink} opacity=".55" style={mono}>
          13.50
        </text>
        <text x="74" y="236" fontSize="10.5" fontWeight="700" fill={w.ink} style={mono}>
          TOTAL
        </text>
        <text
          x="208"
          y="236"
          textAnchor="end"
          fontSize="10.5"
          fontWeight="700"
          fill={w.ink}
          style={mono}
        >
          $86.42
        </text>
      </g>
      {[
        { y: 62, name: 'Ana', total: '$24.10', p: 0 },
        { y: 124, name: 'Ben', total: '$31.82', p: 1 },
        { y: 186, name: 'Jerry', total: '$30.50', p: 2 },
      ].map((person, index) => (
        <g key={person.name} transform={`rotate(${[-2, 1.5, -1][index]} 300 ${person.y + 24})`}>
          <Shadow x={236} y={person.y} w={132} h={48} r={24} ink={w.ink} />
          <rect x="236" y={person.y} width="132" height="48" rx="24" fill={w.paper} />
          <Person
            cx={260}
            cy={person.y + 24}
            r={14}
            color={PEOPLE[person.p]}
            initial={person.name[0]}
            ink={w.ink}
          />
          <text x="282" y={person.y + 20} fontSize="10" fill={w.ink} opacity=".6" style={sans}>
            {person.name}
          </text>
          <text
            x="282"
            y={person.y + 35}
            fontSize="14"
            fontWeight="700"
            fill={w.ink}
            style={display}
          >
            {person.total}
          </text>
        </g>
      ))}
    </>
  ),

  when: (w, a) => {
    const heat = [
      [0.1, 0.25, 0.15, 0.3, 0.35, 0.5, 0.2],
      [0.2, 0.4, 0.3, 0.35, 0.55, 0.75, 0.35],
      [0.15, 0.5, 0.45, 0.5, 0.7, 1, 0.5],
      [0.08, 0.3, 0.3, 0.55, 0.6, 0.8, 0.45],
      [0.05, 0.15, 0.2, 0.3, 0.4, 0.55, 0.3],
    ];
    return (
      <>
        <Shadow x={46} y={30} w={308} h={240} r={22} ink={w.ink} />
        <rect x="46" y="30" width="308" height="240" rx="22" fill={w.paper} />
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, col) => (
          <text
            key={col}
            x={88 + col * 38}
            y="62"
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={w.ink}
            opacity={col === 5 ? 1 : 0.45}
            style={mono}
          >
            {day}
          </text>
        ))}
        {heat.map((row, r) =>
          row.map((value, col) => (
            <rect
              key={`${r}-${col}`}
              x={72 + col * 38}
              y={76 + r * 36}
              width="32"
              height="30"
              rx="8"
              fill={value > 0.9 ? w.glow : a}
              fillOpacity={0.1 + value * 0.9}
            />
          )),
        )}
        <rect
          x="260"
          y="148"
          width="32"
          height="30"
          rx="8"
          fill="none"
          stroke={w.ink}
          strokeWidth="2.5"
        />
        <g>
          <rect x="176" y="194" width="150" height="46" rx="23" fill={w.ink} />
          <text
            x="251"
            y="213"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill={w.paper}
            style={display}
          >
            SAT · 7:30 PM
          </text>
          <text
            x="251"
            y="229"
            textAnchor="middle"
            fontSize="9"
            fill={w.paper}
            opacity=".7"
            style={mono}
          >
            6/6 AVAILABLE
          </text>
        </g>
      </>
    );
  },

  qr: (w, a) => {
    const size = 6.2;
    const x0 = 122;
    const y0 = 34;
    return (
      <>
        <Shadow x={104} y={16} w={192} h={192} r={24} ink={w.ink} />
        <rect x="104" y="16" width="192" height="192" rx="24" fill={w.paper} />
        {QR_ROWS.map((row, r) =>
          row
            .split('')
            .map((bit, c) =>
              bit === '1' && !inFinder(r, c) && !inLogo(r, c) ? (
                <rect
                  key={`${r}-${c}`}
                  x={x0 + c * size + 0.5}
                  y={y0 + r * size + 0.5}
                  width={size - 1}
                  height={size - 1}
                  rx={size / 2.4}
                  fill={w.ink}
                />
              ) : null,
            ),
        )}
        {[
          [0, 0],
          [18, 0],
          [0, 18],
        ].map(([c, r]) => (
          <g key={`${c}-${r}`}>
            <rect
              x={x0 + c * size}
              y={y0 + r * size}
              width={size * 7}
              height={size * 7}
              rx="10"
              fill="none"
              stroke={w.ink}
              strokeWidth={size}
            />
            <rect
              x={x0 + (c + 2) * size}
              y={y0 + (r + 2) * size}
              width={size * 3}
              height={size * 3}
              rx="5"
              fill={a}
            />
          </g>
        ))}
        <rect
          x={x0 + 10 * size}
          y={y0 + 10 * size}
          width={size * 5}
          height={size * 5}
          rx="8"
          fill={a}
        />
        <path
          d={`M${x0 + 12.5 * size} ${y0 + 11.3 * size}v${size * 2.4}M${x0 + 11.3 * size} ${y0 + 12.5 * size}h${size * 2.4}`}
          stroke={w.ink}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {[w.ink, a, '#ff7a59', '#6a84ff', w.third].map((color, index) => (
          <circle
            key={index}
            cx={146 + index * 27}
            cy="238"
            r="10"
            fill={color}
            stroke={index === 0 ? a : 'none'}
            strokeWidth="3"
          />
        ))}
        <rect x="132" y="258" width="136" height="30" rx="15" fill={a} />
        <text
          x="200"
          y="277"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill={w.ink}
          style={sans}
        >
          Download PNG
        </text>
      </>
    );
  },

  resize: (w, a) => (
    <>
      <g transform="rotate(-2 200 120)">
        <Shadow x={70} y={28} w={260} h={170} r={14} ink={w.ink} />
        <rect x="70" y="28" width="260" height="170" rx="14" fill={w.paper} />
        <Photo x={80} y={38} w={240} h={150} r={8} />
      </g>
      <g>
        <rect x="74" y="222" width="252" height="52" rx="26" fill={w.paper} />
        <text
          x="104"
          y="253"
          fontSize="13"
          fill={w.ink}
          opacity=".45"
          style={mono}
          textDecoration="line-through"
        >
          4.8 MB
        </text>
        <path
          d="M168 248h18m-6-6 6 6-6 6"
          stroke={w.ink}
          strokeOpacity=".5"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="196" y="230" width="122" height="36" rx="18" fill={a} />
        <text
          x="257"
          y="254"
          textAnchor="middle"
          fontSize="16"
          fontWeight="800"
          fill={w.ink}
          style={display}
        >
          380 KB
        </text>
      </g>
      <g transform="rotate(8 330 36)">
        <rect x="296" y="20" width="68" height="30" rx="15" fill={w.glow} />
        <text
          x="330"
          y="40"
          textAnchor="middle"
          fontSize="11.5"
          fontWeight="800"
          fill={w.ink}
          style={sans}
        >
          −92%
        </text>
      </g>
    </>
  ),

  'social-crop': (w, a) => (
    <>
      <Photo
        x={56}
        y={34}
        w={288}
        h={232}
        r={16}
        sky={['#9f8cff', '#ffc9e4']}
        hills={['#7a6bd6', '#2f2757']}
      />
      <rect x="56" y="34" width="288" height="232" rx="16" fill={w.ink} opacity=".28" />
      {/* Story 9:16, portrait 4:5 and square 1:1, over the same photo. */}
      <rect
        x="226"
        y="44"
        width="118"
        height="212"
        rx="10"
        fill="none"
        stroke={w.third}
        strokeWidth="3"
        strokeDasharray="7 5"
      />
      <rect
        x="110"
        y="62"
        width="140"
        height="175"
        rx="10"
        fill="none"
        stroke={w.glow}
        strokeWidth="3"
      />
      <rect
        x="126"
        y="86"
        width="150"
        height="150"
        rx="10"
        fill="none"
        stroke={w.paper}
        strokeWidth="3.5"
      />
      {[
        { x: 126, y: 70, label: '1:1', fill: w.paper },
        { x: 110, y: 246, label: '4:5', fill: w.glow },
        { x: 290, y: 246, label: '9:16', fill: w.third },
      ].map((chip) => (
        <g key={chip.label}>
          <rect x={chip.x - 2} y={chip.y - 12} width="40" height="20" rx="10" fill={chip.fill} />
          <text
            x={chip.x + 18}
            y={chip.y + 2}
            textAnchor="middle"
            fontSize="10"
            fontWeight="700"
            fill={w.ink}
            style={mono}
          >
            {chip.label}
          </text>
        </g>
      ))}
      <circle cx="201" cy="161" r="16" fill={a} />
      <path d="M195 161h12M201 155v12" stroke={w.ink} strokeWidth="2.4" strokeLinecap="round" />
    </>
  ),

  palette: (w) => {
    const colors = ['#f26b3a', '#f6b77a', '#fbe3b8', '#7a6bd6', '#2f2757'];
    return (
      <>
        <Shadow x={82} y={20} w={236} h={150} r={16} ink={w.ink} />
        <Photo
          x={82}
          y={20}
          w={236}
          h={150}
          r={16}
          sky={['#f26b3a', '#fbe3b8']}
          hills={['#7a6bd6', '#2f2757']}
        />
        {colors.map((color, index) => (
          <g
            key={color}
            transform={`translate(${62 + index * 58} ${index === 1 ? 188 : 196}) rotate(${[-4, 2, -1, 3, -2][index]} 26 36)`}
          >
            <rect width="52" height="76" rx="12" fill={w.paper} />
            <rect x="5" y="5" width="42" height="44" rx="8" fill={color} />
            <text
              x="26"
              y="64"
              textAnchor="middle"
              fontSize="7.5"
              fill={w.ink}
              opacity=".6"
              style={mono}
            >
              {color.slice(1).toUpperCase()}
            </text>
          </g>
        ))}
        <g transform="translate(120 172)">
          <rect width="56" height="20" rx="10" fill={w.ink} />
          <text
            x="28"
            y="14"
            textAnchor="middle"
            fontSize="9.5"
            fontWeight="700"
            fill={w.paper}
            style={sans}
          >
            Copied ✓
          </text>
        </g>
      </>
    );
  },

  pdf: (w, a) => (
    <>
      {[
        { x: 92, r: -9 },
        { x: 146, r: -2 },
        { x: 200, r: 6 },
      ].map((page, index) => (
        <g key={index} transform={`rotate(${page.r} ${page.x + 55} 150)`}>
          <Shadow x={page.x} y={62} w={110} h={146} r={6} ink={w.ink} />
          <rect
            x={page.x}
            y="62"
            width="110"
            height="146"
            rx="6"
            fill={w.paper}
            stroke={w.ink}
            strokeOpacity=".08"
          />
          <rect
            x={page.x + 12}
            y="76"
            width="46"
            height="7"
            rx="3"
            fill={a}
            opacity={index === 2 ? 1 : 0.35}
          />
          <Bars
            x={page.x + 12}
            y={94}
            widths={[84, 76, 86, 60, 80, 70, 44]}
            fill={w.ink}
            h={4}
            gap={11}
          />
          <text
            x={page.x + 98}
            y="198"
            textAnchor="end"
            fontSize="8"
            fill={w.ink}
            opacity=".4"
            style={mono}
          >
            {index + 1}
          </text>
        </g>
      ))}
      <rect x="120" y="232" width="160" height="40" rx="20" fill={a} />
      <text
        x="200"
        y="257"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#12110d"
        style={sans}
      >
        Merge 3 PDFs
      </text>
    </>
  ),

  convert: (w, a) => (
    <>
      <path d="M150 150h100" stroke={w.glow} strokeWidth="6" strokeLinecap="round" opacity=".7" />
      <path
        d="M150 150h100m-14-14 14 14-14 14"
        stroke={a}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g transform="rotate(-5 100 150)">
        <Shadow x={48} y={78} w={104} h={138} r={14} ink={w.ink} />
        <rect x="48" y="78" width="104" height="138" rx="14" fill={w.paper} />
        <Photo x={58} y={88} w={84} h={72} r={8} />
        <text
          x="100"
          y="196"
          textAnchor="middle"
          fontSize="18"
          fontWeight="800"
          fill={w.ink}
          opacity=".4"
          style={display}
        >
          PNG
        </text>
      </g>
      <g transform="rotate(4 300 150)">
        <Shadow x={248} y={72} w={112} h={148} r={14} ink={w.ink} />
        <rect x="248" y="72" width="112" height="148" rx="14" fill={a} />
        <rect x="258" y="82" width="92" height="78" rx="9" fill={w.paper} opacity=".95" />
        <Photo x={262} y={86} w={84} h={70} r={7} />
        <text
          x="304"
          y="196"
          textAnchor="middle"
          fontSize="19"
          fontWeight="800"
          fill={w.paper}
          style={display}
        >
          WEBP
        </text>
      </g>
      <rect x="160" y="244" width="80" height="26" rx="13" fill={w.paper} />
      <text
        x="200"
        y="261"
        textAnchor="middle"
        fontSize="10.5"
        fontWeight="700"
        fill={w.accentInk}
        style={mono}
      >
        −64%
      </text>
    </>
  ),

  clean: (w, a) => (
    <>
      <Shadow x={40} y={40} w={320} h={220} r={22} ink={w.ink} />
      <rect x="40" y="40" width="320" height="220" rx="22" fill={w.paper} />
      {[
        { from: 'IMG_4032 (1) copy.JPG', to: 'beach-day-01.jpg' },
        { from: 'Scan 12 FINAL final.pdf', to: 'lease-2026.pdf' },
        { from: 'Screen Shot 2026-03…png', to: 'invoice-march.png' },
      ].map((row, index) => {
        const y = 72 + index * 64;
        return (
          <g key={row.to}>
            {index > 0 && <path d={`M60 ${y - 14}h280`} stroke={w.ink} strokeOpacity=".08" />}
            <text
              x="62"
              y={y + 6}
              fontSize="10.5"
              fill={w.ink}
              opacity=".38"
              style={mono}
              textDecoration="line-through"
            >
              {row.from}
            </text>
            <rect
              x="58"
              y={y + 14}
              width={row.to.length * 7.4 + 34}
              height="24"
              rx="8"
              fill={a}
              opacity=".55"
            />
            <circle cx="72" cy={y + 26} r="6" fill={w.accentInk} />
            <path
              d={`M69 ${y + 26}l2 2 4-4`}
              stroke={w.paper}
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
            />
            <text x="84" y={y + 30} fontSize="11.5" fontWeight="600" fill={w.ink} style={mono}>
              {row.to}
            </text>
          </g>
        );
      })}
    </>
  ),

  duplicates: (w, a) => (
    <>
      {[
        { x: 58, r: -4, copy: false },
        { x: 222, r: 4, copy: true },
      ].map((file) => (
        <g key={file.x} transform={`rotate(${file.r} ${file.x + 60} 140)`}>
          <Shadow x={file.x} y={54} w={120} h={160} r={16} ink={w.ink} />
          <rect
            x={file.x}
            y="54"
            width="120"
            height="160"
            rx="16"
            fill={w.paper}
            stroke={file.copy ? a : 'none'}
            strokeWidth="3"
            strokeDasharray={file.copy ? '8 6' : undefined}
          />
          <Photo
            x={file.x + 10}
            y={64}
            w={100}
            h={84}
            r={9}
            sky={['#ffb36b', '#ffe0b3']}
            hills={['#e0864a', '#6b3f22']}
          />
          <Bars x={file.x + 12} y={162} widths={[78, 50]} fill={w.ink} h={5} />
          {file.copy && (
            <g>
              <rect x={file.x + 56} y="188" width="54" height="20" rx="10" fill={a} />
              <text
                x={file.x + 83}
                y="202"
                textAnchor="middle"
                fontSize="9.5"
                fontWeight="700"
                fill={w.ink}
                style={sans}
              >
                copy
              </text>
            </g>
          )}
        </g>
      ))}
      <circle cx="200" cy="136" r="20" fill={a} />
      <path d="M191 131h18M191 141h18" stroke={w.ink} strokeWidth="3" strokeLinecap="round" />
      <rect x="112" y="240" width="176" height="34" rx="17" fill={w.ink} />
      <text
        x="200"
        y="262"
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="700"
        fill={w.paper}
        style={sans}
      >
        14 copies · 312 MB
      </text>
    </>
  ),

  bring: (w, a) => (
    <>
      <Shadow x={80} y={24} w={240} h={252} r={22} ink={w.ink} />
      <rect x="80" y="24" width="240" height="252" rx="22" fill={w.paper} />
      <text x="104" y="58" fontSize="16" fontWeight="700" fill={w.ink} style={display}>
        Saturday picnic
      </text>
      <text x="104" y="75" fontSize="8.5" fill={w.accentInk} style={mono}>
        4 OF 5 COVERED
      </text>
      {[
        { item: 'Sandwiches', who: 'D', c: w.glow },
        { item: 'Lemonade', who: 'M', c: '#ff9fcf' },
        { item: 'Blanket', who: '', c: '' },
        { item: 'Fruit', who: 'J', c: w.third },
        { item: 'Speaker', who: 'R', c: a },
      ].map((row, index) => {
        const y = 106 + index * 34;
        const open = !row.who;
        return (
          <g key={row.item}>
            {index > 0 && <path d={`M104 ${y - 17}h192`} stroke={w.ink} strokeOpacity=".07" />}
            <circle
              cx="112"
              cy={y}
              r="8"
              fill={open ? 'none' : a}
              stroke={open ? w.ink : 'none'}
              strokeOpacity=".3"
              strokeDasharray={open ? '2 2' : undefined}
            />
            {!open && (
              <path
                d={`M108.5 ${y}l2.4 2.4 4.6-4.8`}
                stroke={w.ink}
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
            )}
            <text
              x="130"
              y={y + 4}
              fontSize="12"
              fill={w.ink}
              opacity={open ? 1 : 0.6}
              style={sans}
            >
              {row.item}
            </text>
            {open ? (
              <g>
                <rect x="244" y={y - 11} width="50" height="22" rx="11" fill={a} />
                <text
                  x="269"
                  y={y + 4}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="700"
                  fill={w.ink}
                  style={sans}
                >
                  I’ll bring
                </text>
              </g>
            ) : (
              <Person cx={284} cy={y} r={11} color={row.c} initial={row.who} ink={w.ink} />
            )}
          </g>
        );
      })}
    </>
  ),

  wishlist: (w, a) => (
    <>
      <g transform="rotate(-4 200 150)">
        <Shadow x={96} y={26} w={208} h={250} r={18} ink={w.ink} />
        <path
          d="M130 26h140l34 34v198a18 18 0 0 1-18 18H114a18 18 0 0 1-18-18V60Z"
          fill={w.paper}
        />
        <circle cx="200" cy="52" r="7" fill={w.canvas} stroke={w.glow} strokeWidth="2" />
        <path d="M200 45c-10-26 30-30 40-12" stroke={w.glow} strokeWidth="2" fill="none" />
        <text
          x="200"
          y="88"
          textAnchor="middle"
          fontSize="16"
          fontWeight="700"
          fill={w.third}
          style={display}
        >
          Maya’s list
        </text>
        {[
          { item: 'Wool scarf', price: '$40' },
          { item: 'Film camera', price: '$120', claimed: true },
          { item: 'Cookbook', price: '$25' },
          { item: 'Plant stand', price: '$60' },
        ].map((row, index) => {
          const y = 118 + index * 34;
          return (
            <g key={row.item}>
              <path d={`M118 ${y + 14}h164`} stroke={w.ink} strokeOpacity=".08" />
              <text
                x="120"
                y={y + 4}
                fontSize="12"
                fill={w.ink}
                opacity={row.claimed ? 0.4 : 1}
                style={sans}
              >
                {row.item}
              </text>
              <text
                x="280"
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill={w.ink}
                opacity=".55"
                style={mono}
              >
                {row.price}
              </text>
            </g>
          );
        })}
      </g>
      <g transform="rotate(-12 262 156)">
        <rect
          x="214"
          y="140"
          width="96"
          height="30"
          rx="6"
          fill="none"
          stroke={w.accentInk}
          strokeWidth="2.5"
        />
        <text
          x="262"
          y="160"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill={w.accentInk}
          style={mono}
        >
          CLAIMED
        </text>
      </g>
      <circle cx="310" cy="236" r="18" fill={a} opacity=".85" />
      <path d="M302 236h16M310 228v16" stroke={w.paper} strokeWidth="3" strokeLinecap="round" />
    </>
  ),

  subscriptions: (w, a) => {
    const c = 2 * Math.PI * 54;
    return (
      <>
        <Shadow x={40} y={36} w={320} h={228} r={24} ink={w.ink} />
        <rect x="40" y="36" width="320" height="228" rx="24" fill={w.paper} />
        <circle
          cx="122"
          cy="150"
          r="54"
          fill="none"
          stroke={w.ink}
          strokeOpacity=".07"
          strokeWidth="16"
        />
        {[
          { len: 0.42, color: a, off: 0 },
          { len: 0.26, color: w.glow, off: 0.42 },
          { len: 0.16, color: '#ff9fcf', off: 0.68 },
        ].map((arc) => (
          <circle
            key={arc.off}
            cx="122"
            cy="150"
            r="54"
            fill="none"
            stroke={arc.color}
            strokeWidth="16"
            strokeDasharray={`${arc.len * c - 3} ${c}`}
            strokeDashoffset={-arc.off * c}
            transform="rotate(-90 122 150)"
          />
        ))}
        <text
          x="122"
          y="150"
          textAnchor="middle"
          fontSize="17"
          fontWeight="800"
          fill={w.ink}
          style={display}
        >
          $1,284
        </text>
        <text
          x="122"
          y="166"
          textAnchor="middle"
          fontSize="8.5"
          fill={w.ink}
          opacity=".55"
          style={mono}
        >
          A YEAR
        </text>
        {[
          { name: 'Streaming', price: '$15.49', color: a },
          { name: 'Music', price: '$10.99', color: w.glow },
          { name: 'Cloud', price: '$2.99', color: '#ff9fcf' },
          { name: 'Gym', price: '$39.00', color: w.third },
        ].map((row, index) => {
          const y = 88 + index * 34;
          return (
            <g key={row.name}>
              <rect x="200" y={y - 11} width="22" height="22" rx="7" fill={row.color} />
              <text x="232" y={y + 4} fontSize="11.5" fill={w.ink} style={sans}>
                {row.name}
              </text>
              <text
                x="336"
                y={y + 4}
                textAnchor="end"
                fontSize="10.5"
                fontWeight="600"
                fill={w.ink}
                style={mono}
              >
                {row.price}
              </text>
            </g>
          );
        })}
      </>
    );
  },

  'signal-pages': (w, a) => (
    <>
      <rect
        x="138"
        y="14"
        width="124"
        height="272"
        rx="26"
        fill={w.paper}
        stroke={w.ink}
        strokeOpacity=".14"
      />
      <circle cx="200" cy="66" r="22" fill={a} />
      <rect x="166" y="98" width="68" height="8" rx="4" fill={w.ink} opacity=".85" />
      <rect x="176" y="112" width="48" height="5" rx="2.5" fill={w.ink} opacity=".35" />
      {[0, 1, 2, 3].map((index) => (
        <rect
          key={index}
          x="152"
          y={134 + index * 32}
          width="96"
          height="24"
          rx="12"
          fill={index === 0 ? a : w.ink}
          fillOpacity={index === 0 ? 1 : 0.1}
        />
      ))}
      <g transform="rotate(8 312 90)">
        <rect x="276" y="74" width="74" height="30" rx="15" fill={w.glow} />
        <text
          x="313"
          y="94"
          textAnchor="middle"
          fontSize="11"
          fontWeight="700"
          fill="#12110d"
          style={sans}
        >
          Share
        </text>
      </g>
    </>
  ),

  'signal-links': (w, a) => (
    <>
      <Shadow x={36} y={96} w={328} h={64} r={32} ink={w.ink} />
      <rect x="36" y="96" width="328" height="64" rx="32" fill={w.paper} />
      <text x="64" y="133" fontSize="14" fontWeight="600" fill={w.ink} style={mono}>
        hyphy.co/menu
      </text>
      <rect x="182" y="113" width="164" height="30" rx="15" fill={a} />
      <text
        x="264"
        y="133"
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill={w.ink}
        style={mono}
      >
        ?from=instagram
      </text>
      {[{ label: 'Instagram', on: true }, { label: 'Email' }, { label: 'Flyer' }].map(
        (chip, index) => (
          <g key={chip.label}>
            <rect
              x={70 + index * 92}
              y="190"
              width="84"
              height="34"
              rx="17"
              fill={chip.on ? w.ink : w.paper}
              stroke={w.ink}
              strokeOpacity={chip.on ? 0 : 0.1}
            />
            <text
              x={112 + index * 92}
              y="211"
              textAnchor="middle"
              fontSize="11.5"
              fontWeight="600"
              fill={chip.on ? w.paper : w.ink}
              style={sans}
            >
              {chip.label}
            </text>
          </g>
        ),
      )}
      <text x="200" y="72" textAnchor="middle" fontSize="11" fill={w.accentInk} style={mono}>
        WHERE WILL IT GO?
      </text>
    </>
  ),

  where: (w, a) => {
    const cards = [
      { x: 44, name: 'Monteverde', votes: 8, colors: ['#ff6b5b', '#c2352b'], lead: true, tilt: -4 },
      { x: 150, name: 'Aba', votes: 5, colors: ['#9b7bff', '#5b3fc4'], tilt: 2 },
      { x: 256, name: 'Tacos', votes: 2, colors: ['#ffb35c', '#c46a14'], tilt: 5 },
    ];
    return (
      <>
        <rect x="24" y="18" width="352" height="74" rx="20" fill="#2f1636" />
        <circle cx="344" cy="40" r="10" fill="#ffd9b8" />
        {[40, 70, 96, 130, 170, 214, 250, 290, 320].map((x, index) => (
          <rect
            key={x}
            x={x}
            y={92 - [22, 34, 18, 40, 26, 36, 20, 30, 24][index]}
            width={index % 2 ? 22 : 28}
            height={[22, 34, 18, 40, 26, 36, 20, 30, 24][index]}
            fill="#1c0d24"
          />
        ))}
        <text x="44" y="50" fontSize="17" fontWeight="800" fill="#fff4ea" style={display}>
          Where should we eat?
        </text>
        {cards.map((card) => (
          <g key={card.name} transform={`rotate(${card.tilt} ${card.x + 50} 190)`}>
            <Shadow x={card.x} y={112} w={100} h={150} r={14} ink={w.ink} />
            <rect x={card.x} y={112} width="100" height="150" rx="14" fill={w.paper} />
            <path
              d={`M${card.x} ${126}a14 14 0 0 1 14-14h72a14 14 0 0 1 14 14v52H${card.x}Z`}
              fill={card.colors[0]}
            />
            <path
              d={`M${card.x + 50} 170s14-12.6 14-22.4a14 14 0 0 0-28 0c0 9.8 14 22.4 14 22.4Z`}
              fill="#fffaf5"
            />
            <circle cx={card.x + 50} cy={147} r="5" fill={card.colors[1]} />
            <text
              x={card.x + 10}
              y={200}
              fontSize="12.5"
              fontWeight="700"
              fill={w.ink}
              style={display}
            >
              {card.name}
            </text>
            <text x={card.x + 10} y={220} fontSize="10" fill={w.ink} opacity=".7" style={sans}>
              ♥ {card.votes}
            </text>
            <rect
              x={card.x + 8}
              y={232}
              width="84"
              height="18"
              rx="9"
              fill={card.lead ? a : w.ink}
              opacity={card.lead ? 1 : 0.08}
            />
            {card.lead && (
              <text
                x={card.x + 50}
                y={244.5}
                textAnchor="middle"
                fontSize="9"
                fontWeight="800"
                fill={w.ink}
                style={sans}
              >
                LEADING
              </text>
            )}
          </g>
        ))}
      </>
    );
  },
  plan: (w, a) => (
    <>
      <g transform="rotate(-2.5 200 150)">
        <Shadow x={78} y={22} w={244} h={256} r={24} ink={w.ink} />
        <rect x="78" y="22" width="244" height="256" rx="24" fill={w.paper} />
        <path d="M78 46a24 24 0 0 1 24-24h196a24 24 0 0 1 24 24v44H78Z" fill={a} />
        <circle cx="296" cy="90" r="30" fill={w.glow} opacity=".9" />
        <path d="M78 76h244v14H78Z" fill={a} />
        <ellipse cx="128" cy="52" rx="20" ry="7" fill="#ffffff" opacity=".6" />
        <ellipse cx="220" cy="40" rx="26" ry="8" fill="#ffffff" opacity=".45" />
        <rect x="96" y="38" width="36" height="36" rx="11" fill="#ffffff" />
        <path
          d="M106 62l6-16 12 12Zm6-16 1-4m8 6 4-1m-12-6 1 3"
          stroke={a}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
        <text
          x="100"
          y="124"
          fontSize="9"
          fontWeight="800"
          fill={w.accentInk}
          style={sans}
          letterSpacing="1.4"
        >
          BIRTHDAY
        </text>
        <text x="100" y="152" fontSize="23" fontWeight="800" fill={w.ink} style={display}>
          Kamila’s Birthday
        </text>
        {[
          { y: 178, label: 'Saturday, October 17 · 7:30 PM' },
          { y: 204, label: 'Monteverde' },
        ].map((row) => (
          <g key={row.y}>
            <rect x="100" y={row.y - 12} width="20" height="20" rx="6" fill={a} opacity=".18" />
            <text x="128" y={row.y + 3} fontSize="11" fontWeight="600" fill={w.ink} style={sans}>
              {row.label}
            </text>
          </g>
        ))}
        {['#8ee0a0', '#8ecff5', '#f5d77a', '#ffb38a', '#c9b6ff'].map((color, index) => (
          <circle
            key={color}
            cx={112 + index * 16}
            cy={243}
            r="11"
            fill={color}
            stroke={w.paper}
            strokeWidth="2.5"
          />
        ))}
        <text x="200" y="247" fontSize="11" fill={w.ink} opacity=".7" style={sans}>
          8 people · 5 in
        </text>
      </g>
      <g transform="rotate(4 330 250)">
        <rect x="286" y="226" width="92" height="36" rx="18" fill={w.glow} />
        <text
          x="332"
          y="249"
          textAnchor="middle"
          fontSize="12"
          fontWeight="800"
          fill={w.ink}
          style={sans}
        >
          I’m in ✓
        </text>
      </g>
    </>
  ),
  'secret-santa': (w, a) => {
    const envelope = (x: number, y: number, tilt: number, name: string, front = false) => (
      <g key={name} transform={`rotate(${tilt} ${x + 60} ${y + 40})`}>
        <rect x={x + 3} y={y + 8} width="120" height="80" rx="8" fill="#000" opacity=".22" />
        <rect x={x} y={y} width="120" height="80" rx="8" fill="#efe2c4" />
        <path
          d={`M${x} ${y + 18} L${x + 60} ${y + 50} L${x + 120} ${y + 18} V${y + 80} H${x} Z`}
          fill="#fbf3e2"
        />
        <path
          d={`M${x} ${y + 4} Q${x} ${y} ${x + 6} ${y} H${x + 114} Q${x + 120} ${y} ${x + 120} ${y + 4} L${x + 60} ${y + 46} Z`}
          fill="#f5ead0"
        />
        <circle cx={x + 60} cy={y + 44} r="11" fill={a} />
        <path
          d={`M${x + 60} ${y + 37.5}l2 4.4 4.7.5-3.5 3.2 1 4.7-4.2-2.4-4.2 2.4 1-4.7-3.5-3.2 4.7-.5Z`}
          fill={w.glow}
        />
        <text
          x={x + 60}
          y={y + 70}
          textAnchor="middle"
          fontSize={front ? 11 : 9.5}
          fontWeight="700"
          fill="#3a2a1a"
          style={display}
        >
          For {name}
        </text>
      </g>
    );
    return (
      <>
        <rect x="20" y="20" width="360" height="260" rx="26" fill={w.third} />
        <rect x="20" y="20" width="360" height="260" rx="26" fill="#000" opacity=".15" />
        {envelope(48, 58, -10, 'Jerry')}
        {envelope(232, 52, 8, 'Emauri')}
        {envelope(62, 170, 6, 'Sophia')}
        <g>
          <rect x="150" y="96" width="112" height="86" rx="6" fill="#fffdf6" />
          <text
            x="206"
            y="124"
            textAnchor="middle"
            fontSize="7.5"
            fontWeight="700"
            fill="#8a6d2e"
            style={sans}
            letterSpacing="1.2"
          >
            YOU’RE GIVING TO
          </text>
          <text
            x="206"
            y="150"
            textAnchor="middle"
            fontSize="20"
            fontWeight="800"
            fill={w.ink}
            style={display}
          >
            Kamila
          </text>
        </g>
        {envelope(146, 150, -2, 'Kamila', true)}
      </>
    );
  },
  receipts: (w, a) => (
    <>
      <g transform="rotate(-5 120 150)">
        <Shadow x={52} y={34} w={128} h={214} r={4} ink={w.ink} />
        <path
          d="M52 38h128v200l-8 7-8-7-8 7-8-7-8 7-8-7-8 7-8-7-8 7-8-7-8 7-8-7-8 7-8-7-8 7-8-7Z"
          fill={w.paper}
        />
        <rect x="80" y="56" width="72" height="8" rx="4" fill={w.ink} opacity=".75" />
        <Bars x={68} y={82} widths={[52, 40, 60, 34, 46]} gap={16} fill={w.ink} h={5} />
        {[82, 98, 114, 130, 146].map((y) => (
          <rect key={y} x="142" y={y} width="24" height="5" rx="2.5" fill={w.ink} opacity=".25" />
        ))}
        <path d="M66 172h100" stroke={w.ink} strokeOpacity=".3" strokeDasharray="3 3" />
        <text x="68" y="196" fontSize="10" fontWeight="700" fill={w.ink} style={mono}>
          TOTAL
        </text>
        <text
          x="166"
          y="196"
          textAnchor="end"
          fontSize="10"
          fontWeight="700"
          fill={w.ink}
          style={mono}
        >
          48.72
        </text>
        <rect x="46" y="132" width="140" height="4" rx="2" fill={a} />
        <rect x="46" y="108" width="140" height="28" fill={a} opacity=".16" />
      </g>
      <path
        d="M196 150h34"
        stroke={w.ink}
        strokeOpacity=".35"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M224 142l9 8-9 8"
        fill="none"
        stroke={w.ink}
        strokeOpacity=".35"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g>
        <Shadow x={244} y={92} w={130} h={116} r={18} ink={w.ink} />
        <rect x="244" y="92" width="130" height="116" rx="18" fill={w.paper} />
        <rect x="258" y="106" width="30" height="30" rx="9" fill="#d98b3a" />
        <path
          d="M266 128l10-10m-2-4 6 6-3 3-6-6Z"
          stroke="#fff"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <text x="296" y="118" fontSize="11" fontWeight="700" fill={w.ink} style={sans}>
          Home Depot
        </text>
        <text x="296" y="132" fontSize="9" fill={w.ink} opacity=".6" style={sans}>
          Materials · Sep 28
        </text>
        <text x="258" y="176" fontSize="26" fontWeight="800" fill={w.ink} style={display}>
          $48.72
        </text>
        <rect x="258" y="186" width="58" height="12" rx="6" fill={a} />
        <text
          x="287"
          y="195"
          textAnchor="middle"
          fontSize="7.5"
          fontWeight="800"
          fill="#fff"
          style={sans}
        >
          FILED
        </text>
      </g>
    </>
  ),
  mileage: null,
};

/**
 * A tool, small: its world's room with a miniature of the tool in it. `className` sizes it; the
 * picture keeps its proportions in the middle. Tools not open yet show their night artwork.
 */
export function ToolMini({
  tool,
  className,
  fill = false,
}: {
  tool: Pick<Tool, 'id' | 'accent' | 'status'>;
  className?: string;
  /** Fill the positioned parent instead of taking up space. */
  fill?: boolean;
}) {
  const draw = minis[tool.id];
  if (!draw || !isReady(tool as Tool))
    return <ToolArt tool={tool} className={className} fill={fill} />;
  const world = worlds[tool.id];
  return (
    <div
      aria-hidden="true"
      className={cn('isolate overflow-hidden', fill ? 'absolute inset-0' : 'relative', className)}
      style={{
        background: `radial-gradient(80% 70% at 85% 0%, color-mix(in srgb, ${tool.accent} 38%, transparent), transparent 70%), radial-gradient(60% 60% at 0% 100%, color-mix(in srgb, ${world.glow} 22%, transparent), transparent 70%), ${world.canvas}`,
      }}
    >
      <svg
        viewBox="0 0 400 300"
        className="absolute inset-0 h-full w-full transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.04]"
      >
        {draw(world, tool.accent)}
      </svg>
    </div>
  );
}
