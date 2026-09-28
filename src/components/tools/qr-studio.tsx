'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/ui/cn';
import { Input } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { download, slugName } from '@/lib/files/download';
import { qrMatrix, type QrLevel } from '@/lib/tools/qr';
import {
  describeContent,
  emptyContact,
  isWebLink,
  payloadFor,
  type QrContent,
  type QrKind,
} from '@/lib/tools/qr-payloads';
import {
  captionBand,
  contrast,
  drawShapes,
  LOGO_MAX,
  LOGO_MIN,
  luminance,
  qrShapes,
  shapesToSvg,
  type CornerStyle,
  type DotStyle,
  type QrLogo,
  type QrLook,
} from '@/lib/tools/qr-style';
import {
  ActionBar,
  ActionButton,
  Advanced,
  Choices,
  SampleButton,
  Stage,
  useReducedMotion,
} from './kit';
import { ContentFields, type Fields } from './qr-studio-fields';
import {
  KINDS,
  KindTiles,
  loadImage,
  logoFrom,
  LookThumb,
  QrShapes,
  Stamp,
  StudioArt,
  StyleTiles,
  SwatchRow,
  Viewfinder,
  type Swatch,
} from './qr-studio-parts';

/*
 * QR Studio: codes for links, Wi-Fi, contacts, calls, texts and email — styled, and still
 * scannable. Built on the same encoder as Hyphy's original QR tool (UTF-8, error correction,
 * contrast checks); new here are the kinds, the looks, logos, and guardrails that keep a styled
 * code readable. Everything is drawn on the device; nothing is uploaded or tracked.
 *
 * One tap says what the code is for; from then on the code itself is the screen. It draws as you
 * type, every style is a picture you tap, a logo can be dropped straight onto it, and downloading
 * stamps it: ready to scan. The technical settings wait under Advanced.
 */

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

const CODE_COLORS: Swatch[] = [
  { value: '#12110d', name: 'Ink' },
  { value: '#1d2b3a', name: 'Slate' },
  { value: '#083f3b', name: 'Deep teal' },
  { value: '#101a3f', name: 'Midnight' },
  { value: '#5a1043', name: 'Plum' },
  { value: '#0f3d2e', name: 'Forest' },
  { value: '#3a1508', name: 'Espresso' },
];
const BACKGROUNDS: Swatch[] = [
  { value: '#ffffff', name: 'White' },
  { value: '#e9fbf8', name: 'Aqua' },
  { value: '#fff6d8', name: 'Butter' },
  { value: '#fff0f7', name: 'Blush' },
  { value: '#eef2ff', name: 'Ice' },
  { value: '#f1f8ec', name: 'Mint' },
  { value: '', name: 'See-through' },
];
const CORNER_COLORS: Swatch[] = [
  { value: '', name: 'Same as the code' },
  { value: '#0b8a80', name: 'Teal' },
  { value: '#2f55d4', name: 'Blue' },
  { value: '#d8327f', name: 'Pink' },
  { value: '#2f7d4f', name: 'Green' },
  { value: '#c2410c', name: 'Orange' },
];

const LEVELS: { value: QrLevel; label: string; hint: string }[] = [
  { value: 'L', label: 'Low', hint: '7%' },
  { value: 'M', label: 'Medium', hint: '15%' },
  { value: 'Q', label: 'Quartile', hint: '25%' },
  { value: 'H', label: 'High', hint: '30%' },
];
const SIZES: { value: string; label: string }[] = [
  { value: '512', label: '512 px' },
  { value: '1024', label: '1024 px' },
  { value: '2048', label: '2048 px' },
];
const CAPTIONS: Record<QrKind, string[]> = {
  link: ['Scan for the menu', 'Scan to book', 'Scan me'],
  wifi: ['Scan to join our Wi-Fi', 'Guest Wi-Fi'],
  contact: ['Scan to save my number', 'Save my contact'],
  phone: ['Scan to call us', 'Scan me'],
  sms: ['Scan to text us', 'Scan me'],
  email: ['Scan to email us', 'Scan me'],
  text: ['Scan me'],
};

// What the empty stage shows: a real code, faded, in the current look.
const GHOST = 'https://hyphy.example/your-code-will-look-like-this';

type Code = { state: 'empty' } | { state: 'too-long' } | { state: 'ready'; matrix: boolean[][] };
type Panel = 'content' | 'style' | 'logo' | 'words';
type Status = { text: string; sig: string; tone: 'done' | 'quiet' | 'problem' };
type Risk = { text: string; fix?: { label: string; apply: () => void } };

