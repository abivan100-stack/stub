// Where received bytes go: straight to a folder on disk (Chromium), into memory as a Blob,
// or, in the Android app, into Download/Stub (see native.ts).

export interface SinkResult {
  blob?: Blob
  savedTo?: string
  /** content:// URI of the saved file in the Android app, for opening it in another app. */
  uri?: string
}

export interface Sink {
  write(data: Uint8Array): Promise<void>
  close(): Promise<SinkResult>
  abort(): Promise<void>
}

export interface FileMeta {
  name: string
  type: string
  size: number
}

export type SinkFactory = (meta: FileMeta) => Promise<Sink>

/** Above this, holding a file in memory risks the tab being killed (iOS Safari especially). */
export const MEMORY_LIMIT = 500 * 1024 * 1024

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>
  }
}

export const canStreamToDisk = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export function memorySink(): SinkFactory {
  return async (meta) => {
    let parts: BlobPart[] = []
    return {
      async write(data) {
        parts.push(data as BlobPart)
      },
      async close() {
        const blob = new Blob(parts, { type: meta.type || 'application/octet-stream' })
        parts = []
        return { blob }
      },
      async abort() {
        parts = []
      },
    }
  }
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 200) || 'file'
}

async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${ext}`
    try {
      await dir.getFileHandle(candidate)
    } catch {
      return candidate
    }
  }
}

export function folderSink(dir: FileSystemDirectoryHandle): SinkFactory {
  return async (meta) => {
    const name = await freeName(dir, safeName(meta.name))
    const handle = await dir.getFileHandle(name, { create: true })
    const out = await handle.createWritable()
    return {
      write: (data) => out.write(data as BufferSource),
      async close() {
        await out.close()
        return { savedTo: `${dir.name}/${name}` }
      },
      async abort() {
        await out.abort()
        await dir.removeEntry(name).catch(() => {})
      },
    }
  }
}
