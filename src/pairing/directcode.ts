// "Direct code": the phone's local address, port and PIN packed into ~7 characters, so a laptop can
// type one short code on the Stub website instead of "192.168.0.177:8080" plus a PIN.
//
// Bits, most significant first:
//   2  address kind: 0 = 192.168.a.b, 1 = 10.a.b.c, 2 = 172.(16-31).b.c, 3 = any IPv4
//   16/24/20/32  the address bits that kind doesn't fix
//   1  port flag: 0 = 8080, 1 = a 16-bit port follows
//   14 PIN (0000-9999)
// Written in Crockford base32 (no I, L, O or U; case-insensitive; I/L read as 1 and O as 0).

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const DEFAULT_PORT = 8080

export interface DirectTarget {
  ip: string
  port: number
  pin: string
}

function toBits(n: number, width: number): string {
  return n.toString(2).padStart(width, '0')
}

export function encodeDirect({ ip, port, pin }: DirectTarget): string {
  const o = ip.split('.').map(Number)
  if (o.length !== 4 || o.some((x) => !(x >= 0 && x <= 255)) || !/^\d{4}$/.test(pin)) throw new Error('Bad target')
  let bits: string
  if (o[0] === 192 && o[1] === 168) bits = '00' + toBits(o[2]!, 8) + toBits(o[3]!, 8)
  else if (o[0] === 10) bits = '01' + o.slice(1).map((x) => toBits(x, 8)).join('')
  else if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) bits = '10' + toBits(o[1]! - 16, 4) + toBits(o[2]!, 8) + toBits(o[3]!, 8)
  else bits = '11' + o.map((x) => toBits(x, 8)).join('')
  bits += port === DEFAULT_PORT ? '0' : '1' + toBits(port, 16)
  bits += toBits(Number(pin), 14)
  bits = bits.padEnd(Math.ceil(bits.length / 5) * 5, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

/** "7KQ2MX4" -> "7KQ-2MX4", easier to read off a screen. */
export function formatDirect(code: string): string {
  return code.length > 4 ? `${code.slice(0, 3)}-${code.slice(3)}` : code
}

export function decodeDirect(text: string): DirectTarget | null {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
  if (!clean || [...clean].some((c) => !ALPHABET.includes(c))) return null
  const bits = [...clean].map((c) => toBits(ALPHABET.indexOf(c), 5)).join('')
  let i = 0
  const take = (n: number) => {
    if (i + n > bits.length) throw new Error('short')
    return parseInt(bits.slice(i, (i += n)), 2)
  }
  try {
    const kind = take(2)
    const ip =
      kind === 0 ? `192.168.${take(8)}.${take(8)}`
      : kind === 1 ? `10.${take(8)}.${take(8)}.${take(8)}`
      : kind === 2 ? `172.${take(4) + 16}.${take(8)}.${take(8)}`
      : `${take(8)}.${take(8)}.${take(8)}.${take(8)}`
    const port = take(1) ? take(16) : DEFAULT_PORT
    const pin = take(14)
    // Leftover bits are padding (all zero); anything longer is a typo or the wrong kind of code.
    if (pin > 9999 || port === 0 || bits.length - i >= 5 || /1/.test(bits.slice(i))) return null
    return { ip, port, pin: String(pin).padStart(4, '0') }
  } catch {
    return null
  }
}

/** Where the laptop goes for this code: the page the phone serves, with the PIN filled in. */
export function directUrl(t: DirectTarget): string {
  return `http://${t.ip}:${t.port}/#pin=${t.pin}`
}
