// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A document block that does not load is said so, never swapped for the starter deck.
//
//   npm run build:single --prefix slides && node scripts/test-slides-unreadable-doc-browser.mjs
//
// WHAT THIS PROVES, in the packaged document opened from disk. Up to 1.3.0 a
// #bento-doc block that failed to parse (a truncated write, a trailing comma)
// or that parsed but was not a full bento/slides document (the compact form an
// agent writes) booted the Showcase starter in its place, with no word. The
// user saw the demo and believed their work gone; and where the file came with
// a writable handle (an installed app, a native host's launchQueue) the first
// auto-save wrote the starter over it. Checked here, per case:
//   1. a truncated block, a trailing comma, a pretty-printed block with a
//      leading newline, a compact document: the recovery card, not the
//      editor; window.bento is a published stub with `unreadable: true` and
//      the loader counted it as mounted (no failure card, one card); the card
//      names the reason, with line and column for a syntax error, counted in
//      the text Copy and Download hand out, and marks the character there;
//   2. while the card is up nothing writes: ⌘S, a save picker, IndexedDB, the
//      launch handle (a fake host handle on the file, as home/bridge.js vends);
//   3. Copy puts the exact block text on the clipboard, Download saves exactly
//      that text, and the file on disk is unchanged;
//   4. the compact case offers Open it, which loads the one-slide deck;
//      "Open the starter deck instead" boots the starter and an edit to it
//      never reaches the unreadable file through the launch handle;
//   5. an empty block still boots the starter with no card, and a valid
//      document boots as before.
// Mutation: boot `parsed || starterDoc()` again in main.ts and 1–4 go red.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const shell = readFileSync(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url), 'utf8')
const EMPTY = 'id="bento-doc"></script>'
if (!shell.includes(EMPTY)) { console.log('FAIL  the built shell has no empty #bento-doc block'); process.exit(1) }
const dir = mkdtempSync(join(tmpdir(), 'bento-unreadable-'))

const TRUNCATED = '{"format":"bento/slides","version":1,"title":"My real deck","slides":[{"id":"s1","elements":[{"id":"a","type":"text","x":10'
const TRAILING = '{"format":"bento/slides","version":1,"title":"My real deck","slides":[{"id":"s1","elements":[]},]}'
const COMPACT = '{"compact":true,"title":"My real deck","slides":[{"layout":"title","title":"Hello"}]}'
// pretty-printed, as an agent or an editor writes it, with the leading
// newline and indent the block keeps: positions are counted in the text the
// card hands out (Copy, Download), not in a trimmed copy of it
const PRETTY = '\n  {\n  "format": "bento/slides",\n  "version": 1,\n  "slides": [ {"id":"s1","elements":[]}, ]\n}\n'
const PRETTY_AT = PRETTY.indexOf(', ]') + 2
const PRETTY_LINE = PRETTY.slice(0, PRETTY_AT).split('\n').length
const PRETTY_COLUMN = PRETTY_AT - PRETTY.lastIndexOf('\n', PRETTY_AT - 1)
const VALID = '{"format":"bento/slides","version":1,"title":"My real deck","size":{"w":1280,"h":720},"slides":[{"id":"s1","elements":[]}]}'

function fileWith(name, json) {
  const path = join(dir, `${name}.bento.html`)
  writeFileSync(path, shell.replace(EMPTY, `id="bento-doc">${json.replace(/</g, '\\u003c')}</script>`))
  return path
}

