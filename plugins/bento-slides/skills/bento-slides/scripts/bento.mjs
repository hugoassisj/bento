#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento — the agent's tool for a .bento.html deck. Node 20+, no dependency,
// no network. Chrome only for `render` (and to expand a compact document).
//
//   node scripts/bento.mjs <verb> [args] [--json] [--help]
//
//   new      copy the bundled app file to start a deck
//   extract  the document without its assets and sharing keys, for editing
//   inspect  the deck's design system: slots, tokens, components, layouts, fonts
//   lint     static checks, and with --base the design-system diff of an edit
//   render   the deck in its own runtime: validate() findings and PNGs
//   apply    splice an edited document back into the deck
//
// Every verb takes --help and --json; exit 0 is success, 1 a check that
// failed, 2 a usage or input error, 3 Chrome needed and not found. Every error
// ends with what to do next.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DeckError, mergeEnvelope, parseRanges, readDeck, readDocInput, same, sizeOf, spliceDoc } from './lib/deck.mjs'
import { formatInspect, inspectDoc } from './lib/inspect.mjs'
import { designDiff, lintDoc } from './lib/lint.mjs'
import { runCheck, runProbe } from './lib/render.mjs'
import { printFatal } from './lib/chrome.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const skillDir = path.dirname(here)
const repoRoot = path.resolve(skillDir, '../../../..')

/** The bundled app file and schema; in a repo checkout, the built ones. */
const APP_CANDIDATES = [path.join(skillDir, 'assets/Bento_Slides.bento.html'), path.join(repoRoot, 'slides/dist-single/Bento_Slides.bento.html')]
const SCHEMA_CANDIDATES = [path.join(skillDir, 'assets/slides.json'), path.join(repoRoot, 'schema/slides.json')]
const firstExisting = (list) => list.find((p) => fs.existsSync(p))

const HELP = {
  '': `bento — work on a .bento.html deck: new, extract, inspect, lint, render, apply

usage: node scripts/bento.mjs <verb> [args] [--json]

  new <out.bento.html>                    start a deck from the bundled app file
  extract <deck> [-o doc.json] [--compact] the document, without assets and sharing keys
  inspect <deck | doc.json>               the design system the deck already has
  lint <doc.json | deck> [--base orig.json] static checks; --base: the design-system diff
  render <deck | doc.json> [--png dir] [--slides 1,3-5]  findings + one PNG per slide (Chrome)
  apply <deck> <doc.json> [-o out.bento.html]  write the document back into the deck

The loop: inspect → extract → edit doc.json (reuse the tokens and components
inspect lists) → lint --base → apply → render --png → look → repeat.
Exit codes: 0 ok, 1 a check failed, 2 usage or input error, 3 no Chrome.
\`node scripts/bento.mjs <verb> --help\` for one verb.`,
  new: `bento new <out.bento.html> [--force] [--json]

Copies the bundled app file (assets/Bento_Slides.bento.html) to <out>. Nothing
is downloaded. The file's document block is empty: write a document into it
with \`bento apply <out> <doc.json>\`, or open it in a browser, where it starts
with the showcase deck. --force overwrites an existing file.`,
  extract: `bento extract <deck.bento.html> [-o doc.json] [--compact] [--json]

Writes the document to -o (default: <deck>.json beside the deck) WITHOUT
"assets" (pictures and fonts, often most of the bytes) and WITHOUT "collab"
(the deck's sharing keys, which an agent never needs and must never print).
Prints only the NAMES of the collab keys and of the assets, with their sizes.
\`bento apply\` puts both back. --compact writes the compact form (defaults left
out) through the deck's own runtime, which needs Chrome.`,
  inspect: `bento inspect <deck.bento.html | doc.json> [--json]

The deck's design system, so an edit reuses it instead of writing literals:
theme palette slots, design tokens by type with their value in every mode, the
share of style values bound through themeRefs, components (main, copies, the
keys copies override), doc.layouts, fonts (embedded, built-in, not embedded),
the most common unbound colours, font sizes and margins, and the slide list
(state and hidden slides marked).`,
  lint: `bento lint <doc.json | deck.bento.html> [--base orig.json] [--fail-on error|warning]
           [--allow-design-change] [--json]

Static checks, no browser: the schema (assets/slides.json), unknown element
types, colours the renderer cannot read, a parentId that names nothing, text
boxes on top of other content, text below WCAG contrast on what it sits on, a
token-bound literal that differs from its token, a component copy without sig,
duplicate ids. With --base (the document before the edit): the design-system
diff — theme, tokens, modes, component mains, layouts, fonts — which must be
empty unless the user asked for a design change (then pass
--allow-design-change), and the unbound literals the edit introduced.
Exit 1 on a finding at or above --fail-on (default error) or a design change.`,
  render: `bento render <deck.bento.html | doc.json> [--png dir] [--slides 1,3-5] [--shell app.bento.html]
             [--fail-on error|warning] [--timeout seconds] [--keep-tmp] [--json]

Loads the deck in headless Chrome with its OWN runtime and reports
window.bento.validate() findings (text overflow with the pixels it needs, off
canvas, dead links, effects that never run…). With --png: one PNG per shown
slide (page-NN.png, show order) and contact.png, all pages on one sheet;
--slides picks pages by number. A doc.json is loaded into --shell, else the
bundled app file. Chrome: BENTO_CHROME, else the usual paths and Playwright's
browsers; none found exits 3 and lists where it looked.`,
  apply: `bento apply <deck.bento.html> <doc.json> [-o out.bento.html] [--timeout seconds] [--json]

Splices the document back into the deck (in place, or to -o): escapes every
"<", restores "collab" and "docId" from the file, keeps "assets" last on their
own line (the file's assets, plus any the JSON adds), and refuses a document
whose docId is not the file's. An unchanged document leaves the file byte for
byte as it was. A compact document ("compact": true) is expanded by the deck's
own runtime first, which needs Chrome; without it, apply refuses and says so.`,
}

