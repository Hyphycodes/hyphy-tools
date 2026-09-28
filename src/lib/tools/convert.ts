import type { PDFDocument } from 'pdf-lib';
import { slugName } from '@/lib/files/download';

/*
 * Convert: the page math and file decisions behind Images → PDF and PDF → images. Pure, so it's
 * tested in Node (tests/lib-convert.spec.ts), PDF building included: pdf-lib runs anywhere.
 * Decoding pictures and drawing PDF pages need a browser; that lives in the component and in
 * pdf-render.ts.
 *
 * PDF pages are measured in points, 72 to the inch. Pictures are measured in pixels.
 */

export const MAX_IMAGES = 60;
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_PDF_PAGES = 200;

/** "Make it smaller": big photos are scaled down to this long side and saved as JPEG at 85%. */
export const SMALLER = { longSide: 2400, quality: 0.85 } as const;
/** Pictures that have to be redrawn (WebP, GIF, AVIF, HEIC…) are saved at this JPEG quality. */
export const REDRAW_QUALITY = 0.92;
/** PDF pages saved as JPG: crisp text at a fraction of PNG's weight. */
export const PAGE_JPEG_QUALITY = 0.9;

/**
 * The largest canvas every current browser will draw: iPhones stop at 16.7 megapixels and no
 * browser goes past 16,384 px on a side. Anything bigger is scaled down to fit, and says so.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096;
export const MAX_CANVAS_SIDE = 16_384;

export type Size = { width: number; height: number };
export type Box = Size & { x: number; y: number };

/* ---------------- Images → PDF: pages ---------------- */

export type PageSize = 'fit' | 'a4' | 'letter';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';
export type PageMargin = 'none' | 'small' | 'normal';
export type PageSetup = { size: PageSize; orientation: PageOrientation; margin: PageMargin };
/** A page's size in points, and where its picture sits (from the bottom-left, as PDFs count). */
export type PageLayout = Size & { box: Box };

export const DEFAULT_SETUP: PageSetup = { size: 'fit', orientation: 'auto', margin: 'small' };

/** Paper, portrait, in points. */
export const PAPER: Record<Exclude<PageSize, 'fit'>, Size> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};

/** A quarter inch (about 6 mm) and half an inch (about 13 mm). */
export const MARGINS: Record<PageMargin, number> = { none: 0, small: 18, normal: 36 };

/**
 * "Each page fits its image" counts pixels at 96 to the inch, like a screen, and keeps a big
 * photo's page to 11 inches on its long side (about a sheet of paper) rather than a 42-inch
 * poster. Nothing is resampled: the page is only told how big to show the picture.
 */
const POINTS_PER_PIXEL = 72 / 96;
export const FIT_LONG_SIDE = 11 * 72;
/** The smallest page a PDF may have. */
const MIN_PAGE = 3;

const round = (value: number) => Math.round(value * 100) / 100;

