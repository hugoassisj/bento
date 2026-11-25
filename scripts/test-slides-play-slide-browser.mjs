// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Play slide: a slide's motion plays on the editor stage and the editor comes back by itself.
//
//   npm run build:single --prefix slides && node scripts/test-slides-play-slide-browser.mjs [shell]
//
// WHAT THIS PROVES (engine stepped by hand: window.bento.anim.setManual + tick,
// every motion measured with getBoundingClientRect or rendered text, never a
// style read back)
//   1. ▶ Play slide is in the slide's Animate tab and an element's; pressing it
//      draws an overlay in the canvas's own box (not the tab-filling show).
//   2. The incoming morph moves the paired element from the slide before; the
//      entrance rises; the count-up's text counts; a motion-path loop and a
//      pan-and-zoom element keep moving through the play.
//   3. The two build steps appear one after the other, after the slide
//      arrives, each with its entrance (it travels).
//   4. The play ends by itself: the overlay is gone, the document block and the
//      model are unchanged, the canvas DOM is exactly what it was, and the
//      selection and scroll position are as they were.
//   5. Esc and a click on the stage stop it at once; the selection survives
//      and the canvas is untouched.
//   6. A slide with no slide before it plays its entrances without a transition.
//   7. Reduced motion: nothing travels, the steps still come one by one.
//   8. Dark and light chrome, the fitted zoom and zoomed in past 100%: the
//      overlay covers exactly the canvas slide.
import { readFileSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const SHELL = resolve(process.argv[2] || 'slides/dist-single/Bento_Slides.bento.html')
const shell = readFileSync(SHELL, 'utf8')
const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'play-slide-')))
let pass = 0, fails = 0
const ok = (c, m) => { c ? pass++ : fails++; console.log((c ? '  ok    ' : '  FAIL  ') + m) }

