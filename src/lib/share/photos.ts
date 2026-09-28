/*
 * Photos a tool keeps in this browser (Receipts' receipt pictures): IndexedDB, keyed by the
 * record's id, next to the small records in localStorage. Pictures are made smaller before
 * they're kept (`shrinkPhoto`), so a year of receipts stays a few tens of megabytes. Every access
 * is wrapped: private windows and strict settings can refuse storage, and a missing photo is
 * never an error for the record that pointed at it.
 */

const DB = 'hyphy-tool-photos';
const STORE = 'photos';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('No IndexedDB'));
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Aborted'));
    });
  } finally {
    db.close();
  }
}

/** Keep a photo. Resolves false when this browser won't keep it. */
export async function putPhoto(id: string, blob: Blob) {
  try {
    await run('readwrite', (store) => store.put(blob, id));
    return true;
  } catch {
    return false;
  }
}

export async function getPhoto(id: string): Promise<Blob | null> {
  try {
    const found = await run('readonly', (store) => store.get(id));
    return found instanceof Blob ? found : null;
  } catch {
    return null;
  }
}

export async function deletePhoto(id: string) {
  await run('readwrite', (store) => store.delete(id)).catch(() => {});
}

/**
 * A photo made smaller for keeping: upright, at most `edge` pixels on the long side, JPEG.
 * Falls back to the original when the browser can't draw it (a PDF, an unusual format).
 */
export async function shrinkPhoto(file: Blob, edge = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
