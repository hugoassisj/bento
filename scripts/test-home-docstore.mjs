#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The per-document store relay in home/bridge.js, driven end to end: the REAL
// bridge, the REAL kernel client (kernel/src/docstore.ts ExtensionBackend), and
// a fake native host that answers the way both native hosts must.
//
//   node scripts/test-home-docstore.mjs
//
// What it guards:
// - NO capability, NO store. A host that has not declared 'store' must not get
//   `window.__bentoHost` — the kernel would then use a store that refuses, and
//   deliberately never fall back, losing the member key on every reload.
// - With the capability: get/set/list/delete round trips, bytes intact, and a
//   reply's bytes are a Uint8Array the kernel accepts.
// - The relay answers only the page's own window, refuses unknown ops, passes a
//   native refusal through, and does nothing in a subframe.
//
// Each scenario runs in its own process: both the bridge and the kernel decide
// once per page and cache it on the global.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const BRIDGE = readFileSync(join(root, 'home/bridge.js'), 'utf8')

// ------------------------------------------------------------ one scenario

async function scenario(name) {
  // A page: a window with postMessage → 'message' events whose source is the
  // window itself, and a top. Node has btoa/atob and Uint8Array already.
  const listeners = new Set()
  const win = globalThis
  win.window = win
  win.top = name === 'subframe' ? {} : win
  win.addEventListener = (t, fn) => { if (t === 'message') listeners.add(fn) }
  win.removeEventListener = (t, fn) => { if (t === 'message') listeners.delete(fn) }
  const dispatch = (data, source) => setTimeout(() => { for (const fn of [...listeners]) fn({ data, source }) }, 0)
  win.postMessage = (data) => dispatch(data, win)

  // The fake native host: Android's transport (JSON strings both ways), and
  // the native contract — names allow-listed, bytes as base64, refusals as
  // ok:false.
  const kept = new Map()
  const native = {
    onmessage: null,
    postMessage(json) {
      const m = JSON.parse(json)
      const reply = (ok, value) => setTimeout(() => native.onmessage({ data: JSON.stringify({ id: m.id, ok, value }) }), 0)
      if (!String(m.op).startsWith('store.')) return reply(false, 'not this rig')
      if (m.op !== 'store.list' && m.name !== 'recovery' && m.name !== 'memberkey') return reply(false, 'refused')
      if (m.op === 'store.set' && m.b64.length > 4 * 1024 * 1024) return reply(false, 'too-large')
      if (m.op === 'store.get') return reply(true, kept.has(m.name) ? kept.get(m.name) : null)
      if (m.op === 'store.set') { kept.set(m.name, m.b64); return reply(true, null) }
      if (m.op === 'store.list') return reply(true, JSON.stringify([...kept.keys()]))
      if (m.op === 'store.delete') { kept.delete(m.name); return reply(true, null) }
      return reply(false, 'unknown op')
    },
  }
  win.__bentoTrayNative = native
  if (name !== 'no-caps' && name !== 'identity-control') win.__bentoHostCaps = ['store']

  vm.runInThisContext(BRIDGE, { filename: 'home/bridge.js' })

  if (name.startsWith('identity-')) return identity(name, win, kept)

  const { docStore } = await import(pathToFileURL(join(root, 'kernel/src/docstore.ts')).href)
  // `wait` is how long silence must last to count as "no answer". Requests that
  // expect one get a long wait, so a slow machine is never read as a refusal;
  // only the cases that must get NO answer use the short one.
  const ask = (data, source = win, wait = 300) => new Promise((res) => {
    const fn = (ev) => { if (ev.data && ev.data.dir === 'res' && ev.data.id === data.id) { listeners.delete(fn); res(ev.data.result) } }
    listeners.add(fn); dispatch(data, source)
    setTimeout(() => { listeners.delete(fn); res('NO ANSWER') }, wait)
  })
  const out = { capsLeft: 'caps' in win && win.__bentoHostCaps !== undefined, host: win.__bentoHost ?? null }

  if (name === 'no-caps' || name === 'subframe') {
    out.store = docStore() === null ? 'none' : 'PRESENT'
    out.raw = await ask({ __bento_tray__: true, dir: 'req', id: 'x1', op: 'store.list', payload: {} })
    return out
  }

  const s = docStore()
  out.store = s ? 'present' : 'none'
  const big = new Uint8Array(1 << 20); for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff
  out.set = await s.set('recovery', big)
  const got = await s.get('recovery')
  out.getIsU8 = got instanceof Uint8Array
  out.getEqual = got && got.length === big.length && got.every((v, i) => v === big[i])
  out.setKey = await s.set('memberkey', new TextEncoder().encode('{"docId":"d","pub":"P","priv":"K"}'))
  out.list = (await s.list()).sort()
  out.del = await s.delete('recovery')
  out.afterDelete = await s.get('recovery')
  out.unknownOp = await ask({ __bento_tray__: true, dir: 'req', id: 'x2', op: 'store.wipe', payload: {} }, win, 5000)
  out.foreignName = await ask({ __bento_tray__: true, dir: 'req', id: 'x3', op: 'store.get', payload: { name: 'evil' } }, win, 5000)
  out.otherSource = await ask({ __bento_tray__: true, dir: 'req', id: 'x4', op: 'store.list', payload: {} }, {})
  out.tooLarge = await s.set('recovery', new Uint8Array(4 * 1024 * 1024))
  out.tooLargeRaw = await ask({ __bento_tray__: true, dir: 'req', id: 'x5', op: 'store.set', payload: { name: 'recovery', bytes: new Uint8Array(4 * 1024 * 1024) } }, win, 15000)
  out.hostWritable = (() => { try { win.__bentoHost = { ops: [] }; return win.__bentoHost.ops.length === 0 } catch (_) { return false } })()
  return out
}

