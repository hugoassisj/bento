#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * bento/home origin identity — which storage origin a document runs in.
 *
 *   node scripts/test-home-origin.mjs
 *
 * WHY. The iOS host derived each document's `bento-tray://` origin from its file
 * PATH, so a different file that later took the same path inherited the
 * previous file's localStorage and IndexedDB: its recovery copy, its version
 * history, and this device's collab member private key for it (measured). The
 * origin now follows the file (home/ios/OriginIdentity.swift). This compiles the
 * real file and checks every rule, including the ones that keep existing
 * storage: a moved file keeps its origin, a legacy file keeps the one its
 * storage already lives in.
 *
 * Apple platforms only (CryptoKit); it skips cleanly elsewhere, like the
 * releases rig. Run it on a Mac before touching OriginIdentity.swift.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.env.ORIGIN_SRC || join(ROOT, 'home/ios/OriginIdentity.swift')

function haveCryptoKit() {
  let probe
  try {
    probe = mkdtempSync(join(tmpdir(), 'bento-cryptokit-'))
    writeFileSync(join(probe, 'main.swift'), 'import CryptoKit\nimport Foundation\nprint(SHA256.hash(data: Data()).description)\n')
    execFileSync('swiftc', ['-o', join(probe, 'p'), join(probe, 'main.swift')], { stdio: 'pipe' })
    return true
  } catch { return false } finally { if (probe) try { rmSync(probe, { recursive: true, force: true }) } catch {} }
}
if (!haveCryptoKit()) {
  console.log('home origin: SKIPPED — no CryptoKit on this machine (Apple platforms only).')
  console.log('             Run it on a Mac before touching home/ios/OriginIdentity.swift.')
  process.exit(0)
}

// The legacy origin must be EXACTLY what shipped builds derived, or every
// existing document would lose its storage: sha256(path), hex, first 24.
const legacyFor = (p) => createHash('sha256').update(p).digest('hex').slice(0, 24)

