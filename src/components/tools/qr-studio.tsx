'use client';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { download, slugName } from '@/lib/files/download';
import { qrMatrix, type QrLevel } from '@/lib/tools/qr';
import {
  describeContent,
  emptyContact,
  isWebLink,
  normalizeLink,
  payloadFor,
  type Contact,
  type QrContent,
  type QrKind,
} from '@/lib/tools/qr-payloads';
import {
  captionBand,
  drawShapes,
  LOGO_MAX,
  LOGO_MIN,
  qrShapes,
  scanRisks,
  shapesToSvg,
  type CornerStyle,
  type DotStyle,
  type QrLogo,
  type QrLook,
  type Shape,
} from '@/lib/tools/qr-style';
import {
  ActionBar,
  ActionButton,
  ChoiceCards,
  Choices,
  MoreOptions,
  Note,
  SampleButton,
  StartPanel,
  Surface,
} from './kit';

/*
 * QR Studio: codes for links, Wi-Fi, contacts, calls, texts and email — styled, and still
 * scannable. Built on the same encoder as Hyphy's original QR tool (UTF-8, error correction,
 * contrast checks); new here are the kinds, the looks, logos, and guardrails that keep a styled
 * code readable. Everything is drawn on the device; nothing is uploaded or tracked.
 *
 * It walks one path: pick what the code opens, fill in just that, pick a look, download. On a
 * phone the code draws right under what you type, and the download stays under your thumb.
 */

const ACCENT = 'var(--accent, var(--color-ink))';

type Kind = {
  value: QrKind;
  label: string;
  icon: IconName;
  hint: string;
  title: string;
  lead: string;
};

const KINDS: Kind[] = [
  {
    value: 'link',
    label: 'Link',
    icon: 'link',
    hint: 'A site, menu or booking page',
    title: 'Which link?',
    lead: 'Paste it or type it. We’ll add the https:// for you.',
  },
  {
    value: 'wifi',
    label: 'Wi-Fi',
    icon: 'wifi',
    hint: 'Guests join without typing',
    title: 'Which network?',
    lead: 'Guests point their camera and they’re on. Anyone who can see it can join.',
  },
  {
    value: 'contact',
    label: 'Contact',
    icon: 'contact',
    hint: 'Saves your details',
    title: 'Whose contact?',
    lead: 'Scanning offers to save it. Fill in only what people need.',
  },
  {
    value: 'phone',
    label: 'Call',
    icon: 'phone',
    hint: 'Rings your number',
    title: 'Which number?',
    lead: 'Include the country code for people abroad.',
  },
  {
    value: 'sms',
    label: 'Text message',
    icon: 'sms',
    hint: 'Opens a text to you',
    title: 'Who should they text?',
    lead: 'Their messages app opens, addressed to you.',
  },
  {
    value: 'email',
    label: 'Email',
    icon: 'mail',
    hint: 'Starts an email to you',
    title: 'Where should emails go?',
    lead: 'Their mail app opens with your address filled in.',
  },
  {
    value: 'text',
    label: 'Plain text',
    icon: 'file-text',
    hint: 'Shows a short note',
    title: 'What should it say?',
    lead: 'Shown as plain text when scanned.',
  },
];
const PICKABLE = KINDS.filter((kind) => kind.value !== 'text');

type LookPreset = { name: string } & Omit<QrLook, 'margin'>;

// Curated looks: each one passes the contrast checks, so any of them prints safely.
const LOOKS: LookPreset[] = [
  { name: 'Classic', fg: '#12110d', bg: '#ffffff', corners: '', dot: 'square', corner: 'square' },
  {
    name: 'Aqua',
    fg: '#083f3b',
    bg: '#e9fbf8',
    corners: '#0b8a80',
    dot: 'rounded',
    corner: 'rounded',
  },
  {
    name: 'Midnight',
    fg: '#101a3f',
    bg: '#eef2ff',
    corners: '#2f55d4',
    dot: 'dots',
    corner: 'circle',
  },
  {
    name: 'Candy',
    fg: '#5a1043',
    bg: '#fff0f7',
    corners: '#d8327f',
    dot: 'dots',
    corner: 'rounded',
  },
  {
    name: 'Forest',
    fg: '#0f3d2e',
    bg: '#f1f8ec',
    corners: '#2f7d4f',
    dot: 'bars',
    corner: 'rounded',
  },
  {
    name: 'Sunset',
    fg: '#3a1508',
    bg: '#fff4e6',
    corners: '#c2410c',
    dot: 'rounded',
    corner: 'circle',
  },
];

const DOTS: { value: DotStyle; label: string }[] = [
  { value: 'square', label: 'Classic' },
  { value: 'rounded', label: 'Soft' },
  { value: 'dots', label: 'Dots' },
  { value: 'bars', label: 'Bars' },
];
const CORNERS: { value: CornerStyle; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'circle', label: 'Round' },
];
const LEVELS: { value: QrLevel; label: string }[] = [
  { value: 'L', label: 'Light' },
  { value: 'M', label: 'Standard' },
  { value: 'Q', label: 'Sturdy' },
  { value: 'H', label: 'Sturdiest' },
];
const SIZES: { value: string; label: string; hint: string }[] = [
  { value: '512', label: 'Small', hint: '512' },
  { value: '1024', label: 'Medium', hint: '1024' },
  { value: '2048', label: 'Large', hint: '2048' },
];
const CAPTIONS: Partial<Record<QrKind, string[]>> = {
  link: ['Scan for the menu', 'Scan to book', 'Scan me'],
  wifi: ['Scan to join our Wi-Fi', 'Guest Wi-Fi'],
  contact: ['Scan to save my number', 'Save my contact'],
  phone: ['Scan to call us'],
  sms: ['Scan to text us'],
  email: ['Scan to email us'],
};

