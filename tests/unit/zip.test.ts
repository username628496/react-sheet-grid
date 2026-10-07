import { describe, expect, it } from 'vitest';
import { crc32, fromUtf8, MAX_UNCOMPRESSED_BYTES, readZip, utf8, writeZip, ZipError } from '../../src/xlsx/zip';

const text = (s: string) => utf8(s);

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zip', () => {
  it('round trips files of every size, compressed or stored', async () => {
    const big = text('abc'.repeat(50_000));
    const files = [
      { name: 'a.txt', data: text('hello') },
      { name: 'dir/b.xml', data: text('<x>' + 'y'.repeat(2000) + '</x>') },
      { name: 'empty', data: new Uint8Array(0) },
      { name: 'big.bin', data: big },
      { name: 'tiếng việt.txt', data: text('Xin chào') },
    ];
    const zip = await writeZip(files);
    expect(zip.length).toBeLessThan(big.length); // the repetitive file was really compressed
    const back = await readZip(zip);
    expect([...back.keys()]).toEqual(files.map((f) => f.name));
    for (const f of files) expect(back.get(f.name)).toEqual(f.data);
    expect(fromUtf8(back.get('tiếng việt.txt') as Uint8Array)).toBe('Xin chào');
  });

  it('is deterministic', async () => {
    const files = [{ name: 'a', data: text('x'.repeat(500)) }];
    expect(await writeZip(files)).toEqual(await writeZip(files));
  });

  it('rejects things that are not zips', async () => {
    await expect(readZip(text('just some text'))).rejects.toBeInstanceOf(ZipError);
    await expect(readZip(new Uint8Array(0))).rejects.toBeInstanceOf(ZipError);
  });

  it('detects corruption through the checksum', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: text('hello world') }]);
    const bad = zip.slice();
    bad[40] = (bad[40] as number) ^ 0xff; // inside the stored data
    await expect(readZip(bad)).rejects.toThrow(/corrupt|checksum/);
  });

  it('detects a truncated archive', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: text('hello world'.repeat(20)) }]);
    await expect(readZip(zip.slice(0, zip.length - 30))).rejects.toBeInstanceOf(ZipError);
  });

  it('refuses archives that declare more than the allowed size', async () => {
    const zip = await writeZip([{ name: 'a.txt', data: text('hello') }]);
    const bomb = zip.slice();
    const view = new DataView(bomb.buffer);
    // Central directory entry: uncompressed size at +24 from its start.
    const eocd = bomb.length - 22;
    const central = view.getUint32(eocd + 16, true);
    view.setUint32(central + 24, MAX_UNCOMPRESSED_BYTES + 1, true);
    await expect(readZip(bomb)).rejects.toThrow(/expand/);
  });
});

/** Behaves like a Node Buffer, whose slice() returns a view of the same memory instead of a copy. */
class ViewSlicingBytes extends Uint8Array {
  override slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    return this.subarray(start, end);
  }
  override subarray(start?: number, end?: number): Uint8Array<ArrayBuffer> {
    const view = super.subarray(start, end);
    return new ViewSlicingBytes(view.buffer, view.byteOffset, view.length);
  }
}

describe('zip with Node Buffers', () => {
  it('reads archives handed over as a Buffer (whose slice() is a view, not a copy)', async () => {
    const files = [
      { name: 'a.txt', data: utf8('hello '.repeat(200)) },
      { name: 'b.txt', data: utf8('world '.repeat(200)) },
    ];
    const zip = await writeZip(files);
    const padded = new Uint8Array(zip.length + 7);
    padded.set(zip, 7); // the archive is a view into a bigger allocation
    const input = new ViewSlicingBytes(padded.buffer, 7, zip.length);
    const back = await readZip(input);
    expect(back.get('a.txt')).toEqual(files[0]!.data);
    expect(back.get('b.txt')).toEqual(files[1]!.data);
  });
});
