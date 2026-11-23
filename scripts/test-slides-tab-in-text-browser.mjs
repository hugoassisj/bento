// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Tab inside an open text box never leaves it.
//
//   npm run build:single --prefix slides && node scripts/test-slides-tab-in-text-browser.mjs
//
// WHAT THIS PROVES, with real keys and clicks on the built shell: Tab on a
// plain line used to move focus out of the box, which ended the edit, and the
// next keys reopened the still-selected box with everything selected and
// replaced it (or Enter pressed whatever control took focus). Now, editing:
//   1. the reproduction (type two lines, Tab, type) keeps all three lines,
//      the caret never leaves, and the third line is a first-level bullet;
//   2. Tab on a plain line with words makes that line a bullet, caret kept;
//   3. ⌘Z straight after restores the box as it was;
//   4. Shift+Tab on a first-level bullet makes it a plain line again, and on a
//      plain line changes nothing — focus stays in both cases;
//   5. nested bullets still nest and un-nest; Enter after a Tab is a new line,
//      not a press on some panel control; a table cell still moves on Tab.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const norm = (h) => (h ?? '').replace(/\s+/g, ' ').replace(/<br>(?=<\/li>)/g, '')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const text = (id, y, html) => ({ id, type: 'text', x: 120, y, w: 520, h: 150, rotation: 0, opacity: 1, html, fontSize: 28, color: '#1E2A3A', align: 'left' })
    d.slides = [{ id: 's1', background: '#ffffff', elements: [
      text('lines', 260, 'Alpha<div>Beta</div>'),
      text('list', 440, '<ul><li>One</li><li>Two</li></ul>'),
      { id: 'tbl', type: 'table', x: 700, y: 440, w: 420, h: 120, rotation: 0, opacity: 1, columns: [{ w: 1 }, { w: 1 }], header: false,
        rows: [{ cells: [{ html: 'A' }, { html: 'B' }] }, { cells: [{ html: 'C' }, { html: 'D' }] }], style: {} },
    ] }]
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(400)

  const editingInner = '.ed-stage-scale .bento-editing .bento-text-inner'
  const live = () => p.evaluate((s) => document.querySelector(s)?.innerHTML ?? null, editingInner)
  const focusIn = () => p.evaluate((s) => { const n = document.querySelector(s); return !!n && n.contains(document.activeElement) }, editingInner)
  const html = (id) => p.evaluate((i) => window.bento.doc.slides[0].elements.find((e) => e.id === i)?.html, id)
  const texts = () => p.evaluate(() => window.bento.doc.slides[0].elements.filter((e) => e.type === 'text').map((e) => e.id))
  const edit = async (id) => {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    await p.mouse.dblclick(b.x + 30, b.y + 20)
    await p.waitForTimeout(200)
  }
  const caretAfter = (word) => p.evaluate(([s, w]) => {
    const root = document.querySelector(s)
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.trim() === w) {
      const r = document.createRange(); r.setStart(n, n.data.length); r.collapse(true)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return true
    }
    return false
  }, [editingInner, word])
  const commit = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); await p.keyboard.press('Escape') }

  console.log('\nthe reproduction: two lines, Tab, type\n')
  const before = await texts()
  const stage = await p.locator('.ed-stage-scale').boundingBox()
  await p.keyboard.press('t')
  await p.waitForTimeout(150)
  await p.mouse.click(stage.x + 200, stage.y + 60)
  await p.waitForTimeout(300)
  const id = (await texts()).find((i) => !before.includes(i))
  ok(!!id && await focusIn(), 'T and a click open a new text box')
  await p.keyboard.type('Revenue')
  await p.keyboard.press('Enter')
  await p.keyboard.type('Costs')
  await p.keyboard.press('Enter')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(150)
  ok(await focusIn(), 'after Tab the caret is still in the box and the edit is open')
  await p.keyboard.type('Cloud spend')
  const typed = norm(await live())
  ok(/<ul><li>Cloud spend<\/li><\/ul>/.test(typed), `the third line is a first-level bullet (${typed})`)
  await commit()
  const saved = norm(await html(id))
  ok(saved.includes('Revenue') && saved.includes('Costs') && /<li>Cloud spend<\/li>/.test(saved), `committed, all three lines are there (${saved})`)

  console.log('\nTab on a plain line with words\n')
  await edit('lines')
  await caretAfter('Beta')
  await p.keyboard.press('Tab')
  ok(await focusIn(), 'focus stays in the box')
  ok(/<ul><li>Beta<\/li><\/ul>/.test(norm(await live())) && norm(await live()).startsWith('Alpha'), `the caret's line becomes a bullet, the line above stays plain (${norm(await live())})`)
  await p.keyboard.type('!')
  ok(/<li>Beta!<\/li>/.test(norm(await live())), 'the caret stayed at the end of the line')

  console.log('\n⌘Z straight after\n')
  await p.keyboard.press('Backspace')
  const listed = norm(await live())
  await p.keyboard.press(`${MOD}+z`)
  await p.waitForTimeout(100)
  ok(norm(await live()) !== listed && !/<li>/.test(norm(await live())) && norm(await live()).includes('Beta'), `⌘Z after the Tab restores the plain line (${norm(await live())})`)
  await commit()
  ok(norm(await html('lines')) === 'Alpha<div>Beta</div>', `committed after the undo, the box is as it was (${norm(await html('lines'))})`)

  console.log('\nShift+Tab\n')
  await edit('lines')
  await caretAfter('Beta')
  await p.keyboard.press('Shift+Tab')
  ok(await focusIn() && norm(await live()) === 'Alpha<div>Beta</div>', `on a plain line it changes nothing and keeps focus (${norm(await live())})`)
  await p.keyboard.press('Tab')
  await p.keyboard.press('Shift+Tab')
  ok(await focusIn(), 'on a first-level bullet focus stays')
  ok(!/<li>/.test(norm(await live())) && norm(await live()).includes('Beta'), `and the bullet is a plain line again (${norm(await live())})`)
  await commit()

  console.log('\nnested bullets, Enter, table cells\n')
  await edit('list')
  await caretAfter('Two')
  await p.keyboard.press('Tab')
  ok(norm(await live()) === '<ul><li>One<ul><li>Two</li></ul></li></ul>' && await focusIn(), `Tab nests the second item (${norm(await live())})`)
  await p.keyboard.press('Shift+Tab')
  ok(norm(await live()) === '<ul><li>One</li><li>Two</li></ul>' && await focusIn(), 'Shift+Tab un-nests it')
  await commit()

  const panelW = () => p.evaluate(() => document.querySelector('.ed-props')?.getBoundingClientRect().width ?? 0)
  const w0 = await panelW()
  await edit('lines')
  await caretAfter('Beta')
  await p.keyboard.press('Tab')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(250)
  ok(await focusIn() && (await panelW()) === w0, `Enter after a Tab is a new line in the box; the panel stays (${w0} → ${await panelW()})`)
  await commit()

  const cell = await p.locator('.ed-stage-scale [data-el-id="tbl"] td').first().boundingBox()
  await p.mouse.dblclick(cell.x + cell.width / 2, cell.y + cell.height / 2)
  await p.waitForTimeout(200)
  await p.keyboard.press('Tab')
  await p.waitForTimeout(150)
  const nowIn = await p.evaluate(() => (document.activeElement?.closest?.('td')?.textContent ?? document.activeElement?.textContent ?? '').trim())
  ok(nowIn === 'B', `in a table cell, Tab still moves to the next cell (now in "${nowIn}")`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
