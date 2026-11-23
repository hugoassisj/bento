// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Chrome that holds still: layer rows under the pointer, panel handles.
//
//   npm run build:single --prefix slides && node scripts/test-slides-steady-chrome-browser.mjs
//
// WHAT THIS PROVES: hovering a layer row changes nothing but its highlight —
// no row moves, grows or re-wraps (the padlock and eye are always laid out and
// only fade in; they used to be display:none until hover, so every row jumped
// under the pointer). And the panel handles draw an SVG chevron centred in
// their pill, turned toward where a click moves the edge — not a ‹ › character
// sitting on the font's baseline. And a group selected whole lights its own
// row only; its members carry a faint tint, not the selection highlight.
// And the insert tools hold still when the selection changes: the boolean
// buttons (three shapes) and the path bar (one path) hang past the group's end
// instead of widening it, so Move never shifts (it slid 83px at 1440); at
// 1024, with no room before the output zone, the booleans collapse to one
// "Combine shapes" button that overlaps nothing — in RTL too — and the
// contextual buttons still follow Comment in tab order.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'layers'); localStorage.setItem('bento-notes-open', '1') } catch {} }) // notes open: their handle is checked below
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-layer'))
  await p.waitForTimeout(400)

  console.log('\nlayer rows hold still under the pointer\n')
  const boxes = () => p.evaluate(() => [...document.querySelectorAll('.ed-layer')].filter((r) => r.offsetParent).map((r) => {
    const b = r.getBoundingClientRect(); const l = r.querySelector('.ed-layer-label')?.getBoundingClientRect()
    return `${Math.round(b.top)},${Math.round(b.height)},${Math.round(l?.width ?? 0)}`
  }).join(' '))
  const rest = await boxes()
  const rows = p.locator('.ed-layer:visible')
  const n = Math.min(await rows.count(), 6)
  let moved = 0
  for (let i = 0; i < n; i++) { await rows.nth(i).hover(); await p.waitForTimeout(150); if ((await boxes()) !== rest) moved++ }
  ok(n >= 4 && moved === 0, `hovering ${n} rows moves, grows or re-wraps none of them (changed on ${moved})`)
  const shown = await rows.nth(n - 1).evaluate((r) => [...r.querySelectorAll('.ed-layer-act')].map((a) => getComputedStyle(a).opacity))
  ok(shown.length === 2 && shown.every((o) => o === '1'), 'the hovered row shows its padlock and eye')

  console.log('\npanel handles draw a centred chevron\n')
  const handles = await p.evaluate(() => [...document.querySelectorAll('.ed-panel-toggle')].filter((h) => h.offsetParent).map((h) => {
    const b = h.getBoundingClientRect(); const s = h.querySelector('svg')?.getBoundingClientRect()
    return { text: (h.textContent ?? '').trim(), dir: h.dataset.dir, off: s ? Math.max(Math.abs((s.left + s.width / 2) - (b.left + b.width / 2)), Math.abs((s.top + s.height / 2) - (b.top + b.height / 2))) : 99 }
  }))
  ok(handles.length >= 3, `the two side handles and the notes handle are there (${handles.length})`)
  ok(handles.every((h) => h.text === '' && h.off <= 0.75), `each is an SVG chevron centred in its pill, no text glyph (worst off-centre ${Math.max(...handles.map((h) => h.off)).toFixed(2)}px)`)
  ok(handles.every((h) => ['left', 'right', 'up', 'down'].includes(h.dir)), `each points somewhere (${handles.map((h) => h.dir).join(', ')})`)
  console.log('\na group selected whole lights its own row only\n')
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const r = (id, x) => ({ id, type: 'shape', shape: 'rect', x, y: 100, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#f00', stroke: 'transparent', strokeWidth: 0, radius: 0, groupId: 'g', groupName: 'Pair' })
    d.slides = [{ id: 's', background: '#fff', transition: 'none', notes: '', elements: [r('a', 100), r('b', 300)] }]
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(300)
  await p.evaluate(() => window.bento.select?.(['a', 'b']) ?? document.querySelector('.ed-layer-group')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await p.waitForTimeout(300)
  const lit = await p.evaluate(() => ({ group: !!document.querySelector('.ed-layer-group.sel'), members: document.querySelectorAll('.ed-layer.sel:not(.ed-layer-group)').length, tinted: document.querySelectorAll('.ed-layer.in-sel').length }))
  ok(lit.group && lit.members === 0, `the group row is lit and no member row is (members lit: ${lit.members})`)
  ok(lit.tinted === 2, `its members carry only the faint inside-the-selection tint (${lit.tinted})`)

  console.log('\nthe insert tools hold still when the selection changes\n')
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
  const shape = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, rotation: 0, opacity: 1, fill: '#5E7699', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra })
  const ELS = [
    shape('r1', 80, 140, 150, 150), shape('r2', 300, 140, 150, 150), shape('r3', 520, 140, 150, 150),
    shape('tri', 820, 120, 300, 260, { shape: 'path', d: 'M 0 260 L 150 0 L 300 260 Z', pathBox: [0, 0, 300, 260] }),
    shape('ln', 100, 560, 400, 4, { shape: 'line', stroke: '#000000', strokeWidth: 4 }),
  ]
  for (const [width, dir] of [[1440, 'ltr'], [1024, 'ltr'], [1024, 'rtl']]) {
    const tag = `${width}px${dir === 'rtl' ? ' RTL' : ''}`
    const c = await browser.newContext({ viewport: { width, height: 900 } })
    await c.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
    await c.route(/^https?:/, (r) => r.abort())
    const q = await c.newPage()
    q.on('pageerror', (e) => errors.push(e.message))
    await q.goto('file://' + SHELL)
    await q.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar [data-cmd="tool-select"]'))
    if (dir === 'rtl') await q.evaluate(() => { document.documentElement.dir = 'rtl' })
    await q.evaluate((els) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'none', elements: els }]
      window.bento.loadDoc(JSON.stringify(d))
    }, ELS)
    await q.waitForTimeout(500)
    const frame = () => q.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const box = (id) => q.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    const moveLeft = () => q.evaluate(() => document.querySelector('.ed-topbar [data-cmd="tool-select"]').getBoundingClientRect().left)
    const clickEl = async (id, shift = false) => {
      const b = await box(id)
      if (shift) await q.keyboard.down('Shift')
      await q.mouse.click(b.x + b.width / 2, b.y + b.height * 0.7)
      if (shift) await q.keyboard.up('Shift')
      await frame(); await q.waitForTimeout(150)
    }
    const deselect = async () => { await q.keyboard.press('Escape'); await q.keyboard.press('Escape'); await frame(); await q.waitForTimeout(100) }
    // the contextual strip, and whether it lies over anything else on the bar
    const strip = () => q.evaluate(() => {
      const bar = document.querySelector('.ed-topbar')
      const ctx = [...bar.querySelectorAll('.ed-bool, .ed-pathbar')].find((e) => !e.hidden && e.getBoundingClientRect().width > 0)
      const own = ctx?.getBoundingClientRect(), edge = bar.getBoundingClientRect()
      const vis = (s) => [...bar.querySelectorAll(s)].filter((b) => !b.closest('.ed-menu') && b.getBoundingClientRect().width > 0)
      const hits = !own || !own.width ? [] : vis('button:not(.ed-avatar), .ed-avatars, .ed-title').filter((b) => !ctx.contains(b)).filter((b) => {
        const r = b.getBoundingClientRect()
        return r.left < own.right - 1 && own.left < r.right - 1 && r.top < own.bottom && own.top < r.bottom
      }).map((b) => b.dataset.cmd || b.className)
      return {
        shown: !!own && own.width > 0, fold: bar.classList.contains('ed-bar-fold'), hits,
        inside: !!own && own.left >= edge.left - 0.5 && own.right <= edge.right + 0.5,
        bools: vis('.ed-bool [data-bool]').length, combine: vis('.ed-bool-more > button').length, path: vis('.ed-pathbar [data-node]').length,
      }
    })
    await deselect()
    const at = { none: await moveLeft() }
    await clickEl('r1')
    at.one = await moveLeft()
    // three shapes, by a real marquee from the empty slide above-left of r1
    // to past r3 (Selecto listens for mouse events, so page.mouse it is)
    await deselect()
    const a = await box('r1'), z = await box('r3')
    const x0 = Math.min(a.x, z.x) - 12, x1 = Math.max(a.x + a.width, z.x + z.width) + 12
    await q.mouse.move(x0, a.y - 12); await q.mouse.down()
    await q.mouse.move((x0 + x1) / 2, a.y + a.height / 2, { steps: 6 }); await q.mouse.move(x1, a.y + a.height + 12, { steps: 6 })
    await q.mouse.up(); await frame(); await q.waitForTimeout(200)
    const three = await q.evaluate(() => window.bento.selection.slice().sort().join())
    ok(three === 'r1,r2,r3', `${tag}: the marquee selects the three rectangles (${three})`)
    at.three = await moveLeft()
    const s3 = await strip()
    await deselect()
    await clickEl('tri')
    await q.waitForTimeout(150)
    at.path = await moveLeft()
    const sp = await strip()
    const spread = Math.max(...Object.values(at)) - Math.min(...Object.values(at))
    ok(spread <= 0.5, `${tag}: Move stays put — nothing / one shape / three shapes / a path selected (${Object.entries(at).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}; spread ${spread.toFixed(1)}px)`)
    ok(s3.shown && !s3.fold && s3.inside && s3.hits.length === 0, `${tag}: with three shapes the boolean strip is on the bar and lies over nothing (${JSON.stringify(s3)})`)
    ok(sp.shown && sp.path === 4 && sp.inside && sp.hits.length === 0, `${tag}: with a path the path bar is there and lies over nothing (${JSON.stringify(sp)})`)
    if (width === 1440) {
      ok(s3.bools === 4 && s3.combine === 0, `${tag}: there is room, so all four boolean buttons show (${s3.bools} buttons, ${s3.combine} Combine)`)
      // tab order: the contextual buttons still come straight after Comment
      await deselect(); await clickEl('r1'); await clickEl('r2', true); await clickEl('r3', true)
      await q.focus('.ed-topbar [data-cmd="comment"]'); await q.keyboard.press('Tab')
      const next = await q.evaluate(() => document.activeElement?.dataset.bool ?? document.activeElement?.className)
      ok(next === 'union', `${tag}: Tab from Comment lands on the first boolean button (${next})`)
      // a line in the selection: the strip shows greyed, saying why
      await deselect(); await clickEl('r1'); await clickEl('ln', true)
      const blocked = await q.evaluate(() => { const b = document.querySelector('.ed-topbar .ed-bool'); return { hidden: b.hidden, title: b.title, disabled: [...b.querySelectorAll('[data-bool]')].every((x) => x.disabled) } })
      ok(!blocked.hidden && blocked.disabled && blocked.title.length > 0, `${tag}: a shape and a line show the buttons disabled, with the reason (${blocked.title.slice(0, 40)}…)`)
    } else {
      ok(s3.combine === 1 && s3.bools === 0, `${tag}: no room past the group, so the booleans collapse to one Combine button (${s3.bools} buttons, ${s3.combine} Combine)`)
      // the compact form works: open it, Subtract the three into one shape
      await deselect(); await clickEl('r1'); await clickEl('r2', true); await clickEl('r3', true)
      if (await q.locator('.ed-bool-more > button').isVisible()) await q.click('.ed-bool-more > button')
      await frame()
      const rows = await q.evaluate(() => [...document.querySelectorAll('.ed-bool-more.open .ed-menu button')].filter((b) => b.getBoundingClientRect().width > 0).length)
      ok(rows === 4, `${tag}: Combine opens the four operations (${rows})`)
      if (rows) await q.locator('.ed-bool-more .ed-menu button').nth(1).click()
      await q.waitForTimeout(250)
      const left = await q.evaluate(() => window.bento.doc.slides[0].elements.filter((e) => e.bool).length)
      ok(left === 1, `${tag}: picking one combines the selection (${left} combined shape)`)
      await q.keyboard.press(`${MOD}+z`)
    }
    await c.close()
  }

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
