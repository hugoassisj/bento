#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Generates the agent reference for bento/slides from the code, and the
// generated blocks of the hand-written agent docs.
//
//   node scripts/build-agent-docs.mjs           write the files
//   node scripts/build-agent-docs.mjs --check   fail if any of them is stale (CI)
//
// WHAT IT WRITES. Three references the bento-slides skill bundles
// (plugins/bento-slides/skills/bento-slides/references/):
//
//   format.md   every key of the format, object by object: its type, enum or
//               range and whether it is required, from the schema
//               (slides/src/schema.ts, which reads the gate's own tables); the
//               key list from MODEL_KEYS (modelkeys.generated.ts); a one-line
//               meaning from scripts/agent-docs/meanings.json.
//   compact.md  the compact input form: the built-in layouts and their roles
//               (model.ts builtinLayouts, compact.ts layoutRoles and
//               LAYOUT_ALIASES), and every default an author may leave out,
//               read by running compact.ts's own expansion.
//   verify.md   every finding code validate() can emit, with its severities
//               and meaning (validate.ts FINDINGS).
//
// and the blocks between `<!-- generated:<name> -->` and `<!-- /generated -->`
// in docs/agents.md (the published guide, bento.page/agents.md) and
// docs/format.md. The prose around those blocks is hand-written; the blocks
// are not, so the guide and the skill read the same facts.
//
// WHY GENERATE IT. The guide was hand-written and drifted: it never learned
// about frames, tokens, components, paint stacks or click builds, while the
// format grew them. A reference that restates the code goes stale the first
// time somebody adds a field. So every fact here is read from the code, and a
// key without a meaning in meanings.json FAILS the build: a new model key
// forces a doc line. A meaning for a key the format no longer has fails it
// too. The same shape as build-modelkeys.mjs and build-schema.mjs: the files
// are committed so a reviewer sees a doc change as a diff, and `--check`
// means they can never be stale.
//
// No version is written into any output: the guide is stamped at release
// (scripts/release.mjs), and a version bump must not make these stale.
//
// The sources are not node-importable unbundled (extensionless imports, DOM
// types), so they are bundled with esbuild into a temp file first, the way
// build-schema.mjs does it.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REF_DIR = 'plugins/bento-slides/skills/bento-slides/references'
const MEANINGS = 'scripts/agent-docs/meanings.json'
/** Hand-written files that carry generated blocks, and which blocks. */
export const HOSTS = {
  'docs/agents.md': ['compact', 'verify', 'format'],
  'docs/format.md': ['format-index'],
}

