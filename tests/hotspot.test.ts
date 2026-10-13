import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = {
  capabilities: vi.fn(),
  startHotspot: vi.fn(),
  stopHotspot: vi.fn(),
  startDirectGroup: vi.fn(),
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => plugin,
}))

const { startHotspot, startHotspot24 } = await import('../src/pairing/hotspot')
const direct = { ssid: 'DIRECT-st-Stub-K4P2', password: 'x7k2m9q4ab', security: 'WPA', band: '2.4 GHz' }
const loh = (band?: string) => ({ ssid: 'AndroidShare_3589', password: 'tx8jd6dgm7juzkk', security: 'WPA', band })

describe('startHotspot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    plugin.stopHotspot.mockResolvedValue(undefined)
  })
  const android = (ten: boolean) => plugin.capabilities.mockResolvedValue({ hotspot: true, join: ten })

  it('Android 10+: makes a 2.4 GHz Wi-Fi Direct network first', async () => {
    android(true)
    plugin.startDirectGroup.mockResolvedValue(direct)
    expect(await startHotspot()).toEqual(direct)
    expect(plugin.startHotspot).not.toHaveBeenCalled()
  })

  it('Android 10+: falls back to the local-only hotspot', async () => {
    android(true)
    plugin.startDirectGroup.mockRejectedValue(new Error('no p2p'))
    plugin.startHotspot.mockResolvedValue(loh())
    expect((await startHotspot()).ssid).toBe('AndroidShare_3589')
  })

  it('Android 8 and 9: local-only hotspot first, Wi-Fi Direct as fallback', async () => {
    android(false)
    plugin.startHotspot.mockResolvedValue(loh())
    expect((await startHotspot()).ssid).toBe('AndroidShare_3589')
    plugin.startHotspot.mockRejectedValue(new Error('Turn off your phone’s regular hotspot first'))
    plugin.startDirectGroup.mockResolvedValue(direct)
    expect(await startHotspot()).toEqual(direct)
  })

  it('shows the first error when both fail', async () => {
    android(false)
    plugin.startHotspot.mockRejectedValue(new Error('Turn on Location'))
    plugin.startDirectGroup.mockRejectedValue(new Error('no p2p'))
    await expect(startHotspot()).rejects.toThrow('Turn on Location')
  })

  it('"Can’t see it?" switches to the 2.4 GHz group', async () => {
    plugin.startDirectGroup.mockResolvedValue(direct)
    expect(await startHotspot24()).toEqual(direct)
    expect(plugin.stopHotspot).toHaveBeenCalled()
  })
})
