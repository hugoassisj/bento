#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// home/webext — serving a verified document with identity (bento/connect W2).
//
//   node scripts/test-webext-serve.ts
//
// WHAT THIS PROVES (so far: the release histories gate 1 checks against).
//   · A history is held only if it verifies under the release key, names the
//     right app, is well-formed, and kernel's acceptHistory accepts it over
//     what is held (anti-rollback: an older signed history can't hide a release).
//   · It is fetched at most daily, never for someone who hasn't used identity
//     opening, and a failed fetch keeps what is held.
// The corpus's signed history (home/fixtures/gate1/history.json) and its
// throwaway test key stand in for the real ones.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const H = await import('../home/webext/src/serve/history.js')
const G = await import('../home/webext/src/id/gen/gate1.js')

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

const FIX = join(root, 'home/fixtures/gate1')
const signed = readFileSync(join(FIX, 'history.json'), 'utf8')
const jwk = JSON.parse(readFileSync(join(FIX, 'test-public-key.json'), 'utf8'))
const payload = JSON.parse(JSON.parse(signed).payload)
const APPS = [{ id: 'test', appId: payload.app }]
const DAY = H.DAY
let clock = Date.UTC(2026, 9, 21)
const storage = () => { const m = new Map<string, any>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: any) => { m.set(k, structuredClone(v)) } } }
const net = (body: string | null, status = 200) => { const calls: string[] = []; return { calls, fetch: async (u: string) => { calls.push(u); if (body === null) throw new TypeError('offline'); return { ok: status === 200, status, text: async () => body } } } }
const deps = (s: any, n: any) => ({ get: s.get, set: s.set, fetch: n.fetch, now: () => clock, jwk })

console.log('\n— holding a verified history')
{
  const s = storage(), n = net(signed)
  const r = await H.refresh(APPS, deps(s, n))
  ok(r[payload.app] === 'updated' && n.calls[0] === `${H.BASE}/test/history.json`, 'a signed, well-formed history for the app is fetched from bento.page and held')
  const held = await H.heldHistories(deps(s, n))
  ok(JSON.stringify(held[payload.app]) === JSON.stringify(payload), 'what is held is exactly the signed payload')
  // and gate 1 can use it: a genuine corpus file is genuine against the held history
  const genuine = readFileSync(join(FIX, 'served/genuine-1.2.0.html'), 'utf8')
  const v = await G.verifyServed(genuine, held[payload.app])
  ok(v.verdict === 'genuine' && v.release.version === '1.2.0', 'gate 1 matches a genuine file against the held history')
  // fresh: no refetch inside a day
  clock += DAY / 2
  const again = await H.refresh(APPS, deps(s, n))
  ok(again[payload.app] === 'fresh' && n.calls.length === 1, 'not fetched again within a day')
  clock += DAY
  await H.refresh(APPS, deps(s, n))
  ok(n.calls.length === 2, 'fetched again after a day')
}

console.log('\n— refusing what must not be held')
{
  const bad = (mut: (o: any) => void) => { const o = JSON.parse(signed); mut(o); return JSON.stringify(o) }
  const cases: [string, string, string][] = [
    ['a payload changed after signing', bad((o) => { o.payload = o.payload.replace('1.2.0', '1.2.9') }), 'signature'],
    ['a missing signature', bad((o) => { delete o.sig }), 'not signed'],
    ['not JSON', 'nope', 'not valid JSON'],
  ]
  for (const [label, body, why] of cases) {
    const s = storage()
    const r = await H.refresh(APPS, deps(s, net(body)))
    ok(String(r[payload.app]).startsWith('refused') && String(r[payload.app]).includes(why) && !(await H.heldHistories(deps(s, net(body))))[payload.app], `${label} is refused and nothing is held`)
  }
  const s = storage()
  const r = await H.refresh([{ id: 'test', appId: 'bento-slides' }], deps(s, net(signed)))
  ok(r['bento-slides'] === 'refused: history for another app', 'a genuine history for ANOTHER app is refused (sibling channels on one origin)')
}

console.log('\n— anti-rollback, and failures keep what is held')
{
  const s = storage()
  await H.refresh(APPS, deps(s, net(signed)))
  // a REPLAYED older history, validly signed: the rig signs with its own key
  // pair, so refresh's own anti-rollback check is what's under test
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pubJwk = await crypto.subtle.exportKey('jwk', kp.publicKey)
  const sign = async (p: any) => {
    const text = JSON.stringify(p)
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(text)))
    return JSON.stringify({ payload: text, sig: Buffer.from(sig).toString('base64') })
  }
  const own = storage()
  const ownDeps = (n: any) => ({ ...deps(own, n), jwk: pubJwk })
  ok((await H.refresh(APPS, ownDeps(net(await sign(payload)))))[payload.app] === 'updated', 'a history signed by the (rig\'s) release key is held')
  clock += 2 * DAY
  const older = { ...payload, releases: payload.releases.slice(1) }
  const replay = await H.refresh(APPS, ownDeps(net(await sign(older))))
  ok(String(replay[payload.app]).startsWith('refused') && (await H.heldHistories(ownDeps(net(null))))[payload.app].releases.length === payload.releases.length,
    `a REPLAYED older history, validly signed, is refused by refresh and the newer one stays held (${replay[payload.app]})`)
  clock += 2 * DAY
  const r = await H.refresh(APPS, deps(s, net(null)))
  ok(String(r[payload.app]).startsWith('refused') && (await H.heldHistories(deps(s, net(null))))[payload.app]?.releases.length === payload.releases.length, 'offline: the refresh fails and what is held stays')
  const r2 = await H.refresh(APPS, deps(s, net('x', 503)))
  ok(r2[payload.app] === 'http 503' && !!(await H.heldHistories(deps(s, net(null))))[payload.app], 'a server error keeps what is held')
}

console.log('\n— no phone-home for someone who never used it')
{
  const s = storage(), n = net(signed)
  const r = await H.refreshIfUsed(APPS, deps(s, n))
  ok(r.skipped === 'never used' && n.calls.length === 0, 'the browser-start refresh makes NO request until identity opening has been used')
  await s.set(H.USED_KEY, true)
  await H.refreshIfUsed(APPS, deps(s, n))
  ok(n.calls.length === 1, 'after it has been used, the browser-start refresh fetches')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