const emptyFields: Fields = {
  url: '',
  text: '',
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  contact: emptyContact,
  phone: '',
  sms: { number: '', message: '' },
  email: { to: '', subject: '', body: '' },
};

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

/** A labeled group of controls inside a section. */
function Group({
  label,
  children,
  aside,
}: {
  label: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 content-start gap-2.5">
      <p className="flex items-center justify-between gap-3 text-[13px] font-semibold text-ink-2">
        {label}
        {aside}
      </p>
      {children}
    </div>
  );
}

/** One part of the controls: a tab on a phone, a section with its heading on a desktop. */
function Section({
  id,
  shown,
  title,
  icon,
  children,
}: {
  id: string;
  shown: boolean;
  title: string;
  icon: IconName;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      role="tabpanel"
      aria-labelledby={`${id}-title`}
      className={cn(
        'min-w-0 gap-5 lg:grid lg:py-6 lg:first:pt-1',
        shown ? 'fx-rise grid lg:animate-none' : 'hidden',
      )}
    >
      <h3
        id={`${id}-title`}
        className="hidden items-center gap-2.5 font-display text-[18px] font-bold tracking-[-0.015em] text-ink lg:flex"
      >
        <span
          className="grid size-8 place-items-center rounded-[10px] text-[var(--accent-ink,var(--color-ink))]"
          style={{
            background: 'color-mix(in srgb, var(--accent, var(--color-ink)) 20%, transparent)',
          }}
        >
          <Icon name={icon} size={16} />
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function QrStudio() {
  const id = useId();
  const idFor = useCallback((name: string) => `${id}-${name}`, [id]);
  const reduced = useReducedMotion();
  const [kind, setKind] = useState<QrKind | null>(null);
  const [fields, setFields] = useState<Fields>(emptyFields);
  const set = useCallback(
    <K extends keyof Fields>(key: K, value: Fields[K]) =>
      setFields((current) => ({ ...current, [key]: value })),
    [],
  );
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
  const [panel, setPanel] = useState<Panel>('content');
  const [status, setStatus] = useState<Status | null>(null);
  const [stamps, setStamps] = useState<{ sig: string; count: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const dragDepth = useRef(0);
  const card = useRef<HTMLDivElement>(null);

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
        setFields((current) => ({ ...current, url: incoming }));
      }
    } catch {
      // A broken link: start empty.
    }
  }, []);

  const content: QrContent = useMemo(() => {
    const { url, text, wifi, contact, phone, sms, email } = fields;
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
  }, [kind, fields]);

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
  const band = caption && drawn ? captionBand(drawn.total) : 0;
  const fileBase = `qr-${slugName(describeContent(content), 'code')}`;
  const captionColor = look.bg ? look.fg : '#12110d';
  const meta = KINDS.find((option) => option.value === kind) ?? KINDS[0];
  const linkWarning =
    kind === 'link' && fields.url.trim() && !isWebLink(fields.url)
      ? 'That doesn’t look like a web address yet.'
      : '';
  const preset = LOOKS.find(
    (option) =>
      option.fg === look.fg &&
      option.bg === look.bg &&
      option.corners === look.corners &&
      option.dot === look.dot &&
      option.corner === look.corner,
  );

  // Everything that changes how the code looks (not what it says): the preview morphs on these.
  const styleKey = [
    look.dot,
    look.corner,
    look.fg,
    look.bg,
    look.corners,
    look.margin,
    logo ? `${logo.src.length}${logo.plate ? 'p' : ''}` : '',
    level,
    caption ? 1 : 0,
  ].join('|');
  // What a download would hold: a stamp or a "Saved" line only stands while it's still true.
  const sig = `${value}|${styleKey}|${caption}|${size}|${logo?.size ?? ''}`;
  const shownStatus = status?.sig === sig ? status : null;
  const stamped = Boolean(drawn && stamps?.sig === sig);

  // The code morphs, quickly, when its style changes.
  const lastStyle = useRef(styleKey);
  useEffect(() => {
    if (lastStyle.current === styleKey) return;
    lastStyle.current = styleKey;
    if (reduced) return;
    card.current?.animate(
      [
        { transform: 'scale(.955)', opacity: 0.55 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 200, easing: 'cubic-bezier(.3,1.2,.4,1)' },
    );
  }, [styleKey, reduced]);

  /* ---------------- what's risky, in plain words, with a fix ---------------- */

  const risks: Risk[] = [];
  const background = look.bg || '#ffffff';
  if (luminance(look.fg) > luminance(background))
    risks.push({
      text: 'Light on dark trips up a lot of scanners.',
      fix: {
        label: 'Swap colors',
        apply: () => setLook({ ...look, fg: background, bg: look.fg }),
      },
    });
  else if (contrast(look.fg, background) < 4)
    risks.push({
      text: 'A bit faint for some phones.',
      fix: { label: 'Darken it', apply: () => setLook({ ...look, fg: '#12110d' }) },
    });
  if (look.corners && contrast(look.corners, background) < 3)
    risks.push({
      text: 'The corners are too faint, and phones look for them first.',
      fix: { label: 'Match the code', apply: () => setLook({ ...look, corners: '' }) },
    });
  if (look.margin < 2)
    risks.push({
      text: 'It needs a little room around it.',
      fix: { label: 'Add room', apply: () => setLook({ ...look, margin: 4 }) },
    });
  if (!look.bg)
    risks.push({
      text: 'See-through: print it on something plain and light.',
      fix: { label: 'Add white', apply: () => setLook({ ...look, bg: '#ffffff' }) },
    });
  if (logo && logo.size > LOGO_MAX) risks.push({ text: 'The logo is too big to scan reliably.' });

  /* ---------------- actions ---------------- */

  const choose = (next: QrKind) => {
    const first = !kind;
    setKind(next);
    setPanel('content');
    // Bring the code into view, and on a desktop put the cursor in the first field.
    requestAnimationFrame(() => {
      const stage = document.getElementById(idFor('stage'));
      if (first && stage && stage.getBoundingClientRect().top < 64)
        stage.scrollIntoView({ block: 'start' });
      if (window.matchMedia('(pointer: fine)').matches)
        document
          .getElementById(idFor('controls'))
          ?.querySelector<HTMLElement>('[data-first-field]')
          ?.focus({ preventScroll: true });
    });
  };

  const fillSample = () => {
    switch (kind) {
      case 'link':
        return set('url', 'https://saltandember.example/menu');
      case 'text':
        return set('text', 'Welcome in! Ask us about today’s specials.');
      case 'wifi':
        return set('wifi', {
          ...fields.wifi,
          ssid: 'Salt & Ember Guest',
          password: 'espresso-please',
        });
      case 'contact':
        return set('contact', {
          ...fields.contact,
          first: 'Rosa',
          last: 'Delgado',
          org: 'Salt & Ember',
          phone: '+1 555 010 0199',
          email: 'rosa@saltandember.example',
        });
      case 'phone':
        return set('phone', '+1 555 010 0199');
      case 'sms':
        return set('sms', { number: '+1 555 010 0199', message: 'Table for 4 tonight at 7?' });
      case 'email':
        return set('email', {
          ...fields.email,
          to: 'hello@saltandember.example',
          subject: 'Catering inquiry',
        });
    }
  };

  const takeLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      setLogoError('');
      const src = await logoFrom(file);
      setLogo((current) => ({ src, size: current?.size ?? 0.2, plate: current?.plate ?? true }));
      setPanel('logo');
    } catch (error) {
      setLogoError(error instanceof Error ? error.message : 'That logo couldn’t be read.');
      setPanel('logo');
    }
  };

  /** The code lands: pressed like a stamp, with the stamp on it. */
  const stamp = () => {
    setStamps((current) => ({ sig, count: (current?.count ?? 0) + 1 }));
    if (!reduced)
      card.current?.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(.93)', offset: 0.35 },
          { transform: 'scale(1.015)', offset: 0.75 },
          { transform: 'scale(1)' },
        ],
        { duration: 320, easing: 'ease-out' },
      );
  };

  const makePng = async () => {
    if (!drawn) throw new Error('empty');
    const scale = Math.max(1, Math.round(size / drawn.total));
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
    return { blob, width };
  };

  const downloadPng = async () => {
    if (!drawn) return;
    try {
      const { blob, width } = await makePng();
      download(blob, `${fileBase}.png`);
      stamp();
      setStatus({ text: `Saved ${fileBase}.png · ${width} px`, sig, tone: 'done' });
    } catch {
      setStatus({
        text: 'This browser couldn’t make the picture. Try the SVG instead.',
        sig,
        tone: 'problem',
      });
    }
  };

  const downloadSvg = () => {
    if (!drawn) return;
    const svg = shapesToSvg(drawn.shapes, drawn.total, { bg: look.bg, caption, captionColor });
    download(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase}.svg`);
    stamp();
    setStatus({ text: `Saved ${fileBase}.svg · sharp at any size`, sig, tone: 'done' });
  };

  const copyImage = async () => {
    if (!drawn) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': makePng().then((result) => result.blob) }),
      ]);
      setStatus({ text: 'Copied the picture. Paste it anywhere.', sig, tone: 'quiet' });
    } catch {
      setStatus({
        text: 'This browser won’t copy pictures. Download it instead.',
        sig,
        tone: 'problem',
      });
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus({
        text: kind === 'link' ? 'Copied the link.' : 'Copied what the code says.',
        sig,
        tone: 'quiet',
      });
    } catch {
      setStatus({ text: 'Couldn’t copy. Find it under Advanced.', sig, tone: 'problem' });
    }
  };

  /* ---------------- the first tap: what's it for? ---------------- */

  if (!kind)
    return (
      <section
        aria-labelledby={idFor('start')}
        className="relative isolate overflow-hidden rounded-[28px] bg-surface px-4 pt-6 pb-4 shadow-card sm:px-8 sm:py-10 lg:px-12 lg:py-12"
      >
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] lg:gap-14">
          <div className="hidden lg:block">
            <StudioArt />
          </div>
          <div className="min-w-0">
            <h2
              id={idFor('start')}
              className="mb-5 text-center font-display text-[30px] leading-[1] font-bold tracking-[-0.035em] text-ink sm:mb-7 sm:text-[40px] lg:text-left"
              style={{ fontVariationSettings: "'wdth' 110" }}
            >
              What’s it for?
            </h2>
            <KindTiles
              options={KINDS.filter((option) => option.value !== 'text')}
              value={null}
              onPick={choose}
            />
            <button
              type="button"
              onClick={() => choose('text')}
              className="mx-auto mt-2 flex min-h-11 items-center gap-1.5 rounded-full px-4 text-[14px] font-medium text-muted transition-colors hover:bg-ink/[.05] hover:text-ink sm:mt-3 lg:mx-0 lg:-ml-4"
            >
              <Icon name="file-text" size={15} />
              Or just some plain text
            </button>
          </div>
        </div>
      </section>
    );

  /* ---------------- the studio ---------------- */

  const tabs: { value: Panel; label: string; icon: IconName; set: boolean }[] = [
    { value: 'content', label: meta.label, icon: meta.icon, set: false },
    { value: 'style', label: 'Style', icon: 'palette', set: !preset || preset.name !== 'Classic' },
    { value: 'logo', label: 'Logo', icon: 'image', set: Boolean(logo) },
    { value: 'words', label: 'Words', icon: 'type', set: Boolean(caption) },
  ];

  const hasFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types).includes('Files');

  return (
    <div className="flex flex-col gap-3 sm:gap-4 lg:grid lg:grid-cols-[minmax(0,1.04fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
      {/* The object: the code, large, with the download right under it. */}
      <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-4">
        <Stage
          material="light"
          id={idFor('stage')}
          aria-label="Your code"
          role="region"
          className="order-1 scroll-mt-20 !px-5 !pt-8 !pb-5 sm:!px-8 sm:!pt-12 sm:!pb-7 lg:order-none"
          onDragEnter={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth.current += 1;
            setDropping(true);
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (!dragDepth.current) setDropping(false);
          }}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDropping(false);
            takeLogo(event.dataTransfer.files[0]);
          }}
        >
          <div className="relative mx-auto w-full max-w-[248px] sm:max-w-[340px] lg:max-w-[380px] xl:max-w-[400px]">
            <Viewfinder />
            <div
              ref={card}
              className="relative overflow-hidden rounded-[20px] p-3 shadow-[0_30px_60px_-30px_rgb(12_26_29/.5),0_0_0_1px_rgb(12_26_29/.06)] transition-[background-color] duration-200 sm:p-4"
              style={{
                background:
                  look.bg ||
                  'repeating-conic-gradient(#dfe5e6 0% 25%, #ffffff 0% 50%) 50% / 16px 16px',
              }}
            >
              {drawn ? (
                <svg
                  key="code"
                  viewBox={`0 0 ${drawn.total} ${drawn.total + band}`}
                  className="fx-pop block h-auto w-full"
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
                    className="block h-auto w-full opacity-[.13]"
                    aria-hidden="true"
                  >
                    <QrShapes shapes={ghost.shapes} />
                  </svg>
                  <p className="absolute inset-0 grid place-items-center px-3 text-center">
                    <span className="fx-pop inline-flex max-w-full items-center gap-1.5 rounded-full bg-ink px-4 py-2.5 text-[14px] leading-snug font-semibold text-balance text-on-ink shadow-lift sm:text-[15px]">
                      {code.state === 'too-long' ? (
                        'Too much for one code. Try something shorter.'
                      ) : (
                        <>
                          {meta.empty}
                          <Icon name="arrow-down" size={16} className="shrink-0 lg:hidden" />
                          <Icon name="arrow-right" size={16} className="hidden shrink-0 lg:block" />
                        </>
                      )}
                    </span>
                  </p>
                </div>
              )}
              {dropping && (
                <div className="fx-pop absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--color-surface)_55%,transparent)]">
                  <span
                    className="grid size-[42%] place-items-center rounded-[18px] border-[2.5px] border-dashed border-[var(--accent-ink,var(--color-ink))] text-center text-[14px] font-bold text-ink"
                    style={{ background: 'color-mix(in srgb, var(--accent) 30%, white)' }}
                  >
                    <span className="grid justify-items-center gap-1">
                      <Icon name="image" size={22} />
                      Drop your logo
                    </span>
                  </span>
                </div>
              )}
            </div>
            {stamped && stamps && (
              <Stamp key={stamps.count} className="-top-4 -right-4 sm:-top-5 sm:-right-7">
                {risks.length ? 'Saved' : 'Ready to scan'}
              </Stamp>
            )}
          </div>

          <div className="mt-6 grid min-h-6 gap-2 sm:mt-8">
            {drawn && (
              <p className="flex min-w-0 items-center justify-center gap-1.5 text-[14px] font-medium text-ink-2 sm:text-[15px]">
                <Icon
                  name={risks.length ? 'alert' : 'check-circle'}
                  size={16}
                  className={cn('shrink-0', risks.length ? 'text-caution' : 'text-positive')}
                />
                <span className="truncate">{opensLine(content)}</span>
              </p>
            )}
            {drawn &&
              risks.map((risk) => (
                <p
                  key={risk.text}
                  className="fx-rise flex items-center gap-3 rounded-[14px] bg-caution-soft py-1.5 pr-1.5 pl-3.5 text-left text-[13.5px] leading-snug text-caution"
                >
                  <span className="min-w-0 flex-1 py-1">{risk.text}</span>
                  {risk.fix && (
                    <button
                      type="button"
                      onClick={risk.fix.apply}
                      className="fx-move min-h-10 shrink-0 rounded-[10px] bg-surface px-3 text-[13.5px] font-semibold text-ink shadow-card active:scale-[.96]"
                    >
                      {risk.fix.label}
                    </button>
                  )}
                </p>
              ))}
          </div>
        </Stage>

        {/* The payoff, under the thumb on phones: one big download that stamps the code. */}
        <ActionBar
          // This page's phone gutter is 12px, not the 16px the bar assumes.
          className="order-3 !mt-0 max-sm:-mx-3! max-sm:px-3! sm:order-2 lg:order-none"
        >
          <div className="flex items-center gap-2">
            {drawn && (
              // On phones the code rides along with the button, so it's never out of sight.
              <button
                type="button"
                aria-label="Show the code"
                onClick={() =>
                  document
                    .getElementById(idFor('stage'))
                    ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
                }
                className="size-14 shrink-0 rounded-[14px] p-1 shadow-card sm:hidden"
                style={{ background: look.bg || '#ffffff' }}
              >
                <svg viewBox={`0 0 ${drawn.total} ${drawn.total}`} className="block size-full">
                  <QrShapes shapes={drawn.shapes} />
                </svg>
              </button>
            )}
            <ActionButton
              icon="download"
              disabled={!drawn}
              onClick={downloadPng}
              className="min-w-0 flex-1 lg:!h-16 lg:!rounded-[18px] lg:!text-[18px]"
            >
              Download PNG
            </ActionButton>
            <button
              type="button"
              aria-label="Download SVG"
              title="SVG: sharp at any size, for print"
              disabled={!drawn}
              onClick={downloadSvg}
              className="fx-move h-14 shrink-0 rounded-[16px] bg-surface px-4 text-[15px] font-bold text-ink shadow-[inset_0_0_0_1.5px_var(--color-line-strong)] hover:bg-ink/[.05] active:scale-[.96] disabled:opacity-40 sm:h-13 lg:!h-16 lg:rounded-[18px] lg:px-5"
            >
              SVG
            </button>
          </div>
          <div
            className={cn(
              'mt-1 flex items-center justify-center gap-1',
              !shownStatus && 'max-sm:hidden',
            )}
          >
            <button
              type="button"
              disabled={!drawn}
              onClick={copyImage}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.05] hover:text-ink disabled:opacity-40"
            >
              <Icon name="copy" size={15} /> Copy image
            </button>
            <button
              type="button"
              disabled={!drawn}
              onClick={copyText}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-ink-2 transition-colors hover:bg-ink/[.05] hover:text-ink disabled:opacity-40"
            >
              <Icon name={kind === 'link' ? 'link' : 'file-text'} size={15} />
              {kind === 'link' ? 'Copy link' : 'Copy text'}
            </button>
          </div>
          <p
            role="status"
            className={cn(
              'min-h-4 text-center text-[13px] empty:hidden',
              shownStatus?.tone === 'done' && 'font-semibold text-ink',
              shownStatus?.tone === 'quiet' && 'text-muted',
              shownStatus?.tone === 'problem' && 'text-critical',
            )}
          >
            {shownStatus && (
              <span key={shownStatus.text} className="fx-pop inline-flex items-center gap-1.5">
                {shownStatus.tone === 'done' && (
                  <Icon name="check-circle" size={15} className="text-positive" />
                )}
                <span className="min-w-0 truncate">{shownStatus.text}</span>
              </span>
            )}
          </p>
          {shownStatus?.tone === 'done' && !risks.length && (
            <p className="fx-rise mt-0.5 text-center text-[12.5px] text-muted [--i:2] max-sm:hidden">
              Scan it once with your phone before you print a stack.
            </p>
          )}
        </ActionBar>
      </div>

      {/* The controls: tabs under the code on a phone, all of it beside the code on a desktop. */}
      <div
        id={idFor('controls')}
        className="order-2 min-w-0 rounded-[26px] bg-surface shadow-card sm:order-3 lg:order-none"
      >
        <div
          role="tablist"
          aria-label="Edit your code"
          className="m-2 grid grid-cols-4 gap-1 rounded-[18px] bg-ink/[.05] p-1 lg:hidden"
        >
          {tabs.map((tab) => {
            const on = panel === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={idFor(`panel-${tab.value}`)}
                onClick={() => setPanel(tab.value)}
                className={cn(
                  'fx-move relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 text-[12.5px] font-semibold active:scale-[.96]',
                  on ? 'bg-surface text-ink shadow-card' : 'text-muted',
                )}
              >
                <Icon
                  name={tab.icon}
                  size={19}
                  className={on ? 'text-[var(--accent-ink,var(--color-ink))]' : undefined}
                />
                <span className="max-w-full truncate">{tab.label}</span>
                {tab.set && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 right-[calc(50%-18px)] size-1.5 rounded-full"
                    style={{ background: 'var(--accent-ink, var(--color-ink))' }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="grid px-4 pt-3 pb-5 sm:px-6 lg:divide-y lg:divide-line lg:px-7 lg:pt-6 lg:pb-3">
          {/* What it opens: the kind, then only its fields. */}
          <Section
            id={idFor('panel-content')}
            shown={panel === 'content'}
            title="What it opens"
            icon={meta.icon}
          >
            <KindTiles options={KINDS} value={kind} onPick={choose} compact />
            <ContentFields
              key={kind}
              kind={kind}
              fields={fields}
              set={set}
              idFor={idFor}
              linkWarning={linkWarning}
            />
            {!value && (
              <SampleButton
                onClick={() => {
                  fillSample();
                  // On a phone, show the code that just drew itself.
                  requestAnimationFrame(() => {
                    const stage = document.getElementById(idFor('stage'));
                    if (stage && stage.getBoundingClientRect().top < 0)
                      stage.scrollIntoView({
                        block: 'start',
                        behavior: reduced ? 'auto' : 'smooth',
                      });
                  });
                }}
                className="!mx-0 -mt-2 -ml-3 self-start"
              >
                Try an example
              </SampleButton>
            )}
          </Section>

          {/* The look: every choice is a picture of the result. */}
          <Section id={idFor('panel-style')} shown={panel === 'style'} title="Style" icon="palette">
            <div
              role="radiogroup"
              aria-label="Looks"
              className="grid grid-cols-3 gap-2 sm:grid-cols-6"
            >
              {LOOKS.map((option) => {
                const on = option === preset;
                return (
                  <button
                    key={option.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
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
                      'fx-move grid min-w-0 gap-1.5 rounded-[16px] p-1.5 pb-2 text-center active:scale-[.95]',
                      on
                        ? 'bg-surface shadow-[inset_0_0_0_2px_var(--accent-ink,var(--color-ink)),0_12px_24px_-16px_var(--accent,transparent)]'
                        : 'bg-ink/[.045] shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-ink/[.08]',
                    )}
                  >
                    <LookThumb look={option} />
                    <span
                      className={cn('text-[12.5px] font-semibold', on ? 'text-ink' : 'text-ink-2')}
                    >
                      {option.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-5 sm:grid-cols-[4fr_3fr] sm:gap-4">
              <Group label="Dots">
                <StyleTiles
                  label="Dot style"
                  type="dot"
                  value={look.dot}
                  options={DOTS}
                  onChange={(dot) => setLook({ ...look, dot })}
                  color={look.fg}
                  background={look.bg || '#ffffff'}
                />
              </Group>
              <Group label="Corners">
                <StyleTiles
                  label="Corner style"
                  type="corner"
                  value={look.corner}
                  options={CORNERS}
                  onChange={(corner) => setLook({ ...look, corner })}
                  color={look.corners || look.fg}
                  background={look.bg || '#ffffff'}
                />
              </Group>
            </div>
            <Group label="Code">
              <SwatchRow
                label="Code color"
                value={look.fg}
                options={CODE_COLORS}
                onChange={(fg) => setLook({ ...look, fg })}
              />
            </Group>
            <Group label="Background">
              <SwatchRow
                label="Background color"
                value={look.bg}
                options={BACKGROUNDS}
                onChange={(bg) => setLook({ ...look, bg })}
              />
            </Group>
            <Group label="Corner color">
              <SwatchRow
                label="Corner color"
                value={look.corners}
                options={CORNER_COLORS}
                onChange={(corners) => setLook({ ...look, corners })}
                same={look.fg}
              />
            </Group>
          </Section>

          {/* A logo in the middle: dropped on the code, or picked here. */}
          <Section id={idFor('panel-logo')} shown={panel === 'logo'} title="Logo" icon="image">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              id={idFor('logo')}
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                takeLogo(file);
              }}
            />
            {logo ? (
              <div className="fx-pop grid gap-4">
                <div className="flex items-center gap-4">
                  <span
                    className="grid size-[72px] shrink-0 place-items-center rounded-[16px] p-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
                    style={{ background: look.bg || '#ffffff' }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo.src} alt="Your logo" className="size-full object-contain" />
                  </span>
                  <label className="grid min-w-0 flex-1 gap-1.5">
                    <span className="text-[13px] font-semibold text-ink-2">Size</span>
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-ink/30" />
                      <input
                        type="range"
                        aria-label="Logo size"
                        min={LOGO_MIN}
                        max={LOGO_MAX}
                        step={0.01}
                        value={logo.size}
                        onChange={(event) => setLogo({ ...logo, size: Number(event.target.value) })}
                        className="h-11 min-w-0 flex-1 accent-[var(--accent-ink,var(--color-ink))] lg:h-8"
                      />
                      <span aria-hidden="true" className="size-4.5 rounded-[5px] bg-ink/30" />
                    </span>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {look.bg && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={logo.plate}
                      onClick={() => setLogo({ ...logo, plate: !logo.plate })}
                      className="fx-move inline-flex min-h-11 items-center gap-2.5 rounded-full bg-ink/[.05] py-1 pr-4 pl-1.5 text-[14px] font-medium text-ink-2 hover:bg-ink/[.08] lg:min-h-10"
                    >
                      <span
                        className={cn(
                          'fx-move relative h-6 w-10 rounded-full',
                          logo.plate ? 'bg-[var(--accent-ink,var(--color-ink))]' : 'bg-ink/20',
                        )}
                      >
                        <span
                          className={cn(
                            'fx-move absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-card',
                            logo.plate && 'translate-x-4',
                          )}
                        />
                      </span>
                      Box behind it
                    </button>
                  )}
                  <label
                    htmlFor={idFor('logo')}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-ink-2 hover:bg-ink/[.05] hover:text-ink lg:min-h-10"
                  >
                    <Icon name="replace" size={15} /> Change
                  </label>
                  <button
                    type="button"
                    aria-label="Remove logo"
                    onClick={() => setLogo(null)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium text-muted hover:bg-ink/[.05] hover:text-ink lg:min-h-10"
                  >
                    <Icon name="trash" size={15} /> Remove
                  </button>
                </div>
                <p className="text-[12.5px] text-muted">
                  The code gets sturdier with a logo, so it still scans.
                </p>
              </div>
            ) : (
              <label
                htmlFor={idFor('logo')}
                onDragOver={(event) => {
                  if (!hasFiles(event)) return;
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!hasFiles(event)) return;
                  event.preventDefault();
                  takeLogo(event.dataTransfer.files[0]);
                }}
                className="fx-move group flex min-h-[92px] cursor-pointer items-center gap-4 rounded-[18px] border-[1.5px] border-dashed border-line-strong bg-ink/[.025] p-4 hover:border-[var(--accent-ink,var(--color-ink))] hover:bg-ink/[.04] active:scale-[.99]"
              >
                <span className="fx-move grid size-14 shrink-0 place-items-center rounded-[16px] bg-[color-mix(in_srgb,var(--accent,var(--color-ink))_22%,transparent)] text-[var(--accent-ink,var(--color-ink))] group-hover:rotate-[-5deg]">
                  <Icon name="image" size={24} />
                </span>
                <span className="grid gap-0.5">
                  <span className="text-[16px] font-bold text-ink">Add your logo</span>
                  <span className="text-[13px] text-muted">
                    <span className="lg:hidden">Pick one from your photos or files</span>
                    <span className="hidden lg:inline">Or drag it straight onto the code</span>
                  </span>
                </span>
              </label>
            )}
            {logoError && (
              <p role="alert" className="-mt-2 text-[13px] text-critical">
                {logoError}
              </p>
            )}
          </Section>

          {/* Words under the code, so people know what they're scanning. */}
          <Section
            id={idFor('panel-words')}
            shown={panel === 'words'}
            title="Words under it"
            icon="type"
          >
            <div
              role="radiogroup"
              aria-label="Words under the code"
              className="flex flex-wrap gap-2"
            >
              {['', ...CAPTIONS[kind]].map((suggestion) => {
                const on = caption === suggestion;
                return (
                  <button
                    key={suggestion || 'none'}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setCaption(suggestion)}
                    className={cn(
                      'fx-move min-h-11 rounded-full px-4 text-[14px] font-medium active:scale-[.96] lg:min-h-10',
                      on
                        ? 'text-[var(--on-accent,#12110d)] shadow-[0_8px_20px_-12px_var(--accent,transparent)]'
                        : 'bg-ink/[.05] text-ink-2 hover:bg-ink/10 hover:text-ink',
                    )}
                    style={on ? { background: 'var(--accent, var(--color-ink))' } : undefined}
                  >
                    {suggestion || 'None'}
                  </button>
                );
              })}
            </div>
            <Input
              aria-label="Your own words"
              value={caption}
              maxLength={32}
              enterKeyHint="done"
              placeholder="Or write your own"
              onChange={(event) => setCaption(event.target.value)}
            />
          </Section>

          {/* The technical settings, for whoever wants them. */}
          <Advanced
            summary={`${size} px · ${LEVELS.find((option) => option.value === level)?.label} correction`}
            className="pt-4 lg:pt-4"
          >
            <div className="grid gap-5 pb-3">
              <Group label="Error correction">
                {logo ? (
                  <p className="text-[13px] text-muted">
                    High, while there’s a logo: it covers part of the code.
                  </p>
                ) : (
                  <Choices
                    label="Error correction"
                    value={chosenLevel}
                    onChange={setChosenLevel}
                    options={LEVELS}
                  />
                )}
              </Group>
              <Group
                label="Quiet zone"
                aside={
                  <span className="mono-num text-[12px] font-normal text-muted">
                    {look.margin} modules
                  </span>
                }
              >
                <input
                  type="range"
                  aria-label="Quiet zone"
                  min={0}
                  max={8}
                  step={1}
                  value={look.margin}
                  onChange={(event) => setLook({ ...look, margin: Number(event.target.value) })}
                  className="h-8 w-full accent-[var(--accent-ink,var(--color-ink))]"
                />
              </Group>
              <Group label="Picture size">
                <Choices
                  label="Picture size"
                  value={String(size)}
                  onChange={(next) => setSize(Number(next))}
                  options={SIZES}
                />
              </Group>
              {code.state === 'ready' && (
                <Group label="Inside the code">
                  <p className="mono-num text-[12px] text-muted">
                    Version {(code.matrix.length - 17) / 4} · {code.matrix.length}×
                    {code.matrix.length} modules · UTF-8
                  </p>
                  <pre className="max-h-32 overflow-auto rounded-[12px] bg-ink/[.045] px-3 py-2.5 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
                    {value}
                  </pre>
                </Group>
              )}
            </div>
          </Advanced>
        </div>
      </div>
    </div>
  );
}
