// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The Build order list in the Animate tab, in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-build-order-browser.mjs
//
// WHAT THIS PROVES:
//   1. with nothing selected, the Animate tab lists every stepped element of
//      the slide grouped by step, in step order, after a "With the slide (N)"
//      line for the rest; rows are named by their element;
//   2. dragging the row on step 3 above step 1 (real mouse) gives steps 1
//      (moved), 2, 3 — no duplicate, no gap — as ONE undo step, and the canvas
//      badges say the same thing as the list in the same task as the drop;
//   3. dropping a row onto another group puts both on one step;
//   4. a row's remove clears its step and the later steps close up;
//   5. the list works from the keyboard: a row takes focus, Alt+↓/↑ moves it a
//      place (focus follows it), Delete shows it with the slide again and never
//      deletes the element, Enter selects it;
//   6. pointing at a row outlines its element on the canvas; leaving clears it;
//      a click selects the element;
//   7. with three elements selected, one Entrance choice sets all three, and
//      the picker says Mixed while they differ;
//   8. "Show build order" in an element's Reveal row takes the panel back to
//      the list with its first row focused;
//   9. Escape mid-drag cancels the drop (the release after it does nothing),
//      and so does a move that arrives with no button held; on touch a swipe
//      that starts on a row scrolls the inspector and leaves the document
//      byte-identical, while a long press picks the row up and a tap selects;
//      a long press let go in place writes nothing (no renumbering of a
//      2, 5, 9 slide, no split of a shared step);
//  10. at the narrowest panel (190px in en and de, 213px in ja) every row
//      keeps its name, its picker and its remove button inside the panel.
// No network: every http(s) request is aborted, WebSockets are closed, and
// the deck is told it is offline before it loads.
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
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => {
    localStorage.setItem('bento-offline', 'on')
    localStorage.setItem('bento-panel-tab', '"animate"')
  })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const text = (id, y, step, html) => ({ id, type: 'text', x: 100, y, w: 600, h: 60, rotation: 0, opacity: 1, html, fontSize: 32, color: '#222222', ...(step ? { fx: { step } } : {}) })
  const load = (steps) => p.evaluate((els) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'fade', elements: els }]
    window.bento.loadDoc(JSON.stringify(d))
  }, [text('t', 40, 0, 'Why Bento'), text('a', 150, steps[0], 'Works offline'), text('b', 250, steps[1], 'Nothing to install'), text('c', 350, steps[2], 'Yours forever')])
  const steps = () => p.evaluate(() => window.bento.doc.slides[0].elements.filter((e) => e.id !== 't').map((e) => `${e.id}:${e.fx?.step ?? 0}`).join(' '))
  const listed = () => p.$$eval('.ed-props .ed-build-group', (gs) => gs.map((g) => `${g.getAttribute('aria-label')}=${[...g.querySelectorAll('.ed-build-row')].map((r) => r.dataset.id).join('+')}`).join(' | '))
  const badges = () => p.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('.ed-step-badge')) out.push(b.textContent)
    return out.join(' ')
  })
  const row = (id) => p.locator(`.ed-props .ed-build-row[data-id="${id}"]`)
  const group = (k) => p.locator('.ed-props .ed-build-group').nth(k)
  /** Press on a row's name and drag it with the real mouse to (x, y). */
  const dragRow = async (id, to) => {
    const r = await row(id).boundingBox()
    await p.mouse.move(r.x + 50, r.y + r.height / 2)
    await p.mouse.down()
    await p.mouse.move(r.x + 50, r.y + r.height / 2 - 12, { steps: 4 })
    await p.mouse.move(to.x, to.y, { steps: 8 })
    // what the list and the badges read the moment the drop has been handled
    await p.evaluate(() => {
      window.__afterDrop = null
      window.addEventListener('pointerup', () => setTimeout(() => {
        const heads = [...document.querySelectorAll('.ed-props .ed-build-group')].map((g) => [...g.querySelectorAll('.ed-build-row')].map((r) => r.dataset.id))
        const badge = {}
        for (const b of document.querySelectorAll('.ed-step-badge')) {
          const box = b.getBoundingClientRect()
          const el = [...document.querySelectorAll('.ed-stage-scale [data-el-id]')].find((n) => Math.abs(n.getBoundingClientRect().top - box.top - 9) < 14)
          if (el) badge[el.dataset.elId] = b.textContent
        }
        window.__afterDrop = { heads, badge }
      }), { once: true, capture: true })
    })
    await p.mouse.up()
    await p.waitForFunction(() => window.__afterDrop)
    return p.evaluate(() => window.__afterDrop)
  }
  /** List and badges agree: each group k's rows carry badge k+1. */
  const agree = (snap) => snap.heads.every((ids, k) => ids.every((id) => snap.badge[id] === String(k + 1)))

  console.log('1. the list\n')
  await load([1, 2, 3])
  await p.waitForTimeout(400)
  ok(await p.locator('.ed-props .ed-section', { hasText: /^Build order$/ }).isVisible(), 'nothing selected: the Animate tab shows a Build order section')
  ok(await listed() === 'Click 1=a | Click 2=b | Click 3=c', `grouped by step, in step order (${await listed()})`)
  ok((await p.locator('.ed-props .ed-build-still').textContent()) === 'With the slide (1)', 'the unstepped title is counted in a first line, "With the slide (1)"')
  ok((await row('c').getAttribute('aria-label')) === 'Yours forever' && (await group(2).getAttribute('aria-label')) === 'Click 3', 'a row is named by its element, its group by the press ("Click 3")')
  ok(await p.locator('.ed-props .ed-build').getAttribute('role') === 'list' && await row('a').getAttribute('tabindex') === '0', 'the list is a list and every row takes focus')

  console.log('\n2. drag the row on step 3 above step 1\n')
  const g0 = await group(0).boundingBox()
  const snap = await dragRow('c', { x: g0.x + 60, y: g0.y + 3 })
  ok(await steps() === 'a:2 b:3 c:1', `c 1 (moved), a 2, b 3 — no duplicate, no gap (${await steps()})`)
  ok(await listed() === 'Click 1=c | Click 2=a | Click 3=b', `the list follows (${await listed()})`)
  ok(agree(snap) && Object.keys(snap.badge).length === 3, `the badges say the same in the same task as the drop (${JSON.stringify(snap.badge)})`)
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(150)
  ok(await steps() === 'a:1 b:2 c:3', `one undo puts every step back: it was one undo step (${await steps()})`)
  ok(await badges() === '1 2 3', 'and the badges with it')

  console.log('\n2b. Escape, and a release outside the window, drop nothing\n')
  const docNow = () => p.evaluate(() => JSON.stringify(window.bento.doc.slides))
  const armAt = async (id, to) => {
    const r = await row(id).boundingBox()
    await p.mouse.move(r.x + 50, r.y + r.height / 2)
    await p.mouse.down()
    await p.mouse.move(r.x + 50, r.y + r.height / 2 - 12, { steps: 4 })
    await p.mouse.move(to.x, to.y, { steps: 8 })
  }
  const unchanged = await docNow()
  const ge = await group(0).boundingBox()
  await armAt('c', { x: ge.x + 60, y: ge.y + 3 })
  ok(await p.locator('.ed-props .ed-build .drop-before').count() === 1, 'mid-drag the list marks where the row would land')
  await p.keyboard.press('Escape')
  ok(await p.locator('.ed-props .ed-build .drop-before, .ed-props .ed-build .dragging').count() === 0, 'Escape clears the marks')
  await p.mouse.up()
  await p.waitForTimeout(150)
  ok(await docNow() === unchanged, `and the release after it drops nothing: the drag was cancelled, not just hidden (${await steps()})`)
  ok(await p.evaluate(() => window.bento.selection.length) === 0, '…nor does it count as a click')
  await p.evaluate(() => window.addEventListener('pointerdown', (e) => { window.__pid = e.pointerId }, { capture: true, once: true }))
  await armAt('c', { x: ge.x + 60, y: ge.y + 3 })
  // the button comes up outside the window: no pointerup, the next move (same pointer) has no button held
  await p.evaluate(({ x, y }) => window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, buttons: 0, pointerId: window.__pid, pointerType: 'mouse', bubbles: true })), { x: ge.x + 60, y: ge.y + 3 })
  ok(await p.locator('.ed-props .ed-build .drop-before, .ed-props .ed-build .dragging').count() === 0, 'a move with no button held ends the drag')
  await p.mouse.up()
  await p.waitForTimeout(150)
  ok(await docNow() === unchanged, `and nothing drops (${await steps()})`)

  console.log('\n3. drop onto a group\n')
  await load([1, 2, 3]); await p.waitForTimeout(300)
  const g1 = await group(0).boundingBox()
  const snap2 = await dragRow('c', { x: g1.x + 60, y: g1.y + g1.height / 2 })
  ok(await steps() === 'a:1 b:2 c:1', `c dropped onto step 1 is revealed with a (${await steps()})`)
  ok(await listed() === 'Click 1=a+c | Click 2=b', `one group holds both (${await listed()})`)
  ok(agree(snap2), 'the badges agree')
  ok(await p.locator('.ed-props .ed-build-group').first().locator('.ed-num').count() === 2, 'a group of two offers Stagger on each row')
  const inRow = await row('c').boundingBox()
  const pair1 = await p.evaluate(() => JSON.stringify(window.bento.doc))
  await p.mouse.move(inRow.x + 50, inRow.y + inRow.height / 2)
  await p.mouse.down()
  await p.mouse.move(inRow.x + 58, inRow.y + inRow.height - 2, { steps: 4 })
  ok(await p.locator('.ed-props .ed-build .drop-before, .ed-props .ed-build .drop-after, .ed-props .ed-build .drop-into').count() === 0, 'a drag still over its own row shows no target')
  await p.mouse.up()
  await p.waitForTimeout(150)
  ok(await p.evaluate(() => JSON.stringify(window.bento.doc)) === pair1, `and released there writes nothing — the shared step is not split by its own row's edge (${await steps()})`)
  await load([1, 2, 1]); await p.waitForTimeout(300) // whatever that did, section 3 goes on from a+c on 1, b on 2
  ok((await p.locator('.ed-props .ed-build-group').first().locator('.ed-build-beat-cap').allTextContents()).join() === 'Stagger', 'its column has a visible caption, "Stagger"')
  const pickerX = await p.$$eval('.ed-props .ed-build-row select', (ss) => ss.map((x) => Math.round(x.getBoundingClientRect().left)))
  const removeX = await p.$$eval('.ed-props .ed-build-row .ed-build-remove', (ss) => ss.map((x) => Math.round(x.getBoundingClientRect().right)))
  ok(new Set(pickerX).size === 1 && new Set(removeX).size === 1, `every row's picker and remove button stay in one column, with or without Stagger (${pickerX} / ${removeX})`)
  const beats = () => p.$$eval('.ed-props .ed-build-group:first-child .ed-num, .ed-props .ed-build-still + .ed-build-group .ed-num', (ns) => ns.map((n) => n.value).join(' '))
  ok(await beats() === '0 1', `in slide order, one beat apart, as the show staggers them (${await beats()})`)
  const beat = row('c').locator('.ed-num')
  await beat.click(); await beat.fill('0'); await p.keyboard.press('Enter')
  await p.waitForTimeout(150)
  ok(await p.evaluate(() => window.bento.doc.slides[0].elements.find((e) => e.id === 'c').fx.order) === 0 && await beats() === '0 0', `Stagger 0 on c writes fx.order 0: both enter on the same beat (${await beats()})`)
  ok(await steps() === 'a:1 b:2 c:1', 'the steps are untouched')

  console.log('\n4. remove a row\n')
  await load([1, 2, 3]); await p.waitForTimeout(300)
  await row('a').locator('.ed-build-remove').click()
  await p.waitForTimeout(150)
  ok(await steps() === 'a:0 b:1 c:2', `removing the row on step 1 clears it and the rest close up (${await steps()})`)
  ok((await p.locator('.ed-props .ed-build-still').textContent()) === 'With the slide (2)', 'it joins the "With the slide" count')
  ok(await badges() === '1 2', 'the badges agree')

  console.log('\n5. keyboard\n')
  await load([1, 2, 3]); await p.waitForTimeout(300)
  await row('a').focus()
  await p.keyboard.press('Alt+ArrowDown')
  await p.waitForTimeout(150)
  ok(await steps() === 'a:2 b:1 c:3', `Alt+↓ moves the focused row one place later (${await steps()})`)
  ok(await p.evaluate(() => document.activeElement?.dataset?.id) === 'a', 'focus follows the row')
  await p.keyboard.press('Alt+ArrowDown')
  await p.waitForTimeout(150)
  ok(await steps() === 'a:3 b:1 c:2', `again: last (${await steps()})`)
  await p.keyboard.press('Alt+ArrowDown')
  await p.waitForTimeout(150)
  ok(await steps() === 'a:3 b:1 c:2', 'at the end it stays (no wrap from the keyboard)')
  await p.keyboard.press('Alt+ArrowUp')
  await p.waitForTimeout(150)
  ok(await steps() === 'a:2 b:1 c:3' && await p.evaluate(() => document.activeElement?.dataset?.id) === 'a', `Alt+↑ moves it back (${await steps()})`)
  const before = await p.evaluate(() => window.bento.doc.slides[0].elements.length)
  await p.keyboard.press('Delete')
  await p.waitForTimeout(150)
  ok(await steps() === 'a:0 b:1 c:2', `Delete shows it with the slide again (${await steps()})`)
  ok(await p.evaluate(() => window.bento.doc.slides[0].elements.length) === before, 'and never deletes the element')
  ok(await p.evaluate(() => !!document.activeElement?.classList.contains('ed-build-row')), 'focus stays in the list')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(150)
  const focusedId = await p.evaluate(() => window.bento.selection.join())
  ok(focusedId === 'c', `Enter selects the focused row's element — the row after the one removed (${focusedId})`)

  console.log('\n6. hover and click\n')
  await load([1, 2, 3]); await p.waitForTimeout(300)
  await p.mouse.click(5, 990) // nothing selected
  await p.waitForTimeout(150)
  const rb = await row('b').boundingBox()
  await p.mouse.move(rb.x + 40, rb.y + rb.height / 2)
  await p.waitForTimeout(100)
  const peek = () => p.evaluate(() => [...document.querySelectorAll('.ed-stage-scale .ed-peek')].map((n) => `${n.dataset.elId}:${getComputedStyle(n).outlineStyle}`).join())
  ok(await peek() === 'b:solid', `pointing at a row outlines its element on the canvas (${await peek()})`)
  await p.mouse.move(rb.x + 40, rb.y - 200)
  await p.waitForTimeout(100)
  ok(await peek() === '', 'leaving the row clears it')
  await row('b').locator('.ed-layer-label').click()
  await p.waitForTimeout(150)
  ok(await p.evaluate(() => window.bento.selection.join()) === 'b', 'a click on a row selects its element')
  ok(await steps() === 'a:1 b:2 c:3', 'and changes nothing')

  console.log('\n7. Entrance for a multi-selection\n')
  for (const [i, id] of ['a', 'b', 'c'].entries()) {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    if (i) await p.keyboard.down('Shift')
    await p.mouse.click(b.x + 30, b.y + b.height / 2)
    if (i) await p.keyboard.up('Shift')
    await p.waitForTimeout(150)
  }
  ok(await p.evaluate(() => window.bento.selection.slice().sort().join()) === 'a,b,c', 'three elements selected')
  const multi = p.locator('.ed-props .ed-row', { hasText: /^Entrance/ }).locator('select')
  ok(await multi.count() === 1 && await multi.isVisible(), 'the multi-selection panel has an Entrance picker')
  await multi.selectOption('fade-up')
  await p.waitForTimeout(150)
  const enters = () => p.evaluate(() => window.bento.doc.slides[0].elements.filter((e) => e.id !== 't').map((e) => e.fx?.enter ?? '-').join(' '))
  ok(await enters() === 'fade-up fade-up fade-up', `one choice sets all three (${await enters()})`)
  ok(await steps() === 'a:1 b:2 c:3', 'their steps are untouched')
  await p.evaluate(() => window.bento.undo())
  await p.waitForTimeout(150)
  ok(await enters() === '- - -', 'one undo step')
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides[0].elements.find((e) => e.id === 'a').fx.enter = 'fade'
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(300)
  for (const [i, id] of ['a', 'b'].entries()) {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).boundingBox()
    if (i) await p.keyboard.down('Shift')
    await p.mouse.click(b.x + 30, b.y + b.height / 2)
    if (i) await p.keyboard.up('Shift')
    await p.waitForTimeout(150)
  }
  const shown = await p.locator('.ed-props .ed-row', { hasText: /^Entrance/ }).locator('select').evaluate((s) => s.selectedOptions[0]?.textContent)
  ok(shown === 'Mixed', `differing entrances read Mixed (${shown})`)

  console.log('\n8. Show build order\n')
  const cb = await p.locator('.ed-stage-scale [data-el-id="c"]').boundingBox()
  await p.mouse.click(cb.x + 30, cb.y + cb.height / 2)
  await p.waitForTimeout(150)
  const link = p.locator('.ed-props .ed-build-show')
  ok(await link.isVisible() && (await link.textContent()) === 'Show build order', 'a selected stepped element offers "Show build order"')
  await link.click()
  await p.waitForTimeout(150)
  ok(await p.evaluate(() => window.bento.selection.length) === 0, 'it clears the selection')
  ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-build-row') && document.activeElement.dataset.id) === 'a', 'and focuses the first row of the list')

  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)

  console.log('\n9. touch: a swipe scrolls, a long press picks a row up\n')
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 560 }, hasTouch: true })
  await tctx.route(/^https?:/, (r) => r.abort())
  if (tctx.routeWebSocket) await tctx.routeWebSocket(/.*/, (ws) => ws.close())
  await tctx.addInitScript(() => {
    localStorage.setItem('bento-offline', 'on')
    localStorage.setItem('bento-panel-tab', '"animate"')
  })
  const tp = await tctx.newPage()
  tp.on('pageerror', (e) => errors.push(e.message))
  await tp.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await tp.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const twelve = Array.from({ length: 12 }, (_, i) => ({ id: 'e' + i, type: 'text', x: 100, y: 20 + i * 40, w: 400, h: 34, rotation: 0, opacity: 1, html: 'Item ' + i, fontSize: 20, color: '#222222', fx: { step: i + 1 } }))
  await tp.evaluate((els) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'fade', elements: els }]
    window.bento.loadDoc(JSON.stringify(d))
  }, twelve)
  await tp.waitForTimeout(400)
  const cdp = await tctx.newCDPSession(tp)
  const tsteps = () => tp.evaluate(() => window.bento.doc.slides[0].elements.map((e) => e.fx?.step ?? 0).join(','))
  const tdoc = () => tp.evaluate(() => JSON.stringify(window.bento.doc.slides))
  const scrollTop = () => tp.evaluate(() => document.querySelector('.ed-props').scrollTop)
  const touch = async (pts, holdMs = 0) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] })
    if (holdMs) await tp.waitForTimeout(holdMs)
    for (const q of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [q] }); await tp.waitForTimeout(16) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await tp.waitForTimeout(300)
  }
  const line = (x, y0, y1, n = 15) => Array.from({ length: n + 1 }, (_, k) => ({ x, y: y0 + (y1 - y0) * k / n }))
  ok(await tp.evaluate(() => { const h = document.querySelector('.ed-props'); return h.scrollHeight > h.clientHeight + 40 }), 'the inspector is taller than its column: there is something to scroll')
  const before0 = await tdoc()
  const r3 = await tp.locator('.ed-build-row[data-id="e3"]').boundingBox()
  const top0 = await scrollTop()
  await touch(line(r3.x + 40, r3.y + r3.height / 2, Math.max(5, r3.y - 160)))
  ok(await scrollTop() > top0 + 40, `a vertical swipe that starts on a row scrolls the inspector (${top0} → ${await scrollTop()})`)
  ok(await tdoc() === before0, `and leaves the document byte-identical (${await tsteps()})`)
  await tp.evaluate(() => { document.querySelector('.ed-build').scrollIntoView({ block: 'start' }) })
  await tp.waitForTimeout(150)
  const t2 = await tp.locator('.ed-build-row[data-id="e2"]').boundingBox()
  const tg0 = await tp.locator('.ed-build-group').nth(0).boundingBox()
  await touch(line(t2.x + 40, t2.y + t2.height / 2, tg0.y + tg0.height / 2), 600)
  ok((await tsteps()).startsWith('1,2,1,3,'), `a long press, then a drag onto Click 1, reveals e2 with e0 (${await tsteps()})`)
  await tp.evaluate(() => window.bento.undo())
  await tp.waitForTimeout(200)
  await tp.evaluate(() => { document.querySelector('.ed-build').scrollIntoView({ block: 'start' }) })
  await tp.waitForTimeout(150)
  const t1 = await tp.locator('.ed-build-row[data-id="e1"]').boundingBox()
  await tp.touchscreen.tap(t1.x + 40, t1.y + t1.height / 2)
  await tp.waitForTimeout(200)
  ok(await tp.evaluate(() => window.bento.selection.join()) === 'e1', 'a tap on a row selects its element')
  ok(await tdoc() === before0, 'and changes nothing')
  // A long press let go where it started writes nothing: no renumbering of a
  // slide whose steps skip, no split of a shared step from a row's bottom
  // edge. The whole document is compared, its `modified` stamp included, so
  // an edit (and the undo step every edit records) cannot slip through.
  const whole = () => tp.evaluate(() => JSON.stringify(window.bento.doc))
  const loadT = (steps) => tp.evaluate((steps) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'fade', elements: steps.map((st, i) => ({ id: 'e' + i, type: 'text', x: 100, y: 40 + i * 80, w: 400, h: 50, rotation: 0, opacity: 1, html: 'Item ' + i, fontSize: 24, color: '#222222', fx: { step: st } })) }]
    window.bento.loadDoc(JSON.stringify(d))
  }, steps)
  await loadT([2, 5, 9]); await tp.waitForTimeout(400)
  await tp.evaluate(() => { document.querySelector('.ed-build').scrollIntoView({ block: 'start' }) }); await tp.waitForTimeout(150)
  const skip0 = await whole()
  const pb = await tp.locator('.ed-build-row[data-id="e1"]').boundingBox()
  await touch([{ x: pb.x + 40, y: pb.y + pb.height / 2 }], 600)
  ok(await whole() === skip0, `a long press on a row of a 2, 5, 9 slide, let go in place, writes nothing (${await tsteps()})`)
  ok(await tp.evaluate(() => window.bento.selection.length) === 0, '…and selects nothing')
  await loadT([1, 1, 2]); await tp.waitForTimeout(400)
  await tp.evaluate(() => { document.querySelector('.ed-build').scrollIntoView({ block: 'start' }) }); await tp.waitForTimeout(150)
  const pair0 = await whole()
  const pe = await tp.locator('.ed-build-row[data-id="e1"]').boundingBox()
  await touch([{ x: pe.x + 40, y: pe.y + pe.height - 3 }], 600)
  ok(await whole() === pair0, `a long press on the bottom edge of a shared step's last row, let go in place, does not split it (${await tsteps()})`)
  await touch([{ x: pe.x + 40, y: pe.y + pe.height - 3 }, { x: pe.x + 44, y: pe.y + pe.height - 2 }, { x: pe.x + 40, y: pe.y + pe.height - 1 }], 600)
  ok(await whole() === pair0, `nor does a finger that wobbles inside the row after the hold (${await tsteps()})`)
  ok(!errors.length, `no page errors on touch${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await tctx.close()

  console.log('\n10. the narrowest panel\n')
  for (const [lang, w] of [['en', 190], ['de', 190], ['ja', 213]]) {
    const nctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await nctx.route(/^https?:/, (r) => r.abort())
    if (nctx.routeWebSocket) await nctx.routeWebSocket(/.*/, (ws) => ws.close())
    await nctx.addInitScript(([lang, w]) => {
      localStorage.setItem('bento-offline', 'on')
      localStorage.setItem('bento-panel-tab', '"animate"')
      localStorage.setItem('bento-lang', lang)
      localStorage.setItem('bento-ed-panels', JSON.stringify({ left: 200, right: w }))
    }, [lang, w])
    const np = await nctx.newPage()
    np.on('pageerror', (e) => errors.push(e.message))
    await np.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await np.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    await np.evaluate((els) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'fade', elements: els }]
      window.bento.loadDoc(JSON.stringify(d))
    }, [text('t', 40, 0, 'Why Bento'), text('a', 150, 1, 'Works offline'), text('b', 250, 2, 'Nothing to install'), text('c', 350, 1, 'Yours forever')])
    await np.waitForTimeout(500)
    const m = await np.evaluate(() => {
      const panel = document.querySelector('.ed-props').getBoundingClientRect()
      return {
        panel: Math.round(panel.width),
        names: [...document.querySelectorAll('.ed-build-row .ed-layer-label')].map((n) => Math.round(n.getBoundingClientRect().width)),
        removeIn: [...document.querySelectorAll('.ed-build-row .ed-build-remove')].every((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= panel.left && r.right <= panel.right }),
        pickers: [...document.querySelectorAll('.ed-build-row select')].map((s) => Math.round(s.getBoundingClientRect().width)),
        heads: [...document.querySelectorAll('.ed-build-head > span')].map((h) => Math.round(h.getBoundingClientRect().height)),
      }
    })
    ok(m.panel <= w && m.names.length === 3 && m.names.every((x) => x >= 30), `${lang} at ${m.panel}px: every row keeps its name visible (${m.names} px)`)
    ok(m.removeIn, `${lang}: every remove button is wholly inside the panel`)
    ok(m.pickers.every((x) => x >= 48), `${lang}: the entrance pickers keep a readable width (${m.pickers} px)`)
    ok(m.heads.every((h) => h <= 16), `${lang}: "Click n" and the Stagger caption stay on one line (${m.heads} px tall)`)
    await nctx.close()
  }
  ok(!errors.length, `no page errors at the narrowest panel${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