/** Bundle the sources the docs are read from and import them. */
export async function loadSources() {
  const tmp = mkdtempSync(join(tmpdir(), 'bento-agent-docs-'))
  const src = (p) => JSON.stringify(join(root, p))
  writeFileSync(join(tmp, 'entry.ts'), [
    `export { buildSchema } from ${src('slides/src/schema.ts')}`,
    `export { MODEL_KEYS } from ${src('slides/src/modelkeys.generated.ts')}`,
    `export { FINDINGS } from ${src('slides/src/validate.ts')}`,
    `export { expandDocWithStats, compactDoc, layoutRoles, LAYOUT_ALIASES, STACK_GAP } from ${src('slides/src/compact.ts')}`,
    `export { builtinLayouts, FORMAT } from ${src('slides/src/model.ts')}`,
    `export { BUILTIN_FONTS } from ${src('slides/src/fonts.ts')}`,
    `export { LANGS } from ${src('kernel/src/tokenize.ts')}`,
    `export { TOKEN_KEYS, SLIDE_TOKEN_KEYS } from ${src('slides/src/untrusted.ts')}`,
  ].join('\n'))
  const out = join(tmp, 'entry.mjs')
  execFileSync(join(root, 'slides/node_modules/.bin/esbuild'), [
    join(tmp, 'entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=error',
  ])
  try { return await import(pathToFileURL(out).href) } finally { rmSync(tmp, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------
// markdown helpers

const code = (s) => '`' + s + '`'
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().replace(/ /g, '-')
const h = (level, title) => `${'#'.repeat(level)} ${title}`
const json = (v) => JSON.stringify(v)

// ---------------------------------------------------------------------------
// format: every key, object by object

/**
 * The objects of the format, in reading order. `keys` is the MODEL_KEYS table
 * (or, for the few sub-objects the format types inline and MODEL_KEYS does not
 * list, the schema's own property list); `node` finds the schema for the
 * object; `means` names the meanings.json section.
 */
function sectionsOf(K, $defs) {
  const types = Object.keys(K.element)
  const common = K.element[types[0]].filter((k) => types.every((t) => K.element[t].includes(k)))
  const doc = $defs.doc.properties
  const theme = $defs.theme.properties
  const shape = $defs.shape.properties
  const props = (n) => Object.keys(n.properties)
  const S = [
    { title: 'Document', means: 'doc', keys: K.doc, node: $defs.doc, intro: 'The top level of the `#bento-doc` JSON. Only `format` and a non-empty `slides` are required; the rest is filled from the editor\'s defaults when missing.' },
    { title: '`theme`', means: 'theme', keys: K.theme, node: $defs.theme, intro: 'The schema marks four keys required; a document that leaves any of them out still opens, with the editor\'s value for it.' },
    { title: '`theme.palette`', means: 'themePalette', keys: K.themePalette, node: theme.palette, intro: '`theme.background`, `theme.color` and `theme.accent` are the slots `bg1`, `tx1` and `accent1`; these are the rest.' },
    { title: '`theme.codePalette`', means: 'themeCodePalette', keys: K.themeCodePalette, node: theme.codePalette },
    { title: '`theme.tokens`', means: 'themeTokens', keys: K.themeTokens, node: theme.tokens },
    { title: '`present`', means: 'present', keys: K.present, node: doc.present },
    { title: '`size`', means: 'size', keys: K.size, node: doc.size },
    { title: '`meta`', means: 'meta', keys: K.meta, node: doc.meta },
    { title: '`fonts[]`', means: 'font', keys: K.font, node: doc.fonts.items },
    { title: 'Slide', means: 'slide', keys: K.slide, node: $defs.slide },
    { title: '`slide.hover`', means: 'slideHover', keys: props($defs.slide.properties.hover), node: $defs.slide.properties.hover },
    { title: '`slide.comments[]`', means: 'comment', keys: K.comment, node: $defs.slide.properties.comments.items },
    { title: 'Every element', means: 'element', keys: common, node: $defs.text, intro: `Keys every element type has (${types.map(code).join(', ')}). \`x y w h\` are slide px from the top-left.` },
    ...types.map((t) => ({ title: `Element: \`${t}\``, means: t, fallback: 'element', keys: K.element[t].filter((k) => !common.includes(k)), node: $defs[t], intro: `Its own keys, beside the ones [every element](#every-element) has.` })),
    { title: '`component`', means: 'component', keys: props($defs.text.properties.component), node: $defs.text.properties.component },
    { title: '`fx`', means: 'fx', keys: K.fx, node: $defs['prop-fx'], intro: 'Presentation effects. They run while presenting only.' },
    { title: '`fx.ken`', means: 'fxKen', keys: K.fxKen, node: $defs['prop-fx'].properties.ken },
    { title: '`fx.loop`', means: 'fxLoop', keys: K.fxLoop, node: $defs['prop-fx'].properties.loop },
    { title: '`shadow`', means: 'shadow', keys: K.shadow, node: $defs['prop-shadow'].anyOf[0], intro: 'One shadow, or an array of them (they stack).' },
    { title: 'Gradient', means: 'gradient', keys: K.gradient, node: $defs['prop-fillGradient'], intro: 'The shape of `fillGradient`, `strokeGradient`, `colorGradient` and a paint layer\'s `gradient`.' },
    { title: '`fills[]` layer', means: 'paintLayer', keys: K.paintLayer, node: shape.fills.items },
    { title: '`strokes[]` layer', means: 'strokeLayer', keys: K.strokeLayer, node: shape.strokes.items },
    { title: '`from` / `to`', means: 'connectorEnd', keys: K.connectorEnd, node: $defs['prop-from'] },
    { title: '`layout` (frame)', means: 'frameLayout', keys: K.frameLayout, node: shape.layout },
    { title: '`sizing`', means: 'sizing', keys: K.sizing, node: $defs.text.properties.sizing },
    { title: '`bool`', means: 'shapeBool', keys: props(shape.bool), node: shape.bool },
    { title: '`textStroke`', means: 'textStroke', keys: props($defs['prop-textStroke']), node: $defs['prop-textStroke'] },
    { title: '`crop`', means: 'imageCrop', keys: K.imageCrop, node: $defs['prop-crop'] },
    { title: '`source`', means: 'chartSource', keys: props($defs['prop-source']), node: $defs['prop-source'] },
    { title: 'Table `style`', means: 'tableStyle', keys: K.tableStyle, node: $defs.tableStyle, intro: 'Also the shape of `theme.table`, where every key is optional.' },
    { title: 'Table `rows[]`', means: 'tableRow', keys: K.tableRow, node: $defs['prop-rows'].items },
    { title: 'Table `cells[]`', means: 'tableCell', keys: K.tableCell, node: $defs['prop-rows'].items.properties.cells.items },
  ]
  for (const s of S) s.anchor = slug(s.title)
  return S
}

/** Where a key that holds an object of its own is described. */
const LINK = {
  fx: '`fx`', ken: '`fx.ken`', loop: '`fx.loop`', shadow: '`shadow`', component: '`component`',
  fillGradient: 'Gradient', strokeGradient: 'Gradient', colorGradient: 'Gradient', gradient: 'Gradient',
  fills: '`fills[]` layer', strokes: '`strokes[]` layer', from: '`from` / `to`', to: '`from` / `to`',
  layout: '`layout` (frame)', sizing: '`sizing`', bool: '`bool`', textStroke: '`textStroke`', crop: '`crop`',
  source: '`source`', style: 'Table `style`', table: 'Table `style`', rows: 'Table `rows[]`', cells: 'Table `cells[]`',
  theme: '`theme`', palette: '`theme.palette`', codePalette: '`theme.codePalette`', tokens: '`theme.tokens`',
  present: '`present`', size: '`size`', meta: '`meta`', fonts: '`fonts[]`', slides: 'Slide', layouts: 'Slide',
  hover: '`slide.hover`', comments: '`slide.comments[]`', elements: 'Every element',
}
const link = (key) => LINK[key] ? `[${LINK[key].replace(/`/g, '')}](#${slug(LINK[key])})` : null

/** A schema node as a short type: `"a"`, `left`·`right`, number 0–1, [4 numbers], object → link. */
function typeOf(node, key, $defs, depth = 0) {
  if (!node) return '?'
  if (node.$ref) return typeOf($defs[node.$ref.split('/').pop()], key, $defs, depth)
  if (node.const !== undefined) return code(json(node.const))
  if (node.enum) return node.enum.map((v) => code(v)).join(', ')
  if (node.anyOf || node.oneOf) return (node.anyOf ?? node.oneOf).map((n) => typeOf(n, key, $defs, depth)).join(' or ')
  if (Array.isArray(node.type)) return node.type.join(' or ')
  switch (node.type) {
    // colours carry a describing note in the schema ("CSS colour", "accent
    // colour", "brand slot accent2", "slide background"); other strings do not
    case 'string': return /colou?r\b|brand slot|background/i.test(node.description ?? '') ? 'colour' : 'string'
    case 'boolean': return 'boolean'
    case 'integer':
    case 'number': {
      if (node.minimum !== undefined && node.minimum === node.maximum) return code(String(node.minimum))
      const ranged = node.minimum !== undefined && node.maximum !== undefined && node.maximum - node.minimum <= 100
      return ranged ? `${node.type} ${node.minimum}–${node.maximum}` : node.type
    }
    case 'array': {
      const it = node.items ?? {}
      if (node.minItems && node.minItems === node.maxItems && (it.type === 'number' || it.type === 'string')) return `[${node.minItems} ${it.type}s]`
      if (depth === 0 && link(key) && (it.type === 'object' || it.$ref)) return `array → ${link(key)}`
      return `array of ${typeOf(it, null, $defs, depth + 1)}`
    }
    case 'object': {
      if (depth === 0 && link(key)) return `object → ${link(key)}`
      if (node.properties) return `{ ${Object.keys(node.properties).join(', ')} }`
      if (node.additionalProperties && typeof node.additionalProperties === 'object') return `map of ${typeOf(node.additionalProperties, null, $defs, depth + 1)}`
      return 'object'
    }
    default: return node.type ?? (node.description ? 'any' : '?')
  }
}

/** Facts appended to a meaning, read from the code rather than written down. */
function derived(src) {
  const roles = [...new Set(src.builtinLayouts({ width: 1280, height: 720 }).flatMap((l) => Object.keys(src.layoutRoles(l))))]
  const tokenize = readFileSync(join(root, 'kernel/src/tokenize.ts'), 'utf8')
  const lineLangs = [...tokenize.matchAll(/langId === '([a-z]+)'/g)].map((m) => m[1])
  const tokenTypes = src.buildSchema('').$defs.theme.properties.tokens.properties.set.additionalProperties.properties.type.enum
  return {
    'font.asset': `Built in: ${Object.keys(src.BUILTIN_FONTS).map(code).join(', ')}.`,
    'code.grammarName': `Built in: ${[...Object.keys(src.LANGS), ...lineLangs].map(code).join(', ')}; anything else is coloured as ${code('js')}.`,
    'element.role': `The built-in layouts use ${roles.map(code).join(', ')}.`,
    'themeTokens.set': `Token types: ${tokenTypes.map(code).join(', ')}.`,
    'element.themeRefs': `A token can drive a path under ${[...src.TOKEN_KEYS].map(code).join(', ')}.`,
    'slide.themeRefs': `A token can drive ${[...src.SLIDE_TOKEN_KEYS].map(code).join(', ')}.`,
  }
}

function meaningsCheck(K, sections, meanings) {
  const errors = []
  for (const s of sections) {
    for (const k of s.keys) {
      const m = meanings[s.means]?.[k] ?? (s.fallback ? meanings[s.fallback]?.[k] : undefined)
      if (typeof m !== 'string' || !m.trim()) errors.push(`no meaning for ${s.means}.${k} (add it to ${MEANINGS})`)
    }
  }
  // a meaning for a key nobody has is a stale doc line
  const known = new Map()
  for (const s of sections) {
    const set = known.get(s.means) ?? new Set()
    s.keys.forEach((k) => set.add(k)); known.set(s.means, set)
    if (s.fallback) { const f = known.get(s.fallback) ?? new Set(); s.keys.forEach((k) => f.add(k)); known.set(s.fallback, f) }
  }
  for (const [sec, table] of Object.entries(meanings)) {
    if (sec.startsWith('$')) continue
    if (!known.has(sec)) { errors.push(`${MEANINGS} has a section "${sec}" the format has no object for`); continue }
    for (const k of Object.keys(table)) if (!known.get(sec).has(k)) errors.push(`${MEANINGS}: ${sec}.${k} is not a key of the format`)
  }
  return errors
}

function formatBlock(src, level, meanings) {
  const K = src.MODEL_KEYS
  const { $defs } = src.buildSchema('')
  const sections = sectionsOf(K, $defs)
  const errors = meaningsCheck(K, sections, meanings)
  if (errors.length) throw new Error(errors.join('\n'))
  const extra = derived(src)
  const out = []
  out.push(`Every key of the format, read from the app's own tables: the type, enum and range are what the load gate accepts (a value outside them is dropped on load), and **required** keys are the ones a document or an element cannot do without. Objects: ${sections.map((s) => `[${s.title.replace(/`/g, '')}](#${s.anchor})`).join(' · ')}.`)
  for (const s of sections) {
    out.push('', h(level, s.title), '')
    if (s.intro) out.push(s.intro, '')
    const required = new Set(s.node?.required ?? [])
    out.push('| Key | Type | Meaning |', '|---|---|---|')
    for (const k of [...s.keys].sort()) {
      const node = s.node?.properties?.[k]
      if (!node) throw new Error(`the schema describes no ${s.means}.${k}`)
      const m = meanings[s.means]?.[k] ?? meanings[s.fallback]?.[k]
      const more = extra[`${s.means}.${k}`] ?? (s.fallback ? extra[`${s.fallback}.${k}`] : undefined)
      out.push(`| ${code(k)} | ${cell(typeOf(node, k, $defs))}${required.has(k) ? ' **required**' : ''} | ${cell(more ? `${m} ${more}` : m)} |`)
    }
  }
  return out.join('\n')
}

/** docs/format.md's index: every object and its keys, pointing at the reference. */
function formatIndexBlock(src) {
  const sections = sectionsOf(src.MODEL_KEYS, src.buildSchema('').$defs)
  const ref = relative('docs', `${REF_DIR}/format.md`)
  const out = [
    `Every key the format has, by object, generated from the code. The type and meaning of each are in the [generated reference](${ref}); the sections above explain how they work together.`,
    '', '| Object | Keys |', '|---|---|',
  ]
  for (const s of sections) out.push(`| [${cell(s.title)}](${ref}#${s.anchor}) | ${[...s.keys].sort().map(code).join(' ')} |`)
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// compact: layouts, roles and defaults, by running compact.ts

/** A value as it reads in a table cell. */
const val = (v) => {
  const s = json(v)
  return code(s.length > 90 ? s.slice(0, 87) + '…' : s)
}

function compactBlock(src, level) {
  const layouts = src.builtinLayouts({ width: 1280, height: 720 })
  const aliases = Object.entries(src.LAYOUT_ALIASES)
  const out = []
  out.push(h(level, 'Built-in layouts and their roles'), '')
  out.push('Name one in a slide\'s `layout` (by id, with or without the `layout-` prefix, or by an alias) and give its elements a `role`:', '')
  for (const l of layouts) {
    const roles = Object.keys(src.layoutRoles(l))
    const short = l.id.replace(/^layout-/, '')
    const also = aliases.filter(([, id]) => id === l.id).map(([a]) => code(a))
    out.push(`- ${code(short)} — ${roles.length ? roles.join(', ') : 'no roles (an empty slide; every element carries its own frame)'}${also.length ? ` (also ${also.join(', ')})` : ''}`)
  }
  out.push('', 'Where each role\'s content lands on a 1280×720 deck (a deck of another size gets the layout scaled to it). An element with its own `x y w h` is placed as given instead.', '')
  out.push('| Layout | Role | Slot (x, y, w, h) | Font size |', '|---|---|---|---|')
  for (const l of layouts) {
    const roles = src.layoutRoles(l)
    for (const [role, id] of Object.entries(roles)) {
      const el = l.elements.find((e) => e.id === id)
      out.push(`| ${code(l.id.replace(/^layout-/, ''))} | ${code(role)} | ${el.x}, ${el.y}, ${el.w}, ${el.h} | ${el.fontSize ?? '—'} |`)
    }
  }

  // defaults, read off expandDoc: what fills each omitted field, on a light
  // deck and on a dark one (a value that differs follows the background)
  const types = Object.keys(src.MODEL_KEYS.element)
  const DARK = '#101418'
  const run = (bg) => src.expandDocWithStats({
    compact: true, ...(bg ? { theme: { background: bg } } : {}),
    slides: [{ id: 's1', elements: types.map((type) => ({ type, x: 0, y: 0, w: 100, h: 100 })) }, {}],
  })
  const light = run(null), dark = run(DARK)
  const L = light.doc, D = dark.doc
  out.push('', h(level, 'Defaults you can leave out'), '')
  out.push('In a compact document every field below is filled on load with the value shown, which is what the editor itself inserts. Write a field only when you mean a different value. The saved file is always the full document.', '')
  out.push('**Document**', '', '| Key | Filled with |', '|---|---|')
  for (const k of Object.keys(L)) {
    if (k === 'slides' || k === 'theme') continue
    out.push(`| ${code(k)} | ${val(L[k])} |`)
  }
  for (const k of Object.keys(L.theme)) out.push(`| ${code(`theme.${k}`)} | ${val(L.theme[k])} |`)
  out.push('', '**Slide**', '', '| Key | Filled with |', '|---|---|')
  const ls = L.slides[1], ds = D.slides[1]
  for (const k of Object.keys(ls)) {
    if (k === 'elements') continue
    let v = val(ls[k])
    if (k === 'id') v = `${code('s<n>')} (1-based position, e.g. ${val(ls[k])})`
    else if (ls[k] === L.theme.background && ds[k] === D.theme.background) v = '`theme.background` (a compact slide only; a full document\'s slide without one is white)'
    out.push(`| ${code(k)} | ${v} |`)
  }
  out.push('', '**Elements.** An omitted `id` is minted as `<slideId>-<type>-<index>` (index = position on the slide, e.g. ' +
    `${code(light.doc.slides[0].elements[0].id)}), so a re-run yields the same ids. Per type, the fields filled when left out:`, '')
  // the keys a compact document always keeps: what compactDoc leaves on an
  // element whose every field equals the default
  const kept = (el) => {
    const c = src.compactDoc({ ...L, slides: [{ ...L.slides[0], elements: [el] }] })
    return Object.keys(c.slides[0].elements?.[0] ?? {}).filter((k) => k !== 'id' && k !== 'type')
  }
  out.push('| Type | Filled when omitted | Always written |', '|---|---|---|')
  types.forEach((t, i) => {
    const le = L.slides[0].elements[i], de = D.slides[0].elements[i]
    const keep = new Set(kept(le))
    const filled = Object.keys(le).filter((k) => !['id', 'type', 'x', 'y', 'w', 'h'].includes(k) && !keep.has(k))
    const desc = filled.map((k) => {
      if (json(le[k]) === json(de[k])) return `${code(k)} ${val(le[k])}`
      if (typeof le[k] === 'object') return `${code(k)} (themed; lighter lines on a dark slide)`
      return `${code(k)} ${val(le[k])} on a light slide, ${val(de[k])} on a dark one`
    })
    out.push(`| ${code(t)} | ${desc.length ? cell(desc.join(', ')) : 'nothing: write every field'} | ${[...new Set(['x', 'y', 'w', 'h', ...keep])].map(code).join(' ')} |`)
  })
  out.push('', `A text element may also leave out \`h\` (or write \`"h": "auto"\`): it is sized to its text on load. A slide with a \`layout\` fills its role'd elements' frame and typography from the slot instead; bodies beyond the layout's body slots stack in the slot ${src.STACK_GAP} px apart.`)
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// verify: every finding code

function verifyBlock(src) {
  const out = ['| Code | Severity | Meaning |', '|---|---|---|']
  for (const [c, { severity, meaning }] of Object.entries(src.FINDINGS)) {
    out.push(`| ${code(c)} | ${severity.join(' or ')} | ${cell(meaning)} |`)
  }
  return out.join('\n')
}

// ---------------------------------------------------------------------------
// the files

const GENERATED = '<!-- GENERATED by scripts/build-agent-docs.mjs from the bento/slides source — do not edit. Run `node scripts/build-agent-docs.mjs` after changing the format; CI fails if this file is out of date. -->'

function referenceFiles(src, meanings) {
  return {
    [`${REF_DIR}/format.md`]: [
      GENERATED, '',
      '# bento/slides format: every key',
      '',
      'Read this when you need the exact name, type or allowed values of a field. The JSON in a deck\'s `#bento-doc` block is a document object (below) whose `slides` hold elements. Unknown keys are dropped on load and reported, so a key missing here does not exist.',
      '',
      formatBlock(src, 2, meanings),
      '',
    ].join('\n'),
    [`${REF_DIR}/compact.md`]: [
      GENERATED, '',
      '# Compact input: layouts, roles and defaults',
      '',
      'Read this when you write a deck as an agent. Put `"compact": true` at the top level and leave out every field that equals what the editor would insert; it is filled on load (`window.bento.loadDoc(json)`, or *Replace from JSON…* in the File menu). Three more conveniences: `elements` may nest arrays, a text element may carry `md` (markdown, converted the way a paste is) instead of `html`, and a slide may name a `layout` so its elements need only a `role` and their content. The file is always saved as the full document.',
      '',
      '```json',
      '{ "compact": true, "title": "Q3 review", "slides": [',
      '  { "layout": "title", "elements": [',
      '    { "role": "title", "md": "Q3 review" },',
      '    { "role": "subtitle", "md": "Three things went right" } ] },',
      '  { "layout": "title-body", "elements": [',
      '    { "role": "title", "md": "Latency" },',
      '    { "role": "body", "md": "- **p50** fell 40%\\n- **p99** fell 25%" } ] } ] }',
      '```',
      '',
      'Loading returns a report: `dropped` lists every key the gate refused, with its path and why (and every role a layout had no slot for); `findings` is `validate()` on the result. Fix and load again until both are empty of what you did not intend.',
      '',
      compactBlock(src, 2),
      '',
    ].join('\n'),
    [`${REF_DIR}/verify.md`]: [
      GENERATED, '',
      '# Findings: what validate() reports',
      '',
      'Read this when a load report, `window.bento.validate()` or `bento check` hands you a finding. Each finding is `{ code, severity, message, slide?, element?, path? }`; the message says what to change. `error` means something is broken (a link to nowhere), `warning` that something will not look or behave as written, `info` that it may be deliberate. Text and table overflow are measured with the real renderer, so they appear only where there is a browser.',
      '',
      verifyBlock(src),
      '',
    ].join('\n'),
  }
}

function blocks(src, meanings) {
  return {
    compact: compactBlock(src, 3),
    verify: verifyBlock(src),
    format: formatBlock(src, 3, meanings),
    'format-index': formatIndexBlock(src),
  }
}

const MARK = (name) => new RegExp(`(<!-- generated:${name} -->\\n)([\\s\\S]*?)(<!-- /generated -->)`)

/** A host file with each of its blocks replaced. Throws on a missing marker. */
export function fillHost(text, file, names, made) {
  let out = text
  for (const name of names) {
    const re = MARK(name)
    if (!re.test(out)) throw new Error(`${file} has no <!-- generated:${name} --> … <!-- /generated --> block`)
    out = out.replace(re, (_, open, _old, close) => `${open}${made[name]}\n${close}`)
  }
  return out
}

/** Every generated file's path → its up-to-date text. */
export async function build() {
  const src = await loadSources()
  const meanings = JSON.parse(readFileSync(join(root, MEANINGS), 'utf8'))
  const files = referenceFiles(src, meanings)
  const made = blocks(src, meanings)
  for (const [file, names] of Object.entries(HOSTS)) files[file] = fillHost(readFileSync(join(root, file), 'utf8'), file, names, made)
  return files
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let files
  try { files = await build() } catch (e) { console.error(String(e.message ?? e)); process.exit(1) }
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([f, body]) => {
      try { return readFileSync(join(root, f), 'utf8') !== body } catch { return true }
    }).map(([f]) => f)
    if (stale.length) {
      console.error(`agent docs are out of date with the code:\n  ${stale.join('\n  ')}\nRun: node scripts/build-agent-docs.mjs`)
      process.exit(1)
    }
    console.log(`agent docs up to date (${Object.keys(files).length} files)`)
  } else {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, f)), { recursive: true })
      writeFileSync(join(root, f), body)
      console.log(`wrote ${f} (${body.length} B)`)
    }
  }
}
