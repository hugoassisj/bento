#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// bento check — the closing half of an agent's loop: write a deck, LOOK at it.
//
//   node scripts/bento-check.mjs <deck.bento.html | doc.json>
//        [--shell path] [--png outdir] [--json] [--fail-on error|warning]
//        [--timeout seconds] [--keep-tmp]
//
// Loads the deck in headless Chrome — the real shell, the real renderer, the
// deck's own fonts — and reports what the runtime would otherwise swallow:
// `window.bento.validate()` findings (unknown keys, text that overflows its
// box, elements off the canvas, entrances that can never run, broken links and
// asset refs), the load report when the input was JSON (what the gate dropped,
// what compact expansion filled — fields a shell without #484 does not carry,
// tolerated), and with --png one PNG per slide in show order through the same
// render→canvas path Save ▾ Export slides as images uses (#480) — the shell's
// own window.bento.render() where it has one (AI-06) — plus a contact sheet so
// an agent can look at the whole deck in one image.
//
// ONE IMPLEMENTATION. This is a thin wrapper over the skill's `bento render`
// (plugins/bento-slides/skills/bento-slides/scripts/lib/render.mjs and
// chrome.mjs: the Chrome lookup, the local server, the probe, the stages a
// failure names, the cleanup that can never fail a run). What it adds is the
// repo: the built shell as the default for a JSON input, and, for a shell from
// before window.bento.render(), a rasteriser bundled by esbuild from the
// repo's own sources (#480's rasterizeSlide in slides/src/editor/exportimages.ts)
// so an old deck still gets its pictures.
//
// INPUT. A .bento.html is used as-is (it IS shell + document). A .json is a
// document — full, or compact once the shell accepts `"compact": true` — and
// is handed to `window.bento.loadDoc()` inside a shell: --shell, else
// slides/dist-single/Bento_Slides.bento.html (build it with
// `cd slides && npm run build:single`).

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCheck } from '../plugins/bento-slides/skills/bento-slides/scripts/lib/render.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const flag = (name) => argv.includes(name)
const input = argv.find((a, i) => !a.startsWith('--') && !['--shell', '--png', '--fail-on', '--timeout'].includes(argv[i - 1]))
const asJson = flag('--json')
const pngDir = opt('--png')
const failOn = opt('--fail-on') ?? 'error'
const shellPath = opt('--shell') ?? path.join(root, 'slides/dist-single/Bento_Slides.bento.html')
const timeoutArg = opt('--timeout')
const TIMEOUT_S = timeoutArg === undefined ? 90 : Number(timeoutArg)
const keepTmp = flag('--keep-tmp')

const USAGE = 'usage: node scripts/bento-check.mjs <deck.bento.html | doc.json> [--shell path] [--png outdir] [--json] [--fail-on error|warning] [--timeout seconds] [--keep-tmp]'
const die = (msg, code = 2) => { console.error(`bento check: ${msg}`); process.exit(code) }
if (!input) die(USAGE)
if (!['error', 'warning'].includes(failOn)) die(`--fail-on takes error or warning, not "${failOn}"`)
if (!(TIMEOUT_S > 0) || !Number.isFinite(TIMEOUT_S)) die(`--timeout takes a number of seconds, not "${timeoutArg}"`)
if (!fs.existsSync(input)) die(`no such file: ${input}`)

// ---- input → the html Chrome will load + the JSON the probe will load --------
const isHtml = /\.html?$/i.test(input)
let deckHtml
let docJson = null
if (isHtml) {
  deckHtml = fs.readFileSync(input, 'utf8')
} else {
  if (!fs.existsSync(shellPath)) die(`no shell at ${shellPath} — run \`cd slides && npm run build:single\`, or pass --shell`)
  deckHtml = fs.readFileSync(shellPath, 'utf8')
  docJson = fs.readFileSync(input, 'utf8')
  try { JSON.parse(docJson) } catch (e) { die(`${input} is not JSON: ${e.message}`) }
}
if (!deckHtml.includes('id="bento-doc"')) die(`${isHtml ? input : shellPath} carries no #bento-doc block — not a Bento file`)

// ---- for shells without window.bento.render: #480's rasterizeSlide, bundled --
// Only where the repo can build it; a current shell never needs it.
let legacy = null
const esbuild = path.join(root, 'slides/node_modules/.bin/esbuild')
if (pngDir && fs.existsSync(esbuild)) {
  const exportImagesPath = path.join(root, 'slides/src/editor/exportimages.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bento-check-legacy-'))
  const removeDir = () => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }) } catch {} }
  try {
    fs.writeFileSync(path.join(dir, 'entry.js'), `
import { rasterizeSlide } from ${JSON.stringify(exportImagesPath)}
if (typeof window.bento?.render !== 'function') {
  window.__bentoLegacyRaster = async (doc, slide) => {
    const blob = await rasterizeSlide(doc, slide, 'png', 1)
    return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob) })
  }
}
`)
    const built = spawnSync(esbuild, [path.join(dir, 'entry.js'), '--bundle', '--format=esm', '--log-level=error', '--outfile=' + path.join(dir, 'legacy.js')], { stdio: ['ignore', 'pipe', 'pipe'] })
    // die() exits, which skips the finally below: remove the directory first
    if (built.status !== 0) { removeDir(); die(`could not bundle the probe:\n${built.stderr}`) }
    legacy = fs.readFileSync(path.join(dir, 'legacy.js'), 'utf8')
  } finally {
    removeDir()
  }
}

process.exit(await runCheck({
  input, html: deckHtml, docJson, pngDir, failOn, json: asJson, timeoutS: TIMEOUT_S, keepTmp,
  label: 'bento check', noChromeExit: 2, legacy,
}))
