// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// validate() reports the values the runtime swallows, in the packaged shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-validate-values-browser.mjs
//
// An element of an unknown type, a colour that is not a colour, a parentId
// that names nothing and geometry written as strings all used to validate
// clean. Colour syntax is decided by the browser's own parser, so this is the
// rig that sees the colour check for real (scripts/test-validate.ts covers the
// rest without a DOM).
//
// WHAT THIS PROVES:
//   1. the issue's four probes and the "fil" typo report unknown-type,
//      invalid-value (fill, x), dangling-parent and a did-you-mean, with the
//      paths and severities the issue asks for; a string x draws no
//      out-of-canvas, and a text box with a string h is not measured;
//   2. colours in every syntax the browser draws (hex, rgb/hsl/oklch/color(),
//      names, transparent, currentColor, a paint's url(#id) and none, gradient
//      stops, palette- and token-bound values) produce no finding, and words
//      that are not colours do, at their own paths;
//   3. the starter deck and every fixture deck under scripts/fixtures/ gain
//      none of the new codes, and validate() leaves the document unchanged;
//   4. what the unknown-type message says is what happens: a FILE opened with
//      such an element keeps it and draws nothing for it, and loadDoc() drops it.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const shellUrl = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url)
const fixtures = {}
for (const dir of ['agent-decks', 'compact-decks']) {
  const at = new URL(`fixtures/${dir}/`, import.meta.url)
  for (const f of readdirSync(at).filter((n) => n.endsWith('.json'))) fixtures[`${dir}/${f}`] = readFileSync(new URL(f, at), 'utf8')
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
const tmp = mkdtempSync(join(tmpdir(), 'bento-validate-values-'))
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(shellUrl.href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))

  // ---- 1. the probes -----------------------------------------------------------
  console.log('\nthe issue\'s probes')
  const probes = await p.evaluate(() => {
    const base = window.bento.read()
    const run = (els) => window.bento.validate({ ...base, slides: [{ id: 's1', elements: els }] })
      .findings.filter((f) => f.code !== 'collab-secrets-present')
    return {
      p1: run([{ id: 'a', type: 'shap', x: 10, y: 10, w: 100, h: 100 }]),
      p2: run([{ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: 'not-a-color' }]),
      p3: run([{ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: '#f00', parentId: 'nope' }]),
      p3ok: run([
        { id: 'f', type: 'shape', shape: 'rect', x: 10, y: 10, w: 300, h: 300, fill: '#eee', layout: { dir: 'col', gap: 8, pad: [8, 8, 8, 8] } },
        { id: 'a', type: 'shape', shape: 'rect', x: 18, y: 18, w: 100, h: 100, fill: '#f00', parentId: 'f' },
      ]),
      p4: run([{ id: 'a', type: 'shape', shape: 'rect', x: '10', y: 10, w: 100, h: 100 }]),
      typo: run([{ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: '#f00', fil: '#f00' }]),
      // a measured check skips a box whose geometry is a string: no overflow is
      // derived from h "40" (the same text in h 40 overflows)
      tallText: run([{ id: 't', type: 'text', x: 96, y: 96, w: 300, h: '40', html: 'one two three four five six seven eight nine ten', fontSize: 40 }]),
      tallTextNum: run([{ id: 't', type: 'text', x: 96, y: 96, w: 300, h: 40, html: 'one two three four five six seven eight nine ten', fontSize: 40 }]),
    }
  })
  const codes = (fs) => fs.map((f) => `${f.severity}:${f.code}@${f.path ?? ''}`)
  const t = probes.p1.find((f) => f.code === 'unknown-type')
  ok(t?.severity === 'error' && t.path === 'type' && probes.p1.length === 1, `probe 1: error:unknown-type at type, alone (${codes(probes.p1)})`)
  ok(!!t && ['text', 'shape', 'image', 'svg', 'chart', 'table', 'media', 'embed', 'code'].every((ty) => t.message.includes(ty)) && t.message.includes('did you mean "shape"'),
    'its message names the valid types and suggests "shape"')
  ok(probes.p2.some((f) => f.code === 'invalid-value' && f.path === 'fill'), `probe 2: invalid-value at fill (${codes(probes.p2)})`)
  ok(probes.p3.some((f) => f.severity === 'warning' && f.code === 'dangling-parent' && f.path === 'parentId'), `probe 3: warning:dangling-parent at parentId (${codes(probes.p3)})`)
  ok(!probes.p3ok.some((f) => f.code === 'dangling-parent'), 'a child of a real frame reports nothing')
  ok(probes.p4.some((f) => f.severity === 'error' && f.code === 'invalid-value' && f.path === 'x'), `probe 4: error:invalid-value at x (${codes(probes.p4)})`)
  ok(!probes.p4.some((f) => f.code === 'out-of-canvas'), 'and no out-of-canvas for that element')
  ok(probes.typo.some((f) => f.code === 'unknown-key' && f.path === 'fil' && f.message.includes('did you mean "fill"')), 'unknown-key "fil" says did you mean "fill"')
  ok(probes.tallTextNum.some((f) => f.code === 'text-overflow'), 'control: the same text in a numeric 40px box overflows')
  ok(!probes.tallText.some((f) => f.code === 'text-overflow') && probes.tallText.some((f) => f.code === 'invalid-value' && f.path === 'h'),
    'with h "40" it reports the value and measures nothing derived from it')

  // ---- 2. colours: the browser decides -----------------------------------------
  console.log('\ncolours')
  const colours = await p.evaluate(() => {
    const base = window.bento.read()
    const accepted = ['#f00', '#FF000080', '#abc', 'rgb(1 2 3 / 50%)', 'rgba(0,0,0,.5)', 'hsl(10 50% 50%)', 'hsla(10, 50%, 50%, 0.3)',
      'oklch(70% 0.1 200)', 'color(srgb 0.156863 0.188235 0.2 / 0.55)', 'transparent', 'currentColor', 'rebeccapurple', 'Red']
    const els = []
    accepted.forEach((c, i) => {
      els.push({ id: `s${i}`, type: 'shape', shape: 'rect', x: 96, y: 96, w: 10, h: 10, fill: c, stroke: c, shadow: { x: 0, y: 2, blur: 4, color: c },
        fillGradient: { angle: 90, stops: [{ at: 0, color: c }, { at: 1, color: '#fff' }] } })
      els.push({ id: `t${i}`, type: 'text', x: 96, y: 200, w: 600, h: 60, html: 'x', color: c, textStroke: { width: 1, color: c } })
    })
    els.push({ id: 'paint', type: 'shape', shape: 'rect', x: 96, y: 96, w: 10, h: 10, fill: 'url(#g)', stroke: 'none' })
    els.push({ id: 'pal', type: 'shape', shape: 'rect', x: 96, y: 96, w: 10, h: 10, fill: '#F7A600', themeRefs: { fill: 'accent1' } })
    els.push({ id: 'tok', type: 'shape', shape: 'rect', x: 96, y: 96, w: 10, h: 10, fill: '#123456', themeRefs: { fill: '$brand' } })
    els.push({ id: 'tbl', type: 'table', x: 96, y: 300, w: 400, h: 100, columns: [{ w: 1 }], header: true,
      rows: [{ cells: [{ html: 'a', color: '#111', bg: 'rgba(0,0,0,.1)' }] }],
      style: { headerBg: '#eee', headerColor: '#111', zebra: 'transparent', borderColor: 'hsl(0 0% 80%)', borderWidth: 1, cellPadX: 8, cellPadY: 4, fontSize: 16, color: '#222' } })
    const good = window.bento.validate({ ...base, slides: [{ id: 's1', elements: els }] }).findings.filter((f) => f.code === 'invalid-value')
    const bad = window.bento.validate({ ...base, slides: [{ id: 's1', elements: [
      { id: 'a', type: 'shape', shape: 'rect', x: 96, y: 96, w: 10, h: 10, fill: 'blu', stroke: '#ggg', shadow: { blur: 2, color: 'not-a-color' },
        fillGradient: { angle: 0, stops: [{ at: 0, color: 'rgb(1,2)' }, { at: 1, color: '#fff' }] } },
      { id: 'b', type: 'text', x: 96, y: 200, w: 600, h: 60, html: 'x', color: 'darkish' },
      { id: 'c', type: 'table', x: 96, y: 300, w: 400, h: 100, columns: [{ w: 1 }], header: false,
        rows: [{ cells: [{ html: 'a', bg: 'nope' }] }], style: { headerBg: 'greyish' } },
    ] }] }).findings.filter((f) => f.code === 'invalid-value')
    return { n: accepted.length, good: good.map((f) => `${f.element}.${f.path}: ${f.message}`), bad: bad.map((f) => `${f.severity}:${f.element}.${f.path}`).sort() }
  })
  ok(colours.good.length === 0, `${colours.n} colour syntaxes on fill, stroke, shadow, gradient stops, text, text stroke and a table, a paint's url(#id)/none, palette- and token-bound values: no finding${colours.good.length ? '\n          ' + colours.good.slice(0, 5).join('\n          ') : ''}`)
  const wantBad = ['warning:a.fill', 'warning:a.fillGradient.stops[0].color', 'warning:a.shadow.color', 'warning:a.stroke', 'warning:b.color',
    'warning:c.rows[0].cells[0].bg', 'warning:c.style.headerBg'].sort()
  ok(JSON.stringify(colours.bad) === JSON.stringify(wantBad), `words that are not colours are warnings at their own paths (${colours.bad.join(', ')})`)

  // ---- 3. real decks stay quiet, and nothing is mutated ------------------------
  console.log('\nreal decks')
  const NEW = ['invalid-value', 'unknown-type', 'dangling-parent']
  const real = await p.evaluate(({ fixtures, NEW }) => {
    const pick = (fs) => fs.filter((f) => NEW.includes(f.code)).map((f) => `${f.code}@${f.element}.${f.path}`)
    const out = {}
    const starter = window.bento.read()
    const before = JSON.stringify(starter)
    const v = window.bento.validate(starter)
    out.starter = { fresh: pick(v.findings), same: JSON.stringify(starter) === before, n: starter.slides.reduce((a, s) => a + s.elements.length, 0) }
    for (const [name, json] of Object.entries(fixtures)) {
      const raw = JSON.parse(json)
      const asWritten = raw.compact ? [] : pick(window.bento.validate(raw).findings)
      const rep = window.bento.loadDoc(json)
      out[name] = { fresh: [...asWritten, ...(rep ? pick(rep.findings.findings) : ['LOAD FAILED'])], same: true }
    }
    return out
  }, { fixtures, NEW })
  ok(real.starter.n > 300, `the starter deck has ${real.starter.n} elements to judge`)
  for (const [name, r] of Object.entries(real)) {
    ok(r.fresh.length === 0, `${name}: none of the new codes (${r.fresh.join(', ') || 'none'})`)
  }
  ok(real.starter.same, 'validate() left the starter document unchanged')
  const mutation = await p.evaluate(() => {
    const d = { ...window.bento.read(), slides: [{ id: 's1', elements: [
      { id: 'a', type: 'shape', shape: 'rect', x: '10', y: 10, w: 100, h: 100, fill: 'not-a-color', parentId: 'nope', fil: 1, shadow: { x: '3', blur: 2, color: 'blu' } },
      { id: 'u', type: 'shap', x: 1, y: 1, w: 1, h: 1 },
      { id: 't', type: 'text', x: 96, y: 96, w: 300, h: '40', html: 'long text that wraps', fontSize: 40 },
    ] }] }
    const before = JSON.stringify(d)
    const f = window.bento.validate(d).findings
    return { same: JSON.stringify(d) === before, keys: [...new Set(f.flatMap((x) => Object.keys(x)))].sort() }
  })
  ok(mutation.same, 'validate() leaves a broken document unchanged')
  ok(mutation.keys.every((k) => ['code', 'element', 'message', 'path', 'severity', 'slide'].includes(k)), `findings keep their shape (${mutation.keys.join(', ')})`)

  // ---- 4. what an unknown type does in a file -----------------------------------
  console.log('\nan opened file')
  const shell = readFileSync(shellUrl, 'utf8')
  const doc = JSON.parse(await p.evaluate(() => JSON.stringify(window.bento.read())))
  doc.slides = [{ id: 's1', background: '#ffffff', transition: 'fade', notes: '', elements: [
    { id: 'future', type: 'shap', x: 100, y: 100, w: 200, h: 200, fill: '#ff0000' },
    { id: 'known', type: 'shape', shape: 'rect', x: 400, y: 100, w: 200, h: 200, fill: '#00ff00' },
  ] }]
  const block = /(<script type="application\/bento\+json" id="bento-doc">)[\s\S]*?(<\/script>)/
  ok(block.test(shell), 'the shell carries its #bento-doc block')
  const file = join(tmp, 'unknown-type.bento.html')
  writeFileSync(file, shell.replace(block, (_, a, b) => a + JSON.stringify(doc).replace(/</g, '\\u003c') + b))
  const q = await ctx.newPage()
  q.on('pageerror', (e) => errors.push(e.message))
  await q.goto(pathToFileURL(file).href)
  await q.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id="known"]'))
  const opened = await q.evaluate(() => {
    const node = document.querySelector('.ed-stage-scale [data-el-id="future"]')
    const v = window.bento.validate()
    return {
      kept: window.bento.doc.slides[0].elements.some((e) => e.id === 'future' && e.type === 'shap'),
      drawn: node ? node.innerHTML.length : -1,
      finding: v.findings.find((f) => f.element === 'future')?.code,
    }
  })
  ok(opened.kept, 'a file keeps the element of an unknown type')
  ok(opened.drawn === 0, `and draws nothing for it (its node has ${opened.drawn} characters of content)`)
  ok(opened.finding === 'unknown-type', 'validate() on the opened file reports it')
  const loaded = await q.evaluate((json) => {
    const r = window.bento.loadDoc(json)
    return { dropped: r && r.dropped.some((d) => /unknown element type "shap"/.test(d.reason)), kept: window.bento.doc.slides[0].elements.some((e) => e.id === 'future') }
  }, JSON.stringify(doc))
  ok(loaded.dropped && !loaded.kept, 'loadDoc() drops it, as the message says')

  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
