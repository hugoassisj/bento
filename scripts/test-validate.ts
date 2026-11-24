#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Document validation rig.
//
//   esbuild scripts/test-validate.ts --bundle --platform=node --format=esm ...
//   node <bundle>
//
// (bundled because it pulls in starterdeck.ts, whose imports are extensionless)
//
// WHAT THIS PROVES. `validate()` exists so an agent can see what the runtime
// silently swallows. Its whole value rests on being TRUSTED, and the way it
// loses that is FALSE POSITIVES: an agent told that a real property is unknown
// will delete working configuration, which is worse than never having warned.
//
// So the rig pushes from both sides:
//
//   1. Real content stays quiet. The starter deck — our own showcase, which
//      exercises nearly every feature in the format — must report NO errors,
//      and a realistic chart option must produce no chart findings at all.
//   2. Broken content is caught. A deck built to trip every check must trip
//      exactly the expected codes, so a check silently ceasing to fire shows up
//      here rather than in somebody's deck.

import { starterDoc } from '../slides/src/starterdeck.ts'
import { validateDoc } from '../slides/src/validate.ts'
import type { BentoDoc } from '../slides/src/model.ts'
import { expandDoc } from '../slides/src/compact.ts'
import { parseDocInputReport } from '../slides/src/compactload.ts'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// bundled: the bundle lives elsewhere, so the repo root is the cwd (CI runs from it)
const fixtureDir = join(process.cwd(), 'scripts/fixtures/agent-decks')

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}

// ---------------------------------------------------------------- real content
const starter = validateDoc(starterDoc(), { measure: false })
ok(starter.ok && starter.counts.error === 0,
  `the starter deck reports no errors (${starter.counts.error} error, ${starter.counts.warning} warning, ${starter.counts.info} info)`)
ok(!starter.findings.some((f) => f.code === 'unknown-key'),
  'the starter deck has no unknown keys — the generated key tables match the format it is written in')
ok(!starter.findings.some((f) => f.code === 'chart-key-ignored'),
  'the starter deck has no dead chart options')
ok(!starter.findings.some((f) => f.code === 'font-not-embedded'),
  'the starter deck carries every typeface it names')
// The starter deck NAMES the shell's two faces (fonts[].asset = 'builtin:…')
// with no bytes in assets: a satisfied reference, not a missing asset. Only an
// unknown built-in name is broken; an asset key with no bytes still is.
ok(!starter.findings.some((f) => f.code === 'missing-asset'),
  'the starter deck\'s built-in font references are not missing assets')
{
  const missing = (fonts: NonNullable<BentoDoc['fonts']>) =>
    validateDoc({ ...starterDoc(), fonts, assets: {} }, { measure: false }).findings.filter((f) => f.code === 'missing-asset')
  ok(missing([{ family: 'X', asset: 'builtin:nope' }]).length === 1, 'an unknown built-in font name is a missing-asset error')
  ok(missing([{ family: 'X', asset: 'font-x' }]).length === 1, 'an asset key with no bytes is still the error it was')
  ok(missing([{ family: 'Fraunces', asset: 'builtin:fraunces-900' }]).length === 0, 'a known built-in name satisfies the reference')
}
ok(!starter.findings.some((f) => f.code === 'overridden-enter-fx'),
  'the starter deck has no entrance animations the morph would override')
ok(starter.measured === false, 'measured is false without a DOM rather than silently skipping')

// ------------------------------------------------------------- a clean deck
const clean: BentoDoc = {
  format: 'bento/slides', version: '1.0.0', docId: 'test', title: 'clean',
  size: { width: 1280, height: 720 }, theme: { accent: '#F7A600', fontFamily: 'system-ui' },
  assets: {}, fonts: null,
  slides: [{
    id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: [
      { id: 'a', type: 'text', x: 96, y: 100, w: 600, h: 120, rotation: 0, opacity: 1,
        html: 'hello', fontSize: 40, fontFamily: 'system-ui', fontWeight: 700,
        color: '#111', align: 'left', valign: 'middle', lineHeight: 1.2 },
    ],
  }],
} as any
const cleanResult = validateDoc(clean, { measure: false })
ok(cleanResult.findings.length === 0,
  `a clean deck produces no findings at all (got ${cleanResult.findings.length}: ${cleanResult.findings.map((f) => f.code).join(', ')})`)

