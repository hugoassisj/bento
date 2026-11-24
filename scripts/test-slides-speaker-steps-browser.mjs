// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The speaker view follows click builds, sizes its notes, and pauses or
// counts down its timer.
//
//   npm run build:single --prefix slides && node scripts/test-slides-speaker-steps-browser.mjs
//
// WHAT THIS PROVES, with real keyboard and mouse input in the packaged shell's
// speaker popup (opened from the editor, then adopted by the show):
//   · on a slide with three builds, "current" shows exactly what the audience
//     sees and "Next" shows what the next → does: the same slide one build on
//     ("Next click", the coming element outlined), or the following slide once
//     the slide is fully built ("Next slide"); ← walks both panes back. Measured
//     on the rendered pixels of each pane and on the computed visibility of the
//     cloned nodes, not on a class read back.
//   · A+ / A− / reset and the = / - keys change the computed size of the notes,
//     and the size survives reopening the speaker view.
//   · the timer pauses (its text holds for 3 s), resumes from the paused value,
//     resets to 00:00, and with a 1-minute target counts down, turns amber in
//     the last 10 % and red past zero, then counts up with a minus sign. Time is
//     Playwright's fake clock, so the thresholds are exact.
//   · Space, →, ←, B, G, L, M, Home and End still drive the show from the popup,
//     and none of this touches the document.
// No network: http(s) is aborted, WebSockets are closed, offline mode is on.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let failures = 0
function ok(cond, msg) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${msg}`)
  if (!cond) failures++
}
const T = { timeout: 3000 }
const soft = (promise, fallback = null) => promise.catch(() => fallback)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (route) => route.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch { /* no storage */ } })
  // Fake time from the start; it flows normally until the timer section pauses it.
  await ctx.clock.install()
  const p = await ctx.newPage()
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.evaluate(() => {
    const doc = JSON.parse(JSON.stringify(window.bento.doc))
    doc.size = { width: 1600, height: 900 }
    const box = (id, x, fill, step) => ({
      id, type: 'shape', shape: 'rect', x, y: 300, w: 360, h: 360, rotation: 0, opacity: 1,
      fill, stroke: 'transparent', strokeWidth: 0, fx: { step },
    })
    const title = (id, html) => ({ id, type: 'text', x: 80, y: 60, w: 1200, h: 120, rotation: 0, opacity: 1,
      html, fontSize: 60, color: '#1e2a3a', align: 'left' })
    doc.slides = [
      { id: 's1', background: '#ffffff', notes: 'First slide notes. '.repeat(8),
        elements: [title('t1', 'Three builds'), box('b1', 100, '#ff0000', 1), box('b2', 620, '#00c000', 2), box('b3', 1140, '#0000ff', 3)] },
      { id: 's2', background: '#ffffff', notes: 'Second slide notes.', elements: [title('t2', 'After the builds')] },
      { id: 's3', background: '#ffffff', elements: [title('t3', 'Last')] },
    ]
    window.bento.loadDoc(JSON.stringify(doc))
  })
  const original = await p.evaluate(() => JSON.stringify(window.bento.doc))

  const openSpeaker = async () => {
    const popup = ctx.waitForEvent('page')
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.getByText('Open speaker view', { exact: true }).click()
    const sp = await popup
    sp.on('pageerror', (e) => errors.push(e.message))
    return sp
  }
  const startShow = async (sp) => {
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.getByText('Present in this tab', { exact: true }).click()
    await sp.waitForFunction(() => document.querySelector('.sv-nextbox .sv-frame')?.getBoundingClientRect().height > 0)
  }
  let sp = await openSpeaker()
  await startShow(sp)
  await sp.setViewportSize({ width: 1200, height: 800 })
  await sp.waitForTimeout(300)

  // Pixels of each box's colour in a pane, read off a real screenshot.
  const pixels = async (selector) => {
    const png = await soft(sp.locator(selector).screenshot(T))
    if (!png) return { r: -1, g: -1, b: -1 }
    return p.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width; c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const n = { r: 0, g: 0, b: 0 }
      for (let i = 0; i < d.length; i += 4) {
        const [R, G, B] = [d[i], d[i + 1], d[i + 2]]
        if (R > 200 && G < 70 && B < 70) n.r++
        else if (G > 140 && R < 70 && B < 70) n.g++
        else if (B > 200 && R < 70 && G < 70) n.b++
      }
      return n
    }, png.toString('base64'))
  }
  const seen = (n) => ['r', 'g', 'b'].map((k) => n[k] > 200)
  // Computed visibility of the cloned nodes, and what the panes are labelled.
  const panes = () => sp.evaluate(() => {
    const vis = (pane) => ['b1', 'b2', 'b3'].map((id) => {
      const node = document.querySelector(`${pane} [data-el-id="${id}"]`)
      return node ? getComputedStyle(node).visibility === 'visible' : null
    })
    const outlined = ['b1', 'b2', 'b3'].map((id) => {
      const node = document.querySelector(`.sv-nextbox [data-el-id="${id}"]`)
      return !!node && getComputedStyle(node).outlineStyle !== 'none'
    })
    return {
      current: vis('.sv-current'), next: vis('.sv-nextbox'), outlined,
      label: document.querySelector('.sv-next-label')?.textContent ?? null,
      nextSlide2: !!document.querySelector('.sv-nextbox [data-el-id="t2"]'),
      count: document.querySelector('.sv-count')?.textContent ?? '',
      steps: document.querySelector('.sv-steps:not([hidden])')?.textContent ?? '',
    }
  })
  const audience = () => p.evaluate(() => ['b1', 'b2', 'b3'].map((id) => {
    const node = document.querySelector(`.bento-present-overlay section.present [data-el-id="${id}"]`)
    return !!node && getComputedStyle(node).visibility === 'visible'
  }))
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const snapshot = async () => ({ panes: await panes(), cur: seen(await pixels('.sv-current .sv-frame')), next: seen(await pixels('.sv-nextbox .sv-frame')) })
  const press = async (key) => { await sp.keyboard.press(key); await sp.waitForTimeout(250) }

  // ——— step-aware previews ———
  const s0 = await snapshot()
  ok(same(await audience(), [false, false, false]), 'step 0: the audience sees none of the three builds (fixture check)')
  ok(same(s0.panes.current, [false, false, false]) && same(s0.cur, [false, false, false]),
    `step 0: "current" shows none of the builds (visibility ${s0.panes.current}, pixels ${s0.cur})`)
  ok(same(s0.panes.next, [true, false, false]) && same(s0.next, [true, false, false]) && s0.panes.label === 'Next click',
    `step 0: "Next" shows the same slide with the first build, labelled "Next click" (${s0.panes.next}, pixels ${s0.next}, "${s0.panes.label}")`)
  ok(same(s0.panes.outlined, [true, false, false]), `step 0: the element the next click reveals is outlined (${s0.panes.outlined})`)
  ok(s0.panes.count.trim() === '1 / 3' && s0.panes.steps === 'Click 0 of 3',
    `step 0: the counter reads "1 / 3" and "Click 0 of 3" ("${s0.panes.count}", "${s0.panes.steps}")`)

  await press('ArrowRight')
  const s1 = await snapshot()
  ok(same(await audience(), [true, false, false]), 'after →: the audience sees one build (fixture check)')
  ok(same(s1.panes.current, [true, false, false]) && same(s1.cur, [true, false, false]),
    `after →: exactly one build is visible in "current" (${s1.panes.current}, pixels ${s1.cur})`)
  ok(same(s1.panes.next, [true, true, false]) && same(s1.next, [true, true, false]) && s1.panes.label === 'Next click',
    `after →: "Next" shows the same slide with two builds, labelled "Next click" (${s1.panes.next}, pixels ${s1.next}, "${s1.panes.label}")`)
  ok(s1.panes.steps === 'Click 1 of 3', `after →: "Click 1 of 3" ("${s1.panes.steps}")`)

  await press('ArrowRight')
  const s2 = await snapshot()
  await press('ArrowRight')
  const s3 = await snapshot()
  ok(same(s3.panes.current, [true, true, true]) && same(s3.cur, [true, true, true]),
    `after the last build: "current" shows all three (${s3.panes.current}, pixels ${s3.cur})`)
  ok(s3.panes.label === 'Next slide' && s3.panes.nextSlide2 && same(s3.next, [false, false, false]),
    `after the last build: "Next" shows the following slide, labelled "Next slide" ("${s3.panes.label}", slide 2 ${s3.panes.nextSlide2})`)

  await press('ArrowLeft')
  const back2 = await snapshot()
  ok(same(back2, s2), `← restores the step-2 state in both panes (${JSON.stringify(back2.panes.current)} / ${back2.panes.label})`)
  await press('ArrowLeft')
  ok(same(await snapshot(), s1), '← again restores the step-1 state in both panes')
  await press('ArrowLeft')
  ok(same(await snapshot(), s0), '← again restores step 0 in both panes')

  // Arriving backward lands fully built; the previews must say so too.
  await press('ArrowRight'); await press('ArrowRight'); await press('ArrowRight'); await press('ArrowRight')
  ok((await panes()).count.trim().startsWith('2 /'), 'the fourth → leaves for slide 2')
  await press('ArrowLeft')
  const backward = await panes()
  ok(same(backward.current, [true, true, true]) && backward.label === 'Next slide',
    `arriving backward: "current" fully built, "Next" is the next slide (${backward.current}, "${backward.label}")`)
  await press('Home')

  // ——— notes size ———
  const notesPx = () => sp.evaluate(() => {
    const el = document.querySelector('.sv-notes')
    return el ? parseFloat(getComputedStyle(el).fontSize) : 0
  })
  const sizeBtn = (k) => sp.locator(`.sv-notes-size button[data-notes-size="${k}"]`)
  const base = await notesPx()
  for (let i = 0; i < 3; i++) await soft(sizeBtn('larger').click(T))
  const larger = await notesPx()
  ok(larger > base + 6, `A+ three times increases the notes' computed font size (${base}px → ${larger}px)`)
  await press('-')
  const smaller = await notesPx()
  ok(smaller < larger, `- in the speaker window makes the notes smaller (${larger}px → ${smaller}px)`)
  await press('=')
  ok(await notesPx() === larger, `= in the speaker window makes the notes larger again (${await notesPx()}px)`)
  ok((await panes()).count.trim().startsWith('1 /'), '- and = do not move the show')

  // Reopen: end the show, close the popup, open the speaker view again.
  await p.keyboard.press('Escape')
  await soft(sp.waitForSelector('.sv-idle', T))
  await sp.close()
  sp = await openSpeaker()
  await startShow(sp)
  await sp.setViewportSize({ width: 1200, height: 800 })
  ok(await notesPx() === larger, `reopening the speaker view keeps the notes size (${await notesPx()}px)`)
  await soft(sizeBtn('reset').click(T))
  ok(await notesPx() === base, `reset returns the notes to their default size (${await notesPx()}px)`)
  await soft(sizeBtn('larger').click(T))
  const kept = await notesPx()
  // A restarted show in the same popup (idle placeholder, then adopted again) keeps it too.
  await p.keyboard.press('Escape')
  await soft(sp.waitForSelector('.sv-idle', T))
  await startShow(sp)
  ok(await notesPx() === kept && kept > base, `restarting the show keeps the notes size (${await notesPx()}px)`)
  await soft(sizeBtn('reset').click(T))

  // ——— timer ———
  const timer = () => sp.evaluate(() => {
    const el = document.querySelector('.sv-timer')
    return { text: el?.textContent?.trim() ?? '', cls: el?.className ?? '',
      // the app's hints borrow a hovered control's title into data-hint
      title: el?.getAttribute('title') || el?.dataset.hint || '',
      tag: el?.tagName ?? '', mode: document.querySelector('.sv-timer-mode:not([hidden])')?.textContent ?? '' }
  })
  const now = await p.evaluate(() => Date.now())
  await ctx.clock.pauseAt(now + 1000)
  await soft(sp.locator('.sv-timer-reset').click(T))
  await ctx.clock.fastForward(5000)
  const running = await timer()
  ok(running.tag === 'BUTTON' && running.text === '00:05', `the timer is a button that counts up (${running.tag} "${running.text}")`)
  ok(running.title === 'Pause timer', `its tooltip says what a click does ("${running.title}")`)
  await soft(sp.locator('.sv-timer').click(T))
  const paused = await timer()
  await ctx.clock.fastForward(3000)
  const held = await timer()
  ok(held.text === paused.text && held.title === 'Resume timer',
    `paused, the text holds for 3 s ("${paused.text}" → "${held.text}", "${held.title}")`)
  // Space advances the show even right after the timer was clicked (and so focused).
  const focused = await sp.evaluate(() => document.activeElement?.classList.contains('sv-timer'))
  await press('Space')
  const afterSpace = await timer()
  ok(focused && (await panes()).steps === 'Click 1 of 3' && afterSpace.title === 'Resume timer',
    `Space after clicking the timer advances the show and leaves the timer alone (focused ${focused}, "${(await panes()).steps}", "${afterSpace.title}")`)
  await soft(sp.locator('.sv-timer').click(T))
  await ctx.clock.fastForward(2000)
  const resumed = await timer()
  ok(resumed.text === '00:07', `resume continues from the paused value ("${paused.text}" + 2 s = "${resumed.text}")`)
  await soft(sp.locator('.sv-timer-reset').click(T))
  ok((await timer()).text === '00:00', `reset returns to 00:00 ("${(await timer()).text}")`)

  // A 1-minute target: count down, amber in the last 10 %, red past zero.
  await soft(sp.locator('.sv-view summary').click(T))
  await soft(sp.locator('.sv-view input.sv-target').fill('1', T))
  await sp.keyboard.press('Escape')
  const t0 = await timer()
  ok(t0.text === '01:00' && !/sv-timer-(warn|over)/.test(t0.cls) && t0.mode === 'Remaining',
    `with a 1-minute target the timer shows the time remaining ("${t0.text}", "${t0.mode}", ${t0.cls})`)
  await ctx.clock.fastForward(30000)
  const t30 = await timer()
  ok(t30.text === '00:30' && !/sv-timer-(warn|over)/.test(t30.cls), `30 s in: "00:30", no warning (${t30.text}, ${t30.cls})`)
  await ctx.clock.fastForward(23000)
  const t53 = await timer()
  ok(t53.text === '00:07' && !/sv-timer-(warn|over)/.test(t53.cls), `53 s in: "00:07", still no warning (${t53.text}, ${t53.cls})`)
  await ctx.clock.fastForward(2000)
  const t55 = await timer()
  ok(t55.text === '00:05' && /sv-timer-warn/.test(t55.cls) && !/sv-timer-over/.test(t55.cls),
    `55 s in (last 10 %): "00:05", amber (${t55.text}, ${t55.cls})`)
  const amber = await sp.evaluate(() => getComputedStyle(document.querySelector('.sv-timer')).color)
  await ctx.clock.fastForward(10000)
  const t65 = await timer()
  ok(t65.text === '−00:05' && /sv-timer-over/.test(t65.cls), `65 s in: "−00:05", red (${t65.text}, ${t65.cls})`)
  const red = await sp.evaluate(() => getComputedStyle(document.querySelector('.sv-timer')).color)
  ok(amber !== red && !/^rgb\(233, 237, 243/.test(amber), `the two warning states paint differently (${amber}, ${red})`)
  // Clearing the target goes back to elapsed time.
  await soft(sp.locator('.sv-view summary').click(T))
  await soft(sp.locator('.sv-view input.sv-target').fill('', T))
  await sp.keyboard.press('Escape')
  const cleared = await timer()
  ok(cleared.text === '01:05' && !/sv-timer-(warn|over)/.test(cleared.cls) && cleared.mode === '',
    `clearing the target shows elapsed time again ("${cleared.text}", ${cleared.cls})`)
  await ctx.clock.resume()

  // ——— the speaker window's existing keys ———
  await press('Home')
  const count = async () => (await panes()).count.trim()
  const btn = (k) => sp.evaluate((k) => document.querySelector(`.sv-btn[data-nav="${k}"]`)?.classList.contains('active') ?? null, k)
  await press('End')
  ok((await count()).startsWith('3 /'), `End goes to the last slide (${await count()})`)
  await press('ArrowLeft')
  ok((await count()).startsWith('2 /'), `← goes back (${await count()})`)
  await press('ArrowRight')
  ok((await count()).startsWith('3 /'), `→ goes forward (${await count()})`)
  await press('Home')
  ok((await count()).startsWith('1 /'), `Home goes to the first slide (${await count()})`)
  await press('b')
  ok(await btn('black') === true, 'B blacks the screen')
  await press('b')
  ok(await btn('black') === false, 'B again lifts it')
  await press('g')
  ok(await sp.evaluate(() => !document.querySelector('.sv-grid')?.hasAttribute('hidden')), 'G opens the slide grid')
  await press('g')
  ok(await sp.evaluate(() => !!document.querySelector('.sv-grid')?.hasAttribute('hidden')), 'G again closes it')
  await press('l')
  ok(await btn('laser') === true, 'L arms the laser pointer')
  await press('l')
  ok(await btn('laser') === false, 'L again disarms it')
  const motion = await btn('reduce')
  await press('m')
  ok(await btn('reduce') === !motion, 'M toggles reduced motion')
  await press('m')

  if (process.env.SPEAKER_SCREENSHOTS) await sp.screenshot({ path: `${process.env.SPEAKER_SCREENSHOTS}/speaker-steps.png` })
  ok(await p.evaluate(() => JSON.stringify(window.bento.doc)) === original, 'notes size, timer and target leave the document byte-identical')
  await p.keyboard.press('Escape')
  await ctx.close()
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
} finally { await browser.close() }
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
