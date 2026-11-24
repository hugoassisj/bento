// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Toasts are announced; failures stay and offer a way out (FH-10).
//
//   npm run build:single --prefix slides && node scripts/test-slides-toast-a11y-browser.mjs
//   (SHELL_HTML=<older shell> runs the same checks against it)
//
// WHAT THIS PROVES, in the packaged editor with real keys and real files:
//   1. Two live regions — role="status" (polite) and role="alert" — are in the
//      page at boot, before any message: a region created together with its
//      text is not announced, which is why the toast node itself cannot be one.
//   2. An ordinary toast ("Text pasted") is written into the status region.
//   3. An offer with a button (Morph, on a duplicated slide) is announced,
//      its button still works, and it still goes away on its own.
//   4. A save the browser refuses (NotAllowedError) says why, never points at
//      the console, goes to the alert region, is still on screen after 3 s,
//      and offers "Download a copy", which downloads the deck. It can be
//      dismissed. A failure with no known reason still names no console.
//   5. Cancelling the save picker says nothing at all.
//   6. A file that is not a decodable picture, chosen through the Image
//      button or pasted, inserts nothing and names the file; a real picture
//      pasted still lands.
import { readFileSync } from 'node:fs'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const shell = process.env.SHELL_HTML
  ? new URL(process.env.SHELL_HTML, `file://${process.cwd()}/`).href
  : new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href
// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true })
  // never the network: no http(s), no WebSocket (route() does not see those),
  // and the app's own offline switch on before the page loads
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(shell)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-scroll'))
  await p.waitForTimeout(600)
  // every toast that is ever shown, as it was first drawn
  await p.evaluate(() => {
    window.__toasts = []
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('ed-toast')) window.__toasts.push(n.textContent)
    }).observe(document.body, { childList: true })
  })

  const region = (role) => p.evaluate((role) => {
    const n = [...document.querySelectorAll(`[role="${role}"]`)].find((x) => !x.closest('.ed-toast') && x.parentElement === document.body)
    return n ? { text: n.textContent, live: n.getAttribute('aria-live') } : null
  }, role)
  const toast = () => p.evaluate(() => {
    const n = document.querySelector('.ed-toast')
    if (!n) return null
    return { text: n.firstChild?.textContent ?? '', all: n.textContent, kind: n.dataset.kind ?? '', buttons: [...n.querySelectorAll('button')].map((b) => b.textContent || b.getAttribute('aria-label')) }
  })
  const total = () => p.evaluate(() => window.bento.doc.slides.reduce((n, s) => n + s.elements.length, 0))
  const shown = () => p.evaluate(() => window.__toasts.length)
  const save = async () => { await p.keyboard.press('ControlOrMeta+s'); await p.waitForTimeout(700) }
  const stubPicker = (name) => p.evaluate((name) => {
    window.showSaveFilePicker = async () => { throw name === 'TypeError' ? new TypeError('boom') : new DOMException('refused', name) }
  }, name)

  console.log('\n1. the regions are there before any message\n')
  const status0 = await region('status')
  const alert0 = await region('alert')
  ok(!!status0, 'a role="status" region is in the page at boot')
  ok(status0?.live === 'polite', `it is polite (aria-live=${status0?.live})`)
  ok(!!alert0, 'a role="alert" region is in the page at boot')

  console.log('\n2. an ordinary toast is announced\n')
  await p.locator('.ed-scroll').click({ position: { x: 10, y: 10 } })
  await p.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Hello from the clipboard')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await p.waitForTimeout(400)
  const pasted = await toast()
  ok(pasted?.text === 'Text pasted', `the paste toasts (${pasted?.text})`)
  ok((await region('status'))?.text === 'Text pasted', `the status region says it too (${(await region('status'))?.text})`)

  console.log('\n3. an offer with a button is announced and still expires\n')
  await p.locator('.ed-sidebar .ed-thumb').nth(0).evaluate((n) => [...n.querySelectorAll('button')].find((b) => /Duplicate slide/.test(b.title + (b.getAttribute('aria-label') ?? '')))?.click())
  await p.waitForTimeout(300)
  const firstId = await p.evaluate(() => window.bento.doc.slides[1].elements.find((e) => !e.locked)?.id)
  await p.evaluate((id) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.click(), firstId)
  await p.waitForTimeout(200)
  await p.locator('.ed-props .ed-tabs [role="tab"]', { hasText: /^Format$/i }).click()
  const x = p.locator('.ed-props .ed-layer-block .ed-mini', { has: p.locator(':scope > span', { hasText: /^X$/ }) }).first().locator('input')
  await x.fill('+150'); await x.press('Enter'); await p.waitForTimeout(500)
  const offer = await toast()
  ok(offer?.buttons.includes('Use Morph'), `moving something on a duplicate offers Morph (${offer?.all})`)
  ok((await region('status'))?.text === offer?.text, `the offer is announced (${(await region('status'))?.text})`)
  await p.waitForTimeout(8600)
  ok(!(await toast()), 'the offer still goes away on its own')

  console.log('\n4. a refused save says why, stays, and offers a download\n')
  await stubPicker('NotAllowedError')
  await save()
  const failed = await toast()
  ok(!!failed, `a toast appears (${failed?.all})`)
  ok(failed && !/console/i.test(failed.all), 'it does not point at the console')
  ok(/permission/i.test(failed?.text ?? ''), 'it names the reason (permission)')
  ok(failed?.buttons.includes('Download a copy'), `it offers Download a copy (${failed?.buttons.join(', ')})`)
  ok(failed?.kind === 'error', 'it is marked as an error')
  const alert1 = await region('alert')
  ok(!!alert1?.text && alert1.text === failed?.text, `the alert region says it (${alert1?.text})`)
  await p.waitForTimeout(3000)
  ok((await toast())?.text === failed?.text, 'it is still on screen 3 s later')
  // an ordinary message (a paste; a collaborator joining) never wipes it
  await p.evaluate(() => {
    const dt = new DataTransfer(); dt.setData('text/plain', 'Pasted over a failure')
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await p.waitForTimeout(400)
  const both = await p.evaluate(() => [...document.querySelectorAll('.ed-toast')].map((n) => {
    const r = n.getBoundingClientRect(); return { kind: n.dataset.kind ?? '', text: n.firstChild?.textContent ?? '', top: r.top, bottom: r.bottom }
  }))
  const err = both.find((b) => b.kind === 'error'), later = both.find((b) => b.kind !== 'error')
  ok(err?.text === failed?.text, `a paste after it leaves the failure on screen (${both.map((b) => b.text).join(' | ')})`)
  ok(later?.text === 'Text pasted' && err && later.top >= err.bottom, 'and the paste shows beneath it, not over it')
  const [dl] = await Promise.all([
    p.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    p.locator('.ed-toast button', { hasText: 'Download a copy' }).click().catch(() => {}),
  ])
  ok(!!dl, 'Download a copy downloads')
  if (dl) {
    const name = dl.suggestedFilename()
    const body = readFileSync(await dl.path(), 'utf8')
    ok(/\.bento\.html$/.test(name), `as a .bento.html file (${name})`)
    ok(body.includes('id="bento-doc"'), 'carrying the deck')
  }
  await p.waitForTimeout(400)
  ok(await p.evaluate(() => !document.querySelector('.ed-toast[data-kind="error"]')), 'acting on it puts it away')

  await stubPicker('TypeError')
  const home = () => p.evaluate(() => document.activeElement?.getAttribute('data-cmd') ?? document.activeElement?.tagName)
  await p.evaluate(() => document.querySelector('[data-cmd="insert-text"]').focus())
  await save()
  const generic = await toast()
  ok(!!generic && !/console/i.test(generic.all), `a failure with no known reason names no console (${generic?.text})`)
  ok(generic?.buttons.includes('Download a copy'), 'and still offers Download a copy')
  await p.evaluate(() => document.querySelector('.ed-toast button[aria-label="Dismiss"]')?.focus())
  await p.keyboard.press('Enter')
  await p.waitForTimeout(400)
  ok(!(await toast()), 'Dismiss puts it away')
  ok(await home() === 'insert-text', `and focus goes back where it was (${await home()})`)

  await save()
  ok(!!(await toast()), 'another failure')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok(!(await toast()), 'Escape puts it away')
  await save()
  await p.evaluate(() => document.querySelector('.ed-toast .ed-toast-act')?.focus())
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok(!(await toast()) && await home() === 'insert-text', `Escape from its own button puts it away and focus back (${await home()})`)
  await save()
  await p.evaluate(() => { const t = document.createElement('textarea'); t.id = 'rig-field'; document.body.append(t); t.focus() })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(300)
  ok(!!(await toast()), 'Escape typed in a field leaves it to the field')
  await p.evaluate(() => { document.getElementById('rig-field')?.remove(); document.querySelector('.ed-toast button[aria-label="Dismiss"]')?.click() })
  await p.waitForTimeout(300)

  console.log('\n5. cancelling the picker is quiet\n')
  await stubPicker('AbortError')
  const before = await shown()
  await save()
  ok(await shown() === before && !(await toast()), 'no toast when the picker is cancelled')

  console.log('\n6. a picture that cannot be read inserts nothing and says so\n')
  let n0 = await total()
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser', { timeout: 5000 }),
    p.evaluate(() => document.querySelector('[data-cmd="insert-image"]').click()),
  ])
  await chooser.setFiles({ name: 'notapicture.png', mimeType: 'image/png', buffer: Buffer.from('this is text, not a picture') })
  await p.waitForTimeout(1200)
  ok(await total() === n0, `the Image button inserts nothing (${n0} → ${await total()})`)
  const picked = await toast()
  ok(/notapicture\.png/.test(picked?.text ?? ''), `and names the file (${picked?.text})`)
  const spoken = [(await region('status'))?.text, (await region('alert'))?.text]
  ok(!!picked?.text && spoken.includes(picked.text), 'and it is announced')

  n0 = await total()
  await p.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['nope'], 'broken.png', { type: 'image/png' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
  await p.waitForTimeout(1200)
  ok(await total() === n0, `a pasted unreadable picture inserts nothing (${n0} → ${await total()})`)
  const pastedBad = await toast()
  ok(/broken\.png/.test(pastedBad?.text ?? ''), `and names the file (${pastedBad?.text})`)

  n0 = await total()
  await p.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const dt = new DataTransfer(); dt.items.add(new File([bytes], 'dot.png', { type: 'image/png' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, PNG.toString('base64'))
  await p.waitForTimeout(1200)
  ok(await total() === n0 + 1, `a real picture pasted still lands (${n0} → ${await total()})`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