// What the empty stage shows: a real code, faded, in the current look.
const GHOST = 'https://hyphy.example/your-code-will-look-like-this';
const THUMB = 'hyphy.example';

type Wifi = { ssid: string; password: string; security: 'WPA' | 'WEP' | 'nopass'; hidden: boolean };
type Code = { state: 'empty' } | { state: 'too-long' } | { state: 'ready'; matrix: boolean[][] };

/** Draws a logo file onto a square PNG, at most 512 px: raster only, so an SVG can't carry anything else. */
async function logoFrom(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error('That logo is over 5 MB. Try a smaller file.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const side = Math.min(512, Math.max(image.naturalWidth, image.naturalHeight) || 512);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser can’t read that logo.');
    const ratio = Math.min(side / image.naturalWidth, side / image.naturalHeight);
    const width = image.naturalWidth * ratio;
    const height = image.naturalHeight * ratio;
    context.drawImage(image, (side - width) / 2, (side - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } catch (error) {
    throw error instanceof Error && error.message.includes('logo')
      ? error
      : new Error('That file couldn’t be read as an image. Try a PNG, JPG or SVG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  return image.decode().then(() => image);
}

/** What scanning does, in a few words, under the code. */
function opensLine(content: QrContent) {
  switch (content.kind) {
    case 'link':
      return `Opens ${describeContent(content)}`;
    case 'wifi':
      return `Joins “${content.ssid.trim()}”${content.security === 'nopass' ? ' · no password' : ''}`;
    case 'contact': {
      const { first, last, org } = content.contact;
      return `Saves ${[first, last].join(' ').trim() || org.trim() || 'your contact'}`;
    }
    case 'phone':
      return `Calls ${content.number.trim()}`;
    case 'sms':
      return `Starts a text to ${content.number.trim()}`;
    case 'email':
      return `Starts an email to ${content.to.trim()}`;
    case 'text':
      return 'Shows your text';
  }
}

/** The code as React elements, from the same shapes the downloads use. */
function QrShapes({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((shape, index) => {
        switch (shape.type) {
          case 'rect':
            return (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                rx={shape.r}
                fill={shape.fill}
              />
            );
          case 'circle':
            return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />;
          case 'ring':
            return (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.size}
                height={shape.size}
                rx={shape.r}
                fill="none"
                stroke={shape.stroke}
                strokeWidth={shape.width}
              />
            );
          case 'image':
            return (
              <image
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.size}
                height={shape.size}
                href={shape.href}
                preserveAspectRatio="xMidYMid meet"
              />
            );
        }
      })}
    </>
  );
}

/** Motion for the stage: a scan line and a slow float. Transform and opacity only. */
function StageMotion() {
  return (
    <style>{`
      @keyframes qr-sweep { from { transform: translateY(-100%); } to { transform: translateY(400%); } }
      @keyframes qr-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
      .qr-sweep { animation: qr-sweep 2.8s cubic-bezier(.45,0,.55,1) infinite alternate; }
      .qr-float { animation: qr-float 4.5s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .qr-sweep { animation: none; opacity: 0; }
        .qr-float { animation: none; }
      }
    `}</style>
  );
}

/** Viewfinder corners around the code, in the tool's color. */
function Viewfinder({ inset = '-10px' }: { inset?: string }) {
  const corner = 'absolute size-6 border-[2.5px] sm:size-7';
  const style = { borderColor: ACCENT };
  return (
    <span aria-hidden="true" className="pointer-events-none absolute" style={{ inset }}>
      <span
        className={cn(corner, 'top-0 left-0 rounded-tl-[12px] border-r-0 border-b-0')}
        style={style}
      />
      <span
        className={cn(corner, 'top-0 right-0 rounded-tr-[12px] border-b-0 border-l-0')}
        style={style}
      />
      <span
        className={cn(corner, 'bottom-0 left-0 rounded-bl-[12px] border-t-0 border-r-0')}
        style={style}
      />
      <span
        className={cn(corner, 'right-0 bottom-0 rounded-br-[12px] border-t-0 border-l-0')}
        style={style}
      />
    </span>
  );
}

/** The first screen's picture: a code in the tool's color, being read, with what it can open around it. */
function KindArt() {
  const shapes = useMemo(
    () =>
      qrShapes(
        qrMatrix(THUMB, 'L'),
        { dot: 'rounded', corner: 'rounded', fg: 'currentColor', bg: '', corners: '', margin: 0 },
        null,
      ),
    [],
  );
  const bubbles: { icon: IconName; className: string; delay: string }[] = [
    { icon: 'link', className: '-left-14 top-1', delay: '0s' },
    { icon: 'wifi', className: '-right-14 top-5', delay: '-1.2s' },
    { icon: 'contact', className: '-left-11 bottom-2', delay: '-2.4s' },
    { icon: 'mail', className: '-right-11 bottom-0', delay: '-3.3s' },
  ];
  return (
    <div aria-hidden="true" className="relative mx-auto size-[124px] sm:size-[140px]">
      <Viewfinder inset="0" />
      <div
        className="absolute inset-3.5 overflow-hidden rounded-[12px] p-1.5"
        style={{ color: ACCENT, background: `color-mix(in srgb, ${ACCENT} 8%, transparent)` }}
      >
        <svg viewBox={`0 0 ${shapes.total} ${shapes.total}`} className="block size-full">
          <QrShapes shapes={shapes.shapes} />
        </svg>
        <span
          className="qr-sweep absolute inset-x-0 top-0 h-1/4"
          style={{
            background: `linear-gradient(to bottom, transparent, color-mix(in srgb, var(--glow, ${ACCENT}) 45%, transparent), transparent)`,
          }}
        />
      </div>
      {bubbles.map((bubble) => (
        <span
          key={bubble.icon}
          className={cn(
            'qr-float absolute grid size-9 place-items-center rounded-full bg-surface shadow-card',
            bubble.className,
          )}
          style={{ color: ACCENT, animationDelay: bubble.delay }}
        >
          <Icon name={bubble.icon} size={16} />
        </span>
      ))}
    </div>
  );
}

