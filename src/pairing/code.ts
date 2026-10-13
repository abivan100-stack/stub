// A 6-digit code both screens can compare. It is derived from both DTLS fingerprints,
// so a third device sitting in the middle would produce a different number on each side.

export function fingerprintOf(sdp: string): string {
  const m = /^a=fingerprint:(.+)$/m.exec(sdp)
  if (!m?.[1]) throw new Error('No fingerprint in description')
  return m[1].trim().toLowerCase()
}

export async function verificationCode(sdpA: string, sdpB: string): Promise<string> {
  const joined = [fingerprintOf(sdpA), fingerprintOf(sdpB)].sort().join('|')
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined))
  const n = new DataView(hash).getUint32(0) % 1_000_000
  return n.toString().padStart(6, '0')
}