const base = { rotation: 0, opacity: 1 }
const rect = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, ...base, fill: '#d04a02', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra })
const text = (id, html, x, y, extra = {}) => ({ id, type: 'text', html, x, y, w: 300, h: 80, ...base, fontSize: 48, fontFamily: 'Inter', fontWeight: 700, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.2, ...extra })
const DOC = {
  format: 'bento/slides', version: 1, docId: 'play-slide-rig', title: 'Play slide rig', size: { width: 1280, height: 720 },
  slides: [
    { id: 'sa', background: '#ffffff', transition: 'fade', notes: '', elements: [
      rect('m', 100, 100, 200, 100),
      text('first', 'Arrives', 600, 300, { fx: { enter: 'fade-up' } }),
    ] },
    { id: 'sb', background: '#ffffff', transition: 'morph', notes: '', elements: [
      rect('m', 700, 420, 300, 150),
      text('e', 'Enters', 100, 40, { fx: { enter: 'fade-up' } }),
      text('c', '250', 100, 160, { fx: { countUp: true } }),
      rect('s1', 100, 420, 120, 120, { fill: '#0b6', fx: { step: 1, enter: 'slide-up' } }),
      rect('s2', 300, 420, 120, 120, { fill: '#06b', fx: { step: 2, enter: 'slide-up' } }),
      rect('loop', 500, 100, 40, 40, { fill: '#222', fx: { loop: { type: 'motion-path', path: 'M0 0 C 120 0 120 120 240 120', duration: 2 } } }),
      rect('ken', 900, 60, 200, 120, { fill: '#e8c', fx: { ambient: 'kenburns', ken: { dir: 'drift', scale: 1.4, duration: 3 } } }),
    ] },
  ],
}
const write = (name, d) => {
  const html = shell.replace(/(<script[^>]*id="bento-doc"[^>]*>)[\s\S]*?(<\/script>)/, (_, a, b) => a + JSON.stringify(d).replace(/</g, '\\u003c') + b)
  const f = join(DIR, name); writeFileSync(f, html); return 'file://' + f
}
const URL_ = write('play.bento.html', DOC)

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
async function open({ theme = 'light', reduce = false, viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await b.newContext({ viewport, colorScheme: theme, reducedMotion: reduce ? 'reduce' : 'no-preference' })
  // never a network connection: offline switch before boot, every socket and request refused
  await ctx.addInitScript(({ theme }) => {
    try {
      localStorage.setItem('bento-offline', 'on')
      localStorage.setItem('bento-slideshow-started', '1')
      localStorage.setItem('bento-theme', theme)
      localStorage.setItem('bento-panel-tab', '"animate"')
    } catch {}
  }, { theme })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  ctxs.push(ctx)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(URL_)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'), null, { timeout: 20000 })
  return { ctx, p, errs }
}
const goSlide = async (p, i) => {
  await p.locator('.ed-sidebar .ed-thumb').nth(i).click()
  await p.waitForTimeout(250)
}
const state = (p) => p.evaluate(() => {
  const s = window.bento.serialize()
  const sc = document.querySelector('.ed-scroll')
  return {
    block: s.match(/<script[^>]*id="bento-doc"[^>]*>([\s\S]*?)<\/script>/)[1],
    model: JSON.stringify(window.bento.doc),
    canvas: document.querySelector('.ed-stage-scale > .bento-slide').outerHTML,
    sel: JSON.stringify(window.bento.selection),
    scroll: sc ? `${sc.scrollLeft},${sc.scrollTop}` : '',
  }
})
// rendered geometry of an element INSIDE the overlay's top (incoming) layer
const probe = (p) => p.evaluate(() => {
  const o = document.querySelector('.ed-play-overlay')
  if (!o) return null
  const layer = [...o.querySelectorAll(':scope > .ed-play-layer')].pop()
  const g = (id) => {
    const n = layer.querySelector(`[data-el-id="${id}"]`)
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, vis: n.checkVisibility({ visibilityProperty: true, opacityProperty: true }), text: n.textContent }
  }
  return { layers: o.querySelectorAll(':scope > .ed-play-layer').length, m: g('m'), e: g('e'), c: g('c'), s1: g('s1'), s2: g('s2'), loop: g('loop'), ken: g('ken'), first: g('first') }
})
const tick = (p, s) => p.evaluate((s) => { for (let k = 0; k < Math.round(s / 0.02); k++) window.bento.anim.tick(0.02) }, s)
const pressPlay = (p) => p.locator('.ed-play-slide:visible').first().click({ timeout: 3000 })
// a section that throws (on an older shell: no ▶ Play slide to press) fails, and the rest still run
let ctxs = []
async function section(name, fn) {
  try { await fn() } catch (e) { ok(false, `section ${name} could not finish: ${String(e.message).split('\n')[0]}`) }
  for (const c of ctxs.splice(0)) await c.close().catch(() => {})
}

