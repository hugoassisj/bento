// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Jump to a slide from the audience window: G (or O) opens a grid of the
// slides, and a typed number then Enter goes straight to that slide.
//
//   npm run build:single --prefix slides && node scripts/test-slides-show-jump-browser.mjs [shell]
//
// WHAT THIS PROVES, on the Showcase (19 slides, 15 in the linear flow, state
// slides among them), with real keys and a real mouse, no speaker view open:
//   1. G opens a grid inside the show holding exactly the linear-flow slides,
//      each a button showing its visible number (the counter's number), the
//      current one marked and focused; it is a dialog with an accessible name;
//   2. clicking thumbnail 8 closes the grid and the counter reads 8 / 15;
//      arrows move a visible focus ring (→ by one, ↓ by a row) and Enter jumps
//      to the focused thumbnail;
//   3. Esc with the grid open closes it and the show goes on; a second Esc
//      ends the show; G closes it too, and O opens the same grid;
//   4. typing 1, 2 shows a "Go to 12" chip and Enter lands on visible slide
//      12, which has state slides before it; Backspace edits the number; Esc
//      clears the chip without ending the show; the chip clears itself after a
//      pause, and Enter then does nothing;
//   5. a number larger than the deck does not navigate, and the chip says so
//      (it shakes) instead of vanishing;
//   6. the digits never reach the editor (no keydown gets past the show, the
//      document is unchanged), and a Ctrl chord with a digit is the browser's;
//   7. the ? sheet lists G and O and the number-then-Enter row;
//   8. the speaker window's own grid still works (G there, click a thumbnail,
//      the show jumps), and nothing of the audience grid appears in it;
//   9. an AUDIENCE copy of a live show (booted from its ticket, fed by a fake
//      relay inside the browser: nothing leaves the machine) may open the grid
//      and type a number while it can browse, and may not while the presenter
//      holds it locked — the lock closes an open grid.
// On the parent commit 1, 2, 3, 4, 5, 6's key check, 7 and 9 fail (13 of 47
// checks pass); 8 passes there too: it guards the speaker grid through the
// shared builder.
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.argv[2] || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // never reach the network: offline mode, no sockets, no http(s)
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1')
      localStorage.setItem('bento-reduce-motion', 'on'); localStorage.setItem('bento-show-keys-hint', '1')
    } catch {}
  })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'), null, { timeout: 20000 })
  return { ctx, p, errors }
}
const start = async (p) => {
  await p.evaluate(() => document.querySelector('.ed-keys-overlay, .ed-about-overlay')?.remove())
  await p.evaluate(() => document.querySelectorAll('.ed-sidebar .ed-thumb')[0]?.click())
  await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
  await p.keyboard.press('F5')
  await p.waitForFunction(() => document.querySelector('.bento-present-overlay .reveal .slides > section.present'), null, { timeout: 10000 })
  await p.waitForTimeout(500)
}
const state = (p) => p.evaluate(() => {
  const ov = document.querySelector('.bento-present-overlay')
  const r = ov?.querySelector('.reveal')
  if (!r) return null
  const secs = [...r.querySelectorAll('.slides > section')]
  const grid = ov.querySelector('.bento-show-grid')
  const chip = ov.querySelector('.bento-show-goto')
  const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0
  return {
    h: secs.indexOf(r.querySelector('.slides > section.present')),
    counter: r.querySelector('.slide-number')?.textContent.trim() ?? '',
    grid: shown(grid), chip: shown(chip) && chip.classList.contains('show') ? chip.textContent : null,
    bad: !!chip?.classList.contains('bad'), overview: r.classList.contains('overview'),
  }
})
const press = async (p, k, wait = 200) => { await p.keyboard.press(k); await p.waitForTimeout(wait) }
const shiftSlash = async (p) => { await p.keyboard.down('Shift'); await p.keyboard.press('Slash'); await p.keyboard.up('Shift'); await p.waitForTimeout(250) }
const fmt = (s) => s ? `slide ${s.h}, counter "${s.counter}", grid ${s.grid}, chip ${JSON.stringify(s.chip)}` : 'show ended'

