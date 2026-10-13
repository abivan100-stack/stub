// The standard Wi-Fi QR format ("WIFI:T:WPA;S:name;P:password;;"), which Android and iPhone
// camera apps already understand. Stub shows one when it makes a hotspot, so the other phone
// can join with Stub or with its own camera app.

export interface WifiCredentials {
  ssid: string
  password: string
  /** "WPA" (WPA/WPA2), "SAE" (WPA3) or "nopass". */
  security: string
  /** Set when this phone made the network: "2.4 GHz", "5 GHz" or "6 GHz". Not part of the QR code. */
  band?: string
}

const escape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1')

export function toWifiQr(w: WifiCredentials): string {
  const pass = w.security === 'nopass' ? '' : `P:${escape(w.password)};`
  return `WIFI:T:${w.security};S:${escape(w.ssid)};${pass};`
}

/** Returns the credentials if `text` is a Wi-Fi QR code, otherwise null. */
export function parseWifiQr(text: string): WifiCredentials | null {
  const body = text.trim()
  if (!/^WIFI:/i.test(body)) return null
  const fields: Record<string, string> = {}
  // Split on unescaped ";" and read KEY:value pairs, unescaping \x.
  for (const m of body.slice(5).matchAll(/([A-Z]):((?:\\.|[^;\\])*);/gi)) {
    fields[m[1]!.toUpperCase()] = m[2]!.replace(/\\(.)/g, '$1')
  }
  if (!fields.S) return null
  return { ssid: fields.S, password: fields.P ?? '', security: fields.T || (fields.P ? 'WPA' : 'nopass') }
}
