/*
 * Demo Mode's file bytes: kept in this browser (IndexedDB), keyed by the file's id. Demo Mode has
 * no signed-in account for Supabase Storage to check, so Hyphy doesn't pretend: the record is
 * real (it's on Files, projects, receipts, for every persona in this browser), the bytes live
 * here, survive a refresh, and Reset clears them with everything else. Another browser sees the
 * record and is told where the file is. Real accounts never use this (lib/files/storage.ts).
 */

const DB = 'hyphy-demo-files';
const STORE = 'files';

type Stored = { blob: Blob; name: string; at: number };

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

export async function putDeviceFile(id: string, blob: Blob, name: string) {
  await run('readwrite', (store) => store.put({ blob, name, at: Date.now() } satisfies Stored, id));
}

export async function getDeviceFile(id: string): Promise<Stored | null> {
  try {
    return ((await run('readonly', (store) => store.get(id))) as Stored | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function deleteDeviceFile(id: string) {
  await run('readwrite', (store) => store.delete(id)).catch(() => {});
}

/** Reset: every Demo Mode file this browser holds. */
export async function clearDeviceFiles() {
  await run('readwrite', (store) => store.clear()).catch(() => {});
}
