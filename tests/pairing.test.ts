import { describe, expect, it } from 'vitest'
import { decodeDescription, encodeDescription, readFields, writeSdp } from '../src/pairing/sdp'
import { FrameCollector, toFrames } from '../src/pairing/frames'
import { verificationCode } from '../src/pairing/code'

// A real Chrome data-channel offer, trimmed of nothing.
const OFFER = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1467250027 1 udp 2122260223 192.168.43.12 53201 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:3018375211 1 tcp 1518280447 192.168.43.12 9 typ host tcptype active generation 0 network-id 1',
  'a=candidate:2999745851 1 udp 2122194687 10.0.0.5 62187 typ host generation 0 network-id 2',
  'a=ice-ufrag:x7Yl',
  'a=ice-pwd:Wq9dN1n2g4s8b0C6f2JpQ3vR',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 5B:9C:0A:18:2D:E1:7F:44:93:C2:66:0F:1A:B7:3E:58:21:D4:9A:6C:F0:13:8E:5D:A7:42:B9:0C:61:E3:7D:28',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n')

describe('SDP compression', () => {
  it('keeps only the values that differ per session', () => {
    const s = writeSdp(readFields(OFFER))
    expect(s).not.toMatch(/msid-semantic|extmap-allow-mixed|tcptype|generation|network-id/)
    expect(s).toMatch(/a=ice-pwd:Wq9dN1n2g4s8b0C6f2JpQ3vR/)
    expect(s).toMatch(/a=fingerprint:sha-256 5B:9C:0A:18:.*:7D:28\r\n/)
    expect(s).toMatch(/192\.168\.43\.12 53201 typ host\r\n/)
    expect(s.match(/a=candidate/g)).toHaveLength(2)
  })

  it('round-trips and stays small enough for one QR code', async () => {
    const payload = await encodeDescription({ type: 'offer', sdp: OFFER })
    expect(payload[0]).toBe('o')
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(payload.length).toBeLessThan(320)
    const back = await decodeDescription(payload)
    expect(back).toEqual({ type: 'offer', sdp: writeSdp(readFields(OFFER)) })
    expect(readFields(back.sdp!)).toEqual(readFields(OFFER))
  })

  it('rejects text that is not a pairing code', async () => {
    await expect(decodeDescription('hello')).rejects.toThrow()
    await expect(decodeDescription('oAAAA')).rejects.toThrow()
  })
})

describe('multi-frame QR', () => {
  it('reassembles frames in any order, with repeats', () => {
    const payload = 'x'.repeat(700) + 'end'
    const frames = toFrames(payload, 300)
    expect(frames).toHaveLength(3)
    const c = new FrameCollector()
    expect(c.add(frames[2]!)).toBeNull()
    expect(c.add(frames[2]!)).toBeNull()
    expect(c.add(frames[0]!)).toBeNull()
    expect(c.received).toBe(2)
    expect(c.add(frames[1]!)).toBe(payload)
  })

  it('uses a single frame for short payloads and accepts a pasted bare code', () => {
    expect(toFrames('abc')).toEqual(['1/1:abc'])
    expect(new FrameCollector().add('1/1:abc')).toBe('abc')
    expect(new FrameCollector().add('  oAbc  ')).toBe('oAbc')
  })

  it('starts over when a different sequence shows up', () => {
    const c = new FrameCollector()
    c.add('1/3:aa')
    expect(c.add('1/2:bb')).toBeNull()
    expect(c.add('2/2:cc')).toBe('bbcc')
  })
})

describe('verification code', () => {
  const answer = OFFER.replace(/5B:9C/, 'AA:BB')
  it('is the same whichever side computes it', async () => {
    const a = await verificationCode(OFFER, answer)
    expect(a).toMatch(/^\d{6}$/)
    expect(await verificationCode(answer, OFFER)).toBe(a)
  })
  it('changes when a fingerprint changes', async () => {
    expect(await verificationCode(OFFER, answer)).not.toBe(await verificationCode(OFFER, OFFER.replace(/5B:9C/, 'CC:DD')))
  })
})
