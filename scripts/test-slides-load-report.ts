// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The load report's findings describe the document as it will be drawn.
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-load-report.ts --bundle --platform=node --format=esm --outfile=/tmp/test-slides-load-report.mjs
//   node /tmp/test-slides-load-report.mjs        (from the repo root)
//
// window.bento.loadDoc and "Replace from JSON…" return a report whose
// `findings` are validate()'s. They used to be computed on the gated document
// BEFORE the derive pass (derive.ts: frame layout, tokens, components), which
// the editor only ran later, on the store's `replace` event. A frame whose
// children were written at placeholder coordinates was reported where the
// children were written, not where layout put them: clean while the laid-out
// slide ran off the canvas, or full of warnings for boxes about to move into
// place. Here, for every agent fixture and for frame decks written both ways
// (full and compact), the report must equal validateDoc on a separately
// derived copy, nothing must be left for the editor's pass to derive, and the
// report says `derived: true`. Token behaviour on load is unchanged: the
// document equals the old gate's output put through the editor's pass, and a
// binding the editor drops today is still dropped.
//
// Node has no DOM, so the measured checks (text-overflow, table-overflow) are
// skipped on both sides; the browser shows the same for the rest.
import fs from 'node:fs'
import path from 'node:path'
import { parseDocInputReport } from '../slides/src/compactload.ts'
import { parseDoc, type BentoDoc } from '../slides/src/model.ts'
import { sanitizeDoc } from '../slides/src/restoregate.ts'
import { derive, deriveMemory } from '../slides/src/derive.ts'
import { validateDoc, type ValidateResult } from '../slides/src/validate.ts'
import { starterDoc } from '../slides/src/starterdeck.ts'

let checks = 0
let failures = 0
const ok = (cond: boolean, msg: string) => { checks++; if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`) }

const fixtures = path.resolve('scripts/fixtures/agent-decks')
if (!fs.existsSync(fixtures)) throw new Error('run from the repo root — scripts/fixtures/agent-decks not found')

const counts = (r: ValidateResult) => `${r.counts.error}e/${r.counts.warning}w/${r.counts.info}i`
const codes = (r: ValidateResult) => r.findings.map((f) => `${f.code}@${f.element ?? f.slide ?? ''}`).sort().join(',')

/** The check every input goes through: report vs a separately derived copy. */
function check(name: string, json: string, expect?: (report: ValidateResult) => void) {
  const parsed = parseDocInputReport(json)
  if (!parsed) { ok(false, `${name}: loads`); return }
  const { doc, report } = parsed
  const copy = structuredClone(doc) as BentoDoc
  derive(copy, deriveMemory(copy))
  const truth = validateDoc(copy, { measure: false })
  ok(JSON.stringify(report.findings) === JSON.stringify(truth),
    `${name}: report findings equal validate() after layout (report ${counts(report.findings)} [${codes(report.findings)}], after layout ${counts(truth)} [${codes(truth)}])`)
  // what the editor runs on `replace` (editor.ts): a fresh memory, one pass
  ok(derive(structuredClone(doc) as BentoDoc, deriveMemory(doc)) === false, `${name}: the editor's derive on replace has nothing left to do`)
  ok((report as { derived?: unknown }).derived === true, `${name}: the report says derived: true`)
  expect?.(truth)
}

console.log('\nevery agent fixture\n')
for (const f of fs.readdirSync(fixtures).filter((n) => n.endsWith('.json')).sort()) {
  check(f, fs.readFileSync(path.join(fixtures, f), 'utf8'))
}

