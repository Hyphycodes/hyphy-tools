'use client';
import { useId, useMemo, useState, useTransition } from 'react';
import { saveQrCode } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Segmented, Select, Textarea } from '@/components/ui/form';
import { Icon, type IconName } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import {
  captionBand,
  kindOf,
  parseWifi,
  qrMatrix,
  qrPath,
  qrSvg,
  wifiPayload,
  type QrKind,
  type QrLevel,
  type WifiDetails,
} from '@/lib/tools/qr';

/*
 * QR Codes, ported from Hyphy Studio's free tool (src/components/tools/qr-tool.tsx): the same
 * encoder, contrast check, sharp PNG renderer and SVG export. New here: codes for Wi-Fi and
 * email as well as links, a printed caption, and saving a code to the Space so the whole team
 * can find it again.
 */

const LEVELS: { value: QrLevel; label: string }[] = [
  { value: 'L', label: 'Low (7%)' },
  { value: 'M', label: 'Medium (15%)' },
  { value: 'Q', label: 'Quartile (25%)' },
  { value: 'H', label: 'High (30%)' },
];
const SIZES = [512, 1024, 2048];
const DEFAULT_FG = '#0f0f0e';
const DEFAULT_BG = '#ffffff';
const MAX_LENGTH = 1000;
const PRESETS = [
  { fg: '#0f0f0e', bg: '#ffffff', name: 'Ink' },
  { fg: '#3240ff', bg: '#ffffff', name: 'Signal' },
  { fg: '#2a120e', bg: '#fff7ef', name: 'Espresso' },
  { fg: '#e0492f', bg: '#ffffff', name: 'Ember' },
  { fg: '#ffffff', bg: '#16150f', name: 'Night' },
];
const KINDS: { value: QrKind; label: string; icon: IconName }[] = [
  { value: 'link', label: 'Link', icon: 'link' },
  { value: 'wifi', label: 'Wi-Fi', icon: 'wifi' },
  { value: 'email', label: 'Email', icon: 'mail' },
  { value: 'text', label: 'Text', icon: 'file-text' },
];
const CAPTIONS: Record<QrKind, string[]> = {
  link: ['Scan for the menu', 'Scan to book', 'Scan me'],
  wifi: ['Scan to join our Wi-Fi', 'Guest Wi-Fi'],
  email: ['Scan to email us'],
  text: ['Scan me'],
};

type Code = { state: 'empty' } | { state: 'too-long' } | { state: 'ready'; matrix: boolean[][] };

