#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The generated agent reference and the guide built around it.
//
//   slides/node_modules/.bin/esbuild scripts/test-agent-docs.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs && node /tmp/x.mjs
//
// (bundled, the way test-slides-agent-decks.ts is: the loader pulls the gate
// and validate; run from the repository root.)
//
// WHAT THIS PROVES.
//
//   - `node scripts/build-agent-docs.mjs --check` passes on the tree, and
//     FAILS, in a scratch copy, when a generated file or block is stale, when
//     a key has no meaning, when a meaning names a key the format lacks, and
//     when a host file loses its marker;
//   - every key in MODEL_KEYS is in references/format.md, in its object's
//     table, with a non-empty meaning, and the published guide carries the
//     same rows (assembled from the same source);
//   - every finding code validate.ts can emit is in FINDINGS, in
//     references/verify.md and in the guide;
//   - every fenced json block in docs/agents.md, the skill's SKILL.md and
//     references/*.md that carries "format" or "compact": true loads through
//     parseDocInputReport with nothing dropped and no error finding;
//   - the guide documents the compact form, md, h:"auto", layout plus role,
//     click builds, frames, tokens, components and paint stacks, each with a
//     json example of its own;
//   - every claim llms.txt makes about the guide names a section the guide
//     has, and every reference it links exists;
//   - headings are unique and every in-page link resolves.

import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODEL_KEYS } from '../slides/src/modelkeys.generated.ts'
import { FINDINGS } from '../slides/src/validate.ts'
import { parseDocInputReport } from '../slides/src/compactload.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
// bundled: the bundle lives elsewhere, so the repo root is the cwd (CI runs from it)
const root = process.cwd()
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const REF = 'plugins/bento-slides/skills/bento-slides/references'
const SKILL = 'plugins/bento-slides/skills/bento-slides/SKILL.md'
const GUIDE = 'docs/agents.md'
/** A file that may be missing (on a tree without the reference): '' and a failed check, not a crash. */
const tryRead = (f: string) => { try { return read(f) } catch { return '' } }
const guide = read(GUIDE)
const refFormat = tryRead(`${REF}/format.md`)
const refVerify = tryRead(`${REF}/verify.md`)

