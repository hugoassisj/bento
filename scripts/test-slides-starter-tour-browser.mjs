// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The starter's tour, where the editor shows it — in the packaged shell, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-starter-tour-browser.mjs
//
// WHAT THIS PROVES:
//   1. every linear slide of the starter carries exactly one "try this", a
//      comment thread anchored to an element on that slide; states carry
//      none; no note names a chart engine the shell does not have;
//   2. on first open, with no click, the current slide shows its marker on
//      the canvas — on top, at its element's top-right corner — and so does
//      every other linear slide; each thumbnail carries the open-comment
//      badge; pre-written threads never ask for a name (no dialog);
//   3. none of them reaches the show (no marker in the overlay, none on top
//      anywhere, no tip text on screen, slide after slide), print (the
//      #bento-print pages hold no marker and no tip text, and under print
//      media the editor's markers take no space) or an exported image (the
//      PNG of slide 1 is byte-identical before and after its thread is
//      deleted through the thread's own Delete button);
//   4. the speaker-notes pane, whose notes are the rest of the tour, starts
//      OPEN on the untouched starter with no saved choice; a saved '0' keeps
//      it folded; any other document (the same deck, saved and reopened)
//      starts folded as before, and so does one that replaces the starter in
//      place (loadDoc, as Open, a drop or Replace from JSON do);
//   5. window.bento.validate() finds no error, and the tour adds no finding
//      (the deck validates identically with its threads stripped).
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const dir = mkdtempSync(join(tmpdir(), 'bento-tour-'))
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const errors = []
let dialogs = 0
// a fresh profile; nothing ever leaves the machine (Offline mode on, every
// http(s) request aborted, every WebSocket closed)
async function open(url, prefs = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await ctx.addInitScript((prefs) => {
    try {
      localStorage.setItem('bento-offline', 'on')
      for (const [k, v] of Object.entries(prefs)) localStorage.setItem(k, v)
    } catch {}
    window.__printed = 0
    window.print = () => { window.__printed++ }
  }, prefs)
  await ctx.route(/^https?:/, (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => { dialogs++; void d.dismiss() })
  await p.goto(url)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]') && document.querySelector('.ed-notespane'))
  await p.waitForTimeout(700)
  return [ctx, p]
}
const pane = (p) => p.evaluate(() => ({
  h: document.querySelector('.ed-notespane').getBoundingClientRect().height,
  expanded: document.querySelector('.ed-notes-btn').getAttribute('aria-expanded'),
}))
// the markers on top at their own centre, with what they say and where they sit
const markers = (p) => p.evaluate(() => [...document.querySelectorAll('.ed-comment-marker')].map((m) => {
  const r = m.getBoundingClientRect()
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, title: m.title,
    onTop: r.width > 0 && m.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) }
}))

