// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Speaker notes in a pane under the canvas, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-notes-pane-browser.mjs
//
// WHAT THIS PROVES:
//   1. the notes are on screen while an element is selected — they used to be
//      reachable only with nothing selected — and they are no longer in the
//      inspector (one home);
//   2. the pane follows the current slide;
//   3. typing writes the slide's notes, and one undo takes the whole burst back;
//   4. a slide switch while the field holds the caret does not carry the text
//      onto the next slide, and the pane catches up once the caret leaves;
//   5. folding the pane holds across a reload.
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const box = { id: 'box', type: 'shape', shape: 'rect', x: 200, y: 200, w: 300, h: 200, rotation: 0, opacity: 1, fill: '#5E7699' }
    d.slides = [
      { id: 's1', background: '#ffffff', notes: 'First slide notes', elements: [box] },
      { id: 's2', background: '#ffffff', notes: 'Second slide notes', elements: [] },
    ]
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(400)
  const notes = (i) => p.evaluate((i) => window.bento.doc.slides[i].notes, i)
  const area = p.locator('.ed-notespane-text')
  const thumb = (i) => p.locator('.ed-sidebar .ed-thumb').nth(i)

  // 1. On screen with an element selected; not in the inspector.
  const b = await p.locator('.ed-stage-scale [data-el-id="box"]').boundingBox()
  await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(250)
  ok(await p.evaluate(() => window.bento.selection.length) === 1, 'an element is selected')
  ok(await area.isVisible() && await area.inputValue() === 'First slide notes', 'its slide\'s notes are on screen')
  await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  ok(await p.locator('.ed-props textarea').count() === 0, 'and the inspector no longer carries a notes field')

  // 2. Follows the slide.
  await thumb(1).click(); await p.waitForTimeout(250)
  ok(await area.inputValue() === 'Second slide notes', 'the pane follows the current slide')

  // 3. Typing, one undo.
  await area.click(); await p.keyboard.press('End'); await p.keyboard.type(' — added')
  await p.locator('.ed-stage').click({ position: { x: 5, y: 5 } }); await p.waitForTimeout(250)
  ok(await notes(1) === 'Second slide notes — added', 'typing writes the slide\'s notes')
  await p.keyboard.press(`${MOD}+z`); await p.waitForTimeout(250)
  ok(await notes(1) === 'Second slide notes', 'one undo takes the whole burst back')
  ok(await area.inputValue() === 'Second slide notes', 'and the pane shows it')

  // 4. Switching slides with the caret in the field.
  await area.click(); await p.keyboard.press('End'); await p.keyboard.type(' X')
  await thumb(0).click(); await p.waitForTimeout(300)
  ok(await notes(1) === 'Second slide notes X', 'the text stays on the slide it was typed into')
  ok(await notes(0) === 'First slide notes', 'and does not land on the next one')
  ok(await area.inputValue() === 'First slide notes', 'once the caret leaves, the pane shows the new slide')

  // 5. Fold, reload.
  await p.locator('.ed-notespane-head').click(); await p.waitForTimeout(150)
  ok(!(await area.isVisible()), 'the header folds the pane')
  await p.reload()
  await p.waitForFunction(() => document.querySelector('.ed-notespane'))
  ok(!(await p.locator('.ed-notespane-text').isVisible()), 'folded holds across a reload')
  ok(await p.locator('.ed-notespane-head').getAttribute('aria-expanded') === 'false', 'and says so to a screen reader')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
