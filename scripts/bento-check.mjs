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
// HOW IT DRIVES CHROME. The harness the sanitize and embed rigs use, reused:
// a local http server hands Chrome the deck with a probe module appended and
// a load gate (an <img> the server answers only once the probe has POSTed its
// report), Chrome runs `--headless=new --dump-dom` and exits at load. No
// puppeteer, no CDP client, no new dependency — system Chrome via the same
// BENTO_CHROME lookup the rigs share, then Playwright's browsers. The probe is
// bundled by esbuild against the repo's own sources, so the pixels are the
// shipping code path.
//
// WHEN IT FAILS it says where (AI-05). The server records each request and the
// probe posts a beacon at each step, so a fatal names the stage that never
// happened — Chrome never asked for the page, never asked for the probe, the
// shell never booted, or the report never came — with Chrome's exit code and
// the tail of its stderr. Cleanup of the temp profile can never fail a run:
// Chrome's helper processes outlive the browser process and keep writing into
// it, which turned successful runs into an uncaught ENOTEMPTY.
//
// INPUT. A .bento.html is used as-is (it IS shell + document). A .json is a
// document — full, or compact once the shell accepts `"compact": true` — and
// is handed to `window.bento.loadDoc()` inside a shell: --shell, else
// slides/dist-single/Bento_Slides.bento.html (build it with
// `cd slides && npm run build:single`).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ---- Chrome — the rigs' lookup, then Playwright's browsers ----------------------
// BENTO_CHROME wins and is never skipped silently: a path that does not exist
// is an error that names it. Then the usual install paths, then the browsers
// Playwright downloads (PLAYWRIGHT_BROWSERS_PATH, its per-user cache, the
// /opt/pw-browsers of many CI images), full Chromium before the headless shell.
const playwrightChromes = () => {
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0' ? process.env.PLAYWRIGHT_BROWSERS_PATH : null,
    path.join(os.homedir(), '.cache/ms-playwright'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    '/opt/pw-browsers',
  ].filter(Boolean)
  const full = [], shells = []
  for (const r of roots) {
    let dirs = []
    try { dirs = fs.readdirSync(r) } catch { continue }
    // newest revision first
    const byRev = (re) => dirs.filter((d) => re.test(d)).sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()))
    for (const d of byRev(/^chromium-\d+$/)) {
      full.push(
        path.join(r, d, 'chrome-linux64/chrome'),
        path.join(r, d, 'chrome-linux/chrome'),
        path.join(r, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(r, d, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(r, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      )
    }
    for (const d of byRev(/^chromium_headless_shell-\d+$/)) {
      shells.push(
        path.join(r, d, 'chrome-headless-shell-linux64/chrome-headless-shell'),
        path.join(r, d, 'chrome-linux/headless_shell'),
        path.join(r, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
        path.join(r, d, 'chrome-headless-shell-mac-x64/chrome-headless-shell'),
      )
    }
  }
  return [...full, ...shells]
}
const SYSTEM_CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const findChrome = () => {
  const env = process.env.BENTO_CHROME
  if (env) {
    if (!fs.existsSync(env)) die(`BENTO_CHROME is ${env}, which does not exist — point it at a Chrome or Chromium binary, or unset it to search the usual places`)
    return env
  }
  return [...SYSTEM_CHROMES, ...playwrightChromes()].find((p) => fs.existsSync(p))
    ?? (spawnSync('which', ['google-chrome']).status === 0 ? 'google-chrome' : undefined)
}
const chrome = findChrome()
if (!chrome) {
  die('no Chrome found. Looked for BENTO_CHROME (unset), ' + SYSTEM_CHROMES.join(', ') +
    ', google-chrome on PATH, and Playwright\'s browsers (PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright, ~/Library/Caches/ms-playwright, /opt/pw-browsers). ' +
    'Install Google Chrome, or set BENTO_CHROME to a Chrome or Chromium binary')
}
// A headless-shell build has only the old headless mode; give it the flag it
// knows rather than rely on it ignoring --headless=new.
let chromeReal = chrome
try { chromeReal = fs.realpathSync(chrome) } catch {}
const headlessShell = /headless[_-]shell/i.test(chrome + ' ' + chromeReal)

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

// ---- the probe, bundled against the repo's own sources ----------------------
const esbuild = path.join(root, 'slides/node_modules/.bin/esbuild')
if (!fs.existsSync(esbuild)) die('slides/node_modules is missing — run `cd slides && npm install`')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bento-check-'))
// Removing the temp directory never fails the run: wait for Chrome first, retry
// what its late writes make transiently undeletable, and say in one line what
// was left behind if it still cannot go.
const cleanup = () => {
  if (keepTmp) { console.error(`bento check: kept the temp directory (Chrome profile, probe): ${tmp}`); return }
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  catch (e) { console.error(`bento check: warning: could not remove the temp directory ${tmp} (${e.code ?? e.message}) — delete it by hand`) }
}
const exportImagesPath = path.join(root, 'slides/src/editor/exportimages.ts')
const exportDecisionsPath = path.join(root, 'slides/src/exportimages.ts')

// Written by concatenation: never a literal script-close in a source file.
const probeSrc = `
import { rasterizeSlide } from ${JSON.stringify(exportImagesPath)}
import { exportableSlides, pixelSize } from ${JSON.stringify(exportDecisionsPath)}

const WANT_PNG = ${JSON.stringify(!!pngDir)}
const DOC_JSON = ${JSON.stringify(docJson)}
const BOOT_MS = ${Math.max(500, Math.min(30_000, TIMEOUT_S * 1000 - 1000))}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = (body) => fetch('/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
// a beacon per step, so a run that never reports can say how far it got
const stage = (name) => fetch('/stage', { method: 'POST', body: name }).catch(() => {})

async function main() {
  stage('started')
  const t0 = performance.now()
  let bento
  for (let i = 0; i < BOOT_MS / 50 && !(bento = window.bento?.doc && window.bento); i++) await sleep(50)
  if (!bento) return post({ fatal: 'the shell did not boot within ' + (BOOT_MS / 1000) + ' s (the probe ran, but window.bento never appeared)', stage: 'boot' })
  stage('booted')
  if (document.fonts?.ready) await document.fonts.ready

  let load = null
  if (DOC_JSON !== null) {
    // A compact document on a shell that predates compact input (#484) is not
    // refused by the gate — it is accepted and then the editor throws on the
    // first missing field. Say so before that happens.
    let parsed = null
    try { parsed = JSON.parse(DOC_JSON) } catch {}
    if (parsed && parsed.compact === true && typeof bento.compact !== 'function') {
      return post({ fatal: 'this shell does not accept compact documents ("compact": true needs a shell built with #484 — window.bento.compact is absent); pass a full document, or --shell a newer build' })
    }
    let r
    try { r = bento.loadDoc(DOC_JSON) } catch (e) { return post({ fatal: 'the shell threw while loading the document: ' + String(e && e.message || e) }) }
    if (r === false) return post({ fatal: 'the shell refused the document: loadDoc() returned false (not valid bento/slides JSON, or a compact document on a shell without #484)' })
    load = r && typeof r === 'object' ? r : { ok: true }
    await sleep(50)
    stage('loaded the document')
  }
  const doc = bento.doc
  const v = bento.validate()
  stage('validated')
  const pages = []
  let contact = null
  const shown = exportableSlides(doc)
  // A shell with window.bento.render (AI-06) draws its own pages — the same
  // rasterizeSlide, from the shell's own code; an older shell gets the copy
  // bundled here from the repo's sources.
  const renderer = typeof bento.render === 'function' ? 'window.bento.render' : 'bundled probe'
  if (WANT_PNG) {
    const thumbs = []
    for (const slide of shown) {
      stage('rendering slide ' + (pages.length + 1) + ' of ' + shown.length)
      let url
      if (renderer === 'window.bento.render') {
        const r = await bento.render(slide.id, { format: 'png', scale: 1 })
        if (!r.ok) return post({ fatal: 'window.bento.render could not draw slide ' + slide.id + ': ' + r.err + ' (' + r.detail + ')', stage: 'render' })
        url = r.dataUrl
      } else {
        const blob = await rasterizeSlide(doc, slide, 'png', 1)
        url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob) })
      }
      pages.push(url)
      thumbs.push(url)
    }
    // contact sheet: up to 4 across, 320 px wide each, the deck's aspect
    const { width: w, height: h } = doc.size
    const tw = 320, th = Math.round(320 * h / w), gap = 12, cols = Math.min(4, Math.max(1, thumbs.length))
    const rows = Math.ceil(thumbs.length / cols)
    const c = document.createElement('canvas')
    c.width = cols * tw + (cols + 1) * gap
    c.height = rows * (th + 22) + (rows + 1) * gap
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#e9ecef'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#334'; ctx.font = '12px system-ui, sans-serif'
    for (let i = 0; i < thumbs.length; i++) {
      const img = new Image(); img.src = thumbs[i]; await img.decode()
      const x = gap + (i % cols) * (tw + gap), y = gap + Math.floor(i / cols) * (th + 22 + gap)
      ctx.drawImage(img, x, y, tw, th)
      ctx.fillText(String(i + 1).padStart(2, '0'), x, y + th + 15)
    }
    contact = c.toDataURL('image/png')
  }
  return post({
    ok: v.ok,
    title: doc.title,
    size: doc.size,
    slides: doc.slides.length,
    shown: shown.length,
    pixel: pixelSize(doc, 1),
    counts: v.counts,
    measured: v.measured,
    findings: v.findings,
    load,
    pages,
    contact,
    renderer: WANT_PNG ? renderer : null,
    ms: Math.round(performance.now() - t0),
  })
}
main().catch((e) => post({ fatal: String(e && e.stack || e) }))
`
fs.writeFileSync(path.join(tmp, 'probe-entry.js'), probeSrc)
const built = spawnSync(esbuild, [
  path.join(tmp, 'probe-entry.js'), '--bundle', '--format=esm', '--log-level=error',
  '--outfile=' + path.join(tmp, 'probe.js'),
], { stdio: ['ignore', 'pipe', 'pipe'] })
if (built.status !== 0) { cleanup(); die(`could not bundle the probe:\n${built.stderr}`) }
const probe = fs.readFileSync(path.join(tmp, 'probe.js'), 'utf8')

// The deck, with the probe appended and the load gate after it. The gate is
// load-bearing (see test-sanitize): the new headless fires --dump-dom at the
// load event, so the page must not finish loading until the report is in.
const page = deckHtml +
  '\n<scr' + 'ipt type="module" src="/probe.js"></scr' + 'ipt>' +
  '<img src="/gate.gif" width="1" height="1" alt="">'

// ---- serve, run, collect -------------------------------------------------------
const started = Date.now()
let report = null
let releaseGate = null
let child = null
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
const dbg = (...a) => { if (process.env.BENTO_CHECK_DEBUG) console.error(`[${Date.now() - started} ms]`, ...a) }
// What the server has seen, in order — the stage a failure stopped at.
const seen = { page: false, probe: false, started: false, booted: false, last: '' }
const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  dbg(req.method, url)
  if (url === '/deck.html') { seen.page = true; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return }
  if (url === '/probe.js') { seen.probe = true; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(probe); return }
  if (url === '/stage' && req.method === 'POST') {
    let body = ''
    req.on('data', (b) => { body += b })
    req.on('end', () => {
      if (body === 'started') seen.started = true
      else if (body === 'booted') seen.booted = true
      seen.last = body.slice(0, 80)
      dbg('stage', body)
      res.writeHead(204); res.end()
    })
    return
  }
  if (url === '/report' && req.method === 'POST') {
    let body = ''
    req.on('data', (b) => { body += b })
    req.on('end', () => {
      try { report = JSON.parse(body) } catch { report = { fatal: 'the probe posted something that was not JSON' } }
      res.writeHead(204); res.end()
      dbg('report received', releaseGate ? '(gate waiting → released)' : '(gate not yet requested)')
      releaseGate?.()
      // The report is the deliverable, not the dump: the shell keeps the page
      // busy past load (measured: Chrome sat 88 s after the gate opened), so
      // Chrome is closed the moment the report is in.
      setTimeout(() => stopChrome('SIGTERM'), 100)
      setTimeout(() => stopChrome('SIGKILL'), 5000)
    })
    return
  }
  if (url === '/gate.gif') {
    const send = () => { res.writeHead(200, { 'content-type': 'image/gif' }); res.end(gif) }
    if (report) send(); else releaseGate = send
    return
  }
  res.writeHead(404); res.end()
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

// The stage a run that never reported stopped at, in words, with its key.
const stageNow = () => {
  if (!seen.page) return { stage: 'page', what: 'Chrome never requested the page' }
  if (!seen.probe) return { stage: 'probe', what: 'Chrome loaded the page but never requested the probe module' }
  if (!seen.started) return { stage: 'probe-run', what: 'the probe module was fetched but never ran' }
  if (!seen.booted) return { stage: 'boot', what: 'the probe ran but the shell never booted (window.bento never appeared)' }
  return { stage: 'report', what: `the shell booted but the report never arrived (last step: ${seen.last})` }
}

// Chrome runs in its own process group (not on Windows), so stopping it stops
// its helpers too — they are what kept writing into the profile after the
// browser process had gone.
const ownGroup = process.platform !== 'win32'
const stopChrome = (sig) => {
  if (!child?.pid) return
  try { if (ownGroup) process.kill(-child.pid, sig); else child.kill(sig) } catch {}
}
let stderrTail = ''
let exitCode = null
let exitSignal = null
let spawnError = null
let timedOut = false
const onSignal = (sig) => { stopChrome('SIGKILL'); server.close(); cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143) }
process.once('SIGINT', onSignal)
process.once('SIGTERM', onSignal)

// spawn, never spawnSync: the server lives in this process.
child = spawn(chrome, [
  headlessShell ? '--headless' : '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking',
  '--disable-component-update', '--disable-sync', '--disable-default-apps',
  '--hide-scrollbars', '--window-size=1600,1000',
  '--user-data-dir=' + path.join(tmp, 'profile'),
  '--dump-dom', `http://127.0.0.1:${port}/deck.html`,
], { stdio: ['ignore', 'ignore', 'pipe'], detached: ownGroup })
child.stderr.on('data', (b) => { stderrTail = (stderrTail + b).slice(-4096) })
await new Promise((resolve) => {
  const timer = setTimeout(() => { timedOut = !report; stopChrome('SIGKILL') }, TIMEOUT_S * 1000)
  // after a SIGTERM, a Chrome that lingers is killed
  let lingering = null
  child.on('error', (e) => { spawnError = e; clearTimeout(timer); resolve() })
  child.on('exit', (code, signal) => {
    exitCode = code; exitSignal = signal
    dbg('chrome exited', code, signal)
    lingering = setTimeout(() => stopChrome('SIGKILL'), 5000)
  })
  child.on('close', () => { clearTimeout(timer); clearTimeout(lingering); resolve() })
})
stopChrome('SIGKILL') // any helper still in the group
server.close()
cleanup()
process.off('SIGINT', onSignal)
process.off('SIGTERM', onSignal)
const wall = Date.now() - started

const chromeInfo = { path: chrome, headless: headlessShell ? '--headless' : '--headless=new' }
if (!report || report.fatal) {
  let fatal, stage
  if (spawnError) {
    stage = 'start'
    fatal = `could not start Chrome at ${chrome}: ${spawnError.message} — set BENTO_CHROME to a Chrome or Chromium binary you can run`
  } else if (report?.fatal) {
    stage = report.stage ?? stageNow().stage
    fatal = report.fatal
  } else {
    const at = stageNow()
    stage = at.stage
    if (timedOut) {
      fatal = `no report within ${TIMEOUT_S} s (--timeout ${TIMEOUT_S}): ${at.what}. A long deck or a slow machine needs more time: raise it with --timeout <seconds>`
    } else {
      const how = exitSignal ? `was killed by ${exitSignal}` : `exited with code ${exitCode}`
      fatal = `Chrome (${chrome}) ${how} before the probe reported: ${at.what}. ` +
        (stage === 'page' ? 'Run the binary by hand to see why it does not start, or set BENTO_CHROME to another Chrome' : 'Rerun with BENTO_CHECK_DEBUG=1 to see each request')
    }
  }
  const tail = stderrTail.trim()
  if (asJson) {
    console.log(JSON.stringify({ ok: false, fatal, stage, chrome: { ...chromeInfo, exitCode, signal: exitSignal, stderr: tail }, ms: wall }, null, 2))
  } else {
    console.error(`bento check: ${fatal}`)
    console.error(`  Chrome: ${chrome}${exitCode !== null ? ` (exit code ${exitCode})` : exitSignal ? ` (${exitSignal})` : ''}`)
    // the last lines; --json carries the whole 4 KB tail
    if (tail) console.error(`  Chrome's last output:\n${tail.split('\n').slice(-12).map((l) => '    ' + l).join('\n')}`)
  }
  process.exit(2)
}

// ---- files ------------------------------------------------------------------------
const written = []
if (pngDir) {
  fs.mkdirSync(pngDir, { recursive: true })
  const toFile = (dataUrl, name) => {
    const p = path.join(pngDir, name)
    fs.writeFileSync(p, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    written.push(p)
  }
  report.pages.forEach((u, i) => toFile(u, `page-${String(i + 1).padStart(2, '0')}.png`))
  if (report.contact) toFile(report.contact, 'contact.png')
}

// ---- the report ----------------------------------------------------------------------
const findings = report.findings ?? []
const overflow = findings.filter((f) => f.code === 'text-overflow' || f.code === 'table-overflow')
const dropped = report.load?.dropped ?? []
const errors = findings.filter((f) => f.severity === 'error').length
const warnings = findings.filter((f) => f.severity === 'warning').length
const failed = failOn === 'error' ? errors > 0 : errors + warnings > 0
const out = {
  ok: !failed,
  file: input,
  title: report.title,
  slides: report.slides,
  shown: report.shown,
  counts: report.counts,
  measured: report.measured,
  findings,
  overflow,
  dropped,
  expanded: report.load?.expanded ?? null,
  pages: written.filter((p) => !p.endsWith('contact.png')),
  contact: written.find((p) => p.endsWith('contact.png')) ?? null,
  renderer: report.renderer ?? null,
  chrome: chromeInfo,
  ms: wall,
}

if (asJson) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`bento check — ${report.title ?? input}`)
  console.log(`  Chrome: ${chrome}`)
  console.log(`  ${report.slides} slides (${report.shown} shown), ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}${report.measured === false ? ' (text not measured: no layout)' : ''}, ${wall} ms`)
  if (dropped.length) {
    console.log(`\n  dropped on load (${dropped.length}):`)
    for (const d of dropped) console.log(`    ${d.path}  ${d.reason}`)
  }
  if (out.expanded) console.log(`  compact expansion filled ${out.expanded} field${out.expanded === 1 ? '' : 's'}`)
  const bySlide = new Map()
  for (const f of findings) {
    const k = f.slide ?? '(document)'
    if (!bySlide.has(k)) bySlide.set(k, [])
    bySlide.get(k).push(f)
  }
  for (const [slide, list] of bySlide) {
    console.log(`\n  ${slide}`)
    for (const f of list) {
      const where = f.element ? ` [${f.element}]` : ''
      const at = f.path ? `  (${f.path})` : ''
      console.log(`    ${f.severity.padEnd(7)} ${f.code}${where}: ${f.message}${at}`)
    }
  }
  if (written.length) {
    console.log(`\n  images: ${out.pages.length} page${out.pages.length === 1 ? '' : 's'} in ${pngDir}${out.contact ? ' + contact.png' : ''}`)
  }
  console.log(`\n${out.ok ? 'OK' : 'FAILED'} (--fail-on ${failOn})`)
}
process.exit(out.ok ? 0 : 1)