/** A tiny rendering of each dot and corner style, drawn by the real renderer. */
const SAMPLE = [
  [true, true, false, true],
  [false, true, true, true],
  [true, true, false, false],
  [true, false, true, true],
];

function StyleSample({ dot, corner }: { dot?: DotStyle; corner?: CornerStyle }) {
  const shapes = useMemo(() => {
    // A 21-module code with a 4×4 patch of data in the middle, clear of the corner squares.
    const matrix = [...Array(21)].map((_, row) =>
      [...Array(21)].map(
        (__, col) => row >= 8 && row < 12 && col >= 8 && col < 12 && SAMPLE[row - 8][col - 8],
      ),
    );
    const { shapes: all } = qrShapes(
      matrix,
      {
        dot: dot ?? 'square',
        corner: corner ?? 'square',
        fg: 'currentColor',
        bg: '',
        corners: '',
        margin: 0,
      },
      null,
    );
    const inPatch = (shape: Shape) =>
      shape.type === 'circle'
        ? shape.cx > 8 && shape.cx < 12 && shape.cy > 8 && shape.cy < 12
        : 'x' in shape && shape.x >= 8 && shape.x < 12 && shape.y >= 8 && shape.y < 12;
    const inCorner = (shape: Shape) =>
      shape.type === 'circle'
        ? shape.cx < 7 && shape.cy < 7
        : 'x' in shape && shape.x < 7 && shape.y < 7;
    return all.filter(dot ? inPatch : inCorner);
  }, [dot, corner]);
  return (
    <svg viewBox={dot ? '8 8 4 4' : '0 0 7 7'} className="size-[18px]" aria-hidden="true">
      <QrShapes shapes={shapes} />
    </svg>
  );
}

/** A small code in a preset's look: the swatch is the result. */
function LookThumb({ look }: { look: LookPreset }) {
  const shapes = useMemo(
    () => qrShapes(qrMatrix(THUMB, 'L'), { ...look, margin: 1 }, null),
    [look],
  );
  return (
    <svg
      viewBox={`0 0 ${shapes.total} ${shapes.total}`}
      className="block aspect-square w-full rounded-[10px]"
      style={{ background: look.bg }}
      aria-hidden="true"
    >
      <QrShapes shapes={shapes.shapes} />
    </svg>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
  render,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  render?: (value: T) => ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-11 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition-colors lg:h-10',
              on ? 'text-[#12110d]' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
            )}
            style={on ? { background: ACCENT } : undefined}
          >
            {render?.(option.value)}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** An optional field, folded to one line until it's wanted (or already has something in it). */
function Extra({
  label,
  filled,
  children,
}: {
  label: string;
  filled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(filled);
  const box = useRef<HTMLDivElement>(null);
  // Once something's in it, it stays open.
  if (filled && !open) setOpen(true);
  if (open)
    return (
      <div ref={box} className="grid animate-rise gap-3">
        {children}
      </div>
    );
  return (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
        requestAnimationFrame(() =>
          box.current?.querySelector<HTMLElement>('input, textarea')?.focus(),
        );
      }}
      className="-ml-1 flex min-h-11 items-center gap-2 self-start rounded-full px-1 text-[14px] font-medium text-signal-ink transition-colors hover:text-ink"
    >
      <span className="grid size-6 place-items-center rounded-full bg-signal-soft">
        <Icon name="plus" size={14} />
      </span>
      {label}
    </button>
  );
}

const quiet = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const;

