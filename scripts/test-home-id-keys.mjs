#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * bento/connect on iOS and the Mac — the agent's keys (home/ios/IdentityKeys.swift).
 *
 *   node scripts/test-home-id-keys.mjs
 *
 * WHY. The agent's signatures are checked by the relay and the kernel in
 * WebCrypto, so the only proof that the formats are right is WebCrypto
 * accepting them. This compiles the real Swift, signs with the Secure Enclave
 * on this Mac (and with the software stand-in the simulator uses), and verifies
 * every signature in Node's WebCrypto against the public key the agent
 * publishes. It also checks low-S, and that a key is never minted over a
 * store it could not read.
 *
 * Apple platforms only (CryptoKit + Secure Enclave); skips elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = [join(ROOT, 'home/ios/HostDocStore.swift'), join(ROOT, process.env.ID_KEYS_SRC || 'home/ios/IdentityKeys.swift')]
// Apple platforms only: the Linux CI runner has swiftc but no CryptoKit, Security
// or LocalAuthentication, so probe for xcrun, which only Apple toolchains ship.
try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'pipe' }) } catch { console.log('home id keys: SKIPPED — needs an Apple toolchain (CryptoKit, Security).'); process.exit(0) }

const main = String.raw`
import CryptoKit
import Foundation
import LocalAuthentication
final class Mem: HostDocStore.Secrets {
  var d: [String: Data] = [:]; var failReads = false
  func get(_ a: String) -> HostDocStore.Read { failReads ? .unavailable : (d[a].map { .found($0) } ?? .absent) }
  func set(_ a: String, _ v: Data) -> Bool { d[a] = v; return true }
  func delete(_ a: String) { d[a] = nil }
}
func e(_ k: String, _ v: Any) { print("\(k)=\(v)") }
let b = IdentityKeys.b64url
let msgs = ["prove.n0nce.wROOM", "inv.BPUB.editor.1760000000", String(repeating: "x", count: 5000)]
for enclave in (SecureEnclave.isAvailable ? [true, false] : [false]) {
  let tag = enclave ? "se" : "sw"
  let m = Mem()
  // account: absent → no-identity; create → present; a second create is refused
  do { _ = try IdentityKeys.account(in: m); e("\(tag).acct.absent", "minted?!") } catch { e("\(tag).acct.absent", error as! IdentityKeys.Failure == .noIdentity) }
  let acct = try! IdentityKeys.createAccount(in: m)
  e("\(tag).acct.again", (try? IdentityKeys.createAccount(in: m)) == nil)
  e("\(tag).acct.same", (try! IdentityKeys.account(in: m)).publicKey.rawRepresentation == acct.publicKey.rawRepresentation)
  e("\(tag).acctpub", b(acct.publicKey.x963Representation))
  for (i, msg) in msgs.enumerated() { e("\(tag).acctsig\(i)", b(IdentityKeys.lowS(try! acct.signature(for: Data(msg.utf8)).rawRepresentation))) }
  // routine device key: mint once, the same key after reload
  let r = try! IdentityKeys.device(.routine, in: m, enclave: enclave)
  let r2 = try! IdentityKeys.device(.routine, in: m, enclave: enclave)
  e("\(tag).routine.stable", r.publicRaw == r2.publicRaw)
  e("\(tag).routinepub", b(r.publicRaw))
  for (i, msg) in msgs.enumerated() { e("\(tag).routinesig\(i)", b(try! r2.sign(Data(msg.utf8)))) }
  // 200 more signatures: every one low-S (the raw chip output is high-S about half the time)
  var all: [String] = []
  for i in 0..<200 { all.append(b(try! r.sign(Data("m\(i)".utf8)))) }
  e("\(tag).many", all.joined(separator: ","))
  // consent: refused without presence
  let c = try! IdentityKeys.device(.consent, in: m, enclave: enclave)
  e("\(tag).consent.distinct", c.publicRaw != r.publicRaw)
  let ctx = LAContext(); ctx.interactionNotAllowed = true
  do { _ = try c.sign(Data("rev.X".utf8), context: ctx); e("\(tag).consent.nopresence", "SIGNED") } catch { e("\(tag).consent.nopresence", (error as? IdentityKeys.Failure) == .declined) }
  // never mint while blind
  m.failReads = true
  do { _ = try IdentityKeys.device(.routine, in: m, enclave: enclave); e("\(tag).blind.device", "minted") } catch { e("\(tag).blind.device", (error as? IdentityKeys.Failure) == .unavailable) }
  do { _ = try IdentityKeys.createAccount(in: m); e("\(tag).blind.account", "minted") } catch { e("\(tag).blind.account", (error as? IdentityKeys.Failure) == .unavailable) }
  m.failReads = false
  e("\(tag).blind.kept", (try! IdentityKeys.device(.routine, in: m, enclave: enclave)).publicRaw == r.publicRaw)
}
// The biometric enrolment tripwire, with the domain state injected (a real
// device's "different face" can't be simulated; gaining or losing them can).
do {
  let m = Mem(), X = Data("faceX".utf8), Y = Data("faceY".utf8)
  _ = try! IdentityKeys.device(.consent, in: m, enclave: false, domainState: { X })
  e("trip.same", IdentityKeys.checkEnrolment(X, in: m) == .unchanged)
  e("trip.other", IdentityKeys.checkEnrolment(Y, in: m) == .changed)
  e("trip.lost", IdentityKeys.checkEnrolment(nil, in: m) == .changed)
  // through the gate, as the agent does: queue the notice, then accept
  _ = IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA"], now: 1, in: m)
  IdentityKeys.acceptEnrolment(Y, in: m)
  e("trip.accepted", IdentityKeys.checkEnrolment(Y, in: m) == .unchanged && IdentityKeys.checkEnrolment(X, in: m) == .changed)
  let n0 = Mem()
  _ = try! IdentityKeys.device(.consent, in: n0, enclave: false, domainState: { nil })
  e("trip.gained", IdentityKeys.checkEnrolment(X, in: n0) == .changed && IdentityKeys.checkEnrolment(nil, in: n0) == .unchanged)
  let legacy = Mem()
  e("trip.norecord", IdentityKeys.checkEnrolment(X, in: legacy) == .changed)
  legacy.failReads = true
  e("trip.unreadable", IdentityKeys.checkEnrolment(X, in: legacy) == .unknown)
}
// The notice comes first, and survives a kill before acceptance (§29).
do {
  let m = Mem(), X = Data("faceX".utf8), Y = Data("faceY".utf8)
  _ = try! IdentityKeys.device(.consent, in: m, enclave: false, domainState: { X })
  e("gate.same", IdentityKeys.enrolmentGate(X, device: "iPhone", devices: ["devA", "devB"], now: 1, in: m) == .proceed)
  e("gate.noaccept.before", !IdentityKeys.acceptEnrolment(Y, in: m) && IdentityKeys.checkEnrolment(Y, in: m) == .changed)
  e("gate.changed", IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA", "devB", "devC"], now: 2, in: m) == .reconfirm)
  e("gate.queued", (IdentityKeys.pendingNotices(in: m) ?? []).count == 1)
  // the agent is killed here, before acceptEnrolment. A fresh process, the same store:
  let restarted = m
  e("gate.survives", (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1 && IdentityKeys.checkEnrolment(Y, in: restarted) == .changed)
  e("gate.idempotent", IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA", "devB", "devC"], now: 3, in: restarted) == .reconfirm && (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1)
  e("gate.accept", IdentityKeys.acceptEnrolment(Y, in: restarted) && IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA", "devB", "devC"], now: 4, in: restarted) == .proceed)
  e("gate.stillqueued", (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1)
  let D = 86_400_000
  if let n = IdentityKeys.pendingNotices(in: restarted)?.first {
    e("snap.recipients", n.recipients == ["devA", "devB", "devC", "address"])
    // the thief removes devB and devC from the device list: nothing here changes
    _ = IdentityKeys.markDelivered(n, to: "devA", now: 10, in: restarted)
    _ = IdentityKeys.markDelivered(n, to: "address", now: 10, in: restarted)
    e("snap.partial", (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1)
    e("snap.stranger", !IdentityKeys.markDelivered(n, to: "mallory", now: 10, in: restarted))
    e("snap.removedStillCounts", IdentityKeys.markDelivered(n, to: "devB", now: 11, in: restarted) && (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1)
    IdentityKeys.sweepNotices(now: 2 + 6 * D, in: restarted)
    e("snap.beforeTimeout", (IdentityKeys.pendingNotices(in: restarted) ?? []).count == 1)
    IdentityKeys.sweepNotices(now: 2 + 7 * D, in: restarted)
    e("snap.afterTimeout", IdentityKeys.pendingNotices(in: restarted)?.isEmpty ?? false)
  } else { for k in ["snap.recipients", "snap.partial", "snap.stranger", "snap.removedStillCounts", "snap.beforeTimeout", "snap.afterTimeout"] { e(k, "no notice queued") } }
  // §29 point 4: the reverse order — drop the victim's devices FIRST, then add a face
  do {
    let L = Mem(); _ = try! IdentityKeys.device(.consent, in: L, enclave: false, domainState: { X })
    let before: Set<String> = ["devA", "devB", "devC"], after: Set<String> = ["devA"]
    e("list.blockedBeforeQueue", !IdentityKeys.mayPublishDeviceList(before: before, after: after, in: L))
    e("list.queued", IdentityKeys.queueDeviceListChange(before: before, after: after, by: "devA", now: 1, in: L)
      && IdentityKeys.mayPublishDeviceList(before: before, after: after, in: L))
    // now the thief adds a face: its snapshot excludes B and C …
    _ = IdentityKeys.enrolmentGate(Y, device: "devA", devices: after, now: 2, in: L)
    let notes = IdentityKeys.pendingNotices(in: L) ?? []
    let listNote = notes.first { $0.kind == "devices-changed" }, faceNote = notes.first { $0.kind == "biometrics-changed" }
    e("list.toBefore", listNote?.recipients == ["devA", "devB", "devC", "address"])
    e("list.faceExcludes", faceNote.map { !$0.recipients.contains("devB") } ?? false)
    // … but B and C still receive the list-change notice, and it waits for them
    if let ln = listNote {
      _ = IdentityKeys.markDelivered(ln, to: "devA", now: 3, in: L); _ = IdentityKeys.markDelivered(ln, to: "address", now: 3, in: L)
      e("list.waitsForRemoved", (IdentityKeys.pendingNotices(in: L) ?? []).contains { $0.kind == "devices-changed" })
      _ = IdentityKeys.markDelivered(ln, to: "devB", now: 3, in: L); _ = IdentityKeys.markDelivered(ln, to: "devC", now: 3, in: L)
      e("list.removedGetIt", !(IdentityKeys.pendingNotices(in: L) ?? []).contains { $0.kind == "devices-changed" })
    } else { e("list.waitsForRemoved", "none"); e("list.removedGetIt", "none") }
    e("list.idempotent", IdentityKeys.queueDeviceListChange(before: ["devA", "devB"], after: ["devA"], by: "devA", now: 5, in: L)
      && IdentityKeys.queueDeviceListChange(before: ["devA", "devB"], after: ["devA"], by: "devA", now: 6, in: L)
      && (IdentityKeys.pendingNotices(in: L) ?? []).filter { $0.kind == "devices-changed" }.count == 1)
  }
  // the receiver's own check: a HOSTILE publisher skips the gate entirely
  do {
    let B = Mem()   // device B's own store
    e("recv.baseline", IdentityKeys.observeDeviceList(["devA", "devB", "devC"], signedBy: "devA", me: "devB", now: 1, in: B) == [])
    // devA publishes A,B,C → A without ever calling queueDeviceListChange / mayPublishDeviceList
    let got = IdentityKeys.observeDeviceList(["devA"], signedBy: "devA", me: "devB", now: 2, in: B) ?? []
    e("recv.self", got.contains { $0.kind == .thisDeviceRemoved && $0.device == "devB" && $0.by == "devA" })
    e("recv.other", got.contains { $0.kind == .deviceRemoved && $0.device == "devC" && $0.by == "devA" })
    e("recv.durable", (IdentityKeys.localAlerts(in: B) ?? []).count == got.count && got.count == 2)
    let C = Mem()   // device C removed devD itself: no alert for that one
    _ = IdentityKeys.observeDeviceList(["devC", "devD"], signedBy: "devC", me: "devC", now: 1, in: C)
    e("recv.ownRemoval", IdentityKeys.observeDeviceList(["devC"], signedBy: "devC", me: "devC", removedHere: ["devD"], now: 2, in: C) == [])
    let U = Mem(); _ = IdentityKeys.observeDeviceList(["devA", "devB"], signedBy: "devA", me: "devB", now: 1, in: U); U.failReads = true
    e("recv.blind", IdentityKeys.observeDeviceList(["devA"], signedBy: "devA", me: "devB", now: 2, in: U) == nil)
    U.failReads = false
    e("recv.blindKeepsBaseline", (IdentityKeys.observeDeviceList(["devA"], signedBy: "devA", me: "devB", now: 3, in: U) ?? []).contains { $0.kind == .thisDeviceRemoved })
  }
  // "can't tell" (locked out, hardware unavailable) is NOT "no biometrics"
  do {
    let L = Mem(), X = Data("faceX".utf8)
    _ = try! IdentityKeys.device(.consent, in: L, enclave: false, domainState: { X })
    let ct = IdentityKeys.cantTell
    e("ct.check", IdentityKeys.checkEnrolment(ct, in: L) == .unknown)
    e("ct.gate", IdentityKeys.enrolmentGate(ct, device: "iPhone", devices: ["devA"], now: 1, in: L) == .refuse && (IdentityKeys.pendingNotices(in: L) ?? []).isEmpty)
    e("ct.noBaseline", !IdentityKeys.recordEnrolment(ct, in: L) && IdentityKeys.checkEnrolment(X, in: L) == .unchanged)
    let F = Mem()
    var threw = false
    do { _ = try IdentityKeys.device(.consent, in: F, enclave: false, domainState: { ct }) } catch { threw = true }
    e("ct.noMint", threw && F.get(IdentityKeys.deviceItem(.consent)) == .absent)
    e("ct.map", IdentityKeys.reading(canEvaluate: true, errorCode: nil, state: X) == X
      && IdentityKeys.reading(canEvaluate: false, errorCode: -7, state: nil) == nil
      && IdentityKeys.reading(canEvaluate: false, errorCode: -8, state: nil) == ct
      && IdentityKeys.reading(canEvaluate: false, errorCode: -6, state: nil) == ct
      && IdentityKeys.reading(canEvaluate: true, errorCode: nil, state: nil) == ct)
  }
  // without the address it NEVER clears, however long and however many devices confirm
  do {
    let a = Mem(); _ = try! IdentityKeys.device(.consent, in: a, enclave: false, domainState: { X })
    _ = IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA", "devB"], now: 1, in: a)
    if let n = IdentityKeys.pendingNotices(in: a)?.first {
      _ = IdentityKeys.markDelivered(n, to: "devA", now: 2, in: a); _ = IdentityKeys.markDelivered(n, to: "devB", now: 2, in: a)
      IdentityKeys.sweepNotices(now: 1 + 30 * D, in: a)
      e("anchor.never", (IdentityKeys.pendingNotices(in: a) ?? []).count == 1)
      _ = IdentityKeys.markDelivered(n, to: "address", now: 1 + 30 * D, in: a)
      e("anchor.then", IdentityKeys.pendingNotices(in: a)?.isEmpty ?? false)
    } else { e("anchor.never", "none"); e("anchor.then", "none") }
  }
  let f = Mem(); _ = try! IdentityKeys.device(.consent, in: f, enclave: false, domainState: { X }); f.failReads = true
  e("gate.blind", IdentityKeys.enrolmentGate(Y, device: "iPhone", devices: ["devA", "devB", "devC"], now: 5, in: f) == .refuse)
}
`
const dir = mkdtempSync(join(tmpdir(), 'bento-idkeys-'))
let out
try {
  writeFileSync(join(dir, 'main.swift'), main)
  execFileSync('swiftc', ['-O', '-D', 'DEBUG', '-D', 'BENTO_SOFTWARE_DEVICE_KEYS', '-o', join(dir, 'k'), ...SRC, join(dir, 'main.swift')], { stdio: 'pipe' })
  out = Object.fromEntries(execFileSync(join(dir, 'k'), { maxBuffer: 1 << 26 }).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
} catch (err) { console.error('swiftc or run failed:\n' + (err.stderr?.toString() ?? err.message)); process.exit(2) }
finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

// A release build (no DEBUG) that sets the software-keys flag must not compile.
let releaseRefused = false, releaseError = ''
{
  const rd = mkdtempSync(join(tmpdir(), 'bento-idkeys-rel-'))
  try {
    writeFileSync(join(rd, 'main.swift'), 'print("built")\n')
    execFileSync('swiftc', ['-O', '-D', 'BENTO_SOFTWARE_DEVICE_KEYS', '-o', join(rd, 'r'), ...SRC, join(rd, 'main.swift')], { stdio: 'pipe' })
  } catch (err) {
    releaseError = err.stderr?.toString() ?? ''
    releaseRefused = /BENTO_SOFTWARE_DEVICE_KEYS is for DEBUG builds only/.test(releaseError)
  } finally { try { rmSync(rd, { recursive: true, force: true }) } catch {} }
}

const d64 = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const halfN = BigInt('0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8')
const lowS = (sig) => BigInt('0x' + d64(sig).subarray(32).toString('hex')) <= halfN
const msgs = ['prove.n0nce.wROOM', 'inv.BPUB.editor.1760000000', 'x'.repeat(5000)]
async function verify(pubB64, sigB64, msg) {
  const key = await webcrypto.subtle.importKey('raw', d64(pubB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  return webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, d64(sigB64), Buffer.from(msg))
}
let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`) }
for (const tag of ['se', 'sw'].filter((t) => out[`${t}.routinepub`])) {
  const name = tag === 'se' ? 'Secure Enclave' : 'software stand-in (simulator)'
  console.log(`${name}:`)
  ok(out[`${tag}.acct.absent`] === 'true', 'no account key yet reads as no-identity, and nothing is minted')
  ok(out[`${tag}.acct.again`] === 'true' && out[`${tag}.acct.same`] === 'true', 'the account key is created once; a second create is refused, never a replacement')
  ok(d64(out[`${tag}.routinepub`]).length === 65 && d64(out[`${tag}.routinepub`])[0] === 4, 'a device public key is the 65-byte uncompressed point (WebCrypto raw)')
  let v = true
  for (let i = 0; i < msgs.length; i++) {
    v &&= await verify(out[`${tag}.acctpub`], out[`${tag}.acctsig${i}`], msgs[i])
    v &&= await verify(out[`${tag}.routinepub`], out[`${tag}.routinesig${i}`], msgs[i])
    v &&= d64(out[`${tag}.routinesig${i}`]).length === 64
  }
  ok(v, 'WebCrypto verifies the account and routine signatures: raw r‖s, 64 bytes')
  const many = out[`${tag}.many`].split(',')
  let mv = true; for (let i = 0; i < many.length; i++) mv &&= await verify(out[`${tag}.routinepub`], many[i], `m${i}`)
  ok(mv && many.every(lowS), `200 more signatures all verify, and every one is LOW-S`)
  ok(out[`${tag}.routine.stable`] === 'true', 'the routine key is the same key after a reload')
  ok(out[`${tag}.consent.distinct`] === 'true', 'the consent key is a separate key')
  ok(out[`${tag}.consent.nopresence`] === 'true', 'the consent key REFUSES to sign without presence')
  ok(out[`${tag}.blind.device`] === 'true' && out[`${tag}.blind.account`] === 'true', 'a store that cannot be read never gets a key minted over it')
  ok(out[`${tag}.blind.kept`] === 'true', 'and the existing device key is still the one in use afterwards')
}
console.log('the notice comes first (§29):')
ok(out['gate.same'] === 'true', 'an unchanged enrolment proceeds')
ok(out['gate.noaccept.before'] === 'true', 'a new enrolment cannot be ACCEPTED before its notice is queued')
ok(out['gate.changed'] === 'true' && out['gate.queued'] === 'true', 'a change queues the notice durably, then asks for re-confirmation')
ok(out['gate.survives'] === 'true', 'killed before acceptance: on restart the notice is still queued and the state still not accepted')
ok(out['gate.idempotent'] === 'true', 'the gate after a restart neither drops nor repeats the notice')
ok(out['gate.accept'] === 'true' && out['gate.stillqueued'] === 'true', 'accepting after re-confirmation leaves the notice queued until it is SENT')
ok(out['snap.recipients'] === 'true', 'the recipients are SNAPSHOTTED when the notice is queued: the devices listed then, plus the address')
ok(out['snap.partial'] === 'true', 'a partial delivery leaves the notice queued')
ok(out['snap.stranger'] === 'true', "a confirmation from someone who isn't a recipient is ignored")
ok(out['snap.removedStillCounts'] === 'true', 'devices REMOVED from the list after queuing are still recipients, and still hold the notice back')
ok(out['snap.beforeTimeout'] === 'true', 'a snapshotted device that never confirms still holds it back at 6 days')
ok(out['snap.afterTimeout'] === 'true', 'and stops holding it back at 7 days, once the address has confirmed')
ok(out['list.blockedBeforeQueue'] === 'true', 'a device-list change may NOT be published before its notice is queued')
ok(out['list.queued'] === 'true', 'once queued, it may')
ok(out['list.toBefore'] === 'true', 'the list-change notice goes to the list as it was BEFORE the change, plus the address')
ok(out['list.faceExcludes'] === 'true', 'the reverse-order attack: the later face notice really does exclude the dropped devices…')
ok(out['list.waitsForRemoved'] === 'true' && out['list.removedGetIt'] === 'true', '…but the dropped devices still receive the list-change notice, which waits for them')
ok(out['list.idempotent'] === 'true', 'queuing the same change twice queues one notice')
ok(out['recv.baseline'] === 'true', "the receiver's first fetch only records the list")
ok(out['recv.self'] === 'true', 'a hostile publisher skips the gate and drops B: B raises its OWN alert on its next fetch, naming who did it')
ok(out['recv.other'] === 'true', 'and alerts for every other device it did not remove itself')
ok(out['recv.durable'] === 'true', 'the alerts are recorded durably')
ok(out['recv.ownRemoval'] === 'true', 'a removal this device made itself raises nothing')
ok(out['recv.blind'] === 'true' && out['recv.blindKeepsBaseline'] === 'true', "an unreadable baseline is never replaced blind: the next good read still sees the removal")
ok(out['ct.check'] === 'true', "a reading that can't be made (lockout, hardware) is UNKNOWN, not 'no biometrics'")
ok(out['ct.gate'] === 'true', 'so the gate refuses the consent, and raises NO false notice')
ok(out['ct.noBaseline'] === 'true', 'it is never recorded as a baseline; the real one stands')
ok(out['ct.noMint'] === 'true', 'and no consent key is minted under it (its first consent would be a false alarm)')
ok(out['ct.map'] === 'true', 'the mapping: a state is that state; not-enrolled (-7) is none; lockout (-8), unavailable (-6) and an empty success are unknown')
ok(out['anchor.never'] === 'true', 'without the ADDRESS a notice never clears, whatever the devices do and however long')
ok(out['anchor.then'] === 'true', 'and clears once the address confirms')
ok(out['gate.blind'] === 'true', "a record or outbox that can't be read refuses the consent")
console.log('biometric enrolment tripwire (§29):')
ok(out['trip.same'] === 'true', 'the enrolment the consent key was created under reads unchanged')
ok(out['trip.other'] === 'true', 'a different enrolment is CHANGED (notify every device, re-confirm)')
ok(out['trip.lost'] === 'true', 'biometrics removed is CHANGED')
ok(out['trip.gained'] === 'true', 'biometrics added where there were none is CHANGED')
ok(out['trip.accepted'] === 'true', 'after a re-confirmed consent the new enrolment is the baseline, and the old one would now be a change')
ok(out['trip.norecord'] === 'true', 'a consent key with no recorded enrolment (made before the check) is CHANGED, re-confirmed once')
ok(out['trip.unreadable'] === 'true', 'a record that cannot be read is UNKNOWN — the consent is refused, the check never skipped')
console.log('release builds:')
ok(releaseRefused, 'a build without DEBUG that sets BENTO_SOFTWARE_DEVICE_KEYS does not compile' + (releaseRefused ? '' : ` (${releaseError.split('\n')[0] || 'it compiled'})`))
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
