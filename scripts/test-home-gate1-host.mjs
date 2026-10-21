#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * bento/connect on iOS: gate 1 IN THE APP. The editor decides the verdict before
 * serving a document, and serves a GENUINE one under its release's hash-pinned
 * CSP. This builds the app, opens corpus documents on a simulator against the
 * corpus history and its TEST key (DEBUG-only hooks), and reads back what the
 * app decided and what actually ran.
 *
 *   node scripts/test-home-gate1-host.mjs     (GATE1_DIR=<path> to point elsewhere)
 *
 * - genuine: served under exactly its release's pins, and the pinned remover RAN
 *   (the policy doesn't break the release's own scripts)
 * - an extra plain script: UNKNOWN, served as before with no borrowed CSP, and the
 *   document still works (its script runs)
 * - the attack rows: whatever the verdict, nothing gate 1 didn't account for runs
 *   in a document it called genuine
 * - a runtime the history doesn't carry: "check for updates", not damage
 * - no history on the device: UNKNOWN, and the document still opens
 *
 * Needs Xcode and an iOS simulator; skips elsewhere.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = process.env.GATE1_DIR || join(ROOT, 'home/fixtures/gate1')
const BUNDLE = 'page.bento.home'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', maxBuffer: 1 << 26, ...opts }).toString()
try { run('xcrun', ['simctl', 'help']) } catch { console.log('home gate1 host: SKIPPED — needs Xcode with iOS simulators.'); process.exit(0) }
if (!existsSync(join(DIR, 'expected.json'))) { console.error(`no corpus at ${DIR}`); process.exit(2) }

