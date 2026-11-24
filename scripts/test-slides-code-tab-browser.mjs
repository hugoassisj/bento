// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Code blocks: Tab indents, paste recognises code, the language is guessed.
//
//   npm run build:single --prefix slides && node scripts/test-slides-code-tab-browser.mjs
//
// WHAT THIS PROVES, with real keys and clicks on the built shell:
//   1. typing in a Code element, Tab indents and the caret never leaves the
//      block (it used to move focus out, which committed the edit, and the
//      next letters fired editor shortcuts: `r` armed the Shape tool); Enter
//      carries the line's indentation; Shift+Tab outdents; a selection over
//      several lines indents and outdents as a block; Esc commits exactly
//      what was typed;
//   2. code pasted onto the canvas — as plain text, or with the html flavour
//      an editor such as VS Code writes — becomes one Code element holding the
//      text verbatim, its language guessed (py); "Paste as text" in the toast
//      gives the text box a paste made before; a sentence and a bulleted list
//      still paste as text; a fence still works, with or without a tag;
//   3. with a Code element selected, a paste replaces its code and the
//      toast's Undo puts it back;
//   4. Tab in a bullet of a text box still indents the item.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const PY = 'def area(r):\n    import math\n    return math.pi * r ** 2'
const PY_HTML = '<div style="white-space: pre; font-family: Menlo, monospace"><div>def area(r):</div><div>    import math</div><div>    return math.pi * r ** 2</div></div>'

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
  ok(await p.evaluate(() => document.visibilityState) === 'visible', 'the page is visible')
  const fresh = (elements = []) => p.evaluate((els) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', elements: els }]
    window.bento.loadDoc(JSON.stringify(d))
  }, elements)
  await fresh()
  await p.waitForTimeout(400)

  const els = () => p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => ({ id: e.id, type: e.type, content: e.content, html: e.html, grammarName: e.grammarName })))
  const editingInner = '.ed-stage-scale .bento-editing .bento-text-inner'
  const live = () => p.evaluate((s) => document.querySelector(s)?.innerText ?? null, editingInner)
  const focusIn = () => p.evaluate((s) => { const n = document.querySelector(s); return !!n && n.contains(document.activeElement) }, editingInner)
  const armed = () => p.evaluate(() => !!document.querySelector('.ed-place'))
  const edit = async (id) => {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    await p.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2)
    await p.waitForTimeout(200)
  }
  const escape = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(250); await p.keyboard.press('Escape'); await p.waitForTimeout(100) }
  const toast = () => p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')
  const action = () => p.evaluate(() => document.querySelector('.ed-toast-act')?.textContent ?? null)
  const clickAction = async () => { if (await action() !== null) await p.locator('.ed-toast-act').click(); await p.waitForTimeout(250) }
  const paste = (plain, html) => p.evaluate(([plain, html]) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', plain)
    if (html) dt.setData('text/html', html)
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, [plain, html])

  console.log('\n1 · typing in a Code element\n')
  await p.click('[data-cmd="insert-code"]')
  await p.waitForTimeout(300)
  await escape()
  const code = (await els()).find((e) => e.type === 'code')
  ok(!!code, 'the toolbar inserts a Code element')
  await edit(code.id)
  ok(await focusIn(), 'a double-click opens it')
  await p.keyboard.type('function f() {')
  await p.keyboard.press('Enter')
  await p.keyboard.press('Tab')
  await p.waitForTimeout(150)
  ok(await focusIn(), 'after Tab the caret is still in the block')
  await p.keyboard.type('return x')
  await p.waitForTimeout(100)
  ok(!(await armed()), 'typing "return x" after Tab arms no tool')
  ok(await live() === 'function f() {\n  return x', `Tab put two spaces before the line (${JSON.stringify(await live())})`)
  await p.keyboard.press('Enter')
  await p.keyboard.type('y')
  ok(await live() === 'function f() {\n  return x\n  y', `Enter keeps the indentation (${JSON.stringify(await live())})`)
  await p.keyboard.press('Shift+Tab')
  ok(await focusIn() && await live() === 'function f() {\n  return x\ny', `Shift+Tab outdents the caret's line (${JSON.stringify(await live())})`)
  await p.keyboard.type('!')
  ok(await live() === 'function f() {\n  return x\ny!', 'and the caret stayed at the end of it')
  await p.keyboard.press(`${MOD}+a`)
  await p.keyboard.press('Tab')
  ok(await focusIn() && await live() === '  function f() {\n    return x\n  y!', `a selection over every line indents them as a block (${JSON.stringify(await live())})`)
  await p.keyboard.press('Shift+Tab')
  await p.keyboard.press('Shift+Tab')
  ok(await focusIn() && await live() === 'function f() {\nreturn x\ny!', `Shift+Tab twice outdents them as a block (${JSON.stringify(await live())})`)
  await p.keyboard.press('Tab')
  ok(await live() === '  function f() {\n  return x\n  y!', 'the lines stay selected between presses')
  await p.keyboard.press(`${MOD}+z`)
  ok(await focusIn() && await live() === 'function f() {\nreturn x\ny!', `⌘Z undoes the last indent (${JSON.stringify(await live())})`)
  await p.keyboard.press(`${MOD}+a`)
  await p.keyboard.press('Tab')
  await p.keyboard.press('ArrowDown')
  await p.keyboard.press('End')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(250)
  ok(!(await focusIn()), 'Esc still ends editing')
  const typed = (await els()).find((e) => e.id === code.id)?.content
  ok(typed === '  function f() {\n  return x\n  y!', `the committed content holds the typed indentation exactly (${JSON.stringify(typed)})`)
  await p.keyboard.press('Escape')

  console.log('\n2 · code pasted onto the canvas\n')
  let got0
  for (const [what, html] of [['plain text', null], ['plain text and html', PY_HTML]]) {
    await fresh()
    await p.waitForTimeout(250)
    await paste(PY, html)
    await p.waitForTimeout(250)
    const got = await els()
    ok(got.length === 1 && got[0].type === 'code', `the Python sample as ${what} → one Code element (${got.map((e) => e.type).join(',')})`)
    ok(got[0]?.content === PY, `its content is the plain text verbatim (${JSON.stringify(got[0]?.content)})`)
    ok(got[0]?.grammarName === 'py', `its language is guessed: ${got[0]?.grammarName}`)
    ok((await toast()).startsWith('Pasted as code'), `the toast says so (${await toast()})`)
  }
  ok(await action() === 'Paste as text', 'and offers Paste as text')
  await clickAction()
  const asText = await els()
  ok(asText.length === 1 && asText[0].type === 'text' && asText[0].html.includes('def area(r):') && asText[0].html.includes('return math.pi'),
    `Paste as text swaps it for the text box a paste made before (${asText.map((e) => e.type).join(',')})`)
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(150)
  ok((await els()).map((e) => e.type).join(',') === 'code', '⌘Z after Paste as text brings the Code element back')

  await fresh()
  await p.waitForTimeout(250)
  await paste('npm install bento', '<meta charset="utf-8"><code style="font-family: ui-monospace, monospace">npm install bento</code>')
  await p.waitForTimeout(250)
  got0 = await els()
  ok(got0.length === 1 && got0[0].type === 'code' && got0[0].content === 'npm install bento', `one line the html paints as code → a Code element (${got0.map((e) => e.type).join(',')})`)
  await fresh()
  await p.waitForTimeout(250)
  await paste('Revenue grew.\nCosts held.', '<div style="white-space: pre-wrap; font-family: Inter, sans-serif">Revenue grew.<br>Costs held.</div>')
  await p.waitForTimeout(250)
  got0 = await els()
  ok(got0.length === 1 && got0[0].type === 'text', `prose in pre-wrap html (a text box copied off a slide) stays text (${got0.map((e) => e.type).join(',')})`)

  for (const [what, text] of [['a sentence', 'Revenue grew in every region this quarter.'], ['a bulleted list', '- Goals:\n  - ship (on time)\n  - hire']]) {
    await fresh()
    await p.waitForTimeout(250)
    await paste(text, null)
    await p.waitForTimeout(250)
    const got = await els()
    ok(got.length === 1 && got[0].type === 'text', `${what} still pastes as text (${got.map((e) => e.type).join(',')})`)
  }
  for (const [what, text, lang] of [['a fence tagged python', '```python\nprint(1)\n```', 'py'], ['a fence with no tag', '```\n' + PY + '\n```', 'py'], ['a fence tagged js', '```js\n' + PY + '\n```', 'js']]) {
    await fresh()
    await p.waitForTimeout(250)
    await paste(text, null)
    await p.waitForTimeout(250)
    const got = await els()
    ok(got.length === 1 && got[0].type === 'code' && got[0].grammarName === lang, `${what} → a Code element in ${lang} (${got.map((e) => `${e.type}:${e.grammarName}`).join(',')})`)
  }

  console.log('\n3 · a paste with a Code element selected\n')
  await fresh([{ id: 'c1', type: 'code', x: 200, y: 200, w: 600, h: 200, rotation: 0, opacity: 1, fontSize: 24, fontFamily: 'monospace', color: '#1E2A3A', align: 'left', valign: 'top', lineHeight: 1.25, content: 'old()' }])
  await p.waitForTimeout(300)
  const c1 = await p.locator('.ed-stage-scale [data-el-id="c1"]').boundingBox()
  await p.mouse.click(c1.x + 20, c1.y + 20)
  await p.waitForTimeout(200)
  ok((await p.evaluate(() => window.bento.selection)).join() === 'c1', 'the Code element is selected')
  await paste(PY, null)
  await p.waitForTimeout(250)
  let got = await els()
  ok(got.length === 1 && got[0].content === PY && got[0].grammarName === 'py', `the paste replaces its code (${JSON.stringify(got[0]?.content)}, ${got[0]?.grammarName})`)
  ok((await toast()).startsWith('Code replaced') && await action() === 'Undo', `the toast says so and offers Undo (${await toast()})`)
  await clickAction()
  got = await els()
  ok(got.length === 1 && got[0].content === 'old()' && got[0].grammarName === undefined, `Undo puts the old code back (${JSON.stringify(got[0]?.content)})`)

  console.log('\n4 · Tab in a bullet of a text box\n')
  await fresh([{ id: 'list', type: 'text', x: 120, y: 300, w: 520, h: 150, rotation: 0, opacity: 1, html: '<ul><li>One</li><li>Two</li></ul>', fontSize: 28, color: '#1E2A3A', align: 'left' }])
  await p.waitForTimeout(300)
  await edit('list')
  await p.evaluate((s) => {
    const root = document.querySelector(s)
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.data.trim() === 'Two') {
      const r = document.createRange(); r.setStart(n, 3); r.collapse(true)
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r)
    }
  }, editingInner)
  await p.keyboard.press('Tab')
  const nested = await p.evaluate((s) => document.querySelector(s)?.innerHTML.replace(/\s+/g, ' '), editingInner)
  ok(nested === '<ul><li>One<ul><li>Two</li></ul></li></ul>' && await focusIn(), `Tab still nests the bullet (${nested})`)
  await escape()

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
