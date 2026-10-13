import { describe, expect, it } from 'vitest'
import { decodeDirect, directUrl, encodeDirect, formatDirect } from '../src/pairing/directcode'

describe('direct code', () => {
  it('fits a home-network address, port 8080 and the PIN in 7 characters', () => {
    const code = encodeDirect({ ip: '192.168.0.177', port: 8080, pin: '4821' })
    expect(code).toHaveLength(7)
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/)
    expect(decodeDirect(code)).toEqual({ ip: '192.168.0.177', port: 8080, pin: '4821' })
  })

  it('round-trips every address kind, custom ports and leading-zero PINs', () => {
    for (const t of [
      { ip: '192.168.49.1', port: 8080, pin: '0007' }, // Stub's own Wi-Fi Direct network
      { ip: '10.42.0.15', port: 8080, pin: '9999' },
      { ip: '172.20.10.2', port: 8080, pin: '1234' }, // iPhone hotspot range
      { ip: '100.64.3.9', port: 41234, pin: '0000' },
      { ip: '192.168.1.20', port: 39017, pin: '5050' },
    ]) {
      expect(decodeDirect(encodeDirect(t))).toEqual(t)
    }
  })

  it('reads codes the way people type them', () => {
    const code = encodeDirect({ ip: '192.168.0.177', port: 8080, pin: '4821' })
    expect(decodeDirect(formatDirect(code).toLowerCase())).not.toBeNull()
    expect(decodeDirect(` ${formatDirect(code)} `)).toEqual(decodeDirect(code))
    // Crockford: I and L mean 1, O means 0.
    expect(decodeDirect('1O')).toEqual(decodeDirect('10'))
  })

  it('rejects text that is not a code', () => {
    expect(decodeDirect('')).toBeNull()
    expect(decodeDirect('hello!')).toBeNull()
    expect(decodeDirect('ZZZZZZZ')).toBeNull() // PIN out of range
    expect(decodeDirect('7KQ')).toBeNull() // too short
  })

  it('points at the page the phone serves, PIN in the fragment (never sent over the network)', () => {
    expect(directUrl({ ip: '192.168.0.177', port: 8080, pin: '4821' })).toBe('http://192.168.0.177:8080/#pin=4821')
  })
})