const main = String.raw`
import Foundation
typealias O = OriginIdentity
let secret = Data(repeating: 7, count: 32)
var n = 0
func hint() -> String { n += 1; return "hint-\(n)" }
func emit(_ k: String, _ v: Any) { print("\(k)=\(v)") }
func origin(_ d: O.Decision) -> String { switch d { case .known(let o): return o; case .probeLegacy(let o): return o; case .fresh(let o, _): return o } }
func kind(_ d: O.Decision) -> String { switch d { case .known: return "known"; case .probeLegacy: return "probe"; case .fresh: return "fresh" } }

// --- with a document identifier
var ix = O.Index()
let a = O.Facts(path: "/d/Untitled.bento.html", documentKey: "vol1:191", docId: "doc-A")
let d1 = O.decide(a, index: ix, secret: secret, newHint: hint)
emit("first.kind", kind(d1)); emit("first.origin", origin(d1))
let a1 = O.settleLegacy(origin(d1), storedDocIds: [], f: a, secret: secret, newHint: hint)
O.record(origin(a1), hint: nil, f: a, into: &ix)
emit("first.settled", origin(a1))
emit("reopen.kind", kind(O.decide(a, index: ix, secret: secret, newHint: hint)))
emit("reopen.same", origin(O.decide(a, index: ix, secret: secret, newHint: hint)) == origin(a1))
// a move: same document identifier, another path
let moved = O.Facts(path: "/d/sub/Renamed.bento.html", documentKey: "vol1:191", docId: "doc-A")
let dm = O.decide(moved, index: ix, secret: secret, newHint: hint)
emit("move.kind", kind(dm)); emit("move.same", origin(dm) == origin(a1))
// a successor: another file at the SAME, claimed path
let succ = O.Facts(path: "/d/Untitled.bento.html", documentKey: "vol1:192", docId: "doc-B")
let ds = O.decide(succ, index: ix, secret: secret, newHint: hint)
emit("successor.kind", kind(ds)); emit("successor.differs", origin(ds) != origin(a1))
// a cp copy: no document identifier carried, so a new one at a new path
let cp = O.Facts(path: "/d/copy.bento.html", documentKey: "vol1:193", docId: "doc-A")
let dc = O.decide(cp, index: ix, secret: secret, newHint: hint)
let dcs = O.settleLegacy(origin(dc), storedDocIds: [], f: cp, secret: secret, newHint: hint)
emit("copy.differs", origin(dcs) != origin(a1))
// the fresh origin is device-local: another secret, another origin
emit("secret.local", O.freshOrigin(secret: secret, key: "d:k") != O.freshOrigin(secret: Data(repeating: 8, count: 32), key: "d:k"))

// --- legacy adoption, refused on any other document's data
emit("legacy.own", kind(O.settleLegacy("L", storedDocIds: ["doc-A"], f: a, secret: secret, newHint: hint)))
emit("legacy.foreign", kind(O.settleLegacy("L", storedDocIds: ["doc-A", "doc-Z"], f: a, secret: secret, newHint: hint)))
emit("legacy.otheronly", kind(O.settleLegacy("L", storedDocIds: ["doc-Z"], f: a, secret: secret, newHint: hint)))
let enc = O.Facts(path: "/d/e.bento.html", documentKey: "vol1:300", docId: nil)
emit("legacy.unreadable.withdata", kind(O.settleLegacy("L", storedDocIds: ["doc-Z"], f: enc, secret: secret, newHint: hint)))
emit("legacy.unreadable.empty", kind(O.settleLegacy("L", storedDocIds: [], f: enc, secret: secret, newHint: hint)))

// --- no document identifier: the attribute is a hint, validated by the index
var hx = O.Index()
let h1 = O.Facts(path: "/p/Doc.bento.html", documentKey: nil, hint: nil, resourceID: "r1", docId: "doc-H")
let hd = O.decide(h1, index: hx, secret: secret, newHint: hint)
let hs = O.settleLegacy(origin(hd), storedDocIds: [], f: h1, secret: secret, newHint: hint)
// first open of an unclaimed path adopts; give it a hint so a later move can be followed
let token = hint(); O.record(origin(hs), hint: token, f: h1, into: &hx)
let hBack = O.Facts(path: "/p/Doc.bento.html", documentKey: nil, hint: token, resourceID: "r2", docId: "doc-H") // after our save: new inode
emit("hint.inplace", kind(O.decide(hBack, index: hx, secret: secret, newHint: hint)))
let hMove = O.Facts(path: "/p/elsewhere.bento.html", documentKey: nil, hint: token, resourceID: "r1", docId: "doc-H")
emit("hint.move", kind(O.decide(hMove, index: hx, secret: secret, newHint: hint)))
let foreign = O.Facts(path: "/attacker/Planted.bento.html", documentKey: nil, hint: token, resourceID: "r9", docId: "doc-H")
let df = O.decide(foreign, index: hx, secret: secret, newHint: hint)
emit("hint.foreign.kind", kind(df)); emit("hint.foreign.differs", origin(df) != origin(hs))
let hSucc = O.Facts(path: "/p/Doc.bento.html", documentKey: nil, hint: nil, resourceID: "r7", docId: "doc-Q")
let dhs = O.decide(hSucc, index: hx, secret: secret, newHint: hint)
emit("hint.successor.kind", kind(dhs)); emit("hint.successor.differs", origin(dhs) != origin(hs))
if case .fresh(_, let h) = dhs { emit("hint.successor.newhint", h != nil && h != token) }

// --- reading docId without running anything
emit("docid.plain", O.docId(inHTML: Data("<script type=\"application/bento+json\" id=\"bento-doc\">{\"docId\":\"7025B63C-1111-4222-8333-944455556666\",\"title\":\"x\"}</script>".utf8)) ?? "nil")
emit("docid.minted", O.docId(inHTML: Data("<script type=\"application/bento+json\" id=\"bento-doc\">{\"docId\":\"doc-mvdqlzln-0f16k\"}</script>".utf8)) ?? "nil")
emit("docid.junk", O.docId(inHTML: Data("<script type=\"application/bento+json\" id=\"bento-doc\">{\"docId\":\"a b/../c\"}</script>".utf8)) ?? "nil")
emit("docid.decoy", O.docId(inHTML: Data("<!-- id=\"bento-doc\">{\"docId\":\"00000000-0000-4000-8000-000000000000\"} --><div id=\"bento-doc\">{}</div><script type=\"application/bento+json\" id=\"bento-doc\">{\"docId\":\"7025b63c-1111-4222-8333-944455556666\"}</script>".utf8)) ?? "nil")
emit("docid.enc", O.docId(inHTML: Data("<script type=\"application/bento+json\" id=\"bento-doc\">{\"format\":\"bento/enc\",\"v\":1}</script>".utf8)) ?? "nil")
emit("docid.notbento", O.docId(inHTML: Data("<html><body>hi</body></html>".utf8)) ?? "nil")
`
const dir = mkdtempSync(join(tmpdir(), 'bento-origin-'))
let out
try {
  writeFileSync(join(dir, 'main.swift'), main)
  execFileSync('swiftc', ['-O', '-o', join(dir, 'o'), SRC, join(dir, 'main.swift')], { stdio: 'pipe' })
  out = Object.fromEntries(execFileSync(join(dir, 'o')).toString().trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)))
} catch (e) {
  console.error('swiftc or run failed:\n' + (e.stderr?.toString() ?? e.message)); process.exit(2)
} finally { try { rmSync(dir, { recursive: true, force: true }) } catch {} }