// --------------------------------------------------------------- broken deck
const broken: BentoDoc = {
  ...clean,
  slides: [
    {
      id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: [
        // unknown key, out of canvas, broken link, duplicate id
        { id: 'dup', type: 'text', x: 1000, y: 100, w: 600, h: 120, rotation: 0, opacity: 1,
          html: 'over the edge', fontSize: 40, fontFamily: 'system-ui', fontWeight: 700,
          color: '#111', align: 'left', valign: 'middle', lineHeight: 1.2,
          fontStyle: 'italic', link: 'nope' } as any,
        { id: 'dup', type: 'text', x: 96, y: 300, w: 400, h: 80, rotation: 0, opacity: 1,
          html: 'same id', fontSize: 20, fontFamily: 'system-ui', fontWeight: 400,
          color: '#111', align: 'left', valign: 'middle', lineHeight: 1.2 } as any,
        // dash-march on a solid stroke, and a morph-key collision with 'dup'
        { id: 'dash', morphId: 'dup', type: 'shape', shape: 'line', x: 96, y: 500, w: 400, h: 4,
          rotation: 0, opacity: 1, fill: '#000', stroke: '#000', strokeWidth: 2,
          fx: { loop: { type: 'dash-march' } } } as any,
        // missing asset
        { id: 'img', type: 'image', x: 96, y: 560, w: 100, h: 100, rotation: 0, opacity: 1,
          src: 'asset:nope', fit: 'cover' } as any,
      ],
    },
    {
      id: 's2', name: 'two', background: '#FFF', transition: 'morph', notes: '', elements: [
        // entrance on a morph arrival; also an unknown fx key
        // an entrance on an element that MORPHS in (it shares 'dup' with the
        // previous slide) — already in motion, so fx.enter is skipped. Also
        // carries an unknown fx key.
        { id: 'dup', type: 'text', x: 96, y: 100, w: 400, h: 80, rotation: 0, opacity: 1,
          html: 'x', fontSize: 20, fontFamily: 'system-ui', fontWeight: 400,
          color: '#111', align: 'left', valign: 'middle', lineHeight: 1.2,
          fx: { enter: 'fade-up', wobble: true } } as any,
        // an entrance on an element that is NEW to this slide — nothing to
        // fight, so it runs and must NOT be reported
        { id: 'fresh', type: 'text', x: 96, y: 220, w: 400, h: 80, rotation: 0, opacity: 1,
          html: 'y', fontSize: 20, fontFamily: 'system-ui', fontWeight: 400,
          color: '#111', align: 'left', valign: 'middle', lineHeight: 1.2,
          fx: { enter: 'slide-left' } } as any,
        // a chart with options charts-lite does not implement
        { id: 'c', type: 'chart', x: 600, y: 100, w: 400, h: 300, rotation: 0, opacity: 1,
          preset: 'bar',
          option: {
            xAxis: { type: 'category', data: ['a'] }, yAxis: { type: 'value' },
            series: [{ type: 'bar', data: [1], label: { show: true } }],
            toolbox: { show: true },
          } } as any,
      ],
    },
  ],
} as any

const r = validateDoc(broken, { measure: false })
const codes = new Set(r.findings.map((f) => f.code))
for (const expected of [
  'unknown-key', 'out-of-canvas', 'broken-link', 'duplicate-id',
  'morph-key-collision', 'dash-march-no-dash', 'missing-asset',
  'overridden-enter-fx', 'chart-key-ignored',
]) {
  ok(codes.has(expected), `the broken deck trips ${expected}`)
}
ok(!r.ok, 'a deck with broken references is not ok')
ok(r.findings.some((f) => f.code === 'chart-key-ignored' && f.path === 'option.series[0].label'),
  'a label on a bar series is reported (it is read for pie only)')
ok(r.findings.some((f) => f.code === 'unknown-key' && f.path === 'fx.wobble'),
  'an unknown key nested under fx is reported with its path')
ok(!r.findings.some((f) => f.code === 'overridden-enter-fx' && f.element === 'fresh'),
  'an entrance on an element NEW to a morph slide is not reported — it runs')
ok(r.findings.some((f) => f.code === 'overridden-enter-fx' && f.element === 'dup'),
  'an entrance on an element that morphs in IS reported')

// ------------------------------------------------- fonts named but not carried
// The failure mode is invisible to whoever authored the deck, because they are
// exactly the person with the typeface installed. Two gallery templates shipped
// naming Instrument Sans and carrying nothing; on this machine they LOOKED
// right. Only the document can be checked, never the local font list.
const fontDoc = (fontFamily: string, fonts: unknown = null, codeFontFamily?: string): BentoDoc => ({
  ...clean, fonts,
  theme: { accent: '#F7A600', fontFamily, ...(codeFontFamily !== undefined ? { codeFontFamily } : {}) },
} as any)
const named = (d: BentoDoc) => validateDoc(d, { measure: false })
  .findings.filter((f) => f.code === 'font-not-embedded')