/** The largest copy of `picture` that fits in `area`, centered. */
function contain(picture: Size, area: Box): Box {
  const scale = Math.min(area.width / picture.width, area.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  return {
    x: area.x + (area.width - width) / 2,
    y: area.y + (area.height - height) / 2,
    width,
    height,
  };
}

/** One page for one picture (its size as seen, in pixels): the page, and the picture's place. */
export function layoutPage(picture: Size, setup: PageSetup): PageLayout {
  if (setup.size === 'fit') {
    const scale = Math.min(
      POINTS_PER_PIXEL,
      FIT_LONG_SIDE / Math.max(picture.width, picture.height),
    );
    const width = Math.max(MIN_PAGE, round(picture.width * scale));
    const height = Math.max(MIN_PAGE, round(picture.height * scale));
    return { width, height, box: contain(picture, { x: 0, y: 0, width, height }) };
  }
  const paper = PAPER[setup.size];
  const landscape =
    setup.orientation === 'landscape' ||
    (setup.orientation === 'auto' && picture.width > picture.height);
  const width = landscape ? paper.height : paper.width;
  const height = landscape ? paper.width : paper.height;
  const margin = MARGINS[setup.margin];
  return {
    width,
    height,
    box: contain(picture, {
      x: margin,
      y: margin,
      width: width - margin * 2,
      height: height - margin * 2,
    }),
  };
}

/**
 * A page drawn to scale inside a preview frame of `frame` (width ÷ height), as percentages:
 * where the sheet sits in the frame, and where the picture sits on the sheet.
 */
export function previewBoxes(layout: PageLayout, frame: number) {
  const ratio = layout.width / layout.height;
  const width = ratio >= frame ? 100 : (ratio / frame) * 100;
  const height = ratio >= frame ? (frame / ratio) * 100 : 100;
  const { box } = layout;
  return {
    sheet: { left: (100 - width) / 2, top: (100 - height) / 2, width, height },
    picture: {
      left: (box.x / layout.width) * 100,
      top: ((layout.height - box.y - box.height) / layout.height) * 100,
      width: (box.width / layout.width) * 100,
      height: (box.height / layout.height) * 100,
    },
  };
}

/* ---------------- Images → PDF: pictures ---------------- */

/** What someone chose, going by its type and name. HEIC is tried: Safari can open it. */
export function kindOf(file: { name: string; type: string }): 'image' | 'heic' | 'pdf' | 'other' {
  const type = file.type.toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  if (type === 'application/pdf' || extension === 'pdf') return 'pdf';
  if (/^image\/hei[cf]/.test(type) || /^hei[cf]$/.test(extension)) return 'heic';
  // A drawing, not a picture: canvases can't reliably open SVG files.
  if (type === 'image/svg+xml' || extension === 'svg') return 'other';
  if (type.startsWith('image/') || /^(jpe?g|jfif|png|webp|gif|avif|bmp)$/.test(extension))
    return 'image';
  return 'other';
}

/** JPEG or PNG by the bytes themselves: a file's name or type can be wrong. */
export function sniffImage(bytes: Uint8Array): 'jpeg' | 'png' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  return null;
}

function tiffOrientation(view: DataView, start: number, end: number): number | null {
  if (start + 8 > end) return null;
  const order = view.getUint16(start);
  const little = order === 0x4949; // "II"; "MM" is big-endian
  if (!little && order !== 0x4d4d) return null;
  if (view.getUint16(start + 2, little) !== 42) return null;
  const directory = start + view.getUint32(start + 4, little);
  if (directory + 2 > end) return null;
  const count = view.getUint16(directory, little);
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/**
 * A JPEG's EXIF orientation (1–8; 1 is upright). Phones save the sensor's pixels as they came
 * and note the turn here, so a photo held upright is often stored sideways with a 6.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (sniffImage(bytes) !== 'jpeg') return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    if (marker === 0xffff) {
      offset += 1; // fill byte
      continue;
    }
    // Not a marker, or the image data has started: EXIF always comes before it.
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || marker === 0xffd9) return 1;
    const length = view.getUint16(offset + 2);
    const end = Math.min(view.byteLength, offset + 2 + length);
    const exif =
      marker === 0xffe1 &&
      length >= 16 &&
      String.fromCharCode(...bytes.subarray(offset + 4, offset + 10)) === 'Exif\0\0';
    if (exif) return tiffOrientation(view, offset + 10, end) ?? 1;
    offset += 2 + length;
  }
  return 1;
}

/**
 * A JPEG without the notes cameras add: EXIF (date, camera, often the location), XMP, IPTC and
 * comments. The picture itself is untouched, so this is lossless. Color profiles (APP2) and
 * Adobe's color note (APP14) stay: they change how the colors read. Odd files come back as-is.
 */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (sniffImage(bytes) !== 'jpeg') return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  for (;;) {
    if (offset + 4 > bytes.length) return bytes;
    const marker = view.getUint16(offset);
    if (marker === 0xffff) {
      offset += 1; // fill byte
      continue;
    }
    // Only segments with a length belong here; anything else is a file to leave alone.
    if (marker < 0xffc0 || (marker >= 0xffd0 && marker <= 0xffd9)) return bytes;
    if (marker === 0xffda) break; // the image data starts: everything from here stays
    const end = offset + 2 + view.getUint16(offset + 2);
    if (end > bytes.length) return bytes;
    const note =
      marker === 0xfffe ||
      (marker >= 0xffe1 && marker <= 0xffef && marker !== 0xffe2 && marker !== 0xffee);
    if (!note) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  kept.push(bytes.subarray(offset));
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of kept) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Turns a PDF can show without redrawing: upright, 180°, and a quarter turn either way. */
const TURNS = [1, 3, 6, 8];

/** A picture's size as it's meant to be seen: EXIF 5–8 swap width and height. */
export function orientedSize(size: Size, orientation: number): Size {
  return orientation >= 5 && orientation <= 8
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

export type Placement = Box & { rotate: 0 | 90 | 180 | -90 };

/**
 * Where to draw a photo's stored pixels so it shows upright in `box`. pdf-lib turns a picture
 * around its bottom-left corner, counterclockwise for positive angles, so a turned photo starts
 * from the matching corner of the box, with its stored (unturned) width and height.
 */
export function placeImage(box: Box, orientation: number): Placement {
  switch (orientation) {
    case 3:
      return { ...box, x: box.x + box.width, y: box.y + box.height, rotate: 180 };
    case 6:
      return { x: box.x, y: box.y + box.height, width: box.height, height: box.width, rotate: -90 };
    case 8:
      return { x: box.x + box.width, y: box.y, width: box.height, height: box.width, rotate: 90 };
    default:
      return { ...box, rotate: 0 };
  }
}

/**
 * How a picture goes into the PDF. pdf-lib takes JPEG and PNG bytes as they are (lossless and
 * quick), and a turned phone photo is turned on the page instead of redrawn. Everything else
 * (WebP, GIF, AVIF, HEIC, mirrored photos) is redrawn on a canvas first. "Make it smaller"
 * redraws everything, then keeps whichever version is lighter.
 */
export function embedPlan(format: 'jpeg' | 'png' | null, orientation: number, smaller: boolean) {
  const original = format === 'png' || (format === 'jpeg' && TURNS.includes(orientation));
  return { original, redraw: smaller || !original };
}

/** A redrawn picture stays PNG only when it has see-through parts; JPEG can't keep them. */
export function redrawType(transparent: boolean): 'image/png' | 'image/jpeg' {
  return transparent ? 'image/png' : 'image/jpeg';
}

/** True when any pixel of RGBA data is even slightly see-through. */
export function hasTransparency(rgba: ArrayLike<number>) {
  for (let index = 3; index < rgba.length; index += 4) if (rgba[index] < 255) return true;
  return false;
}

/** How much a canvas must shrink to be drawable everywhere (1 when it already is). */
function canvasFit(size: Size) {
  return Math.min(
    1,
    Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height)),
    MAX_CANVAS_SIDE / Math.max(size.width, size.height),
  );
}

