// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Headless Chrome, driven with no dependency: a local http server hands Chrome
// the deck with probe modules appended and a load gate (an <img> the server
// answers only once a probe has POSTed its report), Chrome runs `--dump-dom`
// and is closed the moment the report is in. No puppeteer, no CDP client.
// Chrome gets no network beyond that loopback server: every other host name
// resolves to nothing and no proxy is used.
//
// WHEN IT FAILS it says where. The server records each request and the probe
// posts a beacon per step (`/stage`), so a run that never reports names the
// stage that never happened — Chrome never asked for the page, never asked for
// the probe, the shell never booted, or the report never came — with Chrome's
// exit code and the tail of its stderr. Chrome runs in its own process group,
// so stopping it stops its helpers, and removing its temp profile can never
// fail the run: the helpers outlive the browser process and kept writing into
// it, which turned successful runs into an uncaught ENOTEMPTY.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

export const SYSTEM_CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
const PLAYWRIGHT_ROOTS_TEXT = "Playwright's browsers (PLAYWRIGHT_BROWSERS_PATH, ~/.cache/ms-playwright, ~/Library/Caches/ms-playwright, /opt/pw-browsers)"

/** The browsers Playwright downloads, full Chromium before the headless shell, newest first. */
function playwrightChromes() {
  const env = process.env.PLAYWRIGHT_BROWSERS_PATH
  const roots = [
    env && env !== '0' ? env : null,
    path.join(os.homedir(), '.cache/ms-playwright'),
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    '/opt/pw-browsers',
  ].filter(Boolean)
  const full = [], shells = []
  for (const r of roots) {
    let dirs = []
    try { dirs = fs.readdirSync(r) } catch { continue }
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

/**
 * Find Chrome. BENTO_CHROME wins and is never skipped silently: a path that
 * does not exist is an error naming it, and `none` means no Chrome at all. Then the usual install paths, then
 * google-chrome on PATH, then Playwright's browsers.
 * Returns { path } or { error, next } (what was looked for, and what to do).
 */
export function findChrome() {
  const env = process.env.BENTO_CHROME
  const searched = `${SYSTEM_CHROMES.join(', ')}, google-chrome on PATH, and ${PLAYWRIGHT_ROOTS_TEXT}`
  if (env === 'none') {
    // what a machine without Chrome sees, on one that has it (rigs; sandboxes)
    return { error: `no Chrome: BENTO_CHROME=none turns it off (otherwise searched: ${searched})`, next: 'Unset BENTO_CHROME, or set it to a Chrome or Chromium binary.' }
  }
  if (env) {
    if (fs.existsSync(env)) return { path: env }
    return { error: `BENTO_CHROME is ${env}, which does not exist`, next: 'Point it at a Chrome or Chromium binary, or unset it to search the usual places.' }
  }
  for (const p of SYSTEM_CHROMES) if (fs.existsSync(p)) return { path: p }
  if (spawnSync('which', ['google-chrome']).status === 0) return { path: 'google-chrome' }
  for (const p of playwrightChromes()) if (fs.existsSync(p)) return { path: p }
  return {
    error: `no Chrome found. Looked for BENTO_CHROME (unset), ${searched}`,
    next: 'Install Google Chrome, or set BENTO_CHROME to a Chrome or Chromium binary.',
  }
}

/** A headless-shell build has only the old headless mode: give it the flag it knows. */
export function headlessFlag(chrome) {
  let real = chrome
  try { real = fs.realpathSync(chrome) } catch {}
  return /headless[_-]shell/i.test(chrome + ' ' + real) ? '--headless' : '--headless=new'
}

/**
 * Load `html` in headless Chrome with `modules` (path → source) appended as
 * module scripts, in order, then the load gate; wait for a POST to /report.
 *
 * Returns { report } on success, or { fatal, stage } with what went wrong.
 * Either way `chrome` describes the run: { path, headless, exitCode, signal,
 * stderr } (stderr: the last 4 KB).
 */
export async function runInChrome({ chrome, html, modules, timeoutS = 90, keepTmp = false, label = 'bento', log = console.error }) {
  const started = Date.now()
  const dbg = (...a) => { if (process.env.BENTO_CHECK_DEBUG) console.error(`[${Date.now() - started} ms]`, ...a) }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bento-check-'))
  for (const [p, src] of Object.entries(modules)) fs.writeFileSync(path.join(tmp, path.basename(p)), src)
  const cleanup = () => {
    if (keepTmp) { log(`${label}: kept the temp directory (Chrome profile, probe): ${tmp}`); return }
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
    catch (e) { log(`${label}: warning: could not remove the temp directory ${tmp} (${e.code ?? e.message}) — delete it by hand`) }
  }

  // Written by concatenation: never a literal script-close in a source file.
  const page = html +
    Object.keys(modules).map((p) => '\n<scr' + `ipt type="module" src="${p}"></scr` + 'ipt>').join('') +
    '<img src="/gate.gif" width="1" height="1" alt="">'

  let report = null
  let releaseGate = null
  let child = null
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64')
  const seen = { page: false, probe: false, started: false, booted: false, last: '' }
  const ownGroup = process.platform !== 'win32'
  const stopChrome = (sig) => {
    if (!child?.pid) return
    try { if (ownGroup) process.kill(-child.pid, sig); else child.kill(sig) } catch {}
  }
  const readBody = (req, done) => {
    let body = ''
    req.on('data', (b) => { body += b })
    req.on('end', () => done(body))
  }
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    dbg(req.method, url)
    if (url === '/deck.html') { seen.page = true; res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page); return }
    if (Object.hasOwn(modules, url)) { seen.probe = true; res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(modules[url]); return }
    if (url === '/stage' && req.method === 'POST') {
      readBody(req, (body) => {
        if (body === 'started') seen.started = true
        else if (body === 'booted') seen.booted = true
        seen.last = body.slice(0, 80)
        dbg('stage', body)
        res.writeHead(204); res.end()
      })
      return
    }
    if (url === '/report' && req.method === 'POST') {
      readBody(req, (body) => {
        try { report = JSON.parse(body) } catch { report = { fatal: 'the probe posted something that was not JSON' } }
        res.writeHead(204); res.end()
        dbg('report received', releaseGate ? '(gate waiting → released)' : '(gate not yet requested)')
        releaseGate?.()
        // The report is the deliverable, not the dump: the shell keeps the
        // page busy past load (measured: Chrome sat 88 s after the gate
        // opened), so Chrome is closed the moment the report is in.
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

  let stderrTail = '', exitCode = null, exitSignal = null, spawnError = null, timedOut = false
  const onSignal = (sig) => { stopChrome('SIGKILL'); server.close(); cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143) }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const headless = headlessFlag(chrome)
  // spawn, never spawnSync: the server lives in this process.
  child = spawn(chrome, [
    headless, '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-default-apps',
    '--hide-scrollbars', '--window-size=1600,1000',
    // No network: the page is on loopback and needs nothing else. A deck that
    // carries a live session must not join it from a headless check, and a
    // remote picture draws blank in the export path anyway.
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', '--no-proxy-server',
    '--user-data-dir=' + path.join(tmp, 'profile'),
    '--dump-dom', `http://127.0.0.1:${port}/deck.html`,
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: ownGroup })
  child.stderr?.on('data', (b) => { stderrTail = (stderrTail + b).slice(-4096) })
  await new Promise((resolve) => {
    const timer = setTimeout(() => { timedOut = !report; stopChrome('SIGKILL') }, timeoutS * 1000)
    let lingering = null // after the browser process exits, a helper that lingers is killed
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

  const info = { path: chrome, headless, exitCode, signal: exitSignal, stderr: stderrTail.trim(), ms: Date.now() - started, tmp: keepTmp ? tmp : undefined }
  if (report && !report.fatal) return { report, chrome: info }

  const stageNow = () => {
    if (!seen.page) return { stage: 'page', what: 'Chrome never requested the page' }
    if (!seen.probe) return { stage: 'probe', what: 'Chrome loaded the page but never requested the probe module' }
    if (!seen.started) return { stage: 'probe-run', what: 'the probe module was fetched but never ran' }
    if (!seen.booted) return { stage: 'boot', what: 'the probe ran but the shell never booted (window.bento never appeared)' }
    return { stage: 'report', what: `the shell booted but the report never arrived (last step: ${seen.last})` }
  }
  if (spawnError) {
    return { fatal: `could not start Chrome at ${chrome}: ${spawnError.message} — set BENTO_CHROME to a Chrome or Chromium binary you can run`, stage: 'start', chrome: info }
  }
  if (report?.fatal) return { fatal: report.fatal, stage: report.stage ?? stageNow().stage, chrome: info }
  const at = stageNow()
  if (timedOut) {
    return { fatal: `no report within ${timeoutS} s (--timeout ${timeoutS}): ${at.what}. A long deck or a slow machine needs more time: raise it with --timeout <seconds>`, stage: at.stage, chrome: info }
  }
  const how = exitSignal ? `was killed by ${exitSignal}` : `exited with code ${exitCode}`
  return {
    fatal: `Chrome (${chrome}) ${how} before the probe reported: ${at.what}. ` +
      (at.stage === 'page' ? 'Run the binary by hand to see why it does not start, or set BENTO_CHROME to another Chrome' : 'Rerun with BENTO_CHECK_DEBUG=1 to see each request'),
    stage: at.stage,
    chrome: info,
  }
}

/** Print a failed run: the fatal, the binary, the last lines of Chrome's output. */
export function printFatal(label, r) {
  console.error(`${label}: ${r.fatal}`)
  const c = r.chrome
  if (!c) return
  console.error(`  Chrome: ${c.path}${c.exitCode !== null ? ` (exit code ${c.exitCode})` : c.signal ? ` (${c.signal})` : ''}`)
  // the last lines; --json carries the whole 4 KB tail
  if (c.stderr) console.error(`  Chrome's last output:\n${c.stderr.split('\n').slice(-12).map((l) => '    ' + l).join('\n')}`)
}
