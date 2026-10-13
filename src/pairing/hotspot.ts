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
 * Android 10+: a Wi-Fi Direct group pinned to 2.4 GHz first, because phones may put a local-only
 * hotspot on 5 or 6 GHz (apps can't choose or even read that band) and many laptops can't see those.
 * Android 8 and 9: the local-only hotspot first. Either way the other kind is the fallback, and if
 * both fail the first error is the one shown.
 */
export async function startHotspot(): Promise<WifiCredentials> {
  const { join: android10 } = await wifi.capabilities()
  const [first, second] = android10
    ? [() => wifi.startDirectGroup(), () => wifi.startHotspot()]
    : [() => wifi.startHotspot(), () => wifi.startDirectGroup()]
  try {
    return await first()
  } catch (firstError) {
    try {
      return await second()
    } catch {
      throw firstError
    }
  }
}

/** "Can't see this Wi-Fi?": swap whatever is running for a 2.4 GHz Wi-Fi Direct group. */
export async function startHotspot24(): Promise<WifiCredentials> {
  await wifi.stopHotspot().catch(() => {})
  return wifi.startDirectGroup()
}

export const joinWifi = (w: WifiCredentials): Promise<{ ssid: string }> => wifi.joinWifi(w)

/** Undo whichever of the two this device did. Safe to call any time. */
export function stopWifi(): void {
  if (!Capacitor.isNativePlatform()) return
  wifi.stopHotspot().catch(() => {})
  wifi.stopDirectGroup().catch(() => {})
  wifi.leaveWifi().catch(() => {})
}