// A frame lays out its children: what an agent writes for them is a
// placeholder. Two decks, each in full and in compact form.
const W = 1280
const frameDeck = (compact: boolean, frame: Record<string, unknown>, kids: Array<Record<string, unknown>>) => {
  const text = (k: Record<string, unknown>) => compact
    ? { type: 'text', ...k }
    : { type: 'text', rotation: 0, opacity: 1, fontFamily: 'Inter, sans-serif', fontSize: 28, fontWeight: 400, color: '#111111', align: 'left', ...k }
  const shape = compact
    ? { type: 'shape', shape: 'rect', ...frame }
    : { type: 'shape', shape: 'rect', rotation: 0, opacity: 1, fill: '#eeeeee', stroke: '#000000', strokeWidth: 0, radius: 0, ...frame }
  const elements = [shape, ...kids.map(text)]
  return JSON.stringify(compact
    ? { compact: true, title: 'Frame', slides: [{ id: 's1', elements }] }
    : {
        format: 'bento/slides', version: 1, title: 'Frame', size: { width: W, height: 720 },
        theme: { background: '#ffffff', color: '#111111', accent: '#f7a600', fontFamily: 'Inter, sans-serif' },
        slides: [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements }],
      })
}
// 1. placeholders on the canvas at 0,0; the laid-out row runs past the right edge
const offFrame = { id: 'row', x: 240, y: 200, w: 1000, h: 200, layout: { dir: 'row', gap: 24, pad: [24, 24, 24, 24] } }
const offKids = ['One', 'Two', 'Three'].map((html, i) => ({ id: `k${i}`, parentId: 'row', x: 0, y: 0, w: 420, h: 120, html }))
// 2. placeholders off the canvas; the laid-out column sits inside it
const inFrame = { id: 'col', x: 96, y: 160, w: 1088, h: 440, layout: { dir: 'col', gap: 24, pad: [24, 24, 24, 24] } }
const inKids = ['One', 'Two', 'Three'].map((html, i) => ({ id: `k${i}`, parentId: 'col', x: 1400, y: 900, w: 600, h: 100, html }))

const outOfCanvas = (r: ValidateResult) => r.findings.filter((f) => f.code === 'out-of-canvas').length
for (const compact of [false, true]) {
  const form = compact ? 'compact' : 'full'
  console.log(`\nframe decks, ${form}\n`)
  check(`${form}: placeholders inside, laid out past the edge`, frameDeck(compact, offFrame, offKids), (truth) =>
    ok(outOfCanvas(truth) > 0, `${form}: the laid-out row really does leave the canvas (${outOfCanvas(truth)} out-of-canvas)`))
  check(`${form}: placeholders outside, laid out inside`, frameDeck(compact, inFrame, inKids), (truth) =>
    ok(outOfCanvas(truth) === 0, `${form}: the laid-out column really is on the canvas (${outOfCanvas(truth)} out-of-canvas)`))
}

