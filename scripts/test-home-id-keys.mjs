#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * bento/id on iOS and the Mac — the agent's keys (home/ios/IdentityKeys.swift).
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
try { execFileSync('swiftc', ['--version'], { stdio: 'pipe' }) } catch { console.log('home id keys: SKIPPED — no Swift toolchain.'); process.exit(0) }

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
`
const dir = mkdtempSync(join(tmpdir(), 'bento-idkeys-'))
let out
try {
  writeFileSync(join(dir, 'main.swift'), main)
  execFileSync('swiftc', ['-O', '-D', 'BENTO_SOFTWARE_DEVICE_KEYS', '-o', join(dir, 'k'), ...SRC, join(dir, 'main.swift')], { stdio: 'pipe' })
  out = Object.fromEntries(execFileSync(join(dir, 'k'), { maxBuffer: 1 << 26 }).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
} catch (err) { console.error('swiftc or run failed:\n' + (err.stderr?.toString() ?? err.message)); process.exit(2) }
finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

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
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
