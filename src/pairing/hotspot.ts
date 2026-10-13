// Android app only: make a local-only hotspot, or join one from its Wi-Fi QR code (StubWifiPlugin.java).
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { WifiCredentials } from './wifi'

interface StubWifi {
  capabilities(): Promise<{ hotspot: boolean; join: boolean }>
  startHotspot(): Promise<WifiCredentials>
  stopHotspot(): Promise<void>
  joinWifi(w: WifiCredentials): Promise<{ ssid: string }>
  leaveWifi(): Promise<void>
}

const wifi = registerPlugin<StubWifi>('StubWifi')

export async function wifiCapabilities(): Promise<{ hotspot: boolean; join: boolean }> {
  if (!Capacitor.isNativePlatform()) return { hotspot: false, join: false }
  return wifi.capabilities()
}

export const startHotspot = (): Promise<WifiCredentials> => wifi.startHotspot()
export const joinWifi = (w: WifiCredentials): Promise<{ ssid: string }> => wifi.joinWifi(w)

/** Undo whichever of the two this device did. Safe to call any time. */
export function stopWifi(): void {
  if (!Capacitor.isNativePlatform()) return
  wifi.stopHotspot().catch(() => {})
  wifi.leaveWifi().catch(() => {})
}
