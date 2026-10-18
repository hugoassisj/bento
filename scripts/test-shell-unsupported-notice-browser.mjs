// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The unsupported-browser notice names the app the file belongs to.
//
//   node scripts/test-shell-unsupported-notice-browser.mjs
//
// WHAT THIS PROVES. The loader's one message written before any app runs — a
// browser too old to unpack the shell — said "This is a bento/dash spreadsheet"
// in EVERY app's shell, so a slides deck told its reader it was a spreadsheet.
// For each app, a shell is built by the real scripts/postbuild-compress.mjs
// with the exact --generator/--title flags that app's own build:single passes
// (read from its package.json, so the rig cannot drift from the builds), and
// opened in Chromium with TextDecoder taken away, which is what the loader
// tests for. The notice must name that app and its kind of file, and no other.
// When the real slides shell is built, it is checked the same way.
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = mkdtempSync(join(tmpdir(), 'loader-notice-'))
const WANT = { slides: 'This is a bento/slides presentation.', dash: 'This is a bento/dash spreadsheet.', spaces: 'This is a bento/spaces space.', type: 'This is a bento/type document.' }

// the flags each app's build:single hands postbuild-compress, verbatim
function flagsOf(app) {
  const script = JSON.parse(readFileSync(join(root, app, 'package.json'), 'utf8')).scripts['build:single']
  const tail = script.slice(script.indexOf('postbuild-compress.mjs') + 'postbuild-compress.mjs'.length).trim().split(/\s+/).slice(1).join(' ')
  const args = []
  for (const m of tail.matchAll(/(--\w+)\s+(?:"([^"]*)"|(\S+))/g)) args.push(m[1], m[2] ?? m[3])
  return args
}
const NO_DECODER = () => { delete window.TextDecoder }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
async function notice(file) {
  const ctx = await browser.newContext()
  await ctx.addInitScript(NO_DECODER)
  const p = await ctx.newPage()
  await p.goto('file://' + file)
  await p.waitForFunction(() => /needs a browser released/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {})
  const text = await p.evaluate(() => document.body.innerText)
  await ctx.close()
  return text
}
try {
  for (const app of Object.keys(WANT)) {
    const args = flagsOf(app)
    const file = join(dir, `${app}.html`)
    writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>t</title>
<script type="module" crossorigin>window.bento = { doc: {} }</script>
<style rel="stylesheet" crossorigin>#app{color:red}</style>
<script type="application/bento+json" id="bento-doc"></script></head>
<body><style>#bento-splash{opacity:.5}</style><div id="bento-splash"><div>splash</div></div><div id="app"></div></body></html>`)
    execFileSync(process.execPath, [join(root, 'scripts/postbuild-compress.mjs'), file, ...args], { cwd: join(root, 'slides'), encoding: 'utf8', env: { ...process.env, ZOPFLI: '0' } })
    const text = await notice(file)
    const others = Object.entries(WANT).filter(([a]) => a !== app).filter(([, w]) => text.includes(w))
    ok(text.includes(WANT[app]) && others.length === 0,
      `${app} (flags: ${args.join(' ') || 'none'}): "${WANT[app]}"${text.includes(WANT[app]) ? '' : ` — got "${(text.match(/This is a[^.]*\./) || ['nothing'])[0]}"`}`)
  }
  const real = join(root, 'slides/dist-single/Bento_Slides.bento.html')
  if (existsSync(real)) {
    const text = await notice(real)
    ok(text.includes(WANT.slides) && !/spreadsheet/.test(text), `the built slides shell says "${WANT.slides}"`)
  } else console.log('  skip  the built slides shell (not built)')
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
