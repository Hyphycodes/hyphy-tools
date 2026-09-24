'use client';
import { useId, useMemo, useState, useTransition } from 'react';
import { saveQrCode } from '@/app/(app)/[space]/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { qrMatrix, qrPath, qrSvg, type QrLevel } from '@/lib/tools/qr';

/*
 * QR Codes, ported from Hyphy Studio's free tool (src/components/tools/qr-tool.tsx): the same
 * encoder, contrast check, sharp PNG renderer and SVG export. New here: saving a code to the
 * Space so the whole team can find it again.
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
  { fg: '#0f0f0e', bg: '#ffffff' },
  { fg: '#3240ff', bg: '#ffffff' },
  { fg: '#2a120e', bg: '#fff7ef' },
  { fg: '#e0492f', bg: '#ffffff' },
  { fg: '#ffffff', bg: '#16150f' },
];

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
    .replace(/^[a-z][a-z0-9+.-]*:\/\/(www\.)?/, '')
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

/** Whole-pixel modules, centred, so the PNG stays sharp at exactly `size` × `size`. */
function renderPng(
  matrix: boolean[][],
  { size, margin, fg, bg }: { size: number; margin: number; fg: string; bg: string },
) {
  const count = matrix.length + margin * 2;
  const scale = Math.max(1, Math.floor(size / count));
  const offset = Math.floor((size - count * scale) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Canvas unavailable'));
  context.imageSmoothingEnabled = false;
  context.fillStyle = bg;
  context.fillRect(0, 0, size, size);
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
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG failed'))), 'image/png'),
  );
}

export function QrTool({
  slug: spaceSlug,
  initial,
  canSave,
}: {
  slug: string;
  initial?: { content: string; fg: string; bg: string; label: string };
  canSave: boolean;
}) {
  const id = useId();
  const toast = useToast();
  const [text, setText] = useState(() => (initial?.content ?? '').slice(0, MAX_LENGTH));
  const [level, setLevel] = useState<QrLevel>('M');
  const [fg, setFg] = useState(initial?.fg.toLowerCase() ?? DEFAULT_FG);
  const [bg, setBg] = useState(initial?.bg.toLowerCase() ?? DEFAULT_BG);
  const [margin, setMargin] = useState(4);
  const [size, setSize] = useState(1024);
  const [label, setLabel] = useState(initial?.label ?? '');
  const [placement, setPlacement] = useState('');
  const [message, setMessage] = useState('');
  const [saving, startSaving] = useTransition();

  const value = text.trim();
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

  const downloadSvg = () => {
    if (code.state !== 'ready') return;
    const name = `qr-${slug(value)}.svg`;
    save(new Blob([qrSvg(value, { fg, bg, margin, level })], { type: 'image/svg+xml' }), name);
    setMessage(`Saved ${name}.`);
  };
  const downloadPng = async () => {
    if (code.state !== 'ready') return;
    const name = `qr-${slug(value)}.png`;
    try {
      save(await renderPng(code.matrix, { size, margin, fg, bg }), name);
      setMessage(`Saved ${name} · ${size} × ${size} px.`);
    } catch {
      setMessage('This browser couldn’t make the PNG. Download the SVG instead.');
    }
  };
  const saveToSpace = () =>
    startSaving(async () => {
      const result = await saveQrCode(spaceSlug, {
        label: label || slug(value),
        content: value,
        fg,
        bg,
        placement,
      });
      toast(
        result.ok
          ? { title: `${label || 'Code'} saved`, description: result.message }
          : { title: result.error, icon: 'alert' },
      );
    });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-5 rounded-[20px] bg-surface p-5 shadow-card">
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              Link or text
              <span className="mono-num text-[11px] font-normal text-faint">
                {text.length}/{MAX_LENGTH}
              </span>
            </span>
          }
          htmlFor={`${id}-text`}
        >
          <Textarea
            id={`${id}-text`}
            rows={3}
            value={text}
            maxLength={MAX_LENGTH}
            placeholder="https://"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            onChange={(event) => {
              setText(event.target.value);
              setMessage('');
            }}
          />
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13.5px] font-medium text-ink-2">Colors</p>
            <span className={cn('mono-num text-[11px]', risky ? 'text-caution' : 'text-faint')}>
              Contrast {contrast.toFixed(1)}:1
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.fg + preset.bg}
                type="button"
                aria-label={`Code ${preset.fg} on ${preset.bg}`}
                onClick={() => {
                  setFg(preset.fg);
                  setBg(preset.bg);
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
                  onChange={(event) => swatch.set(event.target.value)}
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
              className="mt-2 flex items-center gap-2 rounded-[10px] bg-caution-soft px-3 py-2 text-[13px] text-caution"
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
        </div>

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
                  {option} × {option} px
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={
            <span className="flex w-full items-center justify-between">
              Quiet zone
              <span className="mono-num text-[11px] font-normal text-faint">{margin} modules</span>
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

      <div className="grid content-start gap-4">
        <div className="rounded-[24px] bg-tool-qr/25 p-5 shadow-[inset_0_0_0_1px_rgb(0_0_0/.04)] sm:p-7">
          <div className="mb-4 flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12.5px] font-medium text-ink/70">
              <span className="size-1.5 rounded-full bg-positive" /> Live preview
            </span>
            <span className="mono-num text-[11px] text-ink/50">
              {code.state === 'ready'
                ? `${modules} × ${modules} · v${(modules - 17) / 4} · ${level}`
                : '—'}
            </span>
          </div>
          <div className="mx-auto aspect-square w-full max-w-[320px] rounded-[18px] bg-white p-4 shadow-lift">
            {code.state === 'ready' ? (
              <svg
                viewBox={`0 0 ${total} ${total}`}
                shapeRendering="crispEdges"
                className="block h-full w-full"
                role="img"
                aria-label={`QR code for ${value.slice(0, 100)}`}
              >
                <rect width={total} height={total} fill={bg} />
                <path d={path} fill={fg} />
              </svg>
            ) : (
              <div className="grid h-full place-items-center text-center text-[14px] text-muted">
                <span>
                  <Icon name="qr" size={40} className="mx-auto mb-3 text-faint" />
                  {code.state === 'empty'
                    ? 'Paste a link. Your code appears here.'
                    : 'That’s too long for one code. Shorten it or lower the error correction.'}
                </span>
              </div>
            )}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
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
        </div>

        {canSave && (
          <div className="rounded-[20px] bg-surface p-5 shadow-card">
            <p className="text-[14px] font-semibold">Save to this Space</p>
            <p className="mt-0.5 text-[13px] text-muted">
              So you (and your team) can find it and reprint it later.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Name" htmlFor={`${id}-label`}>
                <Input
                  id={`${id}-label`}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Table tent — menu"
                />
              </Field>
              <Field label="Where it goes" htmlFor={`${id}-place`} optional>
                <Input
                  id={`${id}-place`}
                  value={placement}
                  onChange={(event) => setPlacement(event.target.value)}
                  placeholder="Every table"
                />
              </Field>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={code.state !== 'ready' || saving}
              onClick={saveToSpace}
            >
              <Icon name="pin" size={16} /> {saving ? 'Saving…' : 'Save code'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
