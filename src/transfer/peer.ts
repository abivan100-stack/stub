import { chunkCount, packChunk, readChunks, rootHash, sameBytes, sha256, unpackChunk } from './chunk'
import type { SinkFactory, Sink } from './sink'

// Wire protocol over one ordered data channel. Text frames are JSON control messages,
// binary frames are chunks of whichever file the other side is currently sending.
// Each side sends one file at a time, so a binary frame never needs a file id.
type Msg =
  | { t: 'offer'; batch: string; files: { id: string; name: string; size: number; type: string }[] }
  | { t: 'accept'; batch: string }
  | { t: 'decline'; batch: string }
  | { t: 'file'; id: string } // sender: chunks for `id` follow
  | { t: 'end'; id: string; root: string } // sender: last chunk sent, here is the manifest hash
  | { t: 'abort'; id: string } // sender stopped sending `id`
  | { t: 'ok'; id: string } // receiver: verified and saved
  | { t: 'bad'; id: string } // receiver: a checksum did not match
  | { t: 'cancel'; id: string } // receiver: stop sending `id`
  | { t: 'retry'; id: string } // receiver: send `id` again

export type Direction = 'out' | 'in'
export type Status =
  | 'offered' // in: waiting for you to accept
  | 'waiting' // out: waiting for them to accept
  | 'queued'
  | 'active'
  | 'checking' // out: all sent, waiting for their verdict
  | 'done'
  | 'declined'
  | 'cancelled'
  | 'failed'

export const FINISHED: Status[] = ['done', 'declined', 'cancelled', 'failed']

export interface Ticket {
  id: string
  batch: string
  dir: Direction
  name: string
  size: number
  type: string
  chunks: number
  status: Status
  bytes: number
  /** Bytes per second, smoothed. */
  rate: number
  error?: string
  blob?: Blob
  savedTo?: string
}

export interface IncomingBatch {
  id: string
  tickets: Ticket[]
  total: number
}

// Pause sending above HIGH buffered bytes; resume when the browser drains to LOW.
const HIGH = 4 * 1024 * 1024
const LOW = 1024 * 1024

interface Incoming {
  ticket: Ticket
  sink: Sink
  hashes: Uint8Array[]
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

export class Peer {
  tickets: Ticket[] = []
  connected = true
  /** Called after any change. Cheap; the UI batches it to one render per frame. */
  onchange: () => void = () => {}

  private files = new Map<string, Blob>()
  private sinks = new Map<string, SinkFactory>()
  private queue: Ticket[] = []
  private sending = false
  private incoming: Incoming | null = null
  private work: Promise<void> = Promise.resolve()
  private samples = new WeakMap<Ticket, { at: number; bytes: number }>()

  constructor(private ch: RTCDataChannel) {
    ch.bufferedAmountLowThreshold = LOW
    ch.addEventListener('message', (e: MessageEvent) => this.serial(() => this.receive(e.data)))
    ch.addEventListener('close', () => this.serial(() => this.closed()))
  }

  /** Offer files to the other side. They show up as "waiting" until accepted. */
  send(files: File[]): void {
    if (!files.length || !this.connected) return
    const batch = randomId()
    const tickets = files.map((f, i): Ticket => {
      const t = this.ticket(`${batch}-${String(i + 1).padStart(2, '0')}`, batch, 'out', f.name, f.size, f.type)
      t.status = 'waiting'
      this.files.set(t.id, f)
      return t
    })
    this.tickets.push(...tickets)
    this.post({ t: 'offer', batch, files: tickets.map(({ id, name, size, type }) => ({ id, name, size, type })) })
    this.changed()
  }

  pending(): IncomingBatch[] {
    const out = new Map<string, IncomingBatch>()
    for (const t of this.tickets) {
      if (t.dir !== 'in' || t.status !== 'offered') continue
      const b = out.get(t.batch) ?? { id: t.batch, tickets: [], total: 0 }
      b.tickets.push(t)
      b.total += t.size
      out.set(t.batch, b)
    }
    return [...out.values()]
  }

  accept(batch: string, sink: SinkFactory): void {
    this.sinks.set(batch, sink)
    this.inBatch(batch).forEach((t) => (t.status = 'queued'))
    this.post({ t: 'accept', batch })
    this.changed()
  }

