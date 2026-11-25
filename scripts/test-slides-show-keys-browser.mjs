// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The show's keys are bento's own: a ? sheet lists them, and Reveal's stray keys are gone.
//
//   npm run build:single --prefix slides && node scripts/test-slides-show-keys-browser.mjs [shell]
//
// WHAT THIS PROVES, on the Showcase (which has state slides) with reveal steps
// added to slide 2 and a state slide appended at the end, with real keys:
//   1. the keys Reveal used to own — / . ; : V J K C A — do nothing: the
//      index does not move, `.reveal` never gets `paused`, no overlay opens;
//   2. a REAL Shift+/ (Shift held down, so the event carries shiftKey — a
//      bare press('?') without Shift is what misled the audit), F1 and H open
//      a sheet of the show's keys inside the overlay: role=dialog, named by its
//      title, focused; any key closes it without doing anything else, Esc
//      included (the show goes on), and focus goes back to the show; a
//      Ctrl/Alt chord passes to the browser and leaves the sheet open;
//   3. N and P walk exactly like → and ←: the same (slide, hidden steps)
//      sequence through the steps and past the state slides, and on a black
//      screen N, like →, only wakes it (MP-07) — the deck does not move;
//      ↑ and ↓ walk and wake exactly like ← and → as well;
//   4. Home and End land on the first and last slide of the linear flow,
//      never on the trailing state slide;
//   5. O opens the show's slide grid (MP-09), never Reveal's overview, and Esc
//      closes it without ending the show;
//   6. the sheet's text comes from the catalogs (de) and turns around under
//      an RTL chrome (the overlay itself stays LTR: it draws the document);
//   7. the first show in a browser says "Press ? for keyboard shortcuts"
//      once; the next show does not;
//   8. the speaker window never shows the sheet.
// On the parent commit 1, 2, 3, 4 and 7 fail.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.argv[2] || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
async function open(locale = 'en-US', viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport, locale })
  // never reach the network: offline mode, no sockets, no http(s)
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-reduce-motion', 'on') } catch {} })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'), null, { timeout: 20000 })
  // steps on slide 2 (two elements, steps 1 and 2) and a state slide at the end
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const els = d.slides[1].elements.filter((e) => e.type === 'text')
    els[0].fx = { ...(els[0].fx || {}), step: 1 }
    els[els.length - 1].fx = { ...(els[els.length - 1].fx || {}), step: 2 }
    d.slides.push({ ...JSON.parse(JSON.stringify(d.slides[0])), id: 'mp08-end-state', stateOf: d.slides[0].id })
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(300)
  return { ctx, p, errors }
}
const start = async (p) => {
  await p.evaluate(() => document.querySelector('.ed-keys-overlay, .ed-about-overlay')?.remove())
  await p.evaluate(() => document.querySelectorAll('.ed-sidebar .ed-thumb')[0]?.click())
  await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
  await p.keyboard.press('F5')
  await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section.present'), null, { timeout: 10000 })
  await p.waitForTimeout(500)
}
const state = (p) => p.evaluate(() => {
  const r = document.querySelector('.bento-present-overlay .reveal')
  if (!r) return null
  const secs = [...r.querySelectorAll('.slides > section')]
  const cur = r.querySelector('.slides > section.present')
  const sheet = document.querySelector('.bento-show-keys')
  return {
    h: secs.indexOf(cur), hidden: cur ? cur.querySelectorAll('.bento-step-hidden').length : -1,
    paused: r.classList.contains('paused'), overview: r.classList.contains('overview'),
    revealOverlay: document.querySelectorAll('.r-overlay').length, sheet: !!sheet,
  }
})
const press = async (p, k, wait = 220) => { await p.keyboard.press(k); await p.waitForTimeout(wait) }
const shiftSlash = async (p) => { await p.keyboard.down('Shift'); await p.keyboard.press('Slash'); await p.keyboard.up('Shift'); await p.waitForTimeout(250) }

