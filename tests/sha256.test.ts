import { describe, expect, it } from 'vitest'
import { sha256Js } from '../src/sha256'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

describe('JS SHA-256 fallback', () => {
  it('matches the published test vectors', () => {
    expect(hex(sha256Js(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex(sha256Js(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('matches WebCrypto for every length around block boundaries and a full chunk', async () => {
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 65536]) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff)
      const want = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
      expect(hex(sha256Js(data))).toBe(hex(want))
    }
  })
})
