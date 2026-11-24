// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Frames for agents, in the packaged shell: texts are fitted at the width the
// layout gives them, and a hugging row that stretches hugging cards makes them
// all as tall as the tallest card's content.
//
// An agent writes a row frame of three column-frame cards, each holding two
// texts with `sizing.w: "fill"`, a placeholder `w: 100` and `h: "auto"`, and
// lets the frames place everything. window.bento.loadDoc used to measure each
// text at the placeholder width, before the layout gave it its real one, and
// never again (a 30px title came out hundreds of px tall); and a card its row
// stretched skipped its own hug, so every card kept the 100px in the file.
// compactload.ts now fits, derives, re-fits what layout resized and derives
// again; layout.ts measures a stretched card by what its hug would give.
//
// Checked, for each deck:
//   * every text's h is within 2px of window.bento.measure() at its laid-out w;
//   * the editor's derive pass on `replace` has nothing left to do: the loader
//     (bundled from the same sources) is run in the page, derive() on its
//     result returns false, and the geometry the store holds after the real
//     loadDoc equals the loader's;
//   * with align "stretch" every card is as tall as the tallest card's content
//     (padding + texts + gap), not the 100px written in the file; without it,
//     each card keeps its own content height;
//   * validate() reports no text-overflow and no out-of-canvas (the decks that
//     keep the row's width: wrap, as the docs say a hugging wrapping frame does).
//
// The network is closed: http(s) aborted, WebSockets closed, bento-offline on.
//
// Run: (cd slides && npm run build:single) && node scripts/test-slides-load-fit-browser.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const ROOT = fileURLToPath(new URL('..', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

// the loader and the derive pass, bundled for the page from the same sources as the shell
const dir = mkdtempSync(join(tmpdir(), 'bento-load-fit-'))
const entry = join(dir, 'entry.ts'), out = join(dir, 'bundle.js')
writeFileSync(entry,
  `import { parseDocInputReport } from ${JSON.stringify(join(ROOT, 'slides/src/compactload.ts'))}\n` +
  `import { derive, deriveMemory } from ${JSON.stringify(join(ROOT, 'slides/src/derive.ts'))}\n` +
  `;(globalThis as any).__loadFit = { parseDocInputReport, derive, deriveMemory }\n`)
execFileSync(join(ROOT, 'slides/node_modules/.bin/esbuild'), [entry, '--bundle', '--format=iife', '--log-level=error', `--outfile=${out}`])
const bundle = readFileSync(out, 'utf8')
rmSync(dir, { recursive: true, force: true })

