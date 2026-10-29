// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The inspector's Design | Presenting tabs, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-inspector-tabs-browser.mjs
//
// WHAT THIS PROVES:
//   1. an element's sections split by what they are about: the look
//      (Typography, Position & size, Effects) on Design, the show
//      (Presenting, Morph) on Presenting; the tabs head the panel, and
//      Layers shows on both, right under them;
//   2. the slide's own panel splits the same way (Slide and Theme on Design;
//      Slideshow and Interactivity on Presenting — speaker notes have their
//      own pane under the canvas, test-slides-notes-pane-browser.mjs);
//   3. switching tabs does not rebuild the panel (a field is the same node);
//   4. the chosen tab holds across a new selection and a reload;
//   5. all of it in Portuguese too: sections are matched by their translated
//      title, which is also what makes "collapsed by default" work outside
//      English — Layers starts folded in every locale, as it does in English.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const [locale, L] of [
    ['en-US', { design: 'Design', show: 'Presenting', typo: 'Typography', pos: 'Position & size', layers: 'Layers', notes: 'Speaker notes', slide: 'Slide', slideshow: 'Slideshow' }],
    ['pt-BR', { design: 'Design', show: 'Apresentação', typo: 'Tipografia', pos: 'Posição e tamanho', layers: 'Camadas', notes: 'Notas do apresentador', slide: 'Slide', slideshow: 'Apresentação de slides' }],
  ]) {
    const tag = `[${locale}]`
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    const url = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href
    await p.goto(url)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    await p.evaluate(() => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', notes: '', elements: [
        { id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 100, rotation: 0, opacity: 1, html: 'A', fontSize: 32, color: '#1E2A3A' },
        { id: 'b', type: 'text', x: 700, y: 100, w: 400, h: 100, rotation: 0, opacity: 1, html: 'B', fontSize: 32, color: '#1E2A3A' },
      ] }]
      window.bento.loadDoc(JSON.stringify(d))
    })
    await p.waitForTimeout(400)
    const pick = async (id) => {
      const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(250)
    }
    const visible = () => p.$$eval('.ed-props > .ed-section', (hs) => hs.filter((h) => getComputedStyle(h).display !== 'none').map((h) => h.textContent))
    const tab = (name) => p.locator('.ed-props .ed-tabs [role="tab"]', { hasText: new RegExp(`^${name}$`, 'i') })

    await pick('a')
    ok(await p.locator('.ed-props .ed-tabs [role="tab"]').count() === 2, `${tag} two tabs`)
    await tab(L.design).click()
    let v = await visible()
    ok(v.includes(L.typo) && v.includes(L.pos) && !v.includes(L.show), `${tag} Design shows the look, not the show (${v.join(', ')})`)
    ok(await p.$eval('.ed-props', (h) => h.firstElementChild?.classList.contains('ed-tabs')), `${tag} the tabs head the panel`)
    ok(v[0] === L.layers, `${tag} Layers comes first under them`)
    const field = await p.locator('.ed-props input[type="number"]').first().elementHandle()
    await tab(L.show).click()
    v = await visible()
    ok(v.includes(L.show) && !v.includes(L.typo) && !v.includes(L.pos), `${tag} Presenting shows the show, not the look (${v.join(', ')})`)
    ok(v.includes(L.layers), `${tag} Layers is on both`)
    ok(await field.evaluate((n) => n.isConnected), `${tag} switching tabs does not rebuild the panel`)
    ok(await p.locator('.ed-props .ed-section', { hasText: new RegExp(`^${L.layers}$`) }).evaluate((h) => h.classList.contains('closed')), `${tag} Layers starts folded`)

    await pick('b')
    ok(await tab(L.show).getAttribute('aria-selected') === 'true', `${tag} the tab holds across a new selection`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(250)
    v = await visible()
    ok(v.includes(L.slideshow) && !v.includes(L.slide), `${tag} the slide's panel: Slideshow on Presenting (${v.join(', ')})`)
    await tab(L.design).click()
    v = await visible()
    ok(v.includes(L.slide) && !v.includes(L.notes), `${tag} the slide's panel: Slide on Design (${v.join(', ')})`)
    await tab(L.show).click()
    await p.reload()
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
    ok(await tab(L.show).getAttribute('aria-selected') === 'true', `${tag} the tab holds across a reload`)
    ok(errors.length === 0, `${tag} no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
