// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// validate() sees what people see, in the packaged shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-validate-visual-browser.mjs
//
// Cream text on a cream slide, two text boxes on top of each other, a frame
// child laid out past a clipping frame and a chart axis label cut off at the
// chart's edge all used to validate clean. scripts/test-validate.ts covers the
// DOM-free half (whole boxes); this rig covers what needs the real renderer.
//
// WHAT THIS PROVES:
//   1. the issue's probes: low-contrast with the measured ratio (none in
//      #0D1B2E), exactly one text-overlap (none with a 1px gap);
//   2. with a DOM, text is judged on its GLYPHS: a tall box whose words sit on
//      a dark card reads (its empty corners off the card do not count), and a
//      mostly empty box does not collide with the text under its empty part —
//      while the same documents judged on whole boxes (measure: false) do;
//   3. outside-frame after the real layout pass, both on a raw document and on
//      the loaded one; a frame tall enough reports nothing;
//   4. chart-label-clipped names the cut-off text (a y-axis label wider than
//      its margin), and a chart with room reports nothing; without a DOM the
//      chart check is skipped while low-contrast still runs on whole boxes;
//   5. the starter deck and the four agent fixtures gain no low-contrast or
//      text-overlap warning; the starter's only visual findings are the chart
//      labels it really cuts off ("Engagement", "Growth");
//   6. validate() leaves the document unchanged, and its run time on the
//      starter is printed.
import { readFileSync, readdirSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const fixtures = {}
const at = new URL('fixtures/agent-decks/', import.meta.url)
for (const f of readdirSync(at).filter((n) => n.endsWith('.json'))) fixtures[f] = readFileSync(new URL(f, at), 'utf8')
const VISUAL = ['low-contrast', 'text-overlap', 'outside-frame', 'chart-label-clipped']

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.evaluate(() => document.fonts.ready)
  await p.evaluate((VISUAL) => {
    const base = window.bento.read()
    // the starter as it opened — later sections load other decks over it
    window.__starter = JSON.stringify(base)
    window.__run = (els, opts = {}, bg = '#F2F0EA') => window.bento.validate({ ...base, slides: [{ id: 's1', background: bg, elements: els }] }, opts)
      .findings.filter((f) => VISUAL.includes(f.code))
  }, VISUAL)

  // ---- 1. the probes ---------------------------------------------------------
  console.log('\nthe issue\'s probes')
  const probes = await p.evaluate(() => {
    const t = (extra) => ({ id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 60, html: '<p>hello</p>', color: '#F2F0EA', fontSize: 20, ...extra })
    const pair = (bx) => [
      { id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 80, html: '<p>hello there</p>', fontSize: 30 },
      { id: 'b', type: 'text', x: bx, y: bx === 110 ? 110 : 100, w: 400, h: 80, html: '<p>overlapping</p>', fontSize: 30 },
    ]
    return { p1: window.__run([t()]), p1dark: window.__run([t({ color: '#0D1B2E' })]), p2: window.__run(pair(110)), gap: window.__run(pair(501)) }
  })
  const lc = probes.p1.find((f) => f.code === 'low-contrast')
  ok(lc?.severity === 'warning' && lc.slide === 's1' && lc.element === 'a' && lc.path === 'color' && /Text is 1:1 against what is behind it \(needs 4\.5:1 at 20px\)/.test(lc.message),
    `probe 1: warning:low-contrast with the measured ratio (${lc?.message.slice(0, 70) ?? 'none'})`)
  ok(/glyphs/.test(lc?.message ?? ''), 'measured on the glyphs, with a DOM')
  ok(!probes.p1dark.length, 'the same text in #0D1B2E: none')
  ok(probes.p2.filter((f) => f.code === 'text-overlap').length === 1 && probes.p2[0].element === 'b', `probe 2: exactly one text-overlap, on the upper box (${probes.p2.map((f) => f.code + '@' + f.element)})`)
  ok(!probes.gap.length, 'side by side with a 1px gap: none')

  // ---- 2. glyphs, not boxes --------------------------------------------------------
  console.log('\nglyph areas')
  const glyphs = await p.evaluate(() => {
    // white words on a navy card at the top of a tall box; the box's lower part hangs off the card on a white slide
    const onCard = [
      { id: 'card', type: 'shape', shape: 'rect', x: 80, y: 80, w: 560, h: 80, fill: '#0D1B2E' },
      { id: 't', type: 'text', x: 100, y: 100, w: 500, h: 300, valign: 'top', html: '<p>on the card</p>', color: '#FFFFFF', fontSize: 24, lineHeight: 1.2 },
    ]
    // a 300px box with one line at its top, and a caption 200px down inside its empty part
    const tall = [
      { id: 'big', type: 'text', x: 100, y: 100, w: 600, h: 300, valign: 'top', html: '<p>Headline</p>', color: '#111111', fontSize: 40, lineHeight: 1.2 },
      { id: 'cap', type: 'text', x: 100, y: 300, w: 600, h: 40, valign: 'top', html: '<p>A caption under it</p>', color: '#111111', fontSize: 18 },
    ]
    return {
      cardMeasured: window.__run(onCard, {}, '#FFFFFF'), cardBoxes: window.__run(onCard, { measure: false }, '#FFFFFF'),
      tallMeasured: window.__run(tall, {}, '#FFFFFF'), tallBoxes: window.__run(tall, { measure: false }, '#FFFFFF'),
    }
  })
  ok(!glyphs.cardMeasured.length, 'words on a dark card read, though the box hangs off the card')
  ok(glyphs.cardBoxes.some((f) => f.code === 'low-contrast' && /whole box/.test(f.message)), 'judged on its whole box (no DOM), the empty corner fails — the glyphs are what make the difference')
  ok(!glyphs.tallMeasured.length, 'a caption inside a tall box\'s empty part does not collide with its headline')
  ok(glyphs.tallBoxes.some((f) => f.code === 'text-overlap' && f.element === 'cap'), 'judged on whole boxes, it does — again the glyphs decide')

  // ---- 3. frames, after the real layout pass -------------------------------------------
  console.log('\nframes')
  const frames = await p.evaluate(() => {
    const frame = (h) => ({ id: 'f', type: 'shape', shape: 'rect', x: 100, y: 100, w: 300, h, fill: '#EEEEEE', layout: { dir: 'col', gap: 10, pad: [10, 10, 10, 10], clip: true } })
    const kid = (id) => ({ id, type: 'text', x: 0, y: 0, w: 280, h: 60, html: `<p>${id}</p>`, color: '#111111', fontSize: 20, parentId: 'f' })
    const els = (h) => [frame(h), kid('k1'), kid('k2'), kid('k3')]
    const raw = window.__run(els(140))
    const roomy = window.__run(els(220))
    // the loaded document: loadDoc lays it out, validate() judges the store's copy
    const d = window.bento.read()
    d.slides = [{ id: 's1', background: '#FFFFFF', transition: 'fade', notes: '', elements: els(140) }]
    const rep = window.bento.loadDoc(JSON.stringify(d))
    const k3 = window.bento.doc.slides[0].elements.find((e) => e.id === 'k3')
    const loaded = window.bento.validate().findings.filter((f) => f.code === 'outside-frame')
    return { raw, roomy, loaded, k3y: k3?.y, rep: !!rep }
  })
  const of = frames.raw.find((f) => f.code === 'outside-frame')
  ok(of?.severity === 'warning' && of.element === 'k3' && /70px past the bottom of its frame "f", which clips/.test(of.message), `a raw document: the third child, laid out, is cut by its clipping frame (${of?.message.slice(0, 80) ?? 'none'})`)
  ok(frames.rep && frames.k3y === 250 && frames.loaded.length === 1 && frames.loaded[0].element === 'k3', `the loaded document (k3 laid out at y ${frames.k3y}) reports the same`)
  ok(!frames.roomy.some((f) => f.code === 'outside-frame'), 'a frame tall enough for its children: none')

  // ---- 4. charts ----------------------------------------------------------------------
  console.log('\ncharts')
  const charts = await p.evaluate(() => {
    const opt = (left) => ({ grid: { left, right: 16, top: 20, bottom: 30 }, xAxis: { type: 'category', data: ['Jan', 'Feb', 'Mar'] },
      yAxis: { type: 'value', axisLabel: { formatter: '{value} MWh' } }, series: [{ type: 'bar', data: [12000, 15000, 18000] }] })
    const chart = (left) => [{ id: 'c', type: 'chart', x: 100, y: 100, w: 500, h: 300, option: opt(left) }]
    return { tight: window.__run(chart(10)), roomy: window.__run(chart(90)), nodom: window.__run(chart(10), { measure: false }),
      nodomText: window.__run([{ id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 60, html: '<p>hello</p>', color: '#F2F0EA', fontSize: 20 }], { measure: false }) }
  })
  const cc = charts.tight.find((f) => f.code === 'chart-label-clipped')
  ok(cc?.severity === 'warning' && cc.element === 'c' && /Chart text "[\d,]+ MWh" runs \d+px past the chart's edge/.test(cc.message), `a y-axis label wider than its margin is chart-label-clipped (${cc?.message.slice(0, 70) ?? 'none'})`)
  ok(!charts.roomy.length, 'the same chart with room for its labels: none')
  ok(!charts.nodom.length, 'without a DOM (measure: false) the chart check is skipped')
  ok(charts.nodomText.some((f) => f.code === 'low-contrast' && /whole box/.test(f.message)), 'while low-contrast still runs, on the whole box')

  // ---- 5. real decks ------------------------------------------------------------------
  console.log('\nreal decks')
  const real = await p.evaluate(async ({ fixtures, VISUAL }) => {
    const starter = JSON.parse(window.__starter)
    const before = JSON.stringify(starter)
    const v = window.bento.validate(starter)
    const name = (f) => `${f.code}@${f.element}`
    const out = { starter: v.findings.filter((f) => VISUAL.includes(f.code)).map((f) => ({ code: f.code, severity: f.severity, el: f.element, msg: f.message })), same: JSON.stringify(starter) === before }
    const times = []
    for (let i = 0; i < 9; i++) { const t0 = performance.now(); window.bento.validate(starter); times.push(performance.now() - t0) }
    times.sort((a, b) => a - b)
    out.ms = times[4]
    out.fixtures = {}
    for (const [n, json] of Object.entries(fixtures)) {
      const rep = window.bento.loadDoc(json)
      await document.fonts.ready
      out.fixtures[n] = rep ? window.bento.validate().findings.filter((f) => VISUAL.includes(f.code) && f.severity !== 'info').map(name) : ['LOAD FAILED']
    }
    return out
  }, { fixtures, VISUAL })
  ok(!real.starter.some((f) => f.code === 'low-contrast' || f.code === 'text-overlap'),
    `the starter deck gains no low-contrast or text-overlap (${real.starter.filter((f) => f.code === 'low-contrast' || f.code === 'text-overlap').map((f) => f.code + '@' + f.el).join(', ') || 'none'})`)
  ok(!real.starter.some((f) => f.code === 'outside-frame' && f.severity === 'warning'), 'nor a frame child cut off by its frame')
  // the two the starter really cuts off (seen on screen: "agement" at the
  // scatter chart's top left, "Growth" losing its h at the panel's edge); any
  // other is a false finding — and a fixed starter simply drops one
  const clipped = real.starter.filter((f) => f.code === 'chart-label-clipped').map((f) => f.msg.match(/Chart text "([^"]+)"/)?.[1])
  ok(clipped.every((t) => t === 'Engagement' || t === 'Growth'), `its chart findings are the labels it really cuts off (${clipped.join(', ') || 'none'})`)
  for (const [n, f] of Object.entries(real.fixtures)) ok(!f.length, `agent fixture ${n}: no new visual warnings (${f.join(', ') || 'none'})`)
  ok(real.same, 'validate() leaves the starter document unchanged')
  console.log(`  ..    validate() on the starter: ${real.ms.toFixed(1)} ms (median of 9, measured)`)

  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
