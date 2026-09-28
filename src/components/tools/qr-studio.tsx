'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
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
import { Label, Note, Surface } from './kit';

/*
 * QR Studio: codes for links, Wi-Fi, contacts, calls, texts and email — styled, and still
 * scannable. Built on the same encoder as Hyphy's original QR tool (UTF-8, error correction,
 * contrast checks); new here are the kinds, the looks, logos, and guardrails that keep a styled
 * code readable. Everything is drawn on the device; nothing is uploaded or tracked.
 *
 * On a phone it reads top to bottom like a calculator: what it opens, the code, then (folded away)
 * everything that changes how it looks.
 */

const KINDS: { value: QrKind; label: string; icon: IconName }[] = [
  { value: 'link', label: 'Link', icon: 'link' },
  { value: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { value: 'contact', label: 'Contact', icon: 'contact' },
  { value: 'phone', label: 'Call', icon: 'phone' },
  { value: 'sms', label: 'Text message', icon: 'sms' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'text', label: 'Plain text', icon: 'file-text' },
];

const PRESETS: { name: string; fg: string; bg: string; corners: string }[] = [
  { name: 'Ink', fg: '#12110d', bg: '#ffffff', corners: '' },
  { name: 'Signal', fg: '#1f28b8', bg: '#ffffff', corners: '#3240ff' },
  { name: 'Forest', fg: '#0f3d2e', bg: '#f3fbf6', corners: '#0f7a55' },
  { name: 'Espresso', fg: '#2a120e', bg: '#fff7ef', corners: '#b4411f' },
  { name: 'Plum', fg: '#3b1238', bg: '#fdf4fb', corners: '#9b2c8f' },
  { name: 'Night', fg: '#f4f1ea', bg: '#12110d', corners: '' },
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
const SIZES = [512, 1024, 2048];
const CAPTIONS: Partial<Record<QrKind, string[]>> = {
  link: ['Scan for the menu', 'Scan to book', 'Scan me'],
  wifi: ['Scan to join our Wi-Fi', 'Guest Wi-Fi'],
  contact: ['Scan to save my number', 'Save my contact'],
  phone: ['Scan to call us'],
  sms: ['Scan to text us'],
  email: ['Scan to email us'],
};

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
  render?: (value: T) => React.ReactNode;
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
              'flex h-11 items-center gap-2 rounded-[12px] px-3 text-[13.5px] font-medium transition-colors lg:h-10',
              on
                ? 'bg-surface text-ink shadow-[inset_0_0_0_1.5px_var(--color-ink)]'
                : 'bg-well text-muted hover:text-ink',
            )}
          >
            {render?.(option.value)}
            {option.label}
          </button>
        );
      })}
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

