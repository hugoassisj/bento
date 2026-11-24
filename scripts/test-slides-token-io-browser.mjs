// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Design-token import and export, driven through the Tokens view in Chromium.
//
//   npm run build:single --prefix slides && node scripts/test-slides-token-io-browser.mjs
//   (SHELL_HTML=<older build> runs the same checks against it)
//
// WHAT THIS PROVES
//   1. Tokens ▸ ⋯ offers Import tokens… and Export tokens….
//   2. Import: paste a small file, Review lists new / changed / skipped with the
//      reason; a changed row starts unticked ("Replace existing" is off); untick
//      a new row, tick the changed one, Apply. window.bento.doc.theme.tokens has
//      exactly the ticked rows, the bound element follows its token's new value
//      and keeps its binding, and the unticked row never arrived.
//   3. ⌘Z once restores the previous token set byte for byte.
//   4. Export: the dialog's JSON and its Download (<deck>.tokens.json) carry the
//      tokens and theme colours and no collab or slide content.
//   5. A file of two same-shaped sets lands one set per mode ("Each set is a
//      mode", ticked for it), or merged into the active mode when unticked;
//      applied, the deck gains the modes, and ⌘Z takes them away.
//   6. A hostile paste (url() colour, __proto__) lists each refusal and writes
//      nothing; Escape closes the dialog. A file built to exhaust or crash the
//      review (alias fan-out, a 200,000-deep value, values shaped like refusals)
//      still gets its review, quickly; on a phone the reasons read in full.
//   7. Not one request leaves the page: http(s) is aborted, sockets closed,
//      Offline mode on — and the count of attempts stays zero.
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const shape = (id, x, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y: 100, w: 200, h: 120, rotation: 0, opacity: 1, fill: '#123456', stroke: 'transparent', strokeWidth: 0, radius: 16, ...extra })
const SLIDES = [{ id: 's1', background: '#ffffff', transition: 'none', notes: 'NOTES-STAY-HOME', elements: [shape('a', 100, { themeRefs: { radius: '$radius.md' } }), shape('b', 400)] }]
const TOKENS = { set: { 'radius.md': { type: 'number', values: { default: 16 } }, 'color.brand': { type: 'color', values: { default: '#ff9900' } } } }
const FILE = JSON.stringify({
  radius: { md: { $type: 'dimension', $value: '24px' }, lg: { $type: 'dimension', $value: '{radius.md}' } },
  color: { ink: { $type: 'color', $value: '#101828' }, skip: { $type: 'color', $value: '#00ff00' } },
  type: { body: { $type: 'typography', $value: { fontSize: '16px' } } },
})

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'tokens') } catch {} })
  let requests = 0
  await ctx.route(/^https?:/, (r) => { requests++; r.abort() })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => { requests++; ws.close() })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
  await p.evaluate(([slides, tokens]) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = slides
    d.theme.tokens = tokens
    d.title = 'Brand deck'
    d.collab = { room: 'ROOM-STAYS-HOME', key: 'KEY-STAYS-HOME', on: false }
    window.bento.loadDoc(JSON.stringify(d))
  }, [SLIDES, TOKENS])
  await p.waitForTimeout(400)
  await p.evaluate(() => document.querySelector('.ed-side-tabs [data-view="tokens"]')?.click())
  await p.waitForTimeout(200)
  const before = await p.evaluate(() => JSON.stringify(window.bento.doc.theme.tokens))
  const tokens = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.theme.tokens ?? null)))
  const elA = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.slides[0]?.elements.find((e) => e.id === 'a') ?? null)))
  // a missing control is a failed check, not a crash: an older build has none of them
  const tap = (sel) => p.click(sel, { timeout: 2000 }).then(() => true, () => false)
  const fill = (sel, v) => p.fill(sel, v, { timeout: 2000 }).then(() => true, () => false)
  const menu = async (label) => {
    if (!(await tap('.ed-tokens-file'))) return false
    await p.waitForTimeout(150)
    return tap(`.ed-ctxmenu >> text=${label}`)
  }

  console.log('\n1. the menu\n')
  ok(await tap('.ed-tokens-file'), 'the Tokens view has a ⋯ for the token file')
  await p.waitForTimeout(150)
  const items = await p.$$eval('.ed-ctxmenu button, .ed-ctxmenu [role="menuitem"]', (b) => b.map((x) => x.textContent.trim()))
  ok(items.includes('Import tokens…') && items.includes('Export tokens…'), `…offering Import tokens… and Export tokens… (${items.join(', ')})`)
  await p.keyboard.press('Escape'); await p.waitForTimeout(100)

  console.log('\n2. import: paste, review, tick, apply\n')
  ok(await menu('Import tokens…'), 'Import tokens… opens')
  await p.waitForSelector('.bkd-card textarea', { timeout: 2000 }).catch(() => {})
  ok(await p.evaluate(() => document.activeElement?.matches('.bkd-card textarea')), 'the paste field has focus')
  await fill('.bkd-card textarea', FILE)
  await tap('.bkd-card button:has-text("Review")')
  await p.waitForTimeout(250)
  const sum = await p.evaluate(() => document.querySelector('.ed-tokio-sum')?.textContent ?? '')
  ok(sum === '3 new · 1 changed · 0 unchanged · 1 skipped', `the review counts the rows ("${sum}")`)
  const aliasNote = await p.evaluate(() => [...document.querySelectorAll('.ed-tokio .ed-hint')].map((n) => n.textContent).join(' '))
  ok(/1 aliases resolved/.test(aliasNote), `…and states the aliases it flattened ("${aliasNote}")`)
  const skipped = await p.evaluate(() => document.querySelector('.ed-tokio-skipped')?.textContent ?? '')
  ok(/type\.body/.test(skipped) && /no typography tokens/.test(skipped), `an unsupported token is listed with its reason ("${skipped}")`)
  const changed = await p.evaluate(() => { const r = document.querySelector('.ed-tokio-changed'); return { text: r?.textContent ?? '', on: r?.querySelector('input')?.checked } })
  ok(changed.on === false && /16 → 24/.test(changed.text), `the changed row shows old → new and starts unticked ("${changed.text}")`)
  const replaceBox = '.ed-tokio-opt:has-text("Replace existing") input'
  await tap(replaceBox); await p.waitForTimeout(150)
  const replaced = await p.evaluate(() => document.querySelector('.ed-tokio-changed input')?.checked)
  await tap(replaceBox); await p.waitForTimeout(150)
  ok(replaced === true && (await p.evaluate(() => document.querySelector('.ed-tokio-changed input')?.checked)) === false, '"Replace existing" ticks the changed rows, and unticks them again')
  await tap('.ed-tokio-changed input')
  await tap('.ed-tokio-new input[aria-label="color.skip"]')
  await tap('.bkd-card button:has-text("Apply")')
  await p.waitForTimeout(300)
  const after = await tokens()
  ok(after?.set['radius.md']?.values.default === 24 && after?.set['radius.lg']?.values.default === 24 && after?.set['color.ink']?.values.default === '#101828',
    'the ticked rows landed: radius.md 16 → 24, radius.lg (an alias, as its literal), color.ink')
  ok(!after?.set['color.skip'] && !after?.set['type.body'], 'the unticked row and the skipped one did not')
  ok(after?.set['color.brand']?.values.default === '#ff9900', 'a token the file did not name is untouched')
  const a = await elA()
  ok(a?.radius === 24 && a?.themeRefs?.radius === '$radius.md', `the bound element follows its token and keeps its binding (radius ${a?.radius}, ${a?.themeRefs?.radius})`)
  ok(!(await p.$('.bkd-overlay')), 'Apply closes the dialog')
  await p.waitForTimeout(100)
  ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-tokens-file')), `focus goes back to the ⋯, not the page (${await p.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)})`)

  console.log('\n3. one undo step\n')
  await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Meta+z'); await p.waitForTimeout(300)
  const undone = await p.evaluate(() => JSON.stringify(window.bento.doc.theme.tokens))
  ok(undone === before, '⌘Z once restores the token set byte for byte')
  ok((await elA())?.radius === 16, '…and the bound element with it')

  console.log('\n4. export\n')
  ok(await menu('Export tokens…'), 'Export tokens… opens')
  await p.waitForSelector('.bkd-card textarea', { timeout: 2000 }).catch(() => {})
  const shown = await p.evaluate(() => document.querySelector('.bkd-card textarea')?.value ?? '')
  let parsed = null
  try { parsed = JSON.parse(shown) } catch {}
  ok(parsed?.default?.radius?.md?.$value === '16px' && parsed?.default?.color?.brand?.$value === '#ff9900' && parsed?.theme?.background, 'the dialog shows the tokens (one group per mode) and the theme colours')
  ok(/Brand deck/.test(parsed?.$description ?? ''), `the root $description names the deck ("${parsed?.$description}")`)
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }).catch(() => null), tap('.bkd-card button:has-text("Download")')])
  const name = dl?.suggestedFilename() ?? ''
  const body = dl ? readFileSync(await dl.path(), 'utf8') : ''
  ok(/\.tokens\.json$/.test(name) && body === shown, `Download saves the same JSON as ${name}`)
  ok(!/STAYS-HOME|"collab"|"slides"|"elements"/.test(body), 'the export carries no collab, no notes, no slide content')

  console.log('\n5. a file of sets\n')
  await menu('Import tokens…')
  await p.waitForSelector('.bkd-card textarea', { timeout: 2000 }).catch(() => {})
  await fill('.bkd-card textarea', JSON.stringify({ $metadata: { tokenSetOrder: ['light', 'dark'] }, light: { bg: { $type: 'color', $value: '#ffffff' } }, dark: { bg: { $type: 'color', $value: '#000000' } } }))
  await tap('.bkd-card button:has-text("Review")')
  await p.waitForTimeout(250)
  const valText = () => p.evaluate(() => document.querySelector('.ed-tokio-new .ed-tokio-val')?.textContent)
  const modeBox = '.ed-tokio-opt:has-text("Each set is a mode") input'
  const perMode = await valText()
  await tap(modeBox); await p.waitForTimeout(200)
  const merged = await valText()
  await tap(modeBox); await p.waitForTimeout(200)
  ok(perMode === 'light: ffffff · dark: 000000' && merged === '000000' && (await valText()) === perMode,
    `two sets of the same shape start as one mode each; unticked they merge into the active mode, the later set winning ("${perMode}" ⇄ "${merged}")`)
  await tap('.bkd-card button:has-text("Apply")'); await p.waitForTimeout(300)
  const sets = await tokens()
  ok(JSON.stringify(sets?.modes) === '["default","light","dark"]' && JSON.stringify(sets?.set.bg?.values) === '{"light":"#ffffff","dark":"#000000"}', `applied, the deck gains the two modes (${JSON.stringify(sets?.modes)})`)
  await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Meta+z'); await p.waitForTimeout(300)
  ok(await p.evaluate(() => JSON.stringify(window.bento.doc.theme.tokens)) === before, '…and ⌘Z takes them away again')

  console.log('\n6. a hostile paste\n')
  const pre = await p.evaluate(() => JSON.stringify(window.bento.doc.theme))
  await menu('Import tokens…')
  await p.waitForSelector('.bkd-card textarea', { timeout: 2000 }).catch(() => {})
  await fill('.bkd-card textarea', '{"a":{"evil":{"$type":"color","$value":"url(https://evil.example/x.svg#f)"}},"__proto__":{"x":{"$type":"color","$value":"#f00"}}}')
  await tap('.bkd-card button:has-text("Review")')
  await p.waitForTimeout(250)
  const refusals = await p.$$eval('.ed-tokio-skipped', (r) => r.map((x) => x.textContent))
  ok(refusals.length === 2 && refusals.some((r) => /a\.evil/.test(r)) && refusals.some((r) => /__proto__/.test(r)), `each refusal is listed (${refusals.join(' | ')})`)
  ok(await p.evaluate(() => document.querySelector('.bkd-card button.ed-primary')?.disabled), 'with nothing to write, Apply is disabled')
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  ok(!(await p.$('.bkd-overlay')), 'Escape closes the dialog')
  ok(await p.evaluate(() => JSON.stringify(window.bento.doc.theme)) === pre && !('x' in {}), 'nothing was written, Object.prototype untouched')

  // a file built to exhaust or crash the review (review round 1): aliases that
  // fan out ten wide and eight deep, a value nested 200,000 levels, and values
  // shaped like the importer's own refusals
  const fan = {}
  for (let i = 0; i < 8; i++) fan[`l${i}`] = { $type: 'shadow', $value: Array.from({ length: 10 }, () => `{l${i + 1}}`) }
  fan.l8 = { $type: 'color', $value: '#000000' }
  fan.forged = { $type: 'color', $value: { error: 'foo' } }
  fan.forged2 = { $type: 'color', $value: { error: 'constructor' } }
  const nested = `"deep":{"$type":"color","$value":${'['.repeat(200000)}"#000"${']'.repeat(200000)}}`
  const hostileText = JSON.stringify(fan).replace(/\}$/, `,${nested}}`)
  await menu('Import tokens…')
  await p.waitForSelector('.bkd-card textarea', { timeout: 2000 }).catch(() => {})
  await p.evaluate((v) => { const ta = document.querySelector('.bkd-card textarea'); if (ta) ta.value = v }, hostileText)
  const t0 = Date.now()
  await tap('.bkd-card button:has-text("Review")')
  await p.waitForSelector('.ed-tokio-sum', { timeout: 3000 }).catch(() => {})
  const took = Date.now() - t0
  const rows = await p.$$eval('.ed-tokio-skipped', (r) => r.map((x) => x.textContent))
  ok(took < 1500 && rows.some((r) => /^l0Too many aliases/.test(r)) && rows.some((r) => /^deepNested too deeply/.test(r)),
    `alias fan-out and a 200,000-deep value end in refusals, and the review shows in ${took} ms`)
  ok(rows.filter((r) => /^forged/.test(r)).length === 2 && rows.filter((r) => /^forged/.test(r)).every((r) => /Not a value of this type/.test(r)),
    `values shaped like refusals read as "not a value" (${rows.filter((r) => /^forged/.test(r)).join(' | ')})`)
  // on a phone, a skipped row's reason is shown in full, not cut to a tooltip
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200)
  const cut = await p.$$eval('.ed-tokio-skipped .ed-tokio-val', (v) => v.filter((x) => x.scrollWidth > x.clientWidth + 1).length)
  ok(cut === 0, `on a 390px screen no skipped reason is cut off (${cut} cut)`)
  await p.setViewportSize({ width: 1440, height: 1000 })
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)

  console.log('\n7. offline\n')
  ok(requests === 0, `no request or socket was attempted (${requests})`)
  ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
