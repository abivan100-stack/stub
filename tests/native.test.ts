import { describe, expect, it, vi } from 'vitest'

// Stand-in for the Android StubFiles plugin: records what the sink sends across the bridge.
const calls: { method: string; data?: string }[] = []
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    open: async () => (calls.push({ method: 'open' }), { id: 'f1' }),
    write: async ({ data }: { data: string }) => void calls.push({ method: 'write', data }),
    close: async () => (calls.push({ method: 'close' }), { uri: 'content://x', savedTo: 'Download/Stub/a.bin' }),
    abort: async () => void calls.push({ method: 'abort' }),
  }),
}))

const { nativeSink } = await import('../src/transfer/native')

describe('native sink', () => {
  it('batches chunks into ~1 MB writes and delivers every byte in order', async () => {
    calls.length = 0
    const src = Uint8Array.from({ length: 2.5 * 1024 * 1024 }, (_, i) => (i * 13 + (i >> 11)) & 0xff)
    const sink = await nativeSink()({ name: 'a.bin', type: '', size: src.length })
    for (let i = 0; i < src.length; i += 65536) await sink.write(src.subarray(i, i + 65536))
    expect(await sink.close()).toEqual({ uri: 'content://x', savedTo: 'Download/Stub/a.bin' })

    const writes = calls.filter((c) => c.method === 'write')
    expect(writes).toHaveLength(3) // 1 MB, 1 MB, then the last 0.5 MB on close
    const got = Uint8Array.from(writes.map((w) => atob(w.data!)).join(''), (c) => c.charCodeAt(0))
    expect(got.length).toBe(src.length)
    expect(got.every((v, i) => v === src[i])).toBe(true)
    expect(calls.at(-1)!.method).toBe('close')
  })

  it('drops buffered bytes on abort', async () => {
    calls.length = 0
    const sink = await nativeSink()({ name: 'b', type: '', size: 10 })
    await sink.write(new Uint8Array(10))
    await sink.abort()
    expect(calls.map((c) => c.method)).toEqual(['open', 'abort'])
  })
})
