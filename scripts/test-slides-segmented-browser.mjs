// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// One-click segmented controls in the inspector, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-segmented-browser.mjs
//
// WHAT THIS PROVES:
//   1. text Align and V-align are segmented: every option visible, ONE click
//      sets it, and the pressed state (aria-checked) follows the model;
//   2. clicking the row's caption changes nothing — a <label> row would have
//      handed that click to the first segment and aligned the text left;
//   3. word segments (Interior) fit their row in the longest bundled
//      translation, with no option cut off;
//   4. the inspector never offers a <select> for these choices again.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const locale of ['en-US', 'pt-BR']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    await p.evaluate(() => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', elements: [
        { id: 'txt', type: 'text', x: 200, y: 200, w: 500, h: 160, rotation: 0, opacity: 1, html: 'Hello', fontSize: 40, color: '#1E2A3A', align: 'left', valign: 'top', textStroke: { width: 2, color: '#000000' } },
      ] }]
      window.bento.loadDoc(JSON.stringify(d))
    })
    await p.waitForTimeout(400)
    const b = await p.locator('.ed-stage-scale [data-el-id="txt"]').boundingBox()
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await p.waitForTimeout(300)
    const model = () => p.evaluate(() => { const e = window.bento.doc.slides[0].elements[0]; return `${e.align}/${e.valign}/${e.textStroke?.fill ?? 'filled'}` })
    const segs = p.locator('.ed-props .ed-seg')
    const tag = `[${locale}]`

    if (locale === 'en-US') {
      ok(await segs.count() === 3, `${tag} Align, V-align and Interior are segmented (${await segs.count()})`)
      const align = segs.nth(0)
      ok(await align.locator('button').count() === 3, `${tag} all three alignments are visible at rest`)
      await align.locator('button').nth(1).click(); await p.waitForTimeout(250)
      ok(await model() === 'center/top/filled', `${tag} one click centres the text (${await model()})`)
      ok(await p.locator('.ed-props .ed-seg').nth(0).locator('button[aria-checked="true"]').getAttribute('title') === 'center', `${tag} the pressed segment follows the model`)
      await p.locator('.ed-props .ed-seg').nth(1).locator('button').nth(2).click(); await p.waitForTimeout(250)
      ok(await model() === 'center/bottom/filled', `${tag} one click sets V-align (${await model()})`)
      await p.locator('.ed-props .ed-row > span', { hasText: /^Align$/ }).click(); await p.waitForTimeout(250)
      ok(await model() === 'center/bottom/filled', `${tag} clicking the caption changes nothing`)
      await p.locator('.ed-props .ed-seg').nth(2).locator('button', { hasText: 'hollow' }).click(); await p.waitForTimeout(250)
      ok(await model() === 'center/bottom/none', `${tag} a word segment sets Interior (${await model()})`)
      const selects = await p.$$eval('.ed-props select', (ss) => ss.map((s) => [...s.options].map((o) => o.value).join(',')))
      ok(!selects.some((v) => /^(left,center,right|top,middle,bottom|filled,hollow)$/.test(v)), `${tag} no <select> left for these choices`)
    }
    const clipped = await p.$$eval('.ed-props .ed-seg button', (bs) => bs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent))
    ok(clipped.length === 0, `${tag} no segment is cut off${clipped.length ? ': ' + clipped.join(', ') : ''}`)
    ok(errors.length === 0, `${tag} no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
