// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/id — the recovery code (identity-design §2f "Exact bytes", security §28).
//
// RANDOM, never chosen: 80 bits as 16 Crockford base-32 characters plus one
// Crockford CHECK symbol (the 80-bit value mod 37), 17 characters, shown
// XXXX-XXXX-XXXX-XXXX-C. The check symbol catches a typo LOCALLY, before it
// spends one of the directory's five daily attempts.
//
// Typing it back: uppercase, spaces and hyphens stripped, O→0, I/L→1 (Crockford's
// own rules). What the key derivation takes is the 10 DECODED BYTES, never the
// string — every host derives the same key from the same code however it was
// typed.
//
// The wrap itself (Argon2id over the decoded bytes, then HKDF) lands with the
// vendored Argon2id and K2b's vectors.

const SYMBOLS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'       // the 32 data symbols
const CHECK = SYMBOLS + '*~$=U'                           // the 37 check symbols
export const CODE_BITS = 80

const toBig = (u8) => u8.reduce((x, b) => (x << 8n) | BigInt(b), 0n)
const checkOf = (bytes) => CHECK[Number(toBig(bytes) % 37n)]

function encode(bytes) {
  let v = toBig(bytes), out = ''
  for (let i = 0; i < 16; i++) { out = SYMBOLS[Number(v & 31n)] + out; v >>= 5n }
  return out
}

/** A fresh code, displayed form. `rand` injectable for tests only. */
export function newRecoveryCode(rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = rand(10)
  if (!(bytes instanceof Uint8Array) || bytes.length !== 10) throw new Error('10 random bytes')
  return displayCode(encode(bytes) + checkOf(bytes))
}

/** XXXX-XXXX-XXXX-XXXX-C */
export const displayCode = (c) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16)}`

/**
 * What the person typed → { bytes (10), code (17 canonical) }, or null when it
 * is not a code: a wrong length, a symbol outside the alphabet, or a check
 * symbol that does not match (a typo).
 */
export function parseRecoveryCode(typed) {
  const s = String(typed ?? '').toUpperCase().replace(/[\s-]/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== 17) return null
  let v = 0n
  for (const c of s.slice(0, 16)) {
    const i = SYMBOLS.indexOf(c)
    if (i < 0) return null
    v = (v << 5n) | BigInt(i)
  }
  const bytes = new Uint8Array(10)
  for (let i = 9; i >= 0; i--) { bytes[i] = Number(v & 0xffn); v >>= 8n }
  if (!CHECK.includes(s[16]) || checkOf(bytes) !== s[16]) return null
  return { bytes, code: s }
}
