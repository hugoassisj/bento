// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A fresh deck has somewhere for the first keystrokes to go.
//
//   npm run build:single --prefix slides && node scripts/test-slides-empty-state-browser.mjs
//
// WHAT THIS PROVES, with a real mouse and keyboard on the built shell: Start
// from scratch leaves one slide built from the Title layout, sized to the
// deck, with the title placeholder selected, so typing "Hello" makes the
// title and arms no tool (L and O used to arm Line and Ellipse); the whole
// reset is one undo step. A slide with no elements shows one quiet hint in
// the editor only (not in the render, a thumbnail, read(), the saved
// document, print or the show), hides it while a tool is armed, and drops it
// once the slide has an element; a double-click on it puts a text box at the
// pointer, open for typing; letter tools still work on a non-empty slide.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const HINT = 'Double-click to add text'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  const dialogs = []
  p.on('dialog', (d) => { dialogs.push(d.message()); d.accept() })
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.waitForTimeout(400)

  const doc = () => p.evaluate(() => window.bento.doc)
  const armed = () => p.$$eval('.ed-topbar [data-cmd].ed-btn-armed', (bs) => bs.map((b) => b.dataset.cmd))
  const hint = () => p.evaluate(() => {
    const n = document.querySelector('.ed-empty-hint')
    if (!n) return null
    const r = n.getBoundingClientRect()
    const s = document.querySelector('.ed-stage').getBoundingClientRect()
    return { text: n.textContent, inStage: !!n.closest('.ed-stage'), inRender: !!n.closest('.ed-stage-scale'), w: r.width, h: r.height, inside: r.left >= s.left - 1 && r.right <= s.right + 1 && r.top >= s.top - 1 && r.bottom <= s.bottom + 1, events: getComputedStyle(n).pointerEvents }
  })

  console.log('\nStart from scratch\n')
  const before = await doc()
  const firstId = before.slides[0].id
  await p.click('.ed-logo')
  await p.waitForTimeout(150)
  await p.click('.ed-file-menu [data-cmd="start-scratch"]')
  await p.waitForTimeout(400)
  ok(dialogs.length === 1, `it asked first (${JSON.stringify(dialogs)})`)
  let d = await doc()
  const els = d.slides[0]?.elements ?? []
  ok(d.slides.length === 1, `one slide (got ${d.slides.length})`)
  ok(els.some((e) => e.id === 'lt-title' && e.role === 'title' && e.html === '') && els.some((e) => e.id === 'lt-sub'), `it is the Title layout (${els.map((e) => e.id).join(', ')})`)
  ok(els.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= d.size.width && e.y + e.h <= d.size.height), `its placeholders fit the ${d.size.width}x${d.size.height} deck`)
  ok(JSON.stringify(await p.evaluate(() => window.bento.selection)) === '["lt-title"]', `the title placeholder is selected (${JSON.stringify(await p.evaluate(() => window.bento.selection))})`)

  const fresh = await p.evaluate(() => window.bento.serialize())
  const freshPreview = fresh.match(/<[^>]*data-bento-preview[\s\S]*?<script data-bento-preview/)?.[0] ?? ''
  ok(!freshPreview.includes('Click to add'), `the file preview of the fresh deck prints no prompt (${freshPreview.length} preview bytes)`)

  await p.keyboard.type('Hello')
  await p.waitForTimeout(150)
  const tools = await armed()
  ok(tools.length === 1 && tools[0] === 'tool-select', `typing arms no tool (pressed: ${tools.join(', ')})`)
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  d = await doc()
  const title = d.slides[0].elements.find((e) => e.id === 'lt-title')
  ok(title?.html === 'Hello', `"Hello" became the title (html ${JSON.stringify(title?.html)})`)
  ok(d.slides[0].elements.length === 3, `and nothing else was added (${d.slides[0].elements.length} elements)`)

  await p.keyboard.press('Escape')
  await p.evaluate(() => window.bento.undo()) // the typing
  await p.waitForTimeout(300)
  d = await doc()
  ok(d.slides.length === 1 && d.slides[0].elements.find((e) => e.id === 'lt-title')?.html === '', 'one undo takes back the typing, leaving the fresh Title slide')
  await p.evaluate(() => window.bento.undo()) // the reset
  await p.waitForTimeout(300)
  d = await doc()
  ok(d.slides.length === before.slides.length && d.slides[0].id === firstId, `one more restores the previous deck (${d.slides.length} slides, was ${before.slides.length})`)

  console.log('\nthe empty-slide hint\n')
  await p.evaluate(() => window.bento.loadDoc(JSON.stringify({ compact: true, slides: [
    { id: 'e1', elements: [] },
    { id: 'n1', elements: [{ type: 'text', x: 96, y: 80, w: 600, h: 100, html: 'Not empty' }] },
  ] })))
  await p.waitForTimeout(400)
  let h = await hint()
  ok(!!h && h.text.startsWith(HINT), `an empty slide shows the hint (${JSON.stringify(h?.text)})`)
  ok(!!h && h.inStage && !h.inRender && h.inside && h.w > 0 && h.h > 0, `on the slide, beside the render and never in it (${JSON.stringify(h)})`)
  ok(h?.events === 'none', 'and it takes no clicks')
  ok(!(await p.evaluate((t) => [...document.querySelectorAll('.ed-thumb')].some((n) => n.textContent.includes(t) || n.querySelector('.ed-empty-hint')), HINT)), 'no thumbnail carries it')
  const read = await p.evaluate(() => JSON.stringify(window.bento.read()))
  ok(!read.includes(HINT), 'read() does not carry it')
  const saved = await p.evaluate(() => window.bento.serialize())
  const block = saved.match(/<script type="application\/bento\+json" id="bento-doc">([\s\S]*?)<\/script>/)?.[1] ?? ''
  const preview = saved.match(/<[^>]*data-bento-preview[\s\S]*?<script data-bento-preview/)?.[0] ?? ''
  ok(block.length > 0 && !block.includes(HINT) && !preview.includes(HINT), `nor the saved document or its first-page preview (${preview.length} preview bytes)`)

  await p.keyboard.press('r')
  await p.waitForTimeout(150)
  ok((await armed()).includes('tool-rect') && !(await hint()), 'arming a tool hides it')
  await p.keyboard.press('v')
  await p.waitForTimeout(150)
  ok(!!(await hint()), 'standing the tool down brings it back')

  console.log('\nletter tools on a slide with content\n')
  await p.keyboard.press('PageDown')
  await p.waitForTimeout(400)
  ok(!(await hint()), 'a slide with an element shows no hint')
  ok(JSON.stringify(await p.evaluate(() => window.bento.selection)) === '[]', 'nothing is selected')
  await p.keyboard.press('o')
  await p.waitForTimeout(150)
  ok((await armed()).includes('tool-ellipse'), `O arms the Ellipse (pressed: ${(await armed()).join(', ')})`)
  await p.keyboard.press('v')
  await p.keyboard.press('PageUp')
  await p.waitForTimeout(400)

  console.log('\ndouble-click an empty slide\n')
  const stage = await p.evaluate(() => { const r = document.querySelector('.ed-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
  const size = (await doc()).size
  const at = { x: stage.x + stage.w * 0.3, y: stage.y + stage.h * 0.4 }
  await p.mouse.dblclick(at.x, at.y)
  await p.waitForTimeout(300)
  d = await doc()
  const made = d.slides[0].elements
  ok(made.length === 1 && made[0].type === 'text', `one text box was made (${made.map((e) => e.type).join(', ')})`)
  const cx = made[0] ? made[0].x + made[0].w / 2 : NaN
  const cy = made[0] ? made[0].y + made[0].h / 2 : NaN
  ok(Math.abs(cx - size.width * 0.3) <= 2 && Math.abs(cy - size.height * 0.4) <= 2, `centred at the pointer (${Math.round(cx)},${Math.round(cy)} vs ${Math.round(size.width * 0.3)},${Math.round(size.height * 0.4)})`)
  ok(await p.evaluate(() => !!document.querySelector('.ed-stage-scale .bento-editing')), 'and open for typing')
  ok(!(await hint()), 'the hint is gone once the slide has an element')
  await p.keyboard.type('Hi')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  d = await doc()
  ok(d.slides[0].elements[0]?.html === 'Hi', `what was typed is its text (${JSON.stringify(d.slides[0].elements[0]?.html)})`)
  await p.keyboard.press('Escape')
  await p.evaluate(() => window.bento.undo())
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(300)
  d = await doc()
  ok(d.slides[0].elements.length === 0 && !!(await hint()), `undo empties the slide and the hint returns (${d.slides[0].elements.length} elements)`)

  console.log('\nwhat leaves the editor\n')
  await p.evaluate(() => { window.print = () => {} })
  await p.keyboard.press('ControlOrMeta+p')
  await p.waitForFunction(() => document.querySelector('#bento-print'))
  ok(await p.evaluate((t) => { const n = document.getElementById('bento-print'); return !!n && !n.textContent.includes(t) && !n.querySelector('.ed-empty-hint') }, HINT), 'print carries no hint')
  await p.evaluate(() => document.getElementById('bento-print')?.remove())

  await p.keyboard.press('F5')
  await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section'), null, { timeout: 10000 })
  await p.waitForTimeout(600)
  ok(await p.evaluate((t) => { const o = document.querySelector('.bento-present-overlay'); return !o.innerText.includes(t) && !o.querySelector('.ed-empty-hint') }, HINT), 'the show carries no hint')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