let failures = 0, checks = 0
const ok = (c, m) => { checks++; if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`) }
ok(out['first.kind'] === 'probe', 'a file never seen, at a path never claimed, is probed as possibly legacy')
ok(out['first.origin'] === legacyFor('/d/Untitled.bento.html'), 'the legacy origin is exactly what shipped builds derived from the path')
ok(out['first.settled'] === out['first.origin'], 'legacy storage holding only its own docId is adopted (no member re-join)')
ok(out['reopen.kind'] === 'known' && out['reopen.same'] === 'true', 'reopening finds the same origin in the index')
ok(out['move.kind'] === 'known' && out['move.same'] === 'true', 'a MOVED file keeps its origin, so recovery and the member key follow it')
ok(out['successor.kind'] === 'fresh' && out['successor.differs'] === 'true', 'a different file at the same, claimed path gets FRESH storage, never the old one')
ok(out['copy.differs'] === 'true', 'a cp copy gets storage of its own (the document identifier is not carried)')
ok(out['secret.local'] === 'true', 'a fresh origin depends on the device-local secret')
ok(out['legacy.own'] === 'known', 'legacy adoption: storage with only this docId is adopted')
ok(out['legacy.foreign'] === 'fresh', "legacy refusal: storage holding ANOTHER document's data is refused")
ok(out['legacy.otheronly'] === 'fresh', 'legacy refusal: storage holding only another docId is refused')
ok(out['legacy.unreadable.withdata'] === 'fresh', 'an unreadable docId (encrypted) never adopts storage that holds anything')
ok(out['legacy.unreadable.empty'] === 'known', 'an unreadable docId may adopt EMPTY legacy storage')
ok(out['hint.inplace'] === 'known', 'no document identifier: the attribute hint is honoured for the same file after our own save')
ok(out['hint.move'] === 'known', 'no document identifier: the hint follows a move of the recorded file')
ok(out['hint.foreign.kind'] !== 'known' && out['hint.foreign.differs'] === 'true', "a file planted elsewhere carrying another document's attribute does NOT inherit its origin")
ok(out['hint.successor.kind'] === 'fresh' && out['hint.successor.differs'] === 'true', 'no document identifier: a successor at a claimed path gets fresh storage')
ok(out['hint.successor.newhint'] === 'true', 'and a new hint of its own, never the old one')
ok(out['docid.plain'] === '7025B63C-1111-4222-8333-944455556666', "the document's docId is read from #bento-doc without running anything, exactly as stored")
ok(out['docid.minted'] === 'doc-mvdqlzln-0f16k', 'the editor\'s non-UUID form (doc-<random>, minted where randomUUID is unavailable) is read too')
ok(out['docid.junk'] === 'nil', 'a docId with anything but plain characters is not read at all')
ok(out['docid.decoy'] === '7025b63c-1111-4222-8333-944455556666', "the docId comes from the data block's own <script> tag, not the first match in the file")
ok(out['docid.enc'] === 'nil' && out['docid.notbento'] === 'nil', 'an encrypted envelope or a non-Bento page yields no docId')
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
