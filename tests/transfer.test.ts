import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, chunkCount, packChunk, readChunks, rootHash, sha256, unpackChunk } from '../src/transfer/chunk'
import { Peer, FINISHED, type Ticket } from '../src/transfer/peer'
import { memorySink } from '../src/transfer/sink'

function bytes(n: number, seed = 1): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 0xff
  return b
}

describe('chunking and hashing', () => {
  it('counts chunks', () => {
    expect(chunkCount(0)).toBe(0)
    expect(chunkCount(1)).toBe(1)
    expect(chunkCount(CHUNK_SIZE)).toBe(1)
    expect(chunkCount(CHUNK_SIZE + 1)).toBe(2)
  })

  it('packs and unpacks a chunk', async () => {
    const data = bytes(1000)
    const { frame, hash } = await packChunk(7, data.buffer as ArrayBuffer)
    const out = unpackChunk(frame)
    expect(out.index).toBe(7)
    expect(out.hash).toEqual(hash)
    expect(out.data).toEqual(data)
    expect(await sha256(out.data as BufferSource)).toEqual(hash)
  })

  it('splits a blob and reassembles it byte for byte', async () => {
    const src = bytes(CHUNK_SIZE * 2 + 123)
    const parts: Uint8Array[] = []
    for await (const c of readChunks(new Blob([src as BlobPart]))) parts.push(new Uint8Array(c))
    expect(parts.map((p) => p.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 123])
    expect(new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())).toEqual(src)
  })

  it('root hash depends on order', async () => {
    const a = await sha256(bytes(10, 1) as BufferSource)
    const b = await sha256(bytes(10, 2) as BufferSource)
    expect(await rootHash([a, b])).not.toBe(await rootHash([b, a]))
    expect(await rootHash([a, b])).toMatch(/^[0-9a-f]{64}$/)
  })
})

// Two in-memory channel ends wired together, close enough to RTCDataChannel for Peer.
class FakeChannel extends EventTarget {
  readyState = 'open'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  other!: FakeChannel
  tamper?: (data: ArrayBuffer) => ArrayBuffer
  send(data: string | ArrayBuffer) {
    const payload = typeof data === 'string' ? data : (this.tamper?.(data) ?? data)
    setTimeout(() => this.other.dispatchEvent(new MessageEvent('message', { data: payload })))
  }
  close() {
    for (const c of [this, this.other]) {
      c.readyState = 'closed'
      c.dispatchEvent(new Event('close'))
    }
  }
}

function pair() {
  const a = new FakeChannel()
  const b = new FakeChannel()
  a.other = b
  b.other = a
  return { a, b, alice: new Peer(a as unknown as RTCDataChannel), bob: new Peer(b as unknown as RTCDataChannel) }
}

function settled(peer: Peer, n: number): Promise<Ticket[]> {
  return new Promise((resolve) => {
    const check = () => {
      const done = peer.tickets.filter((t) => FINISHED.includes(t.status))
      if (done.length >= n) resolve(peer.tickets)
    }
    peer.onchange = check
    check()
  })
}

async function offered(peer: Peer) {
  await new Promise<void>((r) => (peer.onchange = () => peer.pending().length && r()))
  return peer.pending()[0]!
}

describe('Peer protocol', () => {
  it('sends a queue of files that arrive verified and identical', async () => {
    const { alice, bob } = pair()
    const one = bytes(CHUNK_SIZE * 3 + 17, 3)
    const two = bytes(10, 9)
    alice.send([new File([one as BlobPart], 'one.bin'), new File([two as BlobPart], 'two.txt', { type: 'text/plain' }), new File([], 'empty')])

    const batch = await offered(bob)
    expect(batch.tickets.map((t) => t.name)).toEqual(['one.bin', 'two.txt', 'empty'])
    expect(batch.total).toBe(one.length + two.length)
    bob.accept(batch.id, memorySink())

    const received = await settled(bob, 3)
    expect(received.every((t) => t.status === 'done')).toBe(true)
    expect(new Uint8Array(await received[0]!.blob!.arrayBuffer())).toEqual(one)
    expect(received[1]!.blob!.type).toBe('text/plain')
    expect(received[2]!.blob!.size).toBe(0)
    expect((await settled(alice, 3)).every((t) => t.status === 'done')).toBe(true)
  })

  it('works in the other direction too', async () => {
    const { alice, bob } = pair()
    bob.send([new File(['hi'], 'back.txt')])
    alice.accept((await offered(alice)).id, memorySink())
    expect((await settled(alice, 1))[0]!.status).toBe('done')
  })

  it('marks every file declined when the batch is declined', async () => {
    const { alice, bob } = pair()
    alice.send([new File(['a'], 'a'), new File(['b'], 'b')])
    bob.decline((await offered(bob)).id)
    expect((await settled(alice, 2)).map((t) => t.status)).toEqual(['declined', 'declined'])
  })

  it('fails a damaged chunk, then succeeds on retry', async () => {
    const { a, alice, bob } = pair()
    let damage = true
    a.tamper = (buf) => {
      if (!damage) return buf
      damage = false
      const copy = new Uint8Array(buf.slice(0))
      copy[copy.length - 1]! ^= 0xff
      return copy.buffer
    }
    alice.send([new File([bytes(5000) as BlobPart], 'x')])
    bob.accept((await offered(bob)).id, memorySink())
    const [t] = await settled(bob, 1)
    expect(t!.status).toBe('failed')
    expect((await settled(alice, 1))[0]!.status).toBe('failed')

    bob.retry(t!)
    await new Promise<void>((r) => (bob.onchange = () => t!.status === 'done' && r()))
    expect(new Uint8Array(await t!.blob!.arrayBuffer())).toEqual(bytes(5000))
  })

  it('fails open transfers when the link drops', async () => {
    const { a, alice, bob } = pair()
    alice.send([new File([bytes(10) as BlobPart], 'x')])
    await offered(bob)
    a.close()
    const [t] = await settled(alice, 1)
    expect(t!.status).toBe('failed')
    expect(t!.error).toBe('Connection lost')
    expect(alice.connected).toBe(false)
  })
})
