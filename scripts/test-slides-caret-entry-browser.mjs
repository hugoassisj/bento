// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Opening a text box puts the caret where you clicked.
//
//   npm run build:single --prefix slides && node scripts/test-slides-caret-entry-browser.mjs
//
// WHAT THIS PROVES, with a real mouse, touch and keyboard on the built shell:
//   1. a double-click in the middle of a word, then a typed X, inserts the X
//      there and leaves the rest intact — through the standard
//      caretPositionFromPoint and, with that removed, through WebKit's
//      caretRangeFromPoint (the engines this shell runs in have one or both);
//   2. on touch, a tap on the already selected box does the same;
//   3. a box just inserted still opens with its starter text selected, and
//      the context menu's Edit text still selects everything;
//   4. an empty placeholder opens with a caret and no selection;
//   5. typing with a box selected appends at the end of what it says (a box
//      still holding its untouched starter text is still replaced);
//   6. a backtick right after a pointer entry types a backtick, not a code
//      wrap of the whole box;
//   7. a box with a {{page}} field and $…$ maths opens without an error with
//      a caret inside it.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const text = (id, y, html, extra = {}) => ({ id, type: 'text', x: 120, y, w: 700, h: 90, rotation: 0, opacity: 1, html, fontSize: 40, color: '#1E2A3A', align: 'left', valign: 'middle', ...extra })
const DECK = { slides: [{ id: 's1', background: '#ffffff', elements: [
  text('words', 40, 'Hello wonderful world'),
  text('fresh', 150, 'Double-click to edit'),
  text('ph', 260, '', { placeholder: 'Click to add title' }),
  text('fields', 370, 'Page {{page}} and $x^2$ here'),
  text('tick', 480, 'Tick here'),
  text('menu', 590, 'Menu words'),
] }] }

async function open(browser, { touch = false, standard = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: touch })
  await ctx.addInitScript((std) => {
    try { localStorage.setItem('bento-slideshow-started', '1') } catch {}
    // WebKit has only caretRangeFromPoint; take the standard API away to drive that path
    if (!std) delete Document.prototype.caretPositionFromPoint
  }, standard)
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  p.errors = []
  p.on('pageerror', (e) => p.errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.evaluate((d) => {
    const doc = JSON.parse(JSON.stringify(window.bento.doc))
    doc.slides = d.slides
    window.bento.loadDoc(JSON.stringify(doc))
  }, DECK)
  await p.waitForTimeout(400)
  return { ctx, p }
}