try {
  // ——— the audience window, no speaker view ———
  {
    const { ctx, p, errors } = await open()
    const meta = await p.evaluate(() => {
      const d = window.bento.doc
      const flow = d.slides.map((s, i) => (!s.stateOf && !s.hidden) ? i : -1).filter((i) => i >= 0)
      const pag = (s) => !s.stateOf && !s.unnumbered && (!s.hidden || !!d.present?.numberHidden)
      const num = (i) => d.slides.slice(0, i + 1).filter(pag).length
      return { n: d.slides.length, flow, nums: flow.map(num), total: d.slides.filter(pag).length, states: d.slides.map((s, i) => s.stateOf ? i : -1).filter((i) => i >= 0), json: JSON.stringify(d) }
    })
    const idxOf = (vis) => meta.flow[meta.nums.indexOf(vis)]
    ok(meta.n === 19 && meta.flow.length === 15 && meta.total === 15, `CONTROL: the Showcase has 19 slides, 15 in the flow (${meta.n}, ${meta.flow.length}, ${meta.total})`)
    ok(meta.states.some((i) => i < idxOf(12)), `CONTROL: state slides come before visible slide 12 (states ${meta.states.join(',')}; slide 12 is index ${idxOf(12)})`)
    await start(p)
    await p.evaluate(() => { window.__leak = []; window.addEventListener('keydown', (e) => /^(Control|Shift|Alt|Meta)$/.test(e.key) || window.__leak.push(`${e.ctrlKey ? 'C+' : ''}${e.key}:${e.defaultPrevented}`)) })

    // 1. G opens the grid
    await press(p, 'ArrowRight'); await press(p, 'ArrowRight'); await press(p, 'ArrowRight')
    const here = await state(p)
    await press(p, 'g', 400)
    const g = await p.evaluate(() => {
      const grid = document.querySelector('.bento-present-overlay .bento-show-grid')
      if (!grid || grid.hidden) return null
      const thumbs = [...grid.querySelectorAll('.sv-thumb')]
      return {
        role: grid.getAttribute('role'), name: grid.getAttribute('aria-label'),
        buttons: thumbs.every((b) => b.tagName === 'BUTTON'),
        idx: thumbs.map((b) => +b.dataset.idx), nums: thumbs.map((b) => b.querySelector('.sv-thumb-n')?.textContent),
        current: thumbs.filter((b) => b.classList.contains('current')).map((b) => +b.dataset.idx),
        focused: document.activeElement?.classList.contains('sv-thumb') ? +document.activeElement.dataset.idx : null,
        drawn: thumbs.filter((b) => b.querySelector('.bento-slide, [data-el-id]')).length,
      }
    })
    ok(!!g, `1. G opens a grid inside the show (${fmt(await state(p))})`)
    ok(g && g.idx.join() === meta.flow.join(), `1. it holds exactly the linear-flow slides (${g?.idx.join()} vs ${meta.flow.join()})`)
    ok(g && g.nums.join() === meta.nums.join(), `1. each shows its visible number (${g?.nums.join()})`)
    ok(g && g.buttons && g.drawn === g.idx.length, `1. thumbnails are buttons with the slide drawn in them (${g?.drawn})`)
    ok(g && g.role === 'dialog' && g.name === 'All slides', `1. it is a dialog named "All slides" (${g?.role}, "${g?.name}")`)
    ok(g && g.current.join() === String(here.h) && g.focused === here.h, `1. the current slide is marked and focused (current ${g?.current}, focus ${g?.focused}, on ${here.h})`)
    const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { style: cs.outlineStyle, w: parseFloat(cs.outlineWidth) } })
    ok(ring.style !== 'none' && ring.w >= 2, `7. the focused thumbnail shows a focus ring (${JSON.stringify(ring)})`)
    let s = await state(p)
    ok(s?.h === here.h, `1. opening it moves nothing (${fmt(s)})`)

    // 2. click the eighth thumbnail
    const eighth = p.locator('.bento-show-grid .sv-thumb').nth(7)
    if (await eighth.count()) await eighth.click() // (absent on the parent: measured below, not thrown)
    await p.waitForTimeout(400)
    s = await state(p)
    ok(s && !s.grid && s.h === meta.flow[7] && s.counter === `8 / ${meta.total}`, `2. clicking thumbnail 8 closes the grid and the counter reads 8 / ${meta.total} (${fmt(s)})`)
    // keyboard: → → Enter, then ↓ Enter
    await press(p, 'g', 300)
    await press(p, 'ArrowRight'); await press(p, 'ArrowRight')
    const foc = await p.evaluate(() => +document.activeElement?.dataset.idx)
    ok(foc === meta.flow[9], `2. → moves the focus ring one thumbnail on (on ${foc}, want ${meta.flow[9]})`)
    s = await state(p)
    ok(s?.grid && s.h === meta.flow[7], `2. and the show stays put meanwhile (${fmt(s)})`)
    await press(p, 'Enter', 400)
    s = await state(p)
    ok(s && !s.grid && s.counter === `10 / ${meta.total}`, `2. Enter jumps to the focused thumbnail and closes the grid (${fmt(s)})`)
    await press(p, 'Home'); await press(p, 'g', 300)
    const cols = await p.evaluate(() => { const t = [...document.querySelectorAll('.bento-show-grid .sv-thumb')]; if (!t.length) return 0; const y = t[0].getBoundingClientRect().top; return t.filter((b) => Math.abs(b.getBoundingClientRect().top - y) < 2).length })
    await press(p, 'ArrowDown'); await press(p, 'Enter', 400)
    s = await state(p)
    ok(cols > 1 && s?.counter === `${cols + 1} / ${meta.total}`, `2. ↓ moves a row (${cols} columns) and Enter jumps there (${fmt(s)})`)

    // 3. Esc and G close it; O opens it
    await press(p, 'g', 300); await press(p, 'Escape', 300)
    s = await state(p)
    ok(s && !s.grid && s.counter === `${cols + 1} / ${meta.total}`, `3. Esc closes the grid and keeps presenting (${fmt(s)})`)
    await press(p, 'o', 300)
    s = await state(p)
    ok(s?.grid && !s.overview, `3. O opens the same grid, not Reveal's overview (${fmt(s)}, overview ${s?.overview})`)
    await press(p, 'g', 300)
    s = await state(p)
    ok(s && !s.grid && !s.overview, `3. G closes it (${fmt(s)})`)

    // 4. number then Enter
    await press(p, 'Home')
    await press(p, '1'); await press(p, '2')
    s = await state(p)
    ok(s?.chip === 'Go to 12' && s.h === meta.flow[0], `4. typing 1, 2 shows "Go to 12" and moves nothing yet (${fmt(s)})`)
    await press(p, 'Enter', 400)
    s = await state(p)
    ok(s && s.h === idxOf(12) && s.counter === `12 / ${meta.total}` && !s.chip, `4. Enter lands on visible slide 12 past the state slides (${fmt(s)}, want index ${idxOf(12)})`)
    await press(p, '2'); await press(p, '5'); await press(p, 'Backspace')
    s = await state(p)
    ok(s?.chip === 'Go to 2', `4. Backspace edits the number (${fmt(s)})`)
    await press(p, 'Enter', 400)
    s = await state(p)
    ok(s?.counter === `2 / ${meta.total}`, `4. and Enter goes there (${fmt(s)})`)
    await press(p, '7'); await press(p, 'Escape')
    s = await state(p)
    ok(s && !s.chip && s.counter === `2 / ${meta.total}`, `4. Esc clears the chip and the show goes on (${fmt(s)})`)
    await press(p, '7', 1900)
    s = await state(p)
    ok(s && !s.chip, `4. the chip clears itself after a pause (${fmt(s)})`)
    await press(p, 'Enter', 300)
    s = await state(p)
    ok(s?.counter === `2 / ${meta.total}`, `4. and a late Enter does nothing (${fmt(s)})`)

    // 5. out of range
    await press(p, '9'); await press(p, '9'); await press(p, 'Enter', 300)
    s = await state(p)
    ok(s && s.counter === `2 / ${meta.total}` && s.chip === 'Go to 99' && s.bad, `5. 99 does not navigate; the chip stays and shakes (${fmt(s)}, bad ${s?.bad})`)
    await press(p, 'Escape')

    // 6. nothing leaks; chords pass
    await press(p, 'Control+3')
    s = await state(p)
    const leak = await p.evaluate(() => window.__leak)
    // the one key that may pass is the late Enter of 4, which nothing owned (an
    // unlisted key, like any other: the editor ignores keys while presenting)
    ok(leak.join() === 'Enter:false,C+3:false' && !s?.chip, `6. no key the grid or the number owned reached the page, and Ctrl+3 passed to the browser untouched (${leak.join(' ')}; chip ${s?.chip})`)

    // 7. the ? sheet
    await shiftSlash(p)
    const rows = await p.evaluate(() => [...document.querySelectorAll('.bento-show-keys tr')].map((tr) => ({ keys: [...tr.cells[0].querySelectorAll('kbd')].map((k) => k.textContent), text: tr.cells[1].textContent })))
    const gRow = rows.find((r) => r.keys.includes('G'))
    const numRow = rows.find((r) => r.keys.includes('Enter'))
    ok(gRow && gRow.keys.includes('O') && /All slides/.test(gRow.text), `7. the ? sheet lists G and O (${JSON.stringify(gRow)})`)
    ok(numRow && /number/i.test(numRow.text), `7. and number-then-Enter (${JSON.stringify(numRow)})`)
    await press(p, 'x')

    // 3. the second Esc ends the show
    await press(p, 'g', 300); await press(p, 'Escape', 300)
    ok(!!(await state(p)), 'CONTROL: the first Esc left the show running')
    await press(p, 'Escape', 500)
    ok(!(await state(p)), '3. a second Esc ends the show')
    const after = await p.evaluate(() => JSON.stringify(window.bento.doc))
    ok(after === meta.json, '6. the editor\'s document is unchanged after all that typing')
    ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
    await ctx.close()
  }

  // ——— the speaker window keeps its own grid ———
  {
    const { ctx, p, errors } = await open()
    const popup = ctx.waitForEvent('page')
    await p.locator('.ed-present-pill .ed-pill-caret').click()
    await p.locator('.ed-present-pill .ed-menu').getByText('Open speaker view', { exact: true }).click()
    const sp = await popup
    await sp.waitForLoadState()
    await start(p)
    await sp.waitForSelector('.sv-btn[data-nav]', { timeout: 15000 })
    const total = await p.evaluate(() => window.bento.doc.slides.filter((s) => !s.stateOf && !s.hidden).length)
    await sp.bringToFront()
    await sp.keyboard.press('g'); await sp.waitForTimeout(300)
    const spg = await sp.evaluate(() => {
      const grid = document.querySelector('.sv-grid')
      return grid && !grid.hidden ? { n: grid.querySelectorAll('.sv-thumb').length, nums: [...grid.querySelectorAll('.sv-thumb-n')].map((n) => n.textContent).join() } : null
    })
    ok(spg?.n === total, `8. G in the speaker window opens its grid of ${total} (${JSON.stringify(spg)})`)
    await sp.locator('.sv-grid .sv-thumb').nth(4).click(); await sp.waitForTimeout(400)
    const s = await state(p)
    const closed = await sp.evaluate(() => document.querySelector('.sv-grid').hidden)
    ok(s?.counter === `5 / ${total}` && closed, `8. clicking its fifth thumbnail jumps the show and closes it (${fmt(s)}, closed ${closed})`)
    await p.bringToFront()
    await press(p, 'g', 300); await press(p, '3')
    const inSpeaker = await sp.evaluate(() => ({ grid: document.querySelectorAll('.bento-show-grid').length, chip: document.querySelectorAll('.bento-show-goto').length }))
    ok(inSpeaker.grid === 0 && inSpeaker.chip === 0, `8. the audience grid and chip never appear in the speaker window (${JSON.stringify(inSpeaker)})`)
    ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
    await ctx.close()
  }

  // ——— an audience copy of a live show, fed by a fake relay ———
  {
    const { ctx: c0, p: p0 } = await open()
    const base = await p0.evaluate(() => JSON.stringify(window.bento.doc))
    await c0.close()
    const enc = (b) => Buffer.from(b).toString('base64url')
    const subtle = webcrypto.subtle
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const keyRaw = webcrypto.getRandomValues(new Uint8Array(32))
    const doc = JSON.parse(base)
    doc.collab = {
      v: 2, on: true, room: 'wMP09ROOM', key: enc(keyRaw), owner: 'OWNERPUB', role: 'audience',
      invite: { pub: 'INVPUB', priv: enc(new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey))), role: 'audience', sig: 'SIG' },
    }
    const shell = readFileSync(SHELL, 'utf8')
    const open1 = '<script type="application/bento+json" id="bento-doc">'
    const a = shell.indexOf(open1) + open1.length
    const b = shell.indexOf('</' + 'script>', a)
    const dir = mkdtempSync(join(tmpdir(), 'mp09-'))
    const file = join(dir, 'audience.bento.html')
    writeFileSync(file, shell.slice(0, a) + JSON.stringify(doc).replace(/</g, '\\u003c') + shell.slice(b))
    const aesKey = await subtle.importKey('raw', keyRaw, 'AES-GCM', false, ['encrypt'])
    const seal = async (ctl, payload) => {
      const iv = webcrypto.getRandomValues(new Uint8Array(12))
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(JSON.stringify(payload)))
      return JSON.stringify({ ctl, i: enc(iv), d: enc(new Uint8Array(ct)) })
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('bento-reduce-motion', 'on'); localStorage.setItem('bento-show-keys-hint', '1') } catch {} })
    // the relay is a fake answered here: no socket ever reaches a real host
    let relay = null
    let sockets = 0
    await ctx.routeWebSocket(/.*/, (ws) => { sockets++; relay = ws; ws.onMessage(() => {}) })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto('file://' + file)
    await p.waitForFunction(() => document.querySelector('.bento-present-overlay .bento-follow-chip'), null, { timeout: 20000 })
    for (let i = 0; i < 100 && !relay; i++) await p.waitForTimeout(100)
    ok(!!relay && sockets === 1, `CONTROL: the audience copy connected to the fake relay (${sockets} socket)`)
    relay?.send(JSON.stringify({ ctl: 'ready', bc: 1, v: 2 }))
    const nav = async (vis, lock) => { relay?.send(await seal('nav', { id: doc.slides[doc.slides.findIndex((s, i) => !s.stateOf && !s.hidden && doc.slides.slice(0, i + 1).filter((x) => !x.stateOf && !x.hidden).length === vis)].id, i: vis, lock, step: 0 })); await p.waitForTimeout(500) }
    await nav(3, false)
    let s = await state(p)
    const chip = () => p.evaluate(() => ({ locked: !!document.querySelector('.bento-follow-chip')?.disabled, text: document.querySelector('.bento-follow-chip')?.textContent }))
    ok(s?.counter.startsWith('3 /') && !(await chip()).locked, `CONTROL: the presenter's nav moved the copy to slide 3, unlocked (${fmt(s)}, ${JSON.stringify(await chip())})`)
    await press(p, 'g', 300)
    s = await state(p)
    ok(s?.grid, `9. an unlocked audience copy may open the grid (${fmt(s)})`)
    await press(p, 'Escape'); await press(p, '5')
    s = await state(p)
    ok(s?.chip === 'Go to 5', `9. and type a number (${fmt(s)})`)
    await press(p, 'Escape')
    await press(p, 'g', 300)
    await nav(4, true)
    s = await state(p)
    ok((await chip()).locked && s?.counter.startsWith('4 /'), `CONTROL: a locked nav holds the copy on slide 4 (${fmt(s)}, ${JSON.stringify(await chip())})`)
    ok(s && !s.grid, `9. the lock closes an open grid (${fmt(s)})`)
    await press(p, 'g', 300); await press(p, 'o', 300)
    s = await state(p)
    ok(s && !s.grid, `9. G and O do nothing while locked (${fmt(s)})`)
    await press(p, '1'); await press(p, 'Enter', 300)
    s = await state(p)
    ok(s && !s.chip && s.counter.startsWith('4 /'), `9. a typed number does nothing while locked (${fmt(s)})`)
    await nav(4, false)
    await press(p, 'g', 300)
    s = await state(p)
    ok(s?.grid, `9. unlocked again, G opens the grid (${fmt(s)})`)
    ok(errors.length === 0, `no page errors ${errors.join('; ')}`)
    await ctx.close()
    rmSync(dir, { recursive: true, force: true })
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
