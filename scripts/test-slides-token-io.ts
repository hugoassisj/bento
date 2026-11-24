#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Design-token import and export (slides/src/tokenio.ts, tokenimport.ts).
//
// BUNDLED, not run directly — restoregate.ts imports extensionless — and run
// from the repo root (it reads the fixtures from there):
//
//   slides/node_modules/.bin/esbuild scripts/test-slides-token-io.ts --bundle \
//     --platform=node --format=esm --outfile="$TMPDIR/test-slides-token-io.mjs" \
//     && node "$TMPDIR/test-slides-token-io.mjs"
//
// WHAT THIS PROVES
//   1. The mapping table, both ways: color → color (hex with alpha), number and
//      fontSize → dimension "16px", opacity → number, fontFamily, shadow
//      (offsetX/offsetY/blur/spread 0/color); and back, including the Tokens
//      Studio / Penpot type names, DTCG 2025 colour and dimension objects, and
//      the refusals (rem, several shadow layers, inset, spread, expressions).
//   2. Export, then import into an empty deck, reproduces theme.tokens: names,
//      types and values per mode — the starter deck's 18 tokens, and a deck
//      built to trip the shape (modes named "theme" and "$x", a token that is
//      also a group, a shadow without offsets, rgba colours). The theme colours
//      come back when asked, and only then.
//   3. The fixtures under scripts/fixtures/tokens/ import with every supported
//      token present and every unsupported one skipped with its reason.
//      penpot-export.tokens.json is written in the shape Penpot's exporter
//      produces (`export-dtcg-json`, default profile: sets, `$themes`,
//      `$metadata`, string values, its type names); figma-Brand.Light.tokens.json
//      in the shape Figma's published variables-import-export sample writes
//      (one file per collection and mode, `/` groups, color/number, aliases).
//      Both were authored from those exporters' source, not captured from a
//      running app.
//   4. Aliases import as resolved literals and the plan counts them.
//   5. A hostile file — url() colours, `__proto__` and `constructor` names,
//      10,000 tokens, a non-finite number, a CSS break-out, 100 levels of
//      nesting, 40 modes, an alias loop, more than 1 MB — writes nothing
//      harmful, says why for each, and leaves Object.prototype alone.
//   6. Nothing unticked changes, no type changes, no binding is touched.
//   7. The export carries no document content, no collab, no asset data.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportTokens, fromDtcg, tokenLeaf, isRefusal } from '../slides/src/tokenio.ts'
import { applyImport, planImport, type ImportPlan } from '../slides/src/tokenimport.ts'
import { newDoc, type BentoDoc } from '../slides/src/model.ts'
import { starterDoc } from '../slides/src/starterdeck.ts'
import { paletteOf } from '../slides/src/palette.ts'

