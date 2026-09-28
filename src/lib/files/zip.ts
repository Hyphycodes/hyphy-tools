/*
 * A small zip writer for downloads made on the device: renamed copies, every social size, the
 * pages of a PDF as images. Files are stored as they are (no compression — photos and PDFs are
 * compressed already), with UTF-8 names, so any system can open the archive.
 */

export type ZipEntry = { name: string; data: Blob | Uint8Array; modified?: Date };

/** Zip archives without the 64-bit extension top out at 4 GB; Hyphy stops well before. */
export const ZIP_LIMIT = 1024 * 1024 * 1024;

let table: Uint32Array | null = null;
function crcTable() {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(bytes: Uint8Array, seed = 0) {
  const lookup = crcTable();
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let index = 0; index < bytes.length; index += 1)
    crc = lookup[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    (Math.max(0, date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Names made safe for an archive: no folders climbing out (`../`), no leading slashes, no
 * characters Windows refuses, and never two entries with the same name.
 */
export function safeEntryNames(names: string[]) {
  const seen = new Set<string>();
  return names.map((raw) => {
    const clean =
      raw
        .replace(/\\/g, '/')
        .split('/')
        .filter((part) => part && part !== '.' && part !== '..')
        .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim())
        .filter(Boolean)
        .join('/') || 'file';
    let name = clean;
    let counter = 2;
    const dot = clean.lastIndexOf('.');
    const extension = dot > clean.lastIndexOf('/') + 1;
    while (seen.has(name.toLowerCase())) {
      name = extension
        ? `${clean.slice(0, dot)} (${counter})${clean.slice(dot)}`
        : `${clean} (${counter})`;
      counter += 1;
    }
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Builds a .zip Blob from the entries, in order. */
export async function zip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const names = safeEntryNames(entries.map((entry) => entry.name));
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  let total = 0;

  for (const [index, entry] of entries.entries()) {
    const data =
      entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
    total += data.length;
    if (total > ZIP_LIMIT) throw new Error('That’s more than 1 GB. Try fewer or smaller files.');
    const name = encoder.encode(names[index]);
    const crc = crc32(data);
    const { time, day } = dosTime(entry.modified ?? new Date());

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data as BlobPart);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true); // made by
    record.setUint16(6, 20, true); // needed
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, day, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, data.length, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, 0, true); // extra
    record.setUint16(32, 0, true); // comment
    record.setUint16(34, 0, true); // disk
    record.setUint16(36, 0, true); // internal attributes
    record.setUint32(38, 0, true); // external attributes
    record.setUint32(42, offset, true);
    const header = new Uint8Array(46 + name.length);
    header.set(new Uint8Array(record.buffer), 0);
    header.set(name, 46);
    central.push(header);

    offset += 30 + name.length + data.length;
  }

  const size = central.reduce((sum, item) => sum + item.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), new Uint8Array(end.buffer)], {
    type: 'application/zip',
  });
}