console.log('\ntokens on load are unchanged\n')
{
  // a binding whose literal agrees with its token is kept; one that disagrees
  // (a hand edit in an older shell) is dropped and the literal kept — the
  // editor's pass on `replace` decides that today, and still does
  const json = JSON.stringify({
    format: 'bento/slides', version: 1, title: 'Tokens', size: { width: W, height: 720 },
    theme: {
      background: '#ffffff', color: '#111111', accent: '#f7a600', fontFamily: 'Inter, sans-serif',
      tokens: { set: { brand: { type: 'color', values: { default: '#3355ff' } }, g: { type: 'number', values: { default: 16 } } } },
    },
    slides: [{
      id: 's1', background: '#ffffff', transition: 'none', notes: '', elements: [
        { id: 'kept', type: 'shape', shape: 'rect', x: 100, y: 100, w: 200, h: 100, rotation: 0, opacity: 1, fill: '#3355ff', stroke: '#000000', strokeWidth: 0, radius: 0, themeRefs: { fill: '$brand' } },
        { id: 'edited', type: 'shape', shape: 'rect', x: 400, y: 100, w: 200, h: 100, rotation: 0, opacity: 1, fill: '#ff0000', stroke: '#000000', strokeWidth: 0, radius: 0, themeRefs: { fill: '$brand' } },
        { id: 'f', type: 'shape', shape: 'rect', x: 100, y: 300, w: 600, h: 140, rotation: 0, opacity: 1, fill: '#eeeeee', stroke: '#000000', strokeWidth: 0, radius: 0, layout: { dir: 'row', gap: 16, pad: [20, 20, 20, 20] }, themeRefs: { 'layout.gap': '$g' } },
        { id: 'a', type: 'shape', shape: 'rect', parentId: 'f', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#cccccc', stroke: '#000000', strokeWidth: 0, radius: 0 },
        { id: 'b', type: 'shape', shape: 'rect', parentId: 'f', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#cccccc', stroke: '#000000', strokeWidth: 0, radius: 0 },
      ],
    }],
  })
  check('token deck', json)
  const parsed = parseDocInputReport(json)!
  // the old path: the gate's output, then the editor's pass on `replace`
  const old = sanitizeDoc(parseDoc(json) as unknown as Record<string, unknown>)!.doc
  derive(old, deriveMemory(old))
  old.docId = parsed.doc.docId // minted afresh by each parse
  ok(JSON.stringify(parsed.doc) === JSON.stringify(old), 'the loaded document equals the old gate output after the editor\'s pass')
  const el = (id: string) => parsed.doc.slides[0].elements.find((e) => e.id === id) as unknown as { fill: string; themeRefs?: Record<string, string>; x: number }
  ok(el('kept').themeRefs?.fill === '$brand' && el('kept').fill === '#3355ff', 'a binding that agrees with its token is kept')
  ok(!el('edited').themeRefs?.fill && el('edited').fill === '#ff0000', 'a binding that disagrees is still dropped, the literal kept')
  ok(el('a').x === 120 && el('b').x === 236, `frame children are laid out with the token's gap (a.x ${el('a').x}, b.x ${el('b').x})`)
}

// What the derive pass changes in what the author wrote is reported in
// `dropped`, each entry with a path and a reason that names the fix: a token
// binding whose literal disagrees (dropped as a hand edit), a component copy
// with no sig (its differences become permanent overrides), frame children
// laid out in another order than written, a parentId naming no frame. And a
// token reference with no literal takes the token's value, so it holds.
console.log('\nwhat the derive pass changes is reported\n')
{
  const theme = {
    background: '#ffffff', color: '#111111', accent: '#f7a600', fontFamily: 'Inter, sans-serif',
    tokens: { set: { 'color.card': { type: 'color', values: { default: '#F2F0EA' } } } },
  }
  const rect = (o: Record<string, unknown>) => ({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, fill: '#cccccc', stroke: '#000000', strokeWidth: 0, radius: 0, ...o })
  const full = (elements: unknown[]) => JSON.stringify({
    format: 'bento/slides', version: 1, title: 'Losses', size: { width: W, height: 720 }, theme,
    slides: [{ id: 's1', background: '#ffffff', transition: 'none', notes: '', elements }],
  })
  const load = (json: string) => parseDocInputReport(json)!
  const entry = (r: ReturnType<typeof load>, p: string) => r.report.dropped.find((d) => d.path === p)
  const show = (r: ReturnType<typeof load>) => JSON.stringify(r.report.dropped)
  const els = (r: ReturnType<typeof load>) => r.doc.slides[0].elements as unknown as Array<Record<string, any>>

  // 1. a literal that differs from its token: the binding is dropped at load
  {
    const r = load(full([rect({ id: 'card', fill: '#123456', themeRefs: { fill: '$color.card' } })]))
    const d = entry(r, '/slides/0/elements/0/themeRefs/fill')
    ok(!els(r)[0].themeRefs?.fill, 'a literal that differs from its token still loses the binding (behaviour unchanged)')
    ok(!!d && /^binding dropped/.test(d.reason) && d.reason.includes('"#123456"') && d.reason.includes('"color.card"') && d.reason.includes('"#F2F0EA"') && /write the token's value/i.test(d.reason),
      `the dropped binding is reported with both values and the fix (${show(r)})`)
    const agree = load(full([rect({ id: 'card', fill: '#f2f0ea', themeRefs: { fill: '$color.card' } })]))
    ok(els(agree)[0].themeRefs?.fill === '$color.card' && agree.report.dropped.length === 0, `a literal that agrees (any case) keeps its binding and reports nothing (${show(agree)})`)
  }
  // 2. a token reference with no literal keeps its binding, full and compact
  {
    // (a full shape must carry `fill` to be drawn at all, so the full form binds `stroke`)
    const r = load(full([{ ...rect({ id: 'card', themeRefs: { stroke: '$color.card' } }), stroke: undefined }]))
    ok(els(r)[0].themeRefs?.stroke === '$color.card' && els(r)[0].stroke === '#F2F0EA' && r.report.dropped.length === 0,
      `full: a token reference with no literal keeps its binding and takes the token's value (stroke ${els(r)[0].stroke}, refs ${JSON.stringify(els(r)[0].themeRefs)}, ${show(r)})`)
    const c = load(JSON.stringify({ compact: true, theme, slides: [{ id: 's1', elements: [{ type: 'shape', shape: 'rect', id: 'card', x: 10, y: 10, w: 100, h: 100, themeRefs: { fill: '$color.card' } }] }] }))
    ok(els(c)[0].themeRefs?.fill === '$color.card' && els(c)[0].fill === '#F2F0EA' && c.report.dropped.length === 0,
      `compact: a token reference with no literal keeps its binding instead of meeting the editor default (fill ${els(c)[0].fill}, refs ${JSON.stringify(els(c)[0].themeRefs)}, ${show(c)})`)
  }
  // 3. a component copy written without its sig
  {
    const main = rect({ id: 'm1', x: 100, y: 100, fill: '#ff0000', groupId: 'gm', component: { id: 'c1', key: 'k0', main: true } })
    const copy = (c: Record<string, unknown>) => rect({ id: 'c1a', x: 500, y: 100, fill: '#00ff00', groupId: 'gc', component: { id: 'c1', key: 'k0', ...c } })
    const r = load(full([main, copy({})]))
    const d = entry(r, '/slides/0/elements/1/fill')
    ok(JSON.stringify(els(r)[1].component.over) === '["fill"]', 'a copy with no sig still keeps its difference as an override (behaviour unchanged)')
    ok(!!d && /^override added/.test(d.reason) && d.reason.includes('"fill"') && /no sig/.test(d.reason) && d.reason.includes('"reset"'),
      `the override is reported with the fix (sig "reset") (${show(r)})`)
    const reset = load(full([main, copy({ sig: 'reset' })]))
    ok(els(reset)[1].fill === '#ff0000' && !els(reset)[1].component.over && reset.report.dropped.length === 0,
      `a copy written with sig "reset" follows its main and reports nothing (fill ${els(reset)[1].fill}, ${show(reset)})`)
  }
  // 4. frame children ordered by coordinate, not by array order
  {
    const frame = rect({ id: 'f', x: 0, y: 0, w: 1200, h: 200, layout: { dir: 'row', gap: 10, pad: [10, 10, 10, 10] } })
    const r = load(full([frame, rect({ id: 'A', parentId: 'f', x: 900 }), rect({ id: 'B', parentId: 'f', x: 500 }), rect({ id: 'C', parentId: 'f', x: 0 })]))
    const xs = els(r).slice(1).map((e) => `${e.id}:${e.x}`).join(' ')
    const d = entry(r, '/slides/0/elements/0')
    ok(xs === 'A:230 B:120 C:10', `children written at x 900, 500, 0 still lay out C, B, A (behaviour unchanged: ${xs})`)
    ok(!!d && /^children reordered/.test(d.reason) && d.reason.includes('C, B, A') && /same x/.test(d.reason),
      `the reorder is reported on the frame, with the order and the fix (${show(r)})`)
    const tie = load(full([frame, rect({ id: 'A', parentId: 'f' }), rect({ id: 'B', parentId: 'f' }), rect({ id: 'C', parentId: 'f' })]))
    ok(els(tie).slice(1).map((e) => e.id + ':' + e.x).join(' ') === 'A:10 B:120 C:230' && tie.report.dropped.length === 0,
      `children written at the same x keep array order and report nothing (${show(tie)})`)
    // a settled frame (already laid out, whatever the array order) moves nothing and says nothing
    const settled = load(JSON.stringify(r.doc))
    ok(settled.report.dropped.length === 0, `reloading the laid-out deck reports nothing (${show(settled)})`)
  }
  // 5. a parentId that names no frame
  {
    const r = load(full([rect({ id: 'x', parentId: 'nope', sizing: { w: 'fill' } }), rect({ id: 'y', x: 300, parentId: 'z' }), rect({ id: 'z', x: 600 })]))
    const d = entry(r, '/slides/0/elements/0/parentId')
    const d2 = entry(r, '/slides/0/elements/1/parentId')
    ok(els(r)[0].parentId === undefined && els(r)[0].sizing === undefined, 'a dangling parentId is still removed with its sizing (behaviour unchanged)')
    ok(!!d && /^parent removed/.test(d.reason) && d.reason.includes('"nope"') && /not a frame/.test(d.reason),
      `a parentId naming nothing is reported (${show(r)})`)
    ok(!!d2 && /^parent removed/.test(d2.reason) && d2.reason.includes('"z"') && /not a frame/.test(d2.reason),
      'a parentId naming an element that is not a frame is reported')
  }
  // the decks people and agents already load stay silent
  {
    const r = load(JSON.stringify(starterDoc()))
    ok(r.report.dropped.length === 0, `the starter deck loads with nothing reported (${show(r)})`)
    for (const f of fs.readdirSync(fixtures).filter((n) => n.endsWith('.json')).sort()) {
      const fr = load(fs.readFileSync(path.join(fixtures, f), 'utf8'))
      const ours = fr.report.dropped.filter((d) => /^(binding dropped|override added|children reordered|parent removed)/.test(d.reason))
      ok(ours.length === 0, `${f}: nothing reported by the derive pass (${JSON.stringify(ours)})`)
    }
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