try {
  // ——— English, the main walk ———
  {
    const { ctx, p, errors } = await open()
    const meta = await p.evaluate(() => ({ n: window.bento.doc.slides.length, states: window.bento.doc.slides.map((s, i) => s.stateOf ? i : -1).filter((i) => i >= 0) }))
    ok(meta.states.length >= 2 && meta.states.includes(meta.n - 1), `CONTROL: the deck has state slides, the last one among them (${meta.states.join(',')} of ${meta.n})`)
    await start(p)
    const hint = await p.evaluate(() => { const el = document.querySelector('.bento-present-toast'); return el ? { text: el.textContent, on: el.classList.contains('show') } : null })
    ok(hint?.on && /\?/.test(hint.text), `7. the first show says where the keys are (${JSON.stringify(hint)})`)
    await press(p, 'ArrowRight'); await press(p, 'ArrowRight') // somewhere in the middle: slide 2, after its first step
    const before = await state(p)
    ok(before && before.h === 1 && before.hidden === 1, `CONTROL: → twice lands on slide 2 with one of its two steps still hidden (${JSON.stringify(before)})`)

    // 1. retired keys
    const retired = [['Slash', '/'], ['Period', '.'], ['Semicolon', ';'], ['Shift+Semicolon', ':'], ['v', 'V'], ['j', 'J'], ['k', 'K'], ['c', 'C'], ['a', 'A']]
    for (const [k, name] of retired) {
      await press(p, k)
      const s = await state(p)
      ok(s && s.h === before.h && s.hidden === before.hidden && !s.paused && !s.overview && !s.revealOverlay && !s.sheet,
        `1. ${name} does nothing (${JSON.stringify(s)})`)
    }

    // 2. the sheet, with a real Shift+/
    await shiftSlash(p)
    const sheet = await p.evaluate(() => {
      const box = document.querySelector('.bento-present-overlay .bento-show-keys [role="dialog"]')
      if (!box) return null
      const title = document.getElementById(box.getAttribute('aria-labelledby') || '')
      const r = box.getBoundingClientRect()
      return {
        modal: box.getAttribute('aria-modal'), title: title?.textContent, inBox: !!title && box.contains(title),
        rows: [...box.querySelectorAll('tr')].map((tr) => [...tr.cells[0].querySelectorAll('kbd')].map((k) => k.textContent)), focused: box.contains(document.activeElement),
        visible: r.width > 100 && r.height > 100 && getComputedStyle(box).visibility === 'visible',
        dir: getComputedStyle(box).direction,
      }
    })
    ok(!!sheet && sheet.visible, `2. Shift+/ opens the sheet inside the show (${JSON.stringify(sheet && { rows: sheet.rows.length })})`)
    ok(sheet?.modal === 'true' && sheet.inBox && sheet.title === 'Keyboard shortcuts', `2. it is a modal dialog named by its title ("${sheet?.title}")`)
    ok(sheet?.focused, '2. focus moves into the sheet')
    const want = ['→', '↓', 'PageDown', 'Space', '←', '↑', 'PageUp', 'Home', 'End', 'S', 'F', 'B', 'L', 'M', 'G', 'O', '?', 'F1', 'Esc']
    const caps = (sheet?.rows ?? []).flat()
    ok(want.every((k) => caps.includes(k)), `2. it lists the show's keys (${(sheet?.rows ?? []).map((r) => r.join(' ')).join(' | ')})`)
    ok(!caps.includes('V') && !caps.includes('J'), '2. and nothing it does not do or does not advertise (no V, J)')
    ok(sheet?.dir === 'ltr', `6. CONTROL: in English the sheet reads left to right (${sheet?.dir})`)
    let s = await state(p)
    ok(s && !s.paused && s.h === before.h && s.hidden === before.hidden, `2. opening it pauses nothing and moves nothing (${JSON.stringify(s)})`)
    await press(p, 'ArrowRight')
    s = await state(p)
    ok(s && !s.sheet && s.h === before.h && s.hidden === before.hidden, `2. any key (→) closes it and does nothing else (${JSON.stringify(s)})`)
    const focusBack = await p.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('.bento-present-overlay'))
    ok(focusBack, '2. focus is back on the show')
    await press(p, 'F1')
    ok((await state(p))?.sheet, '2. F1 opens it too')
    await press(p, 'Escape')
    s = await state(p)
    ok(s && !s.sheet && !s.paused && s.h === before.h, `2. Esc closes the sheet and the show goes on, not paused (${JSON.stringify(s)})`)
    await press(p, 'h')
    ok((await state(p))?.sheet, '2. H opens it too')
    await p.mouse.click(640, 400); await p.waitForTimeout(200)
    s = await state(p)
    ok(s && !s.sheet && s.h === before.h && s.hidden === before.hidden, `2. a click closes it, and does not reach the slide (${JSON.stringify(s)})`)
    await shiftSlash(p); await shiftSlash(p)
    ok(!(await state(p))?.sheet, '2. a second ? closes it')
    // a Ctrl/⌘/Alt chord is the browser's, even with the sheet open: it reaches
    // the window unhandled and the sheet stays; a plain key then closes it
    await shiftSlash(p)
    await p.evaluate(() => { window.__chord = []; window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.altKey) && e.key.length === 1) window.__chord.push(`${e.key}:${e.defaultPrevented}`) }) })
    await press(p, 'Control+j'); await press(p, 'Alt+z')
    const chord = await p.evaluate(() => window.__chord)
    s = await state(p)
    ok(s?.sheet && chord.join() === 'j:false,z:false', `2. a Ctrl or Alt chord passes to the browser and leaves the sheet open (${JSON.stringify(chord)}, sheet ${s?.sheet})`)
    await press(p, 'x')
    ok(!(await state(p))?.sheet, '2. then a plain key closes it')

    // 3. N/P walk like →/←
    const walk = async (key, n) => { const out = []; for (let i = 0; i < n; i++) { await press(p, key, 180); const q = await state(p); out.push(q ? `${q.h}/${q.hidden}` : 'ended') } return out.join(' ') }
    if (!(await state(p))) await start(p) // a show that ended above still gets measured here
    await press(p, 'Home')
    const arrows = await walk('ArrowRight', 20)
    await press(p, 'Home')
    const ns = await walk('n', 20)
    ok(ns === arrows, `3. N walks like → (→ ${arrows} | N ${ns})`)
    ok(!meta.states.some((i) => ns.split(' ').some((x) => +x.split('/')[0] === i)), '3. and never onto a state slide')
    ok(ns.startsWith('1/2 1/1 1/0 2/0 '), `3. and reveals slide 2's two steps before leaving it (${ns.split(' ').slice(0, 4).join(' ')})`)
    await press(p, 'End')
    const larrows = await walk('ArrowLeft', 20)
    await press(p, 'End')
    const ps = await walk('p', 20)
    ok(ps === larrows, `3. P walks like ← (← ${larrows} | P ${ps})`)
    await press(p, 'Home')
    const downs = await walk('ArrowDown', 20)
    ok(downs === arrows, `3. ↓ walks like → (↓ ${downs})`)
    await press(p, 'End')
    const ups = await walk('ArrowUp', 20)
    ok(ups === larrows, `3. ↑ walks like ← (↑ ${ups})`)
    // under a black screen N wakes it and stays put, as → does; the next N moves on
    await press(p, 'Home'); for (let i = 0; i < 4; i++) await press(p, 'n') // slide 3, past slide 2's steps
    const lit = await state(p)
    const black = () => p.evaluate(() => { const b = document.querySelector('.bento-blackout'); return !!b && !b.hidden })
    await press(p, 'b')
    ok(await black(), `CONTROL: B blacks the screen out (on ${lit?.h}/${lit?.hidden})`)
    await press(p, 'n')
    s = await state(p)
    ok(!(await black()) && s?.h === lit?.h && s?.hidden === lit?.hidden, `3. N on a black screen wakes it without moving (${lit?.h}/${lit?.hidden} → ${s?.h}/${s?.hidden})`)
    await press(p, 'n')
    s = await state(p)
    ok(s?.h === lit.h + 1, `3. the next N moves on (${s?.h})`)
    await press(p, 'b'); await press(p, 'p')
    s = await state(p)
    ok(!(await black()) && s?.h === lit.h + 1, `3. P on a black screen wakes it without moving too (${s?.h})`)
    const blackOut = async () => { if (!(await black())) await press(p, 'b') }
    await blackOut(); await press(p, 'ArrowDown')
    s = await state(p)
    ok(!(await black()) && s?.h === lit.h + 1, `3. ↓ on a black screen wakes it without moving (${s?.h})`)
    await blackOut()
    ok(await black(), 'CONTROL: black again')
    await press(p, 'ArrowUp')
    s = await state(p)
    ok(!(await black()) && s?.h === lit.h + 1, `3. ↑ on a black screen wakes it without moving (${s?.h})`)

    // 4. Home / End
    await press(p, 'End')
    s = await state(p)
    ok(s?.h === meta.n - 2, `4. End lands on the last slide of the flow (${s?.h}), not the trailing state (${meta.n - 1})`)
    await press(p, 'Home')
    s = await state(p)
    ok(s?.h === 0, `4. Home lands on the first (${s?.h})`)

    // 5. O is the slide grid now, never Reveal's overview
    const grid = () => p.evaluate(() => { const g = document.querySelector('.bento-show-grid'); return !!g && !g.hidden })
    await press(p, 'o', 400)
    ok(await grid() && !(await state(p))?.overview, '5. O opens the slide grid, not the overview')
    await press(p, 'Escape', 400)
    s = await state(p)
    ok(s && !s.overview && !(await grid()), `5. Esc closes it and the show goes on (${JSON.stringify(s)})`)

    // 7. the hint is once per browser
    await press(p, 'Escape', 400)
    ok(!(await state(p)), 'CONTROL: Esc ends the show')
    await start(p)
    const again = await p.evaluate(() => document.querySelector('.bento-present-toast.show')?.textContent ?? null)
    ok(again === null, `7. the second show says nothing (${again})`)
    ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
    await ctx.close()
  }

  // ——— the catalogs, RTL, and the speaker window ———
  {
    const { ctx, p, errors } = await open('de-DE')
    const popup = ctx.waitForEvent('page')
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.locator('.ed-present-pill .ed-menu .ed-menu-item, .ed-present-pill .ed-menu button').nth(0).waitFor()
    const items = await p.locator('.ed-present-pill .ed-menu').innerText()
    const speakerLabel = items.split('\n').find((l) => /Referentenansicht/.test(l))
    ok(!!speakerLabel, `CONTROL: the editor is in German (${speakerLabel})`)
    await p.locator('.ed-present-pill .ed-menu').getByText(speakerLabel, { exact: true }).click()
    const sp = await popup
    await sp.waitForLoadState()
    await start(p)
    await sp.waitForSelector('.sv-btn[data-nav]', { timeout: 15000 })
    await p.bringToFront()
    await shiftSlash(p)
    const de = await p.evaluate(() => {
      const box = document.querySelector('.bento-show-keys [role="dialog"]')
      return box ? { title: document.getElementById(box.getAttribute('aria-labelledby')).textContent, text: box.textContent } : null
    })
    ok(de?.title === 'Tastenkürzel' && /Erste Folie/.test(de.text) && /Schwarzer Bildschirm/.test(de.text), `6. the sheet speaks German from the catalogs ("${de?.title}")`)
    const inSpeaker = await sp.evaluate(() => ({ el: !!document.querySelector('.bento-show-keys'), text: document.body.textContent.includes('Tastenkürzel') }))
    ok(!inSpeaker.el && !inSpeaker.text, `8. the speaker window never shows it (${JSON.stringify(inSpeaker)})`)
    await press(p, 'x')
    // an RTL chrome (what applyDirection sets for ar/he/fa/ur): the sheet turns, the slide does not
    await p.evaluate(() => { document.documentElement.dir = 'rtl' })
    await shiftSlash(p)
    const rtl = await p.evaluate(() => {
      const box = document.querySelector('.bento-show-keys [role="dialog"]')
      const row = box?.querySelector('tr')
      return box ? {
        dir: getComputedStyle(box).direction, overlay: getComputedStyle(document.querySelector('.bento-present-overlay')).direction,
        keysRight: row.cells[0].getBoundingClientRect().left > row.cells[1].getBoundingClientRect().left,
      } : null
    })
    ok(rtl?.dir === 'rtl' && rtl.keysRight && rtl.overlay === 'ltr', `6. under an RTL chrome the sheet reads right to left, the overlay stays LTR (${JSON.stringify(rtl)})`)
    ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