/** WCAG relative luminance of a #rrggbb color. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function slug(text: string) {
  const clean = (value: string) => value.replace(/^-+|-+$/g, '');
  const base = text
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:(\/\/)?(www\.)?/, '')
    .replace(/[^a-z0-9]+/g, '-');
  return clean(clean(base).slice(0, 40)) || 'code';
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Whole-pixel modules, centred, so the PNG stays sharp; a caption adds a band underneath. */
function renderPng(
  matrix: boolean[][],
  {
    size,
    margin,
    fg,
    bg,
    caption,
  }: { size: number; margin: number; fg: string; bg: string; caption: string },
) {
  const count = matrix.length + margin * 2;
  const scale = Math.max(1, Math.floor(size / count));
  const offset = Math.floor((size - count * scale) / 2);
  const band = caption ? Math.round((captionBand(count) / count) * size) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + band;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Canvas unavailable'));
  context.imageSmoothingEnabled = false;
  context.fillStyle = bg;
  context.fillRect(0, 0, size, size + band);
  context.fillStyle = fg;
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      context.fillRect(
        offset + (start + margin) * scale,
        offset + (y + margin) * scale,
        (x - start) * scale,
        scale,
      );
    }
  });
  if (caption) {
    const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
    context.font = `600 ${Math.round(size * 0.07)}px ${family}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(caption, size / 2, size + band * 0.42, size * 0.9);
  }
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG failed'))), 'image/png'),
  );
}

export function QrTool({
  slug: spaceSlug,
  initial,
  canSave,
  spaceName,
}: {
  slug: string;
  initial?: { content: string; fg: string; bg: string; label: string; placement?: string };
  canSave: boolean;
  spaceName: string;
}) {
  const id = useId();
  const toast = useToast();
  const start = (initial?.content ?? '').slice(0, MAX_LENGTH);
  const [kind, setKind] = useState<QrKind>(() => kindOf(start));
  const [text, setText] = useState(() =>
    kindOf(start) === 'link' || kindOf(start) === 'text' ? start : '',
  );
  const [wifi, setWifi] = useState<WifiDetails>(
    () => parseWifi(start) ?? { ssid: '', password: '', security: 'WPA', hidden: false },
  );
  const [email, setEmail] = useState(() =>
    start.startsWith('mailto:') ? decodeURIComponent(start.slice(7).split('?')[0]) : '',
  );
  const [subject, setSubject] = useState(() => {
    const match = start.match(/[?&]subject=([^&]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  });
  const [caption, setCaption] = useState('');
  const [level, setLevel] = useState<QrLevel>('M');
  const [fg, setFg] = useState(initial?.fg.toLowerCase() ?? DEFAULT_FG);
  const [bg, setBg] = useState(initial?.bg.toLowerCase() ?? DEFAULT_BG);
  const [margin, setMargin] = useState(4);
  const [size, setSize] = useState(1024);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [placement, setPlacement] = useState(initial?.placement ?? '');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  const value = (
    kind === 'wifi'
      ? wifiPayload(wifi)
      : kind === 'email'
        ? email.trim()
          ? `mailto:${email.trim()}${subject.trim() ? `?subject=${encodeURIComponent(subject.trim())}` : ''}`
          : ''
        : text
  ).trim();
  const code = useMemo<Code>(() => {
    if (!value) return { state: 'empty' };
    try {
      return { state: 'ready', matrix: qrMatrix(value, level) };
    } catch {
      return { state: 'too-long' };
    }
  }, [value, level]);
  const path = useMemo(
    () => (code.state === 'ready' ? qrPath(code.matrix, margin) : ''),
    [code, margin],
  );

  const light = luminance(bg);
  const dark = luminance(fg);
  const contrast = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  const risky = contrast < 4 || dark > light;
  const modules = code.state === 'ready' ? code.matrix.length : 0;
  const total = modules + margin * 2;
  const band = caption && total ? captionBand(total) : 0;
  const fileBase = `qr-${slug(kind === 'wifi' ? `wifi-${wifi.ssid}` : label || value)}`;
  const touched = () => {
    setMessage('');
    setSaved(false);
  };

  const downloadSvg = () => {
    if (code.state !== 'ready') return;
    const name = `${fileBase}.svg`;
    save(
      new Blob([qrSvg(value, { fg, bg, margin, level, caption })], { type: 'image/svg+xml' }),
      name,
    );
    setMessage(`Downloaded ${name}. Print it at any size.`);
  };
  const downloadPng = async () => {
    if (code.state !== 'ready') return;
    const name = `${fileBase}.png`;
    try {
      save(await renderPng(code.matrix, { size, margin, fg, bg, caption }), name);
      setMessage(`Downloaded ${name} · ${size} px wide.`);
    } catch {
      setMessage('This browser couldn’t make the PNG. Download the SVG instead.');
    }
  };
  const saveToSpace = () =>
    startSaving(async () => {
      const name =
        label.trim() ||
        (kind === 'wifi' ? `${wifi.ssid} Wi-Fi` : kind === 'email' ? email : slug(value));
      const result = await saveQrCode(spaceSlug, {
        label: name,
        content: value,
        fg,
        bg,
        placement,
      });
      if (result.ok) setSaved(true);
      toast(
        result.ok
          ? { title: `${name} saved`, description: `Find it under Saved in ${spaceName}` }
          : { title: result.error, icon: 'alert' },
      );
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-6">
      {/* The code, first on phones so it draws as you type. */}
      <div className="order-first grid content-start gap-4 lg:sticky lg:top-6 lg:order-last lg:self-start">
        <div className="rounded-[26px] bg-tool-qr/25 p-4 shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink/70">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  code.state === 'ready' ? 'bg-positive' : 'bg-ink/25',
                )}
              />
              {code.state === 'ready' ? 'Ready to scan' : 'Live preview'}
            </span>
            <span className="mono-num text-[11px] text-ink/50">
              {code.state === 'ready'
                ? `${modules} × ${modules} · v${(modules - 17) / 4} · ${level}`
                : '—'}
            </span>
          </div>
          <div
            className="mx-auto w-full max-w-[230px] rounded-[20px] p-3 shadow-lift transition-colors duration-300 sm:max-w-[300px] sm:p-4"
            style={{ background: bg }}
          >
            {code.state === 'ready' ? (
              <svg
                viewBox={`0 0 ${total} ${total + band}`}
                shapeRendering="crispEdges"
                className="block h-auto w-full animate-fade"
                role="img"
                aria-label={`QR code for ${value.slice(0, 100)}`}
              >
                <rect width={total} height={total + band} fill={bg} />
                <path d={path} fill={fg} className="transition-[fill] duration-300" />
                {caption && (
                  <text
                    x={total / 2}
                    y={total + band * 0.42}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontWeight={600}
                    fontSize={total * 0.07}
                    fill={fg}
                    style={{ fontFamily: 'var(--font-sans)' }}
                  >
                    {caption}
                  </text>
                )}
              </svg>
            ) : (
              <div className="grid aspect-square place-items-center px-4 text-center text-[13.5px] text-muted">
                <span>
                  <Icon name="qr" size={36} className="mx-auto mb-3 text-faint" />
                  {code.state === 'empty'
                    ? kind === 'wifi'
                      ? 'Add the network name. Your code appears here.'
                      : kind === 'email'
                        ? 'Add an email address. Your code appears here.'
                        : 'Paste a link. Your code appears here.'
                    : 'That’s too long for one code. Shorten it or lower the error correction.'}
                </span>
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-5">
            <Button variant="primary" disabled={code.state !== 'ready'} onClick={downloadPng}>
              <Icon name="download" size={16} /> PNG
            </Button>
            <Button disabled={code.state !== 'ready'} onClick={downloadSvg}>
              <Icon name="download" size={16} /> SVG
            </Button>
          </div>
          <p role="status" className="mt-2 min-h-5 text-center text-[12.5px] text-ink/60">
            {message}
          </p>

          {canSave && (
            <div className="mt-2 border-t border-ink/10 pt-4">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Input
                  id={`${id}-label`}
                  aria-label="Name"
                  value={label}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    touched();
                  }}
                  placeholder="Name it — Table tent, menu"
                  className="!bg-white/85"
                />
                <Input
                  id={`${id}-place`}
                  aria-label="Where it goes"
                  value={placement}
                  onChange={(event) => {
                    setPlacement(event.target.value);
                    touched();
                  }}
                  placeholder="Where it goes (optional)"
                  className="!bg-white/85"
                />
              </div>
              <Button
                className="mt-2.5 w-full !bg-white/85 hover:!bg-white"
                disabled={code.state !== 'ready' || saving || saved}
                onClick={saveToSpace}
              >
                <Icon name={saved ? 'check' : 'pin'} size={16} />
                {saving ? 'Saving…' : saved ? `Saved in ${spaceName}` : `Save to ${spaceName}`}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="grid content-start gap-6 rounded-[22px] bg-surface p-5 shadow-card">
        <section aria-labelledby={`${id}-what`} className="grid gap-4">
          <h2 id={`${id}-what`} className="label">
            What it opens
          </h2>
          <Segmented
            name={`${id}-kind`}
            value={kind}
            onChange={(next) => {
              setKind(next);
              touched();
            }}
            options={KINDS.map((option) => ({
              value: option.value,
              label: (
                <span className="flex items-center gap-1.5">
                  <Icon name={option.icon} size={15} className="hidden sm:block" />
                  {option.label}
                </span>
              ),
            }))}
          />
          {(kind === 'link' || kind === 'text') && (
            <Field
              label={
                <span className="flex w-full items-center justify-between">
                  {kind === 'link' ? 'Link' : 'Text'}
                  <span className="mono-num text-[11px] font-normal text-faint">
                    {text.length}/{MAX_LENGTH}
                  </span>
                </span>
              }
              htmlFor={`${id}-text`}
            >
              <Textarea
                id={`${id}-text`}
                aria-label={kind === 'link' ? 'Link or text' : 'Text'}
                rows={kind === 'link' ? 2 : 4}
                value={text}
                maxLength={MAX_LENGTH}
                placeholder={kind === 'link' ? 'https://' : 'Anything up to about 1,000 letters'}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onChange={(event) => {
                  setText(event.target.value);
                  touched();
                }}
              />
            </Field>
          )}
          {kind === 'wifi' && (
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Network name" htmlFor={`${id}-ssid`}>
                  <Input
                    id={`${id}-ssid`}
                    value={wifi.ssid}
                    autoComplete="off"
                    placeholder="Guest-WiFi"
                    onChange={(event) => {
                      setWifi({ ...wifi, ssid: event.target.value });
                      touched();
                    }}
                  />
                </Field>
                <Field label="Password" htmlFor={`${id}-pass`}>
                  <Input
                    id={`${id}-pass`}
                    value={wifi.password}
                    autoComplete="off"
                    disabled={wifi.security === 'nopass'}
                    placeholder={wifi.security === 'nopass' ? 'No password' : ''}
                    onChange={(event) => {
                      setWifi({ ...wifi, password: event.target.value });
                      touched();
                    }}
                  />
                </Field>
              </div>
              <Segmented
                name={`${id}-security`}
                value={wifi.security}
                onChange={(security) => {
                  setWifi({ ...wifi, security });
                  touched();
                }}
                options={[
                  { value: 'WPA', label: 'WPA / WPA2' },
                  { value: 'WEP', label: 'WEP' },
                  { value: 'nopass', label: 'Open' },
                ]}
              />
              <p className="text-[12.5px] text-muted">
                Guests point their camera and join — no typing the password.
              </p>
            </div>
          )}
          {kind === 'email' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email address" htmlFor={`${id}-email`}>
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={email}
                  placeholder="hello@yourbusiness.example"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    touched();
                  }}
                />
              </Field>
              <Field label="Subject" htmlFor={`${id}-subject`} optional>
                <Input
                  id={`${id}-subject`}
                  value={subject}
                  placeholder="Catering inquiry"
                  onChange={(event) => {
                    setSubject(event.target.value);
                    touched();
                  }}
                />
              </Field>
            </div>
          )}
        </section>

        <section aria-labelledby={`${id}-look`} className="grid gap-4 border-t border-line pt-5">
          <div className="flex items-center justify-between">
            <h2 id={`${id}-look`} className="label">
              Look
            </h2>
            <span className={cn('mono-num text-[11px]', risky ? 'text-caution' : 'text-faint')}>
              Contrast {contrast.toFixed(1)}:1
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.fg + preset.bg}
                type="button"
                aria-label={`${preset.name}: ${preset.fg} on ${preset.bg}`}
                title={preset.name}
                onClick={() => {
                  setFg(preset.fg);
                  setBg(preset.bg);
                  touched();
                }}
                className={cn(
                  'grid size-10 place-items-center rounded-[11px] shadow-[inset_0_0_0_1px_var(--color-line-strong)] transition-transform hover:scale-105',
                  fg === preset.fg && bg === preset.bg && 'ring-2 ring-signal ring-offset-2',
                )}
                style={{ background: preset.bg }}
              >
                <span className="size-4 rounded-[4px]" style={{ background: preset.fg }} />
              </button>
            ))}
            <span className="mx-1 h-6 w-px bg-line" />
            {[
              { key: 'fg', name: 'Code', value: fg, set: setFg },
              { key: 'bg', name: 'Background', value: bg, set: setBg },
            ].map((swatch) => (
              <label
                key={swatch.key}
                className="flex items-center gap-2 rounded-[11px] bg-subtle py-1.5 pr-3 pl-1.5 text-[12.5px] shadow-[inset_0_0_0_1px_var(--color-line)]"
              >
                <input
                  type="color"
                  value={swatch.value}
                  onChange={(event) => {
                    swatch.set(event.target.value);
                    touched();
                  }}
                  className="size-7 cursor-pointer rounded-[7px] border-0 bg-transparent p-0"
                  aria-label={`${swatch.name} color`}
                />
                <span>
                  <span className="block text-muted">{swatch.name}</span>
                  <span className="mono-num block text-[10.5px]">{swatch.value}</span>
                </span>
              </label>
            ))}
          </div>
          {risky && (
            <p
              role="status"
              className="flex items-center gap-2 rounded-[10px] bg-caution-soft px-3 py-2 text-[13px] text-caution"
            >
              <Icon name="alert" size={15} />
              Low contrast — some phones may not scan this.
              <button
                type="button"
                className="ml-auto font-medium underline"
                onClick={() => {
                  setFg(DEFAULT_FG);
                  setBg(DEFAULT_BG);
                }}
              >
                Reset
              </button>
            </p>
          )}
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
              placeholder={CAPTIONS[kind][0]}
              onChange={(event) => {
                setCaption(event.target.value);
                touched();
              }}
            />
          </Field>
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {CAPTIONS[kind].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setCaption(caption === suggestion ? '' : suggestion)}
                aria-pressed={caption === suggestion}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[12.5px] transition-colors',
                  caption === suggestion
                    ? 'bg-ink text-white'
                    : 'bg-well text-ink-2 hover:bg-ink/10',
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>

        <details className="group border-t border-line pt-4">
          <summary className="flex list-none items-center gap-2 text-[13.5px] font-medium text-ink-2 [&::-webkit-details-marker]:hidden">
            <Icon
              name="chevron-right"
              size={15}
              className="text-muted transition-transform group-open:rotate-90"
            />
            Print settings
            <span className="ml-auto text-[12px] font-normal text-faint">
              {level} · {size}px · margin {margin}
            </span>
          </summary>
          <div className="mt-4 grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Error correction"
                htmlFor={`${id}-level`}
                hint="Higher survives scuffs, but is denser."
              >
                <Select
                  id={`${id}-level`}
                  value={level}
                  onChange={(event) => setLevel(event.target.value as QrLevel)}
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
                  Quiet zone
                  <span className="mono-num text-[11px] font-normal text-faint">
                    {margin} modules
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
                value={margin}
                onChange={(event) => setMargin(Number(event.target.value))}
                className="w-full"
              />
            </Field>
          </div>
        </details>
      </div>
    </div>
  );
}
