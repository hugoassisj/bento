// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A layout placeholder's prompt is never slide content.
//
//   npm run build:single --prefix slides && node scripts/test-slides-placeholder-browser.mjs
//
// WHAT THIS PROVES, with a real mouse and keyboard on the built shell: an
// empty placeholder ("Click to add title") paints its prompt without holding
// it as text, so opening the box and pressing Esc leaves `html` empty with no
// undo step; clicking to place the caret and typing gives only what was
// typed; the typed text is at full opacity from the first character; a box
// emptied again shows its prompt in the editor and the thumbnail; present
// mode and print show no prompt; a placeholder with real content is
// unaffected; read() and the saved file carry no prompt in any `html`.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const PROMPT = 'Click to add title'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  // the built-in Title layout: a title and a subtitle placeholder, both empty
  await p.evaluate(() => window.bento.loadDoc(JSON.stringify({ compact: true, slides: [
    { id: 's1', layout: 'title', elements: [] },
    { id: 's2', layout: 'title', elements: [{ role: 'title', html: 'Real words' }] },
  ] })))
  await p.waitForTimeout(400)

  const ID = 'lt-title'
  const html = (slide = 0, id = ID) => p.evaluate(([s, i]) => window.bento.doc.slides[s].elements.find((e) => e.id === i)?.html, [slide, id])
  const inner = (scope = '.ed-stage-scale', id = ID) => p.evaluate(([sc, i]) => {
    const n = document.querySelector(`${sc} [data-el-id="${i}"] .bento-text-inner`)
    if (!n) return null
    const r = n.getBoundingClientRect()
    const before = getComputedStyle(n, '::before').content
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: n.textContent, opacity: getComputedStyle(n).opacity, before, shown: getComputedStyle(n.parentElement).display !== 'none', editing: n.isContentEditable }
  }, [scope, id])
  const editingOpen = () => p.evaluate(() => !!document.querySelector('.ed-stage-scale .bento-editing'))

  console.log('\nopen and leave without typing\n')
  ok((await html()) === '', 'the title placeholder starts empty')
  let box = await inner()
  ok(box.text === '' && box.before.includes(PROMPT), `the prompt is painted, not held as text (text ${JSON.stringify(box.text)}, ::before ${box.before})`)
  // a known last step to undo: the subtitle gets a word first
  const sub = await inner('.ed-stage-scale', 'lt-sub')
  await p.mouse.dblclick(sub.x, sub.y)
  await p.waitForTimeout(200)
  await p.keyboard.type('S')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok((await html(0, 'lt-sub')) === 'S', 'the subtitle took a word (the step to undo later)')
  await p.mouse.dblclick(box.x, box.y)
  await p.waitForTimeout(200)
  ok(await editingOpen(), 'a double-click opens the box')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok((await html()) === '', `Esc leaves html empty (got ${JSON.stringify(await html())})`)
  box = await inner()
  ok(box.text === '' && box.before.includes(PROMPT), 'the prompt is back on the canvas')
  await p.keyboard.press('Escape')
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(300)
  ok((await html(0, 'lt-sub')) === '' && (await html()) === '', 'and Esc made no undo step: one undo takes back the subtitle word')
  box = await inner()

  console.log('\nplace the caret, then type\n')
  await p.keyboard.press('Escape')
  await p.mouse.dblclick(box.x, box.y)
  await p.waitForTimeout(200)
  box = await inner()
  await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(150)
  await p.keyboard.type('a')
  const typing = await inner()
  ok(typing.opacity === '1', `the first typed character is at full opacity (opacity ${typing.opacity})`)
  ok(!typing.before.includes(PROMPT), 'and no prompt is painted beside it')
  await p.keyboard.type('bc')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok((await html()) === 'abc', `the html is only what was typed (got ${JSON.stringify(await html())})`)

  console.log('\nempty it again\n')
  box = await inner()
  await p.keyboard.press('Escape')
  await p.mouse.dblclick(box.x, box.y)
  await p.waitForTimeout(200)
  await p.keyboard.press('ControlOrMeta+a')
  await p.keyboard.press('Backspace')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  ok((await html()) === '', `an emptied placeholder saves as '' (got ${JSON.stringify(await html())})`)
  box = await inner()
  ok(box.text === '' && box.before.includes(PROMPT), 'and shows its prompt on the canvas again')
  const thumb = await inner('.ed-thumb')
  ok(!!thumb && thumb.text === '' && thumb.before.includes(PROMPT), `the thumbnail shows the prompt too (${JSON.stringify(thumb)})`)

  console.log('\nreal content\n')
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  await p.keyboard.press('PageDown')
  await p.waitForTimeout(400)
  const real = await inner()
  ok(real.text === 'Real words' && real.opacity === '1' && !real.before.includes(PROMPT), `a placeholder with content shows its content, nothing else (${JSON.stringify(real)})`)
  await p.keyboard.press('PageUp')
  await p.waitForTimeout(400)

  console.log('\nwhat leaves the editor\n')
  // open both placeholders once more and leave them untouched
  for (const id of [ID, 'lt-sub']) {
    const b = await inner('.ed-stage-scale', id)
    await p.mouse.dblclick(b.x, b.y)
    await p.waitForTimeout(200)
    await p.keyboard.press('Escape')
    await p.keyboard.press('Escape')
    await p.waitForTimeout(300)
  }
  const read = await p.evaluate(() => window.bento.read())
  const htmls = read.slides.flatMap((s) => s.elements.map((e) => e.html ?? ''))
  ok(!htmls.some((h) => h.includes('Click to add')), `read() holds no prompt in any html (${JSON.stringify(htmls)})`)
  const saved = await p.evaluate(() => window.bento.serialize())
  const block = saved.match(/<script type="application\/bento\+json" id="bento-doc">([\s\S]*?)<\/script>/)?.[1] ?? ''
  ok(block.includes('"placeholder":"Click to add title"') && !/"html":"[^"]*Click to add/.test(block), 'the saved file keeps the prompt as placeholder and holds it in no html')

  await p.evaluate(() => { window.print = () => {} })
  await p.keyboard.press('Escape')
  await p.keyboard.press('ControlOrMeta+p')
  await p.waitForFunction(() => document.querySelector('#bento-print'))
  const printed = await inner('#bento-print .bp-page:first-of-type')
  ok(!!printed && !printed.shown, 'print hides the empty placeholder')
  await p.evaluate(() => document.getElementById('bento-print')?.remove())

  await p.keyboard.press('F5')
  await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section'), null, { timeout: 10000 })
  await p.waitForTimeout(600)
  const shown = await inner('.bento-present-overlay section.present')
  ok(!!shown && !shown.shown, 'present mode hides the empty placeholder')
  const promptOnStage = await p.evaluate(() => document.querySelector('.bento-present-overlay')?.innerText.includes('Click to add'))
  ok(!promptOnStage, 'and no prompt text is on the stage')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
