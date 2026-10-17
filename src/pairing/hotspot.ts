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
 * Makes a network the other device can join, with no internet and mobile data untouched.
 * A local-only hotspot first: it has an ordinary name, and Windows refuses to join networks named
 * "DIRECT-..." (which Android forces on every Wi-Fi Direct group). If it fails, a Wi-Fi Direct group.
 * If both fail the first error is the one shown.
 */
export async function startHotspot(): Promise<WifiCredentials> {
  try {
    return await wifi.startHotspot()
  } catch (firstError) {
    try {
      return await wifi.startDirectGroup()
    } catch {
      throw firstError
    }
  }
}

/**
 * Swap the running network for the other kind. To Wi-Fi Direct (pinned to 2.4 GHz) when a phone
 * can't see a hotspot on 5 or 6 GHz; to a local-only hotspot when a laptop can't join "DIRECT-...".
 */
export async function switchHotspot(toDirect: boolean): Promise<WifiCredentials> {
  if (toDirect) {
    await wifi.stopHotspot().catch(() => {})
    return wifi.startDirectGroup()
  }
  await wifi.stopDirectGroup().catch(() => {})
  return wifi.startHotspot()
}

export const joinWifi = (w: WifiCredentials): Promise<{ ssid: string }> => wifi.joinWifi(w)

/** Undo whichever of the two this device did. Safe to call any time. */
export function stopWifi(): void {
  if (!Capacitor.isNativePlatform()) return
  wifi.stopHotspot().catch(() => {})
  wifi.stopDirectGroup().catch(() => {})
  wifi.leaveWifi().catch(() => {})
}
