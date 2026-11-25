// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A hover reveal set up with one pick.
//
//   npm run build:single --prefix slides && node scripts/test-slides-hover-picker-browser.mjs
//   (SHELL_HTML=<older shell> runs the same checks against it)
//
// WHAT THIS PROVES (real mouse and keys throughout)
//   1. "Show on hover of" is a picker of the slide's other elements by their
//      Layers names, never ids. Picking a trigger on a slide with no hover
//      settings writes all three keys — the trigger's group, the target's
//      showOnHover, the slide's hover 'reveal' — and one ⌘Z takes all three
//      back. In the show the target is hidden at rest and shows (rendered
//      opacity, after the 180 ms fade) while the pointer is on the trigger.
//   2. On a slide whose hover dims other groups, picking leaves that setting
//      alone; the status line says so and its button switches it.
//   3. The status line tells the truth: working, slide hover off, nothing in
//      the group. The canvas "Hover set:" bar flags a set nothing can reveal,
//      and its Pick the trigger opens the picker.
//   3b. A trigger the pointer can never be on — the element itself, a hidden
//      one — is flagged, not counted, and the picker leaves hidden ones out.
//      A component main picked as the trigger keeps its group to itself: the
//      copy on another slide records the key as overridden (one undo step).
//   4. validate() reports hover-set-unreachable and hover-off on those slides
//      and nothing on a working one.
//   5. A deck with hand-typed groups opens and behaves as before, and the
//      picker names its trigger.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

