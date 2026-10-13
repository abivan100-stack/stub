// Android app only: tap-to-pair. The sender poses as an NFC tag holding its codes (StubTagService.java),
// the receiver reads them in reader mode (StubNfcPlugin.java). On the web every call is a no-op.
import { Capacitor, registerPlugin } from '@capacitor/core'

interface StubNfc {
  status(): Promise<{ read: boolean; share: boolean; enabled: boolean }>
  share(o: { records: string[] }): Promise<void>
  stopShare(): Promise<void>
  startReading(): Promise<void>
  stopReading(): Promise<void>
  addListener(event: 'tag', fn: (e: { records: string[] }) => void): Promise<{ remove(): Promise<void> }>
}

const nfc = registerPlugin<StubNfc>('StubNfc')
const native = Capacitor.isNativePlatform()

export async function nfcStatus(): Promise<{ read: boolean; share: boolean; enabled: boolean }> {
  if (!native) return { read: false, share: false, enabled: false }
  return nfc.status().catch(() => ({ read: false, share: false, enabled: false }))
}

/** Offer these codes (in order) to a phone that taps this one. Pass [] to stop. */
export function shareByNfc(records: string[]): void {
  if (!native) return
  ;(records.length ? nfc.share({ records }) : nfc.stopShare()).catch(() => {})
}

/** Calls `onRecords` for each tap until the returned function is called. */
export function readByNfc(onRecords: (records: string[]) => void): () => void {
  if (!native) return () => {}
  const listener = nfc.addListener('tag', (e) => onRecords(e.records))
  nfc.startReading().catch(() => {})
  return () => {
    nfc.stopReading().catch(() => {})
    listener.then((l) => l.remove())
  }
}
