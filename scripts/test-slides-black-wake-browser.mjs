// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A clicker press on a blacked-out show wakes the screen and does not move the deck.
//
//   npm run build:single --prefix slides && node scripts/test-slides-black-wake-browser.mjs
//
// WHAT THIS PROVES, in the packaged shell with real keys and real touches:
//   1. audience window, screen black (B): one press of →, PageDown, Space, ←
//      or PageUp lifts the blackout and leaves the slide counter AND the reveal
//      step where they were (it used to navigate unseen: B, →, B showed the
//      next slide);
//   2. the next press after waking navigates as normal;
//   3. a horizontal swipe on touch does the same: wake first, navigate next;
//   4. B still toggles the blackout both ways without navigating;
//   5. speaker window, audience black: → still navigates (the presenter can
//      see where they are there), the audience stays black, and a strip over
//      the current-slide preview says the audience screen is black; B there
//      lifts it and the strip goes away.
// State is read from the DOM: the audience slide counter, the blackout's
// `hidden` attribute, and how many stepped elements are still hidden.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

// six plain slides, the third with two reveal steps
const loadDeck = (p) => p.evaluate(() => {
  const d = JSON.parse(JSON.stringify(window.bento.doc))
  const text = (id, html, step) => ({ id, type: 'text', x: 120, y: 60 + (step || 0) * 140, w: 800, h: 100, rotation: 0, opacity: 1, html, fontSize: 40, color: '#1E2A3A', align: 'left', ...(step ? { fx: { step } } : {}) })
  const slide = (n, extra = []) => ({ id: 's' + n, background: '#ffffff', elements: [text('t' + n, 'Slide ' + n), ...extra] })
  d.slides = [slide(1), slide(2), slide(3, [text('r1', 'First build', 1), text('r2', 'Second build', 2)]), slide(4), slide(5), slide(6)]
  d.present = { ...(d.present || {}), slideNumber: true }
  window.bento.loadDoc(JSON.stringify(d))
})

