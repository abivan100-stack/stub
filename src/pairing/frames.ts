// Splits a long payload across several QR codes shown in a loop: "2/3:<slice>".
// A payload that fits in one code goes out as is, with no header.

const FRAME_SIZE = 320
const FRAME = /^(\d+)\/(\d+):(.*)$/s

export function toFrames(payload: string, size = FRAME_SIZE): string[] {
  const n = Math.max(1, Math.ceil(payload.length / size))
  if (n === 1) return [payload]
  return Array.from({ length: n }, (_, i) => `${i + 1}/${n}:${payload.slice(i * size, (i + 1) * size)}`)
}

export class FrameCollector {
  private parts: (string | undefined)[] = []
  total = 0

  get received(): number {
    return this.parts.filter((p) => p !== undefined).length
  }

  /** Feed one scanned or pasted string. Returns the full payload once every frame is in. */
  add(text: string): string | null {
    const m = FRAME.exec(text.trim())
    if (!m) return text.trim() || null // a pasted full code has no frame header
    const i = Number(m[1])
    const n = Number(m[2])
    if (n < 1 || i < 1 || i > n) return null
    if (n !== this.total) {
      this.parts = []
      this.total = n
    }
    this.parts[i - 1] = m[3] ?? ''
    return this.received === n ? this.parts.join('') : null
  }
}
