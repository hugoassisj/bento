#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * bento/connect on iOS and the Mac — the agent's sign() and host-stamped consent
 * (home/ios/IdentityAgent.swift).
 *
 *   node scripts/test-home-id-agent.mjs
 *
 * WHY. A consent signature is only as good as the context it binds, and the
 * HOST stamps that context: the RP, the docId it read from the file, the
 * verifier's audience and challenge, and the expiry. The page names only what
 * to sign and for which purpose. This checks that a stamped cns. verifies under
 * the kernel-conformant verifier exactly when it should, and is refused when:
 *   - relayed to another audience
 *   - replayed
 *   - applied to a swapped payload
 *   - applied to another document
 * It also checks sign()'s routing:
 *   - a mismatched purpose is refused before any key is touched
 *   - routine purposes sign with the routine key
 *   - consent is refused without an identity, a verifier or presence
 * Consent signing itself needs a person present, so the rig signs the stamped
 * text with a test key to check the verifier side.
 *
 * Apple platforms only; skips elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = ['HostDocStore.swift', 'IdentityKeys.swift', 'IdentityDisplayTable.swift', 'IdentityStatements.swift', process.env.ID_AGENT_SRC || 'IdentityAgent.swift']
  .map((f) => f.includes('/') ? f : join(ROOT, 'home/ios', f))
// Apple platforms only: the Linux CI runner has swiftc but no CryptoKit, Security
// or LocalAuthentication, so probe for xcrun, which only Apple toolchains ship.
try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'pipe' }) } catch { console.log('home id agent: SKIPPED — needs an Apple toolchain (CryptoKit, Security).'); process.exit(0) }