// Every way a document leaves the page, counted: a save picker, an IndexedDB
// write, a download, the clipboard, and writes through a launch handle on THIS
// file (the kernel adopts it when the file still holds the booted block).
const INSTRUMENT = ({ file, name }) => {
  const rig = (window.__rig = { picker: 0, idb: [], handleWrites: 0, clip: null })
  window.showSaveFilePicker = async () => { rig.picker++; throw new DOMException('rig', 'AbortError') }
  for (const m of ['put', 'add']) {
    const orig = IDBObjectStore.prototype[m]
    IDBObjectStore.prototype[m] = function (...a) { rig.idb.push(this.name); return orig.apply(this, a) }
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { rig.clip = t } } })
  const handle = {
    kind: 'file',
    name,
    async getFile() { return { text: async () => file, lastModified: 1, size: file.length } },
    async createWritable() { rig.handleWrites++; return { write: async () => {}, close: async () => {} } },
  }
  // Chromium has a native launchQueue: replaced, not assigned (an assignment is ignored)
  Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer(fn) { setTimeout(() => fn({ files: [handle] }), 0) } } })
  try { localStorage.setItem('bento-slideshow-started', '1') } catch {}
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
async function open(path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true })
  await ctx.route(/^https?:\/\//, (r) => r.abort())
  await ctx.addInitScript(INSTRUMENT, { file: readFileSync(path, 'utf8'), name: path.split('/').pop() })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto('file://' + path)
  await p.waitForFunction(() => window.bento?.loader || /every loader path/.test(document.body?.innerText || ''), null, { timeout: 10000 }).catch(() => {})
  await p.waitForTimeout(500)
  return { ctx, p, errors }
}
const state = (p) => p.evaluate(() => ({
  cards: document.querySelectorAll('.ed-unreadable').length,
  text: document.querySelector('.ed-unreadable')?.innerText || '',
  editor: !!document.querySelector('.ed-topbar .ed-logo'),
  failCard: /every loader path/.test(document.body.innerText),
  splash: !!document.getElementById('bento-splash'),
  unreadable: window.bento?.unreadable === true,
  hasDoc: !!window.bento?.doc,
  reason: window.bento?.reason ?? null,
  loader: window.bento?.loader?.path ?? null,
  mark: document.querySelector('.ed-unreadable mark')?.textContent ?? null,
  title: window.bento?.doc?.title ?? null,
  slides: window.bento?.doc?.slides?.length ?? 0,
  rig: { picker: window.__rig.picker, idb: window.__rig.idb.slice(), handleWrites: window.__rig.handleWrites },
}))
const booted = (p) => p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar .ed-logo'), null, { timeout: 10000 }).then(() => true, () => false)
// an edit the editor auto-saves (2.5 s later): replace the deck with itself
const edit = (p) => p.evaluate(() => { const d = window.bento.read(); d.title += ' (edited)'; return !!window.bento.loadDoc(JSON.stringify(d)) })

