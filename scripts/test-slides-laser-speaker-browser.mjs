// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The presenter points from the speaker view, and the dot lands on the audience window.
//
//   npm run build:single --prefix slides && node scripts/test-slides-laser-speaker-browser.mjs
//
// WHAT THIS PROVES (real mouse and keyboard input in both windows):
//   1. toggling the laser from the speaker view shows its message in the
//      speaker view, never as a toast on the audience window;
//   2. pressing and dragging over the speaker view's current-slide preview
//      draws the dot and a trail on the audience window, at the same fraction
//      of the slide (within 2 px at 1280×720), with a feedback dot in the
//      speaker view under the pointer;
//   3. letting go fades the trail out; leaving the preview ends the stroke;
//   4. while the screen is black, pointing from the speaker view draws nothing;
//   5. with Reduce motion on, the dot shows and the trail does not;
//   6. the audience window's own laser still works, and its L still toasts.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  // never reach a real host: no http(s), no WebSocket, offline mode on
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.size = { width: 1280, height: 720 }
    d.slides = [1, 2].map((n) => ({ id: `s${n}`, background: '#ffffff', elements: [
      { id: `t${n}`, type: 'text', x: 120, y: 80, w: 800, h: 100, rotation: 0, opacity: 1, html: `Slide ${n}`, fontSize: 40, color: '#1E2A3A', align: 'left' }] }))
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(300)

  const popup = ctx.waitForEvent('page')
  await p.locator('.ed-present-pill .ed-pill-caret').click()
  await p.locator('.ed-present-pill .ed-menu').getByText('Open speaker view', { exact: true }).click()
  const sp = await popup
  sp.on('pageerror', (e) => errors.push('speaker: ' + e.message))
  await sp.waitForLoadState()
  await sp.setViewportSize({ width: 1200, height: 800 })
  await p.locator('.ed-present-pill .ed-pill-caret').click()
  await p.locator('.ed-present-pill .ed-menu').getByText('Present in this tab', { exact: true }).click()
  await sp.waitForSelector('.sv-current .bento-slide', { timeout: 15000 })
  await p.waitForSelector('.bento-present-overlay .reveal .slides > section.present', { timeout: 10000 })
  await p.waitForTimeout(800)
  const vis = await Promise.all([p, sp].map((pg) => pg.evaluate(() => document.visibilityState)))
  ok(vis.every((v) => v === 'visible'), `both windows are visible, so animation frames run (${vis.join(', ')})`)

  const audienceToast = () => p.evaluate(() => {
    const el = document.querySelector('.bento-present-overlay .bento-present-toast')
    return el && el.classList.contains('show') ? el.textContent : null
  })
  const speakerToast = () => sp.evaluate(() => {
    const el = document.querySelector('.bento-present-toast')
    return el && el.classList.contains('show') ? el.textContent : null
  })
  const laserOn = () => p.evaluate(() => document.querySelector('.bento-present-overlay')?.classList.contains('laser-enabled'))
  const remote = () => p.evaluate(() => {
    const d = document.querySelector('.bento-present-overlay .bento-laser-dot.bento-remote')
    if (!d) return { visible: false }
    const b = d.getBoundingClientRect()
    return { visible: d.classList.contains('visible'), opacity: +getComputedStyle(d).opacity, x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  const lit = () => p.evaluate(() => [...document.querySelectorAll('.bento-present-overlay .bento-laser-trail-segment.core')]
    .filter((s) => +(s.getAttribute('opacity') ?? 0) > 0.01).length)
  const audRect = () => p.evaluate(() => { const b = document.querySelector('.bento-present-overlay section.present .bento-slide').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
  const spRect = () => sp.evaluate(() => { const b = document.querySelector('.sv-current .bento-slide').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
  const spDot = () => sp.evaluate(() => {
    const d = document.querySelector('.sv-laser-dot')
    if (!d) return { visible: false }
    const b = d.getBoundingClientRect()
    return { visible: d.classList.contains('visible'), x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })

  // 1. speaker-side toggle: message in the speaker view, no toast for the audience
  const btn = await sp.locator('.sv-btn[data-nav="laser"]').boundingBox()
  await sp.mouse.click(btn.x + btn.width / 2, btn.y + btn.height / 2)
  await p.waitForTimeout(120)
  ok(await laserOn(), 'the speaker Laser button switches the laser on')
  const aToast = await audienceToast()
  ok(aToast === null, `no toast on the audience window for the speaker-side toggle (${JSON.stringify(aToast)})`)
  const sToast = await speakerToast()
  ok(typeof sToast === 'string' && /Laser/.test(sToast), `the speaker view shows the message instead (${JSON.stringify(sToast)})`)
  ok(await sp.evaluate(() => document.querySelector('.sv-btn[data-nav="laser"]').getAttribute('aria-pressed')) === 'true', 'the Laser button reads as pressed')

  // 2. press and drag over the preview
  const ar = await audRect()
  ok(Math.abs(ar.w - 1280) < 1 && Math.abs(ar.h - 720) < 1, `the audience slide is 1280×720 (${ar.w.toFixed(1)}×${ar.h.toFixed(1)})`)
  let sr = await spRect()
  await sp.mouse.move(sr.x + sr.w * 0.25, sr.y + sr.h * 0.35)
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.62, sr.y + sr.h * 0.58, { steps: 24 })
  await p.waitForTimeout(150) // the remote dot's 45ms glide settles
  const fx = 0.62, fy = 0.58
  const r1 = await remote()
  const ex = ar.x + fx * ar.w, ey = ar.y + fy * ar.h
  ok(r1.visible, 'while pointing from the speaker view, the dot shows on the audience window')
  const err = Math.hypot(r1.x - ex, r1.y - ey)
  ok(err <= 2, `at the same slide fraction: (${r1.x?.toFixed(1)}, ${r1.y?.toFixed(1)}) vs (${ex.toFixed(1)}, ${ey.toFixed(1)}), off by ${err.toFixed(2)} px`)
  const trail = await lit()
  ok(trail > 3, `and a trail follows it (${trail} lit segments)`)
  const sd = await spDot()
  const sdErr = Math.hypot(sd.x - (sr.x + fx * sr.w), sd.y - (sr.y + fy * sr.h))
  ok(sd.visible && sdErr <= 2, `the speaker view shows a feedback dot under the pointer (visible ${sd.visible}, off by ${sdErr.toFixed(2)} px)`)

  // 3. release fades; leaving ends the stroke
  await sp.mouse.up()
  await p.waitForTimeout(60)
  const r2 = await remote()
  const fading = await lit()
  ok(!r2.visible && fading > 0, `letting go fades: dot released (${r2.visible}), trail still fading (${fading} lit)`)
  ok(!(await spDot()).visible, 'and the speaker feedback dot goes')
  await p.waitForTimeout(1100)
  ok(await lit() === 0, `the trail runs out on its own (${await lit()} lit)`)

  sr = await spRect()
  await sp.mouse.move(sr.x + sr.w * 0.3, sr.y + sr.h * 0.5)
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.5, sr.y + sr.h * 0.5, { steps: 6 })
  await p.waitForTimeout(80)
  ok((await remote()).visible, 'a second stroke shows the dot again')
  const top = await sp.evaluate(() => { const b = document.querySelector('.sv-top').getBoundingClientRect(); return { x: b.x + 10, y: b.y + b.height / 2 } })
  await sp.mouse.move(top.x, top.y, { steps: 3 })
  await p.waitForTimeout(80)
  ok(!(await remote()).visible, 'leaving the preview releases the dot on the audience window')
  await sp.mouse.up()

  // a press that never started on the preview draws nothing on the way in
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.5, sr.y + sr.h * 0.5, { steps: 6 })
  await p.waitForTimeout(80)
  ok(!(await remote()).visible, 'a drag that started outside the preview draws nothing')
  await sp.mouse.up()
  await p.waitForTimeout(1100)

  // 4. black screen: nothing
  await sp.keyboard.press('b')
  await p.waitForTimeout(100)
  ok(await p.evaluate(() => !document.querySelector('.bento-blackout').hidden), 'B in the speaker view blacks the screen')
  await sp.mouse.move(sr.x + sr.w * 0.3, sr.y + sr.h * 0.4)
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.6, sr.y + sr.h * 0.5, { steps: 10 })
  await p.waitForTimeout(80)
  const rb = await remote()
  ok(!rb.visible && (await lit()) === 0, `while black, pointing from the speaker view draws nothing (dot ${rb.visible}, ${await lit()} lit)`)
  await sp.mouse.up()
  await sp.keyboard.press('b')
  await p.waitForTimeout(100)

  // 5. reduce motion: dot, no trail
  await sp.keyboard.press('m')
  await p.waitForTimeout(150)
  ok(await p.evaluate(() => document.querySelector('.bento-present-overlay').classList.contains('reduce-motion')), 'M in the speaker view turns Reduce motion on')
  await sp.mouse.move(sr.x + sr.w * 0.3, sr.y + sr.h * 0.4)
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.6, sr.y + sr.h * 0.5, { steps: 16 })
  await p.waitForTimeout(80)
  const rm = await remote()
  ok(rm.visible && (await lit()) === 0, `with Reduce motion, the dot shows and no trail (dot ${rm.visible}, ${await lit()} lit)`)
  await sp.mouse.up()
  await sp.keyboard.press('m')
  await p.waitForTimeout(1600) // let the speaker-side toasts run out

  // L in the speaker view: toggles, still no audience toast
  await sp.keyboard.press('l')
  await p.waitForTimeout(120)
  ok(!(await laserOn()) && (await audienceToast()) === null, 'L in the speaker view switches it off, with no audience toast')
  await sp.mouse.move(sr.x + sr.w * 0.3, sr.y + sr.h * 0.4)
  await sp.mouse.down()
  await sp.mouse.move(sr.x + sr.w * 0.6, sr.y + sr.h * 0.5, { steps: 6 })
  await p.waitForTimeout(80)
  ok(!(await remote()).visible, 'with the laser off, the preview draws nothing')
  await sp.mouse.up()

  // 6. the audience window's own laser is unchanged
  await p.bringToFront()
  await p.keyboard.press('l')
  await p.waitForTimeout(120)
  const own = await audienceToast()
  ok(await laserOn() && typeof own === 'string' && /Laser/.test(own), `L on the audience window still toasts there (${JSON.stringify(own)})`)
  await p.mouse.move(ar.x + ar.w * 0.2, ar.y + ar.h * 0.4)
  await p.mouse.down()
  await p.mouse.move(ar.x + ar.w * 0.6, ar.y + ar.h * 0.5, { steps: 20 })
  await p.waitForTimeout(40)
  const local = await p.evaluate(() => {
    const d = document.querySelector('.bento-present-overlay .bento-laser-dot:not(.bento-remote)')
    const b = d.getBoundingClientRect()
    return { visible: d.classList.contains('visible'), x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  const lerr = Math.hypot(local.x - (ar.x + ar.w * 0.6), local.y - (ar.y + ar.h * 0.5))
  ok(local.visible && lerr <= 2 && (await lit()) > 3, `drawing on the audience window still shows its dot and trail (off by ${lerr.toFixed(2)} px, ${await lit()} lit)`)
  await p.mouse.up()

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