// ---- arguments ----------------------------------------------------------------
const argv = process.argv.slice(2)
const verb = argv[0] && !argv[0].startsWith('-') ? argv[0] : ''
const rest = verb ? argv.slice(1) : argv
const VALUED = new Set(['-o', '--out', '--base', '--png', '--slides', '--shell', '--fail-on', '--timeout'])
const opts = {}
const positional = []
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (VALUED.has(a)) { opts[a] = rest[++i]; continue }
  if (a.startsWith('-')) { opts[a] = true; continue }
  positional.push(a)
}
const asJson = !!opts['--json']

function fail(what, next, code = 2) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: what, next }, null, 2))
  else console.error(`bento ${verb || ''}: ${what}. Next: ${next}`.replace('bento : ', 'bento: '))
  process.exit(code)
}
const output = (obj, text) => { console.log(asJson ? JSON.stringify(obj, null, 2) : text) }
const kb = (n) => (n >= 1024 ? `${(n / 1024).toFixed(n >= 10240 ? 0 : 1)} KB` : `${n} B`)

if (opts['--help'] || opts['-h'] || !verb) {
  if (!verb || HELP[verb]) { console.log(HELP[verb] ?? HELP['']); process.exit(verb || opts['--help'] || opts['-h'] ? 0 : 2) }
}
if (!Object.hasOwn(HELP, verb)) fail(`unknown verb "${verb}"`, 'Run `node scripts/bento.mjs --help` for the six verbs: new, extract, inspect, lint, render, apply.')
const failOn = opts['--fail-on'] ?? 'error'
if (!['error', 'warning'].includes(failOn)) fail(`--fail-on takes error or warning, not "${failOn}"`, 'Pass --fail-on error or --fail-on warning.')
const timeoutS = opts['--timeout'] === undefined ? 90 : Number(opts['--timeout'])
if (!(timeoutS > 0) || !Number.isFinite(timeoutS)) fail(`--timeout takes a number of seconds, not "${opts['--timeout']}"`, 'Pass a positive number, e.g. --timeout 180.')
const need = (n, usage) => { if (positional.length < n) fail(`missing argument — usage: ${usage}`, `Run \`node scripts/bento.mjs ${verb} --help\`.`) }

function guard(fn) {
  return Promise.resolve().then(fn).catch((e) => {
    if (e instanceof DeckError) fail(e.message, e.next, e.code)
    fail(`unexpected error: ${e?.message ?? e}`, 'Rerun with the same arguments; if it repeats, report it with the command and the file.')
  })
}

