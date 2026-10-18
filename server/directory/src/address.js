// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Email address normalisation for the directory.
//
// One rule, applied identically by the directory and every client, so that a
// lookup can only ever mean ONE mailbox. ⚠ PROVISIONAL: kernel owns the
// reference implementation (K2, kernel/src/address.ts) plus a vector fixture
// every host must pass — Swift, Kotlin and Rust agents can't import this file —
// and this module becomes an import of it.
//   · PHASE 1 IS ASCII-ONLY — RECOMMENDED, PENDING THE MAINTAINER'S DECISION on
//     international addresses. Any non-ASCII character, in the local part or the
//     domain, is refused (an `xn--` domain typed as ASCII is fine). IDN is
//     deferred because the platforms disagree — WHATWG URL uses UTS #46
//     non-transitional mapping (ß stays ß), Java's IDN is IDNA2003 (ß becomes
//     ss) — so one address could bind as one mailbox and be looked up as
//     another. It returns when vectors prove every host agrees;
//   · both parts are lowercased;
//   · NO provider folding — no Gmail dot rule, no "+tag" stripping. The
//     directory never guesses another system's semantics;
//   · quoted local parts, comments, IP-literal domains, numeric TLDs and
//     anything outside a conservative character set are REFUSED, never
//     interpreted; at most 64 characters before the @ and 254 in all.

const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/** The normalised address, or null if it is refused. */
export function normalize(input) {
  if (typeof input !== 'string') return null
  const s = input.trim()
  if (s.length > 254 || /[^\x21-\x7e]/.test(s)) return null // ASCII printable only, no spaces
  const at = s.indexOf('@')
  if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) return null
  const local = s.slice(0, at).toLowerCase()
  const domain = s.slice(at + 1).toLowerCase()
  if (local.length > 64 || !LOCAL.test(local)) return null
  const labels = domain.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return null // numeric TLD (an IPv4 address)
  return `${local}@${domain}`
}

/** The per-address storage name: never the address itself. */
export async function addressKey(normalized) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bento-dir/1/addr\n${normalized}`))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
