// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Text pasted onto the slide (no text box open) keeps its formatting, fits its
// box, and does not stack — in the built shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-paste-slide-html-browser.mjs
//
// The clipboard is handed to the editor's paste handler as a ClipboardEvent
// carrying both flavours — the system clipboard of a headless browser is not
// dependable, the editor's code paths are (as test-slides-paste-position-
// browser.mjs does).
//   1. An html clipboard becomes ONE text element that keeps bold and a real
//      list, left- and top-aligned, no wider than the slide's content width,
//      and as tall as window.bento.measure() says its text needs.
//   2. Pasting it again lands somewhere else: repeats step +20/+20.
//   3. A plain-text clipboard still makes the text element it always made
//      (same html), a ``` fenced block still becomes a Code element, and a
//      spreadsheet grid (an html table) still takes the plain path.
//   4. Hostile clipboard html — an img with onerror, a script, style and
//      event attributes, a javascript: link, an image pointing at a server —
//      leaves none of it in the stored element, runs nothing and loads
//      nothing: no clipboard node ever reaches the live document unsanitised.
//   5. Pasting inside an open text box behaves as before: formatting kept in
//      that box, no new element.
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
  // anything the pasted html manages to load shows up here
  const fetched = []
  await ctx.route(/^https?:/, (r) => { fetched.push(r.request().url()); return r.abort() })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  const load = async (els = []) => {
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
  const measure = (id) => p.evaluate((id) => window.bento.measure(id), id)
  // a paste onto the slide, as the browser would deliver ⌘V
  const paste = (flavours, target) => p.evaluate(({ flavours, target }) => {
    const dt = new DataTransfer()
    for (const [type, data] of Object.entries(flavours)) dt.setData(type, data)
    const at = target ? document.querySelector(target) : document
    at.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
  }, { flavours, target }).then(() => p.waitForTimeout(300))

  const HTML = '<p>Revenue <b>grew</b> 12%</p><ul><li>EMEA</li><li>APAC</li></ul>'
  const PLAIN = 'Revenue grew 12%\nEMEA\nAPAC'

  console.log('\nan html clipboard keeps its formatting and fits its box\n')
  await load()
  await paste({ 'text/html': HTML, 'text/plain': PLAIN })
  let all = await els()
  ok(all.length === 1 && all[0].type === 'text', `one text element (${all.map((e) => e.type).join(', ')})`)
  const a = all[0]
  ok(/<b>grew<\/b>/.test(a?.html ?? ''), `its html keeps the bold (${a?.html})`)
  ok(/<ul>\s*<li>EMEA<\/li>\s*<li>APAC<\/li>\s*<\/ul>/.test(a?.html ?? ''), 'and a real list with two items')
  const m = await measure(a.id)
  ok(Math.abs(a.h - m.height) <= 2, `its height is what measure() says the text needs (box ${a.h}, measured ${m.height})`)
  ok(a.align === 'left' && a.valign === 'top', `left- and top-aligned (${a.align} / ${a.valign})`)
  const W = await p.evaluate(() => window.bento.doc.size.width)
  const content = W - 2 * Math.round(96 * W / 1280)
  ok(a.w <= content && a.x >= 0 && a.x + a.w <= W && a.y >= 0 && a.y + a.h <= 720, `on the slide, no wider than its content width (x ${a.x}, w ${a.w} ≤ ${content})`)
  ok(await p.evaluate(() => window.bento.selection.length === 1), 'the new box is selected')

  console.log('\npasting again does not stack\n')
  await paste({ 'text/html': HTML, 'text/plain': PLAIN })
  all = await els()
  const b = all[1]
  ok(all.length === 2 && b && (b.x !== a.x || b.y !== a.y), `the second paste lands elsewhere (${a.x},${a.y} then ${b?.x},${b?.y})`)
  await paste({ 'text/html': HTML, 'text/plain': PLAIN })
  all = await els()
  const c = all[2]
  ok(all.length === 3 && c && new Set(all.map((e) => `${e.x},${e.y}`)).size === 3, `and a third lands somewhere else again (${c?.x},${c?.y})`)

  console.log('\nplain text and fenced code as before\n')
  await load()
  await paste({ 'text/plain': 'Hello <world> & you\nSecond line' })
  all = await els()
  ok(all.length === 1 && all[0].type === 'text' && all[0].html === 'Hello &lt;world&gt; &amp; you<br>Second line', `plain text makes the same text element as before (${all[0]?.html})`)
  ok(Math.abs(all[0].h - (await measure(all[0].id)).height) <= 2, `and its box fits its text too (h ${all[0].h})`)
  await load()
  await paste({ 'text/plain': 'Look:\n```js\nconst a = 1\n```\n', 'text/html': '<pre>Look:\n```js\nconst a = 1\n```</pre>' })
  all = await els()
  ok(all.some((e) => e.type === 'code' && /const a = 1/.test(e.content)), `a fenced block still becomes a Code element (${all.map((e) => e.type).join(', ')})`)
  // a spreadsheet grid (an html table) is left to the plain path, as before
  await load()
  await paste({ 'text/plain': 'Region\tQ3\nEMEA\t12' })
  const plainGrid = (await els())[0]?.html
  await load()
  await paste({ 'text/plain': 'Region\tQ3\nEMEA\t12', 'text/html': '<table><tr><td>Region</td><td>Q3</td></tr><tr><td>EMEA</td><td>12</td></tr></table>' })
  all = await els()
  ok(all.length === 1 && all[0].html === plainGrid, `a spreadsheet grid pastes as the plain text it always did (${all[0]?.html})`)

  console.log('\nhostile clipboard html\n')
  await load()
  await p.evaluate(() => { window.__pwned = 0 })
  const before = fetched.length
  await paste({
    'text/html': '<p style="color:red;background:url(https://evil.example/bg.png)" onclick="window.__pwned=1">Hi <img src="https://evil.example/x.png" onerror="window.__pwned=2"><script>window.__pwned=3</script><a href="javascript:window.__pwned=4">link</a> <a href="https://ok.example/">fine</a></p><svg onload="window.__pwned=5"></svg><iframe src="https://evil.example/f"></iframe>',
    'text/plain': 'Hi link fine',
  })
  await p.waitForTimeout(400)
  all = await els()
  const h = all[0]?.html ?? ''
  ok(all.length === 1 && /Hi/.test(h), `one text element with the words (${h})`)
  for (const bad of ['<img', 'onerror', 'onclick', 'onload', '<script', 'style=', 'javascript:', '<svg', '<iframe', 'evil.example']) ok(!h.includes(bad), `no ${bad} in the stored html`)
  ok(/href="https:\/\/ok\.example\/"/.test(h), 'a web link survives as a link')
  ok(await p.evaluate(() => window.__pwned) === 0, 'nothing in the clipboard ran')
  ok(fetched.slice(before).every((u) => !u.includes('evil.example')), `nothing in the clipboard loaded (${fetched.slice(before).join(' ')})`)

  console.log('\npasting inside an open text box\n')
  await load([{ id: 'box', type: 'text', x: 200, y: 200, w: 600, h: 60, rotation: 0, opacity: 1, html: 'Start', fontSize: 24, fontFamily: 'system-ui, sans-serif', fontWeight: 400, color: '#1E2A3A', align: 'left', valign: 'top', lineHeight: 1.25 }])
  const bb = await p.locator('.ed-stage-scale [data-el-id="box"]').boundingBox()
  await p.mouse.dblclick(bb.x + 20, bb.y + 15); await p.waitForTimeout(300)
  ok(await p.evaluate(() => !!document.querySelector('.ed-stage-scale .bento-editing')), 'the box is open for editing')
  await p.keyboard.press('End')
  await paste({ 'text/html': HTML, 'text/plain': PLAIN }, '.ed-stage-scale .bento-editing .bento-text-inner')
  await p.keyboard.press('Escape'); await p.waitForTimeout(300)
  all = await els()
  ok(all.length === 1, `no new element (${all.length})`)
  ok(/<b>grew<\/b>/.test(all[0].html) && /<li>EMEA<\/li>/.test(all[0].html), `the box itself keeps the bold and the list (${all[0].html})`)
  ok(all[0].h > 60, `and grows (${all[0].h})`)

  ok(errors.length === 0, `no page errors (${errors.join(' | ')})`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
