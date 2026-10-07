/**
 * A small ZIP reader and writer, enough for XLSX files (which are ZIP archives of XML). Compression uses the
 * platform's CompressionStream / DecompressionStream ('deflate-raw'), so no library is needed. No ZIP64, no
 * encryption: archives that need them are refused with a clear error.
 */

export interface ZipFile {
  name: string;
  data: Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(`Invalid ZIP file: ${message}`);
    this.name = 'ZipError';
  }
}

/** Refuses archives that would expand to more than this (a zip bomb protection), in bytes. */
export const MAX_UNCOMPRESSED_BYTES = 1_000_000_000;
const MAX_ENTRIES = 20_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A standalone copy of the bytes. `slice()` is not enough: on a Node `Buffer` it returns a view of the same memory, so
 * its `.buffer` would be the whole file (and a decompressor would choke on the rest).
 */
function copyBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

async function pipe(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([copyBytes(data)]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await pipe(data, new CompressionStream('deflate-raw'));
  } catch {
    return null; // an engine without deflate-raw: the file is stored uncompressed instead
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('this environment cannot decompress (no DecompressionStream)');
  try {
    return await pipe(data, new DecompressionStream('deflate-raw'));
  } catch {
    throw new ZipError('a file inside is corrupt (it does not decompress)');
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function fromUtf8(data: Uint8Array): string {
  return decoder.decode(data);
}

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  u16(n: number): void {
    this.bytes([n & 0xff, (n >>> 8) & 0xff]);
  }
  u32(n: number): void {
    this.bytes([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  }
  bytes(data: ArrayLike<number>): void {
    const chunk = data instanceof Uint8Array ? data : Uint8Array.from(data);
    this.chunks.push(chunk);
    this.length += chunk.length;
  }
  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

// A fixed timestamp (1980-01-01) keeps the output byte-for-byte reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export async function writeZip(files: readonly ZipFile[]): Promise<Uint8Array> {
  if (files.length > 65_535) throw new ZipError('too many files');
  const out = new Writer();
  const central: Array<{ name: Uint8Array; crc: number; compressed: number; size: number; method: number; offset: number }> = [];
  for (const file of files) {
    const name = utf8(file.name);
    const crc = crc32(file.data);
    const packed = file.data.length > 64 ? await deflate(file.data) : null;
    const useDeflate = packed !== null && packed.length < file.data.length;
    const body = useDeflate ? (packed as Uint8Array) : file.data;
    const method = useDeflate ? 8 : 0;
    if (out.length + body.length > 0xfffffff0 || file.data.length > 0xfffffff0) throw new ZipError('the archive is too large (ZIP64 is not supported)');
    central.push({ name, crc, compressed: body.length, size: file.data.length, method, offset: out.length });
    out.u32(0x04034b50);
    out.u16(20); // version needed
    out.u16(0x0800); // UTF-8 names
    out.u16(method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(body.length);
    out.u32(file.data.length);
    out.u16(name.length);
    out.u16(0);
    out.bytes(name);
    out.bytes(body);
  }
  const centralStart = out.length;
  for (const e of central) {
    out.u32(0x02014b50);
    out.u16(20); // version made by
    out.u16(20);
    out.u16(0x0800);
    out.u16(e.method);
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(e.crc);
    out.u32(e.compressed);
    out.u32(e.size);
    out.u16(e.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(e.offset);
    out.bytes(e.name);
  }
  const centralSize = out.length - centralStart;
  out.u32(0x06054b50);
  out.u16(0);
  out.u16(0);
  out.u16(central.length);
  out.u16(central.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0);
  return out.result();
}

interface Entry {
  name: string;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Reads every file of an archive. Throws ZipError for anything that is not a plain (non-ZIP64, unencrypted) ZIP. */
export async function readZip(input: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  // The end-of-central-directory record is at the very end, before an optional comment of up to 64 KiB.
  let eocd = -1;
  for (let i = input.length - 22; i >= Math.max(0, input.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('this is not a ZIP archive');
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  let at = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || at === 0xffffffff) throw new ZipError('ZIP64 archives are not supported');
  if (count > MAX_ENTRIES) throw new ZipError('too many files');
  if (at + centralSize > input.length) throw new ZipError('the file directory is damaged');

  const entries: Entry[] = [];
  let declared = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > input.length || view.getUint32(at, true) !== 0x02014b50) throw new ZipError('the file directory is damaged');
    const flags = view.getUint16(at + 8, true);
    if (flags & 1) throw new ZipError('encrypted files are not supported');
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const entry: Entry = {
      method: view.getUint16(at + 10, true),
      crc: view.getUint32(at + 16, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      name: fromUtf8(input.subarray(at + 46, at + 46 + nameLength)),
    };
    declared += entry.size;
    if (declared > MAX_UNCOMPRESSED_BYTES) throw new ZipError('the archive would expand to more than the allowed size');
    entries.push(entry);
    at += 46 + nameLength + extraLength + commentLength;
  }

  const files = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.name.endsWith('/')) continue; // a folder
    if (e.offset + 30 > input.length || view.getUint32(e.offset, true) !== 0x04034b50) throw new ZipError(`the entry "${e.name}" is damaged`);
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
    if (start + e.compressed > input.length) throw new ZipError(`the entry "${e.name}" is cut off`);
    const raw = input.subarray(start, start + e.compressed);
    let data: Uint8Array;
    if (e.method === 0) data = copyBytes(raw);
    else if (e.method === 8) data = await inflate(raw);
    else throw new ZipError(`the entry "${e.name}" uses an unsupported compression method (${e.method})`);
    if (data.length !== e.size) throw new ZipError(`the entry "${e.name}" has the wrong size`);
    if (crc32(data) !== e.crc) throw new ZipError(`the entry "${e.name}" is corrupt (checksum mismatch)`);
    files.set(e.name, data);
  }
  return files;
}