const main = String.raw`
import CryptoKit
import Foundation
import LocalAuthentication
final class Mem: HostDocStore.Secrets {
  var d: [String: Data] = [:]
  func get(_ a: String) -> HostDocStore.Read { d[a].map { .found($0) } ?? .absent }
  func set(_ a: String, _ v: Data) -> Bool { d[a] = v; return true }
  func delete(_ a: String) { d[a] = nil }
}
func e(_ k: String, _ v: Any) { print("\(k)=\(v)") }
typealias A = IdentityAgent
typealias S = IdentityStatements
let now = 1_800_000_000_000
let challenge = S.b64uEnc(Data(repeating: 7, count: 24))
let dir = A.Verifier(audience: "dir", challenge: challenge)
let realPub = S.b64uEnc(P256.Signing.PrivateKey().publicKey.x963Representation)
let invite = "inv.\(realPub).writer.1800000000000"
let docId = "7025b63c-733c-404b-ba00-7fb4becf38df"

// stamping: every field the host's own
let cns = A.stampConsent(purpose: "invite", payload: invite, docId: docId, verifier: dir, now: now)!
let f = cns.components(separatedBy: ".")
e("stamp.fields", f.count == 6 && f[0] == "cns" && f[1] == "bento" && f[2] == "invite" && f[3] == docId && Int(f[5])! == now + S.consentMaxTtlMs)
e("stamp.transcript", f[4] == S.consentTranscript(audience: "dir", challenge: challenge, payloadText: invite)!)
let k = P256.Signing.PrivateKey(), kp = S.b64uEnc(k.publicKey.x963Representation)
let sig = S.b64uEnc(S.lowS(try! k.signature(for: Data(cns.utf8)).rawRepresentation))
func verify(audience: String = "dir", payload: String = invite, doc: String? = docId, spent: Bool = false, at: Int = now) -> String {
  let v = S.verifyConsent(cns, sig, consentPub: kp, rp: "bento", audience: audience, challenge: challenge,
                          payloadText: payload, docId: doc, now: at, spend: { _ in !spent })
  return v.ok ? "accept" : "reject:\(v.reason!)"
}
e("verify.ok", verify())
e("verify.relay", verify(audience: "room:w" + String(repeating: "A", count: 43)))
e("verify.replay", verify(spent: true))
e("verify.payloadswap", verify(payload: "inv.\(realPub).audience.1800000000000"))
e("verify.docswap", verify(doc: "another-document"))
e("verify.expired", verify(at: now + S.consentMaxTtlMs))
e("stamp.nodoc", A.stampConsent(purpose: "invite", payload: invite, docId: nil, verifier: dir, now: now) == nil)
e("stamp.baddoc", A.stampConsent(purpose: "invite", payload: invite, docId: "a/b", verifier: dir, now: now) == nil)
e("stamp.family", A.stampConsent(purpose: "revoke", payload: invite, docId: docId, verifier: dir, now: now) == nil)
e("stamp.badaudience", A.stampConsent(purpose: "invite", payload: invite, docId: docId, verifier: .init(audience: "evil.example", challenge: challenge), now: now) == nil)
e("stamp.shortchallenge", A.stampConsent(purpose: "invite", payload: invite, docId: docId, verifier: .init(audience: "dir", challenge: S.b64uEnc(Data(count: 8))), now: now) == nil)
e("stamp.ttl", A.stampConsent(purpose: "invite", payload: invite, docId: docId, verifier: dir, now: now, ttlMs: S.consentMaxTtlMs + 1) == nil)
let link = A.stampConsent(purpose: "link", payload: "dev.x", docId: docId, verifier: dir, now: now) ?? ""
let lf = link.components(separatedBy: ".")
e("stamp.linkNoDoc", lf.count == 6 && lf[3] == "")

// sign(): routing
let m = Mem()
let noCtx = LAContext(); noCtx.interactionNotAllowed = true
let host = A.HostContext(docId: docId, verifier: dir, deviceName: "iPhone", devices: ["devA"], now: now, domainState: { nil }, presence: noCtx)
func r(_ x: Result<A.Signed, A.Refusal>) -> String {
  switch x {
  case .success(let s): if case .routine = s { return "routine" }; return "consent"
  case .failure(let f): return "refuse:\(f.rawValue)"
  }
}
let prove = "prove.\(challenge).wROOM"
e("sign.noIdentity", r(A.sign(purpose: "prove", payload: prove, host: host, store: m, enclave: false)))
_ = try! IdentityKeys.createAccount(in: m)
e("sign.badshape", r(A.sign(purpose: "prove", payload: "rev.\(realPub)", host: host, store: m, enclave: false)))
e("sign.unknownPurpose", r(A.sign(purpose: "link", payload: "dev.x", host: host, store: m, enclave: false)))
let rs = A.sign(purpose: "prove", payload: prove, host: host, store: m, enclave: false)
e("sign.routine", r(rs))
if case .success(.routine(let s1, let p1)) = rs, let pk = try? P256.Signing.PublicKey(x963Representation: S.b64uDec(p1)!),
   let es = try? P256.Signing.ECDSASignature(rawRepresentation: S.b64uDec(s1)!) {
  e("sign.routineVerifies", pk.isValidSignature(es, for: Data(prove.utf8)))
} else { e("sign.routineVerifies", false) }
let noVerifier = A.HostContext(docId: docId, verifier: nil, deviceName: "iPhone", devices: ["devA"], now: now, domainState: { nil }, presence: noCtx)
e("sign.consentNoVerifier", r(A.sign(purpose: "invite", payload: invite, host: noVerifier, store: m, enclave: false)))
e("sign.consentNoPresence", r(A.sign(purpose: "invite", payload: invite, host: host, store: m, enclave: false)))
e("sign.freshNoNotice", (IdentityKeys.pendingNotices(in: m) ?? []).count)
// a consent key from before the check (no recorded enrolment): CHANGED, notice queued before the refusal
let legacy = Mem(); _ = try! IdentityKeys.createAccount(in: legacy)
_ = try! IdentityKeys.device(.consent, in: legacy, enclave: false, domainState: { nil })
legacy.delete(IdentityKeys.enrolmentItem)
_ = A.sign(purpose: "invite", payload: invite, host: host, store: legacy, enclave: false)
e("sign.legacyNotice", (IdentityKeys.pendingNotices(in: legacy) ?? []).count)
`
const dir = mkdtempSync(join(tmpdir(), 'bento-idagent-'))
let out
try {
  writeFileSync(join(dir, 'main.swift'), main)
  execFileSync('swiftc', ['-O', '-D', 'DEBUG', '-D', 'BENTO_SOFTWARE_DEVICE_KEYS', '-o', join(dir, 'a'), ...SRC, join(dir, 'main.swift')], { stdio: 'pipe' })
  out = Object.fromEntries(execFileSync(join(dir, 'a')).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
} catch (err) { console.error('swiftc or run failed:\n' + (err.stderr?.toString() ?? err.message)); process.exit(2) }
finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`) }
console.log('host-stamped consent (§2e (A)):')
ok(out['stamp.fields'] === 'true', 'cns. carries the host-stamped rp, purpose, the docId the HOST read, and an expiry within the cap')
ok(out['stamp.transcript'] === 'true', 'and the channel binding to the verifier the host is talking to')
ok(out['verify.ok'] === 'accept', 'the directory accepts it')
ok(out['verify.relay'] === 'reject:transcript', 'RELAYED to another audience: refused')
ok(out['verify.replay'] === 'reject:replay', 'REPLAYED with a spent challenge: refused')
ok(out['verify.payloadswap'] === 'reject:transcript', 'applied to a SWAPPED payload: refused')
ok(out['verify.docswap'] === 'reject:docid', 'applied to ANOTHER DOCUMENT: refused')
ok(out['verify.expired'] === 'reject:expired', 'past its expiry: refused')
ok(out['stamp.nodoc'] === 'true' && out['stamp.baddoc'] === 'true', 'a document-scoped consent needs a valid docId from the host, or nothing is stamped')
ok(out['stamp.family'] === 'true', "a purpose stamped over another family's payload: nothing is stamped")
ok(out['stamp.badaudience'] === 'true' && out['stamp.shortchallenge'] === 'true', 'a bad audience or a short challenge: nothing is stamped')
ok(out['stamp.ttl'] === 'true', 'an expiry past the 5-minute cap: nothing is stamped')
ok(out['stamp.linkNoDoc'] === 'true', 'an account-scoped consent (link) carries no docId, even when the host has one')
console.log('sign() routing:')
ok(out['sign.noIdentity'] === 'refuse:no-identity', 'no identity on the device: no-identity')
ok(out['sign.badshape'] === 'refuse:purpose', "a payload not of its purpose's shape is refused before any key is touched")
ok(out['sign.unknownPurpose'] === 'refuse:purpose', 'a purpose the page may not ask for is refused')
ok(out['sign.routine'] === 'routine' && out['sign.routineVerifies'] === 'true', 'a routine purpose signs with the routine key, verifiably')
ok(out['sign.consentNoVerifier'] === 'refuse:unavailable', 'a consent with no verifier context from the host is refused')
ok(out['sign.consentNoPresence'] === 'refuse:declined', 'a consent without the person present is DECLINED')
ok(out['sign.freshNoNotice'] === '0', "a BRAND-NEW consent key raises no 'biometrics changed' notice: minting records its baseline first")
ok(out['sign.legacyNotice'] === '1', 'a consent key from before the check (no record) is CHANGED: its notice is queued, before the refusal')
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
