#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The bento-slides skill package: its shape, and what it says, against the code.
//
//   slides/node_modules/.bin/esbuild scripts/test-skill-package.ts --bundle --platform=node --format=esm --outfile=/tmp/skill.mjs && node /tmp/skill.mjs
//
// Run from the repo root (the bundle lives elsewhere, so the root is the cwd).
//
// WHAT THIS PROVES. plugins/bento-slides/skills/bento-slides/ is what an agent
// reads before it touches a deck, often with nothing else in context. So:
//
//   SHAPE. The front matter fits the skill's front-matter limits (name =
//   directory, a third-person description under 1,024 characters naming the
//   triggers); the body
//   is under 500 lines and its first 5,000 tokens hold the file contract, the
//   precedence protocol and the workflow; nothing in SKILL.md asks for a
//   network fetch; every reference is indexed with a "read when" line, every
//   relative path resolves, and no reference points at another; the five
//   gotchas live in SKILL.md; design guidance is phrased as defaults (no
//   "always"/"never" or shouted words outside the file contract); and the
//   escape rule names the exact sequence the save path writes.
//
//   KNOWN GAP, NOT CHECKED HERE. scripts/release.mjs still publishes SKILL.md
//   alone and zips bento-slides/SKILL.md only, so the skill zip and the
//   raw-file install lack references/. That file is the maintainer's at
//   release time; SKILL.md says what an install without references still has.
//
//   FACTS. Every set the skill lists is the set the code has: bindable keys,
//   token types, palette slots and their fallbacks, frame layout keys and
//   values, the keys a component copy keeps, transitions, entrances and their
//   default durations, chart presets and the option keys charts-lite reads,
//   code languages and palette scopes, table style keys, the built-in layouts
//   with their roles and aliases, the element keys in the essentials table,
//   the chart formatters charts-lite actually substitutes, and every validator
//   code the skill names.
//
//   BEHAVIOUR. Each gotcha is run through the real derive pass the app runs
//   when a file opens and after loadDoc (derive.ts): a token-bound literal that
//   differs from its token, a token edit and a mode switch made in the JSON
//   alone all unbind; a palette-slot literal is rewritten to the slot; a copy
//   without `sig` keeps its differences as overrides; frame children order by
//   coordinate, then array order; a dangling parentId goes without a finding;
//   bar data that is not a number draws as 0; a compact document in the file
//   block is refused or loses its placed elements; a built-in layout brings
//   its own look.
//
//   SCRIPTS AND EXAMPLES. The two scripts in references/editing.md are
//   extracted and run on a deck carrying fixture collab keys, a picture and a
//   formula: inspect prints no key, splice round-trips the block exactly as the
//   contract says. Every complete JSON example in the skill loads through the
//   real loader with nothing dropped and no error finding.

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { parseDoc, builtinLayouts, newDoc, readableInk, FONT_STACK } from '../slides/src/model.ts'
import { MODEL_KEYS } from '../slides/src/modelkeys.generated.ts'
import { expandDocWithStats, layoutRoles, LAYOUT_ALIASES } from '../slides/src/compact.ts'
import { parseDocInputReport } from '../slides/src/compactload.ts'
import { derive, deriveMemory } from '../slides/src/derive.ts'
import { TOKEN_KEYS, SLIDE_TOKEN_KEYS } from '../slides/src/untrusted.ts'
import { TOKEN_TYPES } from '../slides/src/tokens.ts'
import { PALETTE_SLOTS, paletteOf } from '../slides/src/palette.ts'
import { starterDoc } from '../slides/src/starterdeck.ts'
import { CHART_PRESETS } from '../kernel/src/charts.ts'
import { LANGS } from '../kernel/src/tokenize.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const same = (a: Iterable<string>, b: Iterable<string>) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join()
const show = (s: Iterable<string>) => [...s].sort().join(', ')
const everythingJson = () => [skillRaw, ...Object.values(refs)].join('\n').match(/```json\n[\s\S]*?```/g)?.join('\n') ?? ''
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1])

const DIR = 'plugins/bento-slides/skills/bento-slides'
const files = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`
  return statSync(join(root, rel)).isDirectory() ? files(rel) : [rel]
})
const all = files(DIR)
const skillRaw = read(`${DIR}/SKILL.md`)
const refFiles = all.filter((f) => f.startsWith(`${DIR}/references/`) && f.endsWith('.md'))
const refs = Object.fromEntries(refFiles.map((f) => [basename(f), read(f)]))
const ref = (f: string): string => refs[f] ?? ''
const fm = /^---\n([\s\S]*?)\n---\n/.exec(skillRaw)
const body = fm ? skillRaw.slice(fm[0].length) : skillRaw

/** The text from a heading to the next heading of the same or a higher level. */
function section(text: string, heading: RegExp): string {
  const m = heading.exec(text)
  if (!m) return ''
  const level = /^#+/.exec(m[0])![0].length
  const rest = text.slice(m.index + m[0].length)
  const e = new RegExp(`^#{1,${level}} `, 'm').exec(rest)
  return m[0] + (e ? rest.slice(0, e.index) : rest)
}
/** A markdown table's rows, as arrays of cells (header and rule dropped). */
function tableRows(text: string): string[][] {
  return text.split('\n').filter((l) => /^\|/.test(l)).slice(2).map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
}