// The kernel's REAL member-key path (kernel/src/sync/online.ts deviceIdentity)
// through the real bridge. This is the step that takes every existing Android
// member key out of web storage: an identity already in localStorage is ADOPTED
// (same keys) with its private half moved into the host store, and a new one is
// minted straight into the store. Without the capability, nothing moves — the
// control that shows the probe can tell the difference.
async function identity(name, win, kept) {
  const ls = new Map()
  win.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k),
    key: (i) => [...ls.keys()][i] ?? null, get length() { return ls.size } }
  win.location = new URL('https://0123456789abcdef01234567.bento-tray.invalid/index.html')
  // Enough document for the kernel modules this import chain loads. save.ts runs
  // its launchQueue consumer at import (the real bridge defines launchQueue here),
  // and with no #bento-doc block it reads nothing and adopts nothing.
  win.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] }
  const { register } = await import('node:module')
  register(pathToFileURL(join(root, 'scripts/lib/ts-resolve-hooks.mjs')).href, import.meta.url)
  const { configureApp } = await import(pathToFileURL(join(root, 'kernel/src/app.ts')).href)
  configureApp({ appId: 'bento-rig', appName: 'Rig', manifestUrl: 'https://example.invalid/m.json' })
  const { deviceIdentity } = await import(pathToFileURL(join(root, 'kernel/src/sync/online.ts')).href)

  const docId = 'doc-k3x9q2ab'
  const existing = { pub: 'EXISTING-PUB', priv: 'EXISTING-PRIV' }
  if (name !== 'identity-mint') ls.set(`bento-member-${docId}`, JSON.stringify(existing))
  const id = await deviceIdentity(docId)
  const held = kept.has('memberkey') ? JSON.parse(Buffer.from(kept.get('memberkey'), 'base64').toString()) : null
  return { id, local: JSON.parse(ls.get(`bento-member-${docId}`) ?? 'null'), held, host: win.__bentoHost ?? null }
}

// ------------------------------------------------------------ the checks

