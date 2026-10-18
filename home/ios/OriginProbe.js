// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Run at a POSSIBLY-LEGACY document origin, before the document loads, to say
// whose data that origin holds. The host adopts the origin only if every record
// belongs to the file being opened (home/ios/OriginIdentity.swift).
//
// Reports { ids: [docId…], unattributable: bool }. Anything it can't attribute
// to a docId makes `unattributable` true, and the host then refuses the origin:
// "couldn't look" must never read as "empty", or a predecessor's plaintext is
// handed to whoever takes its path.
//
// It enumerates with indexedDB.databases() and opens each database at the
// version it already has, so nothing is ever created or upgraded. An empty
// database planted at version 1 would make the editor's own upgrade skip
// creating its stores. The upgrade is aborted besides, as a belt.
//
// Shared by the host and scripts/test-home-origin-probe.mjs, which runs this
// file itself against real IndexedDB, so the two can't drift.
(async () => {
  const ids = new Set()
  let unattributable = false
  const why = [] // reported for diagnosis; the host reads only ids and unattributable
  const give = (reason) => { unattributable = true; why.push(String(reason)) }
  const report = () => window.webkit.messageHandlers.bentoOriginProbe.postMessage({ ids: [...ids], unattributable, why })

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      // member keys are named by docId; the rest are viewer preferences
      if (k && k.startsWith('bento-member-')) ids.add(k.slice('bento-member-'.length))
    }
  } catch (e) { give('localStorage: ' + e) }

  const open = (name, version) => new Promise((res, rej) => {
    const q = indexedDB.open(name, version)
    q.onupgradeneeded = () => { q.transaction.abort() }
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  const keys = (store, viaIndex) => new Promise((res, rej) => {
    const out = []
    const c = viaIndex ? store.index(viaIndex).openKeyCursor(null, 'nextunique') : store.openKeyCursor()
    c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); out.push(cur.key); cur.continue() }
    c.onerror = () => rej(c.error)
  })
  const count = (store) => new Promise((res, rej) => { const r = store.count(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

  try {
    if (typeof indexedDB.databases !== 'function') { give('no indexedDB.databases()'); return report() }
    for (const info of await indexedDB.databases()) {
      if (!info.name) { give('a database with no name'); continue }
      let db
      try { db = await open(info.name, info.version) } catch (e) { give(info.name + ': open: ' + e); continue }
      try {
        const autosave = info.name === 'bento-autosave' || /-autosave$/.test(info.name)
        for (const sname of db.objectStoreNames) {
          // An empty store holds nobody's data. Skip it before opening a cursor:
          // WebKit can refuse a cursor on one just after its last user closed.
          if (await count(db.transaction(sname).objectStore(sname)) === 0) continue
          const store = db.transaction(sname).objectStore(sname)
          if (autosave && sname === 'recovery') {
            for (const k of await keys(store)) ids.add(String(k))
          } else if (autosave && sname === 'versions' && store.indexNames.contains('docId')) {
            for (const k of await keys(store, 'docId')) ids.add(String(k))
          } else if (info.name === 'bento-handles') {
            for (const k of await keys(store)) {
              const s = String(k), cut = s.indexOf('\u001f')
              if (cut > 0) ids.add(s.slice(0, cut)); else give(info.name + ': a key with no docId')
            }
          } else {
            give(info.name + '/' + sname + ': records with no docId') // a blob cache, or anything we don't know
          }
        }
      } catch (e) { give(info.name + ': ' + e) } finally { db.close() }
    }
  } catch (e) { give('databases(): ' + e) }
  report()
})()
