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
// the model; switching Background and Text there keeps text, code and a
// table (header, body, zebra rows) readable on the canvas, both ways. A `use`
// copy and a `like` slide survive the real loader's derive
// pass; names that do not resolve come back in the load report. A table
// colour picked in the panel, and a preset, survive save and reopen with no
// dangling or stale theme reference.
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
      { id: 'tbl', type: 'table', x: 760, y: 380, w: 440, h: 180, columns: [{ w: 1 }, { w: 1 }],
        rows: [{ cells: [{ html: 'Head' }, { html: 'Head' }] }, { cells: [{ html: 'Body' }, { html: '1' }] }, { cells: [{ html: 'Zebra' }, { html: '2' }] }, { cells: [{ html: 'Body' }, { html: '3' }] }] },
      { id: 'code', type: 'code', x: 760, y: 590, w: 440, h: 60, content: 'plain words' },
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

  console.log('\ntext and its background move together (real input)\n')
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  // every sample is the drawn text colour against what is drawn under it: the
  // slide, or a cell's own background composited over the slide
  const drawn = () => p.evaluate(() => {
    const surface = document.querySelector('.ed-stage-scale .bento-slide')
    const bg = surface ? getComputedStyle(surface).backgroundColor : 'rgb(0, 0, 0)'
    const nums = (c) => c.match(/[\d.]+/g).map(Number)
    const over = (c) => { const [r, g, b, a = 1] = nums(c); const [R, G, B] = nums(bg); return `rgb(${Math.round(r * a + R * (1 - a))}, ${Math.round(g * a + G * (1 - a))}, ${Math.round(b * a + B * (1 - a))})` }
    const leaf = (id, text) => { const h = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`); return h && [...h.querySelectorAll('*')].find((n) => n.textContent === text && !n.children.length) }
    const rows = [...(document.querySelector('.ed-stage-scale [data-el-id="tbl"] table')?.querySelectorAll('tr') ?? [])]
    const cell = (i) => { const c = rows[i]?.children[0]; return c ? { ink: getComputedStyle(c).color, bg: over(getComputedStyle(c).backgroundColor) } : null }
    const text = leaf('hello', 'Hello')
    // the highlighter splits code into token spans: the first word's own span, else the block
    const pre = document.querySelector('.ed-stage-scale [data-el-id="code"] pre')
    const code = pre && ([...pre.querySelectorAll('*')].find((n) => n.textContent.trim() === 'plain' && !n.children.length) ?? pre)
    return { slide: bg, samples: {
      text: text ? { ink: getComputedStyle(text).color, bg } : null,
      code: code ? { ink: getComputedStyle(code).color, bg } : null,
      'table header': cell(0), 'table body': cell(1), 'table zebra row': cell(2),
    } }
  })
  const check = async (when) => {
    const d = await drawn()
    const lines = Object.entries(d.samples).map(([k, v]) => [k, v, v ? ratio(v.ink, v.bg) : 0])
    ok(lines.every(([, v, r]) => v && r >= 4.5), `${when}: text, code, table header, body and zebra rows all read on the canvas (${lines.map(([k, , r]) => `${k} ${r.toFixed(2)}:1`).join(', ')})`)
    return d
  }
  const setTheme = async (pairs) => {
    for (const [slot, v] of pairs) {
      await p.locator(`.ed-token-builtin[data-slot="${slot}"] .ed-token-value`).click()
      const f = p.locator(`.ed-token-builtin[data-slot="${slot}"] input.ed-edit-field`)
      await f.fill(v); await f.press('Enter'); await p.waitForTimeout(400)
    }
  }
  await check('before (the deck\'s dark theme)')
  await setTheme([['bg1', 'FFFFFF'], ['tx1', '1E2A3A']])
  const light = await check('after switching Background and Text to light in the Tokens view')
  ok(light.slide === 'rgb(255, 255, 255)', `the slide did turn light (${light.slide})`)
  const zebra = light.samples['table zebra row']?.bg, body = light.samples['table body']?.bg
  ok(!!zebra && zebra !== body, `the zebra stripe is still visible on the light theme (${zebra} vs ${body})`)
  await setTheme([['bg1', '101820'], ['tx1', 'F5F7FA']])
  const dark = await check('and back to dark')
  ok(dark.slide === 'rgb(16, 24, 32)', `the slide did turn dark (${dark.slide})`)

  console.log('\nuse and like through the real loader\n')
  const s1 = await p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => ({ id: e.id, html: e.html, c: e.component })))
  const copy = s1.filter((e) => e.c && !e.c.main)
  ok(copy.length === 2 && copy.every((e) => e.c.sig && e.c.id === 'tile') && copy.find((e) => e.c.key === 'label')?.html === 'Copy' && JSON.stringify(copy.find((e) => e.c.key === 'label')?.c.over) === '["html"]', `the use is a copy of the Tile component with only its label overridden (${copy.map((e) => e.id).join(', ')})`)
  const s3 = await p.evaluate(() => { const s = window.bento.doc.slides[2]; return { ids: s.elements.map((e) => e.id), bg: s.background, ref: s.themeRefs?.background, theme: window.bento.doc.theme.background } })
  ok(s3.ids[0] === 'logo' && s3.ids.length === 2 && s3.bg.toLowerCase() === s3.theme.toLowerCase() && s3.ref === 'bg1', `the like slide carries the recurring logo and the source's bg1 background (${s3.ids.join(', ')})`)

  console.log('\na table colour you pick stays picked (real input, save, reopen)\n')
  const tdeck = { compact: true, theme: { background: '#FFFFFF', color: '#1E2A3A', accent: '#2B6CB0' }, slides: [{ id: 'T', elements: [
    { id: 'tb', type: 'table', x: 200, y: 200, w: 600, h: 200, columns: [{ w: 1 }, { w: 1 }], rows: [{ cells: [{ html: 'Head' }, { html: 'H2' }] }, { cells: [{ html: 'Body' }, { html: 'B2' }] }, { cells: [{ html: 'Zeb' }, { html: 'Z2' }] }] },
    { id: 'tb2', type: 'table', x: 200, y: 450, w: 600, h: 200, columns: [{ w: 1 }], rows: [{ cells: [{ html: 'A' }] }, { cells: [{ html: 'B' }] }, { cells: [{ html: 'C' }] }] }] }] }
  const openShell = async (file) => {
    const pg = await ctx.newPage(); pg.on('pageerror', (e) => errors.push(e.message))
    await pg.goto('file://' + file)
    await pg.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'), null, { timeout: 30000 })
    await pg.waitForTimeout(500); return pg
  }
  const tp = await openShell(fixture)
  await tp.evaluate((j) => window.bento.loadDoc(j), JSON.stringify(tdeck)); await tp.waitForTimeout(600)
  const tbl = (pg, id) => pg.evaluate((id) => { const t = window.bento.doc.slides[0].elements.find((e) => e.id === id); return { style: t.style, refs: t.themeRefs ?? {} } }, id)
  const refWarnings = (pg) => pg.evaluate(() => window.bento.validate().findings.filter((f) => /theme-ref/.test(f.code ?? '')).map((f) => `${f.code} ${f.path ?? ''}`))
  const pick = async (id) => { const b = await tp.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox(); await tp.mouse.click(b.x + b.width - 4, b.y + b.height / 2); await tp.waitForTimeout(300) }
  const rowOf = (label) => tp.locator('.ed-props .ed-row', { has: tp.locator(`span:text-is("${label}")`) }).first()
  const setColour = async (label, hex) => {
    await rowOf(label).locator('input[type=color]').click(); await tp.waitForTimeout(250)
    const f = tp.locator('.ed-cpop .ed-cpop-text'); await f.fill(hex); await f.press('Enter'); await tp.waitForTimeout(400)
    await tp.keyboard.press('Escape'); await tp.waitForTimeout(150)
  }
  ok((await tbl(tp, 'tb')).refs['style.color'] === 'tx1', 'the compact table arrives with its text bound to the theme')
  await pick('tb')
  await setColour('Text', '#CC0000')
  await pick('tb')
  await setColour('Grid lines', '#00AA00')
  const edited = await tbl(tp, 'tb')
  ok(edited.style.color.toLowerCase() === '#cc0000' && !edited.refs['style.color'] && !edited.refs['style.borderColor'], `a colour picked in the panel drops that key's theme binding (refs left: ${Object.keys(edited.refs).join(', ') || 'none'})`)
  await pick('tb2')
  await rowOf('Preset').locator('select').selectOption('Lined'); await tp.waitForTimeout(400)
  await rowOf('Preset').locator('select').selectOption('Minimal'); await tp.waitForTimeout(400)
  const preset = await tbl(tp, 'tb2')
  ok(!preset.refs['style.zebra'] && !preset.refs['style.headerBg'], 'a preset that removes the zebra removes its binding too')
  const warn1 = await refWarnings(tp)
  ok(warn1.length === 0, `no dangling or stale theme references after the edits and presets (${warn1.join(', ') || 'none'})`)
  const saved = join(scratch, 'saved.bento.html')
  writeFileSync(saved, await tp.evaluate(() => window.bento.serialize()))
  const rp = await openShell(saved)
  const back = await tbl(rp, 'tb')
  ok(back.style.color.toLowerCase() === '#cc0000' && /0, 170, 0|#00aa00/i.test(back.style.borderColor), `after save and reopen the picked colours are still there (text ${back.style.color}, grid ${back.style.borderColor}; reverted to #1E2A3A before)`)
  const warn2 = await refWarnings(rp)
  ok(warn2.length === 0, `and the reopened deck reports no theme-reference problems (${warn2.join(', ') || 'none'})`)
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
