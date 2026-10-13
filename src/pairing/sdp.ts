// Shrinks a non-trickle data-channel SDP so it fits in a small QR code.
//
// A data-channel-only SDP is mostly boilerplate. Only a handful of values differ per session:
// ICE credentials, the DTLS fingerprint and role, the mid, and the host candidates' addresses.
// We pack just those as bytes and rebuild the rest from a fixed template on the other side.
//
// Payload: "o" (offer) or "a" (answer) + base64url of
//   [setup u8][mid len u8][mid][ufrag len u8][ufrag][pwd len u8][pwd][sha-256 fingerprint 32 bytes]
//   then per candidate: [kind u8: 4 = IPv4, 6 = IPv6, 1 = mDNS uuid.local][address bytes][port u16]
// A typical offer is about 100 characters.

export interface Candidate {
  addr: string
  port: number
}

export interface Fields {
  ufrag: string
  pwd: string
  setup: string
  mid: string
  fingerprint: Uint8Array
  candidates: Candidate[]
}

const SETUP = ['actpass', 'active', 'passive']
const UUID_LOCAL = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i

function line(sdp: string, key: string): string {
  const m = new RegExp(`^a=${key}:(.*)$`, 'm').exec(sdp)
  if (!m?.[1]) throw new Error(`SDP has no ${key}`)
  return m[1].trim()
}

export function readFields(sdp: string): Fields {
  const [hashFn, hex = ''] = line(sdp, 'fingerprint').split(' ')
  if (hashFn?.toLowerCase() !== 'sha-256') throw new Error(`Unsupported fingerprint ${hashFn}`)
  const candidates: Candidate[] = []
  // "foundation component udp priority ADDRESS PORT typ host ..."; TCP never helps on a local link.
  for (const [, addr, port] of sdp.matchAll(/^a=candidate:\S+ \d+ udp \d+ (\S+) (\d+) typ host/gim)) {
    candidates.push({ addr: addr!, port: Number(port) })
  }
  return {
    ufrag: line(sdp, 'ice-ufrag'),
    pwd: line(sdp, 'ice-pwd'),
    setup: line(sdp, 'setup'),
    mid: line(sdp, 'mid'),
    fingerprint: Uint8Array.from(hex.split(':'), (h) => parseInt(h, 16)),
    candidates,
  }
}