// --- 1-4: a full play, nothing selected -------------------------------------
await section('1-4', async () => {
  console.log('\n1-4. the whole play, stepped by hand\n')
  const { ctx, p, errs } = await open()
  ok(await p.evaluate(() => document.visibilityState) === 'visible', 'the tab is visible (rAF is not throttled)')
  await goSlide(p, 1)
  await p.keyboard.press('Escape')
  ok(await p.locator('.ed-play-slide:visible').count() === 1, '▶ Play slide is in the slide\'s Animate tab')
  const before = await state(p)
  await p.evaluate(() => window.bento.anim.setManual(true))
  await pressPlay(p)
  const box = await p.evaluate(() => {
    const o = document.querySelector('.ed-play-overlay')?.getBoundingClientRect()
    const c = document.querySelector('.ed-stage-scale > .bento-slide').getBoundingClientRect()
    return o && [o.x - c.x, o.y - c.y, o.width - c.width, o.height - c.height].map((v) => Math.round(v))
  })
  ok(!!box && box.every((v) => v === 0), `an overlay covers exactly the canvas slide (offsets ${box})`)
  ok(await p.locator('.bento-present-overlay').count() === 0, 'no slideshow is started')
  const t0 = await probe(p)
  ok(t0.layers === 2, 'the slide before and this slide are both drawn (a walk source exists)')
  // sample the whole play at 20ms resolution
  const rows = []
  let t = 0
  while (t < 12) {
    const r = await probe(p)
    if (!r) break
    rows.push({ t, ...r })
    await tick(p, 0.05); t += 0.05
  }
  const end = rows.length ? rows[rows.length - 1].t : 0
  const at = (pred) => rows.find(pred)?.t ?? null
  // the incoming layer is laid out at its final frame until the slide arrives
  const m0 = rows.find((r) => r.t > 0.4).m, mEnd = rows[rows.length - 1].m
  const mids = rows.filter((r) => r.t > 0.4 && r.t < 1.2).map((r) => r.m.x)
  ok(mEnd.x - m0.x > 300 && mids.some((x) => x > m0.x + 20 && x < mEnd.x - 20), `the morph moves the paired element from the slide before (x ${m0.x.toFixed(0)} → ${mEnd.x.toFixed(0)}, in between ${mids.slice(0, 4).map((x) => x.toFixed(0)).join(' ')}…)`)
  const eYs = rows.filter((r) => r.t > 0.35 && r.t < 1.6).map((r) => r.e.y)
  ok(eYs.length && Math.max(...eYs) - Math.min(...eYs) > 3, `the entrance rises (${(Math.max(...eYs) - Math.min(...eYs)).toFixed(1)}px)`)
  const counts = [...new Set(rows.filter((r) => r.t > 0.35).map((r) => r.c.text))]
  ok(counts.length > 3 && counts.includes('250') && counts.some((c) => +c > 0 && +c < 250), `the count-up's text counts (${counts.slice(0, 6).join(', ')} … ${counts[counts.length - 1]})`)
  const loopPos = new Set(rows.filter((r) => r.t > 1).map((r) => `${Math.round(r.loop.x)},${Math.round(r.loop.y)}`))
  ok(loopPos.size > 10, `the motion-path loop keeps moving (${loopPos.size} distinct positions)`)
  const kenW = rows.filter((r) => r.t > 1).map((r) => r.ken.w)
  ok(Math.max(...kenW) - Math.min(...kenW) > 10, `pan and zoom keeps zooming (width ${Math.min(...kenW).toFixed(0)}..${Math.max(...kenW).toFixed(0)})`)
  const arrive = at((r) => r.e.vis && r.t > 0)
  const s1 = at((r) => r.s1.vis), s2 = at((r) => r.s2.vis)
  ok(s1 !== null && s2 !== null && arrive !== null && arrive < s1 && s1 < s2, `the steps appear in order, after the slide arrives (arrive ${arrive}, step 1 ${s1?.toFixed(2)}, step 2 ${s2?.toFixed(2)})`)
  ok(rows.filter((r) => s1 !== null && r.t < s1).every((r) => !r.s1.vis && !r.s2.vis) && rows.filter((r) => s2 !== null && r.t < s2).every((r) => !r.s2.vis), 'each stepped element stays hidden until its step')
  const s1Ys = rows.filter((r) => s1 !== null && r.t >= s1 && r.t < s1 + 0.8).map((r) => r.s1.y)
  ok(s1Ys.length > 2 && s1Ys[0] - s1Ys[s1Ys.length - 1] > 20, `a step's entrance travels (${(s1Ys[0] - s1Ys[s1Ys.length - 1]).toFixed(0)}px up)`)
  ok(rows.length > 1 && end < 12 && await p.locator('.ed-play-overlay').count() === 0, `the play ends by itself after ${end.toFixed(2)}s of engine time`)
  const after = await state(p)
  ok(after.block === before.block, 'the saved document block is byte-identical')
  ok(after.model === before.model, 'the model is unchanged')
  ok(after.canvas === before.canvas, 'the canvas DOM is exactly as it was (nothing left mid-animation)')
  ok(after.sel === before.sel && after.scroll === before.scroll, `selection and scroll are unchanged (${after.sel}, ${after.scroll})`)
  await p.evaluate(() => window.bento.undo())
  ok((await state(p)).model === before.model, 'there is no undo step to take back')
  await tick(p, 2)
  ok(await p.evaluate(() => window.bento.anim.activeCount) === 0, 'no tween is left running')
  ok(!errs.length, `no page error ${errs.join(' | ')}`)
  await ctx.close()
})

