// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The loader decides "the app ran" from what the app PUBLISHED, never from a doc alone.
//
//   node scripts/test-shell-loader-published-browser.mjs
//
// WHAT THIS PROVES, on shells built by the real scripts/postbuild-compress.mjs
// from tiny synthetic apps, in Chromium. The contract the loader reads:
//   { doc }              the app is running;
//   { locked: true }     it is waiting at its password gate;
//   { refused: true }    it painted its own refusal (and may throw after);
//   nothing              it never ran — only then the loader's failure card.
// For each kind of app: how many times the app ran (the loader cascade must
// stop at the first path that ran it — re-running an app at a gate stacked
// one password card per path, 1.2.4–1.2.8), which path it stopped at, and
// whether the loader painted "every loader path was refused". Each is checked
// with every path allowed, with only the blob import allowed (the inline and
// Function paths refused, as a strict policy refuses them), and with a bundle
// that uses `import.meta` (a SyntaxError in a classic script and in Function,
// so only the blob import can run it — bento/type's bundle measured this way).
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
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
const dir = mkdtempSync(join(tmpdir(), 'loader-published-'))

// every app counts its runs and draws one card per run, so a re-run shows
const COUNT = `window.__runs = (window.__runs || 0) + 1; var c = document.createElement('div'); c.className = 'app-card'; document.body.appendChild(c);`
const APPS = {
  running: `${COUNT} window.bento = { doc: { format: 'x' } }`,
  locked: `${COUNT} window.bento = { format: 'x', locked: true }`,
  refused: `${COUNT} c.textContent = 'This file could not be opened'; window.bento = { format: 'x', refused: true }; throw new Error('app: unreadable file')`,
  nothing: `${COUNT} throw new Error('app: crashed before publishing')`,
  // the loader's failure message is plain text: an error message carrying
  // markup reaches the card as characters, never as an element
  markup: `${COUNT} throw new Error('app: <img data-rig-injected src="data:,"><b data-rig-injected>bold</b>')`,
}
// [ran, card] expected: the first three run once and paint nothing; an app
// that publishes nothing is tried on every path and ends on the card
const EXPECT = { running: [1, false], locked: [1, false], refused: [1, false], nothing: [null, true], markup: [null, true] }

function build(name, body) {
  const file = join(dir, `${name}.html`)
  writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>t</title>
<script type="module" crossorigin>${body}</script>
<style rel="stylesheet" crossorigin>#app{color:red}</style>
<script type="application/bento+json" id="bento-doc"></script></head>
<body><style>#bento-splash{opacity:.5}</style><div id="bento-splash"><div>splash</div></div><div id="app"></div></body></html>`)
  execFileSync(process.execPath, [join(root, 'scripts/postbuild-compress.mjs'), file, '--loader', 'cascade'], { cwd: join(root, 'slides'), encoding: 'utf8', env: { ...process.env, ZOPFLI: '0' } })
  return file
}
const BLOB_ONLY = () => {
  const append = Element.prototype.appendChild
  Element.prototype.appendChild = function (n) {
    if (n && n.id === 'bento-rt-script') throw new Error('rig: inline script refused')
    return append.call(this, n)
  }
  window.Function = new Proxy(window.Function, { construct() { throw new Error('rig: Function refused') } })
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const [variant, opts] of [['every path allowed', {}], ['only the blob import allowed', { blobOnly: true }], ['a bundle using import.meta', { meta: true }]]) {
    console.log(`\n${variant}\n`)
    for (const [kind, body] of Object.entries(APPS)) {
      const src = opts.meta ? `const here = import.meta.url; ${body}` : body
      const file = build(`${kind}${opts.meta ? '-meta' : ''}`, src)
      const ctx = await browser.newContext()
      if (opts.blobOnly) await ctx.addInitScript(BLOB_ONLY)
      const p = await ctx.newPage()
      await p.goto('file://' + file)
      await p.waitForFunction(() => window.bento?.loader || /every loader path/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {})
      await p.waitForTimeout(200)
      const r = await p.evaluate(() => ({
        runs: window.__runs || 0, cards: document.querySelectorAll('.app-card').length,
        card: /every loader path/.test(document.body.innerText), path: window.bento?.loader?.path ?? null,
        injected: document.querySelectorAll('[data-rig-injected]').length,
        literal: /<img data-rig-injected/.test(document.body.innerText),
      }))
      const [runs, card] = EXPECT[kind]
      const wantPath = opts.blobOnly || opts.meta ? 'blob' : 'inline'
      if (kind === 'markup') {
        ok(r.card && r.injected === 0 && r.literal,
          `${kind}: the failure message is plain text — no element made from it, the markup shown as characters (${r.injected} element(s), literal ${r.literal})`)
      } else if (kind === 'nothing') {
        ok(r.card && !r.path, `${kind}: the loader's failure card, and no path claimed (${r.runs} run(s))`)
      } else {
        ok(r.runs === runs && r.cards === 1 && r.card === card && r.path === wantPath,
          `${kind}: ran once, one card of its own, no loader card, stopped at ${wantPath} (runs ${r.runs}, cards ${r.cards}, loader card ${r.card}, path ${r.path})`)
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
