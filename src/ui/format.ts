const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function bytes(n: number): string {
  let i = 0
  while (n >= 1000 && i < UNITS.length - 1) {
    n /= 1000
    i++
  }
  return `${i === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${UNITS[i]}`
}

export function speed(bps: number): string {
  return bps > 0 ? `${bytes(bps)}/s` : ''
}

export function eta(remaining: number, bps: number): string {
  if (bps <= 0) return ''
  const s = Math.ceil(remaining / bps)
  if (s < 60) return `${s} s left`
  if (s < 3600) return `about ${Math.round(s / 60)} min left`
  return `about ${(s / 3600).toFixed(1)} h left`
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "482913" -> "482 913" */
export function spaced(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`
}

// ponytail: object URLs live as long as the page; received blobs are kept in memory anyway.
const urls = new WeakMap<Blob, string>()
export function urlFor(blob: Blob): string {
  let u = urls.get(blob)
  if (!u) urls.set(blob, (u = URL.createObjectURL(blob)))
  return u
}