// ---- shape -------------------------------------------------------------------
console.log('the package\n')
ok(!!fm, 'SKILL.md opens with YAML front matter')
const yaml = fm?.[1] ?? ''
const name = /^name:\s*(\S+)\s*$/m.exec(yaml)?.[1] ?? ''
const descM = /^description:\s*>-?\n((?:[ \t]+.*\n?)+)/m.exec(yaml + '\n') ?? /^description:\s*(.+)$/m.exec(yaml)
const description = flat(descM?.[1] ?? '').trim()
ok(name === basename(DIR), `name "${name}" equals the directory "${basename(DIR)}"`)
ok(/^[a-z0-9-]{1,64}$/.test(name), 'name is lowercase letters, digits and hyphens, 64 characters at most')
ok(description.length > 0 && description.length <= 1024, `description is ${description.length} characters (at most 1,024)`)
ok(!/\b(I|I'm|my|we)\b/.test(description) && !/^(Use|Create|Make|Help)\b/.test(description), 'description is written in the third person')
for (const trigger of ['.bento.html', 'deck', 'slides', 'presentation']) ok(description.includes(trigger), `description names the trigger "${trigger}"`)
const whenToUse = /^when_to_use:\s*(.+)$/m.exec(yaml)?.[1] ?? ''
ok(description.length + whenToUse.length <= 1536, 'description plus when_to_use fit the 1,536 characters the skill loader keeps')
const bodyLines = body.split('\n').length
ok(bodyLines < 500, `SKILL.md body is ${bodyLines} lines (under 500)`)
const s1 = section(body, /^## 1\. The file contract$/m)
const s2 = section(body, /^## 2\. Precedence: the deck's design system wins$/m)
const s3 = section(body, /^## 3\. Workflow$/m)
ok(!!s1 && !!s2 && !!s3, 'SKILL.md has the file contract, the precedence protocol and the workflow as sections 1 to 3')
const upToWorkflowEnd = skillRaw.slice(0, skillRaw.indexOf(s3) + s3.length)
// a conservative estimate: English prose with markup runs nearer 4 characters a token
const estTokens = Math.ceil(upToWorkflowEnd.length / 3.5)
ok(estTokens <= 5000, `the front matter and sections 1 to 3 come to about ${estTokens} tokens (at most 5,000, re-attached after compaction)`)
const net = /\bcurl\b|\bwget\b|\biwr\b|Invoke-WebRequest|\bfetch\s*\(|bento\.page\/agents\.md|https?:\/\//
ok(!net.test(skillRaw), `SKILL.md carries no fetch instruction or URL${net.exec(skillRaw) ? ` (found "${net.exec(skillRaw)![0]}")` : ''}`)
ok(/only step that touches\s+the network/.test(s1), 'SKILL.md says fetching the app is the only step that touches the network')
const ESC = '\\u003c' // the six characters backslash, u, 0, 0, 3, c
ok(/'\\\\u003c'/.test(read('kernel/src/save.ts')) || read('kernel/src/save.ts').includes("replace(/</g, '\\\\u003c')"), 'kernel save.ts writes every < as \\u003c')
ok(s1.includes('Escape every `<` in the JSON as `' + ESC + '`'), 'SKILL.md\'s escape rule names the exact sequence \\u003c')

console.log('\nthe reference index\n')
const index = section(body, /^## 7\. References$/m)
const indexed = [...index.matchAll(/^- `references\/([a-z0-9-]+\.md)`:([^\n]*(?:\n {2}[^\n]*)*)/gm)].map((m) => ({ file: m[1], line: flat(m[2]) }))
ok(indexed.length >= 5, `the index lists ${indexed.length} references`)
ok(same(indexed.map((i) => i.file), Object.keys(refs)), `the index lists exactly the files in references/ (index: ${show(indexed.map((i) => i.file))}; folder: ${show(Object.keys(refs))})`)
for (const i of indexed) ok(/\bread when\b/i.test(i.line), `references/${i.file} has a "read when" line`)
const paths = [...body.matchAll(/`((?:references|scripts|assets)\/[^`\s]+)`/g)].map((m) => m[1])
for (const p of new Set(paths)) ok(existsSync(join(root, DIR, p)), `SKILL.md's path ${p} resolves`)
const mdLinks = [...skillRaw.matchAll(/\]\(([^)]+)\)/g), ...Object.values(refs).flatMap((t) => [...t.matchAll(/\]\(([^)]+)\)/g)])].map((m) => m[1])
ok(mdLinks.every((l) => /^https?:/.test(l) || existsSync(join(root, DIR, l))), 'every relative markdown link resolves')
const tableRefs = [...section(body, /^## 4\. Material to feature$/m).matchAll(/`([a-z-]+\.md)`/g)].map((m) => m[1])
ok(tableRefs.length > 0 && tableRefs.every((f) => f in refs), `the material table's reference names exist (${show(new Set(tableRefs))})`)
for (const [f, t] of Object.entries(refs)) {
  const others = Object.keys(refs).filter((o) => o !== f && t.includes(o))
  ok(!others.length && !/references\//.test(t), `references/${f} points at no other reference${others.length ? ` (names ${others.join(', ')})` : ''}`)
  ok(/Read this when/.test(t.split('\n').slice(0, 8).join('\n')), `references/${f} opens with when to read it`)
}

console.log('\nthe five gotchas live in SKILL.md\n')
const gotchas = section(body, /^## 5\. Gotchas$/m)
const GOTCHAS = [
  'A token-bound literal that differs from its token loses the binding.',
  'A component copy without `sig` turns every difference into an override.',
  'Frame children order by coordinate, then by array order.',
  'A dangling `parentId` is removed silently.',
  'Chart series data must be plain numbers.',
]
for (const g of GOTCHAS) {
  ok(gotchas.includes(`**${g}**`), `SKILL.md gotcha: "${g}"`)
  ok(Object.values(refs).every((t) => !t.includes(g)), `   …and it is not moved into a reference`)
}

console.log('\ndesign guidance is phrased as defaults\n')
const DEFAULTS_OPENING = "These never override the deck's own choices or the user's words."
ok(ref('design-defaults.md').split('\n')[2] === DEFAULTS_OPENING, 'design-defaults.md opens with the precedence sentence')
// the words an emphatic rule uses, and the acronyms that are not shouting
const ACRONYMS = new Set(['JSON', 'HTML', 'SVG', 'CSS', 'PNG', 'URL', 'PDF', 'API', 'DOM', 'HSL', 'ECMA', 'MB', 'KB', 'GIF', 'JPEG', 'WOFF2', 'URI'])
const emphatic = (text: string): string[] => [
  ...[...text.matchAll(/\b(always|never)\b/gi)].map((m) => m[0]),
  ...[...text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').matchAll(/\b[A-Z][A-Z0-9]{2,}\b/g)].map((m) => m[0]).filter((w) => !ACRONYMS.has(w)),
]
const outsideContract = body.replace(s1, '')
ok(emphatic(outsideContract).length === 0, `SKILL.md outside the file contract has no "always", "never" or shouted word (found: ${emphatic(outsideContract).join(', ') || 'none'})`)
for (const [f, t] of Object.entries(refs)) {
  if (f === 'editing.md') continue // the file contract's own reference
  const words = emphatic(t.replace(DEFAULTS_OPENING, '').replace(/```[\s\S]*?```/g, ''))
  ok(words.length === 0, `references/${f} has no "always", "never" or shouted word (found: ${words.join(', ') || 'none'})`)
}
const defaultsBullets = [...ref('design-defaults.md').matchAll(/^- \*\*[^*]+\*\*([\s\S]*?)(?=^- |^## |$(?![\s\S]))/gm)].map((m) => flat(m[1]))
ok(defaultsBullets.length >= 8, `design-defaults.md has ${defaultsBullets.length} defaults`)
for (const b of defaultsBullets) {
  ok(/\b(if|when|where|on a|for a|fresh deck|inside)\b/i.test(b) && /\b(because|so|which|reads?|makes?|keeps?|is (what|usually|a natural)|rarely|costs?)\b/i.test(b),
    `default states when it applies and why: "${b.slice(0, 60)}…"`)
}

// ---- facts against the code ----------------------------------------------------
console.log('\nsets the skill lists, against the code\n')
const ds = ref('design-system.md')
const bindable = ticks(section(ds, /^## Bindings/m).split('An element property can be bound when its name is one of')[1]?.split('On a slide')[0] ?? '')
ok(same(bindable, TOKEN_KEYS), `design-system.md lists exactly the bindable element keys (${bindable.length}; code ${TOKEN_KEYS.size})`)
ok(same(['background'], SLIDE_TOKEN_KEYS), 'on a slide only `background` binds')
const tokenTypes = ticks(/The types are ([\s\S]*?`shadow`)/.exec(ds)?.[1] ?? '').filter((t) => /^[a-zA-Z]+$/.test(t))
ok(same(tokenTypes, TOKEN_TYPES), `design-system.md lists exactly the token types (${show(tokenTypes)})`)
const slotRows = tableRows(section(ds, /^## Palette slots/m))
const slotNames = slotRows.flatMap((r) => ticks(r[0]))
ok(same(slotNames, PALETTE_SLOTS), `the palette table lists exactly the slots (${show(slotNames)})`)
const probe = { theme: { background: '#000001', color: '#000002', accent: '#000003', fontFamily: 'x' } } as never
const pal = paletteOf(probe) as unknown as Record<string, string | undefined>
const fallbackOf: Record<string, string | undefined> = { '`theme.color`': '#000002', '`theme.background`': '#000001', '`theme.accent`': '#000003' }
for (const r of slotRows) {
  for (const slot of ticks(r[0])) {
    const said = r[2]
    if (said.startsWith('empty')) ok(pal[slot] === undefined, `${slot} unset resolves to nothing`)
    else if (said.startsWith("the editor's default")) {
      const field = ({ bg1: 'background', tx1: 'color', accent1: 'accent' } as Record<string, 'background' | 'color' | 'accent'>)[slot]
      ok(!!field && said === `the editor's default, \`${(newDoc().theme as Record<string, string>)[field]}\``, `${slot} unset is the editor's ${field} (${said})`)
      const filled = parseDoc(JSON.stringify({ format: 'bento/slides', theme: {}, slides: [{ elements: [] }] }))
      ok(!!field && filled?.theme[field] === newDoc().theme[field], `   …which parseDoc fills when theme.${field} is absent`)
    }
    else ok(pal[slot] === fallbackOf[said], `${slot} unset falls back to ${said}`)
  }
}
const frameRows = tableRows(section(ds, /^## Auto-layout frames/m))
const frameKeys = frameRows.flatMap((r) => ticks(r[0]))
ok(same(frameKeys, MODEL_KEYS.frameLayout), `the frame table lists exactly the layout keys (${show(frameKeys)})`)
const modelSrc = read('slides/src/model.ts')
const unionOf = (re: RegExp) => [...(re.exec(modelSrc)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
const frameVal = (k: string) => ticks(frameRows.find((r) => r[0] === `\`${k}\``)?.[1] ?? '')
ok(same(frameVal('dir'), unionOf(/dir: ([^\n]+)/)), 'frame `dir` values match FrameLayout')
ok(same(frameVal('justify'), unionOf(/justify\?: ([^\n]+)/)), 'frame `justify` values match FrameLayout')
ok(same(frameVal('align'), unionOf(/align\?: ('start' \| 'center' \| 'end' \| 'stretch')/)), 'frame `align` values match FrameLayout')
const sizingText = section(ds, /^## Auto-layout frames/m)
for (const k of MODEL_KEYS.sizing) ok(sizingText.includes(`\`${k}\``) || sizingText.includes(`"${k}"`), `frame child sizing key ${k} is described`)
const compSrc = read('slides/src/components.ts')
const OWN = [...(/const OWN = new Set\(\[([^\]]+)\]\)/.exec(compSrc)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
const ownSaid = ticks(/A copy takes every property from its main except its own([\s\S]*?), and the keys/.exec(ds)?.[1] ?? '').flatMap((t) => t.split('/'))
ok(same(ownSaid, OWN), `the keys a copy keeps are the components.ts OWN set (skill: ${show(ownSaid)}; code: ${show(OWN)})`)

const mo = ref('motion.md')
const transitions = unionOf(/export type TransitionKind = ([^\n]+)/)
const transSaid = ticks(/A slide's `transition` is ([^.]+)\./.exec(flat(mo))?.[1] ?? '')
ok(same(transSaid, transitions), `motion.md lists exactly the transitions (${show(transSaid)})`)
ok(same(ticks(/`transition` \(([^)]+)\)/.exec(flat(body))?.[1] ?? ''), transitions), 'SKILL.md lists exactly the transitions')
const enters = unionOf(/enter\?: ([^\n]+)/)
const enterSaid = ticks(/`fx\.enter` is one of ([^.]+)\./.exec(flat(mo))?.[1] ?? '')
ok(same(enterSaid, enters), `motion.md lists exactly the entrances (${show(enterSaid)})`)
const presentSrc = read('slides/src/present.ts')
ok(/duration: enterDur \?\? \(sliding \? 0\.75 : 0\.55\)/.test(presentSrc) && /0\.55\s+for `fade-\*`, 0\.75 for `slide-\*`/.test(flat(mo)), 'entrance durations default to 0.55 s (fade) and 0.75 s (slide), as present.ts has them')
ok(/MORPH_DURATION_DEFAULT = 0\.65/.test(presentSrc) && /0\.65 s when absent/.test(mo), 'a morph takes 0.65 s when present.morphSeconds is absent')
ok(/if \(fromEls\.has\(id\)\) continue/.test(presentSrc) && /owns \? \{ opacity: 0 \} : \{ opacity: 0, y: 14 \}/.test(presentSrc), 'present.ts: partnered elements skip their entrance; unpartnered ones without fx.enter fade in with a rise')
const fxSaid = [...mo.matchAll(/`fx\.([a-zA-Z]+)`/g)].map((m) => m[1])
ok(fxSaid.every((k) => (MODEL_KEYS.fx as readonly string[]).includes(k)), `every fx key motion.md names exists (${show(new Set(fxSaid))})`)
const fxCovered = (MODEL_KEYS.fx as readonly string[]).filter((k) => mo.includes(`fx.${k}`) || mo.includes(`"${k}":`) || mo.includes(`{ "${k}"`))
ok(same(fxCovered, MODEL_KEYS.fx), `motion.md covers every fx key (missing: ${(MODEL_KEYS.fx as readonly string[]).filter((k) => !fxCovered.includes(k)).join(', ') || 'none'})`)

const da = ref('data.md')
const presets = ticks(/a `preset` \(([^)]+)\)/.exec(da)?.[1] ?? '')
ok(same(presets, Object.keys(CHART_PRESETS)), `data.md lists exactly the chart presets (${show(presets)})`)
const chartsSrc = read('kernel/src/charts.ts')
const chartRows = Object.fromEntries(tableRows(section(da, /^## Charts/m)).map((r) => [r[0].replace(/`/g, ''), r[1]]))
const keysIn = (row: string | undefined) => ticks((row ?? '').replace(/\(`\w+` is not read\)/g, '')).filter((k) => /^[a-zA-Z.]+$/.test(k))
const digestSrc = /function digest\([\s\S]*?\n\}\n/.exec(chartsSrc)?.[0] ?? ''
const pieSrc = /function renderPie\([\s\S]*?\n\}\n/.exec(chartsSrc)?.[0] ?? ''
ok(digestSrc.length > 500 && pieSrc.length > 200, 'charts.ts digest() and renderPie() read')
for (const [where, row] of Object.entries(chartRows)) {
  for (const k of keysIn(row)) ok(new RegExp(`\\b${k.split('.').pop()}\\b`).test(chartsSrc), `charts-lite reads ${where}: \`${k}\``)
}
const xRow = keysIn(chartRows['xAxis']), yRow = keysIn(chartRows['yAxis (one, or an array of two)'])
ok(same(xRow, ['data', 'axisLabel', 'color', 'fontSize', 'fontWeight', 'axisLine.lineStyle', 'width']), `the xAxis row lists what digest() reads from xAxis (${xRow.join(' ')})`)
ok(/xRaw\?\.data/.test(digestSrc) && /xLabelRaw\?\.fontSize/.test(digestSrc) && /xRaw\?\.axisLine\?\.lineStyle\?\.width/.test(digestSrc) && !/xRaw\?\.(min|max|name|splitLine|type)\b/.test(digestSrc) && !/xLabelRaw\?\.formatter/.test(digestSrc), 'digest() reads xAxis data, axisLabel colour/size/weight and axisLine only')
ok(same(yRow, ['name', 'min', 'max', 'axisLabel', 'color', 'fontSize', 'fontWeight', 'formatter', 'splitLine.lineStyle', 'width']), `the yAxis row lists what digest() reads from yAxis (${yRow.join(' ')})`)
ok(/name: typeof a\?\.name === 'string'/.test(digestSrc) && /min: typeof a\?\.min === 'number'/.test(digestSrc) && /max: typeof a\?\.max === 'number'/.test(digestSrc) && /yRaw\[0\]\?\.splitLine\?\.lineStyle\?\.color/.test(digestSrc) && /yRaw\.slice\(0, 2\)/.test(digestSrc), 'digest() reads yAxis name/min/max/axisLabel on up to two axes, splitLine on the first only')
ok(!/\?\.type\b/.test(digestSrc.replace(/s\?\.type === 'pie'/g, '')) && !xRow.includes('type') && !yRow.includes('type'), 'no axis reads `type`, and the table lists none')
ok(/const color = d\.colors\[i % d\.colors\.length\]/.test(pieSrc) && !/itemStyle\?\.color/.test(pieSrc) && !keysIn(chartRows.pie).includes('itemStyle.color') && /Pie slices take `option\.color` in order/.test(flat(da)), 'pie slices take option.color in order and ignore itemStyle.color, as data.md says')
ok(/const stroke = typeof s\?\.lineStyle\?\.color === 'string' \? s\.lineStyle\.color : d\.colors/.test(chartsSrc) && !keysIn(chartRows.line).includes('itemStyle.color'), 'a line takes its colour from lineStyle.color, not itemStyle.color')
ok(keysIn(chartRows['every series']).join() === 'type,name,data', 'every series: type, name, data (yAxisIndex and colours are per type)')
const vSrc = read('slides/src/validate.ts')
const vChart = /function validateChart[\s\S]*?\n\}\n/.exec(vSrc)?.[0] ?? ''
const levels = [...vChart.matchAll(/CHART_KEYS\.(\w+)/g)].map((m) => m[1])
ok(same(levels, ['top', 'series', 'seriesByType', 'axis', 'legend']), `validateChart checks key names at the top level, series, axes and the legend only (${show(new Set(levels))})`)
ok(/axis: \['type'/.test(vSrc) && /bar: \['barWidth'\]/.test(vSrc) && /legend: \['show'/.test(vSrc) && !/barWidth/.test(chartsSrc) && !/legendRaw\?\.show/.test(chartsSrc), 'it passes axis type, barWidth and legend.show, which charts-lite never reads')
ok(/names an unknown key at the top level, on a series, an axis or the legend only/.test(flat(da)), 'data.md says what chart-key-ignored covers')
ok(/colors: Array\.isArray\(option\?\.color\) && option\.color\.length \? option\.color : PALETTE/.test(chartsSrc), 'charts-lite falls back to its own palette when option.color is absent')
ok((chartsSrc.match(/\.map\(\(v: unknown\) => num\(v, 0\)\)/g) ?? []).length >= 3 && /const num = \(v: unknown, d: number\): number => \(typeof v === 'number' && Number\.isFinite\(v\) \? v : d\)/.test(chartsSrc), 'charts-lite reads bar/line data with num(v, 0): anything but a number draws as 0')
const charts = section(da, /^## Charts/m)
ok(!/tooltip\??\.formatter/.test(chartsSrc) && /tooltipTrigger: option\?\.tooltip \? \(option\.tooltip\.trigger === 'item' \? 'item' : 'axis'\) : null/.test(chartsSrc), 'charts-lite reads a tooltip\'s trigger and never its formatter')
ok(/A tooltip shows the name and value itself; its `formatter` is not read/.test(flat(charts)) && !/"tooltip":\s*\{[^}]*"formatter"/.test(everythingJson()), 'data.md says so, and no example gives a tooltip a formatter')
ok(/cfg\.formatter \? cfg\.formatter\.replace\('\{value\}', fmt\(v\)\)/.test(chartsSrc) && /axisLabel\.formatter`\s+substitutes `\{value\}`/.test(flat(charts)), 'a value axis formatter substitutes {value} only, as data.md says')
ok(/\.replaceAll\('\{b\}', p\.name\)\s*\.replaceAll\('\{c\}', fmt\(p\.value\)\)\s*\.replaceAll\('\{d\}'/.test(chartsSrc) && /a pie `label\.formatter` substitutes `\{b\}`/.test(flat(charts)), 'a pie label formatter substitutes {b} {c} {d}, as data.md says')
const langM = /language id: ([\s\S]*?) and (\d+) more of the usual short\s+ids, plus `diff` and `md`/.exec(da)
const langs = ticks(langM?.[1] ?? '')
ok(langs.length > 5 && langs.every((l) => l in LANGS), `the code languages data.md names are built in (${langs.join(' ')})`)
ok(Number(langM?.[2]) === Object.keys(LANGS).length - langs.length, `"${langM?.[2]} more" is the rest of the ${Object.keys(LANGS).length} built in`)
ok(/langId === 'diff'/.test(read('kernel/src/tokenize.ts')) && /langId === 'md'/.test(read('kernel/src/tokenize.ts')), 'diff and md are built in too')
ok(/const L = LANGS\[langId\] \?\? LANGS\.js/.test(read('kernel/src/tokenize.ts')), 'an unknown language reads as js')
const scopes = [...flat(da).matchAll(/`([a-z])` [a-z]/g)].map((m) => m[1])
ok(same(scopes, MODEL_KEYS.themeCodePalette), `data.md lists exactly the codePalette scopes (${show(scopes)})`)
const styleSaid = ticks(/`style` takes ([^.]+)\./.exec(flat(da))?.[1] ?? '')
ok(same(styleSaid, MODEL_KEYS.tableStyle), `data.md lists exactly the table style keys (${show(styleSaid)})`)
const cellSaid = ticks(/A cell takes ([^.]+)\./.exec(flat(da))?.[1] ?? '').filter((k) => !/ /.test(k))
ok(same(cellSaid, MODEL_KEYS.tableCell), `data.md lists exactly the table cell keys (${show(cellSaid)})`)

console.log('\nbuilt-in layouts and roles\n')
const layoutText = flat(section(ds, /^## Layouts and roles/m))
for (const l of builtinLayouts()) {
  ok(layoutText.includes(`\`${l.id}\``), `design-system.md names ${l.id}`)
  const roles = Object.keys(layoutRoles(l)).filter((r) => r !== 'left' && r !== 'right')
  const said = new RegExp(`\`${l.id}\`(?: and \`[a-z-]+\`)? \\(([^)]*)\\)`).exec(layoutText)?.[1] ?? ''
  if (roles.length) ok(roles.every((r) => new RegExp(`\\b${r}\\b`).test(said)), `  …with its roles ${roles.join(', ')}`)
}
for (const [alias, id] of Object.entries(LAYOUT_ALIASES)) ok(new RegExp(`\`${id}\`[^\`]*\\([^)]*also \`${alias}\``).test(layoutText), `alias ${alias} is named beside ${id}`)

console.log('\nthe essentials table names real keys\n')
const ess = tableRows(section(body, /^## 6\. Element essentials$/m))
ok(same(ess.map((r) => ticks(r[0])[0]), Object.keys(MODEL_KEYS.element).filter((t) => t !== 'embed')), 'the table covers every element type but embed')
for (const r of ess) {
  const type = ticks(r[0])[0] as keyof typeof MODEL_KEYS.element
  const keys = MODEL_KEYS.element[type] as readonly string[]
  const shapeKinds = unionOf(/export type ShapeKind = ([^\n]+)/)
  const named = ticks(r[1]).filter((k) => !k.includes(':') && !shapeKinds.includes(k))
  const bad = named.filter((k) => !keys.includes(k))
  ok(!bad.length, `${type}: every key named is a ${type} key${bad.length ? ` (not: ${bad.join(', ')})` : ''}`)
  if (type === 'shape') ok(same(ticks(r[1]).filter((k) => shapeKinds.includes(k)), shapeKinds), 'shape: every shape kind is listed')
}
const renderSrc = read('slides/src/render.ts')
const TAGS = [...(/const ALLOWED_TAGS = new Set\(\[([\s\S]*?)\]\)/.exec(renderSrc)?.[1] ?? '').matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1].toLowerCase())
const tagsSaid = (/Text `html` keeps `([a-z0-9 ]+)`/.exec(flat(body))?.[1] ?? '').split(' ')
ok(same(tagsSaid, TAGS), `SKILL.md lists exactly the kept text tags (${tagsSaid.length}; code ${TAGS.length})`)

console.log('\nvalidator codes the skill names exist\n')
const validateSrc = read('slides/src/validate.ts')
const CODES = new Set([...validateSrc.matchAll(/code: '([a-z-]+)'/g)].map((m) => m[1]))
const everything = [skillRaw, ...Object.values(refs)].join('\n')
const named = [...new Set([...everything.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]))]
  .filter((c) => CODES.has(c) || /-(overflow|margin|embedded|unknown|key|dash|dangling|malformed|stale|slot|ignored|countup|fx|path|collision|link|parent|asset|connector)$/.test(c))
  .filter((c) => !/^(fade|slide|layout|title|two|three|image|dash|motion|arrow|circle|diamond|triangle|space|font|shadow|size|radius|border|card|stat|row|cta|btn|focus)-/.test(c) || CODES.has(c))
ok(named.length >= 8, `the skill names ${named.length} validator codes`)
for (const c of named) ok(CODES.has(c), `validate.ts emits \`${c}\``)
ok(/const marginBase = opts\.margin \?\? 96/.test(validateSrc), 'validate()\'s margin is 96 unless opts.margin says otherwise (0 disables)')

console.log('\nthe defaults agree with the built-in layouts\n')
const defaults = ref('design-defaults.md')
const cols = tableRows(section(defaults, /^## Canvas and margins/m))
for (const r of cols) {
  const widths = r[1].split('/').map(Number), xs = r[2].split(',').map(Number), gutter = Number(r[3])
  const ws = xs.map((_, i) => widths[Math.min(i, widths.length - 1)])
  const flush = xs.every((x, i) => i === 0 ? x === 96 : x === xs[i - 1] + ws[i - 1] + gutter) && xs[xs.length - 1] + ws[ws.length - 1] === 1184
  ok(flush, `column split "${r[0]}" starts at 96, keeps its gutter and ends at 1184`)
}
ok(208 + 416 === 720 - 96 && 72 + 84 < 208, 'the title band arithmetic holds (208 + 416 = 720 - 96)')
const L = Object.fromEntries(builtinLayouts({ width: 1280, height: 720 }).map((l) => [l.id, l]))
const fs = (id: string, role: string) => (L[id].elements.find((e) => e.role === role) as { fontSize?: number } | undefined)?.fontSize ?? 0
ok(Math.abs(fs('layout-title', 'title') - 60) <= 2 && /about 60 px for a cover title/.test(flat(defaults)), `cover title ${fs('layout-title', 'title')} px is "about 60"`)
ok(Math.round(fs('layout-title-content', 'title')) === 35 && /35 px for a slide title/.test(flat(defaults)), `slide title ${fs('layout-title-content', 'title')} px is 35`)
const bodies = ['layout-title-content', 'layout-two-col', 'layout-image-left'].map((id) => Math.round(fs(id, 'body')))
ok(bodies.every((b) => b >= 19 && b <= 21) && /19 to 21 px for body text/.test(flat(defaults)), `body text ${bodies.join('/')} px is 19 to 21`)
ok(Math.round(fs('layout-section', 'kicker')) === 14 && /14 px for a kicker/.test(flat(defaults)), 'kicker is 14 px')
ok(L['layout-title-content'].elements.every((e) => e.x === 96 && e.x + e.w === 1184), 'the title-and-content layout sits between x 96 and x 1184 at 1280×720')
const base = Object.fromEntries(builtinLayouts().map((l) => [l.id, l]))
const tc = base['layout-title-content'].elements[0]
ok(/const LAYOUT_BASE = \{ width: 1600, height: 900 \}/.test(modelSrc) && tc.x + tc.w + tc.x === 1600, 'the built-in layouts are drawn on a 1600×900 base and scaled to the deck')
ok(/the built-in layouts scale to it/.test(flat(defaults)) && !/drawn for/.test(defaults), 'design-defaults.md says the built-ins scale to 1280×720, not that they are drawn for it')
ok(!/same margin on every side/.test(flat(defaults)), 'design-defaults.md claims no equal margin on every side (the title sits at y 72)')

// ---- behaviour ------------------------------------------------------------------
console.log('\nthe gotchas, through the derive pass the app runs\n')
const mainSrc = read('slides/src/main.ts'), editorSrc = read('slides/src/editor/editor.ts')
ok(/derive\(doc, deriveMemory\(doc\)\)/.test(mainSrc), 'main.ts derives every opened file with fresh memory')
ok(/store\.on\('replace', \(\) => \{ this\.derived = deriveMemory\(store\.doc\); derive\(store\.doc, this\.derived\) \}\)/.test(editorSrc), 'the editor derives a replaced document (loadDoc, Replace from JSON) the same way')
const open = (j: unknown) => { const d = parseDoc(JSON.stringify(j))!; derive(d, deriveMemory(d)); return d }
const T = (id: string, color: string, refs?: Record<string, string>) => ({ id, type: 'text', x: 96, y: 96, w: 400, h: 60, html: id, fontSize: 24, fontWeight: 400, color, align: 'left', valign: 'top', lineHeight: 1.2, rotation: 0, opacity: 1, ...(refs ? { themeRefs: refs } : {}) })
const R = (id: string, fill: string, extra: Record<string, unknown> = {}) => ({ id, type: 'shape', shape: 'rect', x: 96, y: 96, w: 100, h: 50, fill, stroke: 'none', strokeWidth: 0, radius: 0, rotation: 0, opacity: 1, ...extra })
const deck = (accent: string, brand: string, els: unknown[], mode?: string) => ({
  format: 'bento/slides', title: 'g', size: { width: 1280, height: 720 },
  theme: { background: '#FFFFFF', color: '#1E2A3A', accent, fontFamily: 'Georgia, serif', tokens: { modes: ['light', 'dark'], ...(mode ? { mode } : {}), set: {
    ink: { type: 'color', values: { light: '#111111', dark: '#EEEEEE' } }, brand: { type: 'color', values: { light: brand, dark: brand } } } } },
  slides: [{ id: 's', background: '#FFFFFF', transition: 'none', notes: '', elements: els }] })
const el = (d: ReturnType<typeof open>, id: string) => d.slides[0].elements.find((e) => e.id === id) as unknown as Record<string, any>
{
  const els = [T('match', '#111111', { color: '$ink' }), T('differs', '#FF0000', { color: '$ink' }), T('brand', '#FF0000', { color: '$brand' }), R('slot', '#123456', { themeRefs: { fill: 'accent1' } }), R('tint', 'rgba(1,2,3,0.5)', { themeRefs: { fill: 'accent1' } })]
  const d = open(deck('#F7A600', '#FF0000', els))
  ok(el(d, 'match').themeRefs?.color === '$ink', '1. a literal equal to its token keeps the binding')
  ok(!el(d, 'differs').themeRefs && el(d, 'differs').color === '#FF0000', '1. a literal that differs keeps the literal and loses the binding')
  ok(el(d, 'slot').fill.toLowerCase() === '#f7a600' && el(d, 'slot').themeRefs?.fill === 'accent1', '1. a slot-bound literal is rewritten to the slot colour, binding kept')
  ok(/^rgba\(247, 166, 0, 0\.5\)$/.test(el(d, 'tint').fill), `1. …keeping its own opacity (${el(d, 'tint').fill})`)
  const tokenEdit = open(deck('#F7A600', '#00FF00', [T('brand', '#FF0000', { color: '$brand' })]))
  ok(!el(tokenEdit, 'brand').themeRefs && el(tokenEdit, 'brand').color === '#FF0000', '1. a token value changed in the JSON alone unbinds its uses, which keep the old literal')
  const modeSwitch = open(deck('#F7A600', '#FF0000', [T('match', '#111111', { color: '$ink' })], 'dark'))
  ok(!el(modeSwitch, 'match').themeRefs && el(modeSwitch, 'match').color === '#111111', '1. a mode switched in the JSON alone unbinds every use')
  const slotEdit = open(deck('#00FF00', '#FF0000', [R('slot', '#F7A600', { themeRefs: { fill: 'accent1' } })]))
  ok(el(slotEdit, 'slot').fill.toLowerCase() === '#00ff00', '1. a palette slot edited in the JSON recolours its uses')
  const tbl = open(deck('#F7A600', '#FF0000', [{ id: 't', type: 'table', x: 96, y: 96, w: 600, h: 200, rotation: 0, opacity: 1, header: true, columns: [{ w: 1 }], rows: [{ cells: [{ html: 'a' }] }],
    style: { headerBg: '#000000', headerColor: '#FFFFFF', borderColor: '#CCCCCC', borderWidth: 1, cellPadX: 8, cellPadY: 8, fontSize: 18, color: '#000000', radius: 0 }, themeRefs: { 'style.headerBg': 'tx1' } }]))
  ok(el(tbl, 't').style.headerBg.toLowerCase() === '#1e2a3a' && el(tbl, 't').themeRefs?.['style.headerBg'] === 'tx1', 'data.md\'s table binding by path (style.headerBg → tx1) holds')
}
{
  const g = (id: string, gid: string, x: number, fill: string, comp: Record<string, unknown>) => R(id, fill, { x, groupId: gid, component: { id: 'c', key: 'k0', ...comp } })
  const d = open(deck('#F7A600', '#FF0000', [g('m', 'g1', 96, '#111111', { main: true }), g('nosig', 'g2', 300, '#222222', {}), g('dup', 'g3', 500, '#111111', {})]))
  ok(JSON.stringify(el(d, 'nosig').component.over) === '["fill"]' && el(d, 'nosig').fill === '#222222', '2. a copy without sig keeps its difference as an override')
  ok(!el(d, 'dup').component.over && typeof el(d, 'dup').component.sig === 'string', '2. an exact duplicate has no overrides and gets its sig on open')
  const main = el(d, 'm'); main.fill = '#333333'; main.radius = 9
  derive(d, deriveMemory(d))
  ok(el(d, 'dup').fill === '#333333' && el(d, 'dup').radius === 9, '2. …and then follows its main')
  ok(el(d, 'nosig').fill === '#222222' && el(d, 'nosig').radius === 9, '2. the overridden copy follows on every key but its override')
}
{
  const frame = R('f', '#EEEEEE', { x: 100, y: 100, w: 800, h: 200, layout: { dir: 'row', gap: 10, pad: [0, 0, 0, 0] } })
  const d = open(deck('#F7A600', '#FF0000', [frame, R('a', '#A00000', { x: 500, y: 0, parentId: 'f' }), R('b', '#00A000', { x: 0, y: 0, parentId: 'f' }), R('c', '#0000A0', { x: 0, y: 0, parentId: 'f' })]))
  const xs = ['b', 'c', 'a'].map((id) => el(d, id).x)
  ok(xs[0] < xs[1] && xs[1] < xs[2], `3. children order by x, ties by array order (b ${xs[0]}, c ${xs[1]}, a ${xs[2]})`)
  const json = JSON.stringify(deck('#F7A600', '#FF0000', [R('z', '#000000', { x: 7, y: 9, parentId: 'nope' })]))
  const loaded = parseDocInputReport(json, false)!
  const z = loaded.doc.slides[0].elements[0] as unknown as Record<string, any>
  derive(loaded.doc, deriveMemory(loaded.doc))
  ok(!('parentId' in z) && z.x === 7 && z.y === 9, '4. a dangling parentId is removed and the element stays at its own x y')
  ok(!JSON.stringify(loaded.report.findings).includes('parentId') && loaded.report.dropped.length === 0, '4. …with no finding and nothing reported dropped')
  const compactFrame = expandDocWithStats({ compact: true, slides: [{ elements: [
    { id: 'row', type: 'shape', shape: 'rect', x: 96, y: 200, w: 1088, h: 300, fill: '#EEEEEE', layout: { dir: 'row', gap: 32, pad: [24, 24, 24, 24], align: 'stretch' } },
    ...['p', 'q', 'r'].map((id) => ({ id, type: 'shape', shape: 'rect', w: 200, h: 100, fill: '#FFFFFF', parentId: 'row', sizing: { w: 'fill' } }))] }] }).doc
  const cf = open(compactFrame)
  const [p, q, r] = ['p', 'q', 'r'].map((id) => el(cf, id))
  ok(p.x === 120 && q.x > p.x && r.x > q.x && Math.abs(p.w - q.w) < 0.01 && p.h === 252, 'compact frame children without x/y lay out in array order, share the row and stretch')
}
console.log('\nthe app surface the workflow names\n')
const fileItems = section(editorSrc.replace(/^ {2}private buildFileItems\(/m, '## buildFileItems('), /^## buildFileItems\(/m).split(/\n {2}\}\n/)[0]
for (const label of ['Copy document JSON', 'Copy compact JSON (for agents)', 'Replace from JSON…', 'Export slides as images…']) {
  ok(fileItems.includes(`t('${label}')`), `the File menu has "${label}"`)
  ok(flat(body).includes(`*${label}*`), `   …and SKILL.md names it`)
}
ok(/private async copyDocJson\(compact = false\) \{\n\s+const clone = [^\n]+\n\s+stripCollabSecrets\(clone\)/.test(editorSrc), 'Copy document JSON and Copy compact JSON leave collab out')
ok(/parseDocInputReport\(ta\.value, \{ live: this\.store\.doc \}\)/.test(editorSrc) && /parseDocInputReport\(json, \{ live: store\.doc \}\)/.test(mainSrc), 'Replace from JSON and loadDoc keep the open deck (live: the open doc)')
for (const api of ['read(opts', 'loadDoc(json', 'serialize: ()', 'validate(target', 'measure(target', 'compact: ()', 'schema()']) ok(mainSrc.includes(`  ${api}`), `window.bento.${api.split(/[(:]/)[0]} exists`)
ok(/validateDoc\(target \?\? store\.doc, opts\)/.test(mainSrc), 'window.bento.validate(undefined, opts) checks the open deck with those options')
ok(/lsGet\('bento-offline'\) === 'on'/.test(read('kernel/src/net.ts')) && body.includes("localStorage['bento-offline'] = 'on'"), "the offline switch is localStorage['bento-offline'] = 'on'")
ok(/export const exportableSlides = \(doc: BentoDoc\): Slide\[\] => doc\.slides\.filter\(inLinearFlow\)/.test(read('slides/src/exportimages.ts')) && /export const inLinearFlow = \(s: Slide\): boolean => !s\.stateOf && !s\.hidden/.test(modelSrc) && /leaving out hidden and state slides/.test(flat(body)), 'Export slides as images leaves out hidden and state slides, and SKILL.md says so')
ok(/with NOTHING selected[^]*arrow keys walk slides/.test(read('slides/CLAUDE.md')), 'arrow keys walk the slides when nothing is selected (slides/CLAUDE.md, canvas slide nav)')

console.log('\nreferences/app.md: drive.cjs\n')
const app = ref('app.md')
const driveJs = [...app.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).find((c) => c.startsWith('// node drive.cjs')) ?? ''
ok(!!driveJs, 'app.md carries drive.cjs')
{
  const dir = mkdtempSync(join(tmpdir(), 'skill-drive-'))
  try {
    writeFileSync(join(dir, 'drive.cjs'), driveJs)
    ok(spawnSync(process.execPath, ['--check', join(dir, 'drive.cjs')], { encoding: 'utf8' }).status === 0, 'drive.cjs is valid JavaScript')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
ok(driveJs.includes("localStorage.setItem('bento-offline', 'on')") && /addInitScript/.test(driveJs), 'drive.cjs turns the offline switch on before the page loads')
ok(/ctx\.route\(\/\^https\?:\/, \(r\) => r\.abort\(\)\)/.test(driveJs) && /routeWebSocket/.test(driveJs), 'drive.cjs aborts every http(s) request and closes every socket')
const used = [...driveJs.matchAll(/window\.bento\.(\w+)/g)].map((m) => m[1])
for (const api of new Set(used)) ok(['loadDoc', 'validate', 'serialize', 'doc'].includes(api) && (api === 'doc' ? /get doc\(\)/.test(mainSrc) : mainSrc.includes(`  ${api}`)), `drive.cjs calls window.bento.${api}, which exists`)
ok(/filter\(\(s\) => !s\.stateOf && !s\.hidden\)/.test(driveJs), 'drive.cjs walks the slides inLinearFlow walks (no hidden, no states)')
ok(/className = 'ed-stage'/.test(read('slides/src/editor/canvas.ts')) && driveJs.includes("'.ed-stage'"), 'drive.cjs photographs the editor stage, .ed-stage')
const apiRows = tableRows(section(app, /^## The page's API/m)).map((r) => /^`(\w+)\(/.exec(r[0])?.[1] ?? '')
for (const api of apiRows) ok(!!api && mainSrc.includes(`  ${api}`), `app.md's API table: window.bento.${api} exists`)

console.log('\nthe file holds the full form\n')
ok(parseDoc(JSON.stringify({ compact: true, slides: [{ elements: [{ type: 'text', x: 0, y: 0, w: 10, h: 10, html: 'x' }] }] })) === null, 'a compact document without format is refused when the file opens')
ok(/bootWith\(parsed \|\| starterDoc\(\), !parsed\)/.test(mainSrc) && /const parsed = embedded \? parseDoc\(embedded\) : null/.test(mainSrc), '…and the app boots its starter deck instead (main.ts reads the block with parseDoc, not the compact loader)')
const withFormat = parseDoc(JSON.stringify({ compact: true, format: 'bento/slides', slides: [{ layout: 'title', elements: [{ role: 'title', md: 'x' }, { type: 'shape', shape: 'rect', x: 0, y: 0, w: 9, h: 9 }] }] }))!
ok(withFormat.slides[0].elements.length === 0, 'with format, a role-placed element and a shape without fill are dropped')
const inkText = expandDocWithStats({ compact: true, theme: { background: '#101418', color: '#C0FFEE', fontFamily: 'Georgia, serif' }, slides: [{ elements: [{ type: 'text', x: 0, y: 0, w: 99, h: 30, html: 'x' }] }] }).doc.slides[0].elements[0] as unknown as Record<string, any>
ok(inkText.color === readableInk('#101418') && inkText.color !== '#C0FFEE' && inkText.fontFamily === FONT_STACK, `compact text with no color or fontFamily gets a readable ink (${inkText.color}) and the system stack, not the theme's`)
ok(/text `color` that is\s+a plain readable ink for the slide background, not `theme\.color`/.test(gotchas), 'SKILL.md says so')
ok(/slideNumber: \(doc\.present\?\.slideNumber \?\? true\)/.test(presentSrc) && /progress: doc\.present\?\.progress \?\? true/.test(presentSrc) && /"present": \{ "slideNumber": false \}/.test(gotchas), 'the show draws its counter and progress bar unless present says otherwise, as SKILL.md says')
const laid = expandDocWithStats({ compact: true, theme: { background: '#101418', color: '#F2F0EA', fontFamily: 'Georgia, serif' }, slides: [{ layout: 'title', elements: [{ role: 'title', md: 'Hi' }] }] }).doc
const lt = laid.slides[0].elements.find((e) => e.role === 'title') as unknown as Record<string, any>
ok(laid.slides[0].background === '#FFFFFF' && lt.fontFamily === FONT_STACK && lt.color !== '#F2F0EA', 'a built-in layout brings a white slide, its own text colour and the system stack, not the deck theme')

// ---- the scripts in editing.md ----------------------------------------------------
console.log('\nreferences/editing.md: the two scripts, run\n')
const ed = ref('editing.md')
const inspectJs = [...ed.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).find((c) => c.startsWith('// node inspect.mjs')) ?? ''
const spliceJs = [...ed.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1]).find((c) => c.startsWith('// node splice.mjs')) ?? ''
ok(!!inspectJs && !!spliceJs, 'editing.md carries inspect.mjs and splice.mjs')
const bindList = [...(/const BINDABLE = \[([\s\S]*?)\]/.exec(inspectJs)?.[1] ?? '').matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1])
ok(same(bindList, [...TOKEN_KEYS].filter((k) => k !== 'w' && k !== 'h')), 'inspect.mjs counts the bindable keys less w and h')
const tmp = mkdtempSync(join(tmpdir(), 'skill-package-'))
try {
  writeFileSync(join(tmp, 'inspect.mjs'), inspectJs)
  writeFileSync(join(tmp, 'splice.mjs'), spliceJs)
  const FIXTURE_KEY = 'FIXTURE-NOT-A-REAL-KEY-0000'
  const start = starterDoc() as unknown as Record<string, any>
  start.collab = { room: 'wss://fixture.invalid/room', key: FIXTURE_KEY, ownerPriv: FIXTURE_KEY }
  start.assets = { 'a-fixture': 'data:image/png;base64,iVBORw0KGgo=' }
  start.slides[0].elements.push({ ...T('maths', '#111111'), html: 'costs $&amp; and $$x^2 < y$$ <b>bold</b>' })
  const text = JSON.stringify((({ assets, ...rest }) => rest)(start)).slice(0, -1) + ',\n"assets":' + JSON.stringify(start.assets) + '}'
  const before = '<!doctype html><html><head><title>t</title></head><body>\n<!-- tooling comment -->\n<script type="application/bento+json" id="bento-doc">'
  const after = '</script>\n<script type="bento/lzma-b91">payload</script></body></html>\n'
  const deckFile = join(tmp, 'deck.bento.html')
  writeFileSync(deckFile, before + '\n' + text.replace(/</g, '\\u003c') + '\n' + after)
  const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8' })
  const ins = run(['inspect.mjs', deckFile])
  ok(ins.status === 0, `inspect.mjs runs${ins.stderr ? `: ${ins.stderr.slice(0, 200)}` : ''}`)
  ok(!ins.stdout.includes(FIXTURE_KEY) && !ins.stdout.includes('iVBORw0KGgo'), 'inspect.mjs prints no collab value and no picture data')
  let out: Record<string, any> = {}
  try { out = JSON.parse(ins.stdout) } catch { /* reported below */ }
  ok(JSON.stringify(out.collab) === JSON.stringify(['room', 'key', 'ownerPriv']), 'inspect.mjs lists the collab field names')
  ok(out.slides?.length === start.slides.length && Object.keys(out.components ?? {}).length === 3 && Object.keys(out.tokens?.set ?? {}).length > 0, 'inspect.mjs reports the slides, the three starter components and the tokens')
  ok(/^\d+ of \d+ style values carry a themeRefs binding$/.test(out.bound ?? ''), `inspect.mjs reports the bound share (${out.bound})`)
  const radius = out.tokens?.set?.['radius.md']
  ok(JSON.stringify(radius) === JSON.stringify(['number', start.theme.tokens.set['radius.md'].values.default]), `inspect.mjs gives each token's type and active value (radius.md: ${JSON.stringify(radius)})`)
  const card = out.components?.['sd-cmp-card']?.main?.ids ?? []
  ok(card.length > 0 && card.every((id: string) => start.slides.some((sl: any) => sl.elements.some((e: any) => e.id === id && e.component?.main))), `inspect.mjs lists a component main's element ids (${card.length})`)
  ok(Array.isArray(out.textExtent) && out.textExtent[0] >= 0 && out.textExtent[1] <= 1280, `inspect.mjs reports the text extent (${JSON.stringify(out.textExtent)})`)
  const empty = join(tmp, 'empty.bento.html')
  writeFileSync(empty, before + after)
  ok(run(['inspect.mjs', empty]).stdout.trim() === '{"empty": true}', 'inspect.mjs says when the block is empty')

  // the agent's edit: read without collab and assets, change the title, give a wrong docId
  const work = JSON.parse(JSON.stringify(start))
  delete work.collab; delete work.assets
  work.title = 'Edited <deck>'
  work.docId = 'not-the-real-one'
  writeFileSync(join(tmp, 'doc.json'), JSON.stringify(work))
  const sp = run(['splice.mjs', deckFile, 'doc.json'])
  ok(sp.status === 0, `splice.mjs runs${sp.stderr ? `: ${sp.stderr.slice(0, 200)}` : ''}`)
  const html = readFileSync(deckFile, 'utf8')
  ok(html.startsWith(before) && html.endsWith(after), 'splice.mjs leaves the rest of the file byte for byte')
  const inner = html.slice(before.length, html.length - after.length)
  ok(!inner.includes('<'), 'the written block contains no literal "<"')
  const lines = inner.trim().split('\n')
  ok(lines.length === 2 && lines[1].startsWith('"assets":'), 'the assets map is written last, on its own line')
  const back = JSON.parse(inner)
  ok(back.title === 'Edited <deck>', 'the edit is in the file')
  ok(JSON.stringify(back.collab) === JSON.stringify(start.collab), 'collab is restored exactly')
  ok(back.docId === start.docId, 'docId is the deck\'s own, whatever doc.json said')
  ok(JSON.stringify(back.assets) === JSON.stringify(start.assets), 'assets left out of doc.json are put back')
  ok(JSON.stringify(back.slides) === JSON.stringify(start.slides), 'a "$&" and "$$" in the text survive the splice')
  ok(!!parseDoc(inner), 'the written block opens')
  writeFileSync(join(tmp, 'compact.json'), JSON.stringify({ compact: true, slides: [{ elements: [] }] }))
  const refused = run(['splice.mjs', deckFile, 'compact.json'])
  ok(refused.status !== 0 && readFileSync(deckFile, 'utf8') === html, 'splice.mjs refuses a compact document and leaves the file alone')
  const enc = join(tmp, 'enc.bento.html')
  writeFileSync(enc, before + '{"format":"bento/enc","v":1,"salt":"","iv":"","data":""}' + after)
  ok(run(['splice.mjs', enc, 'doc.json']).status !== 0, 'splice.mjs refuses a password-protected deck')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

// ---- every complete JSON example loads ------------------------------------------
console.log('\nevery complete JSON example loads clean\n')
const sources: Array<[string, string]> = [['SKILL.md', skillRaw], ...Object.entries(refs).map(([f, t]) => [`references/${f}`, t] as [string, string])]
let examples = 0
for (const [f, t] of sources) {
  for (const m of t.matchAll(/```json\n([\s\S]*?)```/g)) {
    const src = m[1]
    if (src.includes('…')) continue // an elided sketch, not a document
    let value: any
    for (const wrap of [(s: string) => s, (s: string) => `[${s}]`, (s: string) => `{${s}}`]) {
      try { value = JSON.parse(wrap(src)); break } catch { /* next */ }
    }
    if (value === undefined) { ok(false, `${f}: a json block parses (${src.slice(0, 50)}…)`); continue }
    const items: any[] = Array.isArray(value) ? value : [value]
    let doc: Record<string, any>
    if (items[0]?.compact) doc = items[0]
    else if (items[0]?.tokens) doc = { format: 'bento/slides', theme: { background: '#FFFFFF', color: '#000000', accent: '#F7A600', fontFamily: 'x', ...items[0] }, slides: [{ id: 's', background: '#FFFFFF', transition: 'none', notes: '', elements: [] }] }
    else if (items[0]?.elements) doc = { format: 'bento/slides', slides: items }
    else doc = { format: 'bento/slides', slides: [{ id: 's', background: '#FFFFFF', transition: 'none', notes: '', elements: items }] }
    const loaded = parseDocInputReport(JSON.stringify(doc), false)
    const errors = (loaded?.report.findings.findings ?? []).filter((x) => x.severity === 'error')
    const dropped = loaded?.report.dropped ?? []
    examples++
    ok(!!loaded && dropped.length === 0 && errors.length === 0, `${f}: example ${examples} loads with nothing dropped and no error${dropped.length ? ` (dropped ${dropped.map((d) => d.path).join(', ')})` : ''}${errors.length ? ` (${errors.map((e) => e.code).join(', ')})` : ''}`)
    const els = loaded?.doc.slides.flatMap((s) => s.elements) ?? []
    const want = items[0]?.compact ? items[0].slides.flatMap((sl: any) => sl.elements ?? []) : items.flatMap((i) => i.elements ?? (i.tokens ? [] : [i]))
    ok(els.length === want.length, `${f}: example ${examples} keeps every element`)
  }
}
ok(examples >= 6, `${examples} complete examples checked`)

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