// --- 5: Esc and a click stop it, with an element selected ---------------------
await section('5', async () => {
  console.log('\n5. Esc and a click stop it\n')
  const { ctx, p, errs } = await open()
  await goSlide(p, 1)
  const bx = await p.locator('.ed-stage-scale > .bento-slide [data-el-id="m"]').boundingBox()
  await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2)
  await p.waitForTimeout(250)
  const before = await state(p)
  ok(before.sel === '["m"]', `an element is selected (${before.sel})`)
  ok(await p.locator('.ed-play-slide:visible').count() === 1, '▶ Play slide is in the element\'s Animate tab too')
  await p.evaluate(() => window.bento.anim.setManual(true))
  for (const how of ['Esc', 'a click on the stage', 'a click on another element']) {
    await pressPlay(p)
    await tick(p, 0.7)
    const mid = await probe(p)
    ok(!!mid && mid.m.x > 0, `${how}: playing, mid-morph`)
    if (how === 'Esc') await p.keyboard.press('Escape')
    else {
      const ob = await p.locator('.ed-play-overlay').boundingBox()
      const at = how === 'a click on the stage' ? [ob.x + 20, ob.y + ob.height - 20] : await p.locator('.ed-stage-scale > .bento-slide [data-el-id="s1"]').boundingBox().then((r) => [r.x + 10, r.y + 10])
      await p.mouse.click(at[0], at[1])
    }
    ok(await p.locator('.ed-play-overlay').count() === 0, `${how} stops it at once`)
    const now = await state(p)
    ok(now.sel === before.sel, `${how}: the selection survives (${now.sel})`)
    ok(now.canvas === before.canvas && now.model === before.model, `${how}: the canvas and the model are untouched`)
  }
  // an edit mid-play (here: a nudge) stops it before it lands
  await pressPlay(p)
  await tick(p, 0.5)
  await p.keyboard.press('ArrowRight')
  ok(await p.locator('.ed-play-overlay').count() === 0, 'an edit stops the play')
  await pressPlay(p)
  await tick(p, 0.5)
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  ok(await p.locator('.ed-play-overlay').count() === 0, 'an undo stops the play')
  await pressPlay(p)
  await tick(p, 0.5)
  await goSlide(p, 0)
  ok(await p.locator('.ed-play-overlay').count() === 0, 'another slide stops the play')
  ok(!errs.length, `no page error ${errs.join(' | ')}`)
  await ctx.close()
})

// --- 6: no slide before -------------------------------------------------------
await section('6', async () => {
  console.log('\n6. the first slide: no transition, the rest plays\n')
  const { ctx, p, errs } = await open()
  await goSlide(p, 0)
  await p.keyboard.press('Escape')
  await p.evaluate(() => window.bento.anim.setManual(true))
  await pressPlay(p)
  const r0 = await probe(p)
  ok(r0?.layers === 1, `only this slide is drawn (${r0?.layers} layer)`)
  const ys = []
  for (let k = 0; k < 20; k++) { const r = await probe(p); if (r) ys.push(r.first.y); await tick(p, 0.05) }
  ok(Math.max(...ys) - Math.min(...ys) > 3, `its entrance still plays (${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}px)`)
  await tick(p, 4)
  ok(await p.locator('.ed-play-overlay').count() === 0, 'and it ends by itself')
  ok(!errs.length, `no page error ${errs.join(' | ')}`)
  await ctx.close()
})