const TEXTS = [
  ['Build it ourselves', 'Full control over the roadmap and the data model, at the cost of two quarters of engineering before the first customer sees anything.'],
  ['Buy', 'Fastest to ship.'],
  ['Partner', 'Shared risk and a shared roadmap with a vendor who already serves our market, with an option to bring it in house later.'],
]
const GAP = 12, PAD = 16
/** The issue's deck; `wrap` adds what keeps a hugging row's width (wrap, w 1152). */
function deck({ stretch, wrap }) {
  const els = [{ id: 'row', type: 'shape', shape: 'rect', x: 64, y: 160, w: wrap ? 1152 : 100, h: 100, fill: '#1B2735',
    layout: { dir: 'row', gap: 24, pad: [24, 24, 24, 24], hug: true, ...(wrap ? { wrap: true } : {}), ...(stretch ? { align: 'stretch' } : {}) } }]
  TEXTS.forEach(([t, b], i) => {
    els.push({ id: `card${i}`, type: 'shape', shape: 'rect', x: i, y: 0, w: 100, h: 100, fill: '#24364A', parentId: 'row',
      sizing: { w: 'fill' }, layout: { dir: 'col', gap: GAP, pad: [PAD, PAD, PAD, PAD], hug: true } })
    els.push({ id: `title${i}`, type: 'text', x: 0, y: 0, w: 100, h: 'auto', html: t, fontSize: 30, fontWeight: 700, parentId: `card${i}`, sizing: { w: 'fill' } })
    els.push({ id: `body${i}`, type: 'text', x: 0, y: 1, w: 100, h: 'auto', html: b, fontSize: 20, parentId: `card${i}`, sizing: { w: 'fill' } })
  })
  return { compact: true, title: 'Equal cards', slides: [{ id: 's1', elements: els }] }
}
const fixture = readFileSync(join(ROOT, 'scripts/fixtures/agent-decks/equal-cards.json'), 'utf8')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ bypassCSP: true })
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('file://' + join(ROOT, 'slides/dist-single/Bento_Slides.bento.html'))
  await page.waitForFunction(() => window.bento?.loadDoc && document.querySelector('.ed-topbar'), null, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await page.addScriptTag({ content: bundle })
  ok(await page.evaluate(() => !!window.__loadFit?.parseDocInputReport), 'the loader bundle is in the page')

  const run = (json) => page.evaluate(async (json) => {
    const T = window.__loadFit
    // what the editor gets on `replace`, and what its own derive pass then does with it
    const pre = T.parseDocInputReport(json, { live: window.bento.doc })
    const again = T.derive(pre.doc, T.deriveMemory(pre.doc))
    const geo = (els) => JSON.stringify(els.map((e) => [e.id, e.x, e.y, e.w, e.h]))
    const report = window.bento.loadDoc(json)
    const els = window.bento.doc.slides[0].elements
    const v = await window.bento.validate()
    return {
      again, same: geo(pre.doc.slides[0].elements) === geo(els), fitted: report.fitted,
      codes: v.findings.map((f) => f.code),
      els: Object.fromEntries(els.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h, parentId: e.parentId, m: e.type === 'text' ? window.bento.measure(e.id).height : undefined }])),
    }
  }, json)

  const check = (label, r, { stretch, clean, cards = ['card0', 'card1', 'card2'] }) => {
    console.log(`\n${label}\n`)
    ok(r.again === false, `the editor's derive on replace has nothing left to do (derive returned ${r.again})`)
    ok(r.same, 'the store holds exactly the geometry the loader produced')
    ok(r.fitted > 0, `${r.fitted} text(s) fitted`)
    const texts = Object.entries(r.els).filter(([, e]) => e.m !== undefined)
    const off = texts.filter(([, e]) => Math.abs(e.h - e.m) > 2)
    ok(!off.length, `every text's h is within 2px of measure() at its laid-out width${off.length ? ': ' + off.map(([id, e]) => `${id} h ${e.h} vs ${e.m} at w ${e.w}`).join('; ') : ''}`)
    const content = cards.map((c) => {
      const kids = texts.filter(([, e]) => e.parentId === c).map(([, e]) => e.h)
      return PAD * 2 + kids.reduce((a, h) => a + h, 0) + GAP * (kids.length - 1)
    })
    const hs = cards.map((c) => r.els[c].h)
    if (stretch) ok(hs.every((h) => Math.abs(h - Math.max(...content)) < 0.01), `every card is as tall as the tallest card's content: ${hs.join(', ')} (tallest content ${Math.max(...content)})`)
    else ok(hs.every((h, i) => Math.abs(h - content[i]) < 0.01), `each card keeps its own content height: ${hs.join(', ')} (content ${content.join(', ')})`)
    ok(!hs.includes(100), 'no card keeps the 100px placeholder from the file')
    if (clean) {
      ok(!r.codes.includes('text-overflow'), `validate(): no text-overflow (${r.codes.join(', ') || 'none'})`)
      ok(!r.codes.includes('out-of-canvas'), 'validate(): no out-of-canvas')
    }
    return r
  }

  // the issue's deck as written: a hugging row's fill cards get no width from
  // it (the editor disables Fill under Hug contents), so they stay narrow — but
  // the texts are still fitted at the width they end up with, and stretched
  // cards still match
  check('the issue deck: hugging row, stretch, fill cards', await run(JSON.stringify(deck({ stretch: true, wrap: false }))), { stretch: true, clean: false })
  const w = check('hugging wrapping row, stretch, fill cards', await run(JSON.stringify(deck({ stretch: true, wrap: true }))), { stretch: true, clean: true })
  ok(Math.abs(w.els.title0.w - (1152 - 48 - 48) / 3 + 2 * PAD) < 0.01 && w.els.row.w === 1152, `the texts were widened from the 100px placeholder to ${w.els.title0.w}px by the layout`)
  check('the same row without stretch', await run(JSON.stringify(deck({ stretch: false, wrap: true }))), { stretch: false, clean: true })
  check('scripts/fixtures/agent-decks/equal-cards.json', await run(fixture), { stretch: true, clean: true, cards: ['card-1', 'card-2', 'card-3'] })

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