export function QrStudio() {
  const id = useId();
  const [kind, setKind] = useState<QrKind>('link');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [wifi, setWifi] = useState<{
    ssid: string;
    password: string;
    security: 'WPA' | 'WEP' | 'nopass';
    hidden: boolean;
  }>({ ssid: '', password: '', security: 'WPA', hidden: false });
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
  const logoInput = useRef<HTMLInputElement>(null);

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
    switch (kind) {
      case 'link':
        return { kind, url };
      case 'text':
        return { kind, text };
      case 'wifi':
        return { kind, ...wifi };
      case 'contact':
        return { kind, contact };
      case 'phone':
        return { kind, number: phone };
      case 'sms':
        return { kind, ...sms };
      case 'email':
        return { kind, ...email };
    }
  }, [kind, url, text, wifi, contact, phone, sms, email]);

  const value = payloadFor(content);
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
  const risks = scanRisks(look, logo);
  const band = caption && drawn ? captionBand(drawn.total) : 0;
  const fileBase = `qr-${slugName(describeContent(content), 'code')}`;
  const linkWarning =
    kind === 'link' && url.trim() && !isWebLink(url)
      ? 'That doesn’t look like a web address yet.'
      : '';
  const captionColor = look.bg ? look.fg : '#12110d';

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

  const setColors = (fg: string, bg: string, corners = '') =>
    setLook((current) => ({ ...current, fg, bg, corners }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,.92fr)] lg:grid-rows-[auto_1fr] lg:gap-6">
      {/* What the code opens comes first everywhere: on a phone it's the one box that matters. */}
      <Surface className="grid content-start gap-4 lg:col-start-1 lg:row-start-1">
        <section aria-labelledby={`${id}-what`} className="grid gap-4">
          <Label id={`${id}-what`}>What it opens</Label>
          <div
            role="radiogroup"
            aria-label="What the code opens"
            className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
          >
            {KINDS.map((option) => {
              const on = option.value === kind;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setKind(option.value);
                    setMessage('');
                  }}
                  className={cn(
                    'flex h-11 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13.5px] font-medium transition-colors lg:h-10',
                    on ? 'bg-ink text-on-ink' : 'bg-well text-ink-2 hover:bg-ink/10 hover:text-ink',
                  )}
                >
                  <Icon name={option.icon} size={15} />
                  {option.label}
                </button>
              );
            })}
          </div>

          {kind === 'link' && (
            <Field label="Link" htmlFor={`${id}-url`} error={linkWarning || undefined}>
              <Input
                id={`${id}-url`}
                aria-label="Link or text"
                inputMode="url"
                enterKeyHint="done"
                autoComplete="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Paste or type a link"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onBlur={() => url.trim() && setUrl(normalizeLink(url))}
              />
            </Field>
          )}
          {kind === 'text' && (
            <Field label="Text" htmlFor={`${id}-text`} hint="Shown as plain text when scanned.">
              <Textarea
                id={`${id}-text`}
                rows={4}
                maxLength={1000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Anything up to about 1,000 letters"
              />
            </Field>
          )}
          {kind === 'wifi' && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Network name" htmlFor={`${id}-ssid`}>
                  <Input
                    id={`${id}-ssid`}
                    autoComplete="off"
                    placeholder="Guest-WiFi"
                    value={wifi.ssid}
                    onChange={(event) => setWifi({ ...wifi, ssid: event.target.value })}
                  />
                </Field>
                <Field label="Password" htmlFor={`${id}-pass`}>
                  <Input
                    id={`${id}-pass`}
                    autoComplete="off"
                    disabled={wifi.security === 'nopass'}
                    placeholder={wifi.security === 'nopass' ? 'No password' : ''}
                    value={wifi.password}
                    onChange={(event) => setWifi({ ...wifi, password: event.target.value })}
                  />
                </Field>
              </div>
              <Choice
                label="Security"
                value={wifi.security}
                onChange={(security) => setWifi({ ...wifi, security })}
                options={[
                  { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
                  { value: 'WEP', label: 'WEP' },
                  { value: 'nopass', label: 'Open' },
                ]}
              />
              <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
                <input
                  type="checkbox"
                  checked={wifi.hidden}
                  onChange={(event) => setWifi({ ...wifi, hidden: event.target.checked })}
                  className="size-4 accent-[var(--color-ink)]"
                />
                The network is hidden
              </label>
              <p className="text-[12.5px] text-muted">
                Guests point their camera and join. Anyone who can see the code can join.
              </p>
            </div>
          )}
          {kind === 'contact' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['first', 'First name', 'Rosa', 'given-name'],
                  ['last', 'Last name', 'Delgado', 'family-name'],
                  ['org', 'Company', 'Salt & Ember', 'organization'],
                  ['title', 'Job title', 'Owner', 'organization-title'],
                  ['phone', 'Phone', '+1 555 010 0199', 'tel'],
                  ['email', 'Email', 'rosa@saltandember.example', 'email'],
                  ['url', 'Website', 'saltandember.example', 'url'],
                ] as const
              ).map(([key, label, placeholder, autoComplete]) => (
                <Field key={key} label={label} htmlFor={`${id}-c-${key}`}>
                  <Input
                    id={`${id}-c-${key}`}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    inputMode={
                      key === 'phone'
                        ? 'tel'
                        : key === 'email'
                          ? 'email'
                          : key === 'url'
                            ? 'url'
                            : undefined
                    }
                    value={contact[key]}
                    onChange={(event) => setContact({ ...contact, [key]: event.target.value })}
                  />
                </Field>
              ))}
              <Field label="Note" htmlFor={`${id}-c-note`} optional className="sm:col-span-2">
                <Input
                  id={`${id}-c-note`}
                  value={contact.note}
                  onChange={(event) => setContact({ ...contact, note: event.target.value })}
                />
              </Field>
              <p className="text-[12.5px] text-muted sm:col-span-2">
                Scanning offers to save you as a contact. Fill in only what people need.
              </p>
            </div>
          )}
          {kind === 'phone' && (
            <Field
              label="Phone number"
              htmlFor={`${id}-phone`}
              hint="Include the country code for people abroad."
            >
              <Input
                id={`${id}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+1 555 010 0199"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </Field>
          )}
          {kind === 'sms' && (
            <div className="grid gap-3">
              <Field label="Send to" htmlFor={`${id}-sms-to`}>
                <Input
                  id={`${id}-sms-to`}
                  type="tel"
                  inputMode="tel"
                  placeholder="+1 555 010 0199"
                  value={sms.number}
                  onChange={(event) => setSms({ ...sms, number: event.target.value })}
                />
              </Field>
              <Field
                label="Message"
                htmlFor={`${id}-sms-body`}
                optional
                hint="Filled in, ready to send."
              >
                <Textarea
                  id={`${id}-sms-body`}
                  rows={3}
                  maxLength={300}
                  placeholder="Table for 4 tonight at 7?"
                  value={sms.message}
                  onChange={(event) => setSms({ ...sms, message: event.target.value })}
                />
              </Field>
            </div>
          )}
          {kind === 'email' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email address" htmlFor={`${id}-mail-to`}>
                <Input
                  id={`${id}-mail-to`}
                  type="email"
                  inputMode="email"
                  placeholder="hello@yourshop.example"
                  value={email.to}
                  onChange={(event) => setEmail({ ...email, to: event.target.value })}
                />
              </Field>
              <Field label="Subject" htmlFor={`${id}-mail-subject`} optional>
                <Input
                  id={`${id}-mail-subject`}
                  placeholder="Catering inquiry"
                  value={email.subject}
                  onChange={(event) => setEmail({ ...email, subject: event.target.value })}
                />
              </Field>
              <Field label="Message" htmlFor={`${id}-mail-body`} optional className="sm:col-span-2">
                <Textarea
                  id={`${id}-mail-body`}
                  rows={3}
                  value={email.body}
                  onChange={(event) => setEmail({ ...email, body: event.target.value })}
                />
              </Field>
            </div>
          )}
        </section>
      </Surface>

      {/* The code: right under the box on phones, so it draws as you type; beside it on desktops. */}
      <div className="grid content-start gap-4 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <Surface className="!p-4 sm:!p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink-2">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  code.state === 'ready'
                    ? risks.length
                      ? 'bg-caution'
                      : 'bg-positive'
                    : 'bg-faint',
                )}
              />
              {code.state === 'ready'
                ? risks.length
                  ? 'Check before printing'
                  : 'Ready to scan'
                : 'Preview'}
            </span>
          </div>
          <div
            className="mx-auto w-full max-w-[250px] rounded-[20px] p-3 shadow-lift transition-colors duration-300 sm:max-w-[320px] sm:p-4"
            style={{
              background:
                look.bg ||
                'repeating-conic-gradient(#e7e4dc 0% 25%, #ffffff 0% 50%) 50% / 16px 16px',
            }}
          >
            {drawn ? (
              <svg
                viewBox={`0 0 ${drawn.total} ${drawn.total + band}`}
                className="block h-auto w-full animate-fade"
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
              // Short on phones while empty, so the box above stays the focus.
              <div className="grid aspect-[2/1] place-items-center px-4 text-center text-[13.5px] text-[#6c685e] sm:aspect-square">
                <span>
                  <Icon name="qr" size={32} className="mx-auto mb-2 text-[#a19c91] sm:mb-3" />
                  {code.state === 'too-long'
                    ? 'That’s too much for one code. Try something shorter.'
                    : 'Your code appears here as you type.'}
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5">
            <button
              type="button"
              disabled={!drawn}
              onClick={downloadPng}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-ink px-4 text-[15px] font-semibold text-on-ink disabled:opacity-40 lg:h-10 lg:text-[14px]"
            >
              <Icon name="download" size={16} /> PNG
            </button>
            <button
              type="button"
              disabled={!drawn}
              onClick={downloadSvg}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-well px-4 text-[15px] font-medium text-ink-2 hover:bg-ink/10 disabled:opacity-40 lg:h-10 lg:text-[14px]"
            >
              <Icon name="download" size={16} /> SVG
            </button>
          </div>
          <p role="status" className="mt-2 min-h-5 text-center text-[12.5px] text-muted">
            {message}
          </p>
          {drawn && risks.length > 0 && (
            <div className="mt-1 grid gap-1.5">
              {risks.map((risk) => (
                <Note key={risk} icon="alert" tone="caution">
                  {risk}
                </Note>
              ))}
            </div>
          )}
          {drawn && risks.length === 0 && (
            <p className="mt-1 text-center text-[12px] text-muted">
              Scan it once with your phone before you print a stack.
            </p>
          )}
        </Surface>
      </div>

      {/* Styling is optional: good defaults, tucked away until someone wants to play. */}
      <Surface className="grid content-start !py-1 lg:col-start-1 lg:row-start-2 lg:self-start">
        <details className="group/look">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 text-[15px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <span
              aria-hidden="true"
              className="grid size-8 shrink-0 place-items-center rounded-[9px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.14)]"
              style={{
                background:
                  look.bg ||
                  'repeating-conic-gradient(#e7e4dc 0% 25%, #ffffff 0% 50%) 50% / 8px 8px',
              }}
            >
              <span className="size-3.5 rounded-[3px]" style={{ background: look.fg }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block">Customize</span>
              <span className="block truncate text-[12.5px] font-normal text-muted">
                Colors, dot style, logo and a caption
              </span>
            </span>
            <Icon
              name="chevron-right"
              size={16}
              className="shrink-0 text-muted transition-transform group-open/look:rotate-90"
            />
          </summary>
          <section aria-label="Look" className="grid gap-4 pt-2 pb-5">
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((preset) => {
                const on =
                  look.fg === preset.fg && look.bg === preset.bg && look.corners === preset.corners;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${preset.name} colors`}
                    title={preset.name}
                    onClick={() => setColors(preset.fg, preset.bg, preset.corners)}
                    className={cn(
                      'grid size-11 place-items-center rounded-[12px] shadow-[inset_0_0_0_1px_rgb(0_0_0/.12)] transition-transform hover:scale-105 lg:size-10',
                      on && 'ring-2 ring-signal ring-offset-2 ring-offset-[var(--color-surface)]',
                    )}
                    style={{ background: preset.bg }}
                  >
                    <span
                      className="grid size-5 place-items-center rounded-[5px]"
                      style={{ background: preset.fg }}
                    >
                      {preset.corners && (
                        <span
                          className="size-2 rounded-[2px]"
                          style={{ background: preset.corners }}
                        />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
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
                    <span className="block text-muted">{name}</span>
                    <span className="mono-num block text-[10.5px] text-ink-2">
                      {key === 'bg' && !look.bg
                        ? 'None'
                        : key === 'corners' && !look.corners
                          ? 'Same'
                          : look[key]}
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2 px-1 text-[12.5px] text-ink-2">
                <input
                  type="checkbox"
                  checked={!look.bg}
                  onChange={(event) =>
                    setLook({ ...look, bg: event.target.checked ? '' : '#ffffff' })
                  }
                  className="size-4 accent-[var(--color-ink)]"
                />
                Transparent
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <span className="text-[13px] font-medium text-ink-2">Dots</span>
                <Choice
                  label="Dot style"
                  value={look.dot}
                  onChange={(dot) => setLook({ ...look, dot })}
                  options={DOTS}
                  render={(dot) => <StyleSample dot={dot} />}
                />
              </div>
              <div className="grid gap-2">
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
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  id={`${id}-logo`}
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
                  htmlFor={`${id}-logo`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-[11px] bg-well px-3 text-[13.5px] font-medium text-ink-2 hover:bg-ink/10 hover:text-ink"
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
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-ink-2">
                    <input
                      type="checkbox"
                      checked={logo.plate}
                      onChange={(event) => setLogo({ ...logo, plate: event.target.checked })}
                      className="size-4 accent-[var(--color-ink)]"
                    />
                    Plate behind it
                  </label>
                </div>
              )}
            </div>

            <Field
              label="Caption under the code"
              htmlFor={`${id}-caption`}
              optional
              hint="Printed with the code, so people know what they’re scanning."
            >
              <Input
                id={`${id}-caption`}
                value={caption}
                maxLength={32}
                placeholder={CAPTIONS[kind]?.[0] ?? 'Scan me'}
                onChange={(event) => setCaption(event.target.value)}
              />
            </Field>
            <div className="-mt-1 flex flex-wrap gap-1.5">
              {(CAPTIONS[kind] ?? ['Scan me']).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  aria-pressed={caption === suggestion}
                  onClick={() => setCaption(caption === suggestion ? '' : suggestion)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[12.5px] transition-colors',
                    caption === suggestion
                      ? 'bg-ink text-on-ink'
                      : 'bg-well text-ink-2 hover:bg-ink/10',
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </section>
        </details>

        <details className="group/print border-t border-line">
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-[13.5px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon
              name="chevron-right"
              size={15}
              className="text-muted transition-transform group-open/print:rotate-90"
            />
            Print settings
            <span className="ml-auto text-[12px] font-normal text-muted">
              {size}px · border {look.margin}
            </span>
          </summary>
          <div className="pb-5">
            <div className="grid gap-4 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Sturdiness"
                  htmlFor={`${id}-level`}
                  hint={
                    logo
                      ? 'Highest while there’s a logo.'
                      : 'Sturdier codes survive scuffs, with more dots.'
                  }
                >
                  <Select
                    id={`${id}-level`}
                    value={level}
                    disabled={Boolean(logo)}
                    onChange={(event) => setChosenLevel(event.target.value as QrLevel)}
                  >
                    {LEVELS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="PNG size" htmlFor={`${id}-size`}>
                  <Select
                    id={`${id}-size`}
                    value={size}
                    onChange={(event) => setSize(Number(event.target.value))}
                  >
                    {SIZES.map((option) => (
                      <option key={option} value={option}>
                        {option} px wide
                      </option>
                    ))}
                  </Select>
                </Field>
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
                htmlFor={`${id}-margin`}
              >
                <input
                  id={`${id}-margin`}
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={look.margin}
                  onChange={(event) => setLook({ ...look, margin: Number(event.target.value) })}
                  className="w-full"
                />
              </Field>
            </div>
          </div>
        </details>
      </Surface>
    </div>
  );
}
