import { describe, expect, it } from 'vitest'
import { relayCode, wsChannel } from '../src/pairing/relay'
import { parseConnectUrl } from '../src/pairing/host'
import { FINISHED, Peer, type Ticket } from '../src/transfer/peer'
import { memorySink } from '../src/transfer/sink'

// Two in-memory WebSocket ends, as the phone's relay joins them: what one sends, the other receives.
class FakeSocket extends EventTarget {
  readyState: number = WebSocket.OPEN
  binaryType = 'blob'
  bufferedAmount = 0
  other!: FakeSocket
  sent = 0
  send(data: string | ArrayBuffer) {
    this.sent++
    // Pretend the network is slow every 50 messages, so the backpressure path runs.
    if (this.sent % 50 === 0) {
      this.bufferedAmount = 8 * 1024 * 1024
      setTimeout(() => (this.bufferedAmount = 0), 30)
    }
    const copy = typeof data === 'string' ? data : data.slice(0)
    setTimeout(() => this.other.dispatchEvent(new MessageEvent('message', { data: copy })))
  }
  close() {
    for (const s of [this, this.other]) {
      if (s.readyState === WebSocket.CLOSED) continue
      s.readyState = WebSocket.CLOSED
      s.dispatchEvent(new Event('close'))
    }
  }
}

function pair() {
  const a = new FakeSocket()
  const b = new FakeSocket()
  a.other = b
  b.other = a
  const ca = wsChannel(a as unknown as WebSocket)
  const cb = wsChannel(b as unknown as WebSocket)
  return { a, alice: new Peer(ca), bob: new Peer(cb), ca }
}

function settled(peer: Peer, n: number): Promise<Ticket[]> {
  return new Promise((resolve) => {
    const check = () => peer.tickets.filter((t) => FINISHED.includes(t.status)).length >= n && resolve(peer.tickets)
    peer.onchange = check
    check()
  })
}

describe('phone relay', () => {
  it('looks like an open data channel', () => {
    const { ca } = pair()
    expect(ca.readyState).toBe('open')
    expect(ca.bufferedAmount).toBe(0)
  })

  it('carries a verified multi-chunk transfer through Peer, with backpressure', async () => {
    const { alice, bob } = pair()
    const data = Uint8Array.from({ length: 64 * 1024 * 120 + 5 }, (_, i) => (i * 11 + (i >> 9)) & 0xff)
    alice.send([new File([data as BlobPart], 'big.bin')])
    await new Promise<void>((r) => (bob.onchange = () => bob.pending().length && r()))
    bob.accept(bob.pending()[0]!.id, memorySink())
    const [t] = await settled(bob, 1)
    expect(t!.status).toBe('done')
    const got = new Uint8Array(await t!.blob!.arrayBuffer())
    expect(got.length).toBe(data.length)
    expect(got.every((v, i) => v === data[i])).toBe(true)
  })

  it('reports a lost connection when the relay drops', async () => {
    const { a, alice, bob } = pair()
    alice.send([new File(['x'], 'x')])
    await new Promise<void>((r) => (bob.onchange = () => bob.pending().length && r()))
    a.close()
    const [t] = await settled(alice, 1)
    expect(t!.error).toBe('Connection lost')
  })

  it('gives both devices the same 6 digits for the same session', async () => {
    const code = await relayCode('0123456789abcdef0123456789abcdef')
    expect(code).toMatch(/^\d{6}$/)
    expect(await relayCode('0123456789abcdef0123456789abcdef')).toBe(code)
    expect(await relayCode('fedcba9876543210fedcba9876543210')).not.toBe(code)
  })
})

describe('connect link', () => {
  it('reads the link a phone shows', () => {
    expect(parseConnectUrl('http://192.168.49.1:8080/#pin=4821')).toEqual({ base: 'http://192.168.49.1:8080', pin: '4821' })
    expect(parseConnectUrl(' http://10.0.0.5:39017#pin=0007 ')).toEqual({ base: 'http://10.0.0.5:39017', pin: '0007' })
  })

  it('ignores anything else', () => {
    expect(parseConnectUrl('https://stub-black.vercel.app/#pin=4821')).toBeNull()
    expect(parseConnectUrl('http://192.168.49.1:8080/')).toBeNull()
    expect(parseConnectUrl('WIFI:T:WPA;S:x;P:y;;')).toBeNull()
  })
})
