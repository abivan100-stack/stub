import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = {
  capabilities: vi.fn(),
  startHotspot: vi.fn(),
  stopHotspot: vi.fn(),
  startDirectGroup: vi.fn(),
  stopDirectGroup: vi.fn(),
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => plugin,
}))

const { startHotspot, switchHotspot } = await import('../src/pairing/hotspot')
const direct = { ssid: 'DIRECT-st-Stub-K4P2', password: 'x7k2m9q4ab', security: 'WPA', band: '2.4 GHz' }
const loh = { ssid: 'AndroidShare_3589', password: 'tx8jd6dgm7juzkk', security: 'WPA' }

describe('startHotspot', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    plugin.stopHotspot.mockResolvedValue(undefined)
    plugin.stopDirectGroup.mockResolvedValue(undefined)
  })

  it('makes a regular hotspot first, because Windows won’t join "DIRECT-" networks', async () => {
    plugin.startHotspot.mockResolvedValue(loh)
    expect(await startHotspot()).toEqual(loh)
    expect(plugin.startDirectGroup).not.toHaveBeenCalled()
  })

  it('falls back to a Wi-Fi Direct group', async () => {
    plugin.startHotspot.mockRejectedValue(new Error('Turn off your phone’s regular hotspot first'))
    plugin.startDirectGroup.mockResolvedValue(direct)
    expect(await startHotspot()).toEqual(direct)
  })

  it('shows the first error when both fail', async () => {
    plugin.startHotspot.mockRejectedValue(new Error('Turn on Location'))
    plugin.startDirectGroup.mockRejectedValue(new Error('no p2p'))
    await expect(startHotspot()).rejects.toThrow('Turn on Location')
  })

  it('"Can’t see it?" swaps the hotspot for the 2.4 GHz group', async () => {
    plugin.startDirectGroup.mockResolvedValue(direct)
    expect(await switchHotspot(true)).toEqual(direct)
    expect(plugin.stopHotspot).toHaveBeenCalled()
  })

  it('"Laptop can’t connect?" swaps the group for a regular hotspot', async () => {
    plugin.startHotspot.mockResolvedValue(loh)
    expect(await switchHotspot(false)).toEqual(loh)
    expect(plugin.stopDirectGroup).toHaveBeenCalled()
  })
})