export function writeSdp(f: Fields): string {
  const hex = Array.from(f.fingerprint, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':')
  return [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    `a=group:BUNDLE ${f.mid}`,
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    // Foundation and priority are ours to choose for remote candidates; keep the original order.
    ...f.candidates.map((c, i) => `a=candidate:${i + 1} 1 udp ${2122260223 - i} ${c.addr} ${c.port} typ host`),
    `a=ice-ufrag:${f.ufrag}`,
    `a=ice-pwd:${f.pwd}`,
    `a=fingerprint:sha-256 ${hex}`,
    `a=setup:${f.setup}`,
    `a=mid:${f.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n')
}

// --- addresses <-> bytes -------------------------------------------------------

function ipv6Bytes(addr: string): number[] | null {
  const [head = '', tail, extra] = addr.split('::')
  if (extra !== undefined) return null
  const a = head ? head.split(':') : []
  const b = tail ? tail.split(':') : []
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])
}

function addrBytes(addr: string): number[] | null {
  const v4 = addr.split('.')
  if (v4.length === 4 && v4.every((p) => /^\d{1,3}$/.test(p) && +p < 256)) return [4, ...v4.map(Number)]
  const uuid = UUID_LOCAL.exec(addr)
  if (uuid) return [1, ...(uuid.slice(1).join('').match(/../g) ?? []).map((h) => parseInt(h, 16))]
  const v6 = ipv6Bytes(addr)
  return v6 && [6, ...v6]
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function readAddr(kind: number, b: Uint8Array): string {
  if (kind === 4) return b.join('.')
  if (kind === 6) return (hex(b).match(/..../g) ?? []).map((g) => g.replace(/^0{1,3}/, '')).join(':')
  const h = hex(b)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`
}

const ADDR_LEN: Record<number, number> = { 4: 4, 6: 16, 1: 16 }

export function pack(f: Fields): Uint8Array {
  const text = (s: string) => {
    const b = new TextEncoder().encode(s)
    if (b.length > 255) throw new Error('Field too long')
    return [b.length, ...b]
  }
  const setup = SETUP.indexOf(f.setup)
  if (setup < 0 || f.fingerprint.length !== 32) throw new Error('Unexpected SDP')
  const out = [setup, ...text(f.mid), ...text(f.ufrag), ...text(f.pwd), ...f.fingerprint]
  for (const c of f.candidates) {
    const a = addrBytes(c.addr)
    if (a) out.push(...a, c.port >> 8, c.port & 0xff) // unknown address forms are skipped
  }
  return Uint8Array.from(out)
}

export function unpack(b: Uint8Array): Fields {
  let i = 0
  const take = (n: number) => {
    if (i + n > b.length) throw new Error('Truncated')
    return b.subarray(i, (i += n))
  }
  const text = () => new TextDecoder().decode(take(take(1)[0]!))
  const setup = SETUP[take(1)[0]!]
  if (!setup) throw new Error('Bad setup')
  const mid = text()
  const ufrag = text()
  const pwd = text()
  const fingerprint = take(32).slice()
  const candidates: Candidate[] = []
  while (i < b.length) {
    const kind = take(1)[0]!
    const len = ADDR_LEN[kind]
    if (!len) throw new Error('Bad candidate')
    const addr = readAddr(kind, take(len))
    const [hi, lo] = take(2)
    candidates.push({ addr, port: (hi! << 8) | lo! })
  }
  return { ufrag, pwd, setup, mid, fingerprint, candidates }
}

// --- text ----------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export async function encodeDescription(desc: RTCSessionDescriptionInit): Promise<string> {
  if (desc.type !== 'offer' && desc.type !== 'answer') throw new Error(`Cannot encode ${desc.type}`)
  return (desc.type === 'offer' ? 'o' : 'a') + toBase64Url(pack(readFields(desc.sdp ?? '')))
}

// QR form: the same bytes in base32 behind an uppercase type letter ("O" / "A").
// Every character is in QR's alphanumeric set, which packs 5.5 bits per character
// instead of byte mode's 8, so the code has fewer, larger squares and scans more easily.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function toBase32(bytes: Uint8Array): string {
  let out = ''
  let bits = 0
  let value = 0
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) out += B32[(value >>> (bits -= 5)) & 31]
  }
  if (bits) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function fromBase32(text: string): Uint8Array {
  const out: number[] = []
  let bits = 0
  let value = 0
  for (const c of text.toUpperCase()) {
    const v = B32.indexOf(c)
    if (v < 0) throw new Error('Not base32')
    value = ((value << 5) | v) & 0xffff
    bits += 5
    if (bits >= 8) out.push((value >>> (bits -= 8)) & 0xff)
  }
  return Uint8Array.from(out)
}

/** "oAbc…" (text form) to "OMFRG…" (QR form). Anything else is returned unchanged. */
export function toQrForm(payload: string): string {
  if (!/^[oa][A-Za-z0-9_-]+$/.test(payload)) return payload
  return payload[0]!.toUpperCase() + toBase32(fromBase64Url(payload.slice(1)))
}

export async function decodeDescription(payload: string): Promise<RTCSessionDescriptionInit> {
  const text = payload.trim()
  const type = /^[oO]/.test(text) ? 'offer' : /^[aA]/.test(text) ? 'answer' : null
  if (!type) throw new Error('Not a Stub pairing code')
  const bytes = /^[OA][A-Z2-7]+$/.test(text) ? fromBase32(text.slice(1)) : fromBase64Url(text.slice(1))
  const f = unpack(bytes)
  if (!f.ufrag || !f.pwd || !f.mid) throw new Error('Not a Stub pairing code')
  return { type, sdp: writeSdp(f) }
}
