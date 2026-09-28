/*
 * Styled QR codes that still scan. The code's modules become shapes (squares, soft squares, dots
 * or bars), its three corner "finders" keep their proportions whatever their style, and a logo
 * only ever covers the middle, over a plate, with the strongest error correction behind it.
 * One list of shapes renders both the SVG and the PNG, so the two downloads always match.
 */

export type DotStyle = 'square' | 'rounded' | 'dots' | 'bars';
export type CornerStyle = 'square' | 'rounded' | 'circle';

export type QrLook = {
  dot: DotStyle;
  corner: CornerStyle;
  fg: string;
  /** '' means transparent. */
  bg: string;
  /** The finders' color; defaults to the code's. */
  corners: string;
  /** Quiet zone, in modules. */
  margin: number;
};

export type QrLogo = {
  /** A PNG data URL (logos are always re-drawn as PNG before they're used). */
  src: string;
  /** Share of the code's width, 0.12–0.24. */
  size: number;
  /** A plate behind the logo, in the background color. */
  plate: boolean;
};

export type Shape =
  | { type: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { type: 'ring'; x: number; y: number; size: number; r: number; width: number; stroke: string }
  | { type: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { type: 'image'; x: number; y: number; size: number; href: string };

export const LOGO_MAX = 0.24;
export const LOGO_MIN = 0.12;

/** WCAG relative luminance of #rrggbb. */
export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string, bg: string) {
  const a = luminance(fg);
  const b = luminance(bg || '#ffffff');
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * What could stop this code from scanning, in plain words. Empty means nothing we know of.
 * Conservative on purpose: printing a code that doesn't scan is worse than a plainer one.
 */
export function scanRisks(look: QrLook, logo: QrLogo | null) {
  const risks: string[] = [];
  const background = look.bg || '#ffffff';
  const ratio = contrast(look.fg, background);
  if (ratio < 4)
    risks.push(
      'Low contrast: some phones won’t read it. Darken the code or lighten the background.',
    );
  if (luminance(look.fg) > luminance(background))
    risks.push('Light code on a dark background: many scanners expect dark on light.');
  if (look.corners && contrast(look.corners, background) < 3)
    risks.push('The corner squares are too faint: phones find the code by them.');
  if (look.margin < 2)
    risks.push('A thin border: give the code more space around it so phones can find it.');
  if (!look.bg) risks.push('Transparent background: only print it on something plain and light.');
  if (logo && logo.size > LOGO_MAX) risks.push('The logo is too big to scan reliably.');
  return risks;
}

const isFinder = (row: number, col: number, n: number) =>
  (row < 7 && col < 7) || (row < 7 && col >= n - 7) || (row >= n - 7 && col < 7);

/** The square in the middle a logo takes, in modules (with a module of plate around it). */
export function logoArea(n: number, size: number) {
  let side = Math.ceil(n * Math.min(Math.max(size, LOGO_MIN), LOGO_MAX));
  if ((n - side) % 2) side += 1;
  const start = (n - side) / 2;
  return { start, side };
}

/** Every mark in the code, in module units, including the quiet zone. */
export function qrShapes(matrix: boolean[][], look: QrLook, logo: QrLogo | null) {
  const n = matrix.length;
  const m = look.margin;
  const shapes: Shape[] = [];
  const cleared = logo ? logoArea(n, logo.size) : null;
  const covered = (row: number, col: number) =>
    cleared !== null &&
    row >= cleared.start &&
    row < cleared.start + cleared.side &&
    col >= cleared.start &&
    col < cleared.start + cleared.side;
  const dark = (row: number, col: number) =>
    row >= 0 &&
    col >= 0 &&
    row < n &&
    col < n &&
    matrix[row][col] &&
    !isFinder(row, col, n) &&
    !covered(row, col);

  if (look.dot === 'square') {
    for (let row = 0; row < n; row += 1) {
      let col = 0;
      while (col < n) {
        if (!dark(row, col)) {
          col += 1;
          continue;
        }
        const start = col;
        while (col < n && dark(row, col)) col += 1;
        shapes.push({
          type: 'rect',
          x: m + start,
          y: m + row,
          w: col - start,
          h: 1,
          r: 0,
          fill: look.fg,
        });
      }
    }
  } else if (look.dot === 'bars') {
    for (let col = 0; col < n; col += 1) {
      let row = 0;
      while (row < n) {
        if (!dark(row, col)) {
          row += 1;
          continue;
        }
        const start = row;
        while (row < n && dark(row, col)) row += 1;
        shapes.push({
          type: 'rect',
          x: m + col + 0.12,
          y: m + start + 0.06,
          w: 0.76,
          h: row - start - 0.12,
          r: 0.38,
          fill: look.fg,
        });
      }
    }
  } else {
    for (let row = 0; row < n; row += 1)
      for (let col = 0; col < n; col += 1) {
        if (!dark(row, col)) continue;
        if (look.dot === 'dots')
          shapes.push({
            type: 'circle',
            cx: m + col + 0.5,
            cy: m + row + 0.5,
            r: 0.45,
            fill: look.fg,
          });
        else
          shapes.push({
            type: 'rect',
            x: m + col + 0.05,
            y: m + row + 0.05,
            w: 0.9,
            h: 0.9,
            r: 0.3,
            fill: look.fg,
          });
      }
  }

  const finderColor = look.corners || look.fg;
  for (const [row, col] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ]) {
    const x = m + col;
    const y = m + row;
    if (look.corner === 'circle') {
      shapes.push({
        type: 'ring',
        x: x + 0.5,
        y: y + 0.5,
        size: 6,
        r: 3,
        width: 1,
        stroke: finderColor,
      });
      shapes.push({ type: 'circle', cx: x + 3.5, cy: y + 3.5, r: 1.5, fill: finderColor });
    } else {
      const round = look.corner === 'rounded';
      shapes.push({
        type: 'ring',
        x: x + 0.5,
        y: y + 0.5,
        size: 6,
        r: round ? 1.6 : 0,
        width: 1,
        stroke: finderColor,
      });
      shapes.push({
        type: 'rect',
        x: x + 2,
        y: y + 2,
        w: 3,
        h: 3,
        r: round ? 0.9 : 0,
        fill: finderColor,
      });
    }
  }

  if (logo && cleared) {
    const x = m + cleared.start;
    if (logo.plate && look.bg)
      shapes.push({ type: 'rect', x, y: x, w: cleared.side, h: cleared.side, r: 1, fill: look.bg });
    const inset = logo.plate ? 0.6 : 0.2;
    shapes.push({
      type: 'image',
      x: x + inset,
      y: x + inset,
      size: cleared.side - inset * 2,
      href: logo.src,
    });
  }

  return { total: n + m * 2, shapes };
}

/** Height of the caption band under a code, in modules. */
export function captionBand(total: number) {
  return Math.round(total * 0.18);
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const round = (value: number) => Math.round(value * 1000) / 1000;

function roundedRectPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  if (!radius) return `M${round(x)} ${round(y)}h${round(w)}v${round(h)}h${round(-w)}z`;
  return (
    `M${round(x + radius)} ${round(y)}h${round(w - radius * 2)}` +
    `a${round(radius)} ${round(radius)} 0 0 1 ${round(radius)} ${round(radius)}v${round(h - radius * 2)}` +
    `a${round(radius)} ${round(radius)} 0 0 1 ${round(-radius)} ${round(radius)}h${round(-(w - radius * 2))}` +
    `a${round(radius)} ${round(radius)} 0 0 1 ${round(-radius)} ${round(-radius)}v${round(-(h - radius * 2))}` +
    `a${round(radius)} ${round(radius)} 0 0 1 ${round(radius)} ${round(-radius)}z`
  );
}

/** The whole code as an SVG document: vector, for print at any size. */
export function shapesToSvg(
  shapes: Shape[],
  total: number,
  { bg, caption, captionColor }: { bg: string; caption?: string; captionColor: string },
) {
  const band = caption ? captionBand(total) : 0;
  const height = total + band;
  // Same-colored modules share one path: smaller files, crisper edges.
  const paths = new Map<string, string[]>();
  const other: string[] = [];
  for (const shape of shapes) {
    if (shape.type === 'rect') {
      const list = paths.get(shape.fill) ?? [];
      list.push(roundedRectPath(shape.x, shape.y, shape.w, shape.h, shape.r));
      paths.set(shape.fill, list);
    } else if (shape.type === 'circle') {
      const list = paths.get(shape.fill) ?? [];
      const { cx, cy, r } = shape;
      list.push(
        `M${round(cx - r)} ${round(cy)}a${round(r)} ${round(r)} 0 1 0 ${round(r * 2)} 0a${round(r)} ${round(r)} 0 1 0 ${round(-r * 2)} 0z`,
      );
      paths.set(shape.fill, list);
    } else if (shape.type === 'ring') {
      other.push(
        `<rect x="${round(shape.x)}" y="${round(shape.y)}" width="${shape.size}" height="${shape.size}" rx="${round(shape.r)}" fill="none" stroke="${shape.stroke}" stroke-width="${shape.width}"/>`,
      );
    } else {
      other.push(
        `<image x="${round(shape.x)}" y="${round(shape.y)}" width="${round(shape.size)}" height="${round(shape.size)}" href="${shape.href}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    }
  }
  const text = caption
    ? `<text x="${total / 2}" y="${round(total + band * 0.42)}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif" font-weight="600" font-size="${round(total * 0.07)}" fill="${captionColor}">${escapeXml(caption)}</text>`
    : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total * 16}" height="${height * 16}">`,
    bg ? `<rect width="${total}" height="${height}" fill="${bg}"/>` : '',
    ...[...paths].map(([fill, list]) => `<path fill="${fill}" d="${list.join('')}"/>`),
    ...other,
    text,
    '</svg>',
  ].join('');
}

/** Draws the code onto a canvas at `scale` pixels per module. Logos come pre-loaded. */
export function drawShapes(
  context: CanvasRenderingContext2D,
  shapes: Shape[],
  scale: number,
  images: Map<string, CanvasImageSource>,
) {
  for (const shape of shapes) {
    if (shape.type === 'rect') {
      context.fillStyle = shape.fill;
      context.beginPath();
      context.roundRect(
        shape.x * scale,
        shape.y * scale,
        shape.w * scale,
        shape.h * scale,
        shape.r * scale,
      );
      context.fill();
    } else if (shape.type === 'circle') {
      context.fillStyle = shape.fill;
      context.beginPath();
      context.arc(shape.cx * scale, shape.cy * scale, shape.r * scale, 0, Math.PI * 2);
      context.fill();
    } else if (shape.type === 'ring') {
      context.strokeStyle = shape.stroke;
      context.lineWidth = shape.width * scale;
      context.beginPath();
      if (shape.r >= shape.size / 2)
        context.arc(
          (shape.x + shape.size / 2) * scale,
          (shape.y + shape.size / 2) * scale,
          (shape.size / 2) * scale,
          0,
          Math.PI * 2,
        );
      else
        context.roundRect(
          shape.x * scale,
          shape.y * scale,
          shape.size * scale,
          shape.size * scale,
          shape.r * scale,
        );
      context.stroke();
    } else {
      const image = images.get(shape.href);
      if (image)
        context.drawImage(
          image,
          shape.x * scale,
          shape.y * scale,
          shape.size * scale,
          shape.size * scale,
        );
    }
  }
}
