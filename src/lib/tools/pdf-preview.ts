/**
 * Page thumbnails for the PDF tool, drawn on this device with PDF.js. Loaded only when a PDF is
 * chosen; nothing is uploaded. Scripts inside a PDF never run: PDF.js only paints pages here.
 */

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

export type PdfPreview = {
  pages: number;
  /** A JPEG data URL of one page, `width` CSS pixels wide. */
  thumb: (index: number) => Promise<string>;
  close: () => void;
};

export async function openPdf(file: Blob, width = 160): Promise<PdfPreview> {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    enableXfa: false,
  });
  const doc = await task.promise;
  const ratio = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  return {
    pages: doc.numPages,
    async thumb(index) {
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width * ratio) / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();
      return canvas.toDataURL('image/jpeg', 0.82);
    },
    close() {
      void task.destroy();
    },
  };
}
