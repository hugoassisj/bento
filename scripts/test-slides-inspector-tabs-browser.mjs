// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The inspector's information architecture, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-inspector-tabs-browser.mjs
//
// WHAT THIS PROVES — every control has ONE home, decided by what it is about:
//   1. Format (how it looks): the element's own section — which carries Role,
//      what it IS in a layout — Typography, Position & size (geometry only),
//      Appearance (Opacity with blend, blur and shadow), Arrange;
//   2. Animate (how it moves): Animation and Morph — and, for a slide, its
//      Transition, which used to sit on the look side beside Background;
//   3. Interact (what it does when pointed at): Interactivity — links and hover,
//      split out of what was one "Presenting" drawer of motion and behaviour;
//   4. the slide's panel separates the SLIDE (Slide, Layout) from the whole
//      DECK (Theme, and Document: page size and slideshow chrome);
//   5. a tab with nothing for the selection says so instead of going blank;
//   6. Layers is not in the inspector at all: it is the side column's second
//      view (Slides | Layers), where clicking a row selects;
//   7. switching tabs never rebuilds the panel; the tab and the side view hold
//      across a selection and a reload; a stored tab from the two-tab build
//      ('show') opens on Animate;
//   8. all of it in Portuguese too — sections are matched by translated title.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const EN = {
  format: 'Format', animate: 'Animate', interact: 'Interact', text: 'Text', typo: 'Typography', pos: 'Position & size', look: 'Appearance', arrange: 'Arrange',
  anim: 'Animation', morph: 'Morph', inter: 'Interactivity', slide: 'Slide', layout: 'Layout', theme: 'Theme', deck: 'Deck', trans: 'Transition',
  role: 'Role', opacity: 'Opacity', pageSize: 'Page size', link: 'Link to', empty: 'Nothing to set here for this selection.',
}
const PT = {
  format: 'Formato', animate: 'Animar', interact: 'Interação', text: 'Texto', typo: 'Tipografia', pos: 'Posição e tamanho', look: 'Aparência', arrange: 'Organizar',
  anim: 'Animação', morph: 'Morph', inter: 'Interatividade', slide: 'Slide', layout: 'Layout', theme: 'Tema', deck: 'Documento', trans: 'Transição',
  role: 'Função', opacity: 'Opacidade', pageSize: 'Tamanho da página', link: 'Vincular a', empty: 'Nada a ajustar aqui para esta seleção.',
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const [locale, L] of [['en-US', EN], ['pt-BR', PT]]) {
    const tag = `[${locale}]`
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale })
    await ctx.route(/^https?:/, (r) => r.abort())
    // a stored choice from the two-tab build, seeded once
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('bento-panel-tab', '"show"'); sessionStorage.setItem('seeded', '1') } })
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    await p.evaluate(() => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      const txt = (id, x) => ({ id, type: 'text', x, y: 100, w: 400, h: 100, rotation: 0, opacity: 1, html: id.toUpperCase(), fontSize: 32, color: '#1E2A3A' })
      d.slides = [{ id: 's1', background: '#ffffff', notes: '', elements: [txt('a', 100), txt('b', 700)] }]
      window.bento.loadDoc(JSON.stringify(d))
    })
    await p.waitForTimeout(400)
    const pick = async (id, shift = false) => {
      const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
      if (shift) await p.keyboard.down('Shift')
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(250)
      if (shift) await p.keyboard.up('Shift')
    }
    const tab = (name) => p.locator('.ed-props .ed-tabs [role="tab"]', { hasText: new RegExp(`^${name}$`, 'i') })
    const shown = () => p.$$eval('.ed-props > .ed-section, .ed-props > .ed-tab-empty', (hs) => hs.filter((h) => getComputedStyle(h).display !== 'none').map((h) => h.textContent))
    const rowsIn = (section) => p.evaluate((s) => {
      const h = [...document.querySelectorAll('.ed-props > .ed-section')].find((x) => x.textContent === s)
      return [...(h?.nextElementSibling?.querySelectorAll('.ed-row > span:first-child, .ed-mini > span') ?? [])].map((n) => n.textContent)
    }, section)
    const on = async (name) => { await tab(name).click(); return shown() }

    ok(await tab(L.animate).getAttribute('aria-selected') === 'true', `${tag} a stored 'show' tab opens on Animate`)
    await pick('a')
    ok(await p.locator('.ed-props .ed-tabs [role="tab"]').count() === 3, `${tag} three tabs`)
    ok(await p.$eval('.ed-props', (h) => h.firstElementChild?.classList.contains('ed-tabs')), `${tag} the tabs head the panel`)
    const field = await p.locator('.ed-props input[type="number"]').first().elementHandle()

    let v = await on(L.format)
    ok(JSON.stringify(v) === JSON.stringify([L.text, L.typo, L.pos, L.look, L.arrange]), `${tag} Format: the look, in order (${v.join(', ')})`)
    ok((await rowsIn(L.text)).includes(L.role), `${tag} Role sits with the element's own section`)
    const pos = await rowsIn(L.pos)
    ok(!pos.includes(L.opacity) && !pos.includes(L.role), `${tag} Position & size is geometry only (${pos.join(', ')})`)
    ok((await rowsIn(L.look))[0] === L.opacity, `${tag} Appearance leads with Opacity`)
    v = await on(L.animate)
    ok(JSON.stringify(v) === JSON.stringify([L.anim, L.morph]), `${tag} Animate: motion only (${v.join(', ')})`)
    v = await on(L.interact)
    ok(JSON.stringify(v) === JSON.stringify([L.inter]), `${tag} Interact: behaviour only (${v.join(', ')})`)
    ok((await rowsIn(L.inter)).includes(L.link), `${tag} links live on Interact`)
    ok(await field.evaluate((n) => n.isConnected), `${tag} switching tabs does not rebuild the panel`)
    ok(await p.locator('.ed-props .ed-layers').count() === 0, `${tag} the inspector carries no layer list`)

    await pick('b')
    ok(await tab(L.interact).getAttribute('aria-selected') === 'true', `${tag} the tab holds across a new selection`)
    await pick('a', true)
    v = await shown()
    ok(JSON.stringify(v) === JSON.stringify([L.empty]), `${tag} an empty tab says so (${v.join(', ')})`)

    await p.keyboard.press('Escape'); await p.waitForTimeout(250)
    v = await on(L.format)
    ok(JSON.stringify(v) === JSON.stringify([L.slide, L.layout, L.theme, L.deck]), `${tag} the slide's Format: slide, then deck (${v.join(', ')})`)
    ok((await rowsIn(L.deck)).includes(L.pageSize) && !(await rowsIn(L.slide)).includes(L.pageSize), `${tag} page size is the deck's, not the slide's`)
    ok(!(await rowsIn(L.slide)).includes(L.trans), `${tag} Transition left the look side`)
    v = await on(L.animate)
    ok(JSON.stringify(v) === JSON.stringify([L.trans]), `${tag} the slide's Animate: its Transition (${v.join(', ')})`)
    v = await on(L.interact)
    ok(JSON.stringify(v) === JSON.stringify([L.inter]), `${tag} the slide's Interact (${v.join(', ')})`)

    // the side column
    const side = (view) => p.locator(`.ed-side-tabs [data-view="${view}"]`)
    await side('layers').click(); await p.waitForTimeout(150)
    ok(await p.locator('.ed-side-layers .ed-layer').count() === 2 && !(await p.locator('.ed-thumbs').isVisible()), `${tag} Layers replaces the thumbnails in the side column`)
    await p.locator('.ed-side-layers .ed-layer').first().click(); await p.waitForTimeout(200)
    ok((await p.evaluate(() => window.bento.selection)).length === 1, `${tag} clicking a layer row selects`)
    await tab(L.animate).click()
    await p.reload()
    await p.waitForFunction(() => document.querySelector('.ed-props .ed-tabs') && document.querySelector('.ed-side-tabs'))
    ok(await tab(L.animate).getAttribute('aria-selected') === 'true', `${tag} the tab holds across a reload`)
    ok(await side('layers').getAttribute('aria-selected') === 'true', `${tag} so does the side view`)
    ok(errors.length === 0, `${tag} no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