export function QrStudio() {
  const id = useId();
  const [kind, setKind] = useState<QrKind | null>(null);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [wifi, setWifi] = useState<Wifi>({
    ssid: '',
    password: '',
    security: 'WPA',
    hidden: false,
  });
  const [contact, setContact] = useState<Contact>(emptyContact);
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState({ number: '', message: '' });
  const [email, setEmail] = useState({ to: '', subject: '', body: '' });
  const [look, setLook] = useState<QrLook>({
    dot: 'square',
    corner: 'square',
    fg: '#12110d',
    bg: '#ffffff',
    corners: '',
    margin: 4,
  });
  const [logo, setLogo] = useState<QrLogo | null>(null);
  const [logoError, setLogoError] = useState('');
  const [chosenLevel, setChosenLevel] = useState<QrLevel>('M');
  const [caption, setCaption] = useState('');
  const [size, setSize] = useState(1024);
  const [message, setMessage] = useState('');
  const details = useRef<HTMLDivElement>(null);

  // Arriving from Signal Links (or any link to /tools/qr#link=…): start with that link.
  useEffect(() => {
    const match = window.location.hash.match(/^#link=(.+)$/);
    if (!match) return;
    try {
      const incoming = decodeURIComponent(match[1]).slice(0, 2900);
      if (isWebLink(incoming)) {
        // The address is an outside system, read once when the tool opens.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setKind('link');
        setUrl(incoming);
      }
    } catch {
      // A broken link: start empty.
    }
  }, []);

  const content: QrContent = useMemo(() => {
    switch (kind ?? 'link') {
      case 'link':
        return { kind: 'link', url };
      case 'text':
        return { kind: 'text', text };
      case 'wifi':
        return { kind: 'wifi', ...wifi };
      case 'contact':
        return { kind: 'contact', contact };
      case 'phone':
        return { kind: 'phone', number: phone };
      case 'sms':
        return { kind: 'sms', ...sms };
      case 'email':
        return { kind: 'email', ...email };
    }
  }, [kind, url, text, wifi, contact, phone, sms, email]);

  const value = kind ? payloadFor(content) : '';
  // A logo needs the strongest error correction to stay readable.
  const level: QrLevel = logo ? 'H' : chosenLevel;
  const code = useMemo<Code>(() => {
    if (!value) return { state: 'empty' };
    try {
      return { state: 'ready', matrix: qrMatrix(value, level) };
    } catch {
      return { state: 'too-long' };
    }
  }, [value, level]);
  const drawn = useMemo(
    () => (code.state === 'ready' ? qrShapes(code.matrix, look, logo) : null),
    [code, look, logo],
  );
  const ghostMatrix = useMemo(() => qrMatrix(GHOST, level), [level]);
  const ghost = useMemo(() => qrShapes(ghostMatrix, look, logo), [ghostMatrix, look, logo]);
  const risks = scanRisks(look, logo);
  const band = caption && drawn ? captionBand(drawn.total) : 0;
  const fileBase = `qr-${slugName(describeContent(content), 'code')}`;
  const linkWarning =
    kind === 'link' && url.trim() && !isWebLink(url)
      ? 'That doesn’t look like a web address yet.'
      : '';
  const captionColor = look.bg ? look.fg : '#12110d';
  const meta = KINDS.find((option) => option.value === kind) ?? KINDS[0];
  const preset = LOOKS.find(
    (option) =>
      option.fg === look.fg &&
      option.bg === look.bg &&
      option.corners === look.corners &&
      option.dot === look.dot &&
      option.corner === look.corner,
  );

  const choose = (next: QrKind) => {
    setKind(next);
    setMessage('');
    // Bring the new step into view, and on a desktop put the cursor in it.
    requestAnimationFrame(() => {
      const box = details.current;
      if (!box) return;
      if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
      if (window.matchMedia('(pointer: fine)').matches)
        box.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    });
  };

  const fillSample = () => {
    switch (kind) {
      case 'link':
        return setUrl('https://saltandember.example/menu');
      case 'text':
        return setText('Welcome in! Ask us about today’s specials.');
      case 'wifi':
        return setWifi({ ...wifi, ssid: 'Salt & Ember Guest', password: 'espresso-please' });
      case 'contact':
        return setContact({
          ...contact,
          first: 'Rosa',
          last: 'Delgado',
          org: 'Salt & Ember',
          phone: '+1 555 010 0199',
          email: 'rosa@saltandember.example',
        });
      case 'phone':
        return setPhone('+1 555 010 0199');
      case 'sms':
        return setSms({ number: '+1 555 010 0199', message: 'Table for 4 tonight at 7?' });
      case 'email':
        return setEmail({
          ...email,
          to: 'hello@saltandember.example',
          subject: 'Catering inquiry',
        });
    }
  };

  const svg = () =>
    drawn ? shapesToSvg(drawn.shapes, drawn.total, { bg: look.bg, caption, captionColor }) : '';

  const downloadSvg = () => {
    if (!drawn) return;
    download(new Blob([svg()], { type: 'image/svg+xml' }), `${fileBase}.svg`);
    setMessage(`Downloaded ${fileBase}.svg — sharp at any size.`);
  };

  const downloadPng = async () => {
    if (!drawn) return;
    try {
      const scale = Math.max(1, Math.floor(size / drawn.total));
      const width = drawn.total * scale;
      const bandPx = band * scale;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = width + bandPx;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      if (look.bg) {
        context.fillStyle = look.bg;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const images = new Map<string, CanvasImageSource>();
      if (logo) images.set(logo.src, await loadImage(logo.src));
      drawShapes(context, drawn.shapes, scale, images);
      if (caption) {
        const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
        context.fillStyle = captionColor;
        context.font = `600 ${Math.round(width * 0.07)}px ${family}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(caption, width / 2, width + bandPx * 0.42, width * 0.9);
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('png');
      download(blob, `${fileBase}.png`);
      setMessage(`Downloaded ${fileBase}.png · ${width} px wide.`);
    } catch {
      setMessage('This browser couldn’t make the PNG. Download the SVG instead.');
    }
  };

  // Step 1: what the code opens, as big picture cards.
  if (!kind)
    return (
      <>
        <StageMotion />
        <StartPanel
          art={<KindArt />}
          title="What should your code open?"
          lead="Pick one. Next you’ll fill in the details, then make it look like yours."
        >
          <ChoiceCards
            label="What the code opens"
            columns={3}
            options={PICKABLE.map(({ value, label, icon, hint }) => ({ value, label, icon, hint }))}
            selected={[]}
            onToggle={choose}
          />
          <button
            type="button"
            onClick={() => choose('text')}
            className="mx-auto mt-3 flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-muted transition-colors hover:text-ink"
          >
            <Icon name="file-text" size={15} />
            Or just show some text
          </button>
        </StartPanel>
      </>
    );

  const hasContent = code.state === 'ready';
  const field = (name: string) => `${id}-${name}`;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,.92fr)] lg:grid-rows-[auto_1fr] lg:gap-6">
      <StageMotion />

      {/* Step 2: only the fields this kind needs. */}
      <div
        ref={details}
        className="order-1 min-w-0 scroll-mt-24 lg:order-none lg:col-start-1 lg:row-start-1"
      >
        <Surface as="section" aria-labelledby={field('what')} className="grid gap-5 sm:!p-6">
          <div className="flex items-start gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-[14px] text-[#12110d] shadow-[0_10px_24px_-14px_var(--accent,transparent)]"
              style={{ background: ACCENT }}
            >
              <Icon name={meta.icon} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-muted">
                <span className="mono-num">2</span> · {meta.label}
              </p>
              <h2
                id={field('what')}
                className="font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[23px]"
              >
                {meta.title}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setKind(null)}
              aria-label="Change what the code opens"
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-well px-3.5 text-[13.5px] font-medium text-ink-2 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              <Icon name="repeat" size={14} />
              Change
            </button>
          </div>
          <div className="-mt-3 grid justify-items-start gap-1">
            <p className="text-[14px] leading-snug text-muted">{meta.lead}</p>
            {!value && (
              <SampleButton onClick={fillSample} className="-mb-2 !mx-0 -ml-4! min-h-10">
                Try an example
              </SampleButton>
            )}
          </div>

          {kind === 'link' && (
            <Field label="Link" htmlFor={field('url')} error={linkWarning || undefined}>
              <Input
                id={field('url')}
                aria-label="Link or text"
                type="url"
                inputMode="url"
                enterKeyHint="done"
                autoComplete="url"
                {...quiet}
                placeholder="yourshop.example/menu"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                onBlur={() => url.trim() && setUrl(normalizeLink(url))}
              />
            </Field>
          )}

          {kind === 'text' && (
            <Field label="Text" htmlFor={field('text')}>
              <Textarea
                id={field('text')}
                rows={4}
                maxLength={1000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Anything up to about 1,000 letters"
              />
            </Field>
          )}

          {kind === 'wifi' && (
            <div className="grid gap-4">
              <Field label="Network name" htmlFor={field('ssid')}>
                <Input
                  id={field('ssid')}
                  autoComplete="off"
                  enterKeyHint="next"
                  {...quiet}
                  placeholder="Salt & Ember Guest"
                  value={wifi.ssid}
                  onChange={(event) => setWifi({ ...wifi, ssid: event.target.value })}
                />
              </Field>
              <Choices
                label="Security"
                value={wifi.security === 'nopass' ? 'nopass' : 'password'}
                onChange={(next) =>
                  setWifi({
                    ...wifi,
                    security:
                      next === 'nopass' ? 'nopass' : wifi.security === 'WEP' ? 'WEP' : 'WPA',
                  })
                }
                options={[
                  { value: 'password', label: 'Has a password', icon: 'lock' },
                  { value: 'nopass', label: 'No password' },
                ]}
              />
              {wifi.security !== 'nopass' && (
                <Field label="Password" htmlFor={field('pass')}>
                  <Input
                    id={field('pass')}
                    autoComplete="off"
                    enterKeyHint="done"
                    {...quiet}
                    value={wifi.password}
                    onChange={(event) => setWifi({ ...wifi, password: event.target.value })}
                  />
                </Field>
              )}
              <Extra
                label="Hidden or older network?"
                filled={wifi.hidden || wifi.security === 'WEP'}
              >
                <div className="grid">
                  <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={wifi.hidden}
                      onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })}
                      className="size-4.5 accent-[var(--accent,var(--color-ink))]"
                    />
                    The network is hidden
                  </label>
                  <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={wifi.security === 'WEP'}
                      onChange={(event) =>
                        setWifi({ ...wifi, security: event.target.checked ? 'WEP' : 'WPA' })
                      }
                      className="size-4.5 accent-[var(--accent,var(--color-ink))]"
                    />
                    <span>
                      It uses older security <span className="text-muted">(WEP)</span>
                    </span>
                  </label>
                </div>
              </Extra>
            </div>
          )}

          {kind === 'contact' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor={field('c-first')}>
                <Input
                  id={field('c-first')}
                  autoComplete="given-name"
                  enterKeyHint="next"
                  placeholder="Rosa"
                  value={contact.first}
                  onChange={(event) => setContact({ ...contact, first: event.target.value })}
                />
              </Field>
              <Field label="Last name" htmlFor={field('c-last')}>
                <Input
                  id={field('c-last')}
                  autoComplete="family-name"
                  enterKeyHint="next"
                  placeholder="Delgado"
                  value={contact.last}
                  onChange={(event) => setContact({ ...contact, last: event.target.value })}
                />
              </Field>
              <Field label="Phone" htmlFor={field('c-phone')} className="col-span-2">
                <Input
                  id={field('c-phone')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  placeholder="+1 555 010 0199"
                  value={contact.phone}
                  onChange={(event) => setContact({ ...contact, phone: event.target.value })}
                />
              </Field>
              <Field label="Email" htmlFor={field('c-email')} className="col-span-2">
                <Input
                  id={field('c-email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint="done"
                  {...quiet}
                  placeholder="rosa@saltandember.example"
                  value={contact.email}
                  onChange={(event) => setContact({ ...contact, email: event.target.value })}
                />
              </Field>
              <div className="col-span-2 grid">
                <Extra
                  label="Add company, website or a note"
                  filled={Boolean(contact.org || contact.title || contact.url || contact.note)}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Company" htmlFor={field('c-org')}>
                      <Input
                        id={field('c-org')}
                        autoComplete="organization"
                        enterKeyHint="next"
                        placeholder="Salt & Ember"
                        value={contact.org}
                        onChange={(event) => setContact({ ...contact, org: event.target.value })}
                      />
                    </Field>
                    <Field label="Job title" htmlFor={field('c-title')}>
                      <Input
                        id={field('c-title')}
                        autoComplete="organization-title"
                        enterKeyHint="next"
                        placeholder="Owner"
                        value={contact.title}
                        onChange={(event) => setContact({ ...contact, title: event.target.value })}
                      />
                    </Field>
                    <Field label="Website" htmlFor={field('c-url')} className="col-span-2">
                      <Input
                        id={field('c-url')}
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        enterKeyHint="next"
                        {...quiet}
                        placeholder="saltandember.example"
                        value={contact.url}
                        onChange={(event) => setContact({ ...contact, url: event.target.value })}
                      />
                    </Field>
                    <Field label="Note" htmlFor={field('c-note')} className="col-span-2">
                      <Input
                        id={field('c-note')}
                        enterKeyHint="done"
                        value={contact.note}
                        onChange={(event) => setContact({ ...contact, note: event.target.value })}
                      />
                    </Field>
                  </div>
                </Extra>
              </div>
            </div>
          )}

          {kind === 'phone' && (
            <Field label="Phone number" htmlFor={field('phone')}>
              <Input
                id={field('phone')}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="done"
                placeholder="+1 555 010 0199"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          )}

          {kind === 'sms' && (
            <div className="grid gap-4">
              <Field label="Send to" htmlFor={field('sms-to')}>
                <Input
                  id={field('sms-to')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="done"
                  placeholder="+1 555 010 0199"
                  value={sms.number}
                  onChange={(event) => setSms({ ...sms, number: event.target.value })}
                />
              </Field>
              <Extra label="Add a ready-to-send message" filled={Boolean(sms.message)}>
                <Field label="Message" htmlFor={field('sms-body')} optional>
                  <Textarea
                    id={field('sms-body')}
                    rows={3}
                    maxLength={300}
                    placeholder="Table for 4 tonight at 7?"
                    value={sms.message}
                    onChange={(event) => setSms({ ...sms, message: event.target.value })}
                  />
                </Field>
              </Extra>
            </div>
          )}

          {kind === 'email' && (
            <div className="grid gap-4">
              <Field label="Email address" htmlFor={field('mail-to')}>
                <Input
                  id={field('mail-to')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint="done"
                  {...quiet}
                  placeholder="hello@yourshop.example"
                  value={email.to}
                  onChange={(event) => setEmail({ ...email, to: event.target.value })}
                />
              </Field>
              <Extra
                label="Add a subject and message"
                filled={Boolean(email.subject || email.body)}
              >
                <Field label="Subject" htmlFor={field('mail-subject')} optional>
                  <Input
                    id={field('mail-subject')}
                    enterKeyHint="next"
                    placeholder="Catering inquiry"
                    value={email.subject}
                    onChange={(event) => setEmail({ ...email, subject: event.target.value })}
                  />
                </Field>
                <Field label="Message" htmlFor={field('mail-body')} optional>
                  <Textarea
                    id={field('mail-body')}
                    rows={3}
                    value={email.body}
                    onChange={(event) => setEmail({ ...email, body: event.target.value })}
                  />
                </Field>
              </Extra>
            </div>
          )}
        </Surface>
      </div>

      {/* The code, with steps 4 under it: right under what you type on phones; beside it on desktops. */}
      <div className="contents lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:gap-3 lg:self-start">
        <Surface
          as="section"
          id={field('stage')}
          aria-label="Your code"
          className="relative isolate order-2 overflow-hidden !p-5 sm:!p-7 lg:order-none"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background: `radial-gradient(60% 50% at 50% 42%, color-mix(in srgb, ${ACCENT} 18%, transparent), transparent 72%), radial-gradient(50% 40% at 100% 100%, color-mix(in srgb, var(--glow, ${ACCENT}) 14%, transparent), transparent 70%)`,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 opacity-60"
            style={{
              backgroundImage: `linear-gradient(color-mix(in srgb, ${ACCENT} 10%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, ${ACCENT} 10%, transparent) 1px, transparent 1px)`,
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(60% 55% at 50% 45%, #000, transparent)',
            }}
          />
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <span
                className={cn(
                  'size-2 rounded-full',
                  hasContent ? (risks.length ? 'bg-caution' : 'bg-positive') : 'bg-faint',
                )}
              />
              {hasContent ? (risks.length ? 'Check before printing' : 'Ready to scan') : 'Preview'}
            </span>
            {preset && <span className="text-[12.5px] text-muted">{preset.name} look</span>}
          </div>

          <div className="relative mx-auto w-full max-w-[236px] sm:max-w-[300px]">
            <Viewfinder />
            <div
              className="relative overflow-hidden rounded-[18px] p-3 shadow-[0_28px_60px_-30px_var(--glow,rgb(0_0_0/.5))] transition-colors duration-300 sm:p-4"
              style={{
                background:
                  look.bg ||
                  'repeating-conic-gradient(#e7e4dc 0% 25%, #ffffff 0% 50%) 50% / 16px 16px',
              }}
            >
              {drawn ? (
                <svg
                  key="code"
                  viewBox={`0 0 ${drawn.total} ${drawn.total + band}`}
                  className="block h-auto w-full animate-pop"
                  role="img"
                  aria-label={`QR code for ${value.slice(0, 120)}`}
                >
                  <QrShapes shapes={drawn.shapes} />
                  {caption && (
                    <text
                      x={drawn.total / 2}
                      y={drawn.total + band * 0.42}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontWeight={600}
                      fontSize={drawn.total * 0.07}
                      fill={captionColor}
                      style={{ fontFamily: 'var(--font-sans)' }}
                    >
                      {caption}
                    </text>
                  )}
                </svg>
              ) : (
                <div key="ghost" className="relative">
                  <svg
                    viewBox={`0 0 ${ghost.total} ${ghost.total}`}
                    className="block h-auto w-full opacity-[.16]"
                    aria-hidden="true"
                  >
                    <QrShapes shapes={ghost.shapes} />
                  </svg>
                  <span
                    aria-hidden="true"
                    className="qr-sweep absolute inset-x-0 top-0 h-1/4"
                    style={{
                      background: `linear-gradient(to bottom, transparent, color-mix(in srgb, var(--glow, ${ACCENT}) 30%, transparent), transparent)`,
                    }}
                  />
                  <p className="absolute inset-0 grid place-items-center px-4 text-center">
                    <span className="max-w-[16ch] rounded-[14px] bg-[#12110d] px-3.5 py-2 text-[13px] leading-snug font-medium text-balance text-[#f4f1ea] shadow-lift sm:max-w-none">
                      {code.state === 'too-long'
                        ? 'That’s too much for one code. Try something shorter.'
                        : 'Your code will look like this'}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>

          <p className="mt-6 truncate text-center text-[13.5px] font-medium text-ink-2">
            {drawn ? opensLine(content) : 'It draws itself as you type.'}
          </p>
          {drawn && risks.length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {risks.map((risk) => (
                <Note key={risk} icon="alert" tone="caution">
                  {risk}
                </Note>
              ))}
            </div>
          )}
          {drawn && risks.length === 0 && (
            <p className="mt-1 text-center text-[12.5px] text-muted">
              Scan it once with your phone before you print a stack.
            </p>
          )}
        </Surface>

        {/* Step 4: one big download, kept under the thumb on phones. */}
        <ActionBar
          // This page's phone gutter is 12px, not the 16px the bar assumes.
          className={cn(
            'order-4 !mt-0 max-sm:-mx-3! max-sm:px-3! lg:order-none',
            !drawn && 'hidden lg:block',
          )}
        >
          <div className="flex items-center gap-2.5">
            {drawn && (
              // On phones the code rides along with the button, so it's never out of sight.
              <button
                type="button"
                aria-label="Show the code"
                onClick={() =>
                  document
                    .getElementById(field('stage'))
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }
                className="size-14 shrink-0 rounded-[14px] p-1 shadow-card sm:hidden"
                style={{ background: look.bg || '#ffffff' }}
              >
                <svg viewBox={`0 0 ${drawn.total} ${drawn.total}`} className="block size-full">
                  <QrShapes shapes={drawn.shapes} />
                </svg>
              </button>
            )}
            <ActionButton icon="download" disabled={!drawn} onClick={downloadPng}>
              Download PNG
            </ActionButton>
          </div>
          <p
            role="status"
            className="mt-1.5 min-h-4 text-center text-[12.5px] text-muted empty:hidden"
          >
            {message}
          </p>
        </ActionBar>

        <Surface className={cn('order-5 !py-1 lg:order-none', drawn ? 'grid' : 'hidden lg:grid')}>
          <button
            type="button"
            disabled={!drawn}
            onClick={downloadSvg}
            className="flex min-h-12 items-center gap-3 text-left text-[14.5px] font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
          >
            <span className="grid size-7 place-items-center rounded-full bg-well">
              <Icon name="download" size={14} />
            </span>
            <span className="flex-1">SVG for print</span>
            <span className="text-[12.5px] font-normal text-muted">Sharp at any size</span>
          </button>
          <MoreOptions
            label="Print settings"
            summary={`${size} wide · border ${look.margin}`}
            className="border-t border-line pt-1 pb-1 [&[open]]:pb-4"
          >
            <div className="grid gap-4">
              <div className="grid gap-2">
                <span className="text-[13px] font-medium text-ink-2">Image size</span>
                <Choices
                  label="Image size"
                  value={String(size)}
                  onChange={(next) => setSize(Number(next))}
                  options={SIZES}
                />
              </div>
              <div className="grid gap-2">
                <span className="text-[13px] font-medium text-ink-2">Sturdiness</span>
                {logo ? (
                  <p className="text-[12.5px] text-muted">
                    Set to the sturdiest while there’s a logo, so it still scans.
                  </p>
                ) : (
                  <>
                    <Choices
                      label="Sturdiness"
                      value={chosenLevel}
                      onChange={setChosenLevel}
                      options={LEVELS}
                    />
                    <p className="text-[12.5px] text-muted">
                      Sturdier codes survive scuffs, with more dots.
                    </p>
                  </>
                )}
              </div>
              <Field
                label={
                  <span className="flex w-full items-center justify-between">
                    Border
                    <span className="mono-num text-[11px] font-normal text-muted">
                      {look.margin}
                    </span>
                  </span>
                }
                htmlFor={field('margin')}
              >
                <input
                  id={field('margin')}
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={look.margin}
                  onChange={(event) => setLook({ ...look, margin: Number(event.target.value) })}
                  className="w-full accent-[var(--accent,var(--color-ink))]"
                />
              </Field>
            </div>
          </MoreOptions>
        </Surface>
      </div>

      {/* Step 3: a look in one tap; the details wait under More options. */}
      <Surface
        as="section"
        aria-labelledby={field('look')}
        className="order-3 grid gap-4 sm:!p-6 lg:order-none lg:col-start-1 lg:row-start-2 lg:self-start"
      >
        <div className="grid gap-1">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-signal-soft text-signal-ink">
              <Icon name="palette" size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-muted">
                <span className="mono-num">3</span> · Style
              </p>
              <h2
                id={field('look')}
                className="font-display text-[21px] leading-tight font-bold tracking-[-0.02em] text-ink sm:text-[23px]"
              >
                Make it yours
              </h2>
            </div>
          </div>
          <p className="mt-1 text-[14px] leading-snug text-muted">
            Pick a look. Every one is checked to scan.
          </p>
        </div>
        <div
          role="group"
          aria-label="Looks"
          className="grid grid-cols-3 gap-2.5 sm:grid-cols-6 sm:gap-2 lg:grid-cols-3 xl:grid-cols-6"
        >
          {LOOKS.map((option) => {
            const on = option === preset;
            return (
              <button
                key={option.name}
                type="button"
                aria-pressed={on}
                aria-label={`${option.name} look`}
                onClick={() =>
                  setLook((current) => ({
                    ...current,
                    fg: option.fg,
                    bg: option.bg,
                    corners: option.corners,
                    dot: option.dot,
                    corner: option.corner,
                  }))
                }
                className={cn(
                  'grid min-w-0 gap-2 rounded-[16px] p-2 pb-2.5 text-center transition-[background-color,box-shadow,transform] active:scale-[.97]',
                  on
                    ? 'bg-signal-soft shadow-[inset_0_0_0_2px_var(--accent,var(--color-ink))]'
                    : 'bg-well shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.09]',
                )}
              >
                <LookThumb look={option} />
                <span className={cn('text-[13.5px] font-semibold', on ? 'text-ink' : 'text-ink-2')}>
                  {option.name}
                </span>
              </button>
            );
          })}
        </div>

        <MoreOptions
          summary={[
            DOTS.find((option) => option.value === look.dot)?.label + ' dots',
            logo && 'logo',
            caption && 'caption',
          ]
            .filter(Boolean)
            .join(' · ')}
          className="border-t border-line pt-2"
        >
          <div className="grid gap-5 pb-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-2">
                <span className="text-[13px] font-medium text-ink-2">Dots</span>
                <Choice
                  label="Dot style"
                  value={look.dot}
                  onChange={(dot) => setLook({ ...look, dot })}
                  options={DOTS}
                  render={(dot) => <StyleSample dot={dot} />}
                />
              </div>
              <div className="grid content-start gap-2">
                <span className="text-[13px] font-medium text-ink-2">Corners</span>
                <Choice
                  label="Corner style"
                  value={look.corner}
                  onChange={(corner) => setLook({ ...look, corner })}
                  options={CORNERS}
                  render={(corner) => <StyleSample corner={corner} />}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <span className="text-[13px] font-medium text-ink-2">Colors</span>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['fg', 'Code'],
                    ['bg', 'Background'],
                    ['corners', 'Corners'],
                  ] as const
                ).map(([key, name]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-[12px] bg-subtle py-1.5 pr-3 pl-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-line)]"
                  >
                    <input
                      type="color"
                      value={look[key] || (key === 'bg' ? '#ffffff' : look.fg)}
                      onChange={(event) => setLook({ ...look, [key]: event.target.value })}
                      className="size-8 cursor-pointer rounded-[8px] border-0 bg-transparent p-0"
                      aria-label={`${name} color`}
                    />
                    <span>
                      <span className="block text-ink-2">{name}</span>
                      <span className="mono-num block text-[10.5px] text-muted">
                        {key === 'bg' && !look.bg
                          ? 'None'
                          : key === 'corners' && !look.corners
                            ? 'Same'
                            : look[key]}
                      </span>
                    </span>
                  </label>
                ))}
                <label className="flex min-h-11 items-center gap-2 px-1 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={!look.bg}
                    onChange={(event) =>
                      setLook({ ...look, bg: event.target.checked ? '' : '#ffffff' })
                    }
                    className="size-4 accent-[var(--accent,var(--color-ink))]"
                  />
                  See-through
                </label>
              </div>
            </div>

            <div className="grid gap-2 rounded-[16px] bg-subtle p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <div className="flex flex-wrap items-center gap-3">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo.src}
                    alt="Your logo"
                    className="size-11 rounded-[10px] bg-white object-contain p-1"
                  />
                ) : (
                  <span className="grid size-11 place-items-center rounded-[10px] bg-well text-muted">
                    <Icon name="image" size={18} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">Logo in the middle</span>
                  <span className="block text-[12.5px] text-muted">
                    {logo ? 'The code is made sturdier so it still scans.' : 'PNG, JPG or SVG.'}
                  </span>
                </span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  id={field('logo')}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    try {
                      setLogoError('');
                      const src = await logoFrom(file);
                      setLogo((current) => ({
                        src,
                        size: current?.size ?? 0.2,
                        plate: current?.plate ?? true,
                      }));
                    } catch (error) {
                      setLogoError(
                        error instanceof Error ? error.message : 'That logo couldn’t be read.',
                      );
                    }
                  }}
                />
                <label
                  htmlFor={field('logo')}
                  className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
                >
                  <Icon name="upload" size={15} /> {logo ? 'Change' : 'Add a logo'}
                </label>
                {logo && (
                  <button
                    type="button"
                    onClick={() => setLogo(null)}
                    className="h-10 rounded-[11px] px-3 text-[13.5px] text-muted hover:bg-ink/5 hover:text-ink"
                  >
                    Remove
                  </button>
                )}
              </div>
              {logoError && <p className="text-[12.5px] text-critical">{logoError}</p>}
              {logo && (
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    <span className="flex justify-between">
                      Logo size <span className="mono-num">{Math.round(logo.size * 100)}%</span>
                    </span>
                    <input
                      type="range"
                      min={LOGO_MIN}
                      max={LOGO_MAX}
                      step={0.01}
                      value={logo.size}
                      onChange={(event) => setLogo({ ...logo, size: Number(event.target.value) })}
                      className="accent-[var(--accent,var(--color-ink))]"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={logo.plate}
                      onChange={(event) => setLogo({ ...logo, plate: event.target.checked })}
                      className="size-4 accent-[var(--accent,var(--color-ink))]"
                    />
                    Plate behind it
                  </label>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Field
                label="Words under the code"
                htmlFor={field('caption')}
                optional
                hint="Printed with the code, so people know what they’re scanning."
              >
                <Input
                  id={field('caption')}
                  value={caption}
                  maxLength={32}
                  enterKeyHint="done"
                  placeholder={CAPTIONS[kind]?.[0] ?? 'Scan me'}
                  onChange={(event) => setCaption(event.target.value)}
                />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {(CAPTIONS[kind] ?? ['Scan me']).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    aria-pressed={caption === suggestion}
                    onClick={() => setCaption(caption === suggestion ? '' : suggestion)}
                    className={cn(
                      'min-h-9 rounded-full px-3.5 text-[13px] transition-colors',
                      caption === suggestion
                        ? 'text-[#12110d]'
                        : 'bg-well text-ink-2 hover:bg-ink/10',
                    )}
                    style={caption === suggestion ? { background: ACCENT } : undefined}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </MoreOptions>
      </Surface>
    </div>
  );
}
