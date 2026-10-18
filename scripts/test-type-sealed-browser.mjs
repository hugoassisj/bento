// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A SEALED bento/type document leaves no plaintext behind it, and shows a
// neutral title.
//
//   npm run build:sealtest --prefix type && node scripts/test-type-sealed-browser.mjs
//
// Uses the shared sealed TEST document (scripts/lib/sealed-boot.mjs): type's
// test shell, booted with the identity seal set before the app runs, and
// PROVEN sealed before any row checks a guard. Every sealed row has an
// UNSEALED control on the same edit, so a row that never fires cannot pass.
//
// WHAT THIS PROVES, sealed (identity seal, no password) vs unsealed:
//   1. after an edit and the autosave debounce, no IndexedDB record holds the
//      edit's text: no recovery snapshot and no version (control: unsealed,
//      the text IS found, so the scan can see a leak);
//   2. the tab title is "bento/type", neutral while sealed, matching the saved
//      file's title (control: unsealed shows the document's own title);
//   3. what a save would write carries no first-page preview and no plaintext;
//   4. a file type will not open lands on its refusal with the title
//      "bento/type", whatever the file's own <title> says.
// The preview guard itself (type/src/preview.ts) is also pinned in
// scripts/test-type-preview.ts, where the kernel's own preview veto does not
// mask it.
//
// Mutations (run, judged by exit code): canSnapshot back on the
// password-only check → 1 red; paintTitle without the sealed branch → 2 red;
// the refusal path without its title → 4 red.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSealed, savedFile, scanIndexedDB, sealtestShell } from './lib/sealed-boot.mjs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0, failures = 0
const ok = (c, m) => { checks++; if (!c) { failures++; console.log(`  FAIL  ${m}`) } else console.log(`  ok    ${m}`) }

const MARKER = 'zq-sealed-marker-7731'
const edit = async (page) => {
  const bb = await page.locator('#paper p[data-kind=para]').first().boundingBox()
  await page.mouse.click(bb.x + 4, bb.y + bb.height / 2)
  await page.keyboard.press('End')
  await page.keyboard.type(' ' + MARKER)
  await page.waitForTimeout(4500)   // past the 2.5s autosave debounce, and its write
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  for (const sealed of [false, true]) {
    const label = sealed ? 'sealed' : 'UNSEALED control'
    console.log(`\n${label}\n`)
    const { context, page, errors } = await openSealed(browser, 'type', { sealed })
    const docTitle = await page.evaluate(() => window.bento.doc.title)
    await edit(page)
    const inDoc = await page.evaluate((m) => JSON.stringify(window.bento.doc).includes(m), MARKER)
    ok(inDoc, `${label}: the edit is in the document`)
    const hits = await scanIndexedDB(page, MARKER)
    if (sealed) ok(hits.length === 0, `${label}: no IndexedDB record holds the edit (no recovery, no version)${hits.length ? ' — found in ' + hits.join(', ') : ''}`)
    else ok(hits.length > 0, `${label}: the edit IS in IndexedDB (${hits.join(', ')}), so the scan can see a leak`)
    const title = await page.title()
    if (sealed) ok(title === 'bento/type', `${label}: the tab title is the neutral "bento/type" (${JSON.stringify(title)})`)
    else ok(!!docTitle && title.includes(docTitle), `${label}: the tab title shows the document's own title (${JSON.stringify(title)})`)
    if (sealed) {
      const s = await savedFile(page)
      ok(!s.file.includes('data-bento-preview') && !s.file.includes(MARKER) && !s.file.includes(docTitle),
        `${label}: a save would write no preview and no plaintext (preview ${s.file.includes('data-bento-preview')}, marker ${s.file.includes(MARKER)})`)
    }
    ok(errors.length === 0, `${label}: no page error (${JSON.stringify(errors)})`)
    await context.close()
  }

  // 4. the refusal: an envelope type does not open, in a shell whose own
  //    <title> names the document
  console.log('\nrefusal\n')
  const shell = readFileSync(sealtestShell('type'), 'utf8')
  const env = JSON.stringify({ format: 'bento/enc', v: 1, it: 300000, salt: 'AAAA', iv: 'AAAA', data: 'AAAA' })
  const html = shell.replace(/<title>[^<]*<\/title>/, '<title>Secret memo — bento/type</title>')
    .replace(/(<script[^>]*id="bento-doc"[^>]*>)[\s\S]*?(<\/script>)/, (_m, a, b) => a + '\n' + env + '\n' + b)
  if (!html.includes('<title>Secret memo') || !html.includes('bento/enc')) throw new Error('could not build the refusal fixture')
  const f = join(mkdtempSync(join(tmpdir(), 'bento-type-sealed-')), 'refused.html'); writeFileSync(f, html)
  const p = await browser.newPage(); await p.route(/^https?:/, (r) => r.abort())
  await p.goto('file://' + f)
  await p.waitForFunction(() => document.body.textContent.includes('This file could not be opened'), null, { timeout: 15000 }).catch(() => {})
  const r = await p.evaluate(() => ({ title: document.title, refused: window.bento?.refused === true }))
  ok(r.refused && r.title === 'bento/type', `a file type refuses shows the title "bento/type", not its own <title> (${JSON.stringify(r.title)}, refused ${r.refused})`)
  await p.close()
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
