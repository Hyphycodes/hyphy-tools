/**
 * PDF pages as pictures, drawn on this device with PDF.js: thumbnails to choose from, then each
 * chosen page at full size as a JPG or PNG. Loaded only when a PDF is chosen, the same way as
 * pdf-preview.ts. Nothing is uploaded, and scripts inside a PDF never run: PDF.js only paints.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

// The legacy build carries the polyfills today's Safari and Chrome still need.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let loader: Promise<PdfJs> | null = null;

function pdfjs() {
  loader ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return lib;
  });
  return loader;
}

/** Why a PDF didn't open: it's locked with a password, or it isn't a PDF PDF.js can read. */
export class PdfOpenError extends Error {
  constructor(readonly problem: 'password' | 'damaged') {
    super(problem === 'password' ? 'The PDF needs a password.' : 'The PDF could not be read.');
    this.name = 'PdfOpenError';
  }
}

export type RenderablePdf = {
  pages: number;
  /** A page's size in points (1/72 inch), turned the way it's meant to be read. */
  size: (index: number) => Promise<{ width: number; height: number }>;
  /** A small JPEG data URL of a page, `width` CSS pixels wide. */
  thumb: (index: number, width: number) => Promise<string>;
  /** One page drawn at exactly `width` × `height` pixels, as a JPEG or PNG. */
  render: (
    index: number,
    target: {
      width: number;
      height: number;
      type: 'image/jpeg' | 'image/png';
      quality?: number;
      signal?: AbortSignal;
    },
  ) => Promise<Blob>;
  close: () => void;
};

/** Draws a page onto a fresh canvas, and hands the canvas's memory back as soon as it's done. */
async function paint<T>(
  page: PDFPageProxy,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
  read: (canvas: HTMLCanvasElement) => Promise<T>,
) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const task = page.render({ canvas, viewport });
    const cancel = () => task.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await task.promise;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    return await read(canvas);
  } finally {
    page.cleanup();
    // A print-size page holds ~35 MB until the browser gets round to collecting it.
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function openRenderablePdf(file: Blob): Promise<RenderablePdf> {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (error) {
    void task.destroy();
    const name = error instanceof Error ? error.name : '';
    throw new PdfOpenError(name === 'PasswordException' ? 'password' : 'damaged');
  }
  const ratio = Math.min(2, window.devicePixelRatio || 1);

  return {
    pages: doc.numPages,
    async size(index) {
      const page = await doc.getPage(index + 1);
      const { width, height } = page.getViewport({ scale: 1 });
      return { width, height };
    },
    async thumb(index, width) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const pixels = Math.max(1, Math.round(width * ratio));
      return paint(
        page,
        pixels,
        Math.max(1, Math.round((pixels * base.height) / base.width)),
        undefined,
        async (canvas) => canvas.toDataURL('image/jpeg', 0.8),
      );
    },
    async render(index, { width, height, type, quality, signal }) {
      signal?.throwIfAborted();
      const page = await doc.getPage(index + 1);
      return paint(page, width, height, signal, async (canvas) => {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, type, quality),
        );
        if (!blob) throw new Error(`Page ${index + 1} is too big for this browser to save.`);
        return blob;
      });
    },
    close() {
      void task.destroy();
    },
  };
}
