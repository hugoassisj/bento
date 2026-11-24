#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The facts the agent docs state, checked against the code that decides them.
//
//   node scripts/test-agent-docs-facts.ts
//
// WHAT THIS PROVES. The files an agent reads before it writes a deck
// (docs/agents.md, published as bento.page/agents.md; docs/format.md; the
// bento-slides skill; AGENTS.md; site-src/llms.txt) state the sets and rules
// below the way the code has them, so a guess the docs used to force cannot
// come back unnoticed:
//
//   - the text tags the sanitizer keeps (render.ts ALLOWED_TAGS) and the line
//     endings (model.ts LineEnding) are listed in full, nothing missing and
//     nothing extra;
//   - the faces the shell carries (fonts.ts BUILTIN_FONTS) are named, with the
//     starter deck's own doc.fonts entries as the example;
//   - every `present` key (MODEL_KEYS.present) is documented, with the
//     defaults present.ts gives the show's counter, progress bar and arrows;
//   - every element type (MODEL_KEYS.element) is in format.md's type list;
//   - the required-fields sentence is what parseDoc does: three full documents
//     without `theme`, without `size` and without `theme.fontFamily` open, each
//     filled from the editor's defaults, and the per-element rule is the one
//     the renderer and REQUIRED_ELEMENT_KEYS apply;
//   - the menu path for the JSON commands is the File menu, never "Save";
//   - statements the code contradicts are gone, and llms.txt claims nothing
//     the guide lacks.
//
// AI-02's generated reference (scripts/test-agent-docs.ts) is meant to absorb
// this rig; until then it is the drift gate for the hand-written text.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseDoc, newDoc, builtinLayouts, REQUIRED_ELEMENT_KEYS } from '../slides/src/model.ts'
import { MODEL_KEYS } from '../slides/src/modelkeys.generated.ts'
import { expandDocWithStats, EXPANDED_TEXT_FONT } from '../slides/src/compact.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const same = (a: Iterable<string>, b: Iterable<string>) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join()
const show = (s: Iterable<string>) => [...s].sort().join(', ')

const AGENTS_GUIDE = 'docs/agents.md'
const FORMAT = 'docs/format.md'
const SKILL = 'plugins/bento-slides/skills/bento-slides/SKILL.md'
const guide = read(AGENTS_GUIDE)
const format = read(FORMAT)
const skill = read(SKILL)
const contract = read('AGENTS.md')
const llms = read('site-src/llms.txt')

/** The text between a heading/bullet start and the next one of its kind. */
function section(text: string, start: RegExp, end: RegExp): string {
  const m = start.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const e = end.exec(rest)
  return m[0] + (e ? rest.slice(0, e.index) : rest)
}

