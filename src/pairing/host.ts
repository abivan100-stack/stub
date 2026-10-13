// "Connect a laptop" without scanning: the phone (Android app) serves Stub on the local network
// (StubHostServer.java) and the laptop pairs through it with a 4-digit PIN.
import { registerPlugin } from '@capacitor/core'

export interface HostInfo {
  port: number
  pin: string
  addresses: string[]
}

interface StubHost {
  start(): Promise<HostInfo>
  addresses(): Promise<{ addresses: string[] }>
  answer(o: { id: string; answer: string }): Promise<void>
  refuse(o: { id: string; message: string }): Promise<void>
  stop(): Promise<void>
  addListener(event: 'offer', fn: (e: { id: string; offer: string }) => void): Promise<{ remove(): Promise<void> }>
}

const host = registerPlugin<StubHost>('StubHost')

/** Phone side. `onOffer` turns the laptop's code into this phone's answer code. Returns a stop function. */
export async function startHosting(onOffer: (offer: string) => Promise<string>): Promise<{ info: HostInfo; stop: () => void }> {
  const listener = await host.addListener('offer', ({ id, offer }) => {
    onOffer(offer).then(
      (answer) => host.answer({ id, answer }),
      (e: unknown) => host.refuse({ id, message: e instanceof Error ? e.message : String(e) }),
    )
  })
  const info = await host.start()
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

/** Laptop side: send the PIN and our code to the phone, get its answer code back. */
export async function pairThroughPhone(pin: string, offer: string): Promise<string> {
  const r = await fetch('/__stub/pair', { method: 'POST', body: `${pin}\n${offer}`, cache: 'no-store' })
  const text = await r.text()
  if (r.status === 403 || r.status === 429 || r.status === 409) throw new PinError(text)
  if (!r.ok) throw new Error(text)
  return text
}
