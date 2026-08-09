import { randomBytes, randomUUID } from 'node:crypto'

/** Unambiguous alphabet: no I, O, 0, 1, so codes survive being read aloud. */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function userId(): string {
  return `usr_${randomUUID().replaceAll('-', '')}`
}

export function bookingId(): string {
  return `bkg_${randomUUID().replaceAll('-', '')}`
}

export function sessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Short human-transcribable code, e.g. "7K2F-QX9M". */
export function linkCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

/** Stable pseudo-random in [0,1) derived from a string. Keeps fixtures deterministic. */
export function seededUnit(seed: string, salt = ''): number {
  let hash = 2166136261
  const input = `${seed}::${salt}`
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 100000) / 100000
}
