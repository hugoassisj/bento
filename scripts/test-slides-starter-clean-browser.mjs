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
//      real glyphs, and nothing is cleared on a guess.
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

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