// ---- sets read from the source ---------------------------------------------
const renderSrc = read('slides/src/render.ts')
const tagBlock = /const ALLOWED_TAGS = new Set\(\[([\s\S]*?)\]\)/.exec(renderSrc)?.[1] ?? ''
const TAGS = [...tagBlock.matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1].toLowerCase())
const modelSrc = read('slides/src/model.ts')
const LINE_ENDINGS = [...(/export type LineEnding = ([^\n]+)/.exec(modelSrc)?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
const fontsSrc = read('slides/src/fonts.ts')
const builtinBlock = /export const BUILTIN_FONTS[^{]*\{([\s\S]*?)\n\}/.exec(fontsSrc)?.[1] ?? ''
const BUILTINS = [...builtinBlock.matchAll(/'(builtin:[a-z0-9-]+)'/g)].map((m) => m[1])
const starterSrc = read('slides/src/starterdeck.ts')
const STARTER_FONTS = [...starterSrc.matchAll(/\{ family: '([^']+)', asset: '(builtin:[a-z0-9-]+)', weight: '([^']+)' \}/g)]
  .map((m) => ({ family: m[1], asset: m[2], weight: m[3] }))
const PRESENT = [...MODEL_KEYS.present] as string[]
const ELEMENT_TYPES = Object.keys(MODEL_KEYS.element)
const presentSrc = read('slides/src/present.ts')
const presentDefault = (k: string): string | undefined => new RegExp(`doc\\.present\\?\\.${k} \\?\\? (true|false)`).exec(presentSrc)?.[1]

console.log('the sets the docs must list, read from the code\n')
ok(TAGS.length >= 10, `render.ts ALLOWED_TAGS read (${TAGS.length}: ${TAGS.join(' ')})`)
ok(LINE_ENDINGS.length >= 4, `model.ts LineEnding read (${LINE_ENDINGS.length}: ${LINE_ENDINGS.join(' ')})`)
ok(BUILTINS.length >= 1, `fonts.ts BUILTIN_FONTS read (${BUILTINS.join(', ')})`)
ok(STARTER_FONTS.length === BUILTINS.length && same(STARTER_FONTS.map((f) => f.asset), BUILTINS), 'the starter deck names every built-in face in doc.fonts')
ok(PRESENT.length >= 3, `MODEL_KEYS.present read (${PRESENT.join(', ')})`)
for (const k of ['slideNumber', 'progress', 'controls']) ok(!!presentDefault(k), `present.ts gives present.${k} a default (${presentDefault(k)})`)

// ---- text tags ---------------------------------------------------------------
console.log('\ntext html: the tags the sanitizer keeps\n')
const guideText = section(guide, /^- \*\*text\*\*:/m, /^- \*\*/m)
const guideTags = [...guideText.matchAll(/<([a-z0-9]+)>/g)].map((m) => m[1])
ok(same(guideTags, TAGS), `${AGENTS_GUIDE} lists exactly the kept tags (lists: ${show(guideTags) || 'none'}; code: ${show(TAGS)})`)
ok(/attribute/i.test(guideText), `${AGENTS_GUIDE} says attributes are stripped`)
const formatText = section(format, /^### `text`$/m, /^### /m)
const formatTags = [...formatText.matchAll(/`([a-z0-9]+(?:\/[a-z0-9]+)+)`/g)].flatMap((m) => m[1].split('/'))
ok(same(formatTags, TAGS), `${FORMAT} lists exactly the kept tags (lists: ${show(formatTags)})`)

// ---- line endings ------------------------------------------------------------
console.log('\nline endings\n')
const endingsIn = (text: string): string[] => {
  const m = /lineStart\??`?\s*\/\s*`?lineEnd\??`?\s*=\s*`([a-z|\s-]+)`/.exec(flat(text))
  return m ? m[1].split('|').map((s) => s.trim()).filter(Boolean) : []
}
ok(same(endingsIn(guide), LINE_ENDINGS), `${AGENTS_GUIDE} lists every line ending (lists: ${show(endingsIn(guide)) || 'none'})`)
ok(same(endingsIn(format), LINE_ENDINGS), `${FORMAT} lists every line ending (lists: ${show(endingsIn(format)) || 'none'})`)

// ---- fonts -------------------------------------------------------------------
console.log('\nthe faces the shell carries\n')
for (const key of BUILTINS) {
  ok(guide.includes(key), `${AGENTS_GUIDE} names ${key}`)
  ok(skill.includes(key), `${SKILL} names ${key}`)
  ok(format.includes(key), `${FORMAT} names ${key}`)
}
for (const f of STARTER_FONTS) {
  ok(new RegExp(`"family":\\s*"${f.family}",\\s*"asset":\\s*"${f.asset}",\\s*"weight":\\s*"${f.weight}"`).test(guide),
    `${AGENTS_GUIDE} shows the starter's entry { family: ${f.family}, asset: ${f.asset}, weight: ${f.weight} }`)
}
ok(!/not because the app provides them/.test(flat(guide)), `${AGENTS_GUIDE} no longer says the app provides no fonts`)
ok(!/otherwise stick to system stacks/.test(flat(guide)), `${AGENTS_GUIDE} no longer says "otherwise stick to system stacks"`)
ok(/font-not-embedded/.test(guide), `${AGENTS_GUIDE} keeps the font-not-embedded warning`)
ok(!/Images\/fonts must be embedded/.test(flat(skill)), `${SKILL} no longer says fonts must be embedded`)

// ---- present keys and the show's chrome --------------------------------------
console.log('\npresent: every key, and the chrome the show draws\n')
const presentRow = /^\| `present\?` \|([^\n]*)$/m.exec(format)?.[1] ?? ''
for (const k of PRESENT) {
  ok(new RegExp(`\\b${k}\\b`).test(presentRow), `${FORMAT}'s present row lists ${k}`)
  ok(guide.includes(`present.${k}`), `${AGENTS_GUIDE} documents present.${k}`)
}
const chrome = flat(section(guide, /^### Show chrome/m, /^#{2,3} /m))
ok(chrome.length > 0, `${AGENTS_GUIDE} has a "Show chrome" section`)
for (const k of ['slideNumber', 'progress', 'controls']) {
  const d = presentDefault(k)
  ok(new RegExp(`\`present\\.${k}\`[^.]{0,80}default \`${d}\``).test(chrome), `the chrome section gives present.${k} its default \`${d}\``)
}
ok(/slideNumber[^.]*false/.test(chrome) && /\{\{page\}\}|page number|counter/i.test(chrome), 'the chrome section says to switch the counter off when the deck draws its own')

// ---- element types -------------------------------------------------------------
console.log('\nelement types\n')
const typeList = flat(/The element `type` discriminant is one of:([^\n]*(?:\n(?!\n)[^\n]*)*)/.exec(format)?.[1] ?? '')
const listedTypes = [...typeList.matchAll(/`([a-z]+)`/g)].map((m) => m[1])
ok(same(listedTypes, ELEMENT_TYPES), `${FORMAT} lists every element type (lists: ${show(listedTypes)}; code: ${show(ELEMENT_TYPES)})`)
for (const t of ELEMENT_TYPES) ok(new RegExp(`^### \`${t}\`$`, 'm').test(format), `${FORMAT} has a section for \`${t}\``)

// ---- format.md: no stale version, the per-element entrance rule ---------------
console.log('\nformat.md\n')
const header = format.split('\n').slice(0, 8).join('\n')
ok(!/\bv?\d+\.\d+\.\d+\b/.test(header) && !/current as of/.test(header), `${FORMAT}'s header names no shell version`)
ok(/model\.ts/.test(header), `${FORMAT}'s header says it tracks model.ts`)
const enterRow = /^\| `enter\?` \|([^\n]*)$/m.exec(format)?.[1] ?? ''
ok(!/Only runs on non-morph arrivals/.test(enterRow), `${FORMAT}'s enter row no longer says "only on non-morph arrivals"`)
ok(/partner/.test(enterRow), `${FORMAT}'s enter row states the per-element morph-partner rule`)
ok(/partner/.test(section(guide, /^- \*\*Entrances\*\*/m, /^- \*\*/m)), `${AGENTS_GUIDE} states the same rule`)
// the rule as present.ts implements it: count-ups and entrances skip only elements WITH a partner
ok(/if \(!carried\.has\(el\.morphId \|\| el\.id\)\) runCountUp\(node\)/.test(presentSrc), 'present.ts: a count-up on a morph arrival runs only for an element with no partner')
ok(/if \(fromEls\.has\(id\)\) continue/.test(presentSrc), 'present.ts: an element with a partner gets no entrance')

// ---- built-in layouts ----------------------------------------------------------
console.log('\nbuilt-in layouts\n')
const layoutSection = section(guide, /^## Layouts and `role`/m, /^## /m)
for (const l of builtinLayouts()) ok(layoutSection.includes(`\`${l.id}\``), `${AGENTS_GUIDE} names the built-in ${l.id}`)
ok(!/five built-ins/.test(flat(layoutSection)), `${AGENTS_GUIDE} no longer says there are five built-ins`)

// ---- required fields: what parseDoc does ---------------------------------------
console.log('\nrequired fields, as parseDoc applies them\n')
const base = newDoc()
const text = { id: 't1', type: 'text', x: 96, y: 260, w: 1088, h: 160, rotation: 0, opacity: 1, html: 'Hello', fontSize: 88, fontWeight: 800, color: '#F2F0EA', align: 'left', valign: 'top', lineHeight: 1.1 }
const full = (): Record<string, any> => ({
  format: 'bento/slides', version: 1, title: 'T', size: { width: 1920, height: 1080 },
  theme: { background: '#101418', color: '#F2F0EA', accent: '#FF9E8A', fontFamily: "'Instrument Sans', system-ui, sans-serif" },
  slides: [{ id: 's1', background: '#101418', transition: 'none', notes: '', elements: [{ ...text }] }],
  modified: '2026-01-01T00:00:00.000Z',
})
const noTheme = full(); delete noTheme.theme
const noSize = full(); delete noSize.size
const noFace = full(); delete noFace.theme.fontFamily
const a = parseDoc(JSON.stringify(noTheme))
const b = parseDoc(JSON.stringify(noSize))
const c = parseDoc(JSON.stringify(noFace))
ok(!!a && JSON.stringify(a.theme) === JSON.stringify(base.theme), 'no `theme`: opens, with the editor\'s theme')
ok(!!a && a.slides[0].elements.length === 1, 'no `theme`: the text element is kept')
ok(!!b && b.size.width === base.size.width && b.size.height === base.size.height, `no \`size\`: opens, at ${base.size.width}×${base.size.height}`)
ok(!!c && c.theme.fontFamily === base.theme.fontFamily && c.theme.background === '#101418', 'no `theme.fontFamily`: opens, with the editor\'s font stack and the rest of the theme kept')
for (const k of ['background', 'color', 'accent', 'fontFamily'] as const) {
  const d = full(); delete d.theme[k]
  ok(parseDoc(JSON.stringify(d))?.theme[k] === base.theme[k], `no theme.${k}: the editor's ${base.theme[k]}`)
}
const bare = parseDoc(JSON.stringify({ format: 'bento/slides', slides: [{ elements: [{ ...text }] }] }))
ok(!!bare && bare.slides[0].background === '#FFFFFF' && bare.slides[0].transition === 'fade', 'only format + slides: opens; a slide without background is white, not theme.background')
ok(parseDoc(JSON.stringify({ format: 'bento/slides', slides: [] })) === null, 'an empty `slides` array is refused')
ok(parseDoc(JSON.stringify({ ...full(), format: 'bento/other' })) === null, 'another `format` is refused')
const dropped = parseDoc(JSON.stringify({ format: 'bento/slides', slides: [{ elements: [{ ...text, html: undefined }, { id: 'r', type: 'shape', x: 0, y: 0, w: 1, h: 1, shape: 'rect' }] }] }))
ok(!!dropped && dropped.slides[0].elements.length === 0, 'an element missing a key its type needs (text html, shape fill) is dropped')
const textless = parseDoc(JSON.stringify(full()))!
ok(!('fontFamily' in textless.slides[0].elements[0]), 'a full document\'s text box without fontFamily keeps it absent')
ok(/inner\.style\.fontFamily = el\.fontFamily \|\| doc\.theme\.fontFamily/.test(renderSrc), 'render.ts draws a text box without fontFamily in theme.fontFamily')
const compactText = expandDocWithStats({ compact: true, theme: { fontFamily: 'Georgia, serif' }, slides: [{ elements: [{ type: 'text', x: 0, y: 0, w: 100, h: 50, html: 'x' }] }] })
ok((compactText.doc.slides[0].elements[0] as any).fontFamily === EXPANDED_TEXT_FONT, 'the compact form fills an omitted fontFamily with the editor\'s stack, not the theme\'s')

const required = flat(section(guide, /^## Minimal valid document/m, /^## /m))
ok(!/will not boot without them/.test(required) && !/will not boot without them/.test(flat(skill)), 'neither the guide nor the skill says the app will not boot without size/theme')
ok(/Only `"format": "bento\/slides"` and a non-empty `slides` array are required/.test(required), `${AGENTS_GUIDE} states the rule parseDoc applies`)
ok(required.includes(`${base.size.width}×${base.size.height}`), `${AGENTS_GUIDE} names the default size`)
ok(['background', 'color', 'accent', 'fontFamily'].every((k) => required.includes(`\`${k}\``)), `${AGENTS_GUIDE} names the four theme keys that are filled`)
for (const [type, keys] of Object.entries(REQUIRED_ELEMENT_KEYS)) {
  ok(new RegExp(`${type} ${keys.map((k) => `\`${k}\``).join(' and ')}`).test(required), `${AGENTS_GUIDE} names what a ${type} cannot render without (${keys.join(', ')})`)
}
ok(/"compact": true/.test(required), `${AGENTS_GUIDE} shows the compact form as the way to omit defaults`)
ok(/Only `"format": "bento\/slides"` and a non-empty `slides` array are required/.test(flat(skill)), `${SKILL} states the same rule`)
ok(!/Fully specify element fields/.test(skill), `${SKILL} no longer says "fully specify" without the fontFamily exception`)
ok(/without `fontFamily`[^.]*theme/.test(flat(skill)), `${SKILL} says a text box without fontFamily follows the theme`)
// every JSON block in the guide's minimal-document section loads clean
const blocks = [...section(guide, /^## Minimal valid document/m, /^## /m).matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1])
ok(blocks.length >= 2, `the minimal-document section carries a full and a compact example (${blocks.length})`)
for (const [i, j] of blocks.entries()) {
  let parsed: any = null
  try { parsed = JSON.parse(j) } catch { /* reported below */ }
  const exp = parsed?.compact ? expandDocWithStats(parsed) : null
  const doc = parsed && parseDoc(JSON.stringify(exp ? exp.doc : parsed))
  ok(!!doc && (!exp || exp.stats.notes.length === 0), `minimal-document example ${i + 1} (${parsed?.compact ? 'compact' : 'full'}) loads`)
}

// ---- the menu path --------------------------------------------------------------
console.log('\nthe JSON commands live in the File menu\n')
const editorSrc = read('slides/src/editor/editor.ts')
const fileItems = section(editorSrc, /private buildFileItems\(/, /\n {2}\}\n/)
for (const label of ['Copy document JSON', 'Copy compact JSON (for agents)', 'Replace from JSON…']) {
  ok(fileItems.includes(`t('${label}')`), `editor.ts: "${label}" is a File-menu item`)
}
ok(/cap\(t\('Advanced'\)\)/.test(fileItems), 'editor.ts: under the "Advanced" caption')
for (const id of ['copy-json', 'copy-compact-json', 'replace-json']) ok(new RegExp(`id: '${id}'`).test(editorSrc), `editor.ts: palette command ${id}`)
const docFiles = (dir: string): string[] => readdirSync(join(root, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`
  return statSync(join(root, rel)).isDirectory() ? docFiles(rel) : /\.md$/.test(n) ? [rel] : []
})
const scanned = [...docFiles('docs'), ...docFiles('plugins'), 'AGENTS.md', 'README.md', 'slides/CLAUDE.md']
const savePath = /Save\s*(?:▾|→)[^.;)]{0,12}(?:Copy|Replace)[^.;]{0,30}JSON/
for (const f of scanned) {
  if (f === 'docs/DECISIONS.md') continue // append-only log: history, not instructions
  const hit = savePath.exec(flat(read(f)))
  ok(!hit, `${f} sends no one to "Save" for the JSON commands${hit ? ` (found "${hit[0]}")` : ''}`)
}
ok(/File menu/.test(guide) && /File menu/.test(skill) && /File menu/.test(contract), 'the guide, the skill and AGENTS.md name the File menu')

// ---- llms.txt --------------------------------------------------------------------
console.log('\nllms.txt claims nothing the guide lacks\n')
const guideLine = llms.split('\n').find((l) => l.includes('https://bento.page/agents.md')) ?? ''
ok(!!guideLine, 'llms.txt links the agent guide')
const guideHasCompactSection = /^#{2,3} .*compact/im.test(guide)
ok(!/compact/i.test(guideLine) || guideHasCompactSection, `llms.txt's guide line claims the compact form only if the guide has a section on it (claims: ${/compact/i.test(guideLine)}, section: ${guideHasCompactSection})`)

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
