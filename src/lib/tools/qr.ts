/* Ported unchanged from Hyphy Studio (src/lib/qr.ts). */
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

export function qrSvg(
  text: string,
  { fg = '#0f0f0e', bg = '#ffffff', margin = 4, level = 'M' as QrLevel } = {},
) {
  const matrix = qrMatrix(text, level);
  const size = matrix.length + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${bg}"/><path d="${qrPath(matrix, margin)}" fill="${fg}"/></svg>`;
}