if (process.argv[2] === '--scenario') {
  scenario(process.argv[3]).then((r) => { process.stdout.write(JSON.stringify(r)); process.exit(0) },
    (e) => { process.stdout.write(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0) })
} else {
  let pass = 0, fail = 0
  const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`); c ? pass++ : fail++ }
  const run = (n) => {
    const r = spawnSync(process.execPath, ['--no-warnings', fileURLToPath(import.meta.url), '--scenario', n], { encoding: 'utf8' })
    try { return JSON.parse(r.stdout) } catch (_) { return { error: r.stdout + r.stderr } }
  }

  const none = run('no-caps')
  if (none.error) console.log(none.error)
  ok(none.host === null, 'no declared capability: no window.__bentoHost')
  ok(none.store === 'none', 'no declared capability: the kernel finds no store and keeps its own storage')
  ok(none.raw === 'NO ANSWER', 'no declared capability: a store request gets no relay at all')

  const sub = run('subframe')
  ok(sub.host === null && sub.store === 'none', 'in a subframe: no store, even with the capability declared')
  ok(sub.raw === 'NO ANSWER', 'in a subframe: a store request gets no relay')

  const r = run('caps')
  if (r.error) console.log(r.error)
  ok(r.capsLeft === false, 'the capability declaration is consumed, not left on the page')
  ok(Array.isArray(r.host?.ops) && r.host.ops.includes('store'), 'declared capability: __bentoHost.ops includes store')
  ok(r.hostWritable === false, '__bentoHost cannot be replaced by the page')
  ok(r.store === 'present', 'declared capability: the kernel uses the host store')
  ok(r.set === 'stored', 'a 1 MiB recovery copy is stored')
  ok(r.getIsU8 === true, 'a read returns a Uint8Array the kernel accepts (built in the page realm)')
  ok(r.getEqual === true, 'the bytes come back identical')
  ok(r.setKey === 'stored', 'the member key is stored')
  ok(JSON.stringify(r.list) === JSON.stringify(['memberkey', 'recovery']), 'list names both entries')
  ok(r.del === true && r.afterDelete === null, 'delete removes an entry; a later read finds nothing')
  ok(r.unknownOp?.ok === false && /unknown op/.test(r.unknownOp.reason), 'an unknown store op is refused by the relay')
  ok(r.foreignName?.ok === false && r.foreignName.reason === 'refused', "a name outside recovery/memberkey is refused, reason 'refused'")
  ok(r.tooLarge === 'refused', 'a host over-cap refusal reaches the kernel as a refused write, not a hang')
  ok(r.tooLargeRaw?.ok === false && r.tooLargeRaw.reason === 'too-large', "the host's 'too-large' reason passes through the relay unchanged")
  ok(r.otherSource === 'NO ANSWER', 'a request whose source is not the page window is ignored')

  const adopt = run('identity-adopt')
  if (adopt.error) console.log(adopt.error)
  ok(adopt.id?.pub === 'EXISTING-PUB' && adopt.id?.priv === 'EXISTING-PRIV', 'deviceIdentity ADOPTS an existing member key unchanged (no re-join, same identity)')
  ok(adopt.held?.priv === 'EXISTING-PRIV' && adopt.held?.docId === 'doc-k3x9q2ab', "the adopted key's private half moves into the host store, under this document")
  ok(adopt.local && adopt.local.pub === 'EXISTING-PUB' && !('priv' in adopt.local), 'localStorage keeps only the public key after adoption')

  const mint = run('identity-mint')
  if (mint.error) console.log(mint.error)
  ok(typeof mint.held?.priv === 'string' && mint.held.priv.length > 20 && mint.held.pub === mint.id?.pub, 'a freshly minted member key goes into the host store')
  ok(mint.local && mint.local.pub === mint.id?.pub && !('priv' in mint.local), 'a fresh mint never writes the private half to localStorage')

  const ctl = run('identity-control')
  if (ctl.error) console.log(ctl.error)
  ok(ctl.host === null && ctl.held === null && ctl.local?.priv === 'EXISTING-PRIV', 'control, no capability: the private key stays in localStorage (so the cases above discriminate)')

  console.log(`\n${pass}/${pass + fail} checks passed`)
  process.exit(fail ? 1 : 0)
}
