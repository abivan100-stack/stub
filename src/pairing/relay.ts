// The phone relay: both devices connect a WebSocket to the phone's StubHostServer, which passes
// frames between them. Used whenever a device pairs through a phone ("Connect another device"),
// because when a phone is the hotspot, Android's WebView can't use WebRTC on that network.
import { sha256 } from '../sha256'
import type { Link } from './session'

/**
 * Makes a WebSocket look like the RTCDataChannel that transfer/Peer expects: readyState strings,
 * bufferedAmount, and a "bufferedamountlow" event (WebSocket has none, so it's polled while draining).
 */
class WsChannel extends EventTarget {
  bufferedAmountLowThreshold = 0
  private draining = false

  constructor(private ws: WebSocket) {
    super()
    ws.binaryType = 'arraybuffer'
    ws.addEventListener('message', (e) => this.dispatchEvent(new MessageEvent('message', { data: e.data })))
    ws.addEventListener('close', () => this.dispatchEvent(new Event('close')))
  }

  get readyState(): RTCDataChannelState {
    return (['connecting', 'open', 'closing', 'closed'] as const)[this.ws.readyState] ?? 'closed'
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount
  }

  send(data: string | ArrayBuffer): void {
    this.ws.send(data)
    this.watch()
  }

  close(): void {
    this.ws.close()
  }

  private watch() {
    if (this.draining || this.ws.bufferedAmount <= this.bufferedAmountLowThreshold) return
    this.draining = true
    const tick = () => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        this.draining = false
      } else if (this.ws.bufferedAmount <= this.bufferedAmountLowThreshold) {
        this.draining = false
        this.dispatchEvent(new Event('bufferedamountlow'))
      } else {
        setTimeout(tick, 20)
      }
    }
    setTimeout(tick, 20)
  }
}

export function wsChannel(ws: WebSocket): RTCDataChannel {
  return new WsChannel(ws) as unknown as RTCDataChannel
}

/** Both devices hold the same session token, so both show the same 6 digits. */
export async function relayCode(token: string): Promise<string> {
  const hash = await sha256(new TextEncoder().encode(`stub-relay|${token}`))
  return (new DataView(hash.buffer, hash.byteOffset).getUint32(0) % 1_000_000).toString().padStart(6, '0')
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const fail = () => {
      clearTimeout(timer)
      reject(new Error('Couldn’t reach the phone. Make sure this device is on the phone’s Wi-Fi.'))
    }
    const timer = setTimeout(() => (ws.close(), fail()), 8_000)
    ws.addEventListener('open', () => (clearTimeout(timer), resolve(ws)), { once: true })
    ws.addEventListener('error', fail, { once: true })
  })
}

/** Joins the phone's relay and returns the same Link shape a WebRTC pairing gives. */
export async function relayLink(wsBase: string, role: 'phone' | 'guest', token: string): Promise<Link> {
  // The PIN already went through, so the phone is reachable: a failed socket here is usually a
  // dropped first attempt on a busy Wi-Fi. Try again before giving up (the token stays valid).
  let ws: WebSocket | undefined
  for (let attempt = 1; !ws; attempt++) {
    try {
      ws = await open(`${wsBase}/__stub/ws?role=${role}&token=${token}`)
    } catch (e) {
      if (attempt === 3)
        throw new Error(
          'Reached the phone, but couldn’t open the link to it. Try a private (incognito) window: a browser extension or firewall may be blocking it.',
          { cause: e },
        )
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  return { channel: wsChannel(ws), code: await relayCode(token), close: () => ws.close() }
}
