import { sha256 } from '../sha256'

// A 6-digit code both screens can compare. It is derived from both DTLS fingerprints,
// so a third device sitting in the middle would produce a different number on each side.

export function fingerprintOf(sdp: string): string {
  const m = /^a=fingerprint:(.+)$/m.exec(sdp)
  if (!m?.[1]) throw new Error('No fingerprint in description')
  return m[1].trim().toLowerCase()
}

export async function verificationCode(sdpA: string, sdpB: string): Promise<string> {
  const joined = [fingerprintOf(sdpA), fingerprintOf(sdpB)].sort().join('|')
  const hash = await sha256(new TextEncoder().encode(joined))
  const n = new DataView(hash.buffer, hash.byteOffset).getUint32(0) % 1_000_000
  return n.toString().padStart(6, '0')
}
