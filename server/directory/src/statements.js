// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// THE K2 SEAM. Everything the directory signs or verifies about a binding goes
// through this module, and nothing else in server/directory knows a statement's
// byte layout.
//
// ⚠ PROVISIONAL. The bento/id signed statements and their verifiers belong to
// the kernel (bento/id phase 1, K2), so that the directory, every agent and
// every client verify with ONE implementation. Until K2 lands this file carries
// the layout share has proposed to kernel, so the rest of the service can be
// built and tested. When K2 lands, these functions become thin wrappers over
// kernel's exported builders and verifiers (and its test vectors), and this
// comment goes. The rules already followed, agreed with kernel:
//   · a statement is DOT-JOINED UTF-8 text, signed over its EXACT bytes, never
//     re-canonicalised; there is no JSON inside a signed statement;
//   · free-text fields (the email, the display name) are base64url without
//     padding; grammar tokens stay plain; the field count is checked exactly;
//   · the leading type token (`bind`, `att`, `tomb`, `del`, `cmp`) is the
//     domain separation, so a signature made for one purpose is never valid
//     as another;
//   · times are epoch milliseconds;
//   · the VERSION is the prefix (`bind.` is version 1; a breaking change is
//     `bind2.`), and an ABSENT field is EMPTY — one convention across the family.

const EC = { name: 'ECDSA', namedCurve: 'P-256' }
const SIG = { name: 'ECDSA', hash: 'SHA-256' }
const enc = new TextEncoder()

export const b64u = {
  enc(bytes) {
    let s = ''
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b)
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  dec(s) {
    const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
    return out
  },
}
export const textB64u = (s) => b64u.enc(enc.encode(s))
export const fromTextB64u = (s) => new TextDecoder('utf-8', { fatal: true }).decode(b64u.dec(s))

/** b64u(SHA-256(text)): how statements name each other. */
export const hashOf = async (text) => b64u.enc(await crypto.subtle.digest('SHA-256', enc.encode(text)))

const B64U = /^[A-Za-z0-9_-]+$/
const RAW_P256 = /^[A-Za-z0-9_-]{86,87}$/ // a 65-byte uncompressed point
const HASH = /^[A-Za-z0-9_-]{43}$/
const INT = /^(0|[1-9][0-9]{0,15})$/
const MONTH = 30.44 * 86_400_000
export const MAX_LIFETIME_MS = 13 * MONTH + 86_400_000 // 13 months + a day of slack
export const KID = /^[a-z0-9-]{1,32}$/
export const STATES = ['active', 'pending', 'frozen']

async function verifyRaw(pubB64u, sigB64u, text) {
  try {
    const key = await crypto.subtle.importKey('raw', b64u.dec(pubB64u), EC, false, ['verify'])
    return await crypto.subtle.verify(SIG, key, b64u.dec(sigB64u), enc.encode(text))
  } catch { return false }
}

/**
 * `bind.<b64u(email)>.<key>.<kx>.<b64u(name)|empty>.<seq>.<prev|empty>.<created>.<expires>`
 * Parse and verify as the holder submitted it, or return null. Checks the exact
 * field count, the holder's signature over the exact text, a key-agreement key
 * that is a real P-256 point and NOT the signing key, the seq/prev pairing and
 * a lifetime of at most 13 months.
 */
export async function verifyBinding(text, sig) {
  if (typeof text !== 'string' || text.length > 2048 || typeof sig !== 'string' || !B64U.test(sig)) return null
  const f = text.split('.')
  if (f.length !== 9 || f[0] !== 'bind') return null
  const [, emailB, key, kx, nameB, seqS, prev, createdS, expiresS] = f
  if (!B64U.test(emailB) || !RAW_P256.test(key) || !RAW_P256.test(kx)) return null
  if (kx === key) return null // a signing key reused for key agreement is refused
  if (!(nameB === '' || B64U.test(nameB)) || !INT.test(seqS) || !INT.test(createdS) || !INT.test(expiresS)) return null
  const seq = Number(seqS), created = Number(createdS), expires = Number(expiresS)
  if (seq < 1 || (seq === 1 ? prev !== '' : !HASH.test(prev))) return null
  if (expires <= created || expires - created > MAX_LIFETIME_MS) return null
  let email, name
  try {
    email = fromTextB64u(emailB)
    name = nameB === '' ? undefined : fromTextB64u(nameB)
  } catch { return null }
  if (name !== undefined && (name.length > 64 || name.length === 0)) return null
  try {
    await crypto.subtle.importKey('raw', b64u.dec(kx), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  } catch { return null }
  if (!(await verifyRaw(key, sig, text))) return null
  return { email, key, kx, name, seq, prev: prev === '' ? undefined : prev, created, expires }
}

/** Build a bind statement (used by the rig and, in K2, by the agents). */
export function bindText({ email, key, kx, name, seq, prev, created, expires }) {
  return ['bind', textB64u(email), key, kx, name ? textB64u(name) : '', seq, prev ?? '', created, expires].join('.')
}

/** `cmp.<hash(bindText)>.<code>`, signed by the binding's own key in the holder's
 *  AGENT: the second proof. Agent-signed, so K2 owns it like the others. */
export const completionText = (bindHash, code) => `cmp.${bindHash}.${code}`
export const verifyCompletion = (bindingKey, bindHash, code, sig) => verifyRaw(bindingKey, sig, completionText(bindHash, code))

/** `del.<b64u(email)>.<ts>`, holder-signed, valid for 5 minutes around ts. */
export const deleteText = (email, ts) => `del.${textB64u(email)}.${ts}`
export async function verifyDelete(bindingKey, email, ts, sig, now) {
  if (!Number.isInteger(ts) || Math.abs(now - ts) > 5 * 60_000) return false
  return verifyRaw(bindingKey, sig, deleteText(email, ts))
}

async function sign(dirKey, text) {
  return { text, sig: b64u.enc(await crypto.subtle.sign(SIG, dirKey, enc.encode(text))) }
}

/**
 * `att.<hash(bindText)>.<verifiedAt>.<issuedAt>.<kid>.<state>`, signed with the
 * directory's ONLINE key (a Worker secret, never the release key). issuedAt is
 * fresh on every answer, so a client can age-check a replayed one; the state is
 * inside the signature, so an answer can't be replayed as "active" during a
 * freeze.
 */
export const attest = (dirKey, kid, bindHash, verifiedAt, issuedAt, state = 'active') =>
  sign(dirKey, `att.${bindHash}.${verifiedAt}.${issuedAt}.${kid}.${state}`)

/** `tomb.<hash(lastBind)|empty>.<seq>.<deletedAt>.<by>.<kid>`, directory-signed. */
export const tombstone = (dirKey, kid, lastHash, seq, deletedAt, by) =>
  sign(dirKey, `tomb.${lastHash ?? ''}.${seq}.${deletedAt}.${by}.${kid}`)

/** Import the directory's private signing key from its JWK (a Worker secret). */
export async function importDirKey(jwkText) {
  return crypto.subtle.importKey('jwk', JSON.parse(jwkText), EC, false, ['sign'])
}
