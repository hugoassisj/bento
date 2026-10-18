#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * iOS host docstore — the native store the kernel's per-document store
 * (kernel/src/docstore.ts) talks to on bento/home for iOS and the Mac.
 *
 *   node scripts/test-home-docstore-ios.mjs
 *
 * WHY. Without a host store, a document keeps this device's collab member
 * PRIVATE key and its plaintext crash-recovery copy in its web origin's
 * storage. home/ios/HostDocStore.swift moves them out: the member key into the
 * Keychain, the recovery copy into an app-private file, partitioned by the
 * document's origin string so a newcomer at a reused path starts empty. This
 * compiles the real file and checks the rules, with an in-memory stand-in for
 * the Keychain; the real Keychain is exercised in the app.
 *
 * Apple platforms only (Security framework); skips elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.DOCSTORE_SRC || join(ROOT, 'home/ios/HostDocStore.swift')
try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'pipe' }); execFileSync('swiftc', ['--version'], { stdio: 'pipe' }) }
catch { console.log('home docstore (iOS): SKIPPED — no Swift toolchain with the Security framework here.'); process.exit(0) }

const main = String.raw`
import Foundation
final class Mem: HostDocStore.Secrets {
  var d: [String: Data] = [:]
  var failReads = false
  func get(_ a: String) -> HostDocStore.Read { failReads ? .unavailable : (d[a].map { .found($0) } ?? .absent) }
  func set(_ a: String, _ v: Data) -> Bool { d[a] = v; return true }
  func delete(_ a: String) { d[a] = nil }
}
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let mem = Mem()
let s = HostDocStore(secrets: mem, root: root)
func emit(_ k: String, _ v: Any) { print("\(k)=\(v)") }
let A = "0ff8c8a95086abca29e9a3e4", B = "d796984aa4680044f0b8734d"
let key = Data("{\"docId\":\"x\",\"pub\":\"P\",\"priv\":\"S\"}".utf8)
emit("set.member", s.set(.memberkey, key, in: A) == .stored)
emit("get.member", s.get(.memberkey, in: A) == .found(key))
emit("member.inKeychain", mem.d["\(A)/memberkey"] == key)
let rec = Data(repeating: 65, count: 3 * 1024 * 1024)
emit("set.recovery", s.set(.recovery, rec, in: A) == .stored)
emit("get.recovery", s.get(.recovery, in: A) == .found(rec))
emit("recovery.onDisk", FileManager.default.fileExists(atPath: root.appendingPathComponent("\(A)/recovery").path))
emit("recovery.notInKeychain", mem.d["\(A)/recovery"] == nil)
emit("list", (s.list(in: A) ?? []).map(\.rawValue).sorted().joined(separator: ","))
emit("other.empty", s.get(.memberkey, in: B) == .absent && s.get(.recovery, in: B) == .absent && s.list(in: B) == [])
s.delete(.memberkey, in: A)
emit("delete", s.get(.memberkey, in: A) == .absent && (s.list(in: A) ?? []).map(\.rawValue) == ["recovery"])
emit("toolarge", s.set(.recovery, Data(count: HostDocStore.maxBytes + 1), in: A) == .tooLarge)
emit("max.ok", s.set(.recovery, Data(count: 16), in: A) == .stored)
for (i, bad) in ["", "../etc", "ABCDEF", "a/b", "0ff8 ", String(repeating: "a", count: 65)].enumerated() {
  emit("bad[\(i)] \(bad.count > 12 ? "65 chars" : "'" + bad + "'")", s.set(.memberkey, key, in: bad) == .unavailable && s.get(.memberkey, in: bad) == .unavailable)
}
// A read that FAILS is unavailable, never absent, and leaves the stored key alone.
let C = "aaaaaaaaaaaaaaaaaaaaaaaa"
_ = s.set(.memberkey, key, in: C)
mem.failReads = true
emit("failread.member", s.get(.memberkey, in: C) == .unavailable)
emit("failread.list", s.list(in: C) == nil)
mem.failReads = false
emit("failread.keyKept", s.get(.memberkey, in: C) == .found(key))
// A recovery file that exists but can't be read is unavailable; a missing one is absent.
let D = "bbbbbbbbbbbbbbbbbbbbbbbb"
_ = s.set(.recovery, Data("plaintext".utf8), in: D)
let rf = root.appendingPathComponent("\(D)/recovery").path
chmod(rf, 0)
emit("unreadable.recovery", s.get(.recovery, in: D) == .unavailable)
chmod(rf, 0o600)
emit("readable.again", s.get(.recovery, in: D) == .found(Data("plaintext".utf8)))
emit("missing.recovery", s.get(.recovery, in: C) == .absent)
emit("classify.ok", KeychainSecrets.classify(errSecSuccess, Data([1])) == .found(Data([1])))
emit("classify.notfound", KeychainSecrets.classify(errSecItemNotFound, nil) == .absent)
emit("classify.entitlement", KeychainSecrets.classify(-34018, nil) == .unavailable)
emit("classify.interaction", KeychainSecrets.classify(errSecInteractionNotAllowed, nil) == .unavailable)
emit("classify.nodata", KeychainSecrets.classify(errSecSuccess, nil) == .unavailable)
emit("noEscape", !FileManager.default.fileExists(atPath: root.deletingLastPathComponent().appendingPathComponent("etc").path))
`
const dir = mkdtempSync(join(tmpdir(), 'bento-docstore-'))
let out
try {
  writeFileSync(join(dir, 'main.swift'), main)
  execFileSync('swiftc', ['-O', '-o', join(dir, 'd'), SRC, join(dir, 'main.swift')], { stdio: 'pipe' })
  out = Object.fromEntries(execFileSync(join(dir, 'd'), [join(dir, 'store')]).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
} catch (e) { console.error('swiftc or run failed:\n' + (e.stderr?.toString() ?? e.message)); process.exit(2) }
finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`) }
ok(out['set.member'] === 'true' && out['get.member'] === 'true', 'the member key round-trips')
ok(out['member.inKeychain'] === 'true', 'the member key is held by the secrets store (the Keychain in the app), not a file')
ok(out['set.recovery'] === 'true' && out['get.recovery'] === 'true', 'a 3 MB recovery copy round-trips')
ok(out['recovery.onDisk'] === 'true' && out['recovery.notInKeychain'] === 'true', 'the recovery copy is a file, never a Keychain item')
ok(out['list'] === 'memberkey,recovery', 'list names exactly what is stored')
ok(out['other.empty'] === 'true', "another document's partition sees none of it (a newcomer at a reused path starts empty)")
ok(out['delete'] === 'true', 'delete removes one entry and leaves the other')
ok(out['toolarge'] === 'true', 'a value over the cap is refused as too large')
ok(out['max.ok'] === 'true', 'a value under the cap is stored')
for (const [k, v] of Object.entries(out).filter(([k]) => k.startsWith('bad['))) ok(v === 'true', `a partition that isn't host-minted hex is refused: ${k}`)
ok(out['failread.member'] === 'true', "a member-key read that FAILS is unavailable, not absent (so the kernel won't mint over it)")
ok(out['failread.list'] === 'true', "list can't answer when a read fails — it says unavailable, not a partial list")
ok(out['failread.keyKept'] === 'true', 'the stored member key is unchanged by the failed read')
ok(out['unreadable.recovery'] === 'true', "a recovery file that exists but can't be read is unavailable (the next autosave must not replace it)")
ok(out['readable.again'] === 'true', 'and reads back once it can be read')
ok(out['missing.recovery'] === 'true', 'a recovery file that is not there is absent')
ok(out['classify.ok'] === 'true' && out['classify.notfound'] === 'true', 'Keychain: success is found; errSecItemNotFound, and only it, is absent')
ok(out['classify.entitlement'] === 'true' && out['classify.interaction'] === 'true', 'Keychain: a missing entitlement or a locked device is unavailable')
ok(out['classify.nodata'] === 'true', 'Keychain: success with no data is unavailable, not absent')
ok(out['noEscape'] === 'true', 'nothing is written outside the store folder')
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
