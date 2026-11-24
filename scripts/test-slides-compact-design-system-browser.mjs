// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Compact input speaks the deck's design system (AI-08), in the packaged shell.
//
// A compact deck loaded through window.bento.loadDoc: a shape with no fill is
// PAINTED in the deck's accent (not the editor's orange), a text box with no
// fontFamily RENDERS in the theme font, `"fill": "$color.card"` and
// `"fill": "accent2"` arrive bound. Then the real editor: editing Accent 1 and
// the color.card token in the Tokens view (clicks and typing) re-paints the
// bound shapes on the canvas — measured on the drawn svg, not read back from
// the model. A `use` copy and a `like` slide survive the real loader's derive
// pass; names that do not resolve come back in the load report.
//
// The network is closed: http(s) aborted, WebSockets answered by a closed mock.
//
// Run: (cd slides && npm run build:single) && node scripts/test-slides-compact-design-system-browser.mjs
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
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'bento-compact-ds-')))
const fixture = join(scratch, 'fixture.bento.html')
writeFileSync(fixture, readFileSync(shellPath, 'utf8'))

const THEME_FONT = "Georgia, 'Times New Roman', serif"
const deck = {
  compact: true,
  theme: {
    background: '#0B3D2E', color: '#F4F1E8', accent: '#E8B923', fontFamily: THEME_FONT,
    palette: { accent2: '#3A7BD5' },
    tokens: { set: { 'color.card': { type: 'color', values: { default: '#16273E' } } } },
  },
  slides: [
    { id: 's1', elements: [
      { id: 'plain', type: 'shape', shape: 'rect', x: 100, y: 100, w: 300, h: 200 },
      { id: 'card', type: 'shape', shape: 'rect', x: 500, y: 100, w: 300, h: 200, fill: '$color.card' },
      { id: 'slot', type: 'shape', shape: 'rect', x: 900, y: 100, w: 200, h: 200, fill: 'accent2' },
      { id: 'hello', type: 'text', x: 100, y: 400, w: 600, html: 'Hello' },
      { id: 'logo', type: 'shape', shape: 'ellipse', x: 1180, y: 30, w: 40, h: 40, fill: 'tx1' },
      { id: 'm-bg', type: 'shape', shape: 'rect', x: 100, y: 500, w: 240, h: 160, fill: '#2B4A3F', groupId: 'tile', groupName: 'Tile', component: { id: 'tile', key: 'bg', main: true } },
      { id: 'm-t', name: 'label', type: 'text', x: 120, y: 520, w: 200, h: 40, html: 'Main', groupId: 'tile', component: { id: 'tile', key: 'label', main: true } },
      { use: 'Tile', x: 400, y: 500, over: { label: { html: 'Copy' } } },
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '$color.nope' },
    ] },
    { id: 's2', elements: [{ id: 'logo', type: 'shape', shape: 'ellipse', x: 1180, y: 30, w: 40, h: 40, fill: 'tx1' }, { type: 'text', x: 100, y: 300, w: 600, html: 'Two' }] },
    { id: 's3', like: 's2', elements: [{ type: 'text', x: 100, y: 300, w: 600, html: 'Three' }] },
  ],
}

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})` }

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

  console.log('\nload\n')
  const report = await p.evaluate((j) => window.bento.loadDoc(j), JSON.stringify(deck))
  await p.waitForTimeout(600)
  ok(!!report && report.compact, 'the compact deck loads')
  const why = report.dropped.map((d) => `${d.path}: ${d.reason}`)
  ok(report.dropped.length === 1 && /unknown token `\$color\.nope`; tokens in this deck: `\$color\.card`/.test(why[0] ?? ''), `the one name that does not resolve is reported with the deck's tokens (${why.join(' | ')})`)
  const el = (id, slide = 0) => p.evaluate(([id, slide]) => window.bento.doc.slides[slide].elements.find((e) => e.id === id), [id, slide])
  const plain = await el('plain'), card = await el('card'), slot = await el('slot'), hello = await el('hello')
  ok(plain.fill === '#E8B923' && plain.themeRefs?.fill === 'accent1', `no fill → the accent, bound (${plain.fill}, ${JSON.stringify(plain.themeRefs)})`)
  ok(card.fill === '#16273E' && card.themeRefs?.fill === '$color.card', '"$color.card" → the token value, bound — and the binding survived the open-time derive')
  ok(slot.fill === '#3A7BD5' && slot.themeRefs?.fill === 'accent2', '"accent2" → the slot value, bound')
  ok(!('fontFamily' in hello), 'a text box with no fontFamily has no fontFamily literal after load')

  console.log('\nwhat the canvas draws\n')
  const paint = (id) => p.evaluate((id) => {
    const host = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`)
    const node = host?.querySelector('svg rect, svg path, svg ellipse')
    return node ? getComputedStyle(node).fill : null
  }, id)
  ok(await paint('plain') === rgb('#E8B923'), `the default-filled shape is painted in the deck's accent (${await paint('plain')}), not #F7A600`)
  ok(await paint('card') === rgb('#16273E'), `the token-filled shape is painted in the token colour (${await paint('card')})`)
  const font = await p.evaluate(() => {
    const host = document.querySelector('.ed-stage-scale [data-el-id="hello"]')
    const inner = host && [...host.querySelectorAll('*')].find((n) => n.textContent === 'Hello' && n.children.length === 0)
    return inner ? getComputedStyle(inner).fontFamily : null
  })
  ok(!!font && font.startsWith('Georgia'), `the text renders in the theme font (${font})`)

  console.log('\nthe design system moves, the deck follows (real input)\n')
  await p.click('.ed-side-tabs [data-view="tokens"]'); await p.waitForTimeout(250)
  await p.locator('.ed-token-builtin[data-slot="accent1"] .ed-token-value').click()
  const accField = p.locator('.ed-token-builtin[data-slot="accent1"] input.ed-edit-field')
  await accField.fill('AA2266'); await accField.press('Enter'); await p.waitForTimeout(400)
  ok((await el('plain')).fill.toLowerCase() === '#aa2266' && await paint('plain') === rgb('#AA2266'), `editing Accent 1 re-tints the default-filled shape on the canvas (${await paint('plain')})`)
  ok(await paint('card') === rgb('#16273E'), 'the token-bound shape is untouched by the accent')
  await p.locator('.ed-side-tokens .ed-token-row[data-token="color.card"] .ed-token-value').click()
  const tokField = p.locator('.ed-side-tokens .ed-token-row[data-token="color.card"] input.ed-edit-field')
  await tokField.fill('#335577'); await tokField.press('Enter'); await p.waitForTimeout(400)
  ok((await el('card')).fill.toLowerCase() === '#335577' && await paint('card') === rgb('#335577'), `editing the color.card token re-paints the bound shape (${await paint('card')})`)

  console.log('\nuse and like through the real loader\n')
  const s1 = await p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => ({ id: e.id, html: e.html, c: e.component })))
  const copy = s1.filter((e) => e.c && !e.c.main)
  ok(copy.length === 2 && copy.every((e) => e.c.sig && e.c.id === 'tile') && copy.find((e) => e.c.key === 'label')?.html === 'Copy' && JSON.stringify(copy.find((e) => e.c.key === 'label')?.c.over) === '["html"]', `the use is a copy of the Tile component with only its label overridden (${copy.map((e) => e.id).join(', ')})`)
  const s3 = await p.evaluate(() => { const s = window.bento.doc.slides[2]; return { ids: s.elements.map((e) => e.id), bg: s.background, ref: s.themeRefs?.background } })
  ok(s3.ids[0] === 'logo' && s3.ids.length === 2 && s3.bg === '#0B3D2E' && s3.ref === 'bg1', `the like slide carries the recurring logo and the source's bg1 background (${s3.ids.join(', ')})`)
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
