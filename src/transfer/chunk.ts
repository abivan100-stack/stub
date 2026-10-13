// Binary chunk frame: [u32 index][32-byte SHA-256 of data][data]

export const CHUNK_SIZE = 64 * 1024
const HEADER = 4 + 32

export function chunkCount(size: number): number {
  return Math.ceil(size / CHUNK_SIZE)
}

import { sha256 } from '../sha256'
export { sha256 }

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export async function* readChunks(blob: Blob, size = CHUNK_SIZE): AsyncGenerator<ArrayBuffer> {
  for (let off = 0; off < blob.size; off += size) yield await blob.slice(off, off + size).arrayBuffer()
}

export async function packChunk(index: number, data: ArrayBuffer): Promise<{ frame: ArrayBuffer; hash: Uint8Array }> {
  const hash = await sha256(data)
  const frame = new Uint8Array(HEADER + data.byteLength)
  new DataView(frame.buffer).setUint32(0, index)
  frame.set(hash, 4)
  frame.set(new Uint8Array(data), HEADER)
  return { frame: frame.buffer, hash }
}

export function unpackChunk(frame: ArrayBuffer): { index: number; hash: Uint8Array; data: Uint8Array } {
  if (frame.byteLength < HEADER) throw new Error('Chunk too short')
  return {
    index: new DataView(frame).getUint32(0),
    hash: new Uint8Array(frame, 4, 32),
    data: new Uint8Array(frame, HEADER),
  }
}

/** The final manifest check: one hash over every chunk hash, in order. */
export async function rootHash(hashes: Uint8Array[]): Promise<string> {
  const all = new Uint8Array(hashes.length * 32)
  hashes.forEach((h, i) => all.set(h, i * 32))
  return Array.from(await sha256(all), (b) => b.toString(16).padStart(2, '0')).join('')
}