// ---- new ---------------------------------------------------------------------------
async function cmdNew() {
  need(1, 'bento new <out.bento.html>')
  const out = positional[0]
  const app = firstExisting(APP_CANDIDATES)
  if (!app) {
    fail(`this copy of the skill carries no app file (looked for ${APP_CANDIDATES.join(' and ')})`,
      'Reinstall the skill from its release zip, which bundles it; or, in a repo checkout, run `cd slides && npm run build:single`; or download the signed app yourself: curl -fsSL https://bento.page/releases/slides/Bento_Slides.bento.html -o <out.bento.html>.')
  }
  if (fs.existsSync(out) && !opts['--force']) fail(`${out} already exists`, 'Pick another name, or pass --force to overwrite it.')
  if (!/\.bento\.html$/i.test(out)) fail(`${out} does not end in .bento.html`, 'Name it <Topic>.bento.html so it opens as a deck.')
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.copyFileSync(app, out)
  const bytes = fs.statSync(out).size
  output({ ok: true, file: out, bytes, from: app },
    `bento new — ${out} (${kb(bytes)})\n  An empty deck. Write a document into it: node scripts/bento.mjs apply ${out} doc.json\n  (or open it in a browser, where it starts with the showcase deck).`)
}

// ---- extract -----------------------------------------------------------------------
async function cmdExtract() {
  need(1, 'bento extract <deck> [-o doc.json] [--compact]')
  const deckPath = positional[0]
  const d = readDeck(deckPath)
  if (!d.doc) fail(`${deckPath} holds no document yet (a fresh app file)`, 'Write one into it with `bento apply <deck> <doc.json>`, or open it in a browser and save it.')
  const out = opts['-o'] ?? opts['--out'] ?? deckPath.replace(/(\.bento)?\.html?$/i, '') + '.json'
  if (path.resolve(out) === path.resolve(deckPath)) fail('-o names the deck itself', 'Write the JSON to another file, e.g. -o doc.json.')
  let doc
  if (opts['--compact']) {
    const r = await runProbe({ html: d.html, mode: 'compact', timeoutS, label: 'bento extract' })
    if (r.noChrome) fail(`--compact needs Chrome to run the deck's own compaction: ${r.noChrome.error}`, `Extract without --compact (the full form works everywhere), or: ${r.noChrome.next}`, 3)
    if (r.fatal) { if (!asJson) printFatal('bento extract', r); fail(`the deck's runtime could not write the compact form (${r.stage})`, 'Extract without --compact, which needs no browser.') }
    doc = r.report.doc
  } else {
    doc = d.doc
  }
  const { assets, collab, ...body } = doc
  fs.writeFileSync(out, JSON.stringify(body, null, 2) + '\n')
  const collabKeys = d.doc.collab && typeof d.doc.collab === 'object' ? Object.keys(d.doc.collab) : null
  const assetList = Object.entries(d.doc.assets ?? {}).map(([key, v]) => ({ key, bytes: sizeOf(v) }))
  const bytes = fs.statSync(out).size
  output({ ok: true, file: out, bytes, compact: !!opts['--compact'], slides: body.slides?.length ?? 0, collab: collabKeys ? { keys: collabKeys } : null, assets: assetList },
    `bento extract — ${out} (${kb(bytes)}, ${body.slides?.length ?? 0} slides${opts['--compact'] ? ', compact' : ''})\n` +
    `  left out, put back by apply:\n` +
    `    collab: ${collabKeys ? collabKeys.join(', ') + ' (values never printed)' : 'none'}\n` +
    `    assets (${assetList.length}): ${assetList.map((a) => `${a.key} ${kb(a.bytes)}`).join(', ') || 'none'}`)
}

// ---- inspect -----------------------------------------------------------------------
async function cmdInspect() {
  need(1, 'bento inspect <deck | doc.json>')
  const { doc } = readDocInput(positional[0])
  if (doc.compact === true) fail(`${positional[0]} is a compact document; inspect reads the full form`, 'Apply it to a deck first (`bento apply`), then inspect the deck.')
  if (!doc.theme || !Array.isArray(doc.slides)) fail(`${positional[0]} has no theme or slides`, 'Pass a bento/slides document: one that has "theme" and "slides".')
  const r = inspectDoc(doc)
  output({ ok: true, ...r }, formatInspect(r))
}

