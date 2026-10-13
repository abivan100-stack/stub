import { decodeDescription, encodeDescription } from './sdp'
import { verificationCode } from './code'

export type PairingFailure = 'bad-code' | 'wrong-step' | 'timeout' | 'network' | 'unsupported'

export class PairingError extends Error {
  constructor(public kind: PairingFailure) {
    super(kind)
  }
}

/** What the rest of the app gets once two devices are linked. A native transport can return the same shape. */
export interface Link {
  channel: RTCDataChannel
  /** 6 digits, identical on both devices. */
  code: string
  close(): void
}

const CONNECT_TIMEOUT_MS = 20_000
const GATHER_TIMEOUT_MS = 4_000

function newConnection(): RTCPeerConnection {
  if (typeof RTCPeerConnection === 'undefined') throw new PairingError('unsupported')
  // No STUN/TURN: the two devices only ever talk across the local link.
  return new RTCPeerConnection({ iceServers: [] })
}

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    // Some browsers never report "complete" on a dead interface; host candidates are in by then anyway.
    const timer = setTimeout(done, GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', check)
  })
}

function opened(pc: RTCPeerConnection, channel: Promise<RTCDataChannel>): Promise<Link> {
  return new Promise((resolve, reject) => {
    const fail = (e: PairingError) => {
      clearTimeout(timer)
      pc.close()
      reject(e)
    }
    const timer = setTimeout(() => fail(new PairingError('timeout')), CONNECT_TIMEOUT_MS)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed') fail(new PairingError('network'))
    })
    channel.then((ch) => {
      const ready = async () => {
        clearTimeout(timer)
        const code = await verificationCode(pc.localDescription!.sdp, pc.remoteDescription!.sdp)
        resolve({ channel: ch, code, close: () => pc.close() })
      }
      if (ch.readyState === 'open') ready()
      else ch.addEventListener('open', ready, { once: true })
    })
  })
}

async function decode(payload: string, want: RTCSdpType): Promise<RTCSessionDescriptionInit> {
  let desc: RTCSessionDescriptionInit
  try {
    desc = await decodeDescription(payload)
  } catch {
    throw new PairingError('bad-code')
  }
  if (desc.type !== want) throw new PairingError('wrong-step')
  return desc
}

/**
 * Chromium and Safari hide local IPs behind random ".local" names until the page has camera
 * permission. Those names need mDNS, which phone hotspots often drop. Asking for the camera
 * first (we need it to scan the reply anyway) puts real LAN addresses in the offer.
 */
export async function unlockLocalAddresses(): Promise<void> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true })
    s.getTracks().forEach((t) => t.stop())
  } catch {
    // Denied or no camera: carry on with .local names and the text fallback.
  }
}

export interface Offer {
  /** Show this to the other device. */
  payload: string
  /** Feed in the other device's answer; resolves once the channel is open. */
  complete(answer: string): Promise<Link>
  cancel(): void
}

/** The device that taps Send makes the offer. */
export async function createOffer(): Promise<Offer> {
  const pc = newConnection()
  const channel = pc.createDataChannel('stub', { ordered: true })
  channel.binaryType = 'arraybuffer'
  await pc.setLocalDescription(await pc.createOffer())
  await gathered(pc)
  return {
    payload: await encodeDescription(pc.localDescription!),
    async complete(answer) {
      const desc = await decode(answer, 'answer')
      const link = opened(pc, Promise.resolve(channel))
      await pc.setRemoteDescription(desc)
      return link
    },
    cancel: () => pc.close(),
  }
}

export interface Answer {
  /** Show this back to the device that made the offer. */
  payload: string
  /** Resolves once the other device has scanned the answer and the channel opens. */
  link: Promise<Link>
  cancel(): void
}

/** The device that taps Receive scans the offer and answers it. */
export async function acceptOffer(offer: string): Promise<Answer> {
  const desc = await decode(offer, 'offer')
  const pc = newConnection()
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (e) => {
      e.channel.binaryType = 'arraybuffer'
      resolve(e.channel)
    })
  })
  const link = opened(pc, channel)
  link.catch(() => {}) // the caller sees the rejection through `link`
  await pc.setRemoteDescription(desc)
  await pc.setLocalDescription(await pc.createAnswer())
  await gathered(pc)
  return { payload: await encodeDescription(pc.localDescription!), link, cancel: () => pc.close() }
}
