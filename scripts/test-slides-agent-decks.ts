#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Agent-deck corpus: compact decks written the way agents write them
// (scripts/fixtures/agent-decks/*.json) must load clean — through the real
// loader (compactload.ts: expand → gate → parseDoc → validate) — with zero
// dropped keys and zero validate() errors. A change to a default, the gate or
// the expansion that breaks the agent path fails here, not in someone's
// harness. esbuild-bundled in CI (the loader pulls the gate and validate).
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-agent-decks.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
//
// No DOM here: fit-to-text is skipped (fit=false) and validate() runs its
// unmeasured checks; the browser half (heights) is measured in Chrome and
// stated in the PR that lands each change to compactload.ts.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocInputReport } from '../slides/src/compactload.ts'
import { isCompact, provisionalHeight } from '../slides/src/compact.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
// bundled: the bundle lives elsewhere, so the repo root is the cwd (CI runs from it)
const root = process.cwd()
const dir = join(root, 'scripts/fixtures/agent-decks')
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
ok(files.length >= 3, `${files.length} agent decks in the corpus`)

for (const f of files) {
  console.log(`\n${f}\n`)
  const json = readFileSync(join(dir, f), 'utf8')
  const raw = JSON.parse(json)
  ok(isCompact(raw), 'is a compact document')
  const parsed = parseDocInputReport(json, false)
  ok(!!parsed, 'loads')
  if (!parsed) continue
  const { doc, report } = parsed
  ok(report.compact && report.dropped.length === 0, `zero dropped keys${report.dropped.length ? ': ' + report.dropped.map((d) => `${d.path} (${d.reason})`).join('; ') : ''}`)
  ok(report.expanded > 0, `${report.expanded} fields expanded`)
  const errors = report.findings.findings.filter((x) => x.severity === 'error')
  ok(errors.length === 0, `validate(): zero errors${errors.length ? ': ' + errors.map((e) => e.message).join('; ') : ''}`)
  const warnings = report.findings.findings.filter((x) => x.severity === 'warning')
  if (warnings.length) console.log(`        (${warnings.length} warning(s): ${warnings.map((w) => w.code ?? w.message).join(', ')})`)
  const els = doc.slides.flatMap((s) => s.elements)
  ok(els.every((e) => typeof e.id === 'string' && e.id), 'every element has an id')
  ok(new Set(els.map((e) => e.id)).size === els.length || doc.slides.every((s) => new Set(s.elements.map((e) => e.id)).size === s.elements.length), 'ids are unique within each slide')
  ok(els.every((e) => e.type !== 'text' || typeof (e as { html?: unknown }).html === 'string'), 'every text element has html (md converted)')
  ok(els.every((e) => !('md' in e)), 'no md reaches the document')
  // provisional heights are present where h was omitted (the browser fits them)
  const auto = raw.slides.flatMap((s: { elements?: unknown[] }) => (s.elements ?? []).flat(Infinity)).filter((e: { type?: string; h?: unknown }) => e.type === 'text' && (e.h === undefined || e.h === 'auto')).length
  ok(report.fitted === 0 && report.refit.length === 0, 'without a DOM nothing is fitted (fit=false) and nothing is queued')
  if (auto) ok(els.some((e) => e.type === 'text' && e.h === provisionalHeight(Number((e as { fontSize?: number }).fontSize) || 24, Number((e as { lineHeight?: number }).lineHeight) || 1.2)), `${auto} text element(s) carry a provisional one-line height`)
}

