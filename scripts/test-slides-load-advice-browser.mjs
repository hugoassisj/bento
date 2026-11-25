// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Every piece of load-report advice is true when followed alone (browser).
//
// The same decks and the same follower as scripts/test-slides-load-advice.ts
// (scripts/lib/load-advice.mjs), run in the packaged shell through
// window.bento.loadDoc and window.bento.read(): the deck's fonts load and text
// boxes are fitted, as an agent driving the page sees it, and the editor's own
// derive pass on `replace` has run before the document is read back.
//
// The network is closed: http(s) aborted, WebSockets answered by a closed mock
// (context.routeWebSocket — page.route does not see sockets), offline mode on.
//
// Run: (cd slides && npm run build:single) && node scripts/test-slides-load-advice-browser.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

const shellPath = fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const lib = readFileSync(fileURLToPath(new URL('./lib/load-advice.mjs', import.meta.url)), 'utf8')
const fixtures = fileURLToPath(new URL('./fixtures/agent-decks', import.meta.url))
const decks = {}
for (const f of readdirSync(fixtures).filter((n) => n.endsWith('.json')).sort()) decks[f] = readFileSync(join(fixtures, f), 'utf8')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
let sockets = 0
let result
const errors = []
try {
  const ctx = await browser.newContext()
  await ctx.route(/^https?:/, (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => { sockets++; ws.close() })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('file://' + shellPath)
  await page.waitForFunction(() => window.bento?.loadDoc && document.querySelector('.ed-topbar'), null, { timeout: 30000 })
  console.log(`visibility: ${await page.evaluate(() => document.visibilityState)}`)
  await page.addScriptTag({ type: 'module', content: lib + '\nwindow.__advice = { ADVICE_DECKS, followAll }\n' })
  await page.waitForFunction(() => !!window.__advice)
  result = await page.evaluate(async (fx) => {
    const { ADVICE_DECKS, followAll } = window.__advice
    const load = async (json) => {
      const report = window.bento.loadDoc(json)
      if (!report) return null
      await document.fonts.ready
      return { report, doc: window.bento.read() }
    }
    return followAll(load, { ...fx, ...ADVICE_DECKS })
  }, decks)
} finally {
  await browser.close()
}
if (process.env.VERBOSE) console.log(result.lines.join('\n'))
for (const p of result.problems) console.log(`  FAIL  ${p}`)
if (errors.length) console.log(`  FAIL  page errors: ${errors.join(' | ')}`)
console.log(`\nWebSockets attempted (answered by a closed mock): ${sockets}`)
console.log(`${result.followed} pieces of advice followed alone, ${result.problems.length} problems`)
const ok = result.followed >= 60 && result.problems.length === 0 && errors.length === 0
if (result.followed < 60) console.log('  FAIL  fewer pieces of advice than the decks are written to produce — the report went quiet')
console.log(ok ? 'all decks clean' : 'FAILED')
process.exit(ok ? 0 : 1)