const state = (p) => p.evaluate(() => {
  const o = document.querySelector('.bento-present-overlay')
  const b = o?.querySelector('.bento-blackout')
  return {
    counter: (o?.querySelector('.slide-number')?.textContent || '').trim(),
    black: !!b && !b.hidden,
    hiddenSteps: o ? o.querySelectorAll('section.present .bento-step-hidden').length : -1,
  }
})
const fmt = (s) => `counter "${s.counter}", black ${s.black}, hidden steps ${s.hiddenSteps}`

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  // ——— audience window: keys and touch ———
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    await loadDeck(p)
    await p.waitForTimeout(400)
    await p.keyboard.press('F5')
    await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section.present'), null, { timeout: 10000 })
    await p.waitForTimeout(500)
    ok(await p.evaluate(() => document.visibilityState) === 'visible', 'the show tab is visible (rAF runs)')
    const press = async (k) => { await p.keyboard.press(k); await p.waitForTimeout(250) }

    await press('ArrowRight')
    let s = await state(p)
    ok(s.counter === '2 / 6' && !s.black, `the show starts on slide 2 (${fmt(s)})`)

    // a key wakes, then the same key navigates
    const wakeThen = async (key, name, expectAfterWake, expectAfterNav) => {
      await press('b')
      let st = await state(p)
      ok(st.black, `B blacks the screen before ${name} (${fmt(st)})`)
      await press(key)
      st = await state(p)
      ok(!st.black && st.counter === expectAfterWake.counter && st.hiddenSteps === expectAfterWake.hiddenSteps,
        `${name} while black wakes the screen and stays put (${fmt(st)}; want "${expectAfterWake.counter}", ${expectAfterWake.hiddenSteps} hidden)`)
      await press(key)
      st = await state(p)
      ok(!st.black && st.counter === expectAfterNav.counter && st.hiddenSteps === expectAfterNav.hiddenSteps,
        `the next ${name} navigates (${fmt(st)}; want "${expectAfterNav.counter}", ${expectAfterNav.hiddenSteps} hidden)`)
    }
    await wakeThen('ArrowRight', '→', { counter: '2 / 6', hiddenSteps: 0 }, { counter: '3 / 6', hiddenSteps: 2 })
    await wakeThen('PageDown', 'PageDown', { counter: '3 / 6', hiddenSteps: 2 }, { counter: '3 / 6', hiddenSteps: 1 })
    await wakeThen('Space', 'Space', { counter: '3 / 6', hiddenSteps: 1 }, { counter: '3 / 6', hiddenSteps: 0 })
    await wakeThen('ArrowLeft', '←', { counter: '3 / 6', hiddenSteps: 0 }, { counter: '3 / 6', hiddenSteps: 1 })
    await wakeThen('PageUp', 'PageUp', { counter: '3 / 6', hiddenSteps: 1 }, { counter: '3 / 6', hiddenSteps: 2 })

    // B toggles both ways, nothing moves
    await press('b'); await press('b')
    s = await state(p)
    ok(!s.black && s.counter === '3 / 6' && s.hiddenSteps === 2, `B, B: black and back, nothing moved (${fmt(s)})`)

    // touch: a real swipe (CDP touch input is trusted)
    await press('PageUp') // back to slide 2, no steps
    const cdp = await ctx.newCDPSession(p)
    const swipe = async (fromX, toX) => {
      const y = 400
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] })
      for (let i = 1; i <= 6; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + (toX - fromX) * i / 6, y }] })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await p.waitForTimeout(300)
    }
    s = await state(p)
    ok(s.counter === '2 / 6' && !s.black, `before the swipes: slide 2 (${fmt(s)})`)
    await swipe(900, 300) // left swipe = next, as a control: the swipe path works at all
    s = await state(p)
    ok(s.counter === '3 / 6', `a left swipe advances when the screen is lit (${fmt(s)})`)
    await swipe(300, 900) // no step shown yet on slide 3, so straight back to slide 2
    s = await state(p)
    ok(s.counter === '2 / 6', `a right swipe goes back (${fmt(s)})`)
    await press('b')
    await swipe(900, 300)
    s = await state(p)
    ok(!s.black && s.counter === '2 / 6', `a swipe while black wakes the screen and stays put (${fmt(s)})`)
    await swipe(900, 300)
    s = await state(p)
    ok(!s.black && s.counter === '3 / 6', `the next swipe navigates (${fmt(s)})`)
    await press('b')
    await swipe(300, 900)
    s = await state(p)
    ok(!s.black && s.counter === '3 / 6' && s.hiddenSteps === 2, `a back swipe while black wakes too (${fmt(s)})`)

    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }

  // ——— speaker window: navigation keeps working, the black state is shown ———
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
    await loadDeck(p)
    await p.waitForTimeout(400)
    const popup = ctx.waitForEvent('page')
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.locator('.ed-present-pill .ed-menu').getByText('Open speaker view', { exact: true }).click()
    const sp = await popup
    await sp.waitForLoadState()
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.locator('.ed-present-pill .ed-menu').getByText('Present in this tab', { exact: true }).click()
    await sp.waitForSelector('.sv-btn[data-nav]', { timeout: 15000 })
    await sp.waitForTimeout(800)
    const spress = async (k) => { await sp.keyboard.press(k); await sp.waitForTimeout(250) }
    const strip = () => sp.evaluate(() => {
      const el = document.querySelector('.sv-black-strip')
      if (!el || el.hidden) return { shown: false }
      const r = el.getBoundingClientRect()
      const c = document.querySelector('.sv-current')?.getBoundingClientRect()
      const inside = !!c && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1
      return { shown: r.width > 40 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden', inside, text: el.textContent }
    })

    let s = await state(p)
    ok(s.counter === '1 / 6' && !s.black, `the show starts on slide 1 (${fmt(s)})`)
    ok(!(await strip()).shown, 'no black strip while the audience can see the slide')
    await spress('b')
    s = await state(p)
    let st = await strip()
    ok(s.black, `B in the speaker window blacks the audience screen (${fmt(s)})`)
    ok(st.shown && st.inside && /black/i.test(st.text || ''), `a strip over the current-slide preview says so (${JSON.stringify(st)})`)
    await spress('ArrowRight')
    s = await state(p)
    st = await strip()
    ok(s.black && s.counter === '2 / 6', `→ in the speaker window still navigates and the audience stays black (${fmt(s)})`)
    ok(st.shown && st.inside, `the strip survives the slide change (${JSON.stringify(st)})`)
    await spress('b')
    s = await state(p)
    st = await strip()
    ok(!s.black && s.counter === '2 / 6' && !st.shown, `B in the speaker window lifts it, the strip goes away (${fmt(s)}, strip ${st.shown})`)

    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
