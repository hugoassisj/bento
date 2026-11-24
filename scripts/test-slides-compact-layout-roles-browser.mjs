// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Layout and role never drop content (AI-09), in the packaged shell.
//
// Compact input through window.bento.loadDoc: on the two-column layout an
// unknown role written before the named columns keeps all four texts, LEFT in
// the left column and RIGHT in the right one (measured on the canvas), and
// `right` before `left` no longer swaps them.
//
// The network is closed: http(s) aborted, WebSockets answered by a closed mock.
//
// Run: (cd slides && npm run build:single) && node scripts/test-slides-compact-layout-roles-browser.mjs
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const shellPath = fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'bento-layout-roles-')))
const fixture = join(scratch, 'fixture.bento.html')
writeFileSync(fixture, readFileSync(shellPath, 'utf8'))

const deck = {
  compact: true,
  slides: [
    { id: 'cols', layout: 'two-col', elements: [
      { role: 'title', html: 'TITLE' }, { role: 'kicker', html: 'KICKER' }, { role: 'left', html: 'LEFT' }, { role: 'right', html: 'RIGHT' }] },
    { id: 'swap', layout: 'two-col', elements: [{ role: 'right', html: 'RIGHT2' }, { role: 'left', html: 'LEFT2' }] },
  ],
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + fixture)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'), null, { timeout: 30000 })
  await p.waitForTimeout(500)
  const doc = () => p.evaluate(() => window.bento.doc)
  const thumb = async (i) => { await p.locator('.ed-sidebar .ed-thumb').nth(i).click(); await p.waitForTimeout(300) }
  const rect = (id) => p.evaluate((id) => { const n = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, r: r.right, y: r.top, w: r.width, text: n.textContent } }, id)

  console.log('\nnothing you wrote is lost\n')
  const report = await p.evaluate((j) => window.bento.loadDoc(j), JSON.stringify(deck))
  await p.waitForTimeout(600)
  ok(!!report && report.compact, 'the compact deck loads')
  const notes = report.dropped.map((d) => d.reason)
  ok(notes.length === 1 && /^layout: no `kicker` slot in layout `layout-two-col` \(its roles: title, body, left, right\)/.test(notes[0]), `the only note is the unknown kicker, naming the layout's roles (${notes.join(' | ')})`)
  const d0 = await doc()
  const texts = d0.slides[0].elements.filter((e) => e.type === 'text' && e.html).map((e) => e.html)
  ok(['TITLE', 'KICKER', 'LEFT', 'RIGHT'].every((h) => texts.filter((x) => x === h).length === 1), `all four texts are on the slide once each (${texts.join(', ')})`)
  await thumb(0)
  const left = await rect('l2c-left'), right = await rect('l2c-right')
  ok(left?.text === 'LEFT' && right?.text === 'RIGHT' && right.x > left.r, `on the canvas LEFT is drawn in the left column and RIGHT in the right one (${left?.text} at ${Math.round(left?.x)}, ${right?.text} at ${Math.round(right?.x)})`)
  await thumb(1)
  const l2 = await rect('l2c-left'), r2 = await rect('l2c-right')
  ok(l2?.text === 'LEFT2' && r2?.text === 'RIGHT2', '`right` written before `left`: still RIGHT on the right')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