ok(named(fontDoc("'Instrument Sans', 'Helvetica Neue', sans-serif")).length === 1,
  'a face named but not carried is reported')
ok(named(fontDoc("'Instrument Sans', sans-serif",
  [{ family: 'Instrument Sans', asset: 'font-instrument', weight: '100 900' }])).length === 0,
  'the same face IS carried → no finding')
for (const stack of [
  'system-ui, sans-serif',
  "'Helvetica Neue', Arial, sans-serif",
  'Georgia, serif',
  "ui-monospace, 'SF Mono', Menlo, monospace",
]) {
  ok(named(fontDoc(stack)).length === 0, `a system stack is not reported (${stack.split(',')[0]})`)
}
{
  const uncarried = named(fontDoc('system-ui, sans-serif', null, "'JetBrains Mono', monospace"))
  ok(uncarried.length === 1 && uncarried[0].path === 'theme.codeFontFamily',
    'a codeFontFamily named in the theme but not carried in doc.fonts is reported at theme.codeFontFamily')
  ok(named(fontDoc('system-ui, sans-serif',
    [{ family: 'JetBrains Mono', asset: 'font-jb' }], "'JetBrains Mono', monospace")).length === 0,
    'the same codeFontFamily carried in doc.fonts produces no finding')
  ok(named(fontDoc('system-ui, sans-serif', null, "ui-monospace, 'SF Mono', Menlo, monospace")).length === 0,
    'a system monospace codeFontFamily stack produces no finding')
  const codeElDoc = (fontFamily: string, fonts: unknown = null): BentoDoc => ({
    ...clean, fonts,
    slides: [{
      id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: [
        { id: 'c1', type: 'code', x: 96, y: 100, w: 600, h: 200, rotation: 0, opacity: 1,
          content: 'x = 1', fontSize: 24, fontFamily, color: '#111', align: 'left', valign: 'middle', lineHeight: 1.25 },
      ],
    }],
  } as any)
  ok(named(codeElDoc("'Fira Code', monospace")).length === 1,
    'a code element naming an uncarried font is reported')
  ok(named(codeElDoc("'Fira Code', monospace", [{ family: 'Fira Code', asset: 'font-fira' }])).length === 0,
    'a code element whose font IS carried produces no finding')
}

