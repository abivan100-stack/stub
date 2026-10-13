// Shrinks a non-trickle data-channel SDP so it fits in one QR code.
//
// A data-channel-only SDP is mostly boilerplate. Only a handful of values differ per session:
// ICE credentials, the DTLS fingerprint and role, the mid, and the host candidates. We keep those,
// rebuild the rest from a fixed template on the other side, then deflate and base64url the result.
// Payload format: "o" (offer) or "a" (answer) + base64url(deflate-raw(fields joined by "\n")).

interface Fields {
  ufrag: string
  pwd: string
  setup: string
  mid: string
  hashFn: string
  fingerprint: Uint8Array
  candidates: string[]
}

function line(sdp: string, key: string): string {
  const m = new RegExp(`^a=${key}:(.*)$`, 'm').exec(sdp)
  if (!m?.[1]) throw new Error(`SDP has no ${key}`)
  return m[1].trim()
}

export function readFields(sdp: string): Fields {
  const [hashFn = '', hex = ''] = line(sdp, 'fingerprint').split(' ')
  return {
    ufrag: line(sdp, 'ice-ufrag'),
    pwd: line(sdp, 'ice-pwd'),
    setup: line(sdp, 'setup'),
    mid: line(sdp, 'mid'),
    hashFn,
    fingerprint: Uint8Array.from(hex.split(':'), (h) => parseInt(h, 16)),
    candidates: [...sdp.matchAll(/^a=candidate:(.+)$/gm)]
      .map((m) => m[1]!.trim())
      // TCP candidates never help on a local link; the trailing extensions are optional.
      .filter((c) => !/ tcp /i.test(c))
      .map((c) => c.replace(/ (?:generation|network-id|network-cost|ufrag) \S+/g, '')),
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
    ...f.candidates.map((c) => `a=candidate:${c}`),
    `a=ice-ufrag:${f.ufrag}`,
    `a=ice-pwd:${f.pwd}`,
    `a=fingerprint:${f.hashFn} ${hex}`,
    `a=setup:${f.setup}`,
    `a=mid:${f.mid}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n')
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

export async function encodeDescription(desc: RTCSessionDescriptionInit): Promise<string> {
  if (desc.type !== 'offer' && desc.type !== 'answer') throw new Error(`Cannot encode ${desc.type}`)
  const f = readFields(desc.sdp ?? '')
  const text = [f.ufrag, f.pwd, f.setup, f.mid, f.hashFn, toBase64Url(f.fingerprint), ...f.candidates].join('\n')
  const packed = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'))
  return (desc.type === 'offer' ? 'o' : 'a') + toBase64Url(packed)
}

export async function decodeDescription(payload: string): Promise<RTCSessionDescriptionInit> {
  const text = payload.trim()
  const type = text[0] === 'o' ? 'offer' : text[0] === 'a' ? 'answer' : null
  if (!type) throw new Error('Not a Stub pairing code')
  const raw = new TextDecoder().decode(await pipe(fromBase64Url(text.slice(1)), new DecompressionStream('deflate-raw')))
  const [ufrag, pwd, setup, mid, hashFn, fp, ...candidates] = raw.split('\n')
  if (!ufrag || !pwd || !setup || !mid || !hashFn || !fp) throw new Error('Not a Stub pairing code')
  return { type, sdp: writeSdp({ ufrag, pwd, setup, mid, hashFn, fingerprint: fromBase64Url(fp), candidates }) }
}
