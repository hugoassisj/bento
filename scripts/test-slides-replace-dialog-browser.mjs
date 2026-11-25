// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Replace from JSON… with a chatbot's reply, in the built shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-replace-dialog-browser.mjs
//
// WHAT THIS PROVES (editor.ts openReplaceJson, editor/pastejson.ts):
//   1. The dialog is a real dialog (kernel createDialog): role, a sentence of
//      instructions, focus in the text box; Escape closes it and focus goes
//      back where it was.
//   2. The six replies of the audit: a fenced reply, prose then a fence and a
//      trailing comma are reviewed, each with its repair named; a reply cut
//      off at 60%, a syntax error (line and column), {"hello": "world"} and
//      nothing are each refused with their own reason. The deck is unchanged
//      after every one of them.
//   3. Nothing is applied before the summary is on show: the first press
//      reviews; editing the text after a review needs a new one.
//   4. A reply with half the slides says how many it removes and which, and
//      applies only after the explicit tick.
//   5. Dropped fields and findings are listed in the dialog and Copy report
//      copies them.
//   6. Applying is one undo step, and the deck keeps its own docId and collab
//      when the reply carries foreign ones.
//   7. A click aimed at "Review changes" that the page receives only after a
//      (slow) review has turned the button into "Apply changes" applies
//      nothing — trusted mouse input, queued behind a review held at 1.5 s.
//   8. Keyboard only: when the review disables the focused button (a reply
//      that removes slides), focus moves to the tick and stays in the dialog;
//      opened from ⌘K, Escape puts focus on the File button, not the page.
//   9. Enter or Space HELD for 2 s across the review applies nothing and
//      never reaches the File menu behind the dialog; a click made with the
//      summary on screen still applies.
//  10. A finger put down while the dialog resizes (it lands on the scrim) and
//      held across the summary appearing applies nothing when lifted over
//      Apply changes — CDP touch events, at CPU throttle 1, 4 and 6; a tap
//      with the summary on screen applies.
//  11. The deck changes while the summary is on show — a collaborator in
//      another tab adds a slide, then edits a text; an undo here: the summary
//      says the deck changed and Apply reviews again (fresh summary, fresh
//      half second); the collaborator's slide is never removed without the
//      tick, and their edit is counted as a changed slide.
// Also: a fresh summary shows Apply as not ready (aria-disabled) for half a
// second; "Reviewing…" is on show for a painted frame before a slow parse;
// applying uses the reviewed document instead of parsing the reply again.
// Every press waits for a known state first: the dialog reviews a paste by
// itself, so a press racing that review would test the timing, not the dialog.
// No network: http(s) aborted (section 11 serves the shell from 127.0.0.1),
// WebSockets closed, offline mode on (off in 11, which uses the same-machine
// channel between two tabs and no relay).
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const run = async (fn) => { try { await fn() } catch (e) { ok(false, `threw: ${String(e.message).split('\n')[0]}`) } }
const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z'

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(() => {
    try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-offline', 'on') } catch {}
    // the clipboard, observed (file:// has no clipboard permission to grant)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => { window.__copied = s }, readText: async () => '' } })
  })
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.dismiss())
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'))
  await p.waitForTimeout(400)

  const docJson = () => p.evaluate(() => JSON.stringify(window.bento.doc))
  const original = await docJson()
  const deck = JSON.parse(original)
  const n = deck.slides.length
  const full = JSON.stringify(deck)
  const pretty = JSON.stringify(deck, null, 2)
  const openDialog = async () => {
    if (await p.$('[role=dialog]')) { await p.keyboard.press('Escape'); await p.waitForTimeout(100) }
    await p.click('.ed-logo'); await p.waitForTimeout(100)
    await p.click('.ed-file-menu [data-cmd="replace-json"]')
    await p.waitForSelector('[role=dialog] textarea', { timeout: 3000 })
  }
  const dialogOpen = () => p.evaluate(() => !!document.querySelector('[role=dialog] textarea'))
  const primary = '[role=dialog] .ed-btn-primary'
  // the value and the input event it fires (page.fill types a 280 KB reply
  // through the editing pipeline, which takes minutes). 'insertFromPaste' is
  // reviewed by the dialog by itself; 'insertText' (typing) waits for a press.
  const input = (text, inputType) => p.evaluate(([v, k]) => {
    const ta = document.querySelector('[role=dialog] textarea')
    ta.focus(); ta.value = v; ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: k }))
  }, [text, inputType])
  const reviewedState = () => p.waitForFunction(() => {
    const st = document.querySelector('[role=dialog] [role=status]')
    return st && st.textContent !== '' && !st.dataset.busy
  }, null, { timeout: 15000 })
  // a paste, then its automatic review on show
  const paste = async (text) => { await input(text, 'insertFromPaste'); await reviewedState() }
  // typed text, then a press of "Review changes"
  const typeAndReview = async (text) => {
    await input(text, 'insertText')
    ok(await p.$eval(primary, (b) => b.textContent) === 'Review changes', 'typing does not review by itself: the button still reads Review changes')
    await p.click(primary); await reviewedState()
  }
  // the second press, once the summary has been on screen for a moment
  const apply = async () => {
    await p.waitForFunction(() => { const b = document.querySelector('[role=dialog] .ed-btn-primary'); return b?.textContent === 'Apply changes' && !b.hasAttribute('aria-disabled') }, null, { timeout: 15000 })
    await p.waitForTimeout(150)
    await p.click(primary); await p.waitForTimeout(150)
  }
  const state = () => p.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    const b = d?.querySelector('.ed-btn-primary')
    const tick = d?.querySelector('.ed-replace-confirm')
    return {
      status: d?.querySelector('[role=status]')?.textContent ?? '',
      lines: [...(d?.querySelectorAll('[role=status] > div') ?? [])].map((x) => x.textContent),
      report: [...(d?.querySelectorAll('.ed-replace-report li') ?? [])].map((x) => x.textContent),
      button: b?.textContent ?? '', disabled: !!b?.disabled,
      invalid: d?.querySelector('textarea')?.getAttribute('aria-invalid') === 'true',
      tick: !!tick && !tick.hidden && tick.offsetParent !== null, tickText: tick?.textContent ?? '',
      slides: window.bento.doc.slides.length,
    }
  })

  console.log('\n1. A dialog, and Escape\n')
  await run(async () => {
    await openDialog()
    const d = await p.evaluate(() => {
      const dlg = document.querySelector('[role=dialog]')
      return { modal: dlg?.getAttribute('aria-modal'), title: dlg?.querySelector('#' + dlg.getAttribute('aria-labelledby'))?.textContent, text: dlg?.textContent ?? '', focus: document.activeElement?.tagName }
    })
    ok(d.modal === 'true' && d.title === 'Replace from JSON', `role=dialog, aria-modal, labelled by its title (${d.title})`)
    ok(/chatbot/.test(d.text) && /nothing changes until/.test(d.text), 'one sentence of instructions above the text box')
    ok(d.focus === 'TEXTAREA', `focus is in the text box (${d.focus})`)
    await p.keyboard.press('Escape'); await p.waitForTimeout(80)
    const after = await p.evaluate(() => ({ open: !!document.querySelector('[role=dialog]'), focus: document.activeElement?.className ?? '' }))
    ok(!after.open, 'Escape closes it')
    ok(/ed-logo/.test(after.focus), `focus returns to where it was (${after.focus})`)
  })

  console.log('\n2. The six replies of the audit\n')
  await run(async () => {
    await openDialog()
    const cases = [
      ['a ```json fence', '```json\n' + full + '\n```', /Markdown code fence/, true],
      ['a sentence, then the fence', 'Here is your updated deck:\n\n```json\n' + pretty + '\n```', /code fence.*ignored the text around the JSON/s, true],
      ['a trailing comma before the final }', full.replace(/\}$/, ',}'), /trailing commas removed \(1\)/, true],
      ['cut off at 60%', full.slice(0, Math.floor(full.length * 0.6)), /cut off: it ends before the document closes/, false],
      ['a syntax error', pretty.replace(/\n  "title"/, '\n  "title" "x",\n  "title"'), /JSON syntax error at line \d+, column \d+/, false],
      ['{"hello": "world"}', '{"hello": "world"}', /Not a bento\/slides document/, false],
      ['nothing', '', /Nothing to apply/, false],
    ]
    for (const [name, text, want, loads] of cases) {
      await paste(text)
      const s = await state()
      ok(want.test(s.status), `${name}: "${s.lines.join(' | ').slice(0, 140)}"`)
      if (loads) ok(s.button === 'Apply changes' && !s.invalid && new RegExp(`Slides: ${n} → ${n}`).test(s.status) && /No changes to the slides/.test(s.status), `${name}: reviewed — ${n} → ${n} slides, no changes, button reads "${s.button}"`)
      else ok(s.button === 'Review changes' && s.invalid, `${name}: refused — the text box is marked invalid, nothing to apply ("${s.button}")`)
      ok(await docJson() === original && await dialogOpen(), `${name}: the deck is unchanged and the dialog stays open`)
    }
    const syntax = pretty.replace(/\n  "title"/, '\n  "title" "x",\n  "title"')
    const line = syntax.slice(0, syntax.indexOf('"title" "x"')).split('\n').length
    await typeAndReview(syntax)
    ok(new RegExp(`line ${line}, column 11`).test((await state()).status), `the syntax error is placed where it is in the text: line ${line}, column 11`)
    await p.keyboard.press('Escape')
  })

  console.log('\n3. Review first, then apply\n')
  await run(async () => {
    const edited = JSON.parse(full)
    const s2 = edited.slides[1]
    const target = s2.elements.find((e) => e.type === 'text')
    target.html = 'Tidied by a chatbot'
    await openDialog()
    await paste('```json\n' + JSON.stringify(edited) + '\n```')
    let s = await state()
    ok(s.button === 'Apply changes' && new RegExp(`Slides changed \\(1\\): ${s2.id}`).test(s.status) && /Elements changed: 1/.test(s.status), `the summary names the slide and counts the element ("${s.lines.slice(1).join(' | ')}")`)
    ok(await docJson() === original, 'still nothing applied after the review')
    // edit after the review: the summary on show no longer describes the text
    await typeAndReview('```json\n' + full + '\n```')
    s = await state()
    ok(await docJson() === original && /No changes to the slides/.test(s.status), 'text edited after a review: the press reviews again instead of applying')
    // the moment the summary arms the button, click it (in the page, so the
    // click lands inside the half second whatever the rig's own latency)
    const seen = p.evaluate(() => new Promise((done) => {
      const b = document.querySelector('[role=dialog] .ed-btn-primary')
      const mo = new MutationObserver(() => {
        if (b.textContent !== 'Apply changes') return
        mo.disconnect()
        const notReady = b.getAttribute('aria-disabled') === 'true'
        b.click()
        done(notReady)
      })
      mo.observe(b, { childList: true, characterData: true, subtree: true })
    }))
    await input('```json\n' + JSON.stringify(edited) + '\n```', 'insertFromPaste')
    const notReady = await seen
    await reviewedState(); await p.waitForTimeout(100)
    s = await state()
    ok(s.button === 'Apply changes' && /Slides changed \(1\)/.test(s.status), 'a paste is reviewed by itself')
    ok(notReady, 'a fresh summary shows Apply changes as not ready (aria-disabled)')
    ok(await docJson() === original && await dialogOpen(), 'a click while it is not ready applies nothing')
    await p.waitForTimeout(600)
    ok(await p.$eval(primary, (b) => !b.hasAttribute('aria-disabled')), 'half a second on, it is ready')
    await apply()
    const now = await p.evaluate(() => window.bento.doc)
    ok(!(await dialogOpen()) && now.slides[1].elements.find((e) => e.id === target.id)?.html === 'Tidied by a chatbot', 'the second press applies and closes')
    await p.click('.ed-scroll', { position: { x: 5, y: 5 } }).catch(() => {})
    await p.keyboard.press('Escape')
    await p.keyboard.press(UNDO); await p.waitForTimeout(150)
    ok(await docJson() === original, 'one undo step restores the deck exactly')
  })

  console.log('\n4. Half the slides\n')
  await run(async () => {
    const half = JSON.parse(full)
    half.slides = half.slides.slice(0, Math.ceil(n / 2))
    const gone = n - half.slides.length
    await openDialog()
    await paste('Here is the tidied deck:\n```json\n' + JSON.stringify(half, null, 2) + '\n```')
    let s = await state()
    ok(new RegExp(`Slides: ${n} → ${half.slides.length}`).test(s.status) && new RegExp(`Slides removed \\(${gone}\\): ${deck.slides[half.slides.length].id}`).test(s.status), `the summary says ${gone} slides go, by id`)
    ok(s.tick && new RegExp(`removes ${gone} of ${n} slides`).test(s.tickText), `an explicit confirmation line: "${s.tickText}"`)
    ok(s.disabled, 'Apply changes is disabled until it is ticked')
    await p.click(primary, { force: true }).catch(() => {})
    ok((await state()).slides === n, 'pressing it anyway applies nothing')
    await p.click('[role=dialog] .ed-replace-confirm input')
    s = await state()
    ok(!s.disabled, 'ticked: Apply changes is enabled')
    await apply()
    ok((await state()).slides === half.slides.length && !(await dialogOpen()), `applied: ${half.slides.length} slides`)
    await p.keyboard.press(UNDO); await p.waitForTimeout(150)
    ok(await docJson() === original, `one undo step: ${n} slides again`)
  })

  console.log('\n5. The report, in the dialog\n')
  await run(async () => {
    const compact = { compact: true, slides: [{ id: 'r1', elements: [{ type: 'text', x: 96, y: 80, w: 400, h: 60, html: 'Hi', fontSze: 40 }] }] }
    await openDialog()
    await paste(JSON.stringify(compact))
    const s = await state()
    ok(/Fields dropped: 1/.test(s.status) && s.report.some((x) => /\/slides\/0\/elements\/0\/fontSze/.test(x)), `the dropped path is listed (${s.report[0]})`)
    ok(/Warnings: \d+/.test(s.status), 'warnings are counted')
    await p.click('[role=dialog] .bkd-actions .ed-btn:not(.ed-btn-primary)')
    await p.waitForTimeout(80)
    const copied = await p.evaluate(() => window.__copied ?? '')
    ok(/fontSze/.test(copied) && /Fields dropped: 1/.test(copied) && new RegExp(`Slides removed \\(${n}\\)`).test(copied), 'Copy report copies the summary and the list')
    ok(await p.evaluate(() => document.querySelector('[role=dialog] .bkd-actions .ed-btn')?.textContent) === 'Report copied', 'and says so')
    await p.keyboard.press('Escape')
  })

  console.log('\n6. Identity stays the deck’s own\n')
  await run(async () => {
    const before = await p.evaluate(() => ({ docId: window.bento.doc.docId, collab: JSON.stringify(window.bento.doc.collab ?? null) }))
    const foreign = JSON.parse(full)
    foreign.docId = 'foreign-doc-id'
    foreign.collab = { room: 'rforeign', key: 'k', on: true }
    foreign.title = 'Foreign title'
    await openDialog()
    await paste(JSON.stringify(foreign))
    await apply()
    const after = await p.evaluate(() => ({ docId: window.bento.doc.docId, collab: JSON.stringify(window.bento.doc.collab ?? null), title: window.bento.doc.title }))
    ok(after.title === 'Foreign title', 'the content was applied')
    ok(after.docId === before.docId && after.collab === before.collab, `docId and collab are still the deck’s own (${after.docId})`)
    await p.keyboard.press(UNDO); await p.waitForTimeout(150)
    ok(await docJson() === original, 'one undo step restores it')
  })

  console.log('\n7. A click queued behind a slow review applies nothing\n')
  await run(async () => {
    const mk = (s) => { const d = JSON.parse(full); d.slides[1].elements.find((e) => e.type === 'text').html = s; return '```json\n' + JSON.stringify(d, null, 2) + '\n```' }
    await openDialog()
    await paste(mk('Version A'))
    await p.waitForTimeout(400)
    const box = await p.locator(primary).boundingBox()
    const inner = mk('Version B').slice(8, -4) // the JSON inside the fence
    await p.evaluate((inner) => {
      // hold the next review on the main thread for 1.5 s, once
      const parse = JSON.parse
      window.__slow = true
      window.__parsesOfReply = 0
      window.__frames = 0
      const tickFrames = () => { window.__frames++; requestAnimationFrame(tickFrames) }
      requestAnimationFrame(tickFrames)
      new MutationObserver(() => {
        if (window.__busyFrame == null && document.querySelector('[role=dialog] [role=status]')?.textContent === 'Reviewing…') window.__busyFrame = window.__frames
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
      JSON.parse = function (...a) {
        if (a[0] === inner) window.__parsesOfReply++
        if (window.__slow) {
          window.__slow = false
          window.__parseFrame = window.__frames
          console.log('bento-rig: review held') // reaches the rig while the page is busy
          const t0 = performance.now(); while (performance.now() - t0 < 1500) { /* a big deck */ }
        }
        return parse.apply(this, a)
      }
      // the decision, instrumented: what the button said when the click arrived
      window.__clicks = []
      document.addEventListener('click', (e) => {
        const b = e.target.closest?.('.ed-btn-primary')
        if (b) window.__clicks.push(b.textContent)
      }, true)
    }, inner)
    const held = p.waitForEvent('console', { predicate: (m) => m.text() === 'bento-rig: review held', timeout: 15000 })
    await input(mk('Version B'), 'insertFromPaste') // reviewed by itself 100 ms on, for 1.5 s
    await held
    await p.waitForTimeout(200)
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2) // trusted, queued behind the review
    await p.waitForFunction(() => window.__clicks.length > 0 && !window.__slow, null, { timeout: 15000 })
    await p.waitForTimeout(600)
    const r = await p.evaluate(() => ({ clicks: window.__clicks, open: !!document.querySelector('[role=dialog] textarea'), b: window.bento.doc.slides[1].elements.some((e) => e.html === 'Version B'), label: document.querySelector('[role=dialog] .ed-btn-primary')?.textContent }))
    ok(r.clicks[0] === 'Apply changes', `the race is staged: the click reached the button after it read "Apply changes" (${JSON.stringify(r.clicks)})`)
    ok(!r.b && r.open && await docJson() === original, 'that click applied nothing; the dialog stays open on the summary')
    const fr = await p.evaluate(() => ({ busy: window.__busyFrame, parse: window.__parseFrame, n: window.__parsesOfReply }))
    ok(fr.busy != null && fr.parse > fr.busy, `"Reviewing…" was on show for a painted frame before the slow parse began (frame ${fr.busy} → ${fr.parse})`)
    await apply()
    const n2 = await p.evaluate(() => window.__parsesOfReply)
    ok(n2 === fr.n, `applying uses the reviewed document: the reply is not parsed again (${fr.n} → ${n2})`)
    ok(await p.evaluate(() => window.bento.doc.slides[1].elements.some((e) => e.html === 'Version B')), 'a click made with the summary on screen applies it')
    await p.keyboard.press(UNDO); await p.waitForTimeout(150)
    ok(await docJson() === original, 'one undo step restores it')
  })

  console.log('\n8. Keyboard only\n')
  await run(async () => {
    const half = JSON.parse(full)
    half.slides = half.slides.slice(0, 3)
    await openDialog()
    await input(JSON.stringify(half), 'insertText')
    for (let i = 0; i < 6 && !(await p.evaluate(() => document.activeElement?.classList.contains('ed-btn-primary'))); i++) await p.keyboard.press('Tab')
    ok(await p.evaluate(() => document.activeElement?.textContent) === 'Review changes', 'Tab reaches Review changes')
    await p.keyboard.press('Enter'); await reviewedState()
    const f = await p.evaluate(() => ({ type: document.activeElement?.type, inDialog: !!document.activeElement?.closest('[role=dialog]'), disabled: document.querySelector('[role=dialog] .ed-btn-primary').disabled }))
    ok(f.disabled && f.type === 'checkbox' && f.inDialog, `the button disabled itself; focus moved to the tick (${JSON.stringify(f)})`)
    await p.keyboard.press('Space')
    ok(await p.evaluate(() => !document.querySelector('[role=dialog] .ed-btn-primary').disabled), 'Space ticks it and enables Apply changes')
    let inside = true
    for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); inside &&= await p.evaluate(() => !!document.activeElement?.closest('[role=dialog]')) }
    ok(inside, 'Tab keeps cycling inside the dialog')
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    ok(await docJson() === original, 'Escape: nothing applied')
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await p.waitForTimeout(150)
    await p.keyboard.type('Replace from JSON'); await p.waitForTimeout(150)
    await p.keyboard.press('Enter')
    await p.waitForSelector('[role=dialog] textarea', { timeout: 3000 })
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    const back = await p.evaluate(() => document.activeElement?.className ?? '')
    ok(/ed-logo/.test(back), `opened from ⌘K, Escape puts focus on the File button (${back || 'body'})`)
  })

  console.log('\n9. A held key is not a decision\n')
  await run(async () => {
    const d = JSON.parse(full); d.slides[1].elements.find((e) => e.type === 'text').html = 'Held key'
    const applied = () => p.evaluate(() => window.bento.doc.slides[1].elements.some((e) => e.html === 'Held key'))
    const hold = async (key) => {
      await p.keyboard.down(key)
      for (let i = 0; i < 60; i++) { await p.waitForTimeout(33); await p.keyboard.down(key) } // repeat: true
      await p.keyboard.up(key)
      await p.waitForTimeout(150)
    }
    const after = () => p.evaluate(() => ({ open: !!document.querySelector('[role=dialog] textarea'), menu: !!document.querySelector('.ed-file.open'), inDialog: !!document.activeElement?.closest('[role=dialog]'), label: document.querySelector('[role=dialog] .ed-btn-primary')?.textContent }))
    await openDialog()
    await p.evaluate(() => { window.__repeats = { Enter: 0, ' ': 0 }; document.addEventListener('keydown', (e) => { if (e.repeat && e.key in window.__repeats) window.__repeats[e.key]++ }, true) })
    await input('```json\n' + JSON.stringify(d) + '\n```', 'insertText') // typed: reviewed by the press
    await p.focus(primary)
    await hold('Enter')
    let a = await after()
    ok(await p.evaluate(() => window.__repeats.Enter) >= 50, `the held key auto-repeats (${await p.evaluate(() => window.__repeats.Enter)} repeat keydowns)`)
    ok(!(await applied()) && a.open && a.label === 'Apply changes', `Enter held 2 s: the first press reviewed, its repeats applied nothing (${JSON.stringify(a)})`)
    ok(!a.menu && a.inDialog, 'and nothing reached the File menu behind the dialog')
    await p.focus(primary)
    await hold('Space')
    a = await after()
    ok(await p.evaluate(() => window.__repeats[' ']) >= 50, `Space auto-repeats too (${await p.evaluate(() => window.__repeats[' '])})`)
    ok(!(await applied()) && a.open && !a.menu && a.inDialog, `Space held 2 s with the summary on screen: released, it applies nothing (${JSON.stringify(a)})`)
    await p.waitForTimeout(600)
    await p.click(primary); await p.waitForTimeout(150)
    ok(await applied() && !(await dialogOpen()), 'a click with the summary on screen applies it')
    await p.keyboard.press(UNDO); await p.waitForTimeout(150)
    ok(await docJson() === original, 'one undo step restores it')
  })

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()

  // a reply = the deck with one text changed (fenced, as a chatbot sends it)
  const edit = (d0, html, at = 1) => { const d = JSON.parse(JSON.stringify(d0)); d.slides[at].elements.find((e) => e.type === 'text').html = html; return d }
  const fenced = (d) => '```json\n' + JSON.stringify(d, null, 2) + '\n```'

  console.log('\n10. A touch held across the summary appearing\n')
  for (const rate of [1, 4, 6]) {
    await run(async () => {
      const tc = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
      await tc.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-offline', 'on') } catch {} })
      await tc.route(/^https?:/, (r) => r.abort())
      if (tc.routeWebSocket) await tc.routeWebSocket(/.*/, (ws) => ws.close())
      const q = await tc.newPage()
      await q.goto('file://' + SHELL)
      await q.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'))
      await q.waitForTimeout(300)
      const d0 = await q.evaluate(() => { const d = structuredClone(window.bento.doc); delete d.collab; return d })
      await q.click('.ed-logo'); await q.waitForTimeout(100)
      await q.click('.ed-file-menu [data-cmd="replace-json"]')
      await q.waitForSelector('[role=dialog] textarea')
      const put = (v) => q.evaluate((v) => { const ta = document.querySelector('[role=dialog] textarea'); ta.value = v; ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })) }, v)
      const armed = () => q.waitForFunction(() => { const b = document.querySelector('[role=dialog] .ed-btn-primary'); return b?.textContent === 'Apply changes' }, null, { timeout: 30000 })
      await put(fenced(edit(d0, 'Touch A'))); await armed(); await q.waitForTimeout(800)
      const box = await q.locator('[role=dialog] .ed-btn-primary').boundingBox()
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2
      const cdp = await tc.newCDPSession(q)
      if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate })
      await q.evaluate(() => { window.__downOn = []; document.addEventListener('pointerdown', (e) => window.__downOn.push(e.target.closest?.('.ed-btn-primary') ? 'apply' : e.target.className), true) })
      // reply B: the old summary clears and the dialog shrinks under the finger
      await put(fenced(edit(d0, 'Touch B')))
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] })
      await armed()
      await q.waitForTimeout(700 * Math.max(1, rate / 2)) // held well past the half second
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await q.waitForTimeout(800 * Math.max(1, rate / 2))
      const r = await q.evaluate(() => ({ downOn: window.__downOn, open: !!document.querySelector('[role=dialog] textarea'), b: window.bento.doc.slides[1].elements.some((e) => e.html === 'Touch B') }))
      ok(r.downOn[0] && r.downOn[0] !== 'apply', `×${rate}: the finger went down off the button as the dialog resized (${JSON.stringify(r.downOn)})`)
      ok(!r.b && r.open, `×${rate}: lifted over Apply changes after the summary appeared, it applies nothing`)
      if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      if (rate === 1) {
        await q.waitForTimeout(600)
        await q.touchscreen.tap(cx, cy); await q.waitForTimeout(300)
        ok(await q.evaluate(() => window.bento.doc.slides[1].elements.some((e) => e.html === 'Touch B')), '×1: a tap with the summary on screen applies it')
      }
      await tc.close()
    })
  }

  console.log('\n11. The deck changes while the summary is on show\n')
  await run(async () => {
    // two tabs of one deck (a fixed docId) share edits over the same-machine channel
    const html = readFileSync(SHELL, 'utf8')
    const blockRe = /<script type="application\/bento\+json" id="bento-doc">[\s\S]*?<\/script>/
    const dd = JSON.parse(original); delete dd.collab
    dd.docId = 'rig-replace-live-' + Date.now()
    const page = html.replace(blockRe, () => '<script type="application/bento+json" id="bento-doc">\n' + JSON.stringify(dd).replace(/</g, '\\u003c') + '\n</scr' + 'ipt>')
    const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page) })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${server.address().port}/deck.html`
      const lc = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await lc.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
      if (lc.routeWebSocket) await lc.routeWebSocket(/.*/, (ws) => ws.close())
      await lc.route('**/*', (r) => { const u = r.request().url(); return u.startsWith('http://127.0.0.1') || /^(data|blob):/.test(u) ? r.continue() : r.abort() })
      const me = await lc.newPage()
      await me.goto(url); await me.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar')); await me.waitForTimeout(1500)
      const them = await lc.newPage()
      await them.goto(url); await them.waitForFunction(() => window.bento?.doc); await them.waitForTimeout(1500)
      const base = await me.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc)))
      const mine = (fn) => me.evaluate(fn)
      await me.click('.ed-logo'); await me.waitForTimeout(100)
      await me.click('.ed-file-menu [data-cmd="replace-json"]')
      await me.waitForSelector('[role=dialog] textarea')
      const put = (v) => me.evaluate((v) => { const ta = document.querySelector('[role=dialog] textarea'); ta.value = v; ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' })) }, v)
      const st = () => me.evaluate(() => {
        const d = document.querySelector('[role=dialog]'); const b = d?.querySelector('.ed-btn-primary'); const tk = d?.querySelector('.ed-replace-confirm')
        return { status: d?.querySelector('[role=status]')?.textContent ?? '', button: b?.textContent, notReady: b?.getAttribute('aria-disabled') === 'true', disabled: !!b?.disabled, tick: !!tk && !tk.hidden, open: !!d }
      })
      const settled = () => me.waitForFunction(() => { const s = document.querySelector('[role=dialog] [role=status]'); return s && s.textContent !== '' && !s.dataset.busy && document.querySelector('[role=dialog] .ed-btn-primary')?.textContent !== 'Review changes' }, null, { timeout: 15000 })
      const reply = edit(base, 'FROM REPLY')
      await put(fenced(reply)); await settled(); await me.waitForTimeout(700)
      let s = await st()
      ok(s.button === 'Apply changes' && /Slides changed \(1\)/.test(s.status) && !s.notReady, 'the reply is reviewed and ready: one slide changed')
      // the collaborator adds a slide
      await them.evaluate(() => { const d = window.bento.doc; const c = JSON.parse(JSON.stringify(d.slides[0])); c.id = 'collab-slide'; c.elements = c.elements.map((e, i) => ({ ...e, id: 'cx' + i })); d.slides.push(c); window.bento.sync.flush() })
      await me.waitForFunction(() => window.bento.doc.slides.some((x) => x.id === 'collab-slide'), null, { timeout: 10000 })
      await me.waitForTimeout(200)
      s = await st()
      ok(s.button === 'Review changes' && /The deck changed — review again/.test(s.status), `the summary goes stale when the deck changes ("${s.status}", ${s.button})`)
      await me.click('[role=dialog] .ed-btn-primary'); await settled()
      s = await st()
      ok(/Slides removed \(1\): collab-slide/.test(s.status) && s.tick && s.disabled, `Apply reviewed again: the collaborator's slide is counted as removed and needs the tick ("${s.status.slice(0, 120)}")`)
      ok(s.notReady, 'the fresh summary has its own half second')
      await me.click('[role=dialog] .ed-btn-primary', { force: true }).catch(() => {})
      await me.waitForTimeout(700)
      await me.click('[role=dialog] .ed-btn-primary', { force: true }).catch(() => {})
      ok(await mine(() => window.bento.doc.slides.some((x) => x.id === 'collab-slide')) && (await st()).open, 'without the tick, pressing Apply leaves the collaborator’s slide in place')
      // the collaborator edits a text on another slide
      await them.evaluate(() => { window.bento.doc.slides[2].elements.find((e) => e.type === 'text').html = 'COLLAB EDIT'; window.bento.sync.flush() })
      await me.waitForFunction(() => window.bento.doc.slides[2].elements.some((e) => e.html === 'COLLAB EDIT'), null, { timeout: 10000 })
      await me.waitForTimeout(200)
      s = await st()
      ok(s.button === 'Review changes' && /The deck changed/.test(s.status) && !s.tick, 'their edit makes the summary stale again (the tick is gone)')
      await me.click('[role=dialog] .ed-btn-primary'); await settled()
      s = await st()
      ok(/Slides changed \(2\)/.test(s.status) && s.status.includes(base.slides[2].id), `the reply would overwrite their edit, and the summary says so (${s.status.slice(0, 160)})`)
      // an undo here, while the summary is on show
      await me.waitForTimeout(700)
      await me.evaluate(() => window.bento.undo()); await me.waitForTimeout(200)
      s = await st()
      ok(s.button === 'Review changes' && /The deck changed/.test(s.status), 'an undo in this tab makes it stale too')
      // and once reviewed again, ticked and given its half second, it applies
      await me.click('[role=dialog] .ed-btn-primary'); await settled()
      const tk = await st()
      if (tk.tick) await me.click('[role=dialog] .ed-replace-confirm input')
      await me.waitForTimeout(700)
      await me.click('[role=dialog] .ed-btn-primary'); await me.waitForTimeout(300)
      ok(await mine(() => window.bento.doc.slides[1].elements.some((e) => e.html === 'FROM REPLY')) && !(await st()).open, 'reviewed again, ticked and confirmed, the reply applies')
      await lc.close()
    } finally { server.close() }
  })
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
