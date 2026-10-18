// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// THE sealed TEST document, one helper for every app (security §31): slides,
// spaces, dash, type and security's run-it check all exercise the same thing.
//
// It boots an app's TEST shell (npm run build:sealtest → dist-sealtest/, the
// only build that carries the key handoff) with the identity seal set BEFORE the
// app's own boot runs: the key is installed with addInitScript, and the kernel
// consumes it in capturePristine(), before any editor or autosave exists. Then it
// PROVES the seal took effect before a rig checks a single guard, because a
// guard check against a document that was never sealed passes vacuously.
//
//   import { openSealed, scanIndexedDB } from './lib/sealed-boot.mjs'
//   const { page } = await openSealed(browser, 'slides')
//   ...edit the document, wait out the autosave debounce...
//   assert.deepEqual(await scanIndexedDB(page, MARKER), [])
//
// Every rig that uses it should also run its edit on an UNSEALED page
// (openSealed(browser, app, { sealed: false })) and see the marker land in
// IndexedDB: the positive control that the scan can see a leak at all.

const SHELLS = {
  slides: 'slides/dist-sealtest/Bento_Slides.bento.html',
  spaces: 'spaces/dist-sealtest/Bento_Spaces.bento.html',
  dash: 'dash/dist-sealtest/Bento_Dash.bento.html',
  type: 'type/dist-sealtest/Bento_Type.bento.html',
}

/** A fixed TEST document key. Never a real one: the bodies it seals are throwaway. */
export const TEST_KDOC = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)

/** The test shell for an app, by explicit path. Never a release (dist-single) shell. */
export function sealtestShell(app) {
  const rel = SHELLS[app]
  if (!rel) throw new Error(`sealed-boot: no such app ${app}`)
  return new URL(`../../${rel}`, import.meta.url)
}

/**
 * Open `app`'s test shell, sealed (the default) or not. Resolves once the app has
 * booted and, when sealed, once the seal is proven: the probe says sealed, and a
 * save of the live document would write an identity-sealed envelope.
 */
export async function openSealed(browser, app, { sealed = true, kdoc = TEST_KDOC, viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport })
  await context.route(/^https?:/, (route) => route.abort())
  if (sealed) await context.addInitScript((k) => { globalThis.__bentoTestSeal = new Uint8Array(k) }, kdoc)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(sealtestShell(app).href)
  await page.waitForFunction(() => window.bento?.doc, null, { timeout: 30000 })

  const state = await page.evaluate(async () => {
    const p = globalThis.__bentoTestSealProbe
    if (!p) return { probe: false, handoffLeft: '__bentoTestSeal' in globalThis }
    let env = null
    try { env = JSON.parse(await p.body(window.bento.doc)) } catch { /* not JSON: not an envelope */ }
    return { probe: true, sealed: p.sealed(), kdf: env?.kdf ?? null, v: env?.v ?? null, handoffLeft: '__bentoTestSeal' in globalThis }
  })
  if (state.handoffLeft) throw new Error(`sealed-boot: ${app} never consumed the key handoff (is this a build:sealtest shell?)`)
  if (sealed) {
    if (!state.probe) throw new Error(`sealed-boot: ${app} has no seal probe: not a build:sealtest shell, or the seal was never consumed`)
    if (!state.sealed) throw new Error(`sealed-boot: ${app} booted but isBodySealed() is false`)
    if (state.kdf !== 'hkdf-kdoc' || state.v !== 1) throw new Error(`sealed-boot: ${app}'s save would not write an identity-sealed v1 envelope (kdf=${state.kdf}, v=${state.v})`)
  } else if (state.probe) {
    throw new Error(`sealed-boot: ${app} is sealed although no key was handed over`)
  }
  return { context, page, errors }
}

/** What a save would write: the whole file, its suggested name, and the #bento-doc body. Sealed pages only. */
export async function savedFile(page) {
  return page.evaluate(async () => {
    const p = globalThis.__bentoTestSealProbe
    return { file: await p.file(window.bento.doc), fileName: p.fileName(window.bento.doc), body: await p.body(window.bento.doc) }
  })
}

/**
 * Every IndexedDB record in the page's origin whose JSON contains `marker`, as
 * `db/store` strings. [] means no plaintext copy of the marker is on disk.
 */
export async function scanIndexedDB(page, marker) {
  return page.evaluate(async (m) => {
    const hits = []
    const dbs = (await indexedDB.databases()).map((d) => d.name).filter(Boolean)
    for (const name of dbs) {
      const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
      for (const store of db.objectStoreNames) {
        const all = await new Promise((res, rej) => {
          const r = db.transaction(store, 'readonly').objectStore(store).getAll()
          r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
        })
        for (const rec of all) {
          let text
          try { text = JSON.stringify(rec) } catch { text = String(rec) }
          if (text.includes(m)) { hits.push(`${name}/${store}`); break }
        }
      }
      db.close()
    }
    return hits
  }, marker)
}