  decline(batch: string): void {
    this.inBatch(batch).forEach((t) => (t.status = 'declined'))
    this.post({ t: 'decline', batch })
    this.changed()
  }

  cancel(t: Ticket): void {
    this.serial(async () => {
      if (FINISHED.includes(t.status)) return
      if (t.dir === 'out') {
        t.status = 'cancelled'
        this.post({ t: 'abort', id: t.id })
      } else {
        if (this.incoming?.ticket === t) await this.dropIncoming()
        t.status = 'cancelled'
        this.post({ t: 'cancel', id: t.id })
      }
      this.changed()
    })
  }

  retry(t: Ticket): void {
    if (!this.connected || !['failed', 'cancelled'].includes(t.status)) return
    if (t.dir === 'out') this.enqueue(t)
    else {
      t.status = 'queued'
      t.error = undefined
      this.post({ t: 'retry', id: t.id })
      this.changed()
    }
  }

  // --- internals -------------------------------------------------------------

  private ticket(id: string, batch: string, dir: Direction, name: string, size: number, type: string): Ticket {
    return { id, batch, dir, name, size, type, chunks: chunkCount(size), status: 'queued', bytes: 0, rate: 0 }
  }

  private find(dir: Direction, id: string): Ticket | undefined {
    return this.tickets.find((t) => t.dir === dir && t.id === id)
  }

  private inBatch(batch: string): Ticket[] {
    return this.tickets.filter((t) => t.dir === 'in' && t.batch === batch && t.status === 'offered')
  }

  /** Incoming messages and local cancels run one at a time, in order. */
  private serial(fn: () => void | Promise<void>): void {
    this.work = this.work.then(fn).catch((e) => console.error('[stub] transfer', e))
  }

  private post(m: Msg): void {
    if (this.ch.readyState === 'open') this.ch.send(JSON.stringify(m))
  }

  private changed(): void {
    this.onchange()
  }

  private progress(t: Ticket, n: number): void {
    t.bytes += n
    const now = performance.now()
    const s = this.samples.get(t)
    if (!s) this.samples.set(t, { at: now, bytes: t.bytes })
    else if (now - s.at >= 500) {
      const r = ((t.bytes - s.bytes) * 1000) / (now - s.at)
      t.rate = t.rate ? t.rate * 0.6 + r * 0.4 : r
      this.samples.set(t, { at: now, bytes: t.bytes })
    }
    this.changed()
  }

  private reset(t: Ticket, status: Status): void {
    t.status = status
    t.bytes = 0
    t.rate = 0
    t.error = undefined
    this.samples.delete(t)
  }

  private enqueue(t: Ticket): void {
    this.reset(t, 'queued')
    this.queue.push(t)
    this.changed()
    void this.pump()
  }

  private async pump(): Promise<void> {
    if (this.sending) return
    this.sending = true
    for (let t = this.queue.shift(); t; t = this.queue.shift()) {
      if (t.status !== 'queued') continue
      try {
        await this.sendFile(t)
      } catch {
        if ((t.status as Status) === 'active') {
          t.status = 'failed'
          t.error = 'Connection dropped mid-file'
        }
      }
      this.changed()
    }
    this.sending = false
  }

  private async sendFile(t: Ticket): Promise<void> {
    const file = this.files.get(t.id)
    if (!file) throw new Error('File gone')
    t.status = 'active'
    this.post({ t: 'file', id: t.id })
    const hashes: Uint8Array[] = []
    let index = 0
    const stopped = () => t.status !== 'active' // cancelled by either side while we await
    for await (const data of readChunks(file)) {
      if (stopped()) return
      const { frame, hash } = await packChunk(index++, data)
      hashes.push(hash)
      await this.drain()
      if (stopped()) return
      this.ch.send(frame)
      this.progress(t, data.byteLength)
    }
    t.status = 'checking'
    this.post({ t: 'end', id: t.id, root: await rootHash(hashes) })
  }

  private drain(): Promise<void> {
    if (this.ch.bufferedAmount <= HIGH) return Promise.resolve()
    return new Promise((resolve) => {
      const go = () => {
        this.ch.removeEventListener('bufferedamountlow', go)
        this.ch.removeEventListener('close', go)
        resolve()
      }
      this.ch.addEventListener('bufferedamountlow', go)
      this.ch.addEventListener('close', go)
    })
  }