let checks = 0
let failures = 0
function ok(cond: unknown, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** names, types and values per mode, key order aside */
const canon = (tk: BentoDoc['theme']['tokens']) => tk && Object.keys(tk.set).sort().map((n) => [n, tk.set[n].type, Object.keys(tk.set[n].values).sort().map((m) => [m, tk.set[n].values[m]])])
const fixture = (f: string) => readFileSync(join('scripts/fixtures/tokens', f), 'utf8')
const tickAll = (p: ImportPlan) => new Set(p.rows.filter((r) => r.status === 'new' || r.status === 'changed').map((r) => r.name))
const row = (p: ImportPlan, name: string) => p.rows.find((r) => r.name === name && r.status !== 'skipped')
const skip = (p: ImportPlan, source: string) => p.rows.find((r) => r.status === 'skipped' && r.source.endsWith(source))
const emptyDeck = () => newDoc()

console.log('\n1. the mapping table\n')
ok(eq(tokenLeaf('color', '#ff9e8a'), { $type: 'color', $value: '#ff9e8a' }), 'color → color, a hex as written')
ok(eq(tokenLeaf('color', 'rgba(30,42,58,0.10)'), { $type: 'color', $value: '#1e2a3a1a', $extensions: { 'page.bento': { value: 'rgba(30,42,58,0.10)' } } }), 'rgba() → hex with alpha, the exact value in the extension')
ok(eq(tokenLeaf('number', 16), { $type: 'dimension', $value: '16px' }), 'number → dimension "16px"')
ok(eq(tokenLeaf('fontSize', 13), { $type: 'dimension', $value: '13px', $extensions: { 'page.bento': { type: 'fontSize' } } }), 'fontSize → dimension, the type in the extension')
ok(eq(tokenLeaf('opacity', 0.6), { $type: 'number', $value: 0.6, $extensions: { 'page.bento': { type: 'opacity' } } }), 'opacity → number')
ok(eq(tokenLeaf('fontFamily', "'Fraunces', Georgia, serif"), { $type: 'fontFamily', $value: "'Fraunces', Georgia, serif" }), 'fontFamily → fontFamily')
ok(eq(tokenLeaf('shadow', { x: 0, y: 4, blur: 12, color: '#00000040' }).$value, { offsetX: '0px', offsetY: '4px', blur: '12px', spread: '0px', color: '#00000040' }), 'shadow → offsetX, offsetY, blur, spread 0, color')
ok(fromDtcg('number', { value: 1.5, unit: 'px' }) === 1.5 && fromDtcg('number', '24') === 24 && fromDtcg('number', 8) === 8, 'a dimension reads from {value, unit}, "24" and 8')
ok(isRefusal(fromDtcg('number', '1.5rem')) && (fromDtcg('number', '1.5rem') as { detail: string }).detail === 'rem', 'rem is refused, naming the unit')
ok(fromDtcg('opacity', '40%') === 0.4 && fromDtcg('opacity', '0.6') === 0.6, 'opacity reads "40%" and "0.6"')
ok(fromDtcg('color', { colorSpace: 'srgb', components: [1, 0.5, 0], alpha: 0.5 }) === 'rgba(255, 128, 0, 0.5)', 'a DTCG 2025 srgb colour object reads as rgba()')
ok(fromDtcg('color', { colorSpace: 'oklch', components: [0.6, 0.2, 29], hex: '#ff0000' }) === '#ff0000', '…another colour space reads its hex fallback')
ok(isRefusal(fromDtcg('color', { colorSpace: 'oklch', components: [0.6, 0.2, 29] })), '…and without one is refused')
ok(fromDtcg('fontFamily', ['Instrument Sans', 'sans-serif']) === "'Instrument Sans', sans-serif", 'a family list joins, quoting names with spaces')
ok((fromDtcg('shadow', [{ offsetX: '0', offsetY: '2px', blur: '4px', spread: '0', color: '#0000001A' }]) as { y: number }).y === 2, 'a one-layer shadow list reads')
ok(['layers', 'inset', 'spread', 'expression'].every((e, i) => (fromDtcg(i === 3 ? 'number' : 'shadow', [
  [{ blur: '1px' }, { blur: '2px' }], [{ blur: '1px', inset: true }], [{ blur: '1px', spread: '2px' }], '{a} * 2'][i]) as { error?: string }).error === e),
'several layers, inset, spread and expressions are refused, each by name')

console.log('\n2. export, then import into an empty deck\n')
{
  const deck = starterDoc()
  const file = JSON.stringify(exportTokens(deck, '9.9.9'))
  const into = emptyDeck()
  const plan = planImport(into, file)
  ok(!plan.error && plan.setsLike && plan.eachSetIsMode, `a Bento export reads as modes (${plan.modes.join(', ')})`)
  ok(plan.rows.every((r) => r.status === 'new'), `every row is new in an empty deck (${plan.rows.length} rows)`)
  applyImport(into, plan, tickAll(plan))
  ok(eq(canon(into.theme.tokens), canon(deck.theme.tokens)), `the starter deck's ${Object.keys(deck.theme.tokens!.set).length} tokens come back exactly`)
  ok(eq(Object.keys(into.theme.tokens!), Object.keys(deck.theme.tokens!)), 'a one-mode deck gains no modes key')
  ok(into.theme.background !== deck.theme.background || into.theme.accent !== deck.theme.accent, 'the theme colours stay put unless asked')
  const both = emptyDeck()
  applyImport(both, planImport(both, file), tickAll(planImport(both, file)), true)
  ok(eq(paletteOf(both), paletteOf(deck)), 'asked, the theme colours come back too (all twelve slots)')
}
{
  const deck = emptyDeck()
  deck.title = 'Odd shapes'
  deck.theme.tokens = {
    modes: ['default', 'theme', '$x'], mode: 'theme',
    set: {
      radius: { type: 'number', values: { default: 4, theme: 5, $x: 6 } },
      'radius.md': { type: 'number', values: { default: 8, theme: 9 } },
      'color.ink': { type: 'color', values: { default: 'rgba(0, 0, 0, 0.5)', theme: '#ABCDEF', $x: 'white' } },
      'shadow.soft': { type: 'shadow', values: { default: { blur: 6, color: 'rgba(0,0,0,0.2)' }, theme: { x: -2, y: 3, blur: 0, color: '#000' } } },
      'type.kicker': { type: 'fontSize', values: { default: 13.5 } },
      'opacity.dim': { type: 'opacity', values: { default: 0, theme: 1 } },
      'font.ui': { type: 'fontFamily', values: { default: "'Segoe UI', sans-serif" } },
    },
  }
  deck.theme.palette = { accent3: '#123456', hlink: '#0000ee' }
  const out = exportTokens(deck, '9.9.9')
  ok(typeof out.$description === 'string' && (out.$description as string).includes('Odd shapes') && (out.$description as string).includes('9.9.9'), 'the root $description names the deck and the version')
  ok(Object.keys(out).includes('mode-theme') && Object.keys(out).includes('mode-x') && 'theme' in out, 'modes named "theme" and "$x" do not collide with the theme group or a $ key')
  const r = (out.default as { radius: Record<string, unknown> }).radius
  ok(r.$root && r.md, 'a token that is also a group is the group\'s $root')
  const into = emptyDeck()
  const plan = planImport(into, JSON.stringify(out))
  applyImport(into, plan, tickAll(plan), true)
  ok(eq(canon(into.theme.tokens), canon(deck.theme.tokens)), 'the odd deck\'s tokens come back exactly, per mode')
  ok(eq(into.theme.tokens!.modes, deck.theme.tokens.modes), `its modes come back in order (${into.theme.tokens!.modes})`)
  ok(into.theme.palette?.accent3 === '#123456' && into.theme.palette?.hlink === '#0000ee', 'the optional theme slots come back')
  // a hand edit to $value wins over the extension's exact value
  const edited = JSON.parse(JSON.stringify(out))
  edited.default.color.ink.$value = '#ff0000'
  const e2 = emptyDeck()
  const p2 = planImport(e2, JSON.stringify(edited))
  ok(row(p2, 'color.ink')?.values.default === '#ff0000', 'a value edited in the file wins over the extension it no longer agrees with')
}

console.log('\n3. the fixtures\n')
{
  const deck = emptyDeck()
  const plan = planImport(deck, fixture('penpot-export.tokens.json'))
  ok(!plan.error && plan.setsLike && !plan.eachSetIsMode, 'Penpot: sets are offered as modes, off by default (core + light + dark are layers, not modes)')
  const want: Record<string, [string, unknown]> = {
    'colors.blue.500': ['color', '#2f6fed'], 'colors.gray.50': ['color', '#f9fafb'], 'colors.gray.900': ['color', '#101828'],
    'colors.black-alpha': ['color', '#0000001a'], 'dimension.scale': ['number', 2], 'dimension.xs': ['number', 4],
    'spacing.md': ['number', 16], 'sizing.icon': ['number', 24], 'borderRadius.md': ['number', 12], 'borderWidth.thin': ['number', 1],
    'fontSizes.body': ['fontSize', 16], 'fontFamilies.body': ['fontFamily', 'Inter, sans-serif'],
    'fontFamilies.display': ['fontFamily', 'Fraunces, Georgia, serif'], 'letterSpacing.wide': ['number', 0.5],
    'opacity.muted': ['opacity', 0.6], 'opacity.disabled': ['opacity', 0.4],
    'shadow.card': ['shadow', { x: 0, y: 4, blur: 12, color: '#0000001a' }], 'number.line-height': ['number', 1.5],
    'button.primary.background': ['color', '#2f6fed'], 'theme.bg': ['color', '#101828'], 'theme.fg': ['color', '#f9fafb'],
  }
  const missing = Object.entries(want).filter(([n, [type, v]]) => { const r = row(plan, n); return !r || r.type !== type || !eq(r.values.default, v) })
  ok(!missing.length, `Penpot: all ${Object.keys(want).length} supported tokens present with their values${missing.length ? ` — wrong: ${missing.map(([n]) => n).join(', ')}` : ''}`)
  const skips: Record<string, string> = {
    'spacing.sm': 'expression', 'fontSizes.title': 'unit', 'fontWeights.bold': 'type', 'shadow.stack': 'layers',
    'shadow.inner': 'inset', 'typography.body': 'type', 'textCase.upper': 'type', 'rotation.tilt': 'type',
  }
  const wrong = Object.entries(skips).filter(([s, why]) => skip(plan, s)?.reason !== why)
  ok(!wrong.length, `Penpot: all ${Object.keys(skips).length} unsupported tokens skipped with their reason${wrong.length ? ` — wrong: ${wrong.map(([s]) => `${s}=${skip(plan, s)?.reason}`).join(', ')}` : ''}`)
  ok(skip(plan, 'fontWeights.bold')?.detail === 'fontWeights' && skip(plan, 'fontSizes.title')?.detail === 'rem', '…naming the type or unit')
  ok(plan.rows.length === Object.keys(want).length + Object.keys(skips).length, `Penpot: nothing dropped silently (${plan.rows.length} rows)`)
  ok(plan.aliases === 5, `Penpot: aliases resolved and counted (${plan.aliases}: the button and light/dark theme.bg/fg)`)
  const modes = planImport(deck, fixture('penpot-export.tokens.json'), { eachSetIsMode: true })
  ok(eq(modes.modes, ['core', 'light', 'dark']) && eq(row(modes, 'theme.bg')?.values, { light: '#f9fafb', dark: '#101828' }), 'Penpot, each set a mode: core, light, dark, theme.bg per mode')
  applyImport(deck, modes, tickAll(modes))
  ok(eq(deck.theme.tokens?.modes, ['core', 'light', 'dark']), 'applied, an empty deck takes the file\'s modes')
}
{
  const deck = emptyDeck()
  const plan = planImport(deck, fixture('figma-Brand.Light.tokens.json'))
  ok(!plan.error && !plan.setsLike, 'Figma: one file per mode, its top-level groups are part of the names')
  const want: Record<string, [string, unknown]> = {
    'primitives.blue.500': ['color', '#2f6fed'], 'primitives.blue.700': ['color', '#1d4fb8'], 'primitives.gray.900': ['color', '#101828'],
    'primitives.gray.50': ['color', '#f9fafb'], 'color.background': ['color', '#f9fafb'], 'color.text': ['color', '#101828'],
    'color.accent': ['color', '#2f6fed'], 'color.overlay': ['color', 'rgba(16, 24, 40, 0.4800)'], 'color.brand-2': ['color', '#ff9e8a'],
    'space.xs': ['number', 4], 'space.sm': ['number', 8], 'space.md': ['number', 16], 'space.lg': ['number', 24],
    'radius.md': ['number', 12], 'radius.card': ['number', 12], 'opacity.muted': ['number', 0.6],
  }
  const missing = Object.entries(want).filter(([n, [type, v]]) => { const r = row(plan, n); return !r || r.type !== type || !eq(r.values.default, v) })
  ok(!missing.length, `Figma: all ${Object.keys(want).length} tokens present (a space in a name sanitised)${missing.length ? ` — wrong: ${missing.map(([n]) => n).join(', ')}` : ''}`)
  ok(plan.rows.length === Object.keys(want).length, 'Figma: nothing skipped, nothing extra (its exporter writes colour and number only)')
  ok(plan.aliases === 4, `Figma: 4 aliases resolved (${plan.aliases})`)
}

console.log('\n4. a hostile file\n')
{
  const deck = starterDoc()
  const before = JSON.stringify(deck.theme)
  const hostile = {
    a: {
      evil: { $type: 'color', $value: 'url(https://evil.example/x.svg#f)' },
      local: { $type: 'color', $value: 'url(#glow)' },
      breakout: { $type: 'color', $value: 'red; background: url(https://evil.example/y)' },
      expr: { $type: 'color', $value: 'expression(alert(1))' },
      huge: { $type: 'number', $value: 1e999 },
      big: { $type: 'dimension', $value: '9999999px' },
      font: { $type: 'fontFamily', $value: 'x} body { background: red' },
      shadowUrl: { $type: 'shadow', $value: { offsetX: '0', offsetY: '0', blur: '1px', color: 'red) url(https://evil.example/f.svg#f' } },
      loop1: { $type: 'color', $value: '{a.loop2}' }, loop2: { $type: 'color', $value: '{a.loop1}' },
      dangling: { $type: 'color', $value: '{nowhere.at.all}' },
    },
    ['__proto__']: { polluted: { $type: 'color', $value: '#ff0000' } },
    constructor: { $type: 'color', $value: '#00ff00' },
    theme: { background: { $type: 'color', $value: 'url(https://evil.example/bg.png)' }, text: { $type: 'color', $value: '#000' } },
  }
  // a computed __proto__ key is an own key, and JSON.parse keeps it one; 1e999
  // is spliced in as text (JSON.stringify writes Infinity as null) and parses to Infinity
  const text = JSON.stringify(hostile).replace('"huge":{"$type":"number","$value":null}', '"huge":{"$type":"number","$value":1e999}')
  ok(text.includes('"__proto__"'), 'the hostile file really carries a __proto__ key')
  const plan = planImport(deck, text)
  const reasons = Object.fromEntries(plan.rows.filter((r) => r.status === 'skipped').map((r) => [r.source, r.reason]))
  ok(reasons['a.evil'] === 'value' || reasons['a.evil'] === 'unsafe', `a url() colour is refused (${reasons['a.evil']})`)
  ok(reasons['a.local'] === 'value', 'a url(#local) paint is not a colour token either')
  ok(text.includes('1e999') && ['a.breakout', 'a.expr', 'a.shadowUrl', 'a.huge', 'a.big'].every((s) => reasons[s] === 'unsafe'), 'a CSS break-out, expression(), a shadow colour with url(), 1e999 and 9,999,999px meet the deck\'s gate and are refused')
  ok(reasons['a.font'] === 'expression', 'a font stack with braces is refused before it gets that far')
  ok(reasons['a.loop1'] === 'loop' && reasons['a.dangling'] === 'alias', 'an alias loop and a dangling alias say so')
  ok(reasons['__proto__.polluted'] === 'proto' && reasons.constructor === 'proto', '__proto__ and constructor as names are refused, each reported')
  ok(plan.theme.length === 1 && plan.theme[0].slot === 'tx1' && reasons['theme / background'] === 'value', 'a url() theme background is refused; the honest text colour is offered')
  applyImport(deck, plan, new Set(plan.rows.map((r) => r.name)), true)
  const after = JSON.stringify(deck.theme)
  ok(!/url\(|expression|evil|polluted|Infinity|null/.test(after), 'applied with everything ticked, nothing harmful reached the deck')
  const undo = JSON.parse(after)
  undo.color = JSON.parse(before).color
  ok(deck.theme.color === '#000' && JSON.stringify(undo) === before, '…the honest text colour is the only change')
  ok(!('polluted' in ({} as object)) && !Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), 'Object.prototype is untouched')

  const many: Record<string, unknown> = {}
  for (let i = 0; i < 10000; i++) many[`t${i}`] = { $type: 'color', $value: '#123456' }
  const big = planImport(emptyDeck(), JSON.stringify({ brand: many }))
  ok(big.rows.length === 500 && big.overLimit === 9500, `10,000 tokens: 500 offered, ${big.overLimit} counted over the limit`)
  const full = starterDoc()
  const room = 500 - Object.keys(full.theme.tokens!.set).length
  const capped = planImport(full, JSON.stringify({ brand: many }))
  ok(capped.rows.filter((r) => r.status === 'new').length === room, `…into a deck that has tokens, only the room left (${room})`)
  const d10k = emptyDeck()
  applyImport(d10k, big, tickAll(big))
  ok(Object.keys(d10k.theme.tokens!.set).length === 500, 'applied, the deck holds 500 tokens')

  let deep: Record<string, unknown> = { $type: 'color', $value: '#000' }
  for (let i = 0; i < 100; i++) deep = { [`g${i}`]: deep }
  const dp = planImport(emptyDeck(), JSON.stringify(deep))
  ok(dp.rows.length === 1 && dp.rows[0].reason === 'depth', '100 levels of nesting stop at 32, reported')

  const modes: Record<string, unknown> = { $extensions: { 'page.bento': { modes: {} as Record<string, string> } } }
  for (let i = 0; i < 40; i++) { modes[`m${i}`] = { c: { $type: 'color', $value: '#000' } }; ((modes.$extensions as any)['page.bento'].modes)[`m${i}`] = `m${i}` }
  const mp = planImport(emptyDeck(), JSON.stringify(modes))
  ok(mp.modes.length === 16 && mp.rows.filter((r) => r.reason === 'modes').length === 24, `40 modes: 16 kept, 24 reported (${mp.modes.length})`)
  ok(planImport(emptyDeck(), ' '.repeat(1_000_001)).error === 'size', 'more than 1 MB is refused before it is parsed')
  ok(planImport(emptyDeck(), '{"a": ').error === 'json' && planImport(emptyDeck(), '[1,2]').error === 'json', 'not JSON, or not an object, is refused')
  ok(planImport(emptyDeck(), '{"$description": "nothing"}').error === 'empty', 'a file with no tokens says so')
}

console.log('\n5. nothing unticked changes; no binding is touched\n')
{
  const deck = starterDoc()
  const refs = JSON.stringify(deck.slides.map((s) => s.elements.map((e) => (e as { themeRefs?: unknown }).themeRefs)))
  const before = JSON.stringify(deck.theme.tokens)
  const file = { radius: { md: { $type: 'dimension', $value: '99px' }, brandnew: { $type: 'dimension', $value: '3px' } }, space: { gap: { $type: 'color', $value: '#ff0000' } } }
  const plan = planImport(deck, JSON.stringify(file))
  ok(row(plan, 'radius.md')?.status === 'changed' && eq(row(plan, 'radius.md')?.old, { default: 14 }), 'an existing token with a new value is "changed", old → new')
  ok(skip(plan, 'space.gap')?.reason === 'kind' && skip(plan, 'space.gap')?.detail === 'number', 'a token that would change type is skipped, naming its type')
  applyImport(deck, plan, new Set())
  ok(JSON.stringify(deck.theme.tokens) === before, 'nothing ticked: the token set is byte for byte the same')
  applyImport(deck, plan, new Set(['radius.brandnew']))
  ok(deck.theme.tokens!.set['radius.md'].values.default === 14 && deck.theme.tokens!.set['radius.brandnew'].values.default === 3, 'only the ticked row is written; the unticked changed one keeps its value')
  ok(JSON.stringify(deck.slides.map((s) => s.elements.map((e) => (e as { themeRefs?: unknown }).themeRefs))) === refs, 'no binding was added, removed or moved')
  const unchanged = planImport(deck, JSON.stringify({ radius: { md: { $type: 'dimension', $value: '14px' } } }))
  ok(row(unchanged, 'radius.md')?.status === 'unchanged', 'the same value is "unchanged"')
}

console.log('\n6. the export carries no content\n')
{
  const deck = starterDoc() as BentoDoc & Record<string, unknown>
  deck.collab = { room: 'ROOM-ID', key: 'ROOM-KEY', on: true, ownerPriv: 'OWNER-PRIV', writerPriv: 'WRITER-PRIV' } as never
  deck.assets = { a1: 'data:image/png;base64,ASSET-BYTES' } as never
  deck.slides[0].notes = 'SPEAKER-NOTES'
  const out = JSON.stringify(exportTokens(deck, '1'))
  const leaks = ['ROOM-ID', 'ROOM-KEY', 'OWNER-PRIV', 'WRITER-PRIV', 'ASSET-BYTES', 'SPEAKER-NOTES', deck.docId, '"slides"', '"elements"']
    .filter((n) => out.includes(n as string))
  ok(!leaks.length, `no collab, asset, slide or docId in the export${leaks.length ? ` — leaked: ${leaks}` : ''}`)
  ok(eq(Object.keys(JSON.parse(out)), ['$description', '$extensions', 'default', 'theme']), 'its top level is the description, the mode map, the modes and the theme')
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
