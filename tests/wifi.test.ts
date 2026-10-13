import { describe, expect, it } from 'vitest'
import { parseWifiQr, toWifiQr } from '../src/pairing/wifi'

describe('Wi-Fi QR', () => {
  it('builds the standard format', () => {
    expect(toWifiQr({ ssid: 'AndroidShare_4821', password: 'k3x9q2mp', security: 'WPA' })).toBe(
      'WIFI:T:WPA;S:AndroidShare_4821;P:k3x9q2mp;;',
    )
  })

  it('round-trips names and passwords with special characters', () => {
    const w = { ssid: 'Café; "Stub", 5:00\\', password: 'p;a,s:s"\\w', security: 'SAE' }
    expect(parseWifiQr(toWifiQr(w))).toEqual(w)
  })

  it('reads codes made by other apps, in any field order', () => {
    expect(parseWifiQr('WIFI:S:Home;T:WPA;P:hunter22;H:false;;')).toEqual({ ssid: 'Home', password: 'hunter22', security: 'WPA' })
    expect(parseWifiQr('WIFI:S:Open net;T:nopass;;')).toEqual({ ssid: 'Open net', password: '', security: 'nopass' })
  })

  it('ignores anything that is not a Wi-Fi code', () => {
    expect(parseWifiQr('oAAEwBGU0eUMYOUo5')).toBeNull()
    expect(parseWifiQr('WIFI:T:WPA;;')).toBeNull()
  })
})