/**
 * The canvas for redrawing a picture: never enlarged, scaled to 2,400 px by "Make it smaller",
 * and within what browsers can draw (`capped` when that cost pixels).
 */
export function redrawSize(picture: Size, smaller: boolean): Size & { capped: boolean } {
  const wanted = smaller
    ? Math.min(1, SMALLER.longSide / Math.max(picture.width, picture.height))
    : 1;
  const fit = canvasFit({ width: picture.width * wanted, height: picture.height * wanted });
  const capped = fit < 1;
  const scale = wanted * fit;
  // Rounding up could push a capped canvas back over the limit.
  const pixels = (value: number) => Math.max(1, capped ? Math.floor(value) : Math.round(value));
  return { width: pixels(picture.width * scale), height: pixels(picture.height * scale), capped };
}

export type PdfImage = { bytes: Uint8Array; format: 'jpeg' | 'png'; orientation: number };
/** A picture for the PDF, and a redrawn stand-in if pdf-lib can't read the original after all. */
export type PdfSource = PdfImage & { fallback?: () => Promise<PdfImage> };

/** PNGs are decoded to pixels by pdf-lib, so their text notes never reach the PDF either. */
const embed = (pdf: PDFDocument, image: PdfImage) =>
  image.format === 'png' ? pdf.embedPng(image.bytes) : pdf.embedJpg(stripJpegMetadata(image.bytes));

/** A page of the finished PDF: which picture it shows (by its place in the list), and how. */
export type BuiltPage = { index: number; layout: PageLayout };

/**
 * One page per picture, in order. `source` hands over one picture at a time, so only the
 * picture being added is being read or redrawn; it returns null to leave a picture out. Stops
 * between pictures when `signal` aborts. Camera details and location are left out: photos go in
 * without their metadata.
 */
