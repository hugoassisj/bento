// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The inspector fits its column, in the longest languages, across the whole showcase deck.
//
//   npm run build:single --prefix slides && node scripts/test-slides-inspector-look-browser.mjs
//
// WHAT THIS PROVES, at the panel's default width (236px), in en, pt and de,
// for every element of every showcase slide and each slide itself, on all
// three tabs:
//   1. no visible control reaches past the panel's edge (the first audit
//      measured the bullet buttons 75px past it);
//   2. no dropdown cuts off its chosen value while a wider layout was there:
//      a row too narrow for it gives the dropdown the full width, caption
//      above (a value longer than the whole panel may then ellipsise);
//   3. the Arrange kit is icon buttons, each with a hint; Spacing appears only
//      for two or more elements, even gaps only for three;
//   4. a numeric pair carries its label inside the field (X 96), Penpot-style.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const locale of ['en-US', 'pt-BR', 'de-DE']) {
    const tag = `[${locale}]`
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
    const width = await p.evaluate(() => Math.round(document.querySelector('.ed-props').getBoundingClientRect().width))

    const over = new Set(), cut = new Set()
    const measure = () => p.evaluate(() => {
      const h = document.querySelector('.ed-props'), pr = h.getBoundingClientRect()
      const name = (c) => (c.closest('.ed-row')?.firstElementChild?.textContent || c.textContent || c.tagName).trim().slice(0, 32)
      const o = [...h.querySelectorAll('button, select, input, span, label, p')].filter((c) => c.offsetParent && c.getBoundingClientRect().right > pr.right - 1).map(name)
      const m = document.createElement('canvas').getContext('2d')
      // a value longer than the whole panel may ellipsise — once it HAS the full width
      const t = [...h.querySelectorAll('select')].filter((s) => s.offsetParent && !s.parentElement.classList.contains('ed-row-stack')).filter((s) => {
        m.font = getComputedStyle(s).font
        return m.measureText(s.options[s.selectedIndex]?.text ?? '').width > s.clientWidth - 20
      }).map((s) => `${name(s)}: ${s.options[s.selectedIndex]?.text}`)
      return { o, t }
    })
    const n = await p.evaluate(() => window.bento.doc.slides.length)
    for (let s = 0; s < n; s++) {
      await p.locator('.ed-sidebar .ed-thumb').nth(s).evaluate((x) => x.click()); await p.waitForTimeout(120)
      const ids = await p.evaluate((s) => window.bento.doc.slides[s].elements.map((e) => e.id), s)
      for (const id of [null, ...ids]) {
        if (id) await p.evaluate((id) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.click(), id)
        else await p.keyboard.press('Escape')
        await p.waitForTimeout(60)
        for (const t of await p.locator('.ed-props .ed-tabs [role=tab]').all()) {
          await t.click()
          const r = await measure()
          r.o.forEach((x) => over.add(x)); r.t.forEach((x) => cut.add(x))
        }
      }
    }
    ok(width <= 240, `${tag} measured at the default width (${width}px)`)
    ok(over.size === 0, `${tag} nothing reaches past the panel's edge${over.size ? ': ' + [...over].join(' | ') : ''}`)
    ok(cut.size === 0, `${tag} no dropdown cuts off its value${cut.size ? ': ' + [...cut].join(' | ') : ''}`)

    if (locale === 'en-US') {
      // a fresh slide with three boxes, for the Arrange kit and the numeric fields
      await p.evaluate(() => {
        const d = JSON.parse(JSON.stringify(window.bento.doc))
        const box = (id, x) => ({ id, type: 'shape', shape: 'rect', x, y: 200, w: 160, h: 100, rotation: 0, opacity: 1, fill: '#5E7699' })
        d.slides = [{ id: 's1', background: '#ffffff', notes: '', elements: [box('a', 100), box('b', 500), box('c', 900)] }]
        window.bento.loadDoc(JSON.stringify(d))
      })
      await p.waitForTimeout(400)
      const pick = (ids) => p.evaluate((ids) => { for (const [i, id] of ids.entries()) document.querySelector(`.ed-layer[data-id="${id}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: i > 0 })) }, ids)
      await p.locator('.ed-props .ed-tabs [role=tab]').first().click()
      const kit = () => p.$$eval('.ed-props .ed-arrange-row', (rows) => rows.map((r) => ({ cap: r.querySelector('.ed-arrange-cap')?.textContent, n: r.querySelectorAll('.ed-btn').length, icons: [...r.querySelectorAll('.ed-btn')].every((b) => b.querySelector('svg') && !b.textContent.trim() && (b.title || b.dataset.hint)) })))
      await pick(['a']); await p.waitForTimeout(200)
      let k = await kit()
      ok(k.every((r) => r.icons), 'every Arrange button is an icon with a hint')
      ok(JSON.stringify(k.map((r) => r.cap)) === '["Align","Order"]', `one element: Align and Order only (${k.map((r) => r.cap).join(', ')})`)
      await pick(['a', 'b']); await p.waitForTimeout(200)
      k = await kit()
      ok(k.find((r) => r.cap === 'Spacing')?.n === 2, 'two: Spacing appears, with the two match-size buttons')
      await pick(['a', 'b', 'c']); await p.waitForTimeout(200)
      k = await kit()
      ok(k.find((r) => r.cap === 'Spacing')?.n === 4, 'three: even gaps join them')
      await pick(['a']); await p.waitForTimeout(200)
      const inside = await p.evaluate(() => {
        const m = [...document.querySelectorAll('.ed-props .ed-mini')].find((x) => x.querySelector('span')?.textContent === 'X')
        if (!m) return false
        // inside the INPUT's own box (which keeps THE FIELD's look, #729), and
        // clear of the value, which starts after the label
        const inp = m.querySelector('input'), f = inp.getBoundingClientRect(), l = m.querySelector('span').getBoundingClientRect()
        return l.left >= f.left && l.right <= f.right && l.top >= f.top && l.bottom <= f.bottom &&
          parseFloat(getComputedStyle(inp).paddingLeft) >= l.right - f.left
      })
      ok(inside, 'a numeric pair carries its label inside the field')
    }
    ok(errors.length === 0, `${tag} no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
