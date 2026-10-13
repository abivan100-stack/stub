import { beforeEach, describe, expect, it, vi } from 'vitest'

const plugin = {
  startHotspot: vi.fn(),
  startDirectGroup: vi.fn(),
}
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => plugin,
}))

const { startHotspot } = await import('../src/pairing/hotspot')
const net = { ssid: 'DIRECT-ab-Stub', password: 'x7k2m9q4', security: 'WPA' }

describe('startHotspot', () => {
  beforeEach(() => vi.resetAllMocks())

  it('uses the local-only hotspot when it starts', async () => {
    plugin.startHotspot.mockResolvedValue({ ...net, ssid: 'AndroidShare_1' })
    expect((await startHotspot()).ssid).toBe('AndroidShare_1')
    expect(plugin.startDirectGroup).not.toHaveBeenCalled()
  })

  it('falls back to a Wi-Fi Direct group', async () => {
    plugin.startHotspot.mockRejectedValue(new Error('Turn off your phone’s regular hotspot first'))
    plugin.startDirectGroup.mockResolvedValue(net)
    expect(await startHotspot()).toEqual(net)
  })

  it('reports the hotspot error when both fail', async () => {
    plugin.startHotspot.mockRejectedValue(new Error('Turn on Location'))
    plugin.startDirectGroup.mockRejectedValue(new Error('no p2p'))
    await expect(startHotspot()).rejects.toThrow('Turn on Location')
  })
})
