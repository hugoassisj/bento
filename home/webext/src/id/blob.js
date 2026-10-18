// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/id — the passkey-wrapped account key (identity-design §2f).
//
// At setup, and whenever a passkey is added, the agent runs ONE WebAuthn
// ceremony (rp bento.page, user verification) with the PRF extension over the
// FIXED input "bento/id/prf/v1". The 32-byte PRF output never leaves the
// authenticator except into this function, and becomes the key that wraps the
// account private key:
//
//   KEK  = HKDF-SHA-256(ikm = PRF output, salt = 32 random bytes,
//                       info = "bento/id/acct-wrap/v1")
//   blob = { v:1, cred: b64url(sha256(credentialId)), salt, iv,
//            ct: AES-256-GCM(KEK, iv, account private key ‖ kx private key,
//                            aad = "bento/id/acct-wrap/v1." ‖ cred) }
//
// The blob is opaque to the directory that stores it; only the passkey that
// made it can open it. A device that opens one checks the recovered key
// against the PUBLIC key the directory-signed binding states (`importAccount`
// signs and verifies), so a swapped blob fails closed.
//
// EXACT BYTES (identity-design §2f, K2b, signed by security §28):
//   · private keys are RAW 32-byte big-endian P-256 scalars, each checked on
//     import to lie in 1..n−1 AND to match the directory-signed public half;
//   · the plaintext is the account scalar alone while kx is unruled, or the
//     account scalar ‖ the kx scalar (64 bytes) under ruling A or C;
//   · salt 32 bytes, iv 12 bytes, all binary fields base64url without padding.
//
// THE ACCOUNT KEY (security §28): generated extractable only inside the setup
// ceremony, used to make the blobs, then re-imported NON-extractable. Stated
// exactly: never exported or stored as raw bytes by our code. Dropping a key
// in JavaScript is best effort (heap until garbage collection), and
// non-extractable is a JavaScript-API property: the browser keeps the
// material in the profile's IndexedDB, readable by same-user malware.
//
// Pure: WebCrypto only, so the rig runs the same code in node.

const te = new TextEncoder()
export const PRF_INPUT = te.encode('bento/id/prf/v1')
const INFO = te.encode('bento/id/acct-wrap/v1')
const AAD_PREFIX = 'bento/id/acct-wrap/v1.'
const subtle = () => globalThis.crypto.subtle

export const b64u = (u8) => {
  let s = ''
  for (const b of u8) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const unb64u = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('not base64url')
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** b64url(sha256(credentialId)) — how a blob names its passkey without naming it. */
export async function credHash(credentialId) {
  return b64u(new Uint8Array(await subtle().digest('SHA-256', credentialId)))
}

async function kek(prf, salt) {
  if (!(prf instanceof Uint8Array) || prf.length !== 32) throw new Error('PRF output must be 32 bytes')
  const ikm = await subtle().importKey('raw', prf, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

/**
 * Wrap the account private scalar (and the kx scalar, once that slot exists)
 * under a passkey's PRF output. `rand(n)` is injectable for test vectors only.
 */
export async function wrapAccount({ prf, credentialId, accountD, kxD = null }, rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  if (!(accountD instanceof Uint8Array) || accountD.length !== 32) throw new Error('account key must be a 32-byte scalar')
  if (kxD !== null && (!(kxD instanceof Uint8Array) || kxD.length !== 32)) throw new Error('kx key must be a 32-byte scalar')
  const cred = await credHash(credentialId)
  const salt = rand(32)
  const iv = rand(12)
  const pt = kxD ? new Uint8Array([...accountD, ...kxD]) : accountD
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(AAD_PREFIX + cred) }, await kek(prf, salt), pt))
  return { v: 1, cred, salt: b64u(salt), iv: b64u(iv), ct: b64u(ct) }
}

/**
 * Open a blob with the PRF output of the passkey that made it. Throws on any
 * mismatch — a wrong passkey, a blob for another credential, a tampered field.
 */
export async function unwrapAccount(blob, { prf, credentialId }) {
  if (!blob || blob.v !== 1) throw new Error('unknown blob version')
  const cred = await credHash(credentialId)
  if (blob.cred !== cred) throw new Error('blob is for another passkey')
  const salt = unb64u(blob.salt), iv = unb64u(blob.iv)
  if (salt.length !== 32 || iv.length !== 12) throw new Error('bad blob')
  const pt = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: te.encode(AAD_PREFIX + cred) }, await kek(prf, salt), unb64u(blob.ct)))
  if (pt.length !== 32 && pt.length !== 64) throw new Error('bad blob')
  return { accountD: pt.slice(0, 32), kxD: pt.length === 64 ? pt.slice(32) : null }
}

/** The raw scalar `d` of an EXTRACTABLE P-256 private key (inside a ceremony only). */
export async function scalarOf(privateKey) {
  return unb64u((await subtle().exportKey('jwk', privateKey)).d)
}

/** The raw uncompressed public point (65 bytes) as base64url — the contract's `accountPub` form. */
export async function rawPub(publicKey) {
  return b64u(new Uint8Array(await subtle().exportKey('raw', publicKey)))
}

/**
 * Bring a recovered account scalar back as a signing key — NON-extractable by
 * default — and PROVE it belongs to `accountPubRaw` (the binding's key): sign
 * a fresh challenge with it and verify under the stated public key. A blob the
 * directory swapped yields a key that fails here.
 */
/** the P-256 group order */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

/** A scalar in 1..n−1 (security §28): checked before any platform sees it. */
export const scalarInRange = (d) => {
  if (!(d instanceof Uint8Array) || d.length !== 32) return false
  const v = d.reduce((x, b) => (x << 8n) | BigInt(b), 0n)
  return v > 0n && v < N
}

export async function importAccount(d, accountPubRaw, { extractable = false } = {}) {
  if (!scalarInRange(d)) throw new Error('the recovered scalar is not in 1..n-1')
  const pub = unb64u(accountPubRaw)
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('account public key must be an uncompressed P-256 point')
  const jwk = { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33)), ext: extractable }
  const key = await subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, extractable, ['sign'])
  const verifyKey = await subtle().importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const probe = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, probe)
  if (!(await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, sig, probe))) throw new Error('recovered key does not match the binding')
  return key
}