const html = (p, id) => p.evaluate((i) => window.bento.doc.slides[0].elements.find((e) => e.id === i)?.html, id)
// the client point just inside the left edge of character `at` of `word`
const charPoint = (p, id, word, at) => p.evaluate(([i, w, k]) => {
  const inner = document.querySelector(`.ed-stage-scale [data-el-id="${i}"] .bento-text-inner`)
  const walk = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.data.indexOf(w)
    if (s < 0) continue
    const r = document.createRange(); r.setStart(n, s + k); r.setEnd(n, s + k + 1)
    const b = r.getBoundingClientRect()
    return { x: b.left + 1, y: b.top + b.height / 2 }
  }
  return null
}, [id, word, at])
const boxPoint = async (p, id) => {
  const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"] .bento-text-inner`).boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
const selection = (p) => p.evaluate(() => {
  const s = getSelection()
  const inner = document.querySelector('.ed-stage-scale .bento-editing .bento-text-inner')
  return { open: !!inner, inside: !!inner && !!s.anchorNode && inner.contains(s.anchorNode), collapsed: s.isCollapsed, text: s.toString() }
})
const leave = async (p) => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); await p.keyboard.press('Escape'); await p.waitForTimeout(100) }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const standard of [true, false]) {
    console.log(`\na double-click in a word (${standard ? 'caretPositionFromPoint' : 'caretRangeFromPoint only'})\n`)
    const { ctx, p } = await open(browser, { standard })
    // "wonderful": the point at the left edge of its fourth letter, the d
    const pt = await charPoint(p, 'words', 'wonderful', 3)
    await p.mouse.dblclick(pt.x, pt.y)
    await p.waitForTimeout(200)
    const s = await selection(p)
    ok(s.open && s.inside && s.collapsed, `the box opens with a caret, nothing selected (${JSON.stringify(s)})`)
    await p.keyboard.type('X')
    await leave(p)
    ok((await html(p, 'words')) === 'Hello wonXderful world', `X lands where the click was, the rest intact (got ${JSON.stringify(await html(p, 'words'))})`)
    ok(p.errors.length === 0, `no page errors${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`)
    await ctx.close()
  }

  console.log('\ntouch: a tap on the selected box\n')
  {
    const { ctx, p } = await open(browser, { touch: true })
    const pt = await charPoint(p, 'words', 'world', 2)
    await p.touchscreen.tap(pt.x, pt.y)
    await p.waitForTimeout(400)
    await p.touchscreen.tap(pt.x, pt.y)
    await p.waitForTimeout(400)
    const s = await selection(p)
    ok(s.open && s.inside && s.collapsed, `the second tap opens the box with a caret (${JSON.stringify(s)})`)
    await p.keyboard.type('X')
    await leave(p)
    ok((await html(p, 'words')) === 'Hello wonderful woXrld', `X lands under the finger (got ${JSON.stringify(await html(p, 'words'))})`)
    await ctx.close()
  }

  const { ctx, p } = await open(browser)

  console.log('\nwhere select-all stays\n')
  const before = await p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => e.id))
  const stage = await p.locator('.ed-stage-scale').boundingBox()
  await p.keyboard.press('t')
  await p.waitForTimeout(150)
  await p.mouse.click(stage.x + stage.width - 160, stage.y + stage.height - 80)
  await p.waitForTimeout(300)
  const made = (await p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => e.id))).find((i) => !before.includes(i))
  const fresh = await selection(p)
  ok(!!made && fresh.open && fresh.text.trim() === 'Double-click to edit', `a box just inserted opens with its starter text selected (${JSON.stringify(fresh)})`)
  await leave(p)

  const m = await boxPoint(p, 'menu')
  await p.mouse.click(m.x, m.y)
  await p.waitForTimeout(150)
  await p.mouse.click(m.x, m.y, { button: 'right' })
  await p.waitForTimeout(250)
  await p.locator('.ed-ctxmenu .ed-ctxmenu-item').filter({ hasText: /Edit text/ }).first().click()
  await p.waitForTimeout(200)
  const viaMenu = await selection(p)
  ok(viaMenu.open && viaMenu.text === 'Menu words', `the context menu's Edit text selects everything (${JSON.stringify(viaMenu)})`)
  await leave(p)

  console.log('\nan empty placeholder\n')
  await p.mouse.dblclick(...Object.values(await boxPoint(p, 'ph')))
  await p.waitForTimeout(200)
  const ph = await selection(p)
  ok(ph.open && ph.inside && ph.collapsed, `it opens with a caret and no selection (${JSON.stringify(ph)})`)
  await leave(p)

  console.log('\ntyping with a box selected\n')
  const w = await boxPoint(p, 'words')
  await p.mouse.click(w.x, w.y)
  await p.waitForTimeout(200)
  await p.keyboard.type('Z')
  await leave(p)
  ok((await html(p, 'words')) === 'Hello wonderful worldZ', `a key typed at a selected box goes at the end, nothing deleted (got ${JSON.stringify(await html(p, 'words'))})`)
  const f = await boxPoint(p, 'fresh')
  await p.mouse.click(f.x, f.y)
  await p.waitForTimeout(200)
  await p.keyboard.type('Q')
  await leave(p)
  ok((await html(p, 'fresh')) === 'Q', `a box still holding its starter text is replaced (got ${JSON.stringify(await html(p, 'fresh'))})`)

  console.log('\na backtick after a pointer entry\n')
  const tk = await charPoint(p, 'tick', 'here', 0)
  await p.mouse.dblclick(tk.x, tk.y)
  await p.waitForTimeout(200)
  await p.keyboard.type('`')
  await leave(p)
  const ticked = await html(p, 'tick')
  ok(ticked === 'Tick `here' && !ticked.includes('<code'), `it types a backtick at the caret (got ${JSON.stringify(ticked)})`)

  console.log('\nfields and maths\n')
  const fp = await charPoint(p, 'fields', 'and', 1)
  await p.mouse.dblclick(fp.x, fp.y)
  await p.waitForTimeout(250)
  const fs = await selection(p)
  ok(fs.open && fs.inside && fs.collapsed, `a box with {{page}} and $…$ opens with a caret inside (${JSON.stringify(fs)})`)
  const raw = await p.evaluate(() => document.querySelector('.ed-stage-scale .bento-editing .bento-text-inner')?.textContent)
  ok(raw === 'Page {{page}} and $x^2$ here', `showing its source while open (${JSON.stringify(raw)})`)
  await leave(p)
  ok((await html(p, 'fields')) === 'Page {{page}} and $x^2$ here', 'and closes unchanged')

  ok(p.errors.length === 0, `no page errors${p.errors.length ? ': ' + p.errors.join(' | ') : ''}`)
  await ctx.close()
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
