// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento/id — the document's side of the identity agent contract.
//
// A document is a file, and a file cannot keep a secret, so it cannot hold a
// person's keys. The agent can: bento/home (the extension, the iOS, Android and
// desktop apps) keeps the account and device keys and acts for the person when
// a document asks. This module is the ONE definition of what a document may ask
// and what it gets back. Each host implements it over its own channel
// (home/bridge.js on the native hosts, the extension's served page), and the
// document only ever talks to the object below.
//
// Three rules shape the contract:
//   - PRIVATE KEYS NEVER CROSS. Every call returns a result: a public identity,
//     a signature, a public binding. The only secret that ever comes back is a
//     document key the person was given (`unwrap`, phase 2).
//   - THE HOST KNOWS WHO IS ASKING. No call takes a docId or a caller name: the
//     host identifies the calling document from what the platform reports (the
//     file path, the opened URL), never from the page, and exposes this object
//     only to a verified, signed Bento shell (gate 1).
//   - NO HOST, NO CHANGE. `identityAgent()` returns null wherever there is no
//     agent — a bare file:// tab, an older host, a doctored file — and every
//     caller then does exactly what it did before identity existed.

/** The contract version a host's agent object must carry. Members marked
 *  optional are additions within this version; a breaking change bumps it, and
 *  a document then sees no agent rather than one it would misread. */
export const IDENTITY_CONTRACT = 1

/** The global the host defines, before the runtime boots, on a verified shell. */
export const IDENTITY_GLOBAL = '__bentoIdentity'

/** Who is using this document, as vouched for. Public fields only. */
export interface PublicIdentity {
  /** display name, as the binding states it */
  name: string
  /** the verified address, exactly as bound (lower-case) */
  email: string
  /** who vouched: 'id.bento.page', an organisation's domain, or a vault id */
  vouchedBy: string
  /** the person's account public key: raw P-256 point, base64url */
  accountPub: string
  /** this device's key, the one `sign` uses: raw P-256 point, base64url */
  devicePub: string
}

/**
 * What a signature is for. The agent signs only a payload whose shape matches
 * the purpose, so a prompt shown for one kind of action can never yield a
 * signature on another. The payloads are the existing dot-joined statements
 * (docs/collab-design.md):
 *   frame    — `${i}.${d}`, an op batch or snapshot (routine)
 *   prove    — `prove.${nonce}.${room}`, the per-socket possession proof (routine)
 *   delegate — `dlg.${devicePub}`, an invite key admitting a device (routine)
 *   show     — `live`/`end` and `${kind}.aud.${i}`, presenting controls (routine)
 *   invite   — `inv.${pub}.${role}.${exp}`, an owner granting a role (high authority)
 *   revoke   — `rev.${pub}`, an owner removing a key (high authority)
 * High-authority purposes get the host's own consent prompt and the consent
 * key every time; routine ones ride the session (security §2e). The shared
 * payload matcher and its test vectors land with the statement formats (K2).
 */
export type SignPurpose = 'frame' | 'prove' | 'delegate' | 'show' | 'invite' | 'revoke'

/** Why a signature was not given. */
export type SignRefusal =
  /** the person said no at the host's prompt */
  | 'declined'
  /** past the idle or overall timeout: refused until the person re-authenticates (§2e B) */
  | 'reauth'
  /** the payload does not match the purpose */
  | 'purpose'
  /** no identity is set up on this device */
  | 'no-identity'
  /** the agent cannot sign right now (locked, busy, no key store) */
  | 'unavailable'

export type SignResult =
  /** `sig` is raw r‖s (64 bytes) base64url — never DER; `pub` is the key that signed */
  | { ok: true; sig: string; pub: string }
  | { ok: false; reason: SignRefusal }

/** Look up a person by a key already in the room, or (phase 2) by address. */
export type ResolveQuery = { pub: string } | { email: string }

/** A public binding the agent found and checked. */
export interface ResolvedIdentity {
  name: string
  email: string
  vouchedBy: string
  accountPub: string
  /** when this agent first saw this binding (epoch ms) — trust on first use */
  firstSeen: number
  /** true if the binding differs from the one this agent saw before */
  changed: boolean
}

/** Roles a person can be given in a document (phase 2). */
export type ShareRole = 'reader' | 'editor' | 'owner'

export interface IdentityAgent {
  readonly contract: number
  /** The person using this document, or null when no identity is set up or
   *  they declined to use it here (consent is per document). */
  whoami(): Promise<PublicIdentity | null>
  /** Sign `payload` (the exact UTF-8 text) for `purpose` with this device's key. */
  sign(purpose: SignPurpose, payload: string): Promise<SignResult>
  /** Who a key in the room (or, phase 2, an address) belongs to; null if unknown. */
  resolve(query: ResolveQuery): Promise<ResolvedIdentity | null>
  /** PHASE 2: open the document key wrapped to this person (`collab.wraps`).
   *  Returns the raw key, or null when no wrap here is theirs. */
  unwrap?(wrap: { to: string; kw: string }): Promise<Uint8Array | null>
  /** PHASE 2: share this document with a person, after the host's own consent. */
  share?(email: string, role: ShareRole): Promise<{ ok: true } | { ok: false; reason: string }>
}

let held: IdentityAgent | undefined

/**
 * The host's identity agent for this page, or null when there is none — in
 * which case the caller does what it always did.
 *
 * A valid agent is captured once, with its methods bound, so later changes to
 * the global cannot redirect a call. An absent or malformed one is not cached,
 * so an agent the host defines a moment late is still found on a later call.
 */
export function identityAgent(): IdentityAgent | null {
  if (held) return held
  let candidate: unknown
  try { candidate = (globalThis as Record<string, unknown>)[IDENTITY_GLOBAL] } catch { return null }
  const agent = capture(candidate)
  if (agent) held = agent
  return agent
}

function capture(c: unknown): IdentityAgent | null {
  try {
    if (!c || typeof c !== 'object') return null
    const o = c as Record<string, unknown>
    if (o.contract !== IDENTITY_CONTRACT) return null
    const fn = (k: string) => (typeof o[k] === 'function' ? (o[k] as (...a: unknown[]) => unknown) : null)
    const whoami = fn('whoami'), sign = fn('sign'), resolve = fn('resolve')
    if (!whoami || !sign || !resolve) return null
    // phase-2 members are optional, but if present they must be callable
    for (const k of ['unwrap', 'share']) if (o[k] !== undefined && !fn(k)) return null
    const unwrap = fn('unwrap'), share = fn('share')
    return Object.freeze({
      contract: IDENTITY_CONTRACT,
      whoami: whoami.bind(c) as IdentityAgent['whoami'],
      sign: sign.bind(c) as IdentityAgent['sign'],
      resolve: resolve.bind(c) as IdentityAgent['resolve'],
      ...(unwrap ? { unwrap: unwrap.bind(c) as NonNullable<IdentityAgent['unwrap']> } : {}),
      ...(share ? { share: share.bind(c) as NonNullable<IdentityAgent['share']> } : {}),
    })
  } catch {
    // a hostile getter, a revoked proxy: no agent, never a throw into the caller
    return null
  }
}

/** Forget the captured agent. For rigs that toggle the host between cases. */
export function resetIdentityAgentForTest(): void {
  held = undefined
}