/** GitHub's heading anchor. */
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9 _-]/g, '').trim().replace(/ /g, '-')
/** Text with fenced code blocks blanked, so a `#` or a link inside one is not read as markdown. */
const prose = (t: string) => t.replace(/```[\s\S]*?```/g, '')
/** Sections of a markdown text at one heading level: title → body. */
function sections(text: string, level: number): Map<string, string> {
  const out = new Map<string, string>()
  const re = new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm')
  const heads = [...prose(text).matchAll(re)]
  heads.forEach((m, i) => out.set(m[1], prose(text).slice(m.index! + m[0].length, heads[i + 1]?.index ?? undefined)))
  return out
}
/** The section of `text` from a heading matching `start` to the next heading of that level or higher. */
function section(text: string, start: RegExp): string {
  const m = start.exec(text)
  if (!m) return ''
  const level = /^#+/.exec(m[0])![0].length
  const rest = text.slice(m.index + m[0].length)
  const e = new RegExp(`^#{1,${level}} `, 'm').exec(rest)
  return m[0] + (e ? rest.slice(0, e.index) : rest)
}
/** Rows of a markdown table as cells (escaped pipes kept inside a cell). */
const rows = (body: string) => body.split('\n').filter((l) => /^\| `/.test(l))
  .map((l) => l.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()))
const jsonBlocks = (text: string) => [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1])

// ---- the generator's --check, on the tree and on stale copies ---------------
console.log('build-agent-docs.mjs --check\n')
const run = (cwd: string) => spawnSync(process.execPath, [join(cwd, 'scripts/build-agent-docs.mjs'), '--check'], { cwd, encoding: 'utf8' })
for (const f of ['format.md', 'compact.md', 'verify.md']) ok(tryRead(`${REF}/${f}`) !== '', `${REF}/${f} exists`)
const here = run(root)
ok(here.status === 0, `the committed reference and guide blocks are up to date${here.status ? `: ${here.stderr.trim().split('\n')[0]}` : ''}`)

const scratch = mkdtempSync(join(tmpdir(), 'bento-agent-docs-rig-'))
const GENERATED = [`${REF}/format.md`, `${REF}/compact.md`, `${REF}/verify.md`, GUIDE, 'docs/format.md']
function freshCopy(): string {
  const dir = mkdtempSync(join(scratch, 'copy-'))
  for (const f of ['scripts/build-agent-docs.mjs', 'scripts/agent-docs/meanings.json', ...GENERATED]) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    cpSync(join(root, f), join(dir, f))
  }
  // the sources are read, never written: link them in
  symlinkSync(join(root, 'slides'), join(dir, 'slides'))
  symlinkSync(join(root, 'kernel'), join(dir, 'kernel'))
  return dir
}
try {
  if (here.status !== 0) throw new Error('the tree itself fails --check')
  const clean = freshCopy()
  ok(run(clean).status === 0, 'a scratch copy of the tree passes --check (the mutations below are the only difference)')
  const mutate = (what: string, edit: (dir: string) => void, expect: RegExp) => {
    const dir = freshCopy()
    edit(dir)
    const r = run(dir)
    ok(r.status !== 0 && expect.test(r.stderr), `${what}: --check exits ${r.status} (${r.stderr.trim().split('\n')[0] ?? ''})`)
  }
  const edit = (dir: string, f: string, fn: (s: string) => string) => writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8')))
  for (const f of [`${REF}/format.md`, `${REF}/compact.md`, `${REF}/verify.md`]) {
    mutate(`${f} edited by hand`, (d) => edit(d, f, (s) => s.replace('| Key |', '| Name |').replace('| Code |', '| Name |').replace('## Built-in', '## The built-in')), new RegExp(f.replace(/[.]/g, '\\.')))
  }
  mutate('a generated block in docs/agents.md edited by hand', (d) => edit(d, GUIDE, (s) => s.replace(/(<!-- generated:verify -->\n)\| Code \|/, '$1| Finding |')), /docs\/agents\.md/)
  mutate('docs/format.md lost its marker', (d) => edit(d, 'docs/format.md', (s) => s.replace('<!-- generated:format-index -->', '')), /no <!-- generated:format-index -->/)
  mutate('a key with no meaning', (d) => edit(d, 'scripts/agent-docs/meanings.json', (s) => { const m = JSON.parse(s); delete m.element.opacity; return JSON.stringify(m) }), /no meaning for element\.opacity/)
  mutate('an empty meaning', (d) => edit(d, 'scripts/agent-docs/meanings.json', (s) => { const m = JSON.parse(s); m.fx.step = ' '; return JSON.stringify(m) }), /no meaning for fx\.step/)
  mutate('a meaning for a key the format lacks', (d) => edit(d, 'scripts/agent-docs/meanings.json', (s) => { const m = JSON.parse(s); m.fx.bounce = 'Bounces.'; return JSON.stringify(m) }), /fx\.bounce is not a key of the format/)
} catch (e) {
  ok(false, `the stale-copy checks could not run: ${(e as Error).message.split('\n')[0]}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

// ---- every model key, with a meaning -------------------------------------------
console.log('\nevery key in MODEL_KEYS is in references/format.md with a meaning\n')
const TABLES: Record<string, string> = {
  doc: 'Document', theme: '`theme`', themePalette: '`theme.palette`', themeCodePalette: '`theme.codePalette`',
  themeTokens: '`theme.tokens`', present: '`present`', size: '`size`', meta: '`meta`', font: '`fonts[]`',
  slide: 'Slide', comment: '`slide.comments[]`', fx: '`fx`', fxKen: '`fx.ken`', fxLoop: '`fx.loop`',
  shadow: '`shadow`', gradient: 'Gradient', paintLayer: '`fills[]` layer', strokeLayer: '`strokes[]` layer',
  connectorEnd: '`from` / `to`', frameLayout: '`layout` (frame)', sizing: '`sizing`', imageCrop: '`crop`',
  tableStyle: 'Table `style`', tableRow: 'Table `rows[]`', tableCell: 'Table `cells[]`',
}
const refSections = sections(refFormat, 2)
const meaningIn = (title: string, key: string): string | undefined =>
  rows(refSections.get(title) ?? '').find((r) => r[0] === `\`${key}\``)?.[2]
const missing: string[] = []
let keys = 0
for (const [table, list] of Object.entries(MODEL_KEYS)) {
  if (table === 'element') continue
  const title = TABLES[table]
  ok(!!title && refSections.has(title), `MODEL_KEYS.${table} has a section (${title ?? 'none mapped: add it to TABLES'})`)
  for (const k of list as readonly string[]) { keys++; if (!meaningIn(title, k)?.trim()) missing.push(`${table}.${k}`) }
}
for (const [type, list] of Object.entries(MODEL_KEYS.element)) {
  ok(refSections.has(`Element: \`${type}\``), `element type ${type} has a section`)
  for (const k of list as readonly string[]) {
    keys++
    if (!(meaningIn(`Element: \`${type}\``, k) ?? meaningIn('Every element', k))?.trim()) missing.push(`${type}.${k}`)
  }
}
ok(missing.length === 0, `${keys - missing.length}/${keys} keys documented with a meaning${missing.length ? `; missing: ${missing.join(', ')}` : ''}`)
const refRows = prose(refFormat).split('\n').filter((l) => /^\| `/.test(l))
const guideRef = section(guide, /^## Field reference$/m)
ok(refRows.length > 0 && refRows.every((r) => guideRef.includes(r)), `the guide's field reference carries every row of references/format.md (${refRows.filter((r) => guideRef.includes(r)).length}/${refRows.length})`)

// ---- every finding code ----------------------------------------------------------
console.log('\nevery finding code validate() can emit is documented\n')
const validateSrc = read('slides/src/validate.ts')
const emitted = [...new Set([...validateSrc.slice(validateSrc.indexOf('export function validateDoc')).matchAll(/code: '([a-z][a-z-]+)'/g)].map((m) => m[1]))]
ok(emitted.length >= 20, `validate.ts emits ${emitted.length} codes`)
const listed = Object.keys(FINDINGS)
ok(emitted.every((c) => listed.includes(c)) && listed.every((c) => emitted.includes(c)), `FINDINGS lists exactly the emitted codes${emitted.filter((c) => !listed.includes(c)).length ? ` (missing: ${emitted.filter((c) => !listed.includes(c))})` : ''}${listed.filter((c) => !emitted.includes(c)).length ? ` (never emitted: ${listed.filter((c) => !emitted.includes(c))})` : ''}`)
const verifyRows = rows(refVerify)
const verifyBlock = /<!-- generated:verify -->\n([\s\S]*?)<!-- \/generated -->/.exec(guide)?.[1] ?? ''
for (const c of emitted) {
  const row = verifyRows.find((r) => r[0] === `\`${c}\``)
  const f = (FINDINGS as Record<string, { severity: readonly string[]; meaning: string }>)[c]
  ok(!!row && !!f && row[1] === f.severity.join(' or ') && row[2].length > 20, `verify.md: ${c} (${f?.severity.join('/')})`)
  ok(verifyBlock.includes(`| \`${c}\` |`), `the guide lists ${c}`)
}

// ---- snippets load clean ---------------------------------------------------------
console.log('\nevery json example that is a document loads with nothing dropped and no error\n')
const refFiles = (() => { try { return readdirSync(join(root, REF)).filter((f) => f.endsWith('.md')).map((f) => `${REF}/${f}`) } catch { return [] } })()
const snippetFiles = [GUIDE, SKILL, ...refFiles]
let loaded = 0
for (const f of snippetFiles) {
  jsonBlocks(read(f)).forEach((j, i) => {
    if (!/"format"|"compact":\s*true/.test(j)) return
    let parsed: ReturnType<typeof parseDocInputReport> = null
    let err = ''
    try { JSON.parse(j); parsed = parseDocInputReport(j, false) } catch (e) { err = String((e as Error).message) }
    const errors = parsed?.report.findings.findings.filter((x) => x.severity === 'error') ?? []
    const dropped = parsed?.report.dropped ?? []
    ok(!!parsed && dropped.length === 0 && errors.length === 0,
      `${f} json block ${i + 1} (${j.slice(0, 40).replace(/\s+/g, ' ')}…)${err ? `: ${err}` : !parsed ? ': refused' : ''}${dropped.length ? `: dropped ${dropped.map((d) => `${d.path} (${d.reason})`).join('; ')}` : ''}${errors.length ? `: ${errors.map((e) => e.code).join(', ')}` : ''}`)
    loaded++
  })
}
ok(loaded >= 12, `${loaded} document examples loaded`)

// ---- the guide documents each topic with an example ------------------------------
console.log('\nthe guide documents each topic, with a json example\n')
const topics: Array<[string, RegExp, (j: string) => boolean]> = [
  ['the compact form', /^## The compact form/m, (j) => /"compact": true/.test(j)],
  ['md text', /^### Text that sizes itself, and markdown/m, (j) => /"md":/.test(j)],
  ['h: "auto" (h left out)', /^### Text that sizes itself, and markdown/m, (j) => { try { return JSON.parse(j).slides.some((s: any) => s.elements.flat(9).some((e: any) => e.type === 'text' && (e.h === undefined || e.h === 'auto'))) } catch { return false } }],
  ['layout plus role', /^### Placing by layout and role/m, (j) => /"layout": "/.test(j) && /"role":/.test(j)],
  ['click builds', /^### Click builds/m, (j) => /"step": \d/.test(j)],
  ['code and code morph', /^### Code, and code morph/m, (j) => /"type": "code"/.test(j) && /"transition": "morph"/.test(j)],
  ['maths', /^### Maths/m, (j) => /\$[^$]+\$/.test(j)],
  ['frames', /^### Frames/m, (j) => /"layout": \{/.test(j) && /"parentId":/.test(j)],
  ['tokens and modes', /^### Tokens and modes/m, (j) => /"tokens":/.test(j) && /"modes":/.test(j) && /"\$[a-z]/.test(j)],
  ['components', /^### Components/m, (j) => /"component":/.test(j) && /"main": true/.test(j)],
  ['paint stacks', /^### Paint stacks/m, (j) => /"fills":/.test(j) && /"strokes":/.test(j)],
]
for (const [what, head, has] of topics) {
  const body = section(guide, head)
  ok(body.length > 200 && jsonBlocks(body).some(has), `${GUIDE}: ${what}, with an example`)
}
for (const what of ['load report', 'bento check', 'schema URL']) {
  const re = { 'load report': /^## Load, read the report, fix/m, 'bento check': /^## Check your deck: `bento check`/m, 'schema URL': /^## The document schema/m }[what]!
  ok(re.test(guide), `${GUIDE} has its section on the ${what}`)
}
ok(/https:\/\/bento\.page\/schema\/slides\.json/.test(guide), `${GUIDE} names the schema URL`)
ok(/window\.bento\.measure\(/.test(guide) && /window\.bento\.validate\(/.test(guide), `${GUIDE} documents measure() and validate()`)
const contract = read('AGENTS.md')
ok(/docs\/agents\.md/.test(contract) && /build-agent-docs\.mjs/.test(contract), 'AGENTS.md points at the guide and the generator')
ok(!/^## Authoring a deck as an agent: the compact form/m.test(contract), 'AGENTS.md no longer keeps its own copy of the compact form')

// ---- llms.txt -----------------------------------------------------------------------
console.log('\nllms.txt claims only what the guide has\n')
const llms = read('site-src/llms.txt')
const guideLine = llms.split('\n').find((l) => l.includes('](https://bento.page/agents.md)')) ?? ''
const clauses = guideLine.slice(guideLine.indexOf('): ') + 3).split('; ').map((c) => c.trim()).filter(Boolean)
const features = section(guide, /^## Features, with an example each/m)
const FEATURE_HEADS: Record<string, RegExp> = {
  'click builds': /^### Click builds/m, 'code morph': /^### Code, and code morph/m, maths: /^### Maths/m, frames: /^### Frames/m,
  'tokens and modes': /^### Tokens and modes/m, components: /^### Components/m, 'paint stacks': /^### Paint stacks/m,
}
const CLAIMS: Array<[RegExp, (clause: string) => boolean]> = [
  [/^how to write and edit a deck, with copy-paste snippets$/, () => /^### Copy-paste recipes/m.test(guide)],
  [/^the compact input form\b/, () => /^## The compact form/m.test(guide) && /^### Placing by layout and role/m.test(guide)],
  [/^a worked example per feature \(/, (c) => {
    const items = /\(([^)]*)\)/.exec(c)![1].split(',').map((s) => s.trim())
    return items.every((it) => FEATURE_HEADS[it] && FEATURE_HEADS[it].test(features))
  }],
  [/^every finding validate\(\) reports$/, () => listed.every((code) => verifyBlock.includes(`| \`${code}\` |`))],
  [/^a field reference of every key, generated from the code$/, () => refRows.length > 0 && refRows.every((r) => guideRef.includes(r))],
]
ok(clauses.length >= 3, `the guide line makes ${clauses.length} claims`)
for (const c of clauses) {
  const rule = CLAIMS.find(([re]) => re.test(c))
  ok(!!rule && rule[1](c), `llms.txt: "${c}" ${rule ? 'holds' : 'is not a claim this rig knows (add a row to CLAIMS)'}`)
}
for (const m of llms.matchAll(/https:\/\/raw\.githubusercontent\.com\/nyblnet\/bento\/main\/([^)\s]+)/g)) {
  let exists = true
  try { read(m[1]) } catch { exists = false }
  ok(exists, `llms.txt links ${m[1]}, which exists`)
}
for (const f of ['format.md', 'compact.md', 'verify.md']) ok(llms.includes(`${REF}/${f}`), `llms.txt links the reference ${f}`)

// ---- headings and in-page links -----------------------------------------------------
console.log('\nheadings are unique and every in-page link resolves\n')
for (const f of [GUIDE, 'docs/format.md', ...snippetFiles.filter((x) => x.startsWith(REF))]) {
  const text = prose(read(f))
  const slugs = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]))
  const dup = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  ok(dup.length === 0, `${f}: ${slugs.length} headings, none share an anchor${dup.length ? ` (${[...new Set(dup)].join(', ')})` : ''}`)
  const links = [...text.replace(/`[^`\n]*`/g, '').matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1])
  const broken = [...new Set(links.filter((l) => !slugs.includes(l)))]
  ok(broken.length === 0, `${f}: ${links.length} in-page links resolve${broken.length ? ` (broken: ${broken.join(', ')})` : ''}`)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
