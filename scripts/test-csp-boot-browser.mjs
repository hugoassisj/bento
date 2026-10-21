// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// THE PINNED-CSP BOOT CHECK, against doctored copies of a real build (K4,
// security §36). scripts/lib/csp-boot.mjs excuses only the loader's two
// designed fallbacks: one inline, one eval, from a line AND column inside the
// pinned loader's own text. These rows are the ways that excuse went wrong
// while it was being built:
//   - matched on the source FILE: an injected <script> anywhere passed;
//   - matched on whole LINES: a <script> on the loader's opening or closing
//     line passed (the loader shares those lines with other markup).
// The pin derivation and the host check would refuse these files on their own;
// this proves the BOOT check refuses them too, as the backstop it is.
//
//   npm run build:single --prefix slides && node scripts/test-csp-boot-browser.mjs

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootUnderPins } from './lib/csp-boot.mjs'
import { derivePins, scanBlocks, executableScripts } from './lib/release-pins.mjs'
import { savedBy } from './lib/saved-by.mjs'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const shellPath = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).pathname
let failures = 0, checks = 0
const ok = (cond, what) => { checks++; if (cond) console.log('  ok    ' + what); else { failures++; console.log('  FAIL  ' + what) } }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const html = readFileSync(shellPath, 'utf8')
  const pins = derivePins(html, await savedBy(browser, shellPath))
  const dir = mkdtempSync(join(tmpdir(), 'bento-cspboot-'))
  const S = 'scr' + 'ipt', evil = `<${S}>window.__evil = 1</${S}>`
  const loader = executableScripts(scanBlocks(html)).find((b) => !b.preview)
  const openAt = html.lastIndexOf(`<${S}`, loader.start)
  const closeAt = html.indexOf('>', loader.start + loader.text.length) + 1
  const doctored = (name, text) => { const p = join(dir, `${name}.html`); writeFileSync(p, text); return p }

  const base = await bootUnderPins(browser, shellPath, pins)
  ok(base.expected.length === 2 && base.unexpected.length === 0, `genuine: exactly the loader's two fallbacks (${base.expected.length} expected, ${base.unexpected.length} unexpected)`)

  for (const [name, text] of [
    ['a <script> injected in <head>', html.replace('</head>', evil + '</head>')],
    ["a <script> on the loader's opening line, before it", html.slice(0, openAt) + evil + html.slice(openAt)],
    ["a <script> on the loader's closing line, after it", html.slice(0, closeAt) + evil + html.slice(closeAt)],
  ]) {
    const r = await bootUnderPins(browser, doctored(name.replace(/\W+/g, '-'), text), pins)
    // Not just "something was unexpected": the EXCUSED refusals must be the
    // loader's own (inside its text) and the injected one must not be among
    // them. A count alone passes when a defence excuses the WRONG refusal and
    // the loader's own fallback is reported in its place (measured: the column
    // rule and the once-each cap each hid the other's removal that way).
    // Positions are worked out HERE, independently of csp-boot.mjs, which is
    // the code under test (a rig reusing its helper would mutate with it).
    const at = text.indexOf(loader.text), stop = at + loader.text.length
    const offsetOf = (line, column) => {
      let o = 0
      for (let n = 1; n < line; n++) o = text.indexOf('\n', o) + 1
      return o + column - 1
    }
    const inLoaderText = (v) => { const o = offsetOf(v.line, v.column); return o >= at && o <= stop }
    const excusedAreLoaders = r.expected.every(inLoaderText)
    const injectedReported = r.unexpected.some((v) => v.directive === 'script-src-elem' && !inLoaderText(v))
    ok(excusedAreLoaders && injectedReported, `refused and reported: ${name} (excused only the loader's own: ${excusedAreLoaders}; the injected one reported: ${injectedReported})`)
  }

  const wrong = { ...pins, scriptSrc: ['sha256-' + 'A'.repeat(43) + '=', pins.scriptSrc[1]] }
  ok(await bootUnderPins(browser, shellPath, wrong).then(() => false, () => true), 'a wrong loader pin: the app never boots')
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
