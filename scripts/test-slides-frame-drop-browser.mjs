// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Drag into a frame — from the Layers list and on the canvas.
//
//   npm run build:single --prefix slides && node scripts/test-slides-frame-drop-browser.mjs
//
// WHAT THIS PROVES (Figma's and Penpot's rules for auto-layout frames):
//   Layers: a row dropped on the MIDDLE of a frame row goes inside that frame
//   (indented under it, laid out by it, one undo step); the top and bottom of
//   a row still mean above and below; a frame never goes inside its own child;
//   a child dropped beside a top-level row comes out of its frame.
//   Canvas: dragging an element over an auto-layout frame outlines that frame
//   and shows the slot bar; the drop puts it inside at that slot (one undo
//   step). ⌘/Ctrl held while dragging moves it over the frame instead; a
//   locked frame takes nothing; a child dragged past its frame's edge still
//   comes out.
//   Drawing: whatever a box tool (F R O T) draws with its start point inside
//   an auto-layout frame joins the innermost visible, unlocked frame there —
//   whatever is selected — and the frame lays it out; the frame is outlined
//   while the gesture lasts (gone on release and on Esc, which also draws
//   nothing). Alt held at the press draws on top instead. One undo takes the
//   drawn element out and the layout back. An empty frame says "Draw or drop
//   here" on the editor canvas only: never in the model, the thumbnails, the
//   show or print.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const run = async (fn) => { try { await fn() } catch (e) { ok(false, `threw: ${String(e.message).split('\n')[0]}`) } }
const rect = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, rotation: 0, opacity: 1, fill: '#dddddd', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra })
const deck = () => [
  rect('row', 100, 120, 700, 190, { fill: '#f4f4f4', layout: { dir: 'row', gap: 20, pad: [20, 20, 20, 20] } }),
  rect('a', 120, 140, 200, 150, { parentId: 'row' }), rect('b', 340, 140, 200, 150, { parentId: 'row' }),
  rect('x', 120, 520, 120, 100, { fill: '#ff6666' }),
  rect('lk', 900, 120, 300, 190, { fill: '#eeeeff', locked: true, layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
]

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'layers') } catch {} })
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
  const starter = await p.evaluate(() => JSON.stringify(window.bento.doc))
  const load = async (elements = deck()) => {
    await p.evaluate((els) => { const d = JSON.parse(JSON.stringify(window.bento.doc)); d.slides = [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: els }]; window.bento.loadDoc(JSON.stringify(d)) }, elements)
    await p.waitForTimeout(400)
  }
  const els = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.slides[0].elements)))
  const el = async (id) => (await els()).find((e) => e.id === id)
  const kids = async (f) => (await els()).filter((e) => e.parentId === f).sort((m, n) => m.x - n.x).map((e) => e.id).join('')
  const undo = async () => { await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250) }
  const row = (id) => p.locator(`.ed-layer[data-id="${id}"]`)
  const pick = async (id) => { await p.evaluate((id) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true })), id); await p.waitForTimeout(250) }
  const node = (id) => p.locator(`.ed-stage-scale [data-el-id="${id}"]`).first()
  // a Layers drop at a fraction of the target row's height (0.5 = its middle)
  const layerDrop = async (from, to, at) => {
    const b = await row(to).boundingBox()
    await row(from).dragTo(row(to), { targetPosition: { x: b.width / 2, y: b.height * at } })
    await p.waitForTimeout(300)
  }
  // a canvas drag of the element's centre to a slide-space point, in small steps
  const canvasDrag = async (id, sx, sy, hold = false) => {
    const a = await node(id).boundingBox()
    const host = await p.locator('.ed-stage-scale').boundingBox()
    const k = await p.evaluate(() => { const h = document.querySelector('.ed-stage-scale'); return h.getBoundingClientRect().width / window.bento.doc.size.width })
    const x0 = a.x + a.width / 2, y0 = a.y + a.height / 2, x1 = host.x + sx * k, y1 = host.y + sy * k
    await p.mouse.move(x0, y0); await p.mouse.down(); await p.waitForTimeout(80)
    if (hold) await p.keyboard.down(MOD)
    let mid = null
    for (let i = 1; i <= 14; i++) {
      await p.mouse.move(x0 + (x1 - x0) * i / 14, y0 + (y1 - y0) * i / 14, { steps: 2 }); await p.waitForTimeout(16)
      if (i === 14) mid = await p.evaluate(() => ({ frame: document.querySelector('.ed-stage-scale .ed-drop-frame')?.dataset.frame ?? null, bar: document.querySelector('.ed-stage-scale .ed-slot-bar')?.dataset.slot ?? null }))
    }
    await p.mouse.up()
    if (hold) await p.keyboard.up(MOD)
    await p.waitForTimeout(350)
    return mid
  }

  console.log('\nLayers\n')
  await run(async () => {
    await load()
    await layerDrop('x', 'row', 0.5)
    ok((await el('x')).parentId === 'row', 'a row dropped on the middle of a frame row goes inside the frame')
    ok(await row('x').evaluate((r) => parseFloat(getComputedStyle(r).paddingInlineStart) > 8), '…and lists indented under it')
    ok((await kids('row')) === 'abx' && (await el('x')).y === 140, `…and the frame lays it out at the end of the row (${await kids('row')}, y ${(await el('x')).y})`)
    await undo()
    ok(!(await el('x')).parentId && (await el('x')).y === 520, 'one undo puts it back out where it was')
  })
  await run(async () => {
    await load()
    const before = (await els()).map((e) => e.id).join()
    await layerDrop('x', 'lk', 0.1)
    const after = (await els()).map((e) => e.id).join()
    ok(!(await el('x')).parentId && after !== before, `the top of a row still means above it — a reorder, not inside (${after})`)
  })
  await run(async () => {
    await load()
    await layerDrop('row', 'a', 0.5)
    ok(!(await el('row')).parentId, 'a frame never goes inside its own child')
  })
  await run(async () => {
    await load()
    await layerDrop('a', 'x', 0.1)
    ok(!(await el('a')).parentId && (await kids('row')) === 'b', `a child dropped beside a top-level row comes out of its frame (${await kids('row')})`)
  })
  await run(async () => {
    await load()
    await layerDrop('x', 'lk', 0.5)
    ok(!(await el('x')).parentId, 'a locked frame takes nothing')
  })

  console.log('\ncanvas\n')
  await run(async () => {
    await load()
    await pick('x')
    const mid = await canvasDrag('x', 330, 215)
    ok(mid?.frame === 'row' && mid?.bar === '1', `mid-drag the frame is outlined as the target and the bar shows slot 1 (${JSON.stringify(mid)})`)
    ok((await el('x')).parentId === 'row' && (await kids('row')) === 'axb', `the drop puts it inside, at that slot (${await kids('row')})`)
    ok(!(await p.evaluate(() => !!document.querySelector('.ed-drop-frame, .ed-slot-bar'))), '…and the outline and bar go')
    await undo()
    ok(!(await el('x')).parentId && (await kids('row')) === 'ab', 'one undo takes it back out')
  })
  await run(async () => {
    await load()
    await pick('x')
    const mid = await canvasDrag('x', 330, 215, true)
    const x = await el('x')
    ok(!mid?.frame && !x.parentId && x.y < 400, `${MOD} held while dragging moves it over the frame without dropping it in (y ${x.y})`)
  })
  await run(async () => {
    await load()
    await pick('x')
    const mid = await canvasDrag('x', 1050, 215)
    const x = await el('x')
    ok(!mid?.frame && !x.parentId && x.x > 800, `a locked frame takes nothing on the canvas either — it just moves over it (x ${x.x})`)
  })
  await run(async () => {
    await load()
    await pick('a')
    await canvasDrag('a', 300, 700)
    ok(!(await el('a')).parentId && (await kids('row')) === 'b', 'a child dragged past its frame\'s edge still comes out')
  })
  console.log('\ndrawing into a frame\n')
  const stage = async () => {
    const host = await p.locator('.ed-stage-scale').boundingBox()
    const k = await p.evaluate(() => document.querySelector('.ed-stage-scale').getBoundingClientRect().width / window.bento.doc.size.width)
    return (x, y) => [host.x + x * k, host.y + y * k]
  }
  // arm a tool by its key, then drag on the slide from (x0,y0) to (x1,y1) in slide px;
  // `alt` holds Alt from the press; `esc` presses Escape mid-drag; `mid` reads the outline before release
  const draw = async (key, x0, y0, x1, y1, { alt = false, esc = false } = {}) => {
    await p.evaluate(() => document.activeElement?.blur?.())
    await p.keyboard.press(key)
    await p.waitForTimeout(60)
    const at = await stage()
    await p.mouse.move(...at(x0, y0))
    if (alt) await p.keyboard.down('Alt')
    await p.mouse.down()
    let mid = null
    for (let i = 1; i <= 8; i++) {
      await p.mouse.move(...at(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)); await p.waitForTimeout(16)
    }
    mid = await p.evaluate(() => [...document.querySelectorAll('.ed-stage-scale .ed-drop-frame')].map((n) => n.dataset.frame).join() || null)
    if (esc) { await p.keyboard.press('Escape'); await p.waitForTimeout(60) }
    const afterEsc = esc ? await p.evaluate(() => !!document.querySelector('.ed-stage-scale .ed-drop-frame')) : null
    await p.mouse.up()
    if (alt) await p.keyboard.up('Alt')
    await p.waitForTimeout(300)
    const after = await p.evaluate(() => !!document.querySelector('.ed-stage-scale .ed-drop-frame'))
    return { mid, afterEsc, after }
  }
  const newest = async (before) => (await els()).filter((e) => !before.includes(e.id))
  const ids = async () => (await els()).map((e) => e.id)
  const screenBox = (id) => p.evaluate((id) => { const r = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom } }, id)
  // a drawn box lands within a pixel of the slide point (screen px round to slide px)
  const near = (v, w) => Math.abs(v - w) <= 1.5
  const overlap = (m, n) => m.l < n.r - 0.5 && n.l < m.r - 0.5 && m.t < n.b - 0.5 && n.t < m.b - 0.5
  const hints = () => p.evaluate(() => [...document.querySelectorAll('.ed-frame-hint')].map((n) => ({ frame: n.dataset.frame, text: n.textContent, inStage: !!n.closest('.ed-stage-scale'), shown: n.getBoundingClientRect().width > 0 })))
  await run(async () => {
    const tips = await p.evaluate(() => ['tool-frame', 'tool-rect', 'tool-ellipse', 'insert-text'].map((c) => document.querySelector(`.ed-topbar [data-cmd="${c}"]`)?.title ?? ''))
    ok(tips.every((x) => /\n(Alt|Option): draw on top of a frame instead of inside it \([FROT]\)$/.test(x)), `F, R, O and T say in their tooltips how to draw over a frame without nesting, the key still last (${tips.map((x) => x.split('\n')[1]).join(' | ')})`)
    // the hint draws the key as a chip only while the title ENDS in "(F)" (hints.ts SHORTCUT)
    const b = await p.locator('.ed-topbar [data-cmd="tool-frame"]').boundingBox()
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await p.waitForFunction(() => { const t = document.querySelector('.ed-tip'); return t && !t.hidden }, null, { timeout: 3000 }).catch(() => {})
    const tip = await p.evaluate(() => { const t = document.querySelector('.ed-tip'); return { kbd: [...(t?.querySelectorAll('kbd') ?? [])].map((k) => k.textContent).join(), text: t?.textContent ?? '' } })
    ok(tip.kbd === 'F' && /draw on top of a frame/.test(tip.text) && !tip.text.includes('(F)'), `the Frame tool's hint shows the Alt line and F as a key chip (${JSON.stringify(tip)})`)
    await p.mouse.move(700, 600)
  })
  await run(async () => {
    await load([])
    let before = await ids()
    await draw('f', 200, 150, 800, 450)
    const [frame] = await newest(before)
    ok(!!frame?.layout, 'F draws an auto-layout frame')
    let h = await hints()
    ok(h.length === 1 && h[0].frame === frame?.id && h[0].inStage && h[0].shown && /Draw or drop here/.test(h[0].text), `the empty frame shows "Draw or drop here" on the editor canvas (${JSON.stringify(h)})`)
    ok(!JSON.stringify(await p.evaluate(() => window.bento.doc)).includes('Draw or drop here'), '…and the hint is not in the document')
    ok(!(await p.evaluate(() => [...document.querySelectorAll('.ed-frame-hint')].some((n) => !n.closest('.ed-stage-scale') || n.closest('.ed-thumb, .ed-thumbs, .ed-sidebar')))), '…nor in the slide thumbnails')
    before = await ids()
    const first = await draw('r', 250, 200, 350, 300)
    const [r1] = await newest(before)
    ok(r1?.parentId === frame.id, `R drawn inside the selected frame joins it (${r1?.parentId})`)
    ok(first.mid === frame.id && !first.after, `while drawing the frame is outlined as the target, and the outline goes on release (${JSON.stringify(first)})`)
    ok((await hints()).length === 0, 'a frame with a child shows no hint')
    const r1box = (await el(r1.id))
    before = await ids()
    const second = await draw('r', 450, 200, 550, 300)
    const [r2] = await newest(before)
    ok(r2?.parentId === frame.id, `R drawn inside the frame again, with its first child selected, joins it too (${r2?.parentId ?? 'no parentId'})`)
    ok(second.mid === frame.id, `…outlining the frame while drawing (${second.mid})`)
    const kidsNow = (await els()).filter((e) => e.parentId === frame.id)
    const b1 = await screenBox(r1.id), b2 = r2 ? await screenBox(r2.id) : null
    ok(kidsNow.length === 2 && b2 && !overlap(b1, b2), `the frame has two children and lays them out side by side (${kidsNow.length} children, ${JSON.stringify([b1, b2])})`)
    await undo()
    const back = await el(r1.id)
    ok(!(await els()).some((e) => e.id === r2?.id) && back.x === r1box.x && back.y === r1box.y && back.w === r1box.w, `one undo takes the drawn element out and restores the layout (${JSON.stringify(back && { x: back.x, y: back.y, w: back.w })})`)
    before = await ids()
    const esc = await draw('r', 450, 200, 550, 300, { esc: true })
    ok(esc.mid === frame.id && esc.afterEsc === false && (await newest(before)).length === 0, `Esc mid-drag clears the outline and draws nothing (${JSON.stringify(esc)})`)
    before = await ids()
    await draw('r', 900, 500, 1000, 600)
    const [free] = await newest(before)
    ok(free && !free.parentId && near(free.x, 900) && near(free.y, 500), `a box started outside every frame is a free element where it was drawn (${free && JSON.stringify({ p: free.parentId, x: free.x, y: free.y })})`)
    before = await ids()
    const alt = await draw('r', 450, 200, 550, 300, { alt: true })
    const [onTop] = await newest(before)
    ok(onTop && !onTop.parentId && near(onTop.x, 450) && near(onTop.y, 200) && !alt.mid, `Alt held at the press draws on top of the frame, not in it (${onTop && JSON.stringify({ p: onTop.parentId, x: onTop.x, y: onTop.y })}, outline ${alt.mid})`)
  })
  const nested = () => [
    rect('out', 100, 100, 760, 420, { fill: '#f4f4f4', layout: { dir: 'row', gap: 20, pad: [20, 20, 20, 20] } }),
    rect('in', 120, 120, 400, 380, { parentId: 'out', fill: '#e8e8ff', layout: { dir: 'col', gap: 10, pad: [10, 10, 10, 10] } }),
    rect('lk', 900, 100, 300, 200, { fill: '#eeeeff', locked: true, layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
    rect('hid', 900, 400, 300, 200, { fill: '#eeffee', hidden: true, layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
  ]
  await run(async () => {
    await load(nested())
    const inner = await el('in')
    const cx = inner.x + inner.w / 2, cy = inner.y + inner.h / 2
    let before = await ids()
    const d = await draw('r', cx - 40, cy - 40, cx + 40, cy + 40)
    let [n] = await newest(before)
    ok(n?.parentId === 'in' && d.mid === 'in', `with nothing selected, a box drawn in a nested frame joins the innermost one (${n?.parentId}, outline ${d.mid})`)
    await undo()
    await pick('out')
    before = await ids()
    await draw('o', cx - 40, cy - 40, cx + 40, cy + 40)
    ;[n] = await newest(before)
    ok(n?.parentId === 'in', `…even while the outer frame is selected (${n?.parentId})`)
    const outer = await el('out')
    before = await ids()
    await draw('r', outer.x + outer.w - 120, outer.y + 40, outer.x + outer.w - 40, outer.y + 120)
    ;[n] = await newest(before)
    ok(n?.parentId === 'out', `a box drawn in the outer frame beside the inner one joins the outer (${n?.parentId})`)
    before = await ids()
    await draw('r', 950, 150, 1050, 250)
    ;[n] = await newest(before)
    ok(n && !n.parentId, `a locked frame never adopts (${n?.parentId})`)
    before = await ids()
    await draw('r', 950, 450, 1050, 550)
    ;[n] = await newest(before)
    ok(n && !n.parentId, `a hidden frame never adopts (${n?.parentId})`)
    ok(!(await hints()).some((h) => h.frame === 'lk' || h.frame === 'hid'), 'a locked or hidden empty frame shows no hint')
  })
  await run(async () => {
    // a component's frames (Showcase: three copies of the Feature card in a row frame)
    await p.evaluate((d) => { const doc = JSON.parse(d); doc.slides = doc.slides.filter((s) => s.elements.some((e) => e.id === 'sd-card-1')); window.bento.loadDoc(JSON.stringify(doc)) }, starter)
    await p.waitForTimeout(500)
    const head1 = await el('sd-card-head-1'), body1 = await el('sd-card-body-1'), head0 = await el('sd-card-head')
    ok(!!head1 && !!head0, 'the Showcase feature cards are on the slide')
    const card1 = await el('sd-card-1'), card0 = await el('sd-card-0')
    let before = await ids()
    const d1 = await draw('r', card1.x + 60, card1.y + card1.h - 90, card1.x + 140, card1.y + card1.h - 40)
    let [n] = await newest(before)
    const h1 = await el('sd-card-head-1'), b1 = await el('sd-card-body-1')
    ok(n && !n.parentId && !d1.mid, `a box drawn on a component copy is drawn on top: not in the copy's frame, nor the row around it (${n?.parentId}, outline ${d1.mid})`)
    ok(h1.y === head1.y && b1.h === body1.h && (await els()).filter((e) => e.groupId === card1.groupId).length === 4, `…and the copy keeps its layout and its group (heading y ${head1.y}→${h1.y}, body h ${body1.h}→${b1.h})`)
    before = await ids()
    await draw('r', card0.x + 60, card0.y + card0.h - 90, card0.x + 140, card0.y + card0.h - 40)
    ;[n] = await newest(before)
    ok(n && !n.parentId && (await el('sd-card-head')).y === head0.y, `a box drawn on the component's main is drawn on top too (${n?.parentId})`)
    ok(!(await hints()).some((h) => /^sd-card/.test(h.frame)), 'no hint on a component\'s frames')
  })
  await run(async () => {
    await load([
      rect('gf', 100, 100, 500, 250, { groupId: 'g1', fill: '#f4f4f4', layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
      rect('gx', 100, 400, 100, 100, { groupId: 'g1' }),
      rect('out2', 700, 100, 500, 400, { fill: '#f4f4f4', layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } }),
      rect('lin', 710, 110, 300, 300, { parentId: 'out2', locked: true, fill: '#eeeeff', layout: { dir: 'col', gap: 10, pad: [10, 10, 10, 10] } }),
    ])
    let before = await ids()
    await draw('r', 300, 200, 360, 260)
    let [n] = await newest(before)
    ok(n?.parentId === 'gf' && n?.groupId === 'g1', `a box drawn in a frame inside a group joins the frame and its group (${n?.parentId}, ${n?.groupId})`)
    const lin = await el('lin')
    before = await ids()
    await draw('r', lin.x + 100, lin.y + 100, lin.x + 160, lin.y + 160)
    ;[n] = await newest(before)
    const lin2 = await el('lin')
    ok(n && !n.parentId && lin2.x === lin.x && lin2.y === lin.y, `a press inside a locked frame draws on top — it never falls through to the frame around it (${n?.parentId}, locked frame at ${lin2.x},${lin2.y})`)
  })
  await run(async () => {
    await load([rect('ef', 200, 150, 600, 300, { fill: '#ffffff', layout: { dir: 'row', gap: 16, pad: [16, 16, 16, 16] } }), rect('cov', 150, 100, 700, 400, { fill: '#ff6666' })])
    const order = await p.evaluate(() => {
      const hint = document.querySelector('.ed-stage-scale .ed-frame-hint'), cov = document.querySelector('.ed-stage-scale [data-el-id="cov"]')
      return !!hint && !!cov && !!(hint.compareDocumentPosition(cov) & Node.DOCUMENT_POSITION_FOLLOWING) && hint.parentElement === cov.parentElement
    })
    ok(order, 'the hint paints under an element that covers its frame (in paint order, before it)')
    const px = async () => p.evaluate(() => { const h = document.querySelector('.ed-stage-scale .ed-frame-hint'); const k = document.querySelector('.ed-stage-scale').getBoundingClientRect().width / window.bento.doc.size.width; return parseFloat(getComputedStyle(h).fontSize) * k })
    const f0 = await px()
    await p.locator('.ed-zoombtn', { hasText: '+' }).click(); await p.waitForTimeout(300)
    await p.locator('.ed-zoombtn', { hasText: '+' }).click(); await p.waitForTimeout(300)
    const f1 = await px()
    ok(Math.abs(f0 - 13) < 0.5 && Math.abs(f1 - 13) < 0.5, `the hint stays 13px on screen as you zoom (${f0.toFixed(2)} → ${f1.toFixed(2)})`)
    await p.locator('.ed-zoomlabel').click(); await p.waitForTimeout(300)
  })
  await run(async () => {
    await load([rect('ef', 200, 150, 600, 300, { fill: '#ffffff', layout: { dir: 'row', gap: 16, pad: [16, 16, 16, 16] } })])
    ok((await hints()).length === 1, 'an empty frame on load shows the hint')
    await p.emulateMedia({ media: 'print' })
    const printed = await p.evaluate(() => ({ app: getComputedStyle(document.getElementById('app')).display, inPrint: !!document.querySelector('#bento-print .ed-frame-hint'), shown: [...document.querySelectorAll('.ed-frame-hint')].some((n) => n.getBoundingClientRect().width > 0) }))
    await p.emulateMedia({ media: 'screen' })
    ok(!printed.inPrint && !printed.shown, `print never shows the hint (${JSON.stringify(printed)})`)
    await p.evaluate(() => document.activeElement?.blur?.())
    await p.keyboard.press('F5')
    await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section'), null, { timeout: 10000 }).catch(() => {})
    await p.waitForTimeout(400)
    const shown = await p.evaluate(() => ({ overlay: !!document.querySelector('.bento-present-overlay'), hint: !!document.querySelector('.bento-present-overlay .ed-frame-hint') || (document.querySelector('.bento-present-overlay')?.textContent ?? '').includes('Draw or drop here') }))
    ok(shown.overlay && !shown.hint, `the show never shows the hint (${JSON.stringify(shown)})`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  })
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