// ---- lint --------------------------------------------------------------------------
async function cmdLint() {
  need(1, 'bento lint <doc.json | deck> [--base orig.json]')
  const { doc } = readDocInput(positional[0])
  if (!Array.isArray(doc.slides)) fail(`${positional[0]} has no "slides" array`, 'Pass a bento/slides document: { "format": "bento/slides", "slides": [...] }.')
  const schemaPath = firstExisting(SCHEMA_CANDIDATES)
  let schema = null
  if (schemaPath) { try { schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) } catch {} }
  const { findings, counts } = lintDoc(doc, { schema })
  if (!schema) findings.unshift({ code: 'no-schema', severity: 'info', message: `No schema found (looked for ${SCHEMA_CANDIDATES.join(' and ')}), so the shape was not checked. Reinstall the skill from its release zip.` })
  let diff = null
  if (opts['--base']) {
    const base = readDocInput(opts['--base']).doc
    diff = designDiff(base, doc)
  }
  const errors = counts.error, warnings = counts.warning
  const designChanged = !!diff && diff.changes.length > 0 && !opts['--allow-design-change']
  const failed = (failOn === 'error' ? errors > 0 : errors + warnings > 0) || designChanged
  if (asJson) {
    console.log(JSON.stringify({ ok: !failed, file: positional[0], counts, findings, designSystem: diff ? { changes: diff.changes, introducedLiterals: diff.introduced.length, introduced: diff.introduced.slice(0, 200) } : null }, null, 2))
  } else {
    const lines = [`bento lint — ${positional[0]}: ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}, ${counts.info} info`]
    const by = new Map()
    for (const f of findings) { const k = f.slide ?? '(document)'; if (!by.has(k)) by.set(k, []); by.get(k).push(f) }
    let shown = 0
    for (const [slide, list] of by) {
      if (shown >= 60) break
      lines.push(`\n  ${slide}`)
      for (const f of list) {
        if (shown++ >= 60) break
        lines.push(`    ${f.severity.padEnd(7)} ${f.code}${f.element ? ` [${f.element}]` : ''}: ${f.message}${f.path ? `  (${f.path})` : ''}`)
      }
    }
    if (findings.length > 60) lines.push(`\n  … ${findings.length - 60} more; --json lists them all`)
    if (diff) {
      lines.push(`\n  design system vs ${opts['--base']}: ${diff.changes.length ? `${diff.changes.length} change${diff.changes.length === 1 ? '' : 's'}` : 'unchanged'}`)
      for (const c of diff.changes.slice(0, 30)) lines.push(`    ${c.area} ${c.name}: ${c.change}${c.before !== undefined ? ` ${c.before}` : ''}${c.after !== undefined ? ` → ${c.after}` : ''}`)
      lines.push(`  unbound literals the edit introduced: ${diff.introduced.length}${diff.introduced.length ? ' — ' + diff.introduced.slice(0, 8).map((v) => `${v.element ?? v.slide}.${v.key}=${JSON.stringify(v.value)}`).join(', ') + (diff.introduced.length > 8 ? ', …' : '') : ''}`)
      if (designChanged) lines.push(`  The edit changes the deck's design system. If the user asked for that, rerun with --allow-design-change; otherwise put those values back and reuse what \`bento inspect\` lists.`)
    }
    lines.push(`\n${failed ? 'FAILED' : 'OK'} (--fail-on ${failOn})`)
    console.log(lines.join('\n'))
  }
  process.exit(failed ? 1 : 0)
}

// ---- render ------------------------------------------------------------------------
async function cmdRender() {
  need(1, 'bento render <deck | doc.json> [--png dir] [--slides 1,3-5]')
  const input = positional[0]
  if (!fs.existsSync(input)) fail(`no such file: ${input}`, 'Check the path.')
  let pages = null
  if (opts['--slides'] !== undefined) {
    pages = parseRanges(opts['--slides'])
    if (!pages) fail(`--slides takes page numbers like 1,3-5, not "${opts['--slides']}"`, 'Pass 1-based page numbers in show order, e.g. --slides 2 or --slides 1,3-5.')
    if (!opts['--png']) fail('--slides picks which pages to write, so it needs --png', 'Add --png <dir>.')
  }
  let html, docJson = null
  if (/\.html?$/i.test(input)) {
    const d = readDeck(input)
    if (!d.doc) fail(`${input} holds no document yet (a fresh app file)`, 'Write one into it with `bento apply` first.')
    html = d.html
  } else {
    readDocInput(input) // JSON errors with the fix, before Chrome starts
    docJson = fs.readFileSync(input, 'utf8')
    const shell = opts['--shell'] ?? firstExisting(APP_CANDIDATES)
    if (!shell || !fs.existsSync(shell)) fail(`a JSON document needs an app to load into, and there is none (looked for ${opts['--shell'] ?? APP_CANDIDATES.join(' and ')})`, 'Pass --shell <app.bento.html>, or render the deck file instead.')
    html = fs.readFileSync(shell, 'utf8')
    if (!html.includes('id="bento-doc"')) fail(`${shell} carries no #bento-doc block — not a bento file`, 'Pass --shell a .bento.html app file.')
  }
  const code = await runCheck({ input, html, docJson, pngDir: opts['--png'] ?? null, pages, failOn, json: asJson, timeoutS, keepTmp: !!opts['--keep-tmp'], label: 'bento render', noChromeExit: 3 })
  process.exit(code)
}