try {
  for (const [label, json, expect] of [
    ['a truncated block', TRUNCATED, { reason: /not valid JSON \(line 1, column 124\)/, error: 'syntax', line: 1, column: 124 }],
    ['a trailing comma', TRAILING, { reason: /not valid JSON \(line 1, column 97\)/, error: 'syntax', line: 1, column: 97 }],
    ['a pretty-printed block with a leading newline', PRETTY,
      { reason: new RegExp(`not valid JSON \\(line ${PRETTY_LINE}, column ${PRETTY_COLUMN}\\)`), error: 'syntax', line: PRETTY_LINE, column: PRETTY_COLUMN, mark: ']' }],
    ['a compact document', COMPACT, { reason: /compact document/, error: 'format', compact: true }],
  ]) {
    console.log(`\n${label}\n`)
    const path = fileWith(label.replace(/\W+/g, '-'), json)
    const before = readFileSync(path, 'utf8')
    const { ctx, p, errors } = await open(path)
    let s = await state(p)
    ok(s.cards === 1 && !s.editor, `the recovery card, not the editor (${s.cards} card(s); ${s.editor ? `editor mounted on "${s.title}", ${s.slides} slides` : 'no editor'})`)
    ok(s.unreadable && !s.hasDoc && s.reason?.error === expect.error, `window.bento is the unreadable stub (unreadable: ${s.unreadable}, reason: ${JSON.stringify(s.reason)})`)
    ok(s.loader && !s.failCard && !s.splash, `the loader counted it mounted (path ${s.loader}; failure card: ${s.failCard}; splash left: ${s.splash})`)
    ok(expect.reason.test(s.text), `the card names the reason (${JSON.stringify(s.text.split('\n').filter(Boolean).slice(1, 3).join(' / ').slice(0, 160))})`)
    ok(/has not been changed/.test(s.text), 'the card says the file has not been changed')
    if (expect.mark) ok(s.mark === expect.mark && PRETTY[PRETTY_AT] === expect.mark, `the excerpt marks the character at the error (${JSON.stringify(s.mark)}, expected ${JSON.stringify(expect.mark)} at line ${PRETTY_LINE}, column ${PRETTY_COLUMN} of the downloaded text)`)
    if (expect.line) ok(s.reason?.line === expect.line && s.reason?.column === expect.column, `the stub carries the position (line ${s.reason?.line}, column ${s.reason?.column})`)

    // nothing writes while the card is up, ⌘S included
    await p.keyboard.press('Control+s')
    await p.waitForTimeout(3000)
    s = await state(p)
    ok(s.rig.picker === 0 && s.rig.idb.length === 0 && s.rig.handleWrites === 0,
      `nothing written while the card is shown (picker ${s.rig.picker}, IndexedDB ${JSON.stringify(s.rig.idb)}, launch handle ${s.rig.handleWrites})`)

    if (s.cards === 1) {
      await p.getByRole('button', { name: 'Copy the document text' }).click()
      await p.waitForTimeout(200)
      const clip = await p.evaluate(() => window.__rig.clip)
      ok(clip === json, `Copy puts the exact block text on the clipboard (${clip === null ? 'nothing' : clip.length + ' chars'})`)
      const dl = p.waitForEvent('download', { timeout: 5000 })
      await p.getByRole('button', { name: 'Download the document text' }).click()
      const d = await dl
      const saved = join(dir, 'download.json')
      await d.saveAs(saved)
      ok(readFileSync(saved, 'utf8') === json && /\.json$/.test(d.suggestedFilename()), `Download saves exactly the block text (${d.suggestedFilename()})`)
    } else {
      ok(false, 'Copy the document text (no card)')
      ok(false, 'Download the document text (no card)')
    }
    ok(readFileSync(path, 'utf8') === before, 'the file on disk is unchanged')

    if (expect.compact) {
      const btn = p.getByRole('button', { name: 'Open it', exact: true })
      const offered = (await btn.count()) === 1
      ok(offered, 'the compact document is offered: Open it')
      if (offered) await btn.click()
      const up = await booted(p)
      s = await state(p)
      ok(up && s.title === 'My real deck' && s.slides === 1 && s.cards === 0, `Open it loads the deck ("${s.title}", ${s.slides} slide(s), ${s.cards} card(s))`)
    } else {
      const btn = p.getByRole('button', { name: 'Open the starter deck instead' })
      const offered = (await btn.count()) === 1
      ok(offered, 'Open the starter deck instead is offered')
      if (offered) await btn.click()
      const up = await booted(p)
      s = await state(p)
      ok(up && s.title === 'Bento Slides Showcase' && s.cards === 0, `the starter boots on request ("${s.title}", ${s.cards} card(s))`)
      // the starter must never reach the unreadable file: edit it, let the
      // auto-save run, and count writes through the launch handle
      const edited = up && await edit(p)
      await p.waitForTimeout(3500)
      s = await state(p)
      ok(edited && s.rig.handleWrites === 0, `an edit to the starter is never written over the unreadable file (${s.rig.handleWrites} write(s) through its handle)`)
    }
    ok(errors.length === 0, `no page error${errors.length ? ' — ' + errors[0].slice(0, 120) : ''}`)
    await ctx.close()
  }

  for (const [label, json, title, slides] of [
    ['an empty block', '', 'Bento Slides Showcase', null],
    ['a valid document', VALID, 'My real deck', 1],
  ]) {
    console.log(`\n${label}\n`)
    const { ctx, p, errors } = await open(json ? fileWith('valid', json) : fileWith('empty', ''))
    const up = await booted(p)
    const s = await state(p)
    ok(up && s.cards === 0 && !s.unreadable && s.title === title && (slides === null || s.slides === slides),
      `boots as before ("${s.title}", ${s.slides} slides, ${s.cards} card(s))`)
    ok(errors.length === 0, `no page error${errors.length ? ' — ' + errors[0].slice(0, 120) : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