let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`) }
const work = mkdtempSync(join(tmpdir(), 'bento-gate1host-'))
const sleep = (s) => run('sleep', [String(s)])

const devices = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', 'available', '-j'])).devices
const phone = Object.entries(devices).filter(([rt]) => rt.includes('iOS')).flatMap(([, ds]) => ds).find((d) => d.name.startsWith('iPhone'))
if (!phone) { console.error('no available iPhone simulator'); process.exit(2) }
const DEV = phone.udid
console.log(`simulator: ${phone.name}`)
if (phone.state !== 'Booted') { try { run('xcrun', ['simctl', 'boot', DEV]) } catch {} }
run('xcrun', ['simctl', 'bootstatus', DEV, '-b'], { timeout: 600000 })

const ios = join(ROOT, 'home/ios'), dd = join(work, 'dd')
try { run('xcodegen', [], { cwd: ios }) } catch (e) { console.error('xcodegen failed (is it installed?)'); process.exit(2) }
try {
  run('xcodebuild', ['-project', 'BentoTray.xcodeproj', '-scheme', 'BentoTray', '-configuration', 'Debug',
    '-destination', `platform=iOS Simulator,id=${DEV}`, '-derivedDataPath', dd, 'CODE_SIGN_IDENTITY=-', 'build'], { cwd: ios, timeout: 1200000 })
} catch (e) { console.error('build failed:\n' + (e.stdout?.toString().split('\n').filter((l) => / error: /.test(l)).join('\n') || e.message)); process.exit(2) }
const prod = join(dd, 'Build/Products', readdirSync(join(dd, 'Build/Products')).find((d) => d.endsWith('-iphonesimulator')))
run('xcrun', ['simctl', 'install', DEV, join(prod, 'BentoTray.app')])
const DATA = run('xcrun', ['simctl', 'get_app_container', DEV, BUNDLE, 'data']).trim()
mkdirSync(join(DATA, 'Documents'), { recursive: true })
const tmpIn = join(DATA, 'tmp'); mkdirSync(tmpIn, { recursive: true })
// the corpus history and key, where the app can read them
writeFileSync(join(tmpIn, 'history.json'), readFileSync(join(DIR, 'history.json')))
writeFileSync(join(tmpIn, 'key.json'), readFileSync(join(DIR, 'test-public-key.json')))
const history = JSON.parse(JSON.parse(readFileSync(join(DIR, 'history.json'), 'utf8')).payload)
const pinsOf = (v) => history.releases.find((e) => e.version === v).pins.scriptSrc

/** open one document in the app and read back the verdict, the policy, and what ran */
function open(name, text, { withHistory = true } = {}) {
  const path = join(DATA, 'Documents', `${name}.bento.html`)
  writeFileSync(path, text)
  const out = join(tmpIn, `gate-${name}.json`)
  rmSync(out, { force: true })
  try { run('xcrun', ['simctl', 'terminate', DEV, BUNDLE]) } catch {}
  const env = { ...process.env, SIMCTL_CHILD_BENTO_RIG_OPEN: path, SIMCTL_CHILD_BENTO_RIG_GATE: out }
  if (withHistory) Object.assign(env, { SIMCTL_CHILD_BENTO_RIG_HISTORY: join(tmpIn, 'history.json'), SIMCTL_CHILD_BENTO_RIG_HISTORY_KEY: join(tmpIn, 'key.json') })
  run('xcrun', ['simctl', 'launch', DEV, BUNDLE], { env })
  for (let i = 0; i < 40 && !existsSync(out); i++) sleep(1)
  return existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { verdict: 'no answer' }
}

const read = (p) => readFileSync(join(DIR, p), 'utf8')
const genuine = read('served/genuine-1.0.0.html')
try {
  console.log('genuine: served under its own pins, and its own scripts still run')
  const g = open('genuine', genuine)
  ok(g.verdict === 'genuine' && g.version === '1.0.0', `gate 1 in the app: ${g.verdict} ${g.version ?? g.why ?? ''}`)
  const ss = (g.csp ?? '').split('; ').find((d) => d.startsWith('script-src ')) ?? ''
  ok(ss === `script-src ${pinsOf('1.0.0').map((h) => `'${h}'`).join(' ')} blob:` && (g.csp ?? '').startsWith("default-src 'none'"),
    "served under exactly 1.0.0's pins and blob:, default-src 'none'")
  ok(g.previews === 0, `the pinned remover ran under that policy (${g.previews} preview elements left)`)

  console.log('an extra plain script: UNKNOWN, served as before')
  const u = open('extra', genuine.replace('</body>', '<script>window.pwned="ran"</script></body>'))
  ok(u.verdict === 'unknown' && u.csp === undefined, `unknown, with no borrowed CSP (${u.why})`)
  ok(u.pwned === 'ran', 'and the document still works: its own script ran (it just gets no identity)')

  console.log('the attack rows: nothing gate 1 did not account for runs in a document it calls genuine')
  for (const [name, why, text] of [
    ['a-u0130', 'U+0130 index drift', genuine.replace('</body>', '<p>' + 'İ'.repeat(20) + '</p><style>a{}</style><script>window.pwned=1</script></body>')],
    ['a-slash', '"/" as an attribute separator', genuine.replace('</body>', '<script /type="text/javascript" type="application/bento+json">window.pwned=2</script></body>')],
    ['a-tagname', '"<" inside a tag name', genuine.replace('<meta charset="UTF-8">', '<meta<style><script>window.pwned=3</script></style> charset="UTF-8">')],
  ]) {
    const a = open(name, text)
    if (a.verdict === 'genuine') ok(a.pwned === 'undefined', `${why}: gate 1 says genuine, and the CSP still kept the injected script from running (pwned ${a.pwned})`)
    else ok(a.csp === undefined, `${why}: gate 1 says unknown (${a.why}), so no pinned CSP and no identity`)
  }

  console.log('what the person is told')
  const rt = open('rt', read('served/runtime-byte-changed.html'))
  ok(rt.verdict === 'unknown' && /check for updates/.test(rt.why ?? ''), `a runtime the history doesn't carry: "${rt.why}"`)
  const ld = open('ld', read('served/loader-byte-changed.html'))
  ok(ld.verdict === 'unknown' && !/check for updates/.test(ld.why ?? ''), `a known runtime with an altered loader is not offered an update: "${ld.why}"`)
  const none = open('nohistory', genuine, { withHistory: false })
  ok(none.verdict === 'unknown' && /no release history/.test(none.why ?? '') && none.previews === 0, `no history on the device: unknown (${none.why}), and the document still opens`)
} finally {
  try { run('xcrun', ['simctl', 'terminate', DEV, BUNDLE]) } catch {}
  rmSync(work, { recursive: true, force: true })
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