  private async receive(data: unknown): Promise<void> {
    if (data instanceof ArrayBuffer) return this.chunk(data)
    if (typeof data !== 'string') return
    let m: Msg
    try {
      m = JSON.parse(data)
    } catch {
      return
    }
    switch (m.t) {
      case 'offer':
        for (const f of m.files) {
          const t = this.ticket(f.id, m.batch, 'in', String(f.name), Number(f.size), String(f.type ?? ''))
          t.status = 'offered'
          this.tickets.push(t)
        }
        break
      case 'accept':
        this.tickets.filter((t) => t.dir === 'out' && t.batch === m.batch && t.status === 'waiting').forEach((t) => this.enqueue(t))
        break
      case 'decline':
        this.tickets.filter((t) => t.dir === 'out' && t.batch === m.batch && t.status === 'waiting').forEach((t) => (t.status = 'declined'))
        break
      case 'file':
        await this.startIncoming(m.id)
        break
      case 'end':
        await this.endIncoming(m.id, m.root)
        break
      case 'abort': {
        const t = this.find('in', m.id)
        if (!t || FINISHED.includes(t.status)) break
        if (this.incoming?.ticket === t) await this.dropIncoming()
        t.status = 'cancelled'
        t.error = 'They stopped sending'
        break
      }
      case 'ok':
      case 'bad':
      case 'cancel': {
        const t = this.find('out', m.id)
        if (!t || FINISHED.includes(t.status)) break
        t.status = m.t === 'ok' ? 'done' : m.t === 'bad' ? 'failed' : 'cancelled'
        if (m.t === 'bad') t.error = 'Their copy did not match. Try again.'
        if (m.t === 'cancel') t.error = 'They cancelled it'
        break
      }
      case 'retry': {
        const t = this.find('out', m.id)
        if (t && FINISHED.includes(t.status)) this.enqueue(t)
        break
      }
    }
    this.changed()
  }

  private async startIncoming(id: string): Promise<void> {
    const t = this.find('in', id)
    const sink = t && this.sinks.get(t.batch)
    // Failed or cancelled files can be resent when the sender taps retry.
    if (!t || !sink || !['queued', 'failed', 'cancelled'].includes(t.status)) return
    this.reset(t, 'active')
    try {
      this.incoming = { ticket: t, sink: await sink(t), hashes: [] }
    } catch {
      t.status = 'failed'
      t.error = 'Could not open a file to save into'
      this.post({ t: 'cancel', id })
    }
  }

  private async chunk(frame: ArrayBuffer): Promise<void> {
    const inc = this.incoming
    if (!inc) return // leftovers from a file that was just cancelled
    const { index, hash, data } = unpackChunk(frame)
    if (index !== inc.hashes.length || !sameBytes(await sha256(data as BufferSource), hash)) {
      return this.failIncoming(`Piece ${index + 1} arrived damaged`)
    }
    inc.hashes.push(hash)
    await inc.sink.write(data)
    this.progress(inc.ticket, data.byteLength)
  }

  private async endIncoming(id: string, root: string): Promise<void> {
    const inc = this.incoming
    if (!inc || inc.ticket.id !== id) return
    if (inc.hashes.length !== inc.ticket.chunks || (await rootHash(inc.hashes)) !== root) {
      return this.failIncoming('Final check did not match')
    }
    this.incoming = null
    const t = inc.ticket
    try {
      Object.assign(t, await inc.sink.close())
      t.status = 'done'
      this.post({ t: 'ok', id })
    } catch {
      t.status = 'failed'
      t.error = 'Could not finish writing the file'
      this.post({ t: 'bad', id })
    }
  }

  private async failIncoming(reason: string): Promise<void> {
    const t = this.incoming!.ticket
    await this.dropIncoming()
    t.status = 'failed'
    t.error = reason
    this.post({ t: 'bad', id: t.id })
  }

  private async dropIncoming(): Promise<void> {
    const inc = this.incoming
    this.incoming = null
    await inc?.sink.abort().catch(() => {})
  }

  private async closed(): Promise<void> {
    this.connected = false
    await this.dropIncoming()
    for (const t of this.tickets) {
      if (FINISHED.includes(t.status)) continue
      t.status = 'failed'
      t.error = 'Connection lost'
    }
    this.changed()
  }
}