// ---- apply -------------------------------------------------------------------------
async function cmdApply() {
  need(2, 'bento apply <deck> <doc.json> [-o out.bento.html]')
  const [deckPath, docPath] = positional
  const d = readDeck(deckPath)
  if (/\.html?$/i.test(docPath)) fail(`${docPath} is a deck; apply takes a document JSON`, 'Extract it first: `bento extract <deck> -o doc.json`.')
  let { doc: edited } = readDocInput(docPath)
  let load = null
  if (edited.compact === true) {
    // expanded by the runtime that will open it, with the file's pictures in reach
    const withAssets = d.doc?.assets && !edited.assets ? { ...edited, assets: d.doc.assets } : edited
    const r = await runProbe({ html: d.html, mode: 'expand', docJson: JSON.stringify(withAssets), timeoutS, label: 'bento apply' })
    if (r.noChrome) fail(`a compact document is expanded by the deck's own runtime, which needs Chrome: ${r.noChrome.error}`, `Write the full form instead (\`bento extract\` without --compact gives one), or: ${r.noChrome.next}`, 3)
    if (r.fatal) { if (!asJson) printFatal('bento apply', r); fail(`the deck's runtime could not expand the document (${r.stage})`, 'Run `bento lint` on the JSON, fix what it reports, and apply again.') }
    const full = JSON.parse(r.report.doc)
    // identity is the file's (or the JSON's own for a fresh app file), never
    // the one a throwaway browser session minted while expanding
    delete full.collab
    if (edited.docId) full.docId = edited.docId
    else delete full.docId
    if (!edited.assets) delete full.assets
    edited = full
    load = r.report.load
  }
  if (!Array.isArray(edited.slides) || !edited.slides.length) fail(`${docPath} has no slides`, 'Write a document with at least one slide in "slides".')
  const merged = mergeEnvelope(d.doc, edited)
  const out = opts['-o'] ?? opts['--out'] ?? deckPath
  const unchanged = !!d.doc && same(merged, d.doc)
  const html = unchanged ? d.html : spliceDoc(d.html, d.block, merged)
  if (!(unchanged && out === deckPath)) {
    const tmp = `${out}.tmp-${process.pid}`
    fs.writeFileSync(tmp, html)
    fs.renameSync(tmp, out)
  }
  const dropped = load?.dropped ?? []
  output({ ok: true, file: out, changed: !unchanged, bytes: Buffer.byteLength(html), slides: merged.slides.length, collabRestored: !!d.doc?.collab, assets: Object.keys(merged.assets ?? {}).length, expanded: load?.expanded ?? null, dropped },
    `bento apply — ${out}: ${unchanged ? 'no change, the file is as it was' : `${merged.slides.length} slides written`} (${kb(Buffer.byteLength(html))})` +
    (d.doc?.collab ? '\n  collab and docId kept from the file' : '') +
    (load ? `\n  compact document expanded by the deck's runtime: ${load.expanded ?? 0} fields filled, ${dropped.length} dropped` : '') +
    dropped.slice(0, 20).map((x) => `\n    dropped ${x.path}  ${x.reason}`).join('') +
    `\n  Next: node scripts/bento.mjs render ${out} --png <dir>, and look at contact.png.`)
}

await guard({ new: cmdNew, extract: cmdExtract, inspect: cmdInspect, lint: cmdLint, render: cmdRender, apply: cmdApply }[verb])
