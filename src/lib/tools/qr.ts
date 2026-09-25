/* Ported from Hyphy Studio (src/lib/qr.ts); captions, Wi-Fi and the content helpers are new here. */
import qrcode from 'qrcode-generator';

// Encode text as UTF-8 bytes; the library default truncates to Latin-1.
qrcode.stringToBytes = (text: string) => Array.from(new TextEncoder().encode(text));

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** Module grid for text. Throws if the text is too long for a QR code at this level. */
export function qrMatrix(text: string, level: QrLevel = 'M') {
  const code = qrcode(0, level);
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
}

/** One SVG path for every dark module, merging horizontal runs. Coordinates include the margin. */
export function qrPath(matrix: boolean[][], margin = 4) {
  let d = '';
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      d += `M${start + margin} ${y + margin}h${x - start}v1h${start - x}z`;
    }
  });
  return d;
}

/** Height of the caption band under a code, in modules, when there is one. */
export function captionBand(total: number) {
  return Math.round(total * 0.18);
}

export function qrSvg(
  text: string,
  {
    fg = '#0f0f0e',
    bg = '#ffffff',
    margin = 4,
    level = 'M' as QrLevel,
    caption = '',
  }: { fg?: string; bg?: string; margin?: number; level?: QrLevel; caption?: string } = {},
) {
  const matrix = qrMatrix(text, level);
  const size = matrix.length + margin * 2;
  const band = caption ? captionBand(size) : 0;
  const label = caption
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const text_ = caption
    ? `<text x="${size / 2}" y="${size + band * 0.42}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif" font-weight="600" font-size="${(size * 0.07).toFixed(2)}" fill="${fg}">${label}</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + band}" shape-rendering="crispEdges"><rect width="${size}" height="${size + band}" fill="${bg}"/><path d="${qrPath(matrix, margin)}" fill="${fg}"/>${text_}</svg>`;
}

/* ---------- what a code opens ---------- */

export type QrKind = 'link' | 'wifi' | 'email' | 'text';

export type WifiDetails = {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
};

const escapeWifi = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');

/** The standard Wi-Fi payload phones read to join a network without typing the password. */
export function wifiPayload({ ssid, password, security, hidden }: WifiDetails) {
  if (!ssid.trim()) return '';
  return `WIFI:T:${security};S:${escapeWifi(ssid)};${security === 'nopass' ? '' : `P:${escapeWifi(password)};`}${hidden ? 'H:true;' : ''};`;
}

export function parseWifi(payload: string): WifiDetails | null {
  if (!payload.startsWith('WIFI:')) return null;
  const field = (key: string) => {
    const match = payload.match(new RegExp(`[:;]${key}:((?:\\\\.|[^;])*)`));
    return match ? match[1].replace(/\\(.)/g, '$1') : '';
  };
  const security = field('T');
  return {
    ssid: field('S'),
    password: field('P'),
    security: security === 'WEP' ? 'WEP' : security === 'nopass' ? 'nopass' : 'WPA',
    hidden: field('H') === 'true',
  };
}

export function kindOf(content: string): QrKind {
  if (!content || /^https?:\/\//i.test(content)) return 'link';
  if (content.startsWith('WIFI:')) return 'wifi';
  if (content.startsWith('mailto:')) return 'email';
  return 'text';
}
