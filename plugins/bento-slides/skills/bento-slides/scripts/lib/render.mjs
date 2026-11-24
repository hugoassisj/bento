// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Render and check a deck in its own runtime: validate() findings, the load
// report for a JSON input, one PNG per shown slide and a contact sheet. The
// one implementation behind `bento render` and the repo's
// scripts/bento-check.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { findChrome, printFatal, runInChrome } from './chrome.mjs'
import { probeSource } from './probe.mjs'

/**
 * Run a check. Prints the result (JSON with `json`, a summary otherwise) and
 * returns the exit code: 0 clean, 1 a finding at or above `failOn`, 2 the run
 * could not finish, `noChromeExit` when there is no Chrome.
 *
 * opts: { input, html, docJson, pngDir, pages ('all' | number[] | null),
 *         failOn, json, timeoutS, keepTmp, label, noChromeExit, legacy }
 * `html` is the page to load (the deck, or the shell for a JSON input) and
 * `legacy` an optional module source that sets window.__bentoLegacyRaster.
 */
export async function runCheck(opts) {
  const { input, html, docJson = null, pngDir = null, failOn = 'error', json = false, timeoutS = 90, keepTmp = false, label = 'bento render', noChromeExit = 3, legacy = null } = opts
  const pages = pngDir ? (opts.pages ?? 'all') : null
  const found = findChrome()
  if (!found.path) {
    if (json) console.log(JSON.stringify({ ok: false, fatal: `${found.error}. Next: ${found.next}`, stage: 'chrome' }, null, 2))
    else console.error(`${label}: ${found.error}. Next: ${found.next}`)
    return noChromeExit
  }
  const chrome = found.path
  const modules = {}
  if (legacy) modules['/legacy.js'] = legacy
  modules['/probe.js'] = probeSource({ mode: 'check', docJson, pages, bootMs: timeoutS * 1000 - 1000 })
  const r = await runInChrome({ chrome, html, modules, timeoutS, keepTmp, label })
  const chromeInfo = { path: chrome, headless: r.chrome.headless }
  if (r.fatal) {
    if (json) console.log(JSON.stringify({ ok: false, fatal: r.fatal, stage: r.stage, chrome: { ...chromeInfo, exitCode: r.chrome.exitCode, signal: r.chrome.signal, stderr: r.chrome.stderr }, ms: r.chrome.ms }, null, 2))
    else printFatal(label, r)
    return 2
  }
  const report = r.report
  const wall = r.chrome.ms

  const written = []
  if (pngDir) {
    fs.mkdirSync(pngDir, { recursive: true })
    const toFile = (dataUrl, name) => {
      const p = path.join(pngDir, name)
      fs.writeFileSync(p, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
      written.push(p)
    }
    for (const pg of report.pages ?? []) toFile(pg.url, `page-${String(pg.n).padStart(2, '0')}.png`)
    if (report.contact) toFile(report.contact, 'contact.png')
  }

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

  if (json) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log(`${label} — ${report.title ?? input}`)
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
  return out.ok ? 0 : 1
}

/**
 * Run the probe in another mode ('expand' or 'compact') against `html`.
 * Returns { report } or { fatal, stage, chrome } / { noChrome: { error, next } }.
 */
export async function runProbe({ html, mode, docJson = null, timeoutS = 90, label = 'bento' }) {
  const found = findChrome()
  if (!found.path) return { noChrome: found }
  return runInChrome({ chrome: found.path, html, modules: { '/probe.js': probeSource({ mode, docJson, bootMs: timeoutS * 1000 - 1000 }) }, timeoutS, label })
}