try {
  const starter = pathToFileURL(SHELL).href
  const [ctx, p] = await open(starter)

  console.log('\nThe tour, in the document\n')
  const doc = await p.evaluate(() => window.bento.doc.slides.map((s) => ({
    state: !!s.stateOf, notes: s.notes, ids: s.elements.map((e) => e.id),
    comments: (s.comments ?? []).map((c) => ({ elementId: c.elementId, text: c.text, author: c.author })),
  })))
  const linear = doc.map((s, i) => [s, i]).filter(([s]) => !s.state)
  const tips = linear.flatMap(([s]) => s.comments.map((c) => c.text))
  ok(linear.length >= 10 && linear.every(([s]) => s.comments.length === 1), `every linear slide carries exactly one "try this" (${linear.map(([s]) => s.comments.length).join('')})`)
  ok(linear.every(([s]) => s.comments.every((c) => s.ids.includes(c.elementId))), 'each is anchored to an element on its own slide')
  ok(doc.filter((s) => s.state).every((s) => !s.comments.length), 'the hidden states carry none')
  ok(tips.every((t) => t.length <= 80), `each is one short sentence (longest ${Math.max(...tips.map((t) => t.length))} chars)`)
  ok(doc.every((s) => !/ECharts/i.test(s.notes)), 'no note names a chart engine the shell does not have')
  // The tour adds no finding: the deck validates the same with its threads
  // stripped. (Its own warnings — formula boxes on the symbol-morph slides —
  // are the starter's, not the tour's: SC-01's to clear.)
  const v = await p.evaluate(() => {
    const line = (f) => `${f.severity} ${f.code} ${f.slideId ?? ''} ${f.elementId ?? ''} ${f.message}`
    const bare = JSON.parse(JSON.stringify(window.bento.doc))
    for (const s of bare.slides) delete s.comments
    return { mine: window.bento.validate().findings.map(line), bare: window.bento.validate(bare).findings.map(line) }
  })
  ok(!v.mine.some((f) => f.startsWith('error')), `validate() finds no error (${v.mine.length} findings)`)
  ok(JSON.stringify(v.mine) === JSON.stringify(v.bare), `the tour adds no finding: the same ${v.mine.length} with the threads stripped (${v.mine.filter((f) => f.startsWith('warning')).length} warnings either way)`)

  console.log('\nIn the editor, without a click\n')
  const first = await markers(p)
  ok(first.length === 1 && first[0].onTop && first[0].w > 0, `the first slide shows its marker on the canvas, on top (${first.length} marker(s), on top ${first[0]?.onTop})`)
  ok(first[0]?.title === `bento: ${linear[0][0].comments[0]?.text}`, `it says what to try ("${first[0]?.title}")`)
  const pn = await pane(p)
  ok(pn.h > 84 && pn.expanded === 'true', `the untouched starter opens with its notes pane OPEN (${Math.round(pn.h)}px, expanded=${pn.expanded})`)
  ok(dialogs === 0, `no name prompt or other dialog (${dialogs})`)
  ok(await p.locator('.ed-thumb .ed-thumb-cmt').count() === linear.length, `each linear slide's thumbnail carries the comment badge (${await p.locator('.ed-thumb .ed-thumb-cmt').count()} of ${linear.length})`)
  const placed = []
  for (const [s, i] of linear) {
    if (!s.comments.length) { placed.push(false); continue }
    await p.locator(`.ed-thumb[data-index="${i}"]`).click(); await p.waitForTimeout(250)
    const m = await markers(p)
    const r = await p.evaluate((id) => document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`).getBoundingClientRect().toJSON(), s.comments[0].elementId)
    placed.push(m.length === 1 && m[0].onTop && Math.abs(m[0].cx - r.right) < 3 && Math.abs(m[0].cy - r.top) < 3 && m[0].title.endsWith(s.comments[0].text))
  }
  ok(placed.every(Boolean), `every linear slide shows its one marker, on top, at its element's top-right corner (${placed.map((x) => (x ? '✓' : '✗')).join('')})`)
  ok(dialogs === 0, 'still no dialog after visiting every slide')

  console.log('\nNot in the show\n')
  await p.locator(`.ed-thumb[data-index="${linear[0][1]}"]`).click(); await p.waitForTimeout(250)
  await p.locator('.ed-present-pill .ed-pill-main').click()
  await p.waitForFunction(() => document.querySelector('.bento-present-overlay')); await p.waitForTimeout(900)
  const shown = []
  for (let k = 0; k < linear.length; k++) {
    shown.push(await p.evaluate((tips) => {
      const ov = document.querySelector('.bento-present-overlay')
      const onTop = [...document.querySelectorAll('.ed-comment-marker')].filter((m) => {
        const r = m.getBoundingClientRect()
        return r.width > 0 && m.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
      }).length
      return { inOverlay: ov.querySelectorAll('.ed-comment-marker, .ed-comment-layer').length, onTop, text: tips.filter((t) => ov.innerText.includes(t)).length }
    }, tips))
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500)
  }
  ok(shown.every((s) => !s.inOverlay && !s.onTop && !s.text), `on every slide of the show: no marker in the overlay, none on top, no tip text (${shown.map((s) => s.inOverlay + s.onTop + s.text).join('')})`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(600)

  console.log('\nNot in print\n')
  await p.mouse.click(700, 160)
  await p.keyboard.press(`${MOD}+P`); await p.waitForTimeout(500)
  const printed = await p.evaluate((tips) => {
    const box = document.getElementById('bento-print')
    return { printed: window.__printed, pages: box?.querySelectorAll('.bp-page').length ?? 0,
      markers: box?.querySelectorAll('.ed-comment-marker, .ed-comment-layer').length ?? -1, text: tips.filter((t) => box?.textContent.includes(t)).length }
  }, tips)
  ok(printed.printed === 1 && printed.pages === linear.length, `${MOD}+P lays out one page per linear slide and prints (${printed.pages} pages, print() ${printed.printed}×)`)
  ok(printed.markers === 0 && printed.text === 0, `the pages hold no marker and no tip text (${printed.markers} markers, ${printed.text} tips)`)
  await p.emulateMedia({ media: 'print' })
  const paper = await p.evaluate(() => [...document.querySelectorAll('.ed-comment-marker')].filter((m) => m.getBoundingClientRect().width > 0).length)
  ok(paper === 0, `under print media the editor's markers take no space (${paper} drawn)`)
  await p.emulateMedia({ media: 'screen' })
  await p.evaluate(() => window.dispatchEvent(new Event('afterprint')))

  console.log('\nNot in an exported image\n')
  await p.locator(`.ed-thumb[data-index="${linear[0][1]}"]`).click(); await p.waitForTimeout(300)
  const exportPng = async () => {
    await p.locator('.ed-logo').click()
    await p.getByText('Export slides as images…', { exact: true }).click()
    const dl = p.waitForEvent('download')
    await p.getByRole('dialog').getByRole('button', { name: 'Export', exact: true }).click()
    return readFileSync(await (await dl).path())
  }
  const withTip = await exportPng()
  if (!(await p.locator('.ed-comment-marker').count())) throw new Error('slide 1 has no "try this" thread to delete')
  await p.locator('.ed-comment-marker').click()
  await p.locator('.ed-comment-pop').getByRole('button', { name: 'Delete', exact: true }).click(); await p.waitForTimeout(300)
  const left = await p.evaluate(() => (window.bento.doc.slides[0].comments ?? []).length)
  const without = await exportPng()
  const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12)
  ok(left === 0 && withTip.length > 10000 && withTip[1] === 0x50, `slide 1 exports as a PNG, and its thread deletes from the thread's own button (${withTip.length} bytes; ${left} threads left)`)
  ok(sha(withTip) === sha(without), `the PNG is byte-identical with and without the thread (${sha(withTip)} / ${sha(without)})`)
  await p.keyboard.press(`${MOD}+Z`); await p.waitForTimeout(200)

  // the same deck saved: now it is somebody's document, not our starter
  const saved = join(dir, 'tour-saved.bento.html')
  writeFileSync(saved, await p.evaluate(() => window.bento.serialize()))
  await ctx.close()

  console.log('\nThe notes pane, everywhere else\n')
  {
    const [c, q] = await open(starter, { 'bento-notes-open': '0' })
    const s = await pane(q)
    ok(s.h === 0 && s.expanded === 'false', `the starter with a saved '0' keeps the pane folded (${s.h}px, expanded=${s.expanded})`)
    await c.close()
  }
  {
    const [c, q] = await open(starter)
    await q.evaluate(() => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', notes: 'Mine', elements: [] }]
      window.bento.loadDoc(JSON.stringify(d))
    })
    await q.waitForTimeout(400)
    const s = await pane(q)
    ok(s.h === 0 && s.expanded === 'false', `a document loaded over the starter, with no saved choice, folds the pane (${s.h}px, expanded=${s.expanded})`)
    await c.close()
  }
  {
    const [c, q] = await open(pathToFileURL(saved).href)
    const s = await pane(q)
    const m = await markers(q)
    ok(s.h === 0 && s.expanded === 'false', `another document with no saved choice starts folded, as before (${s.h}px, expanded=${s.expanded})`)
    ok(m.length === 1 && m[0].onTop, 'and its comments travel with it, like any comment')
    await c.close()
  }
  ok(errors.length === 0, `no page error${errors.length ? ' — ' + errors[0].slice(0, 120) : ''}`)
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
