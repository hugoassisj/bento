// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// AN ENCRYPTED SPACE OPENS. Measured broken before this rig existed: the
// shell's loader decides "the app started" by looking for window.bento, a space
// waiting at its password gate had not published it, so every loader path read
// as a failure, each one ran the app again (one password card per path), and
// the loader's "This file could not start" card covered all of them. The space
// could not be opened by anyone, its author included.
//
// The whole round trip runs on the BUILT shell, through the real UI: Save ▾ →
// Encrypt with password… → save → open that file fresh → exactly one gate, no
// failure card → the password unlocks it → the document is the one saved.
//
// Mutation (spaces/src/main.ts): drop the `locked` window.bento stub set before
// passwordGate() → the gate count and the failure-card rows go red.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const shell = new URL('../spaces/dist-single/Bento_Spaces.bento.html', import.meta.url)
const PASS = 'correct horse battery staple'
const TITLE = 'Locked away ' + Date.now()

let failures = 0, checks = 0
const ok = (cond, what) => { checks++; if (cond) console.log('  ok    ' + what); else { failures++; console.log('  FAIL  ' + what) } }

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  // ---- 1. make an encrypted space through the real UI ----------------------
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.route(/^https?:/, (route) => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(shell.href)
  await page.waitForFunction(() => window.bento?.doc)
  await page.locator('.sp-doctitle').fill(TITLE)
  await page.locator('.sp-doctitle').press('Tab')
  await page.locator('.sp-savemenu').click()
  await page.getByText('Encrypt with password…', { exact: true }).click()
  const pw = page.locator('input[type=password]')
  await pw.nth(0).fill(PASS)
  await pw.nth(1).fill(PASS)
  await pw.nth(1).press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('input[type=password]').length === 0)
  const html = await page.evaluate(() => window.bento.serializeAuto())
  const block = (html.match(/<script\b[^>]*id="bento-doc"[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || ''
  ok(/bento\/enc/.test(block) && !block.includes(TITLE), 'the saved document block is an encrypted envelope (no plaintext title inside it)')
  await context.close()

  const dir = mkdtempSync(join(tmpdir(), 'bento-enc-'))
  const file = join(dir, 'locked.bento.html')
  writeFileSync(file, html)

  // ---- 2. open it fresh --------------------------------------------------
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx2.route(/^https?:/, (route) => route.abort())
  const p2 = await ctx2.newPage()
  const errs2 = []
  p2.on('pageerror', (e) => errs2.push(e.message))
  await p2.goto('file://' + file)
  await p2.waitForSelector('.sp-gate', { timeout: 15000 }).catch(() => {})
  await p2.waitForTimeout(1500) // let every loader path that WOULD run, run
  const state = await p2.evaluate(() => ({
    gates: document.querySelectorAll('.sp-gate').length,
    failure: /could not start/i.test(document.body.innerText),
    bento: window.bento ? { locked: window.bento.locked === true, doc: !!window.bento.doc } : null,
    focusedGate: !!document.activeElement?.closest?.('.sp-gate'),
  }))
  ok(state.gates === 1, `exactly ONE password gate (${state.gates})`)
  ok(!state.failure, 'no "could not start" failure card')
  ok(state.bento?.locked === true && state.bento.doc === false, 'window.bento says locked, with no document yet')
  ok(state.focusedGate, 'the password field has focus')

  // ---- 3. unlock -----------------------------------------------------------
  await p2.locator('.sp-gate input[type=password]').first().fill('wrong')
  await p2.locator('.sp-gate input[type=password]').first().press('Enter')
  await p2.waitForTimeout(800)
  ok(await p2.locator('.sp-gate').count() === 1 && !(await p2.evaluate(() => !!window.bento?.doc)), 'a wrong password keeps the gate and opens nothing')
  await p2.locator('.sp-gate input[type=password]').first().fill(PASS)
  await p2.locator('.sp-gate input[type=password]').first().press('Enter')
  await p2.waitForFunction(() => window.bento?.doc, null, { timeout: 15000 })
  const after = await p2.evaluate(() => ({
    title: window.bento.doc.title, locked: !!window.bento.locked,
    gates: document.querySelectorAll('.sp-gate').length,
    failure: /could not start/i.test(document.body.innerText),
  }))
  ok(after.title === TITLE, 'the right password opens the space that was saved')
  ok(!after.locked && after.gates === 0 && !after.failure, 'unlocked: the real window.bento replaces the stub; no gate or failure card left')
  ok(errors.length === 0 && errs2.length === 0, `no runtime errors (${[...errors, ...errs2].join(' | ')})`)
  await ctx2.close()

  // ---- 4. a file spaces REFUSES opens to one explanation, not the loader's ---
  // The same mount question with the other answer: a document block that is
  // not a space gets spaces' own "could not be opened" card (with its "Save an
  // untouched copy…" escape), published as `refused` so the loader stops.
  const broken = html.replace(/(<script\b[^>]*id="bento-doc"[^>]*>)[\s\S]*?(<\/script>)/i, '$1{"format":"bento/spaces","version":1,"pages":"not a list"}$2')
  const bad = join(dir, 'refused.bento.html')
  writeFileSync(bad, broken)
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx3.route(/^https?:/, (route) => route.abort())
  const p3 = await ctx3.newPage()
  await p3.goto('file://' + bad)
  await p3.waitForSelector('.sp-gate', { timeout: 15000 }).catch(() => {})
  await p3.waitForTimeout(1500)
  const ref = await p3.evaluate(() => ({
    gates: document.querySelectorAll('.sp-gate').length,
    failure: /could not start/i.test(document.body.innerText),
    refused: window.bento?.refused === true && !window.bento?.doc,
  }))
  ok(ref.gates === 1, `a refused file shows exactly ONE "could not be opened" card (${ref.gates})`)
  ok(!ref.failure && ref.refused, 'no loader failure card over it; window.bento says refused')
  await ctx3.close()
} finally { await browser.close() }

console.log(`${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
