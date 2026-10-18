// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/id — the ONE definition of "which mailbox is this address".
//
// The directory binds an address to a key, and an agent looks an address up. If
// the two normalise differently, a lookup and a binding can disagree about which
// mailbox they mean, and someone else's key could answer for yours. So both use
// this rule: the directory imports this module, and the native agents (Swift,
// Kotlin, Rust, which cannot import it) must pass every row of the vector fixture
// (kernel/fixtures/identity-v1.json). The VECTORS are the contract for them; this
// file is the reference.
//
// Phase 1 accepts ASCII addresses only (a maintainer decision). International
// domain handling diverges between platforms (WHATWG URL uses UTS #46
// non-transitional processing; java.net.IDN is IDNA2003, so "ß" becomes a
// different domain), and an address two hosts read differently is exactly the
// bug this module exists to prevent. A domain typed in its ASCII `xn--` form is
// accepted as typed. The limit lifts once vectors prove every host agrees.
//
// No provider folding of any kind: Gmail's dots and +tags are part of the
// address. Folding is a guess about one provider's policy, and a wrong guess
// merges two people's mailboxes.

export type AddressResult =
  | { ok: true; address: string }
  | { ok: false; reason: AddressRefusal }

export type AddressRefusal =
  | 'too-long'        // over 254 characters, or a local part over 64
  | 'not-ascii'       // a character outside 0x21–0x7E (spaces, non-ASCII, controls)
  | 'at-sign'         // not exactly one '@', or '@' first or last
  | 'local-part'      // not a dot-atom: quoted, comments, leading/trailing/double dots
  | 'domain'          // fewer than two labels, or a malformed label, or an IP literal
  | 'numeric-tld'     // the last label is all digits (an IPv4 address)

const MAX_ADDRESS = 254
const MAX_LOCAL = 64
const MAX_LABEL = 63

/** RFC 5322 atext, lower-cased (the input is lower-cased before this runs). */
const ATEXT = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/

/** Normalise an address typed by a person, or say why it is refused. */
export function normalizeAddress(input: string): AddressResult {
  const s = input.trim()
  if (s.length > MAX_ADDRESS) return { ok: false, reason: 'too-long' }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x21 || c > 0x7e) return { ok: false, reason: 'not-ascii' }
  }
  const at = s.indexOf('@')
  if (at <= 0 || at !== s.lastIndexOf('@') || at === s.length - 1) return { ok: false, reason: 'at-sign' }
  const local = s.slice(0, at).toLowerCase()
  const domain = s.slice(at + 1).toLowerCase()

  if (local.length > MAX_LOCAL) return { ok: false, reason: 'too-long' }
  // dot-atom: atext runs separated by single dots, none leading or trailing
  for (const atom of local.split('.')) if (!ATEXT.test(atom)) return { ok: false, reason: 'local-part' }

  const labels = domain.split('.')
  if (labels.length < 2) return { ok: false, reason: 'domain' }
  for (const label of labels) {
    if (label.length < 1 || label.length > MAX_LABEL) return { ok: false, reason: 'domain' }
    if (!/^[a-z0-9-]+$/.test(label)) return { ok: false, reason: 'domain' } // also refuses '[' IP literals
    if (label.startsWith('-') || label.endsWith('-')) return { ok: false, reason: 'domain' }
  }
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return { ok: false, reason: 'numeric-tld' }

  return { ok: true, address: `${local}@${domain}` }
}

/** True when `s` is already in normal form (what a signed statement must carry). */
export function isNormalAddress(s: string): boolean {
  const r = normalizeAddress(s)
  return r.ok && r.address === s
}
