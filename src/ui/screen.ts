// Keep the screen readable while a code is showing: full brightness and no timeout in the Android app
// (StubScreenPlugin.java), a screen wake lock on the web (brightness can't be set from a web page).
import { Capacitor, registerPlugin } from '@capacitor/core'

const screen = registerPlugin<{ bright(o: { on: boolean }): Promise<void> }>('StubScreen')
let users = 0
let lock: { release(): Promise<void> } | null = null

function set(on: boolean) {
  if (Capacitor.isNativePlatform()) return void screen.bright({ on }).catch(() => {})
  if (!on) return void lock?.release().catch(() => {})
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock
  wl?.request('screen').then((l) => (lock = l)).catch(() => {})
}

/** Brighten while at least one caller holds it; call the returned function to let go. */
export function brighten(): () => void {
  if (users++ === 0) set(true)
  return () => {
    if (--users === 0) set(false)
  }
}
