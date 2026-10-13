// The Android app's file sink: bytes go to the StubFiles plugin
// (android/app/src/main/java/com/abivan/stub/StubFilesPlugin.java), which writes them into Download/Stub.
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { SinkFactory } from './sink'

interface StubFiles {
  open(o: { name: string; mime: string }): Promise<{ id: string }>
  write(o: { id: string; data: string }): Promise<void>
  close(o: { id: string }): Promise<{ uri: string; savedTo: string }>
  abort(o: { id: string }): Promise<void>
  openFile(o: { uri: string; mime: string }): Promise<void>
}

const files = registerPlugin<StubFiles>('StubFiles')

export const isNative = Capacitor.isNativePlatform()

// Each bridge call costs a JSON round trip, so batch the 64 KB chunks into ~1 MB writes.
const BATCH = 1024 * 1024

function base64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function nativeSink(): SinkFactory {
  return async (meta) => {
    const { id } = await files.open({ name: meta.name, mime: meta.type })
    let parts: Uint8Array[] = []
    let held = 0
    const flush = async () => {
      if (!held) return
      const all = new Uint8Array(held)
      let at = 0
      for (const p of parts) all.set(p, (at += p.length) - p.length)
      parts = []
      held = 0
      await files.write({ id, data: base64(all) })
    }
    return {
      async write(data) {
        parts.push(data)
        held += data.length
        if (held >= BATCH) await flush()
      },
      async close() {
        await flush()
        return files.close({ id })
      },
      async abort() {
        parts = []
        held = 0
        await files.abort({ id })
      },
    }
  }
}

export function openSaved(uri: string, mime: string): Promise<void> {
  // The only expected failure is "No app on this phone can open this file"; tell the user plainly.
  return files.openFile({ uri, mime: mime || '*/*' }).catch((e: Error) => alert(e.message))
}

// Background transfers: a foreground service (TransferService.java) keeps the app, CPU and Wi-Fi awake.
interface StubTransfer {
  keepAlive(o: { title: string; text: string; percent: number }): Promise<void>
  release(): Promise<void>
}

const transfer = registerPlugin<StubTransfer>('StubTransfer')
let held = false
let lastUpdate = 0

/** Call on every progress change while files are moving; updates the notification at most once a second. */
export function keepAlive(title: string, text: string, percent: number): void {
  if (!isNative) return
  const now = Date.now()
  if (held && now - lastUpdate < 1000) return
  held = true
  lastUpdate = now
  // If Android refuses (e.g. the daily background budget is spent), the transfer still runs while Stub is open.
  transfer.keepAlive({ title, text, percent }).catch(() => {})
}

export function release(): void {
  if (!isNative || !held) return
  held = false
  transfer.release().catch(() => {})
}

// Share sheet: files other apps send to Stub (StubSharePlugin.java).
interface SharedFile {
  uri: string
  name: string
  type: string
  size: number
}
interface StubShare {
  take(): Promise<{ files: SharedFile[] }>
  addListener(event: 'shared', fn: () => void): Promise<{ remove(): Promise<void> }>
}

const share = registerPlugin<StubShare>('StubShare')

/** Files shared into Stub since the last call, as ordinary File objects. Empty on the web. */
export async function takeShared(): Promise<File[]> {
  if (!isNative) return []
  const { files } = await share.take()
  // Capacitor serves content:// URIs from its local server, so fetch can read them.
  // ponytail: each file becomes a Blob before sending; Chromium spills large blobs to disk,
  // but a native streaming reader is the upgrade if multi-GB shares strain memory.
  return Promise.all(
    files.map(async (f) => {
      const blob = await (await fetch(Capacitor.convertFileSrc(f.uri))).blob()
      return new File([blob], f.name, { type: f.type || blob.type })
    }),
  )
}

/** Runs `fn` whenever files are shared while Stub is already open. */
export function onShared(fn: () => void): void {
  if (isNative) void share.addListener('shared', fn)
}
