import { PairingError, type PairingFailure } from '../pairing'

export type ProblemKind = Exclude<PairingFailure, 'bad-code' | 'wrong-step'> | 'mismatch'

export const PROBLEMS: Record<ProblemKind, { title: string; fix: string }> = {
  timeout: {
    title: 'Couldn’t reach the other device',
    fix: 'Both devices need to be on the same Wi-Fi or hotspot. Check that, then start again on both.',
  },
  network: {
    title: 'The connection failed',
    fix: 'Both devices need to be on the same Wi-Fi or hotspot. Guest and public networks often keep devices apart; a phone hotspot works.',
  },
  unsupported: {
    title: 'This browser can’t connect directly',
    fix: 'Open Stub in Chrome, Safari, Firefox or Edge.',
  },
  mismatch: {
    title: 'The codes didn’t match, so Stub disconnected',
    fix: 'Another device nearby may have scanned instead. Start again and scan only the device in front of you.',
  },
}

export function detailOf(e: unknown): string {
  return e instanceof PairingError ? (e.detail ?? '') : ''
}

export function failureOf(e: unknown): PairingFailure {
  return e instanceof PairingError ? e.kind : 'network'
}

/** Problems you can fix by scanning again, shown inline on the pairing screen. */
export function inlineProblem(kind: PairingFailure, scanning: 'offer' | 'answer'): string | null {
  if (kind === 'bad-code') return 'That code isn’t from Stub. Point at the Stub screen on the other device.'
  if (kind === 'wrong-step')
    return scanning === 'answer'
      ? 'That’s another Send code. The other device needs to tap Receive.'
      : 'That’s a reply code. Scan the device that tapped Send.'
  return null
}
