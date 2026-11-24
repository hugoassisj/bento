// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Text boxes that size themselves — end to end in the built shell, with real
// mouse and keyboard input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-text-autosize-browser.mjs
//
// WHAT THIS PROVES.
//   1. T then a click puts the box's top-left corner AT the click (it used to
//      centre a 600×120 box on it, so a click near the edge started off the
//      slide), left- and top-aligned.
//   2. That box hugs its text: after typing `Q3` its width is the rendered
//      text's width (measured with a Range, not read back from the model) and
//      its height is what window.bento.measure() says the text needs; typing
//      more widens it, deleting narrows it.
//   3. T then a drag keeps the dragged width and lets the height follow the
//      text, down as well as up.
//   4. Three clicked labels aligned left (⌥A) line their WORDS up: rendered
//      text left edges within 1px.
//   5. A selected text box whose text needs more height than the box, or that
//      runs past the slide's edge, wears a badge; the badge's Shrink text to
//      fit steps the font size down until measure() says it fits (never below
//      the floor, one undo step) and the badge goes; Fit height to text does
//      the same by growing the box.
//   6. Resizing a hugging box by a side handle stops the width hugging.
//   7. A text box put down inside an auto-layout frame is placed exactly as
//      before (centred defaults, the frame's room), and is not given a badge.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  ok(await p.evaluate(() => document.visibilityState) === 'visible', 'the page is visible (rAF runs)')

  const load = async (els) => {
    await p.evaluate((els) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'none', elements: els }]
      window.bento.loadDoc(JSON.stringify(d))
    }, els)
    await p.waitForTimeout(300)
    await p.locator('.ed-scroll').click({ position: { x: 20, y: 20 } })
    await p.keyboard.press('Escape'); await p.waitForTimeout(120)
  }
  const els = () => p.evaluate(() => window.bento.doc.slides[0].elements)
  const last = async () => (await els()).at(-1)
  const byId = async (id) => (await els()).find((e) => e.id === id)
  const measure = (id) => p.evaluate((id) => window.bento.measure(id), id)
  // slide px → page px
  const stage = async () => {
    const b = await p.locator('.ed-stage-scale').boundingBox()
    const w = await p.evaluate(() => window.bento.doc.size.width)
    return { ...b, s: b.width / w }
  }
  const at = async (x, y) => { const st = await stage(); return [st.x + x * st.s, st.y + y * st.s] }
  // the rendered TEXT, not the box: a Range over the inner's contents, in slide px
  const textRect = (id) => p.evaluate((id) => {
    const inner = document.querySelector(`.ed-stage-scale [data-el-id="${CSS.escape(id)}"] .bento-text-inner`)
    if (!inner) return null
    const r = document.createRange()
    r.selectNodeContents(inner)
    const b = r.getBoundingClientRect()
    const st = document.querySelector('.ed-stage-scale').getBoundingClientRect()
    const s = st.width / window.bento.doc.size.width
    return { left: (b.left - st.left) / s, width: b.width / s }
  }, id)
  const badge = () => p.locator('.ed-fit-badge')
  const badgeShown = async () => (await badge().count()) > 0 && await badge().first().isVisible()
  // open the badge's menu and pick a row; false (and a failure) when either is missing
  const fixVia = async (label) => {
    if (!(await badgeShown())) { ok(false, `the badge is there to offer ${label}`); return false }
    await badge().first().click(); await p.waitForTimeout(200)
    const row = p.locator('.ed-ctxmenu-item', { hasText: label })
    if (await row.count() !== 1) { ok(false, `the badge offers ${label}`); await p.keyboard.press('Escape'); return false }
    await row.click(); await p.waitForTimeout(300)
    return true
  }
  const deselect = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(150) }
  const select = async (id) => {
    const e = await byId(id)
    await p.mouse.click(...(await at(Math.max(e.x, 0) + 6, Math.max(e.y, 0) + 6)))
    await p.waitForTimeout(250)
  }
  const placeText = async (x, y, text) => {
    await deselect()
    await p.keyboard.press('t'); await p.waitForTimeout(150)
    await p.mouse.click(...(await at(x, y))); await p.waitForTimeout(300)
    if (text !== undefined) { await p.keyboard.type(text); await p.keyboard.press('Escape'); await p.waitForTimeout(300) }
    return last()
  }

  console.log('\na click puts the box at the click, and it hugs its text\n')
  await load([])
  {
    const e = await placeText(200, 300, 'Q3')
    ok(e?.type === 'text', 'T then a click puts down a text box')
    ok(Math.abs(e.x - 200) <= 1 && Math.abs(e.y - 300) <= 1, `its top-left corner is at the click (${e.x}, ${e.y}; want 200, 300)`)
    ok(e.align === 'left' && e.valign === 'top', `it is left- and top-aligned (${e.align} / ${e.valign})`)
    ok(e.html === 'Q3', `it holds what was typed (${JSON.stringify(e.html)})`)
    const tr = await textRect(e.id)
    ok(tr && Math.abs(e.w - tr.width) <= 4, `its width is the rendered text's width, within 4px (box ${e.w}, text ${tr?.width.toFixed(1)})`)
    const m = await measure(e.id)
    ok(Math.abs(e.h - m.height) <= 2, `its height is what measure() says the text needs (box ${e.h}, measured ${m.height})`)
    ok(m.lines === 1, `"Q3" is one line (${m.lines})`)
    // typing more widens it; taking text away narrows it again
    await select(e.id)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('Quarterly revenue')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const wide = await byId(e.id)
    const trw = await textRect(e.id)
    ok(wide.html === 'Quarterly revenue' && wide.w > e.w + 100 && Math.abs(wide.w - trw.width) <= 4, `more text widens it to the text (${e.w} → ${wide.w}, text ${trw.width.toFixed(1)})`)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('Q4')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const narrow = await byId(e.id)
    ok(Math.abs(narrow.w - (await textRect(e.id)).width) <= 4 && narrow.w < wide.w, `less text narrows it again (${wide.w} → ${narrow.w})`)
  }
  {
    // near the left edge the box no longer starts off the slide
    const e = await placeText(8, 500, 'Edge')
    ok(e.x >= 0 && e.x + e.w <= 1280, `a click near the left edge keeps the box on the slide (x ${e.x}, w ${e.w})`)
  }

  console.log('\na drag fixes the width; the height follows the text\n')
  await load([])
  {
    await deselect()
    await p.keyboard.press('t'); await p.waitForTimeout(150)
    const [ax, ay] = await at(300, 200)
    const [bx, by] = await at(700, 260)
    await p.mouse.move(ax, ay); await p.mouse.down()
    await p.mouse.move((ax + bx) / 2, (ay + by) / 2, { steps: 4 }); await p.mouse.move(bx, by, { steps: 4 }); await p.mouse.up()
    await p.waitForTimeout(300)
    await p.keyboard.type('One line'); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    let e = await last()
    const dragW = e.w // page px round to slide px: 400 ± 1
    ok(Math.abs(e.w - 400) <= 1, `the dragged width stays (${e.w})`)
    let m = await measure(e.id)
    ok(Math.abs(e.h - m.height) <= 1 && m.lines === 1, `one line: the height is the text's (box ${e.h}, measured ${m.height})`)
    await select(e.id)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('A much longer sentence that has to wrap onto several lines inside four hundred pixels')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    e = await last(); m = await measure(e.id)
    ok(e.w === dragW && m.lines >= 3 && Math.abs(e.h - m.height) <= 1, `more lines: width unchanged, height follows (${e.w}×${e.h}, ${m.lines} lines, measured ${m.height})`)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('Short')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const back = await last(); m = await measure(back.id)
    ok(back.w === dragW && back.h < e.h && Math.abs(back.h - m.height) <= 1, `fewer lines: the height comes back down (${e.h} → ${back.h})`)
  }

  console.log('\nthree clicked labels align by their words\n')
  await load([])
  {
    const a = await placeText(120, 200, 'Q3')
    const b = await placeText(260, 300, 'Q4')
    const c = await placeText(400, 400, 'FY')
    await deselect()
    await p.mouse.click(...(await at(a.x + 4, a.y + 4))); await p.waitForTimeout(150)
    await p.keyboard.down('Shift')
    await p.mouse.click(...(await at(b.x + 4, b.y + 4))); await p.waitForTimeout(150)
    await p.mouse.click(...(await at(c.x + 4, c.y + 4))); await p.waitForTimeout(150)
    await p.keyboard.up('Shift')
    ok((await p.evaluate(() => window.bento.selection.length)) === 3, 'all three are selected')
    await p.keyboard.press('Alt+KeyA'); await p.waitForTimeout(300)
    const lefts = await Promise.all([a.id, b.id, c.id].map(async (id) => (await textRect(id)).left))
    const spread = Math.max(...lefts) - Math.min(...lefts)
    ok(spread <= 1, `text left edges within 1px of each other (${lefts.map((l) => l.toFixed(1)).join(', ')})`)
  }

  console.log('\nthe overflow badge, and its two fixes\n')
  const lines = Array.from({ length: 30 }, (_, i) => `<p>Line ${i + 1}</p>`).join('')
  const box = (id, extra) => ({ id, type: 'text', x: 100, y: 100, w: 400, h: 100, rotation: 0, opacity: 1, html: 'Fits', fontSize: 24, fontFamily: 'system-ui, sans-serif', fontWeight: 400, color: '#1E2A3A', align: 'left', valign: 'top', lineHeight: 1.25, ...extra })
  await load([box('fits'), box('tall', { x: 600, y: 60, html: lines }), box('past', { x: 1100, y: 500, w: 400, h: 60 }), box('long', { x: 100, y: 300, h: 1000, html: lines })])
  {
    await select('fits')
    ok(!(await badgeShown()), 'a box whose text fits carries no badge')
    await select('tall')
    ok(await badgeShown(), 'a 30-line box too short for its text carries the badge')
    await select('past')
    ok(await badgeShown(), 'a box pushed past the right edge carries the badge')
    await select('long')
    ok(await badgeShown(), 'a box running past the bottom of the slide carries the badge')
    await deselect()
    ok(!(await badgeShown()), 'nothing selected, no badge')

    // Shrink text to fit, on the box too short for its text
    const eight = Array.from({ length: 8 }, (_, i) => `<p>Line ${i + 1}</p>`).join('')
    await load([box('tall', { x: 600, y: 60, h: 260, html: eight })])
    await select('tall')
    const before = await byId('tall')
    ok(!(await measure('tall')).fits, `before: measure() says the text does not fit (${(await measure('tall')).height} > ${before.h})`)
    if (await badgeShown()) {
      await badge().first().click(); await p.waitForTimeout(200)
      ok(await p.locator('.ed-ctxmenu-item', { hasText: 'Fit height to text' }).count() === 1, 'the badge offers Fit height to text')
      await p.keyboard.press('Escape'); await p.waitForTimeout(150)
    }
    await fixVia('Shrink text to fit')
    const after = await byId('tall')
    const m = await measure('tall')
    ok(after.fontSize < before.fontSize && after.fontSize >= 10 && m.fits === true, `after: the font steps down until it fits (${before.fontSize} → ${after.fontSize}px, ${m.height} ≤ ${after.h})`)
    ok(after.h === before.h && after.w === before.w, `the box keeps its size (${after.w}×${after.h})`)
    ok(!(await badgeShown()), 'the badge goes once it fits')
    if (after.fontSize !== before.fontSize) {
      await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(200)
      ok((await byId('tall'))?.fontSize === before.fontSize, `one undo step puts the size back (${(await byId('tall'))?.fontSize})`)
    } else ok(false, 'one undo step puts the size back (nothing changed to undo)')

    // the floor: text that cannot fit even at the floor stops there
    await load([box('tiny', { h: 20, w: 120, html: lines })])
    await select('tiny')
    await fixVia('Shrink text to fit')
    ok((await byId('tiny'))?.fontSize === 10, `never below the floor (${(await byId('tiny')).fontSize}px)`)

    // Shrink on a box that runs off the bottom: fits what is on the slide
    await load([box('long', { x: 100, y: 300, h: 1000, html: Array.from({ length: 12 }, (_, i) => `<p>Line ${i + 1}</p>`).join('') })])
    await select('long')
    await fixVia('Shrink text to fit')
    const lg = await byId('long')
    ok(lg.y + lg.h <= 720 && (await measure('long')).fits && lg.fontSize < 24, `a box past the bottom shrinks to fit on the slide (y ${lg.y} + h ${lg.h}, ${lg.fontSize}px)`)
    ok(!(await badgeShown()), 'and loses its badge')

    // Fit height to text grows the box instead
    await load([box('tall', { x: 600, y: 60, html: eight })])
    await select('tall')
    await fixVia('Fit height to text')
    const grown = await byId('tall')
    ok(grown.fontSize === 24 && Math.abs(grown.h - (await measure('tall')).height) <= 1, `Fit height to text grows the box to the text (h ${grown.h})`)
    ok(!(await badgeShown()), 'and the badge goes')

    // typing a long list into a clicked box: the box goes past the slide, the badge says so
    await load([])
    await deselect()
    await p.keyboard.press('t'); await p.waitForTimeout(150)
    await p.mouse.click(...(await at(600, 100))); await p.waitForTimeout(300)
    for (let i = 0; i < 30; i++) { await p.keyboard.type(`item ${i + 1}`); await p.keyboard.press('Enter') }
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const list = await last()
    ok(list.y + list.h > 720, `30 typed lines run past the slide (bottom ${list.y + list.h})`)
    ok(await badgeShown(), 'and the selected box wears the badge')
  }

  console.log('\na side handle stops the width hugging\n')
  await load([])
  {
    // three lines, so the box is tall enough to be given side handles
    const e = await placeText(200, 200)
    await p.keyboard.type('Hello'); await p.keyboard.press('Enter'); await p.keyboard.type('there, everyone'); await p.keyboard.press('Enter'); await p.keyboard.type('and you')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    Object.assign(e, await byId(e.id))
    await select(e.id)
    const hb = await p.evaluate(() => {
      const c = [...document.querySelectorAll('.moveable-control-box .moveable-control.moveable-direction[data-direction="e"]')]
        .find((h) => getComputedStyle(h).display !== 'none' && h.getBoundingClientRect().width > 0)
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })
    ok(!!hb, 'the right-hand side handle is there')
    if (!hb) throw new Error('no side handle to drag')
    const st = await stage()
    await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down()
    await p.mouse.move(hb.x + hb.width / 2 + 100 * st.s, hb.y + hb.height / 2, { steps: 4 })
    await p.mouse.move(hb.x + hb.width / 2 + 200 * st.s, hb.y + hb.height / 2, { steps: 4 }); await p.mouse.up()
    await p.waitForTimeout(300)
    const resized = await byId(e.id)
    ok(resized.w > e.w + 150, `the handle widened the box (${e.w} → ${resized.w})`)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('Hello there')
    await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const edited = await byId(e.id)
    ok(edited.w === resized.w, `after the resize, new text keeps the width the handle gave (${edited.w}, want ${resized.w})`)
    ok(Math.abs(edited.h - (await measure(e.id)).height) <= 1, `and the height still follows the text (h ${edited.h})`)
  }

  console.log('\ninside an auto-layout frame, nothing changes\n')
  await load([{ id: 'fr', type: 'shape', shape: 'rect', x: 200, y: 150, w: 800, h: 300, rotation: 0, opacity: 1, fill: '#FFFFFF', stroke: '#D0D5DD', strokeWidth: 1, radius: 8, layout: { dir: 'row', gap: 16, pad: [16, 16, 16, 16] } }])
  {
    await select('fr')
    await p.keyboard.press('t'); await p.waitForTimeout(150)
    await p.mouse.click(...(await at(300, 250))); await p.waitForTimeout(300)
    await p.keyboard.type('In a frame'); await p.keyboard.press('Escape'); await p.waitForTimeout(300)
    const e = await last()
    ok(e.parentId === 'fr', 'the text box is the frame\'s child')
    ok(e.align === 'center' && e.valign === 'middle' && e.w === 600 && e.h === 120, `it keeps the defaults it always had (${e.align}/${e.valign}, ${e.w}×${e.h})`)
    ok(!(await badgeShown()), 'a frame child is not given the badge')
  }

  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