console.log('\nthe deck\'s design system (AI-08)\n')
{
  type R = Record<string, unknown> & { themeRefs?: Record<string, string>; component?: Record<string, unknown> }
  const load = (f: string) => parseDocInputReport(readFileSync(join(dir, f), 'utf8'), false)!.doc
  const flat = (d: ReturnType<typeof load>) => d.slides.flatMap((s) => s.elements) as unknown as R[]
  const tv = load('token-values.json')
  const tvEls = flat(tv)
  const texts = tvEls.filter((e) => e.type === 'text')
  ok(texts.length > 0 && texts.every((e) => !('fontFamily' in e)), 'token-values: no text element carries a fontFamily literal (all follow the theme font)')
  const rule = tvEls.find((e) => e.id === 'rule')!
  ok(rule.fill === '#E8B923' && rule.themeRefs?.fill === 'accent1', 'token-values: a shape with no fill is the deck accent, bound to accent1')
  const cards = tvEls.filter((e) => e.themeRefs?.fill === '$color.card')
  ok(cards.length === 2 && cards.every((e) => e.fill === '#16273E' && e.radius === 16 && e.themeRefs?.radius === '$radius.md'), 'token-values: "$color.card" / "$radius.md" load as the token values, bound')
  const kicker = tvEls.find((e) => e.id === 'kicker')!
  ok(kicker.fontSize === 18 && kicker.themeRefs?.fontSize === '$size.kicker' && kicker.color === '#E8B923' && kicker.themeRefs?.color === 'accent1', 'token-values: a font-size token and a slot colour on one text element')
  ok((tv.slides[0] as unknown as R).themeRefs?.background === 'bg1' && (tv.slides[1] as unknown as R).themeRefs?.background === 'bg2' && tv.slides[1].background === '#F4F1E8', 'token-values: slide backgrounds bound to bg1 (default) and bg2 (named)')

  const cu = load('component-use.json')
  const cuEls = flat(cu)
  const copies = cuEls.filter((e) => e.component && !e.component.main)
  const mainEls = cuEls.filter((e) => e.component?.main)
  ok(mainEls.length === 3 && copies.length === 6, `component-use: one main of 3 members, two copies of 3 (${mainEls.length} + ${copies.length})`)
  ok(copies.every((e) => typeof e.component!.sig === 'string' && e.component!.sig.length > 0 && Array.isArray(e.component!.off)), 'component-use: every copy member carries a sig and an offset')
  const overs = copies.map((e) => `${e.component!.key}:${((e.component!.over as string[]) ?? []).join('+')}`).join(' ')
  ok(overs === 'bg: title:html body:html bg:fill+themeRefs title:html body:', `component-use: only the listed keys are overrides (${overs})`)

  const sl = load('slide-like.json')
  const ids = (i: number) => sl.slides[i].elements.map((e) => e.id).join()
  ok(ids(2).startsWith('logo,footer,') && sl.slides[2].elements.length === 3, `slide-like: the third slide gets the recurring logo and footer, then its own title (${ids(2)})`)
  ok(sl.slides.every((s) => s.background === '#F5F7FA' && (s as unknown as R).themeRefs?.background === 'bg2' && s.transition === 'morph'), 'slide-like: every slide shares the source\'s bg2 binding and morph transition')
}

console.log('\nnames that do not resolve, through the real loader\n')
{
  const bad = JSON.stringify({ compact: true, theme: { tokens: { set: { 'color.card': { type: 'color', values: { default: '#16273E' } } } } }, slides: [{ elements: [
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '$color.crad' },
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: 'accent7' },
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#123456', themeRefs: { fill: '$color.card' } },
    { use: 'missing' },
  ] }] })
  const parsed = parseDocInputReport(bad, false)
  ok(!!parsed, 'a deck with unresolvable names still loads (nothing throws)')
  const why = (path: string) => parsed?.report.dropped.find((d) => d.path === path)?.reason ?? ''
  ok(/unknown token `\$color\.crad`; tokens in this deck: `\$color\.card`/.test(why('/slides/0/elements/0/fill')), `an unknown token is in dropped with the valid names (${why('/slides/0/elements/0/fill')})`)
  ok(/unknown palette slot `accent7`; slots: `bg1`/.test(why('/slides/0/elements/1/fill')), 'an unknown slot is in dropped with the valid slots')
  ok(/dropped on load/.test(why('/slides/0/elements/2/themeRefs/fill')), 'a binding whose literal disagrees with its token is in dropped')
  ok(/unknown component `missing`/.test(why('/slides/0/elements/3/use')), 'an unknown component is in dropped')
  ok(parsed?.doc.slides[0].elements.length === 3 && parsed.doc.slides[0].elements.slice(0, 2).every((e) => (e as unknown as { fill: string }).fill === parsed.doc.theme.accent), 'the shapes fall back to the bound accent default; the unknown use adds nothing')
}

console.log('\nthe report on a deliberately wrong deck\n')
{
  const bad = JSON.stringify({ compact: true, slides: [{ elements: [
    { type: 'text', x: 0, y: 0, w: 100, h: 20, html: 'x', bogus: 1, onclick: 'alert(1)', fontSize: 'big' },
    { type: 'sparkle', x: 0, y: 0, w: 1, h: 1 },
  ] }] })
  const parsed = parseDocInputReport(bad, false)
  ok(!!parsed, 'a deck with mistakes still loads (the gate drops, it does not refuse)')
  const paths = parsed?.report.dropped.map((d) => d.path) ?? []
  ok(paths.includes('/slides/0/elements/0/bogus'), `bogus key reported at its path (${paths.join(', ')})`)
  ok(paths.includes('/slides/0/elements/0/onclick'), 'onclick reported at its path')
  ok(parsed?.report.dropped.some((d) => d.path === '/slides/0/elements/0/fontSize' && d.reason === 'invalid value'), 'an invalid value is reported as such')
  ok(parsed?.report.dropped.some((d) => d.path === '/slides/0/elements/1/type' && /unknown element type/.test(d.reason)), 'an unknown element type is reported and the element dropped')
  ok(parsed?.doc.slides[0].elements.length === 1, 'the good element survives, the unknown one is gone')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
