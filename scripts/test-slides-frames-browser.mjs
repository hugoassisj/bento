// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Auto-layout frames in the real editor.
//
//   npm run build:single --prefix slides && node scripts/test-slides-frames-browser.mjs
//
// WHAT THIS PROVES. ⇧A wraps the selection in a frame, behind it, in one undo
// step, and lays the children out (padding, gap, the axis they were spread
// on); the frame is selected and the inspector shows its Auto layout section;
// moving the frame moves its children (the solver, not a group); changing the
// gap from the inspector re-lays them; the canvas draws the padding and gap
// bands; the layer list shows the children under the frame; a clip frame
// clips an overflowing child on the canvas; deleting the frame deletes its
// children with it (a frame and its contents are one unit); undoing back
// past ⇧A restores the slide exactly. Cards built of loose shapes (a rect
// with texts lying on it) stay whole: marquee + ⇧A makes each rect its card's
// column frame and lays the cards out in a row with the spacing they had, one
// undo step; ⇧A on one such card makes its rect the frame. The auto layout
// presets: three rectangles drawn with the mouse become equal columns in one
// undo step (measured on screen), and stay equal when one is deleted or
// duplicated; Equal rows and Grid do the same on their axes; all three are in
// the element menu and the palette, and absent when nothing suits them. Two
// children of one frame selected show the sizing control and it writes to
// both; the control reads in words, glyphs only when the panel is too narrow;
// under a hugging frame the reason Fill is off shows without hovering, and
// Turn off Hug enables Fill without moving the frame.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close()) // never a live session
  await ctx.addInitScript(() => { localStorage.setItem('bento-side-view', 'layers'); localStorage.setItem('bento-offline', 'on') })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const box = (id, x, y, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w: 160, h: 100, rotation: 0, opacity: 1, fill: '#5E7699', stroke: 'none', strokeWidth: 0, radius: 0, ...extra })
  await p.evaluate((els) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]
    window.bento.loadDoc(JSON.stringify(d))
  }, [box('a', 100, 100), box('b', 400, 130), box('c', 700, 90)])
  await p.waitForTimeout(400)
  const els = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.slides[0].elements)))
  const at = (list, id) => list.find((e) => e.id === id)
  const before = JSON.stringify(await els())

  console.log('\n⇧A wraps the selection\n')
  const pick = async (id, shift = false) => {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    if (shift) await p.keyboard.down('Shift')
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(150)
    if (shift) await p.keyboard.up('Shift')
  }
  await pick('a'); await pick('b', true); await pick('c', true)
  await p.keyboard.press('Shift+A'); await p.waitForTimeout(300)
  let list = await els()
  const f = list.find((e) => e.layout)
  ok(!!f && f.shape === 'rect' && list.indexOf(f) === 0, 'a frame (a rect with layout) is inserted behind the selection')
  ok(f && ['a', 'b', 'c'].every((id) => at(list, id).parentId === f.id), 'the selection becomes its children')
  ok(f && f.layout.dir === 'row', 'children spread across become a row')
  // the gap is the spacing they had (140 between each), not a stock value
  ok(f && f.layout.gap === 140, `the gap is the spacing they had (${f?.layout.gap})`)
  ok(f && at(list, 'a').x === f.x + 16 && at(list, 'b').x === at(list, 'a').x + 160 + 140 && at(list, 'a').y === f.y + 16, 'the children are laid out: padding then gap')
  ok(f && f.w === 16 * 2 + 160 * 3 + 140 * 2, 'the frame hugs them')
  ok(await p.evaluate(() => window.bento.selection.join()) === f?.id, 'the frame is selected')
  ok(await p.locator('.ed-props .ed-section', { hasText: /^Auto layout/ }).count() === 1, 'the inspector shows the Auto layout section')
  ok(await p.locator('.ed-stage-scale .ed-frame-band').count() === 4 + 2, 'the canvas shows four padding bands and two gap bands')
  const rowIds = await p.$$eval('.ed-side-layers .ed-layers > .ed-layer', (rs) => rs.map((r) => r.dataset.id))
  ok(rowIds[0] === f?.id && rowIds.slice(1).sort().join() === 'a,b,c', 'the layer list shows the children under the frame')

  console.log('\nthe frame carries its children\n')
  await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200) // the frame is selected: a nudge moves it
  list = await els()
  const moved = at(list, f.id)
  ok(moved.x !== f.x && at(list, 'a').x === moved.x + 16 && at(list, 'a').y === moved.y + 16, `moving the frame moves its children (frame ${f.x}→${moved.x})`)
  const gapInput = p.locator('.ed-props .ed-mini input[aria-label="Gap"]')
  await gapInput.fill('40'); await gapInput.press('Enter'); await p.waitForTimeout(200)
  list = await els()
  ok(at(list, 'b').x - at(list, 'a').x === 160 + 40, 'the inspector gap re-lays the row')

  console.log('\nclip, delete, undo\n')
  await p.evaluate(() => document.activeElement?.blur()) // the gap field had focus
  await p.keyboard.press('Delete'); await p.waitForTimeout(200)
  list = await els()
  ok(!at(list, f.id) && !at(list, 'b') && !list.length, 'deleting the frame deletes what is in it (Figma); Remove auto layout is how to unwrap')
  for (let i = 0; i < 4; i++) { await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(100) }
  ok(JSON.stringify(await els()) === before, 'undoing back past ⇧A restores the slide exactly')

  // a clip frame, from a file: the overflowing child is clipped on the canvas
  await p.evaluate((els) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]
    window.bento.loadDoc(JSON.stringify(d))
  }, [box('f', 100, 100, { w: 200, layout: { dir: 'row', gap: 0, pad: [0, 0, 0, 0], clip: true } }), box('wide', 0, 0, { w: 400, parentId: 'f' })])
  await p.waitForTimeout(400)
  ok(await p.locator('.ed-stage-scale [data-el-id="wide"]').evaluate((n) => n.style.clipPath) === 'inset(0px 200px 0px 0px)', 'a clip frame clips its overflowing child on the canvas')
  console.log('\nchildren follow a dragged frame live\n')
  {
    await p.evaluate((els) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]
      window.bento.loadDoc(JSON.stringify(d))
    }, [box('g', 100, 100, { w: 900, h: 300, layout: { dir: 'row', gap: 0, pad: [20, 0, 0, 0] } }), box('k', 100, 120, { parentId: 'g' })])
    await p.waitForTimeout(400)
    const gb = await p.locator('.ed-stage-scale [data-el-id="g"]').boundingBox()
    // an empty stretch of the frame, away from its child
    const x0 = gb.x + gb.width * 0.7, y0 = gb.y + gb.height * 0.6
    await p.mouse.click(x0, y0); await p.waitForTimeout(200)
    await p.mouse.move(x0, y0); await p.mouse.down()
    for (let i = 1; i <= 8; i++) await p.mouse.move(x0 + i * 10, y0 + i * 5)
    const mid = await p.evaluate(() => {
      const q = (id) => document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`)
      const band = document.querySelector('.ed-stage-scale .ed-frame-band[data-axis="y"]')
      return { gx: parseFloat(q('g').style.left), gy: parseFloat(q('g').style.top), kx: parseFloat(q('k').style.left), ky: parseFloat(q('k').style.top),
        bx: band ? parseFloat(band.style.left) : NaN, by: band ? parseFloat(band.style.top) : NaN }
    })
    ok(Math.abs(mid.bx - mid.gx) < 0.01 && Math.abs(mid.by - mid.gy) < 0.01, `mid-drag, the padding band moves with the frame (band ${mid.bx},${mid.by})`)
    ok(mid.gx !== 100 && Math.abs(mid.kx - mid.gx) < 0.01 && Math.abs(mid.ky - mid.gy - 20) < 0.01, `mid-drag, the child is already where the frame will put it (frame ${mid.gx},${mid.gy}; child ${mid.kx},${mid.ky})`)
    await p.mouse.up(); await p.waitForTimeout(200)
    const after = await els()
    ok(at(after, 'k').x === at(after, 'g').x && at(after, 'g').x !== 100, 'on release the layout lands it there in the model')
  }

  console.log('\nmarquee + ⇧A keeps loose-shape cards whole\n')
  {
    // three cards built loose: a rounded rect with a title and a body lying on it
    const txt = (id, x, y, w, h, html) => ({ id, type: 'text', x, y, w, h, rotation: 0, opacity: 1, html, fontSize: 18, fontFamily: 'system-ui', fontWeight: 400, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.2 })
    const looseCard = (n, x) => [
      box(`c${n}`, x, 200, { w: 200, h: 240, radius: 16, fill: '#E8EEF6' }),
      txt(`t${n}`, x + 20, 220, 160, 40, `Title ${n}`),
      txt(`b${n}`, x + 20, 280, 160, 100, `Body ${n}`),
    ]
    await p.evaluate((els) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]
      window.bento.loadDoc(JSON.stringify(d))
    }, [...looseCard(1, 100), ...looseCard(2, 400), ...looseCard(3, 700)])
    await p.waitForTimeout(400)
    const start = JSON.stringify(await els())
    const toClient = (x, y) => p.evaluate(([x, y]) => { const r = document.querySelector('.ed-stage-scale').getBoundingClientRect(); const k = r.width / window.bento.doc.size.width; return [r.left + x * k, r.top + y * k] }, [x, y])
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    const [ax, ay] = await toClient(60, 150), [bx, by] = await toClient(960, 500)
    await p.mouse.move(ax, ay); await p.mouse.down()
    for (let i = 1; i <= 12; i++) await p.mouse.move(ax + (bx - ax) * i / 12, ay + (by - ay) * i / 12)
    await p.mouse.up(); await p.waitForTimeout(250)
    ok((await p.evaluate(() => window.bento.selection.length)) === 9, `the marquee takes all nine loose elements (${await p.evaluate(() => window.bento.selection.length)})`)
    await p.keyboard.press('Shift+A'); await p.waitForTimeout(300)
    let list = await els()
    const row = list.find((e) => e.layout && !e.id.startsWith('c'))
    ok(!!row && row.layout.dir === 'row', 'one new frame, a row')
    ok(row && ['c1', 'c2', 'c3'].every((id) => at(list, id).parentId === row.id) && list.filter((e) => e.parentId === row.id).length === 3, `the row holds the three cards, not nine elements (${list.filter((e) => e.parentId === row?.id).map((e) => e.id).join(',')})`)
    ok(['c1', 'c2', 'c3'].every((id) => at(list, id).layout?.dir === 'col'), 'each rect became its card\'s column frame (its paint kept)')
    ok([1, 2, 3].every((n) => at(list, `t${n}`).parentId === `c${n}` && at(list, `b${n}`).parentId === `c${n}`), 'each card holds its own title and body')
    ok(row?.layout.gap === 100 && at(list, 'c2').x - (at(list, 'c1').x + at(list, 'c1').w) === 100, `the cards keep the spacing they had (gap ${row?.layout.gap})`)
    const c1 = at(list, 'c1'), t1 = at(list, 't1'), b1 = at(list, 'b1')
    ok(t1.x - c1.x === 20 && t1.y - c1.y === 20 && b1.y - (t1.y + t1.h) === 20 && Math.abs(c1.w - 200) < 1 && Math.abs(c1.h - 240) < 2, `a card keeps its look: title and body where they sat on it (card ${c1.w}×${c1.h}, title +${t1.x - c1.x},+${t1.y - c1.y})`)
    ok(await p.evaluate(() => window.bento.selection.join()) === row?.id, 'the row is selected')
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(200)
    ok(JSON.stringify(await els()) === start, 'one ⌘Z gives the nine loose elements back exactly')

    // one card alone: the rect is the frame, nothing is wrapped round it
    const row1 = async (id, add) => { await p.evaluate(([id, add]) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: add })), [id, add]); await p.waitForTimeout(150) }
    await row1('c1', false); await row1('t1', true); await row1('b1', true)
    ok((await p.evaluate(() => window.bento.selection.slice().sort().join())) === 'b1,c1,t1', 'one card picked from Layers')
    await p.keyboard.press('Shift+A'); await p.waitForTimeout(300)
    list = await els()
    ok(list.filter((e) => e.layout).map((e) => e.id).join() === 'c1' && at(list, 't1').parentId === 'c1' && at(list, 'b1').parentId === 'c1', `⇧A on one loose card makes its rect the card frame (${list.filter((e) => e.layout).map((e) => e.id).join()})`)
    ok(await p.evaluate(() => window.bento.selection.join()) === 'c1', 'and selects it')
  }

  console.log('\nauto layout presets\n')
  {
    const load = async (els) => {
      await p.evaluate((els) => {
        const d = JSON.parse(JSON.stringify(window.bento.doc))
        d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]
        window.bento.loadDoc(JSON.stringify(d))
      }, els)
      await p.waitForTimeout(400)
    }
    const toClient = (x, y) => p.evaluate(([x, y]) => { const r = document.querySelector('.ed-stage-scale').getBoundingClientRect(); const k = r.width / window.bento.doc.size.width; return [r.left + x * k, r.top + y * k] }, [x, y])
    const drag = async (x0, y0, x1, y1) => {
      const [a, b] = await toClient(x0, y0), [c, d] = await toClient(x1, y1)
      await p.mouse.move(a, b); await p.mouse.down()
      for (let i = 1; i <= 8; i++) await p.mouse.move(a + (c - a) * i / 8, b + (d - b) * i / 8)
      await p.mouse.up(); await p.waitForTimeout(200)
    }
    const palette = async (q) => {
      await p.keyboard.press('Control+k'); await p.waitForTimeout(150)
      await p.keyboard.type(q); await p.waitForTimeout(100)
      const shown = await p.$$eval('.ed-cmdk-list li', (ls) => ls.map((l) => l.dataset.cmd))
      await p.keyboard.press(shown[0]?.startsWith('layout-') ? 'Enter' : 'Escape'); await p.waitForTimeout(300)
      return shown
    }
    const frameNow = () => p.evaluate(() => { const els = window.bento.doc.slides[0].elements; const f = els.find((e) => e.layout); return f && JSON.parse(JSON.stringify(f)) })
    // children of the frame as they stand ON SCREEN
    const onScreen = () => p.evaluate(() => {
      const els = window.bento.doc.slides[0].elements
      const f = els.find((e) => e.layout)
      return els.filter((e) => e.parentId === f?.id).map((e) => {
        const r = document.querySelector(`.ed-stage-scale [data-el-id="${e.id}"]`).getBoundingClientRect()
        return { id: e.id, x: r.left, y: r.top, w: r.width, h: r.height, sizing: e.sizing }
      })
    })
    const same = (xs) => xs.every((v) => Math.abs(v - xs[0]) <= 1)
    const gaps = (ks, P, M) => ks.slice(1).map((k, i) => k[P] - (ks[i][P] + ks[i][M]))
    const fmt = (xs) => xs.map((v) => v.toFixed(1)).join(', ')

    // three rectangles of different widths, drawn with the mouse in a rough row
    // drawn low on the slide: the last section's control box outlives the
    // loadDoc where its card stood (y 200–440) and would take a drag there
    await p.evaluate(() => document.activeElement?.blur()) // a layer row had focus: Esc and R must reach the canvas
    for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(80) }
    await load([])
    for (const [x, w, y] of [[100, 160, 480], [380, 240, 490], [740, 120, 476]]) {
      await p.keyboard.press('Escape'); await p.keyboard.press('r'); await p.waitForTimeout(100)
      await drag(x, y, x + w, y + 110)
    }
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    await drag(40, 450, 1000, 640) // marquee
    const drawn = JSON.stringify(await els())
    ok((await p.evaluate(() => window.bento.selection.length)) === 3, `three drawn rectangles, marquee-selected (${(await els()).map((e) => `${e.x},${e.w}`).join(' ')})`)
    const one = await p.evaluate(() => window.bento.selection[0])
    const shown = await palette('Equal columns')
    ok(shown[0] === 'layout-equal-columns', `⌘K finds Equal columns (${shown.slice(0, 3).join(', ')})`)
    let f = await frameNow()
    let ks = (await onScreen()).sort((a, b) => a.x - b.x)
    ok(!!f && f.layout.dir === 'row' && !f.layout.hug && ks.length === 3, 'one new frame, a row that does not hug, holding the three')
    ok(same(ks.map((k) => k.w)), `on screen the three have one width (${fmt(ks.map((k) => k.w))})`)
    ok(same(gaps(ks, 'x', 'w')) && gaps(ks, 'x', 'w')[0] > 0, `and equal gaps (${fmt(gaps(ks, 'x', 'w'))})`)
    ok(ks.every((k) => k.sizing?.w === 'fill'), 'every child is set to fill its share')
    // every finding above info, and out-of-canvas at ANY severity (a shape off the slide is only info)
    const badFindings = () => p.evaluate(() => window.bento.validate().findings.filter((x) => x.severity !== 'info' || x.code === 'out-of-canvas').map((x) => `${x.code}@${x.path}`))
    const findings = await badFindings()
    ok(!findings.length, `validate() reports nothing on the result, not even out-of-canvas (${findings.join(', ')})`)
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250)
    ok(JSON.stringify(await els()) === drawn, 'one ⌘Z gives the three loose rectangles back exactly')
    await p.evaluate(() => window.bento.redo()); await p.waitForTimeout(250)

    console.log('\nthe columns stay equal\n')
    const pickId = async (id, shift = false) => {
      await p.evaluate(([id, add]) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: add })), [id, shift])
      await p.waitForTimeout(200)
    }
    ks = (await onScreen()).sort((a, b) => a.x - b.x)
    await pickId(ks[1].id)
    await p.keyboard.press('Delete'); await p.waitForTimeout(300)
    let left = (await onScreen()).sort((a, b) => a.x - b.x)
    ok(left.length === 2 && same(left.map((k) => k.w)) && left[0].w > ks[0].w * 1.3, `deleting one: the other two share the width (${fmt(left.map((k) => k.w))}, was ${ks[0].w.toFixed(1)})`)
    await pickId(left[0].id)
    await p.keyboard.press('Control+d'); await p.waitForTimeout(300)
    await p.keyboard.press('Control+d'); await p.waitForTimeout(300)
    left = (await onScreen()).sort((a, b) => a.x - b.x)
    ok(left.length === 4 && same(left.map((k) => k.w)) && same(gaps(left, 'x', 'w')), `duplicating one twice: four equal widths, equal gaps (${fmt(left.map((k) => k.w))})`)

    console.log('\nsizing on two children of one frame\n')
    await pickId(left[0].id); await pickId(left[1].id, true)
    const segs = await p.$$eval('.ed-props .ed-seg[data-axis]', (ss) => ss.map((s) => s.dataset.axis))
    ok(segs.join() === 'w,h', `two children selected: the sizing control shows (${segs.join()})`)
    const wSeg = p.locator('.ed-props .ed-seg[data-axis="w"]')
    ok((await wSeg.locator('[aria-checked="true"]').getAttribute('data-value')) === 'fill', 'both fill: Fill is pressed')
    await wSeg.locator('[data-value="fixed"]').click(); await p.waitForTimeout(250)
    let after = await onScreen()
    ok(after.filter((k) => k.id === left[0].id || k.id === left[1].id).every((k) => !k.sizing) && after.filter((k) => k.sizing?.w === 'fill').length === 2, 'Fixed writes to both, and only to them')
    ok((await p.$$eval('.ed-props .ed-seg[data-axis="w"] [aria-checked="true"]', (b) => b.map((x) => x.dataset.value))).join() === 'fixed', 'the control now reads Fixed')
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250)
    after = await onScreen()
    ok(after.every((k) => k.sizing?.w === 'fill'), 'one ⌘Z gives both back their Fill')
    // one fill, one fixed: mixed, nothing pressed
    await pickId(left[0].id)
    await p.locator('.ed-props .ed-seg[data-axis="w"] [data-value="fixed"]').click(); await p.waitForTimeout(250)
    await pickId(left[0].id); await pickId(left[2].id, true)
    ok((await p.locator('.ed-props .ed-seg[data-axis="w"] [aria-checked="true"]').count()) === 0, 'one Fixed and one Fill selected: the control shows them mixed, nothing pressed')
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250)
    await pickId(left[0].id); await pickId(left[1].id, true)

    console.log('\nwords, glyphs when narrow\n')
    const words = () => p.$$eval('.ed-props .ed-seg[data-axis="w"] button', (bs) => bs.map((b) => {
      const w = b.querySelector('.ed-seg-word'), g = b.querySelector('svg')
      return { v: b.dataset.value, label: b.getAttribute('aria-label'), tip: b.title || b.dataset.hint /* the hint borrows the title under the pointer */, word: w?.getBoundingClientRect().width > 0 ? w.textContent : '', glyph: g?.getBoundingClientRect().width > 0 }
    }))
    // the accessible name as the browser computes it (role + name), not an attribute read back
    const named = (name) => p.locator('.ed-props .ed-seg[data-axis="w"]').getByRole('radio', { name, exact: true }).count()
    let w = await words()
    ok(w.map((b) => b.word).join(' / ') === 'Fixed / Fill space' && w.every((b) => !b.glyph), `at the default panel width the control reads in words (${w.map((b) => b.word).join(' / ')})`)
    ok(await named('Fixed') === 1 && await named('Fill space') === 1 && w.every((b) => b.label === null), 'each button is named by the word it shows (label in name)')
    ok(w.map((b) => b.tip).join(' / ') === 'Fixed / Fill container', `the long forms are the tooltips (${w.map((b) => b.tip).join(' / ')})`)
    const fitsRow = await p.$eval('.ed-props .ed-seg[data-axis="w"] button:last-child', (b) => b.scrollWidth <= b.clientWidth)
    ok(fitsRow, 'no word is cut off')
    await p.evaluate(() => document.querySelector('.ed-props').style.setProperty('--panew', '190px')); await p.waitForTimeout(300)
    w = await words()
    ok(w.every((b) => b.word && !b.glyph) && await p.$eval('.ed-props .ed-seg[data-axis="w"]', (s) => s.parentElement.classList.contains('ed-row-wide')), 'at the narrowest the panel drags to, the words take a line of their own under the caption')
    // narrower than any English word list fits (a long translation does this at real widths)
    await p.evaluate(() => document.querySelector('.ed-props').style.setProperty('--panew', '110px')); await p.waitForTimeout(300)
    w = await words()
    ok(w.every((b) => b.glyph && !b.word) && await named('Fixed') === 1 && await named('Fill container') === 1, `too narrow: glyphs only, named by the long words (${JSON.stringify(w.map((b) => [b.word, b.glyph, b.label]))})`)
    await p.evaluate(() => document.querySelector('.ed-props').style.removeProperty('--panew')); await p.waitForTimeout(300)
    w = await words()
    ok(w.every((b) => b.word && !b.glyph) && await named('Fill space') === 1, 'wide again: words again, named by them')

    console.log('\nequal rows, grid, and where they are offered\n')
    const box2 = (id, x, y, w, h) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, rotation: 0, opacity: 1, fill: '#5E7699', stroke: 'none', strokeWidth: 0, radius: 0 })
    await load([box2('a', 100, 100, 150, 90), box2('b', 420, 110, 200, 80), box2('c', 740, 120, 120, 100)])
    await pickId('a')
    ok(!(await palette('Equal rows')).some((c) => c?.startsWith('layout-')), 'one loose element: the palette does not offer the presets')
    {
      const b = await p.locator('.ed-stage-scale [data-el-id="a"]').boundingBox()
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await p.waitForTimeout(200)
      ok((await p.locator('[data-cmd^="layout-"]').count()) === 0, 'nor does its element menu')
      await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    }
    {
      // a frame's child with a loose element: different places, nothing to make equal
      await load([{ ...box2('f', 100, 100, 400, 200), layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }, { ...box2('k', 110, 110, 100, 100), parentId: 'f' }, box2('z', 700, 400, 150, 90)])
      await pickId('k'); await pickId('z', true)
      ok((await p.evaluate(() => window.bento.selection.slice().sort().join())) === 'k,z', 'a frame child and a loose element selected')
      ok(!(await palette('Equal columns')).some((c) => c?.startsWith('layout-')), 'different parents: the palette does not offer the presets')
      const b = await p.locator('.ed-stage-scale [data-el-id="z"]').boundingBox()
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await p.waitForTimeout(200)
      ok((await p.locator('[data-cmd^="layout-"]').count()) === 0, 'nor does the element menu')
      await p.keyboard.press('Escape'); await p.waitForTimeout(100)
      ok((await els()).find((e) => e.id === 'k').parentId === 'f', 'the child stays in its frame')
      await load([box2('a', 100, 100, 150, 90), box2('b', 420, 110, 200, 80), box2('c', 740, 120, 120, 100)])
    }
    await pickId('a'); await pickId('b', true); await pickId('c', true)
    {
      const b = await p.locator('.ed-stage-scale [data-el-id="a"]').boundingBox()
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await p.waitForTimeout(200)
      const items = await p.$$eval('[data-cmd^="layout-"]', (xs) => xs.map((x) => `${x.dataset.cmd}:${x.textContent.trim()}`))
      ok(items.join() === 'layout-equal-columns:Equal columns,layout-equal-rows:Equal rows,layout-grid:Grid', `three selected: the element menu offers all three (${items.join()})`)
      await p.locator('[data-cmd="layout-equal-rows"]').click(); await p.waitForTimeout(300)
    }
    f = await frameNow()
    ks = (await onScreen()).sort((a, b) => a.y - b.y)
    ok(f?.layout.dir === 'col' && !f.layout.hug && ks.map((k) => k.id).join() === 'a,b,c', `Equal rows: a column, in the order they stood (${ks.map((k) => k.id).join()})`)
    ok(same(ks.map((k) => k.h)) && same(ks.map((k) => k.w)) && same(gaps(ks, 'y', 'h')), `three equal heights, one width, equal gaps (${fmt(ks.map((k) => k.h))})`)
    await pickId(f.id)
    ok((await p.locator('.ed-props .ed-section[data-key="Auto layout"] .ed-sec-menu').count()) === 1, 'the frame\'s Auto layout header carries the presets menu')
    await p.locator('.ed-props .ed-section[data-key="Auto layout"] .ed-sec-menu').click(); await p.waitForTimeout(200)
    await p.locator('[data-cmd="layout-grid"]').click(); await p.waitForTimeout(300)
    f = await frameNow()
    ks = await onScreen()
    ok(f?.layout.dir === 'grid' && f.layout.cols === 2 && same(ks.map((k) => k.w)) && same(ks.map((k) => k.h)), `Grid on the frame: two columns of equal cells (${fmt(ks.map((k) => k.w))})`)
    const g0 = ks.find((k) => k.id === 'a'), g1 = ks.find((k) => k.id === 'b'), g2 = ks.find((k) => k.id === 'c')
    ok(Math.abs(g0.y - g1.y) < 1 && g2.y > g0.y + g0.h && Math.abs(g2.x - g0.x) < 1, 'filled row by row in their order')
    await pickId('b'); await p.keyboard.press('Delete'); await p.waitForTimeout(300)
    ks = await onScreen()
    ok(ks.length === 2 && same(ks.map((k) => k.w)) && Math.abs(ks[0].y - ks[1].y) < 1, 'deleting one: the rest close up into equal cells')

    console.log('\nswitching presets keeps the frame put, on the slide\n')
    {
      const xywh = (e) => `${e.x},${e.y} ${e.w}×${e.h}`
      const onSlide = (e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 1280 && e.y + e.h <= 720
      // a fresh Grid on three loose rectangles low on the slide: two rows at their own heights, on the slide
      await load([box2('a', 100, 420, 160, 120), box2('b', 352, 430, 240, 100), box2('c', 684, 420, 120, 110)])
      await pickId('a'); await pickId('b', true); await pickId('c', true)
      const ran = await palette('layout grid')
      const gridF = await frameNow()
      const cells = (await els()).filter((e) => e.parentId === gridF?.id)
      ok(ran[0] === 'layout-grid' && gridF?.layout.dir === 'grid' && onSlide(gridF) && cells.every((k) => k.h >= 100 && onSlide(k)), `Grid on a low row: cells keep their height, the frame stays on the slide (${gridF && xywh(gridF)}; cells ${cells.map((k) => k.h).join(', ')})`)
      // three loose rectangles low on the slide (y ≈ 420): Equal rows grows the frame, upward, inside the slide
      await load([box2('a', 100, 420, 160, 120), box2('b', 352, 430, 240, 100), box2('c', 684, 420, 120, 110)])
      await pickId('a'); await pickId('b', true); await pickId('c', true)
      await palette('Equal rows')
      const first = await frameNow()
      ok(first && onSlide(first) && first.layout.dir === 'col', `Equal rows on a low row: the frame grows but stays on the slide (${first && xywh(first)})`)
      let bad = await badFindings()
      ok(!bad.length, `no out-of-canvas (${bad.join(', ')})`)
      await pickId(first.id)
      const trail = []
      for (const cmd of ['layout-grid', 'layout-equal-columns', 'layout-grid', 'layout-equal-rows', 'layout-equal-columns']) {
        await p.locator('.ed-props .ed-section[data-key="Auto layout"] .ed-sec-menu').click(); await p.waitForTimeout(200)
        await p.locator(`[data-cmd="${cmd}"]`).click(); await p.waitForTimeout(300)
        trail.push(xywh(await frameNow()))
      }
      ok(trail.every((t) => t === xywh(first)), `five switches from the header menu leave the frame where it was (${xywh(first)}; ${[...new Set(trail)].join(' | ')})`)
      bad = await badFindings()
      ok(!bad.length && (await els()).every(onSlide), `everything still on the slide, no out-of-canvas (${bad.join(', ')})`)
    }

    console.log('\nwhy Fill is off, and Turn off Hug\n')
    await load([box2('a', 100, 100, 150, 90), box2('b', 420, 110, 200, 80), box2('c', 740, 120, 120, 100)])
    await pickId('a'); await pickId('b', true); await pickId('c', true)
    await p.keyboard.press('Shift+A'); await p.waitForTimeout(300)
    const hugged = await frameNow()
    await pickId('a')
    const why = p.locator('.ed-props .ed-fill-why')
    ok(hugged.layout.hug && await why.isVisible(), 'under a hugging frame the reason shows without hovering')
    ok((await why.textContent()).startsWith('The frame hugs its contents, so there is nothing to fill.'), 'it says why in a sentence')
    ok(await p.locator('.ed-props .ed-seg[data-axis="w"] [data-value="fill"]').isDisabled(), 'and Fill is off')
    await why.locator('button', { hasText: 'Turn off Hug' }).click(); await p.waitForTimeout(300)
    const freed = await frameNow()
    ok(!freed.layout.hug && ['x', 'y', 'w', 'h'].every((k) => freed[k] === hugged[k]), `Turn off Hug: the frame stops hugging and does not move (${hugged.x},${hugged.y} ${hugged.w}×${hugged.h})`)
    ok(!(await p.locator('.ed-props .ed-seg[data-axis="w"] [data-value="fill"]').isDisabled()) && (await why.count()) === 0, 'Fill is on, the hint is gone')
    ok(await p.evaluate(() => document.activeElement?.matches('.ed-props .ed-seg[data-axis="w"] [data-value="fill"]')), 'focus moves to the Fill it unlocked, not to the page')
    await p.locator('.ed-props .ed-seg[data-axis="w"] [data-value="fill"]').click(); await p.waitForTimeout(300)
    ok((await els()).find((e) => e.id === 'a').sizing?.w === 'fill', 'and pressing Fill now takes')
  }
  ok(!errors.length, `no page error${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
