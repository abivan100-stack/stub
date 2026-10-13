// Android app only: make a local-only hotspot, or join one from its Wi-Fi QR code (StubWifiPlugin.java).
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { WifiCredentials } from './wifi'

interface StubWifi {
  capabilities(): Promise<{ hotspot: boolean; join: boolean }>
  startHotspot(): Promise<WifiCredentials>
  stopHotspot(): Promise<void>
  startDirectGroup(): Promise<WifiCredentials>
  stopDirectGroup(): Promise<void>
  joinWifi(w: WifiCredentials): Promise<{ ssid: string }>
  leaveWifi(): Promise<void>
}

const wifi = registerPlugin<StubWifi>('StubWifi')

export async function wifiCapabilities(): Promise<{ hotspot: boolean; join: boolean }> {
  if (!Capacitor.isNativePlatform()) return { hotspot: false, join: false }
  return wifi.capabilities()
}

/**
 * Makes a network the other phone can join: a local-only hotspot, or, if the phone refuses one
 * (regular hotspot on, no free channel, carrier block), a Wi-Fi Direct group, which phones can
 * join like any Wi-Fi network. If both fail, the hotspot's error is the one worth showing.
 */
export async function startHotspot(): Promise<WifiCredentials> {
  try {
    return await wifi.startHotspot()
  } catch (hotspotError) {
    try {
      return await wifi.startDirectGroup()
    } catch {
      throw hotspotError
    }
  }
}
export const joinWifi = (w: WifiCredentials): Promise<{ ssid: string }> => wifi.joinWifi(w)

/** Undo whichever of the two this device did. Safe to call any time. */
export function stopWifi(): void {
  if (!Capacitor.isNativePlatform()) return
  wifi.stopHotspot().catch(() => {})
  wifi.stopDirectGroup().catch(() => {})
  wifi.leaveWifi().catch(() => {})
}
