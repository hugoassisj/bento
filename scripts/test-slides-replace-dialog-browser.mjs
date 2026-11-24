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
// Every press waits for a known state first: the dialog reviews a paste by
// itself, so a press racing that review would test the timing, not the dialog.
// No network: http(s) aborted, WebSockets closed, offline mode on.
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
  const reviewedState = () => p.waitForFunction(() => document.querySelector('[role=dialog] [role=status]')?.textContent !== '', null, { timeout: 15000 })
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
    await p.waitForFunction(() => document.querySelector('[role=dialog] .ed-btn-primary')?.textContent === 'Apply changes', null, { timeout: 15000 })
    await p.waitForTimeout(700)
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
    await paste('```json\n' + JSON.stringify(edited) + '\n```')
    s = await state()
    ok(s.button === 'Apply changes' && /Slides changed \(1\)/.test(s.status), 'a paste is reviewed by itself')
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
    await p.evaluate(() => {
      // hold the next review on the main thread for 1.5 s, once
      const parse = JSON.parse
      window.__slow = true
      JSON.parse = function (...a) {
        if (window.__slow) {
          window.__slow = false
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
    })
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
    await apply()
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

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
