// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Changing the accent in the running editor: one operation, one undo step.
//
//   npm run build:single --prefix slides && node scripts/test-slides-set-accent-browser.mjs
//
// WHAT THIS PROVES. window.bento.setAccent repaints what is bound to the
// accent on the canvas, the file serialize() writes holds no stale bound
// literal, and one undo puts the old accent and every bound literal back
// (one redo returns them). A refused colour changes nothing. Typing a new
// accent in Tokens ▸ Theme moves a chart palette that was derived from the
// old accent with it, also as one undo step. Node twin (the rules on the
// starter deck): scripts/test-slides-set-accent.ts.
import { fileURLToPath } from 'node:url'
import { register } from 'node:module'
register('./lib/ts-resolve-hooks.mjs', import.meta.url)
const { deriveChartPalette } = await import('../slides/src/model.ts')
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const GREEN = '#0A7F5A'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // never reach the network: no relay, no update check
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'slides') } catch {} })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.waitForTimeout(500)

  // a tile on slide 1 whose gradient is bound to the accent: read the PAINTED stops
  const id = await p.evaluate(() => window.bento.doc.slides[0].elements.find((e) => e.type === 'shape' && e.themeRefs?.['fillGradient.stops.0.color']?.startsWith('accent1'))?.id)
  const stops = () => p.evaluate((id) => {
    const n = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`)?.querySelector('rect,path,ellipse')
    const g = /url\(#([^)]+)\)/.exec(n?.getAttribute('fill') ?? '')
    return g ? [...document.getElementById(g[1]).querySelectorAll('stop')].map((s) => getComputedStyle(s).stopColor) : []
  }, id)
  // the bound stop is the first: green outweighs red in the new accent, red in the old
  const greenish = (cs) => { if (!cs.length) return false; const [r, g] = cs[0].match(/\d+/g).map(Number); return g > r }
  const before = await p.evaluate(() => JSON.stringify(window.bento.read()))
  const s0 = await stops()
  ok(id && s0.length && !greenish(s0), `an accent-bound tile paints the old accent (${id}: ${s0.join(', ')})`)

  const r = await p.evaluate((c) => window.bento.setAccent(c), GREEN)
  await p.waitForTimeout(300)
  ok(r && r.to === GREEN && r.followed > 0 && r.chartPalette === 'kept' && r.nearby.length > 0,
    `setAccent returns its report (followed ${r?.followed}, chart palette ${r?.chartPalette}, ${r?.nearby?.length} look-alikes listed)`)
  const s1 = await stops()
  ok(greenish(s1), `the canvas repaints the bound tile (${s1.join(', ')})`)
  const disk = await p.evaluate(() => {
    const doc = JSON.parse(new DOMParser().parseFromString(window.bento.serialize(), 'text/html').getElementById('bento-doc').textContent)
    return { accent: doc.theme.accent, stale: window.bento.validate(doc, { measure: false }).findings.filter((f) => f.code === 'theme-ref-stale').length }
  })
  ok(disk.accent === GREEN && disk.stale === 0, `the saved file has the new accent and no stale bound literal (${disk.accent}, ${disk.stale} theme-ref-stale)`)
  const after = await p.evaluate(() => JSON.stringify(window.bento.read()))

  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(300)
  const undone = await p.evaluate(() => JSON.stringify(window.bento.read()))
  const strip = (j) => { const d = JSON.parse(j); delete d.modified; return JSON.stringify(d) }
  ok(strip(undone) === strip(before) && !greenish(await stops()), 'ONE undo restores the old accent and every bound literal, and the canvas repaints')
  await p.evaluate(() => window.bento.redo())
  await p.waitForTimeout(300)
  ok(strip(await p.evaluate(() => JSON.stringify(window.bento.read()))) === strip(after), 'one redo puts the new accent back')
  const refused = await p.evaluate(() => { const b = JSON.stringify(window.bento.read()); return { r: window.bento.setAccent('green'), same: JSON.stringify(window.bento.read()) === b } })
  ok(refused.r === null && refused.same, 'a colour that is not #rgb/#rrggbb is refused and changes nothing')

  // Tokens ▸ Theme by real input, on a deck whose chart palette was derived from the accent
  const OLD = '#FF9E8A'
  await p.evaluate((cp) => { const d = window.bento.read(); d.theme.accent = '#FF9E8A'; d.theme.chartPalette = cp; window.bento.loadDoc(JSON.stringify(d)) }, deriveChartPalette(OLD))
  await p.waitForTimeout(300)
  await p.click('[data-view="tokens"]')
  await p.waitForSelector('.ed-token-row[data-slot="accent1"] .ed-token-value')
  await p.click('.ed-token-row[data-slot="accent1"] .ed-token-value')
  await p.keyboard.press('ControlOrMeta+A')
  await p.keyboard.type('0a7f5a')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(400)
  const typed = await p.evaluate(() => ({ accent: window.bento.doc.theme.accent, cp: window.bento.doc.theme.chartPalette, stale: window.bento.validate(undefined, { measure: false }).findings.filter((f) => f.code === 'theme-ref-stale').length }))
  ok(typed.accent.toLowerCase() === GREEN.toLowerCase() && JSON.stringify(typed.cp) === JSON.stringify(deriveChartPalette(typed.accent)) && typed.stale === 0,
    `typing the accent in Tokens moves the derived chart palette with it (${typed.accent}: ${typed.cp?.slice(0, 2)}; ${typed.stale} stale)`)
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(300)
  const back = await p.evaluate(() => ({ accent: window.bento.doc.theme.accent, cp: window.bento.doc.theme.chartPalette }))
  ok(back.accent === OLD && JSON.stringify(back.cp) === JSON.stringify(deriveChartPalette(OLD)), 'one undo restores the accent and the chart palette together')
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
