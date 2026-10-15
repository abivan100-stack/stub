// "Connect another device": the phone (Android app) serves Stub on every network it's on, including
// its own hotspot (StubHostServer.java). Another device pairs with the phone's 4-digit PIN, and the two
// then talk through the phone's WebSocket relay (relay.ts) instead of WebRTC.
import { registerPlugin } from '@capacitor/core'
import { relayLink } from './relay'
import type { Link } from './session'

export interface HostInfo {
  port: number
  pin: string
  addresses: string[]
}

interface StubHost {
  start(): Promise<HostInfo>
  addresses(): Promise<{ addresses: string[] }>
  stop(): Promise<void>
  addListener(event: 'guest', fn: (e: { token: string }) => void): Promise<{ remove(): Promise<void> }>
}

const host = registerPlugin<StubHost>('StubHost')

/**
 * Phone side. Starts the server; when a device enters the PIN, joins the relay and calls `onLink`.
 * Returns the server's details and a stop function.
 */
export async function startHosting(
  onLink: (link: Link) => void,
  onError: (e: unknown) => void,
): Promise<{ info: HostInfo; stop: () => void }> {
  let info: HostInfo | null = null
  const listener = await host.addListener('guest', ({ token }) => {
    relayLink(`ws://127.0.0.1:${info!.port}`, 'phone', token).then(onLink, onError)
  })
  info = await host.start()
  return {
    info,
    stop: () => {
      host.stop().catch(() => {})
      listener.remove()
    },
  }
}

export async function hostAddresses(): Promise<string[]> {
  return (await host.addresses()).addresses
}

/** Laptop side: true when this page was served by a Stub phone rather than the website. */
export async function servedByPhone(): Promise<boolean> {
  if (location.protocol !== 'http:') return false
  try {
    const r = await fetch('/__stub/host', { cache: 'no-store' })
    return r.ok && (await r.text()) === 'stub'
  } catch {
    return false
  }
}

export class PinError extends Error {}

/**
 * Guest side: send the PIN to the phone and join its relay.
 * `base` is "" when this page was served by the phone, or "http://ip:port" from the Android app.
 */
export async function pairThroughPhone(pin: string, base = ''): Promise<Link> {
  let r: Response
  try {
    r = await fetch(`${base}/__stub/pair`, { method: 'POST', body: pin, cache: 'no-store' })
  } catch {
    throw new Error('Couldn’t reach the phone. Make sure this device is on the phone’s Wi-Fi.')
  }
  const text = await r.text()
  if (r.status === 403 || r.status === 429 || r.status === 409) throw new PinError(text)
  if (!r.ok) throw new Error(text)
  const wsBase = base ? base.replace(/^http/, 'ws') : `ws://${location.host}`
  return relayLink(wsBase, 'guest', text.trim())
}

/** A connect link a phone shows as a QR code: http://192.168.49.1:8080/#pin=4821 */
export function parseConnectUrl(text: string): { base: string; pin: string } | null {
  const m = /^(http:\/\/\d{1,3}(?:\.\d{1,3}){3}:\d{1,5})\/?#pin=(\d{4})$/.exec(text.trim())
  return m ? { base: m[1]!, pin: m[2]! } : null
}