// ------------------------------------------------- chart false-positive guard
// The shape the starter deck's own charts use. Every key here IS implemented,
// so any finding is the validator lying about working configuration.
const realisticChart = {
  color: ['#F7A600', '#5B8DEF'],
  grid: { left: 48, right: 16, top: 24, bottom: 56 },
  legend: { show: true, top: 0, textStyle: { fontSize: 13 } },
  tooltip: { trigger: 'axis' },
  xAxis: { type: 'category', data: ['Mon', 'Tue'], axisLine: { lineStyle: { color: '#D8D2C4' } }, axisLabel: { color: '#6B7280' } },
  yAxis: [
    { type: 'value', axisLabel: { color: '#6B7280' }, splitLine: { lineStyle: { color: '#EAE4D6' } } },
    { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
  ],
  series: [
    { type: 'bar', name: 'Signups', data: [1, 2], itemStyle: { borderRadius: [6, 6, 0, 0] } },
    { type: 'line', name: 'Rate', yAxisIndex: 1, data: [3, 4], smooth: true, symbolSize: 8, lineStyle: { width: 3 } },
  ],
}
const chartDoc: BentoDoc = {
  ...clean,
  slides: [{
    id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: [
      { id: 'ch', type: 'chart', x: 96, y: 96, w: 800, h: 400, rotation: 0, opacity: 1,
        preset: 'bar', option: realisticChart } as any,
    ],
  }],
} as any
const chartFindings = validateDoc(chartDoc, { measure: false }).findings
ok(chartFindings.length === 0,
  `a realistic dual-axis chart produces no findings (got ${chartFindings.map((f) => f.path).join(', ') || 'none'})`)

// ------------------------------------------------- hidden slides
// Hidden is the one state a slide can be in where nothing on screen reveals a
// mistake: it is skipped silently, exactly as intended, whether or not anyone
// can still get to it.
const hiddenDoc = (link?: string): BentoDoc => ({
  ...clean,
  slides: [
    { id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements:
      link ? [{ id: 'go', type: 'shape', shape: 'rect', x: 10, y: 10, w: 50, h: 50, rotation: 0,
                opacity: 1, fill: '#000', stroke: 'none', strokeWidth: 0, radius: 0, link }] : [] },
    { id: 's2', name: 'appendix', background: '#FFF', transition: 'fade', notes: '', hidden: true, elements: [] },
  ],
} as any)
const unreachable = (d: BentoDoc) => validateDoc(d, { measure: false })
  .findings.filter((f) => f.code === 'unreachable-hidden-slide')

ok(unreachable(hiddenDoc()).length === 1,
  'a hidden slide nothing links to is reported as unreachable')
ok(unreachable(hiddenDoc('s2')).length === 0,
  'a hidden slide with an inbound link is not reported — that is the point of hiding it')
ok(unreachable(clean).length === 0, 'an ordinary deck reports nothing')
ok(validateDoc(hiddenDoc('s2'), { measure: false }).ok,
  'hiding a slide is never an error')

// ------------------------------------------------- live-session keys in a file
// The capability nobody can see. A shared deck's file grants write access to
// whoever holds it, which is the design — but it is invisible in the JSON's
// shape, so the one place it can be surfaced is a check an agent runs.
const withCollab = (collab: unknown): BentoDoc => ({ ...clean, collab } as any)
const secretsFound = (d: BentoDoc) => validateDoc(d, { measure: false })
  .findings.filter((f) => f.code === 'collab-secrets-present')

ok(secretsFound(withCollab({ room: 'r1', key: 'k', ownerPriv: 'X' })).length === 1,
  'an owner private key in the document is reported')
ok(secretsFound(withCollab({ room: 'r1', key: 'k', writerPriv: 'X' })).length === 1,
  'a writer private key is reported')
ok(secretsFound(withCollab({ room: 'r1', key: 'k', invite: { pub: 'a', priv: 'b' } })).length === 1,
  'invite delegation material is reported')
ok(secretsFound(withCollab({ room: 'wss://x/d/wABC', key: 'k', role: 'reader', writerPub: 'P' })).length === 1,
  'a read-only copy is reported — its room key reads the room live')
ok(/read-only copy still carries the room key/.test(secretsFound(withCollab({ room: 'wss://x/d/wABC', key: 'k', role: 'reader' }))[0]?.message ?? ''),
  'and the message says a read-only copy is not key-free')
ok(/unsigned room/.test(secretsFound(withCollab({ room: 'wss://x/d/rLEGACY', key: 'k' }))[0]?.message ?? ''),
  'a legacy (unsigned) room key is reported as write access')
ok(secretsFound(withCollab({ room: 'wss://x/d/wABC', key: 'k', audience: { invite: { pub: 'a', priv: 'b', role: 'audience', sig: 's' }, key: 'show' } })).length === 1,
  'the audience ticket store is reported')
ok(secretsFound(withCollab({ on: false })).length === 0,
  'a collab block with no key material is not reported')
ok(secretsFound(clean).length === 0, 'a deck that was never shared is not reported')
ok(validateDoc(withCollab({ room: 'r1', key: 'k', ownerPriv: 'X' }), { measure: false }).ok,
  'carrying your own room keys is never an error — it is how a working file works')

// ------------------------------------------------- brand palette references
// Both failures are silent: an unresolvable ref simply never updates, and a
// literal that disagrees with its ref is about to be overwritten by the next
// palette edit, which reads as the app changing a colour by itself.
const refDoc = (refs: Record<string, string>, fill = '#F7A600'): BentoDoc => ({
  ...clean,
  slides: [{
    id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: [
      { id: 'sh', type: 'shape', shape: 'rect', x: 96, y: 96, w: 100, h: 100, rotation: 0,
        opacity: 1, fill, stroke: 'none', strokeWidth: 0, radius: 0, themeRefs: refs } as any,
    ],
  }],
} as any)
const refCodes = (d: BentoDoc) => new Set(validateDoc(d, { measure: false }).findings.map((f) => f.code))
ok(refCodes(refDoc({ fill: 'accent1' })).size === 0,
  'a correct palette reference is silent')
ok(refCodes(refDoc({ fill: 'ghost' })).has('theme-ref-malformed'),
  'a reference naming something that is not a slot is reported as malformed')
// hlink/folHlink are the only slots that can genuinely be empty — every other
// one falls back in paletteOf, deliberately, so a reference never dangles just
// because nobody opened the theme editor.
ok(refCodes(refDoc({ fill: 'hlink' })).has('theme-ref-unknown-slot'),
  'a reference to a slot with no value set is reported')
ok(refCodes(refDoc({ fill: 'accent1 nonsense' })).has('theme-ref-malformed'),
  'a malformed reference token is reported')
ok(refCodes(refDoc({ 'shadow.color': 'accent1' })).has('theme-ref-dangling'),
  'a reference with no colour to control is reported')
ok(refCodes(refDoc({ fill: 'accent1' }, '#123456')).has('theme-ref-stale'),
  'a literal that disagrees with its reference is reported before the palette overwrites it')

// ------------------------------------------------- values the runtime swallows
// An unknown element type, a value its property does not take, a parentId
// that names no frame: each used to validate clean while the element did not
// draw, drew a fallback, or silently left its frame. They are judged by the
// paste gate's own per-property checks, so the two cannot disagree.
const one = (els: unknown[]): BentoDoc => ({
  ...clean,
  slides: [{ id: 's1', name: 'one', background: '#FFF', transition: 'fade', notes: '', elements: els }],
} as any)
const findingsOf = (els: unknown[]) => validateDoc(one(els), { measure: false }).findings
const rect = (extra: Record<string, unknown> = {}) =>
  ({ id: 'a', type: 'shape', shape: 'rect', x: 10, y: 10, w: 100, h: 100, fill: '#f00', ...extra })
{
  const f = findingsOf([{ id: 'a', type: 'shap', x: 10, y: 10, w: 100, h: 100 }])
  const t = f.find((x) => x.code === 'unknown-type')
  ok(!!t && t.severity === 'error' && t.path === 'type' && t.element === 'a' && t.slide === 's1',
    `an unknown element type is an error at path "type" (got ${f.map((x) => `${x.severity}:${x.code}@${x.path}`).join(', ') || 'nothing'})`)
  ok(!!t && ['text', 'shape', 'image', 'chart', 'table', 'media', 'embed', 'code'].every((ty) => t.message.includes(ty)),
    'its message names the valid types')
  ok(!!t && t.message.includes('did you mean "shape"'), 'and suggests "shape" for "shap"')
  ok(f.length === 1, `nothing else is derived from an element of an unknown type (${f.length} finding(s))`)
  const far = findingsOf([{ id: 'a', type: 'widget', x: 5000, y: 10, w: 100, h: 100 }])
  ok(far.length === 1 && !far[0].message.includes('did you mean'),
    'a type nowhere near a real one suggests nothing, and its off-canvas box is not reported')
}
{
  const f = findingsOf([rect({ x: '10' })])
  const x = f.find((v) => v.code === 'invalid-value' && v.path === 'x')
  ok(!!x && x.severity === 'error' && /must be a finite number, got the string "10"/.test(x.message),
    `a string x is an error that says what it must be (${x?.message ?? 'no finding'})`)
  ok(!f.some((v) => v.code === 'out-of-canvas'), 'and no out-of-canvas is derived from "10" + 100 = "10100"')
}
{
  const f = findingsOf([rect({ opacity: 2 })])
  ok(f.some((v) => v.code === 'invalid-value' && v.path === 'opacity' && v.severity === 'warning' && /from 0 to 1, got 2/.test(v.message)),
    'an opacity out of range is a warning that states the range')
  const g = findingsOf([{ id: 't', type: 'text', x: 96, y: 96, w: 400, h: 80, html: 'x', fontSize: '20', align: 'middle' }])
  ok(g.some((v) => v.code === 'invalid-value' && v.path === 'fontSize' && v.severity === 'warning'),
    'a string fontSize is a warning (not geometry)')
  ok(g.some((v) => v.code === 'invalid-value' && v.path === 'align' && /one of "left", "center", "right"/.test(v.message)),
    'an enum value that is not one of its words names the words')
  const sh = findingsOf([rect({ shadow: { x: '3', y: 0, blur: 4, color: '#000' } })])
  ok(sh.some((v) => v.code === 'invalid-value' && v.path === 'shadow.x'),
    `a nested string number is reported at its own path (${sh.map((v) => v.path).join(', ') || 'nothing'})`)
  const req = findingsOf([{ id: 't', type: 'text', x: 96, y: 96, w: 400, h: 80, html: 42 }])
  ok(req.some((v) => v.code === 'invalid-value' && v.path === 'html' && v.severity === 'error'),
    'a required key the gate would drop (taking the element with it) is an error')
}
{
  // colour syntax is the browser's call; without one, nothing is guessed
  ok(!findingsOf([rect({ fill: 'not-a-color' })]).some((v) => v.code === 'invalid-value'),
    'without a CSS parser (node) a colour is not judged — no guess')
  // with one, the validator asks it, for every colour the gate's schema marks
  const asked: string[] = []
  ;(globalThis as any).CSS = { supports: (p: string, v: string) => { asked.push(v); return p === 'color' && v !== 'not-a-color' } }
  try {
    const f = findingsOf([rect({
      fill: 'not-a-color', stroke: 'not-a-color', shadow: { blur: 2, color: 'not-a-color' },
      fillGradient: { angle: 0, stops: [{ at: 0, color: 'not-a-color' }, { at: 1, color: '#fff' }] },
    })])
    const paths = f.filter((v) => v.code === 'invalid-value').map((v) => v.path).sort()
    ok(JSON.stringify(paths) === JSON.stringify(['fill', 'fillGradient.stops[0].color', 'shadow.color', 'stroke']),
      `fill, stroke, a shadow and a gradient stop are each asked about (${paths.join(', ')})`)
    ok(f.every((v) => v.code !== 'invalid-value' || v.severity === 'warning'), 'an unparseable colour is a warning, never an error')
    asked.length = 0
    const quiet = findingsOf([rect({ fill: 'url(#g)', stroke: 'none' })])
    ok(!quiet.some((v) => v.code === 'invalid-value') && !asked.includes('url(#g)') && !asked.includes('none'),
      'a paint may be a local url(#id) or none without asking the colour parser')
  } finally { delete (globalThis as any).CSS }
}
{
  const parent = (pid: string, extra: unknown[] = []) => findingsOf([...extra, rect({ id: 'c', parentId: pid })])
    .filter((v) => v.code === 'dangling-parent')
  const frame = rect({ id: 'f', layout: { dir: 'col', gap: 8, pad: [8, 8, 8, 8] } })
  const missing = parent('nope')
  ok(missing.length === 1 && missing[0].severity === 'warning' && missing[0].path === 'parentId' && /free element/.test(missing[0].message),
    'a parentId naming nothing on the slide is a dangling-parent warning')
  ok(parent('f', [rect({ id: 'f' })]).length === 1, 'a parentId naming an element that is not a frame is reported')
  ok(parent('c').length === 1, 'a parentId naming the element itself is reported')
  ok(parent('f', [frame]).length === 0, 'a child of a real frame is not reported')
}
{
  const f = findingsOf([rect({ fil: '#f00' })]).find((v) => v.code === 'unknown-key')
  ok(!!f && f.message.includes('did you mean "fill"'), `an unknown key suggests the nearest real one (${f?.message ?? 'no finding'})`)
  const fx = findingsOf([rect({ fx: { ente: 'fade' } })]).find((v) => v.path === 'fx.ente')
  ok(!!fx && fx.message.includes('did you mean "enter"'), 'so does an unknown fx key')
  const z = findingsOf([rect({ z: 1 })]).find((v) => v.code === 'unknown-key')
  ok(!!z && !z.message.includes('did you mean'), 'a one-letter key suggests nothing rather than a guess')
}
{
  // real content: every value the starter and the agent fixtures carry is one
  // the gate accepts, so none of the new codes may fire on them
  const NEW = ['invalid-value', 'unknown-type', 'dangling-parent']
  const fresh = (d: BentoDoc) => validateDoc(d, { measure: false }).findings.filter((v) => NEW.includes(v.code))
  const s = fresh(starterDoc())
  ok(s.length === 0, `the starter deck gains no value findings (${s.map((v) => `${v.code}@${v.element}.${v.path}`).join(', ') || 'none'})`)
  for (const name of readdirSync(fixtureDir).filter((n) => n.endsWith('.json'))) {
    const json = readFileSync(join(fixtureDir, name), 'utf8')
    const raw = fresh(expandDoc(JSON.parse(json)))
    const loaded = parseDocInputReport(json, { fit: false })
    const after = loaded ? fresh(loaded.doc) : null
    ok(raw.length === 0 && after?.length === 0,
      `agent fixture ${name}: no value findings, as written or as loaded (${[...raw, ...(after ?? [])].map((v) => `${v.code}@${v.path}`).join(', ') || 'none'})`)
  }
}
{
  // read-only, and the finding shape is unchanged
  const docs = [broken, one([rect({ x: '10', fil: '#f00', parentId: 'nope', shadow: { x: '3', blur: 2, color: '#000' } }),
    { id: 'u', type: 'shap', x: 1, y: 1, w: 1, h: 1 }]), starterDoc()]
  let same = true
  let shaped = true
  for (const d of docs) {
    const before = JSON.stringify(d)
    for (const f of validateDoc(d, { measure: false }).findings) {
      if (Object.keys(f).some((k) => !['code', 'severity', 'message', 'slide', 'element', 'path'].includes(k))) shaped = false
    }
    if (JSON.stringify(d) !== before) same = false
  }
  ok(same, 'validate() never mutates the document it is given')
  ok(shaped, 'every finding keeps the shape { code, severity, message, slide, element, path }')
}

// ------------------------------------------------- what people see
// Contrast, text on text and frame children, judged without a DOM: on whole
// boxes, with the colours this rig can read without a browser. Advice only.
const slideOf = (els: unknown[], background = '#F2F0EA'): BentoDoc => ({
  ...clean,
  slides: [{ id: 's1', name: 'one', background, transition: 'fade', notes: '', elements: els }],
} as any)
const seen = (d: BentoDoc, code: string) => validateDoc(d, { measure: false }).findings.filter((f) => f.code === code)
const txt = (extra: Record<string, unknown> = {}) =>
  ({ id: 'a', type: 'text', x: 100, y: 100, w: 400, h: 60, html: '<p>hello</p>', color: '#F2F0EA', fontSize: 20, ...extra })
{
  const low = seen(slideOf([txt()]), 'low-contrast')
  ok(low.length === 1 && low[0].severity === 'warning' && low[0].path === 'color' && low[0].element === 'a' && /1:1 against/.test(low[0].message) && /whole box/.test(low[0].message),
    `cream text on a cream slide is low-contrast, with the ratio, measured on the whole box (${low[0]?.message.slice(0, 60) ?? 'nothing'})`)
  ok(seen(slideOf([txt({ color: '#0D1B2E' })]), 'low-contrast').length === 0, 'the same text in #0D1B2E is not')
  // #949494 on white is 3.03:1 — enough for large text, not for small
  const grey = (extra: Record<string, unknown>) => seen(slideOf([txt({ color: '#949494', ...extra })], '#FFFFFF'), 'low-contrast')
  ok(grey({ fontSize: 20 }).length === 1 && /needs 4\.5:1 at 20px/.test(grey({ fontSize: 20 })[0].message), '3:1 at 20px needs 4.5:1 and says so')
  ok(grey({ fontSize: 24 }).length === 0, '3:1 at 24px is enough (large text)')
  ok(grey({ fontSize: 19, fontWeight: 700 }).length === 0, '3:1 at 19px bold is enough (large bold text)')
  ok(grey({ fontSize: 18, fontWeight: 700 }).length === 1, '3:1 at 18px bold is not')
  ok(seen(slideOf([txt({ color: '#D0D0D0', fontSize: 60 })], '#FFFFFF'), 'low-contrast').length === 1, 'under 3:1 fails at any size')
  ok(seen(slideOf([txt({ opacity: 0.05, color: '#000000', fontSize: 300 })]), 'low-contrast').length === 0, 'a ghost numeral at 5% opacity is decoration, not judged')
  ok(seen(slideOf([txt({ color: 'rgba(0,0,0,0.1)' })]), 'low-contrast').length === 0, 'so is text whose colour alpha is under 0.15')
  ok(seen(slideOf([txt({ html: '{{page:2}}', color: '#E8E4DA' })]), 'low-contrast').length === 0, 'furniture made only of fields (a muted page number) is not judged')
  const card = { id: 'card', type: 'shape', shape: 'rect', x: 80, y: 80, w: 460, h: 100, fill: '#0D1B2E' }
  ok(seen(slideOf([card, txt({ color: '#FFFFFF' })], '#FFFFFF'), 'low-contrast').length === 0, 'white text on a navy card on a white slide reads')
  ok(seen(slideOf([card, txt({ color: '#FFFFFF', x: 700 })], '#FFFFFF'), 'low-contrast').length === 1, 'the same text off the card does not')
  ok(seen(slideOf([{ ...card, fill: 'rgba(13,27,46,0.04)' }, txt({ color: '#FFFFFF' })], '#FFFFFF'), 'low-contrast').length === 1, 'a card at 4% alpha hardly changes the backdrop')
  ok(seen(slideOf([{ id: 'img', type: 'image', x: 0, y: 0, w: 1280, h: 720, src: 'data:image/png;base64,AA==' }, txt({ color: '#FFFFFF' })], '#FFFFFF'), 'low-contrast').length === 0,
    'text over a picture is not judged — its backdrop cannot be computed')
  ok(seen(slideOf([txt({ color: 'white' })], '#FFFFFF'), 'low-contrast').length === 0, 'a named colour is not guessed at without a browser')
}
{
  const t = (id: string, x: number, y: number, html: string, extra: Record<string, unknown> = {}) =>
    ({ id, type: 'text', x, y, w: 400, h: 80, html: `<p>${html}</p>`, fontSize: 30, color: '#111111', ...extra })
  const over = seen(slideOf([t('a', 100, 100, 'hello there'), t('b', 110, 110, 'overlapping')]), 'text-overlap')
  ok(over.length === 1 && over[0].element === 'b' && over[0].severity === 'warning' && /"a"/.test(over[0].message),
    `two overlapping text boxes give exactly one text-overlap, on the upper one (${over.map((f) => f.element).join(', ') || 'none'})`)
  ok(seen(slideOf([t('a', 100, 100, 'hello there'), t('b', 501, 100, 'overlapping')]), 'text-overlap').length === 0, 'side by side with a 1px gap: none')
  ok(seen(slideOf([t('a', 100, 100, 'hello there'), t('b', 100, 175, 'overlapping')]), 'text-overlap').length === 0, 'a 5px overlap (under a tenth of the box): none')
  ok(seen(slideOf([t('a', 100, 100, 'hello there', { showOnHover: 'one' }), t('b', 110, 110, 'overlapping', { showOnHover: 'two' })]), 'text-overlap').length === 0,
    'texts in different hover sets are never shown together: none')
  ok(seen(slideOf([t('a', 100, 100, 'hello there', { groupId: 'g' }), t('b', 110, 110, 'overlapping', { groupId: 'g' })]), 'text-overlap').length === 1,
    'two different texts in one group still collide')
  ok(seen(slideOf([t('a', 104, 104, 'Title', { color: '#999999', groupId: 'g' }), t('b', 100, 100, 'Title', { groupId: 'g' })]), 'text-overlap').length === 0,
    'a shadow copy of the same words is an effect: none')
  ok(seen(slideOf([t('a', 100, 100, '48', { opacity: 0.05, fontSize: 300, w: 600, h: 400 }), t('b', 110, 110, 'overlapping')]), 'text-overlap').length === 0,
    'a ghost numeral behind a title: none')
  ok(seen(slideOf([t('a', 100, 100, 'hello there', { hidden: true }), t('b', 110, 110, 'overlapping')]), 'text-overlap').length === 0, 'a hidden text: none')
  const table = { id: 'tb', type: 'table', x: 120, y: 120, w: 400, h: 100, columns: [{ w: 1 }], header: false, rows: [{ cells: [{ html: 'x' }] }], style: {} }
  ok(seen(slideOf([table, t('b', 110, 110, 'over the table')]), 'text-overlap').length === 1, 'text over a table collides too')
}
{
  // a column frame that clips, 140 tall: with padding 10 and gap 10, two
  // children of 60 fill it to its edge and the third lands 70px below it
  const frame = (clip: boolean, h = 140) => ({ id: 'f', type: 'shape', shape: 'rect', x: 100, y: 100, w: 300, h, fill: '#EEEEEE',
    layout: { dir: 'col', gap: 10, pad: [10, 10, 10, 10], clip } })
  const kid = (id: string) => ({ id, type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 60, fill: '#333333', parentId: 'f' })
  const cut = seen(slideOf([frame(true), kid('k1'), kid('k2'), kid('k3')]), 'outside-frame')
  ok(cut.length === 1 && cut[0].severity === 'warning' && cut[0].path === 'parentId' && cut[0].element === 'k3' && /70px past the bottom/.test(cut[0].message) && /clips/.test(cut[0].message),
    `a child laid out past the bottom of a clipping frame is an outside-frame warning (${cut.map((f) => `${f.element}: ${f.message.slice(0, 50)}`).join('; ') || 'none'})`)
  const shown = seen(slideOf([frame(false), kid('k1'), kid('k2'), kid('k3')]), 'outside-frame')
  ok(shown.length === 1 && shown[0].severity === 'info', 'past a frame that does not clip, it is info')
  ok(seen(slideOf([frame(true, 220), kid('k1'), kid('k2'), kid('k3')]), 'outside-frame').length === 0, 'a frame tall enough for its children: none')
  const raw = slideOf([frame(true), kid('k1'), kid('k2'), kid('k3')])
  const before = JSON.stringify(raw)
  validateDoc(raw, { measure: false })
  ok(JSON.stringify(raw) === before, 'the frame check lays out a copy: the document is not moved')
}
{
  const NEW = ['low-contrast', 'text-overlap', 'outside-frame', 'chart-label-clipped']
  const s = validateDoc(starterDoc(), { measure: false }).findings.filter((f) => NEW.includes(f.code) && f.severity !== 'info')
  ok(s.length === 0, `the starter deck gains no visual warnings on whole boxes (${s.map((f) => `${f.code}@${f.element}`).join(', ') || 'none'})`)
  for (const name of readdirSync(fixtureDir).filter((n) => n.endsWith('.json'))) {
    const loaded = parseDocInputReport(readFileSync(join(fixtureDir, name), 'utf8'), { fit: false })
    const f = loaded ? validateDoc(loaded.doc, { measure: false }).findings.filter((v) => NEW.includes(v.code)) : null
    ok(f?.length === 0, `agent fixture ${name}: no visual findings (${f?.map((v) => `${v.code}@${v.element}`).join(', ') || 'none'})`)
  }
  ok(!validateDoc(starterDoc(), { measure: false }).findings.some((f) => f.code === 'chart-label-clipped'), 'the chart check needs the renderer: skipped without a DOM')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
