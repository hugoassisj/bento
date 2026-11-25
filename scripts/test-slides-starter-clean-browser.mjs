// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The starter deck checks clean, measured, in the packaged shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-starter-clean-browser.mjs
//
// The starter is the deck every person and every agent starts from, and the
// guide tells an agent to "validate and fix" its work. It used to report six
// warnings on a deck nobody had touched: three text overflows from the page
// field measured as its token (F-07) and then as a box 35px short of its line,
// and three out-of-canvas warnings on the decorative ghost numeral, whose box
// started above the slide while every glyph of it sits inside. An agent either
// "fixed" the numeral or learned to ignore warnings.
//
// WHAT THIS PROVES:
//   1. with fonts loaded and measuring on, the starter reports zero errors and
//      zero warnings;
//   2. a text box that overhangs the canvas with all its glyphs inside is
//      reported at info, as a deliberate bleed — on the left edge and on the
//      top edge;
//   3. a text box whose glyphs ARE cropped by the canvas edge still warns —
//      on the right edge and on the top edge;
//   4. a rotated text box that overhangs keeps the warning (its glyphs are
//      not measured, so it is not cleared);
//   5. without measuring, an overhanging text box still warns: the rule needs
//      real glyphs, and nothing is cleared on a guess;
//   6. a shadow or a blur paints too: glyphs inside but a shadow (or a stack
//      of them, each shadowing the last) or blur reaching past the edge still
//      warns, while a shadow switched off, or one that stays inside, does not;
//   7. against the rendered pixels (the oracle is a screenshot, not the
//      measuring code): for Latin, italics, flags, a ZWJ emoji, Thai stacked
//      marks, combining accents, Arabic, an underline, a strike, a link, an
//      inline code chip and two mitred outlines, paint 4px past any of the
//      four edges always warns, and the Latin rows are info once their paint
//      is clearly inside (12px; 40-80px for decorations and outlines, which
//      are bounded rather than traced).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  // device scale 2: the pixel-truth rows read ink edges to about half a slide px
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)

  // ---- 1. the starter checks clean ------------------------------------------
  console.log('\nstarter deck')
  const starter = await p.evaluate(() => {
    const v = window.bento.validate()
    return {
      measured: v.measured, counts: v.counts,
      loud: v.findings.filter((f) => f.severity !== 'info').map((f) => `${f.severity} ${f.code} [${f.element ?? f.path ?? ''}] ${f.message}`),
      fonts: document.fonts.status,
    }
  })
  ok(starter.measured === true && starter.fonts === 'loaded', `precondition: measured with fonts loaded (measured ${starter.measured}, fonts ${starter.fonts})`)
  ok(starter.counts.error === 0, `zero errors (${starter.counts.error})`)
  ok(starter.counts.warning === 0, `zero warnings (${starter.counts.warning})${starter.loud.length ? '\n          ' + starter.loud.join('\n          ') : ''}`)

  // ---- 2-5. overhanging text: glyphs inside vs cropped ---------------------
  console.log('\noverhanging text boxes')
  const cases = await p.evaluate(() => {
    const base = window.bento.read()
    const t = (p) => ({ id: 'a', type: 'text', rotation: 0, opacity: 1, fontWeight: 400, lineHeight: 1.25, align: 'left', valign: 'top', ...p })
    const run = (el, opts) => {
      const v = window.bento.validate({ ...base, slides: [{ id: 's1', elements: [el] }] }, opts)
      return v.findings.filter((f) => f.code === 'out-of-canvas').map((f) => ({ severity: f.severity, message: f.message }))
    }
    // short words centred in a box far wider than they are: the box leaves the
    // canvas by 60px, the glyphs sit some 200px inside it
    const left = t({ x: -60, y: 300, w: 600, h: 120, html: 'Hello', fontSize: 60, align: 'center', valign: 'middle' })
    // the ghost numeral's shape: a big numeral in a box that starts above the
    // slide, set at the bottom of it so the glyphs land well inside
    const top = t({ x: 700, y: -80, w: 400, h: 360, html: '07', fontSize: 200, align: 'right', valign: 'bottom' })
    // words that run on past the right edge
    const right = t({ x: 1000, y: 300, w: 600, h: 120, html: 'Cropped words here', fontSize: 60 })
    // capitals whose tops are cut off by the top edge
    const cut = t({ x: 200, y: -100, w: 700, h: 200, html: 'TOP', fontSize: 160, lineHeight: 1 })
    return {
      left: run(left), top: run(top), right: run(right), cut: run(cut),
      rotated: run({ ...left, rotation: 8 }),
      unmeasured: run(left, { measure: false }),
      // the glyphs sit ~200px inside the left edge; these shadows do not
      shadowOut: run({ ...left, shadow: { x: -300, y: 0, blur: 4, color: 'rgba(0,0,0,0.5)' } }),
      shadowStack: run({ ...left, shadow: [{ x: -120, y: 0, blur: 0, color: '#000' }, { x: -120, y: 0, blur: 0, color: '#000' }] }),
      blurOut: run({ ...left, blur: 90 }),
      shadowHiddenOut: run({ ...left, shadow: { x: -300, y: 0, blur: 4, color: '#000' }, shadowHidden: true }),
      shadowSmall: run({ ...left, shadow: { x: 4, y: 4, blur: 8, color: 'rgba(0,0,0,0.3)' } }),
    }
  })
  const one = (fs) => fs.length === 1 ? fs[0] : null
  const show = (fs) => fs.map((f) => `${f.severity}: ${f.message}`).join(' | ') || 'none'
  for (const [name, edge] of [['left', 'left'], ['top', 'top']]) {
    const f = one(cases[name])
    ok(f && f.severity === 'info' && /deliberate bleed/.test(f.message),
      `a box past the ${edge} edge with every glyph inside is info, a deliberate bleed (${show(cases[name])})`)
  }
  for (const [name, edge] of [['right', 'right'], ['cut', 'top']]) {
    const f = one(cases[name])
    ok(f && f.severity === 'warning' && /cropped when presenting/.test(f.message),
      `a box whose glyphs are cropped by the ${edge} edge still warns (${show(cases[name])})`)
  }
  ok(one(cases.rotated)?.severity === 'warning', `a rotated overhanging box keeps the warning (${show(cases.rotated)})`)
  ok(one(cases.unmeasured)?.severity === 'warning', `without measuring, an overhanging box still warns (${show(cases.unmeasured)})`)
  // a shadow or a blur paints too: one that reaches past the edge is cropped
  ok(one(cases.shadowOut)?.severity === 'warning', `glyphs inside, a shadow thrown 300px past the left edge: warns (${show(cases.shadowOut)})`)
  ok(one(cases.shadowStack)?.severity === 'warning', `two stacked shadows (each shadows the last) reaching 240px past the edge: warns (${show(cases.shadowStack)})`)
  ok(one(cases.blurOut)?.severity === 'warning', `glyphs inside, a 90px blur spreading past the edge: warns (${show(cases.blurOut)})`)
  ok(one(cases.shadowHiddenOut)?.severity === 'info', `the same shadow switched off with the eye is not drawn, so: info (${show(cases.shadowHiddenOut)})`)
  ok(one(cases.shadowSmall)?.severity === 'info', `a small soft shadow that stays inside does not keep the warning: info (${show(cases.shadowSmall)})`)

  // ---- 6. pixel truth: never info while ink is cut ---------------------------
  // The truth is the rendered pixels, not the measuring code. Each string is
  // drawn alone in black on a white slide in the editor and its ink box read
  // from a screenshot (any pixel off white). Then, for each edge, the box is
  // placed so that ink crosses that edge by 4px — validate() must warn — and
  // so that ink stops 12px short of it while the box still overhangs, where a
  // plain Latin line must be info (complex scripts may stay a warning: not
  // being measured is allowed, a false "inside" is not).
  console.log('\npixel truth')
  const strings = [
    ['latin', 'Hello World', true],
    ['italic', '<i>fjord Wave</i>', true],
    ['flags', '\u{1F1EF}\u{1F1F5}\u{1F1E7}\u{1F1F7}', false],
    ['zwj family', '\u{1F469}\u200D\u{1F469}\u200D\u{1F467}', false],
    ['thai stacked', '\u0E1B\u0E31\u0E49\u0E48', false],
    ['combining', 'e\u0301A\u030Ag\u0327', false],
    ['arabic', '\u0633\u0644\u0627\u0645 \u0639\u0644\u064A\u0643\u0645', false],
    // paint that is not a glyph but is still drawn: an underline below
    // capitals with no descender, a strike across the side bearings, a
    // link's underline, an inline code chip's background and padding, and
    // thick outlines whose mitred corners spike past the glyph (a sharp apex
    // reaches 1.3x the stroke width). Decorations and outlines are bounded,
    // not traced, so "inside" is asked of them further from the edge: the
    // fifth column (default 12px).
    ['underline', '<u>HELLO</u>', true, {}, 40],
    ['strike', '<s>TOTAL</s>', true],
    ['link', '<a href="https://example.com/">LINK</a>', true, {}, 40],
    ['code chip', '<code>npm i</code>', true],
    ['mitred outline', 'WAVE', true, { textStroke: { width: 14, color: '#000000' }, fontWeight: 700 }, 40],
    ['sharp mitre', '\u039B', true, { textStroke: { width: 30, color: '#000000' }, fontWeight: 100 }, 80],
  ]
  const FS = 140
  const box = (html, edge, extra = {}) => ({
    id: 'a', type: 'text', rotation: 0, opacity: 1, fontWeight: 400, lineHeight: 1.25, html, fontSize: FS, color: '#000000',
    w: 1100, h: 560,
    // the box reaches far past the ink on the side under test
    align: edge === 'left' ? 'right' : edge === 'right' ? 'left' : 'center',
    valign: edge === 'top' ? 'bottom' : edge === 'bottom' ? 'top' : 'middle',
    ...extra,
  })
  const HOME = { x: 90, y: 80 } // where the whole box fits on the slide
  const truth = async (el) => {
    await p.evaluate((el) => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.slides = [{ id: 's1', background: '#ffffff', elements: [el] }]
      window.bento.loadDoc(JSON.stringify(d))
    }, { ...el, ...HOME })
    await p.keyboard.press('Escape')
    await p.mouse.move(2, 2)
    await p.waitForTimeout(250)
    const png = (await p.locator('.ed-stage-scale').first().screenshot()).toString('base64')
    const px = await p.evaluate(async (b64) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode()
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
      // the stage's own hairline border sits on the outermost pixels; the box
      // at HOME keeps every glyph far from them
      for (let y = 6; y < c.height - 6; y++) for (let x = 6; x < c.width - 6; x++) {
        const i = (y * c.width + x) * 4
        if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y }
      }
      return { l, t, r: r + 1, b: b + 1, w: c.width }
    }, png)
    if (!Number.isFinite(px.l)) return null
    const k = px.w / 1280
    // ink relative to the box's own origin, in slide px
    return { left: px.l / k - HOME.x, top: px.t / k - HOME.y, right: px.r / k - HOME.x, bottom: px.b / k - HOME.y }
  }
  // where to put the box so the ink edge lands `by` px past that canvas edge
  // (negative: short of it)
  const placeAt = (ink, edge, by) => edge === 'left' ? { x: -by - ink.left, y: HOME.y }
    : edge === 'right' ? { x: 1280 + by - ink.right, y: HOME.y }
    : edge === 'top' ? { x: HOME.x, y: -by - ink.top }
    : { x: HOME.x, y: 720 + by - ink.bottom }
  const severity = (el) => p.evaluate((el) => {
    const v = window.bento.validate({ ...window.bento.read(), slides: [{ id: 's1', elements: [el] }] })
    return v.findings.filter((f) => f.code === 'out-of-canvas').map((f) => f.severity).join(',') || 'none'
  }, el)
  for (const [name, html, plain, extra, insideBy = 12] of strings) {
    const row = []
    let bad = []
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      const el = box(html, edge, extra)
      const ink = await truth(el)
      if (!ink) { bad.push(`${edge}: nothing drawn`); continue }
      const cut = await severity({ ...el, ...placeAt(ink, edge, 4) })
      const inside = await severity({ ...el, ...placeAt(ink, edge, -insideBy) })
      row.push(`${edge} cut:${cut} inside:${inside}`)
      if (cut !== 'warning') bad.push(`${edge}: ink 4px past the edge reads ${cut}`)
      if (plain && inside !== 'info') bad.push(`${edge}: ink ${insideBy}px inside reads ${inside}`)
      if (!['info', 'warning'].includes(inside)) bad.push(`${edge}: the box no longer overhangs (${inside})`)
    }
    ok(!bad.length, `${name}: cut ink warns at every edge${plain ? `, ink ${insideBy}px inside is info` : ''} (${bad.length ? bad.join('; ') : row.join(' | ')})`)
  }

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