export async function buildPdf(
  count: number,
  source: (index: number) => Promise<PdfSource | null>,
  setup: PageSetup,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (done: number) => void } = {},
): Promise<{ bytes: Uint8Array; pages: BuiltPage[] }> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setCreator('Hyphy Tools · Convert');
  const pages: BuiltPage[] = [];
  for (let index = 0; index < count; index += 1) {
    signal?.throwIfAborted();
    const input = await source(index);
    if (input) {
      let picture: PdfImage = input;
      let image;
      try {
        image = await embed(pdf, picture);
      } catch (error) {
        if (!input.fallback) throw error;
        picture = await input.fallback();
        image = await embed(pdf, picture);
      }
      const turn =
        picture.format === 'jpeg' && TURNS.includes(picture.orientation) ? picture.orientation : 1;
      const layout = layoutPage(orientedSize(image, turn), setup);
      const page = pdf.addPage([layout.width, layout.height]);
      const { rotate, ...at } = placeImage(layout.box, turn);
      page.drawImage(image, { ...at, rotate: degrees(rotate) });
      pages.push({ index, layout });
    }
    onProgress?.(index + 1);
  }
  signal?.throwIfAborted();
  if (!pages.length) throw new Error('None of these pictures could be opened here.');
  return { bytes: await pdf.save(), pages };
}

/* ---------------- PDF → images ---------------- */

export type Resolution = 'screen' | 'sharp' | 'print';
export const RESOLUTIONS: Record<Resolution, { label: string; dpi: number; use: string }> = {
  screen: { label: 'Screen', dpi: 96, use: 'For phones, email and the web.' },
  sharp: { label: 'Sharp', dpi: 150, use: 'Sharp enough to zoom in, or to put on a slide.' },
  print: { label: 'Print', dpi: 300, use: 'For printing at full quality.' },
};

/** A page (in points) in pixels at `dpi`, scaled down when it's bigger than browsers can draw. */
export function pagePixels(page: Size, dpi: number): Size & { dpi: number; capped: boolean } {
  const scale = dpi / 72;
  const size = { width: page.width * scale, height: page.height * scale };
  const fit = canvasFit(size);
  if (fit >= 1)
    return {
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
      dpi,
      capped: false,
    };
  return {
    width: Math.max(1, Math.floor(size.width * fit)),
    height: Math.max(1, Math.floor(size.height * fit)),
    dpi: Math.floor(dpi * fit),
    capped: true,
  };
}

/* ---------------- Names ---------------- */

/** How long a name Convert makes can start, before "-page-01.jpg": slugName's own limit. */
const BASE_LENGTH = 48;

/**
 * "Lunch Menu.pdf" → "lunch-menu": the start of every file name Convert makes. A long name ends
 * on a whole word rather than half of one.
 */
export function baseName(fileName: string, fallback = 'document') {
  const words = fileName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .split(/[\s_.\-–—]+/)
    .filter(Boolean);
  let kept = '';
  for (const word of words) {
    const longer = kept ? `${kept} ${word}` : word;
    if (kept && longer.length > BASE_LENGTH) break;
    kept = longer;
  }
  return slugName(kept, fallback);
}

/** Page 1 of a 12-page menu → "menu-page-01.jpg". Padded, so the files sort in page order. */
export function pageImageName(
  base: string,
  index: number,
  pageCount: number,
  format: 'jpeg' | 'png',
) {
  const digits = Math.max(2, String(pageCount).length);
  const number = String(index + 1).padStart(digits, '0');
  return `${base}-page-${number}.${format === 'png' ? 'png' : 'jpg'}`;
}

export function pagesZipName(base: string, format: 'jpeg' | 'png') {
  return `${base}-pages-${format === 'png' ? 'png' : 'jpg'}.zip`;
}

/** "IMG_2041.jpg" and eleven more → "img-2041-and-11-more.pdf". */
export function pdfName(fileNames: string[]) {
  const first = baseName(fileNames[0] ?? '', 'images');
  return fileNames.length > 1 ? `${first}-and-${fileNames.length - 1}-more.pdf` : `${first}.pdf`;
}

/** Before → after, in words: "74% smaller", "3% larger", "about the same". */
export function sizeChange(before: number, after: number) {
  if (before <= 0) return '';
  const percent = Math.round((after / before - 1) * 100);
  if (percent === 0) return 'about the same';
  return percent < 0 ? `${-percent}% smaller` : `${percent}% larger`;
}
