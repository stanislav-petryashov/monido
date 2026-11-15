// Secret helpers: a comparison without a timing leak, a sha256 hex digest, a random URL-safe id. A leaf (node:crypto only).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** The sha256 of the text, as hex. */
export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Comparison without a timing leak: hashes of equal length. */
export function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/** `bytes` random bytes as base64url: an id, a code or a token. */
export const randomId = (bytes: number): string => randomBytes(bytes).toString('base64url')
