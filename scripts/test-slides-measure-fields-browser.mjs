// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Field tokens are measured as the value they render, in the packaged shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-measure-fields-browser.mjs
//
// A text element holding a field such as {{page:2}} renders as "02", but
// window.bento.measure() and the validator's text-overflow check used to lay
// out the ten characters of the token instead: on the starter deck the ghost
// page numeral measured 1500px (four lines) where the slide shows one line.
//
// THE ORACLE is the renderer itself: the filmstrip thumbnails render every
// slide with its field values resolved, so the value an element shows is read
// from its thumbnail, not recomputed here. Each field element is then measured
// twice through the public API, once by id and once as a spec with that value
// typed in literally, and the two must agree.
//
// WHAT THIS PROVES:
//   1. every field element on the starter measures exactly as its rendered
//      value typed literally (height and line count);
//   2. the starter's text-overflow findings are the ones it would have with
//      every field typed in as its value: no finding comes from a token;
//   3. validate() and measure() agree for every text element on the starter;
//   4. the issue's minimal case ({{page:2}} at 300px in a 420-wide box) is
//      measured as "01"; a box tall enough for "01" draws no text-overflow,
//      and a genuinely overflowing string in the same box still does;
//   5. {{pages}}, {{title}}, {{date}} and {{author}} are each measured at their
//      rendered value — and each case is one where the token typed as text
//      would measure differently, so the check can fail;
//   6. a bare spec (no element) measures a field against the current slide;
//   7. a raw doc passed to validate() or measure() with no title, or with a
//      non-string author, measures instead of throwing.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  // a pinned locale and clock make {{date}} a known string ("11/23/2026"), so
  // its box can be sized where the value and the token wrap differently
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', timezoneId: 'UTC' })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  await p.clock.setFixedTime(new Date('2026-11-23T12:00:00Z'))
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)

  // In-page helpers: the measurement spec of an element, and the value its
  // field renders as, read from the thumbnail the renderer drew for it.
  await p.evaluate(() => {
    window.__spec = (el, html) => ({
      html: html ?? el.html, w: el.w, h: el.h, fontSize: el.fontSize, fontFamily: el.fontFamily,
      fontWeight: el.fontWeight, lineHeight: el.lineHeight, letterSpacing: el.letterSpacing,
    })
    window.__rendered = (id) => {
      const inner = document.querySelector(`.ed-filmstrip [data-el-id="${id}"] .bento-text-inner, .bento-slide [data-el-id="${id}"] .bento-text-inner`)
      return inner ? inner.innerHTML : null
    }
    window.__fieldEls = () => {
      const out = []
      for (const s of window.bento.doc.slides) {
        for (const el of s.elements) if (el.type === 'text' && el.html.includes('{{')) out.push({ slide: s.id, el })
      }
      return out
    }
  })

  // ---- 1. starter field elements measure as their rendered value -------------
  console.log('\nstarter deck')
  const starter = await p.evaluate(() => window.__fieldEls().map(({ slide, el }) => {
    const value = window.__rendered(el.id)
    return {
      slide, id: el.id, html: el.html, value,
      byId: window.bento.measure(el.id),
      literal: value == null ? null : window.bento.measure(window.__spec(el, value)),
    }
  }))
  ok(starter.length >= 3, `the starter has field elements to measure (${starter.length})`)
  ok(starter.every((s) => s.value && !s.value.includes('{{')), 'every one has a resolved value in its thumbnail (the oracle is real)')
  const mismatched = starter.filter((s) => !s.literal || Math.abs(s.byId.height - s.literal.height) > 1 || s.byId.lines !== s.literal.lines)
  ok(!mismatched.length, `each measures as its rendered value typed literally${mismatched.length
    ? ': ' + mismatched.slice(0, 3).map((s) => `${s.html} → "${s.value}" measured ${s.byId.height}px/${s.byId.lines} lines, literal ${s.literal?.height}px/${s.literal?.lines}`).join('; ')
    : ` (${starter.map((s) => `"${s.value}" ${s.byId.height}px`).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`}`)

  // ---- 2. no starter text-overflow finding comes from a token ----------------
  const overflow = await p.evaluate(() => {
    const doc = window.bento.read()
    const msgs = (v) => v.findings.filter((f) => f.code === 'text-overflow').map((f) => `${f.element}: ${f.message}`).sort()
    const asIs = msgs(window.bento.validate(doc))
    const literal = JSON.parse(JSON.stringify(doc))
    for (const s of literal.slides) {
      for (const el of s.elements) if (el.type === 'text' && el.html.includes('{{')) el.html = window.__rendered(el.id) ?? el.html
    }
    return { asIs, literal: msgs(window.bento.validate(literal)) }
  })
  ok(JSON.stringify(overflow.asIs) === JSON.stringify(overflow.literal),
    `text-overflow findings are the same as with every field typed as its value (${overflow.asIs.length} vs ${overflow.literal.length})${
      JSON.stringify(overflow.asIs) === JSON.stringify(overflow.literal) ? '' : `\n          as is:   ${overflow.asIs.join('\n                   ')}\n          literal: ${overflow.literal.join('\n                   ')}`}`)
  ok(!overflow.asIs.some((m) => /needs 1500px/.test(m)), 'no finding reports the 1500px height of the token text')

  // ---- 3. validate() and measure() agree on every starter text element -------
  const agree = await p.evaluate(() => {
    const v = window.bento.validate()
    const found = new Map(v.findings.filter((f) => f.code === 'text-overflow').map((f) => [f.element, f.message]))
    const bad = []
    let n = 0
    for (const s of window.bento.doc.slides) {
      for (const el of s.elements) {
        if (el.type !== 'text' || !el.html.trim()) continue
        n++
        const m = window.bento.measure(el.id)
        const flagged = found.has(el.id)
        const over = m.overflow > 1
        const sameHeight = !flagged || found.get(el.id).includes(`needs ${m.height}px`)
        if (flagged !== over || !sameHeight) bad.push(`${el.id} ${el.html.slice(0, 20)}: measure ${m.height}px/${m.overflow}, finding ${found.get(el.id) ?? 'none'}`)
      }
    }
    return { n, bad }
  })
  ok(agree.n > 20 && !agree.bad.length, `validate() and measure() agree on all ${agree.n} text elements${agree.bad.length ? ': ' + agree.bad.slice(0, 3).join('; ') : ''}`)

  // ---- 4. the minimal case ----------------------------------------------------
  console.log('\nminimal case')
  const minimal = await p.evaluate(() => {
    const base = window.bento.read()
    const el = (html, h) => ({ id: 'a', type: 'text', x: 10, y: 10, w: 420, h, html, fontSize: 300, lineHeight: 1.25 })
    const findings = (html, h) => window.bento.validate({ ...base, slides: [{ id: 's1', elements: [el(html, h)] }] })
      .findings.filter((f) => f.code === 'text-overflow').map((f) => f.message)
    const lit = window.bento.measure({ html: '01', w: 420, fontSize: 300, lineHeight: 1.25 })
    return {
      lit,
      field340: findings('{{page:2}}', 340), literal340: findings('01', 340),
      fieldFits: findings('{{page:2}}', lit.height),
      genuine: findings('Far too many words for this box', lit.height),
    }
  })
  ok(JSON.stringify(minimal.field340) === JSON.stringify(minimal.literal340),
    `{{page:2}} in the 420×340 box gets the finding "01" gets (${minimal.field340[0] ?? 'none'} | ${minimal.literal340[0] ?? 'none'})`)
  ok(minimal.fieldFits.length === 0, `{{page:2}} in a box as tall as "01" needs (${minimal.lit.height}px) reports no text-overflow${minimal.fieldFits.length ? ': ' + minimal.fieldFits[0] : ''}`)
  ok(minimal.genuine.length === 1, `a genuinely overflowing string in that box still reports text-overflow (${minimal.genuine[0] ?? 'none'})`)

  // ---- 5. {{pages}}, {{title}}, {{date}}, {{author}} --------------------------
  console.log('\nother fields')
  const loaded = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.title = 'Quarterly review of the northern region and its partners'
    d.meta = { ...(d.meta ?? {}), author: 'Maria Fernanda dos Santos Oliveira de Albuquerque' }
    const t = (id, html, w, fontSize) => ({ id, type: 'text', x: 40, y: 40, w, h: 60, html, fontSize, lineHeight: 1.2, rotation: 0, opacity: 1 })
    d.slides = [
      { id: 's1', elements: [] },
      { id: 's2', elements: [
        t('f-pages', '{{pages}} {{pages}} {{pages}} {{pages}}', 300, 40),
        t('f-title', '{{title}}', 300, 40),
        t('f-date', 'On {{date}}', 240, 40),
        t('f-author', 'by {{author}}', 300, 40),
      ] },
      { id: 's3', elements: [] },
    ]
    return window.bento.loadDoc(JSON.stringify(d)) !== false
  })
  ok(loaded, 'precondition: a three-slide deck with a title and an author loads')
  await p.waitForTimeout(400)
  const fields = await p.evaluate(() => window.__fieldEls().map(({ el }) => {
    const value = window.__rendered(el.id)
    return {
      id: el.id, html: el.html, value,
      byId: window.bento.measure(el.id),
      literal: value == null ? null : window.bento.measure(window.__spec(el, value)),
      // the token laid out as plain text: &#123; renders "{" without being a field
      asText: window.bento.measure(window.__spec(el, el.html.replace(/\{\{/g, '&#123;&#123;'))),
    }
  }))
  for (const name of ['pages', 'title', 'date', 'author']) {
    const f = fields.find((x) => x.id === `f-${name}`)
    ok(f && f.value && !f.value.includes('{{'), `{{${name}}} renders as "${f?.value}"`)
    if (!f?.literal) continue
    ok(f.literal.height !== f.asText.height, `{{${name}}}: the token typed as text would measure differently (${f.asText.height}px vs ${f.literal.height}px), so this case can fail`)
    ok(Math.abs(f.byId.height - f.literal.height) <= 1 && f.byId.lines === f.literal.lines,
      `{{${name}}} measures as its rendered value (${f.byId.height}px/${f.byId.lines} lines, literal ${f.literal.height}px/${f.literal.lines})`)
  }

  // ---- 6. a bare spec measures against the current slide ---------------------
  const spec = await p.evaluate(() => ({
    field: window.bento.measure({ html: '{{page:3}} {{page:3}} {{page:3}}', w: 200, fontSize: 40 }),
    literal: window.bento.measure({ html: '001 001 001', w: 200, fontSize: 40 }),
  }))
  ok(spec.field.height === spec.literal.height, `a bare spec measures {{page:3}} as "001" on the current (first) slide (${spec.field.height}px vs ${spec.literal.height}px)`)

  // ---- 7. a raw doc with no title, or a non-string author, still checks ----
  // validate(doc) and measure(spec, {doc}) take documents that never went
  // through the loader; a missing or odd property must measure as text, not throw
  console.log('\nraw documents')
  const raw = await p.evaluate(() => {
    const base = window.bento.read()
    const d = { ...base, meta: { ...(base.meta ?? {}), author: 42 }, slides: [{ id: 's1', elements: [
      { id: 'a', type: 'text', x: 10, y: 10, w: 300, h: 60, html: 'Deck: {{title}}', fontSize: 40 },
      { id: 'b', type: 'text', x: 10, y: 100, w: 300, h: 60, html: 'By {{author}}', fontSize: 40 },
    ] }] }
    delete d.title
    const run = (fn) => { try { return { value: fn() } } catch (e) { return { error: String(e) } } }
    return {
      validate: run(() => window.bento.validate(d).measured),
      title: run(() => window.bento.measure({ html: 'Deck: {{title}}', w: 300, fontSize: 40 }, { doc: d }).height),
      author: run(() => window.bento.measure({ html: 'By {{author}}', w: 300, fontSize: 40 }, { doc: d }).height),
      authorLit: window.bento.measure({ html: 'By 42', w: 300, fontSize: 40 }, { doc: d }).height,
    }
  })
  ok(raw.validate.value === true, `validate() on a doc with no title and a numeric author measures instead of throwing (${raw.validate.error ?? 'measured'})`)
  ok(typeof raw.title.value === 'number', `measure() of {{title}} against a doc with no title returns a height (${raw.title.error ?? raw.title.value + 'px'})`)
  ok(raw.author.value === raw.authorLit, `measure() of {{author}} with a numeric author measures it as "42" (${raw.author.error ?? raw.author.value + 'px'} vs ${raw.authorLit}px)`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