// machine-looking ids, so "no id on screen" means something
const TRIG = 's-mvhp1a-9rdmmd', CARD = 't-mvhp2b-4kq1zz'
const rect = (id, extra = {}) => ({ id, type: 'shape', shape: 'rect', x: 120, y: 200, w: 300, h: 200, rotation: 0, opacity: 1, fill: '#4b8cf5', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra })
const text = (id, html, extra = {}) => ({ id, type: 'text', html, x: 700, y: 200, w: 400, h: 80, rotation: 0, opacity: 1, fontSize: 32, fontFamily: 'Helvetica, sans-serif', fontWeight: 600, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.2, ...extra })
const slide = (id, elements, extra = {}) => ({ id, background: '#ffffff', transition: 'none', notes: '', elements, ...extra })
const SLIDES = [
  slide('s1', [rect(TRIG), text(CARD, 'Detail card')]), // nothing set up
  slide('s2', [rect('s2-r'), text('s2-t', 'Dimmed card')], { hover: { type: 'focus-group' } }),
  slide('s3', [rect('s3-r', { group: 'italy', name: 'Italy' }), text('s3-t', 'Rome', { showOnHover: 'italy' })], { hover: { type: 'reveal' } }), // hand-typed, working
  slide('s4', [rect('s4-r'), text('s4-t', 'Typed a layer name', { showOnHover: 'Rectangle' })], { hover: { type: 'reveal' } }), // unmatched set
  slide('s5', [rect('s5-r', { group: 'g' }), text('s5-t', 'Hover off', { showOnHover: 'g' })]), // slide hover off
  slide('s6', [rect('s6-r'), text('s6-t', 'Own trigger', { showOnHover: 'x', group: 'x', name: 'Self' })], { hover: { type: 'reveal' } }), // its own trigger
  slide('s7', [rect('s7-h', { group: 'h', hidden: true, name: 'Hidden box' }), rect('s7-v', { x: 450, name: 'Visible box' }), text('s7-t', 'Behind a hidden box', { showOnHover: 'h' })], { hover: { type: 'reveal' } }),
  slide('s8', [rect('s8-m', { name: 'Button', groupId: 'gcmp', component: { id: 'cmp', key: 'k', main: true } }), text('s8-t', 'Main card')]),
  slide('s9', [rect('s8-m', { name: 'Button', groupId: 'gcmp2', component: { id: 'cmp', key: 'k' } }), text('s9-t', 'Elsewhere')], { hover: { type: 'focus-group' } }),
]

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-panel-tab', '"format"') } catch {} })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
  await p.evaluate((slides) => { const d = JSON.parse(JSON.stringify(window.bento.doc)); d.slides = slides; window.bento.loadDoc(JSON.stringify(d)) }, SLIDES)
  await p.waitForTimeout(300)

  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.slides)))
  const centre = (sel) => p.evaluate((sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, sel)
  const goSlide = async (i) => { await p.keyboard.press('Escape'); await p.locator('.ed-thumb').nth(i).click(); await p.waitForTimeout(250) }
  const selectEl = async (id) => { const c = await centre(`.ed-stage-scale [data-el-id="${id}"]`); await p.mouse.click(c.x, c.y); await p.waitForTimeout(250) }
  const interact = async () => {
    await p.locator('.ed-props .ed-tabs [role="tab"]', { hasText: /^Interact$/i }).click()
    await p.waitForTimeout(150)
    const head = p.locator('.ed-props .ed-section', { hasText: /^Interactivity$/ })
    if (await head.evaluate((h) => h.classList.contains('closed')).catch(() => false)) await head.click()
    await p.waitForTimeout(100)
  }
  const pickBtn = p.locator('.ed-props .ed-hover-pick-btn')
  const status = () => p.evaluate(() => [...document.querySelectorAll('.ed-props .ed-hover-status')].map((s) => `${s.dataset.state}: ${s.textContent}`))
  const openPicker = async () => { const c = await centre('.ed-props .ed-hover-pick-btn'); await p.mouse.click(c.x, c.y); await p.waitForTimeout(200) }
  const pickOption = async (label) => {
    const opt = p.locator('.ed-hover-pick [role=option]', { hasText: label }).first()
    const b = await opt.boundingBox()
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
    await p.waitForTimeout(300)
  }

  // ---- 1. one pick on a slide with nothing set up ----------------------------
  await goSlide(0)
  await selectEl(CARD)
  await interact()
  ok(await pickBtn.count() === 1, '"Show on hover of" is a picker button, not a text field')
  if (await pickBtn.count()) {
    ok((await pickBtn.innerText()).trim() === 'Always visible', `with nothing set it reads Always visible ("${(await pickBtn.innerText()).trim()}")`)
    await openPicker()
    const opts = await p.locator('.ed-hover-pick [role=option]').allInnerTexts()
    ok(opts.length === 1 && opts[0].trim() === 'Rectangle', `the picker lists the slide's other element by its Layers name (${JSON.stringify(opts)})`)
    const shown = await p.evaluate(() => document.querySelector('.ed-hover-pick')?.textContent ?? '')
    ok(!/[a-z]-mvhp/.test(shown), 'the picker shows no element id')
    await pickOption('Rectangle')
    let s1 = (await doc())[0]
    const trig = s1.elements.find((e) => e.id === TRIG), card = s1.elements.find((e) => e.id === CARD)
    ok(!!trig.group && card.showOnHover === trig.group && s1.hover?.type === 'reveal',
      `one pick writes all three: trigger group "${trig.group}", target showOnHover "${card.showOnHover}", slide hover ${JSON.stringify(s1.hover)}`)
    ok(!/mvhp/.test(trig.group ?? ''), `the new group is the layer's name, not its id ("${trig.group}")`)
    const st = await status()
    ok(st.length === 1 && st[0].startsWith('ok:') && st[0].includes('Rectangle'), `the status line says it works (${JSON.stringify(st)})`)
    ok((await pickBtn.innerText()).trim() === 'Rectangle', 'the picker button names the trigger')
    ok(!(await p.locator('.ed-setchip-warn').count()), 'the Hover set bar flags nothing on a working reveal')

    // one undo step for the three writes
    await p.keyboard.press('Control+z'); await p.waitForTimeout(300)
    s1 = (await doc())[0]
    ok(!s1.elements.find((e) => e.id === TRIG).group && !s1.elements.find((e) => e.id === CARD).showOnHover && !s1.hover,
      `one ⌘Z takes all three back (${JSON.stringify({ group: s1.elements[0].group, soh: s1.elements[1].showOnHover, hover: s1.hover })})`)
    await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(300)
    s1 = (await doc())[0]
    ok(!!s1.elements[0].group && s1.elements[1].showOnHover === s1.elements[0].group && s1.hover?.type === 'reveal', 'and one redo brings all three back')
  }

  // ---- present: hidden at rest, shown on the trigger ----------------------------
  const present = async () => {
    await p.keyboard.press('Escape')
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.locator('.ed-present-pill .ed-menu').getByText('Present in this tab', { exact: true }).click()
    await p.waitForTimeout(1200)
  }
  const opacityOf = (id) => p.evaluate((id) => { const n = document.querySelector(`.reveal section.present [data-el-id="${id}"]`); return n ? getComputedStyle(n).opacity : 'missing' }, id)
  const hoverIn = async (id) => { const c = await centre(`.reveal section.present [data-el-id="${id}"]`); await p.mouse.move(c.x, c.y, { steps: 4 }); await p.waitForTimeout(400) }
  const hoverOut = async () => { await p.mouse.move(1430, 990, { steps: 4 }); await p.waitForTimeout(400) }
  const exitShow = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(500) }
  await p.mouse.move(1430, 990)
  await present()
  ok(await p.evaluate(() => document.visibilityState) === 'visible', 'the page is visible (rAF and transitions run)')
  const atRest = await opacityOf(CARD)
  await hoverIn(TRIG)
  const onTrig = await opacityOf(CARD)
  await hoverOut()
  const after = await opacityOf(CARD)
  ok(atRest === '0' && onTrig === '1' && after === '0', `in the show the target is hidden at rest, shown on the trigger, hidden again (${atRest} → ${onTrig} → ${after})`)
  await exitShow()

  // ---- 2. a slide that dims other groups is not switched silently -------------
  await goSlide(1)
  await selectEl('s2-t')
  await interact()
  if (await pickBtn.count()) {
    await openPicker(); await pickOption('Rectangle')
    let s2 = (await doc())[1]
    ok(s2.hover?.type === 'focus-group' && !!s2.elements[1].showOnHover && s2.elements[0].group === s2.elements[1].showOnHover,
      `on a Dim other groups slide the pick sets trigger and target, and leaves the slide's hover alone (${JSON.stringify(s2.hover)})`)
    const st = await status()
    ok(st.some((x) => x.startsWith('dim:') && x.includes('pointing at Rectangle dims everything outside its group')), `the status line says the slide dims other groups, and that pointing at the trigger now dims the rest (${JSON.stringify(st)})`)
    const fix = p.locator('.ed-props .ed-hover-status[data-state="dim"] .ed-hover-fix')
    ok((await fix.innerText().catch(() => '')).trim() === 'Switch to Switch content', 'and offers Switch to Switch content')
    if (await fix.count()) { await fix.click(); await p.waitForTimeout(300) }
    s2 = (await doc())[1]
    ok(s2.hover?.type === 'reveal', `pressing it switches the slide (${JSON.stringify(s2.hover)})`)
    ok((await status()).some((x) => x.startsWith('ok:')), 'and the status line then says it works')
  }

  // ---- 3. the status line and the set bar on broken reveals ---------------------
  await goSlide(4)
  await selectEl('s5-t')
  await interact()
  {
    const st = await status()
    ok(st.length === 1 && st[0].startsWith('off:'), `slide hover off: the status line says so (${JSON.stringify(st)})`)
    ok((await p.locator('.ed-props .ed-hover-status[data-state="off"] .ed-hover-fix').innerText().catch(() => '')).trim() === 'Turn on', '…with Turn on')
    ok(await p.locator('.ed-setchip-warn').count() === 1 && /Turn on/.test(await p.locator('.ed-setbar-fix').innerText().catch(() => '')), 'the Hover set bar flags the set and offers Turn on')
  }
  await goSlide(3)
  await selectEl('s4-t')
  await interact()
  {
    const st = await status()
    ok(st.length === 1 && st[0].startsWith('orphan:') && st[0].includes('“Rectangle”'), `nothing in the group: the status line says so (${JSON.stringify(st)})`)
    ok((await pickBtn.innerText().catch(() => '')).includes('Rectangle'), 'the picker shows the name the set waits on')
    const chip = p.locator('.ed-setchip-warn')
    ok(await chip.count() === 1 && (await chip.innerText()).includes('Rectangle'), 'the Hover set bar flags the unreachable set')
    const fix = p.locator('.ed-setbar-fix', { hasText: 'Pick the trigger' })
    ok(await fix.count() === 1, 'and offers Pick the trigger')
    await p.keyboard.press('Escape'); await p.waitForTimeout(150) // nothing selected: the action must find the target itself
    if (await fix.count()) { await fix.click(); await p.waitForTimeout(400) }
    ok(await p.locator('.ed-hover-pick').count() === 1, 'the set bar\'s Pick the trigger opens the picker for that set\'s element')
    ok(JSON.stringify(await p.evaluate(() => window.bento.selection ?? [])) === '["s4-t"]', 'with that element selected')
    await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  }

  // ---- 3b. triggers the pointer can never be on -----------------------------------
  await goSlide(5)
  ok(await p.locator('.ed-setchip-warn').count() === 1 && await p.locator('.ed-setbar-fix', { hasText: 'Pick the trigger' }).count() === 1,
    'an element carrying its own set\'s group: the Hover set bar flags the set (it cannot be its own trigger)')
  await selectEl('s6-t')
  await interact()
  {
    const st = await status()
    ok(st.length === 1 && st[0].startsWith('hidden:') && st[0].includes('Self'), `…and the status line says the pointer can never reach it (${JSON.stringify(st)})`)
  }
  await goSlide(6)
  await selectEl('s7-t')
  await interact()
  {
    const st = await status()
    ok(st.length === 1 && st[0].startsWith('hidden:') && st[0].includes('Hidden box'), `a hidden trigger: the status line names it and says why (${JSON.stringify(st)})`)
    await openPicker()
    const opts = (await p.locator('.ed-hover-pick [role=option]').allInnerTexts()).map((x) => x.trim())
    ok(opts.includes('Visible box') && !opts.includes('Hidden box'), `the picker leaves hidden elements out (${JSON.stringify(opts)})`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  }
  await goSlide(7)
  await selectEl('s8-t')
  await interact()
  if (await pickBtn.count()) {
    await openPicker(); await pickOption('Button')
    await p.waitForTimeout(400) // components re-derive copies on the doc event
    const all = await doc()
    const main = all[7].elements[0], copy = all[8].elements[0]
    ok(!!main.group && all[7].elements[1].showOnHover === main.group, `a component main picked as the trigger takes the group ("${main.group}")`)
    ok(!copy.group && (copy.component?.over ?? []).includes('group'), `…and its copy on another slide does not join it (copy group ${JSON.stringify(copy.group)}, over ${JSON.stringify(copy.component?.over)})`)
    await p.keyboard.press('Control+z'); await p.waitForTimeout(400)
    const back = await doc()
    ok(!back[7].elements[0].group && !back[8].elements[0].component?.over && !back[7].elements[1].showOnHover && !back[7].hover, 'one ⌘Z takes back the group, the copy\'s override, the set and the slide\'s hover')
  }

  // ---- 4. the validator ----------------------------------------------------------
  {
    const f = await p.evaluate(() => window.bento.validate().findings.filter((x) => x.code.startsWith('hover-')).map((x) => `${x.code}@${x.element ?? x.slide}`).sort())
    ok(JSON.stringify(f) === JSON.stringify(['hover-off@s5', 'hover-set-unreachable@s4-t', 'hover-set-unreachable@s6-t', 'hover-set-unreachable@s7-t']),
      `validate() reports hover-off on the slide with hover off, hover-set-unreachable on the typed layer name, nothing on the working slides (${JSON.stringify(f)})`)
  }

  // ---- 5. a hand-typed deck behaves as before -------------------------------------
  await goSlide(2)
  await selectEl('s3-r')
  await p.keyboard.press('Escape')
  await present()
  const rest3 = await opacityOf('s3-t')
  await hoverIn('s3-r')
  const on3 = await opacityOf('s3-t')
  await hoverOut()
  ok(rest3 === '0' && on3 === '1', `a hand-typed group reveals in the show as before (${rest3} → ${on3})`)
  await exitShow()
  await goSlide(2)
  await selectEl('s3-t')
  await interact()
  ok((await pickBtn.innerText().catch(() => '')).trim() === 'Italy', 'the picker names its trigger by its layer name')
  ok((await status()).some((x) => x.startsWith('ok:') && x.includes('Italy')), 'and the status line says it works')
  const s3 = (await doc())[2]
  ok(s3.elements[0].group === 'italy' && s3.elements[1].showOnHover === 'italy' && s3.hover.type === 'reveal' && !('default' in s3.hover), 'opening and inspecting it changed nothing')

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
