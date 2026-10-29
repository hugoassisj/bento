// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Shift-click inside a multi-selection's box, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-shift-select-browser.mjs
//
// WHAT THIS PROVES:
//   1. with two elements selected, Shift-click adds a third that sits INSIDE
//      their bounding box — where Moveable's group area covers it, and where
//      the press used to be swallowed (it looked like "max 2 or 3");
//   2. Shift-click takes a selected element back out;
//   3. a grouped element comes in, and goes out, with its whole group;
//   4. Shift-DRAG on the selection is still an axis-locked move, and leaves
//      the selection alone.
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
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))

  // A row of three boxes, and below it a grouped pair between two loose boxes.
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const box = (id, x, y, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w: 160, h: 100, rotation: 0, opacity: 1, fill: '#5E7699', ...extra })
    d.slides = [{
      id: 's1', background: '#ffffff', elements: [
        box('a', 100, 120), box('b', 560, 120), box('c', 1020, 120),
        box('l', 100, 440), box('g1', 470, 440, { groupId: 'g' }), box('g2', 650, 440, { groupId: 'g' }), box('r', 1020, 440),
      ],
    }]
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(400)

  const centre = async (id) => { const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
  const selected = () => p.evaluate(() => window.bento.selection.slice().sort().join(','))
  const frame = (id) => p.evaluate((id) => { const e = window.bento.doc.slides[0].elements.find((e) => e.id === id); return { x: e.x, y: e.y } }, id)
  const click = async (id, shift = false) => {
    const pt = await centre(id)
    if (shift) await p.keyboard.down('Shift')
    await p.mouse.click(pt.x, pt.y)
    if (shift) await p.keyboard.up('Shift')
    await p.waitForTimeout(200)
  }

  // 1–2. Add inside the box, take out.
  await click('a')
  await click('c', true)
  ok(await selected() === 'a,c', 'Shift-click outside the selection adds (the case that always worked)')
  const covered = await p.evaluate(async ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.moveable-control-box'), await centre('b'))
  ok(covered, 'the precondition holds: the middle box is under the group area')
  await click('b', true)
  ok(await selected() === 'a,b,c', 'Shift-click inside the selection box adds the element there')
  await click('a', true)
  ok(await selected() === 'b,c', 'Shift-click on a selected element takes it out')

  // 3. Groups come and go whole.
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await click('l')
  await click('r', true)
  await click('g1', true)
  ok(await selected() === 'g1,g2,l,r', 'a grouped element inside the box comes in with its group')
  await click('g2', true)
  ok(await selected() === 'l,r', 'and goes out with its group')

  // 4. Shift-drag still moves on one axis and keeps the selection.
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await click('a')
  await click('c', true)
  await click('b', true)
  const before = await frame('b')
  const pt = await centre('b')
  await p.keyboard.down('Shift')
  await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.move(pt.x + 60, pt.y + 12, { steps: 8 }); await p.mouse.up()
  await p.keyboard.up('Shift')
  await p.waitForTimeout(250)
  const after = await frame('b')
  ok(after.x !== before.x && after.y === before.y, `Shift-drag moves the selection on one axis (${before.x},${before.y} → ${after.x},${after.y})`)
  ok(await selected() === 'a,b,c', 'and leaves the selection as it was')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
