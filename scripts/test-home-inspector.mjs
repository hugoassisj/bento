#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The Android host's legacy-origin inspector, run as it ships: the script is
// extracted from DocumentOrigin.kt (INSPECTOR_HTML) and executed against
// kernel-shaped storage.
//
//   node scripts/test-home-inspector.mjs
//
// Why it matters: before adopting an old per-path origin, the host asks this
// script which documents own data there. A docId it misses lets a different
// document inherit the old one's recovery copy and member key; data it cannot
// attribute must REFUSE adoption. The JVM rig covers the decision; only this
// covers the script.
//
// IndexedDB is a small in-memory fake implementing exactly what the script
// uses (databases, open, objectStoreNames, transaction/objectStore,
// openKeyCursor on stores and indexes, count, indexNames). The same script was
// also run once against real Chromium storage when this rig was written.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kt = readFileSync(join(root, 'home/android/app/src/main/java/page/bento/home/DocumentOrigin.kt'), 'utf8')
const html = kt.slice(kt.indexOf('val INSPECTOR_HTML = """') + 'val INSPECTOR_HTML = """'.length)
const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>')).replaceAll("${'$'}", '$')

// ------------------------------------------------------------ a fake origin

function origin({ dbs = {}, local = {}, noList = false } = {}) {
  // dbs: { name: { store: { records: [[key, value]], indexes: { idx: field } } } }
  const opened = []
  const later = (fn) => setTimeout(fn, 0)
  const request = (result) => { const r = {}; later(() => { r.result = typeof result === 'function' ? result() : result; r.onsuccess && r.onsuccess() }); return r }
  const cursorOver = (keys) => {
    const r = {}; let i = 0
    const step = () => later(() => {
      r.result = i < keys.length ? { primaryKey: keys[i][0], key: keys[i][1], continue: () => { i++; step() } } : null
      r.onsuccess && r.onsuccess()
    })
    step(); return r
  }
  const indexedDB = {
    open(name) {
      opened.push(name)
      if (!dbs[name]) throw new Error(`opened a database that was not listed: ${name}`)
      const stores = dbs[name]
      return request({
        objectStoreNames: Object.keys(stores),
        transaction: (st) => ({ objectStore: () => {
          const s = stores[st]; const recs = s.records || []
          return {
            indexNames: { contains: (n) => !!(s.indexes || {})[n] },
            openKeyCursor: () => cursorOver(recs.map(([k]) => [k, k])),
            count: () => request(recs.length),
            index: (n) => ({ openKeyCursor: () => cursorOver(recs.map(([k, v]) => [k, v[s.indexes[n]]]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))) }),
          }
        } }),
        close() {},
      })
    },
  }
  if (!noList) indexedDB.databases = async () => Object.keys(dbs).map((name) => ({ name, version: 1 }))
  const keys = Object.keys(local)
  const localStorage = { get length() { return keys.length }, key: (i) => keys[i] }
  return { indexedDB, localStorage, opened }
}

async function inspect(env) {
  let report = null
  const __bentoInspect = { postMessage: (s) => { report = JSON.parse(s) } }
  const run = new Function('indexedDB', 'localStorage', '__bentoInspect', script)
  run(env.indexedDB, env.localStorage, __bentoInspect)
  for (let i = 0; i < 200 && !report; i++) await new Promise((r) => setTimeout(r, 1))
  return { ...report, docIds: (report?.docIds || []).sort(), opened: env.opened }
}

// ------------------------------------------------------------ the checks

let pass = 0, fail = 0
const ok = (c, m) => { console.log(`  ${c ? 'ok  ' : 'FAIL'}  ${m}`); c ? pass++ : fail++ }
const A = '0176ab3a-fd86-4cd6-9d1a-5339e0a3bab4', S = 'doc-k3x9q2ab', D = 'd-4fz8w1qplmz9k2', B = 'doc-zzzzzzzz'
const autosave = (...owners) => ({
  recovery: { records: owners.map((o) => [o, { docId: o }]) },
  versions: { records: owners.map((o, i) => [i + 1, { docId: o }]), indexes: { docId: 'docId' } },
})

ok(script.includes('openKeyCursor') && !script.includes('getAll'), 'the shipped script reads keys with cursors, never record bodies')

let r = await inspect(origin())
ok(r.docIds.length === 0 && r.unattributed === false, 'an empty origin: nothing owned, nothing unattributable (adoptable)')

for (const [app, id] of [['slides', A], ['spaces', S], ['dash', D], ['type', A]]) {
  r = await inspect(origin({ dbs: { [`bento-${app}-autosave`]: autosave(id) } }))
  ok(JSON.stringify(r.docIds) === JSON.stringify([id]) && r.unattributed === false, `bento-${app}-autosave: its records are attributed to ${id.slice(0, 12)}`)
}

r = await inspect(origin({ dbs: { 'bento-autosave': autosave(A) } }))
ok(JSON.stringify(r.docIds) === JSON.stringify([A]), 'the legacy shared bento-autosave is attributed too')

r = await inspect(origin({ dbs: { 'bento-slides-autosave': { recovery: { records: [] }, versions: { records: [[1, { docId: B }]], indexes: { docId: 'docId' } } } } }))
ok(r.docIds.includes(B), 'a version record alone (no recovery copy) still names its owner, through the docId index')

r = await inspect(origin({ dbs: { 'bento-handles': { handles: { records: [[A, {}]] } } } }))
ok(JSON.stringify(r.docIds) === JSON.stringify([A]) && r.unattributed === false, 'bento-handles is attributed by its docId keys')

r = await inspect(origin({ local: { [`bento-member-${S}`]: '{}', 'bento-lang': 'en' } }))
ok(JSON.stringify(r.docIds) === JSON.stringify([S]), 'a member key names its document; a viewer preference is not data')

r = await inspect(origin({ dbs: { 'bento-blobcache': { blobs: { records: [['h1', new Uint8Array(1)]] } } } }))
ok(r.unattributed === true, 'bento-blobcache with records refuses (it caches live-session media in plaintext)')

r = await inspect(origin({ dbs: { 'bento-blobcache': { blobs: { records: [] } } } }))
ok(r.unattributed === false, 'an EMPTY bento-blobcache does not refuse')

r = await inspect(origin({ dbs: { 'someone-else': { kv: { records: [['k', 1]] } } } }))
ok(r.unattributed === true, 'an unknown database with records refuses')

r = await inspect(origin({ dbs: { 'bento-slides-autosave': { extra: { records: [['x', 1]] }, ...autosave(A) } } }))
ok(r.unattributed === true, 'an unexpected store with records inside an autosave database refuses')

r = await inspect(origin({ dbs: { 'bento-handles': { handles: { records: [[42, {}]] } } } }))
ok(r.unattributed === true, 'a non-string key cannot be attributed, so it refuses')

r = await inspect(origin({ noList: true, dbs: { 'bento-slides-autosave': autosave(A) } }))
ok(r.unattributed === true && r.opened.length === 0, 'no indexedDB.databases(): unattributable, and nothing is opened')

r = await inspect(origin({ dbs: { 'bento-slides-autosave': autosave(A, B) } }))
ok(r.docIds.includes(A) && r.docIds.includes(B), 'two documents in one origin are both reported (the host then refuses adoption)')

r = await inspect(origin({ dbs: { 'bento-slides-autosave': autosave(A) } }))
ok(JSON.stringify(r.opened) === JSON.stringify(['bento-slides-autosave']), 'only listed databases are opened, so looking creates none')

console.log(`\n${pass}/${pass + fail} checks passed`)
process.exit(fail ? 1 : 0)
