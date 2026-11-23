// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Share ▸ Present-only file… asks what of the author's own material goes in.
//
//   npm run build:single --prefix slides && node scripts/test-slides-presentonly-browser.mjs
//
// WHAT THIS PROVES, in the packaged editor, driven with real clicks and keys:
//   1. on the showcase deck with one slide hidden and one comment added, the
//      item opens a dialog listing speaker notes, comments and hidden slides,
//      every box OFF; it traps Tab, closes on Escape without saving, and hands
//      focus back to the Share button;
//   2. saving with the defaults writes a file whose #bento-doc holds no notes
//      text (every `notes` is ""), no `comments` key, no hidden slide nor a
//      state of one, and no element link to a slide that is not there — still
//      `readonly`, still without the live session;
//   3. ticking "Include speaker notes" keeps the notes, the choice is
//      remembered for the next save, and the saved file's speaker view (S in
//      the show) shows them;
//   4. a deck with no notes, no comments and no hidden slide saves straight
//      away, with no dialog.
// On the parent commit the item saved at once and the file carried all of it.
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const shellPath = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url)
const NOTE = 'Welcome! This whole deck' // the showcase's first speaker note
const COMMENT = 'PRIVATE-REVIEW-COMMENT'
const OPEN = '<script type="application/bento+json" id="bento-doc">'
const docOf = (html) => {
  const i = html.indexOf(OPEN) + OPEN.length
  return JSON.parse(html.slice(i, html.indexOf('</' + 'script>', i)))
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  await ctx.addInitScript(() => {
    window.__files = []
    window.showSaveFilePicker = async (o) => ({
      kind: 'file', name: o?.suggestedName ?? 'deck.bento.html',
      async queryPermission() { return 'granted' },
      async requestPermission() { return 'granted' },
      async isSameEntry() { return false },
      async createWritable() {
        const parts = []
        return { async write(b) { parts.push(typeof b === 'string' ? b : await new Blob([b]).text()) }, async close() { window.__files.push(parts.join('')) } }
      },
    })
  })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(shellPath.href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-title'))

  // the showcase, plus one hidden slide (with a state of its own and a link
  // into it from slide 1) and one comment
  const loaded = await p.evaluate((comment) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const hid = d.slides.find((s, i) => i > 1 && !s.stateOf && !d.slides.some((x) => x.stateOf === s.id))
    hid.hidden = true
    const st = { ...JSON.parse(JSON.stringify(hid)), id: 'rig-hidden-state', stateOf: hid.id }
    delete st.hidden
    d.slides.splice(d.slides.indexOf(hid) + 1, 0, st)
    const linker = d.slides[0].elements.find((e) => !e.link)
    linker.link = hid.id
    d.slides[0].comments = [{ id: 'rig-c1', author: 'Rig', text: comment, at: new Date().toISOString() }]
    return { ok: !!window.bento.loadDoc(JSON.stringify(d)), hidden: hid.id, linker: linker.id }
  }, COMMENT)
  ok(loaded.ok, `loaded the showcase with slide ${loaded.hidden} hidden, a state off it, a link into it and a comment`)
  const facts = await p.evaluate(() => {
    const d = window.bento.doc
    return { hidden: d.slides.filter((s) => s.hidden).length, comments: d.slides.reduce((n, s) => n + (s.comments?.length ?? 0), 0), notes: d.slides.filter((s) => s.notes?.trim()).length }
  })
  ok(facts.hidden === 1 && facts.comments === 1 && facts.notes > 10, `the deck holds ${facts.notes} slides with notes, ${facts.comments} comment, ${facts.hidden} hidden slide`)

  const files = () => p.evaluate(() => window.__files.length)
  const latest = () => p.evaluate(() => window.__files.at(-1) ?? '')
  /** Save from the dialog if one is up; on the parent there is none and the
   *  click on the item already saved. Waits for one more file either way. */
  const saveFromDialog = async (n) => {
    if (await p.locator('.bkd-actions .ed-primary').count()) await p.locator('.bkd-actions .ed-primary').click()
    await p.waitForFunction((k) => window.__files.length > k, n, { timeout: 8000 }).catch(() => {})
  }
  const openItem = async () => {
    // the dialog closes the popover; the parent left it open, and a second
    // click on Share would toggle it shut
    if (!(await p.evaluate(() => document.querySelector('.ed-btn-share')?.parentElement?.classList.contains('open')))) await p.locator('.ed-btn-share').click()
    await p.locator('.ed-share-pop .ed-share-btn', { hasText: 'Present-only file' }).click()
    await p.waitForTimeout(300)
  }
  const dialog = () => p.evaluate(() => {
    const card = document.querySelector('.bkd-card[role="dialog"]')
    if (!card) return null
    return {
      title: card.querySelector('.bkd-title')?.textContent ?? '',
      boxes: [...card.querySelectorAll('input[type="checkbox"]')].map((b) => ({ label: b.parentElement.textContent, on: b.checked })),
      text: card.textContent,
      focusInside: card.contains(document.activeElement),
    }
  })

  console.log('\nthe dialog\n')
  await openItem()
  const d1 = await dialog()
  ok(!!d1, 'Present-only file… opens a dialog before anything is saved')
  ok((await files()) === 0, 'and has written no file yet')
  if (d1) {
    ok(d1.boxes.length === 3 && d1.boxes.every((b) => !b.on), `three choices, every one off by default (${d1.boxes.map((b) => `${b.label}=${b.on}`).join(' | ')})`)
    ok(/speaker notes/i.test(d1.boxes[0]?.label) && /comments/i.test(d1.boxes[1]?.label) && /hidden slides/i.test(d1.boxes[2]?.label),
      'notes, comments, hidden slides — in that order, each with its count')
    ok(d1.text.includes('Anyone who receives this file can read whatever is included.'), 'and it says who can read what is included')
    ok(d1.focusInside, 'focus moved into the dialog')
    let escaped = false
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
      await p.keyboard.press('Tab')
      if (!(await p.evaluate(() => document.querySelector('.bkd-card')?.contains(document.activeElement)))) escaped = true
    }
    ok(!escaped, 'Tab and Shift+Tab never take focus out of it')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(200)
    const after = await p.evaluate(() => ({ open: !!document.querySelector('.bkd-card'), share: document.activeElement?.classList.contains('ed-btn-share') ?? false, active: document.activeElement?.className ?? '' }))
    ok(!after.open && (await files()) === 0, 'Escape closes it and saves nothing')
    ok(after.share, `focus is back on the Share button (${after.active})`)
  }

  console.log('\nsaved with the defaults\n')
  let n0 = await files()
  await openItem()
  await saveFromDialog(n0)
  const html1 = (await files()) > n0 ? await latest() : ''
  ok(html1.length > 0, 'Save wrote the file')
  if (html1) {
    const doc = docOf(html1)
    const ids = new Set(doc.slides.map((s) => s.id))
    const block = html1.slice(html1.indexOf(OPEN), html1.indexOf('</' + 'script>', html1.indexOf(OPEN)))
    ok(!block.includes(NOTE), 'the #bento-doc block holds no speaker-note text')
    ok(doc.slides.every((s) => s.notes === ''), 'every notes value is ""')
    ok(doc.slides.every((s) => !('comments' in s)) && !block.includes(COMMENT), 'no slide carries a comments key, and the comment text is gone')
    ok(!doc.slides.some((s) => s.hidden) && !ids.has(loaded.hidden) && !ids.has('rig-hidden-state'), 'the hidden slide and its state are gone')
    const dead = doc.slides.flatMap((s) => s.elements.map((e) => e.link)).filter((l) => l && !/^https?:/.test(l) && !ids.has(l))
    ok(dead.length === 0, `no element link points at a slide that is not there${dead.length ? ` (${dead.join(', ')})` : ''}`)
    ok(doc.readonly === true && !doc.collab, 'still a player file (readonly) without the live session')
  }
  const toast1 = await p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')
  ok(/without speaker notes/.test(toast1) && /comments/.test(toast1) && /hidden slides/.test(toast1), `the toast says what was left out ("${toast1}")`)

  console.log('\nnotes included\n')
  n0 = await files()
  await openItem()
  if (await p.locator('.bkd-card input[type="checkbox"]').count()) await p.locator('.bkd-card input[type="checkbox"]').first().click()
  await saveFromDialog(n0)
  const html2 = (await files()) > n0 ? await latest() : ''
  const doc2 = html2 ? docOf(html2) : null
  ok(!!doc2 && doc2.slides[0].notes.startsWith(NOTE), 'ticking "Include speaker notes" keeps the notes in the file')
  ok(!!doc2 && doc2.slides.every((s) => !('comments' in s)) && !doc2.slides.some((s) => s.hidden), 'and still leaves out what was not ticked')
  const toast2 = await p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')
  ok(/with speaker notes/.test(toast2) && /without/.test(toast2), `the toast says what it kept and what it left out ("${toast2}")`)
  await openItem()
  const d3 = await dialog()
  ok(!!d3 && d3.boxes[0].on && !d3.boxes[1].on && !d3.boxes[2].on, 'the choice is remembered in this browser for the next save')
  if (d3) await p.keyboard.press('Escape')
  await p.waitForTimeout(500)

  if (html2) {
    const dir = mkdtempSync(join(tmpdir(), 'bento-presentonly-'))
    const file = join(dir, 'deck-presentonly.bento.html')
    writeFileSync(file, html2)
    const q = await ctx.newPage()
    await q.goto('file://' + file)
    await q.waitForFunction(() => window.bento?.readonly && document.querySelector('.reveal'), null, { timeout: 15000 }).catch(() => {})
    await q.waitForTimeout(800)
    const [pop] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null),
      q.keyboard.press('s'),
    ])
    let svNotes = ''
    if (pop) {
      await pop.waitForFunction(() => document.querySelector('.sv-notes')?.textContent, null, { timeout: 8000 }).catch(() => {})
      svNotes = await pop.evaluate(() => document.querySelector('.sv-notes')?.textContent ?? '')
    }
    ok(svNotes.includes(NOTE), `the saved file opens into the show and its speaker view shows the notes ("${svNotes.slice(0, 40)}…")`)
    await q.close()
  }

  console.log('\na deck with nothing private\n')
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = d.slides.filter((s) => !s.hidden && !s.stateOf).slice(0, 3).map((s) => ({ ...s, notes: '', comments: undefined }))
    for (const s of d.slides) { delete s.comments; for (const e of s.elements) delete e.link }
    window.bento.loadDoc(JSON.stringify(d))
  })
  const before = await files()
  await openItem()
  await p.waitForFunction((n) => window.__files.length > n, before, { timeout: 8000 }).catch(() => {})
  ok(!(await dialog()) && (await files()) === before + 1, 'it saves straight away, with no dialog')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`)
  await ctx.close()
} finally { await browser.close() }

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