// --- 7: reduced motion --------------------------------------------------------
await section('7', async () => {
  console.log('\n7. reduced motion: nothing travels, the steps still come\n')
  const { ctx, p, errs } = await open({ reduce: true })
  await goSlide(p, 1)
  await p.keyboard.press('Escape')
  await p.evaluate(() => window.bento.anim.setManual(true))
  await pressPlay(p)
  const rows = []
  for (let t = 0; t < 10; t += 0.05) { const r = await probe(p); if (!r) break; rows.push({ t, ...r }); await tick(p, 0.05) }
  ok(rows.length && rows[0].layers === 1, 'no transition: only this slide is drawn')
  ok(new Set(rows.map((r) => Math.round(r.m.x))).size === 1 && new Set(rows.map((r) => Math.round(r.loop.x))).size === 1, 'nothing moves (the morph and the loop stay at their final frame)')
  const s1 = rows.find((r) => r.s1.vis)?.t ?? null, s2 = rows.find((r) => r.s2.vis)?.t ?? null
  ok(s1 !== null && s2 !== null && s1 < s2, `the steps still appear in order (${s1?.toFixed(2)}, ${s2?.toFixed(2)})`)
  ok(await p.locator('.ed-play-overlay').count() === 0, 'and it ends by itself')
  ok(!errs.length, `no page error ${errs.join(' | ')}`)
  await ctx.close()
})

// --- 8: chrome themes and zoom --------------------------------------------------
for (const theme of ['dark', 'light']) await section(`8 (${theme})`, async () => {
  console.log(`\n8. ${theme} chrome, fitted and zoomed in\n`)
  const { ctx, p, errs } = await open({ theme })
  const chrome = await p.evaluate(() => document.documentElement.getAttribute('data-theme') || getComputedStyle(document.documentElement).colorScheme)
  ok(String(chrome).includes(theme), `the chrome is ${theme} (${chrome})`)
  await goSlide(p, 1)
  await p.keyboard.press('Escape')
  for (const zoom of ['fitted', 'zoomed']) {
    if (zoom === 'zoomed') {
      for (let k = 0; k < 6; k++) {
        const pct = +((await p.locator('.ed-zoombar').innerText().catch(() => '')).match(/(\d+)%/)?.[1] ?? 0)
        if (pct >= 100) break
        await p.locator('.ed-scroll').hover()
        await p.keyboard.press('Control+=')
        await p.waitForTimeout(150)
      }
    }
    const label = (await p.locator('.ed-zoombar').innerText().catch(() => '')).match(/\d+%/)?.[0]
    const before = await state(p)
    await p.evaluate(() => window.bento.anim.setManual(true))
    await pressPlay(p)
    await tick(p, 0.9)
    const g = await p.evaluate(() => {
      const o = document.querySelector('.ed-play-overlay')?.getBoundingClientRect()
      const c = document.querySelector('.ed-stage-scale > .bento-slide').getBoundingClientRect()
      return o && [o.x - c.x, o.y - c.y, o.width - c.width, o.height - c.height].map((v) => Math.round(v))
    })
    ok(!!g && g.every((v) => v === 0), `${theme}, ${zoom} (${label}): the overlay covers exactly the canvas slide (${g})`)
    await tick(p, 10)
    ok(await p.locator('.ed-play-overlay').count() === 0 && (await state(p)).canvas === before.canvas, `${theme}, ${zoom}: it ends and the canvas is as it was`)
    await p.evaluate(() => window.bento.anim.setManual(false))
  }
  ok(!errs.length, `no page error ${errs.join(' | ')}`)
  await ctx.close()
})

await b.close()
console.log(`\n${pass}/${pass + fails} checks passed`)
process.exit(fails ? 1 : 0)
