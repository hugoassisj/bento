// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Layout and role never drop content; the four layouts decks are made of (AI-09).
// In the packaged shell, with real input for the editor paths.
//
// Compact input through window.bento.loadDoc: on the two-column layout an
// unknown role written before the named columns keeps all four texts, LEFT in
// the left column and RIGHT in the right one (measured on the canvas), and
// `right` before `left` no longer swaps them. The stats layout without its
// third stat closes up: the two items fill the row on the canvas. Then the
// editor: the New-slide picker lists Statistics, Big number, Timeline and
// Chart + figures, and a Timeline inserted by clicks wears the deck's colours;
// Apply layout (clicks) puts a slide's chart into the chart slot of Chart +
// figures, and one undo takes it back.
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

const BG = '#101820', INK = '#F5F7FA', ACCENT = '#FF9E8A'
const deck = {
  compact: true,
  theme: { background: BG, color: INK, accent: ACCENT },
  slides: [
    { id: 'cols', layout: 'two-col', elements: [
      { role: 'title', html: 'TITLE' }, { role: 'kicker', html: 'KICKER' }, { role: 'left', html: 'LEFT' }, { role: 'right', html: 'RIGHT' }] },
    { id: 'swap', layout: 'two-col', elements: [{ role: 'right', html: 'RIGHT2' }, { role: 'left', html: 'LEFT2' }] },
    { id: 'stats', layout: 'stats', elements: [
      { role: 'title', html: 'Two numbers' }, { role: 'stat1', html: '40%' }, { role: 'label1', html: 'faster' }, { role: 'stat2', html: '3×' }, { role: 'label2', html: 'reach' }] },
    { id: 'raw', elements: [
      { type: 'text', role: 'title', x: 96, y: 40, w: 600, h: 60, html: 'Growth' },
      { id: 'mychart', type: 'chart', role: 'chart', x: 700, y: 300, w: 400, h: 300,
        option: { xAxis: { type: 'category', data: ['a', 'b', 'c'] }, yAxis: { type: 'value' }, series: [{ type: 'bar', data: [3, 5, 8] }] } },
      { type: 'text', role: 'stat1', x: 96, y: 500, w: 300, h: 80, html: '+58%' }] },
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

  console.log('\nthe stats layout closes up\n')
  await thumb(2)
  const row = await rect('lst-row'), i1 = await rect('lst-item1'), i2 = await rect('lst-item2')
  ok(!!row && !!i2 && Math.abs(i2.r - row.r) < 2 && Math.abs(i1.w - i2.w) < 2 && !(await rect('lst-item3')), `two stats fill the row on the canvas, no hole where the third would be (row right ${Math.round(row?.r)}, item 2 right ${Math.round(i2?.r)})`)
  const statColor = await p.evaluate(() => { const n = document.querySelector('.ed-stage-scale [data-el-id="lst-stat1"]'); const leaf = n && [...n.querySelectorAll('*')].find((x) => x.textContent === '40%' && !x.children.length); return leaf ? getComputedStyle(leaf).color : null })
  ok(statColor === 'rgb(255, 158, 138)', `the stat is drawn in the deck's accent (${statColor})`)

  console.log('\nthe picker (real input)\n')
  await p.locator('.ed-sidebar .ed-add-slide').click(); await p.waitForTimeout(300)
  const names = await p.$$eval('.ed-layoutpick-name', (ns) => ns.map((n) => n.textContent))
  ok(['Statistics', 'Big number', 'Timeline', 'Chart + figures'].every((n) => names.includes(n)), `the New-slide picker lists the four new layouts (${names.join(', ')})`)
  await p.locator('.ed-layoutpick-item', { hasText: 'Timeline' }).click(); await p.waitForTimeout(400)
  const d1 = await doc()
  const last = d1.slides[d1.slides.length - 1]
  const title = last.elements.find((e) => e.id === 'ltl-title'), tick = last.elements.find((e) => e.id === 'ltl-tick1')
  ok(last.elements.some((e) => e.id === 'ltl-stepbody4'), 'a Timeline slide is inserted at the end with its four steps')
  ok(last.background === BG && last.themeRefs?.background === 'bg1' && title?.color === INK && tick?.fill === ACCENT, `it wears the deck's colours at once (background ${last.background}, title ${title?.color}, tick ${tick?.fill})`)

  console.log('\nApply layout (real input)\n')
  await thumb(3)
  await p.keyboard.press('Escape'); await p.waitForTimeout(200)
  const applyBtn = p.locator('.ed-props button', { hasText: 'Apply layout' })
  // the Layout section starts folded: open it as a person would
  if (!(await applyBtn.isVisible())) { await p.locator('.ed-props .ed-section', { hasText: /^Layout$/ }).first().click(); await p.waitForTimeout(250) }
  await applyBtn.click(); await p.waitForTimeout(300)
  await p.locator('.ed-layoutpick-item', { hasText: 'Chart + figures' }).click(); await p.waitForTimeout(500)
  const d2 = await doc()
  const applied = d2.slides[3].elements
  const slot = applied.find((e) => e.id === 'lcf-chart')
  ok(slot?.type === 'chart' && !applied.some((e) => e.id === 'mychart') && slot.option?.series?.[0]?.data?.join() === '3,5,8', 'the slide\'s chart now IS the chart slot (its data kept), not a copy beside it')
  ok(applied.find((e) => e.id === 'lcf-title')?.html === 'Growth' && applied.find((e) => e.id === 'lcf-stat1')?.html === '+58%', 'the title and the stat moved into their slots')
  const chartBox = await rect('lcf-chart'), stage = await p.evaluate(() => { const r = document.querySelector('.ed-stage-scale').getBoundingClientRect(); return { x: r.left, w: r.width } })
  const scale = stage.w / d2.size.width
  ok(!!chartBox && Math.abs((chartBox.x - stage.x) / scale - slot.x) < 3, `the chart is drawn on the slot's frame (x ${Math.round((chartBox?.x - stage.x) / scale)} vs ${slot?.x})`)
  await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(300)
  ok((await doc()).slides[3].elements.some((e) => e.id === 'mychart'), 'one undo puts the slide back')
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
