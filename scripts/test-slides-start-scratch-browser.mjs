// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// File ▸ Start from scratch asks which fresh start, with real input, in the built shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-start-scratch-browser.mjs
//
// WHAT THIS PROVES, on the Showcase a fresh profile opens with:
//   1. Start from scratch opens a dialog (the kernel primitive, no native
//      confirm) with two choices and Cancel, saying how many slides go and how
//      to undo; Escape, Cancel, and ⌘Z, Delete, Backspace or an arrow
//      pressed while it is up (an element selected behind it) change nothing;
//      Up and Down move between the choices; the ⌘K palette's start-scratch entry opens the same dialog.
//   2. Keep this look leaves one slide that paints in the deck's palette (a
//      Background edit in the Tokens tab repaints it), tokens intact, no demo
//      slide; the Showcase's title becomes "Untitled deck", the caret is in
//      the title field, and one ⌘Z right there brings the whole deck back.
//   3. Blank leaves no token, no saved layout, no unreferenced asset, the
//      default white theme; one ⌘Z brings the deck back, title included.
//   4. A title someone typed is kept; docId and collab never change; in
//      German the strings and the untitled name are German.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

async function boot(browser, locale) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
  await ctx.route(/^https?:/, (r) => r.abort())
  // route() does not see WebSockets: a live session must never reach a relay
  await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  const p = await ctx.newPage()
  const errors = [], natives = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => { natives.push(d.message()); void d.dismiss() })
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale'))
  await p.evaluate(() => document.querySelector('.ed-keys-overlay, .ed-about-overlay')?.remove())
  return { ctx, p, errors, natives }
}

/** The document's state as the criteria read it. */
const state = (p) => p.evaluate(() => {
  const d = window.bento.doc
  const used = new Set()
  const ref = (v) => { if (typeof v === 'string' && v.startsWith('asset:')) used.add(v.slice(6)) }
  for (const s of [...d.slides, ...(d.layouts ?? [])]) for (const e of s.elements) {
    ref(e.src); ref(e.poster); ref(e.view); ref(e.doc)
    if (e.asset) used.add(e.asset)
    if (e.grammarAssetId) used.add(e.grammarAssetId)
    if (e.themeAssetId) used.add(e.themeAssetId)
  }
  for (const f of d.fonts ?? []) if (f.asset) used.add(f.asset)
  return {
    json: JSON.stringify({ ...d, modified: undefined }),
    title: d.title, field: document.querySelector('.ed-topbar .ed-title').value,
    slides: d.slides.length, slideIds: d.slides.map((s) => s.id),
    tokens: Object.keys(d.theme.tokens?.set ?? {}).length,
    layouts: (d.layouts ?? []).length,
    unreferenced: Object.keys(d.assets ?? {}).filter((k) => !used.has(k)),
    bg: d.slides[0].background, themeBg: d.theme.background,
    docId: d.docId, collab: JSON.stringify(d.collab ?? null),
    mains: d.slides.flatMap((s) => s.elements).filter((e) => e.component?.main).length,
  }
})

async function openFromMenu(p) {
  await p.locator('.ed-logo').click()
  await p.locator('.ed-menu-row', { hasText: /Start from scratch|Von vorne beginnen/ }).first().click()
  return p.waitForSelector('.bkd-card .ed-scratch-choice', { timeout: 3000 }).then(() => true, () => false)
}
const dialogUp = (p) => p.evaluate(() => !!document.querySelector('.bkd-overlay'))
const slidePaint = (p) => p.evaluate(() => getComputedStyle(document.querySelector('.ed-stage-scale .bento-slide')).backgroundColor)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  // ------------------------------------------------------------ the dialog
  console.log('\nThe dialog')
  {
    const { ctx, p, errors, natives } = await boot(browser, 'en-US')
    const first = await state(p)
    ok(first.title === 'Bento Slides Showcase' && first.slides > 1 && first.tokens > 0, `the Showcase opens (${first.slides} slides, ${first.tokens} tokens)`)
    // one edit on the undo stack, so a ⌘Z leaking past the dialog would show
    await p.locator('.ed-topbar .ed-title').click()
    await p.keyboard.press(`${MOD}+a`)
    await p.keyboard.type('Draft')
    await p.keyboard.press('Enter')
    await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
    const s0 = await state(p)
    ok(s0.title === 'Draft', 'an edit is on the undo stack')
    const opened = await openFromMenu(p)
    ok(opened && natives.length === 0, `File ▸ Start from scratch opens a dialog, no native confirm${natives.length ? ': ' + natives[0] : ''}`)
    if (opened) {
      const d = await p.evaluate(() => ({
        role: document.querySelector('.bkd-card').getAttribute('role'),
        choices: [...document.querySelectorAll('.ed-scratch-choice')].map((b) => b.dataset.choice),
        text: document.querySelector('.bkd-card').innerText,
        cancel: [...document.querySelectorAll('.bkd-actions button')].map((b) => b.textContent),
      }))
      ok(d.role === 'dialog' && d.choices.join() === 'keep,blank' && d.cancel.join() === 'Cancel', `two choices and Cancel (${d.choices.join(', ')} | ${d.cancel.join()})`)
      ok(d.text.includes(String(s0.slides)) && /(Ctrl\+Z|⌘Z) undoes it/.test(d.text), 'it says how many slides go and that ⌘Z undoes it')
      // the undo it mentions must not reach the deck behind it
      await p.keyboard.press(`${MOD}+z`)
      ok(await dialogUp(p) && (await state(p)).json === s0.json, '⌘Z while it is up changes nothing')
      await p.keyboard.press('Escape')
      ok(!(await dialogUp(p)) && (await state(p)).json === s0.json, 'Escape closes it and changes nothing')
    }
    if (await openFromMenu(p)) {
      await p.locator('.bkd-actions button', { hasText: 'Cancel' }).click()
      ok(!(await dialogUp(p)) && (await state(p)).json === s0.json, 'Cancel closes it and changes nothing')
    }
    // an element selected behind the dialog: no key may delete or nudge it
    const box = await p.evaluate(() => {
      const r = document.querySelector('.ed-stage-scale .bento-slide [data-el-id="sd-title"]').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await p.mouse.click(box.x, box.y)
    await p.waitForTimeout(100)
    const picked = await p.evaluate(() => window.bento.selection.length)
    ok(picked > 0, `an element is selected (${picked})`)
    const sSel = await state(p)
    const KEYS = ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowDown']
    if (await openFromMenu(p)) {
      const focus = () => p.evaluate(() => document.activeElement?.dataset?.choice ?? document.activeElement?.textContent)
      const f0 = await focus()
      await p.keyboard.press('ArrowDown')
      const f1 = await focus()
      await p.keyboard.press('ArrowUp')
      const f2 = await focus()
      ok(f0 === 'keep' && f1 === 'blank' && f2 === 'keep', `Up and Down move between the choices (${f0} → ${f1} → ${f2})`)
      for (const k of KEYS) await p.keyboard.press(k)
      await p.keyboard.press('Shift+Tab') // onto Cancel: a plain button, outside the list
      const onCancel = await focus()
      for (const k of KEYS) await p.keyboard.press(k)
      await p.keyboard.press('Escape')
      const after = await state(p)
      ok(!(await dialogUp(p)) && after.json === sSel.json, `Delete, Backspace, arrows and Shift+arrows behind the dialog change nothing (focus on a choice, then on ${onCancel})${after.json === sSel.json ? '' : ` — ${after.slideIds.length} slides, selection ${await p.evaluate(() => window.bento.selection.length)}`}`)
    }
    if (await openFromMenu(p)) {
      for (const k of KEYS) await p.keyboard.press(k)
      await p.locator('.bkd-actions button', { hasText: 'Cancel' }).click()
      ok((await state(p)).json === sSel.json, 'the same keys, then Cancel: nothing changed')
    }
    // the command palette entry
    await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
    await p.keyboard.press(`${MOD}+k`)
    await p.keyboard.type('Start from scratch')
    await p.keyboard.press('Enter')
    const viaPalette = await p.waitForSelector('.bkd-card .ed-scratch-choice', { timeout: 3000 }).then(() => true, () => false)
    ok(viaPalette && natives.length === 0, 'the ⌘K palette entry opens the same dialog')
    if (viaPalette) await p.keyboard.press('Escape')
    ok((await state(p)).json === s0.json, 'still nothing changed')
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }

  // ------------------------------------------------------------ keep this look
  console.log('\nKeep this look')
  {
    const { ctx, p, errors } = await boot(browser, 'en-US')
    const s0 = await state(p)
    if (await openFromMenu(p)) await p.locator('.ed-scratch-choice[data-choice=keep]').click()
    const s1 = await state(p)
    ok(s1.slides === 1 && !s0.slideIds.includes(s1.slideIds[0]), `one new slide, no demo slide remains (${s1.slides})`)
    ok(s1.tokens === s0.tokens, `tokens intact (${s1.tokens})`)
    ok(s1.mains === 0, 'no component main remains')
    ok(s1.unreferenced.length === 0, `no unreferenced asset${s1.unreferenced.length ? ': ' + s1.unreferenced.join(', ') : ''}`)
    ok(s1.bg === s1.themeBg, `the slide is the theme Background (${s1.bg})`)
    ok(s1.title === 'Untitled deck' && s1.field === 'Untitled deck', `the Showcase title becomes "Untitled deck" (${s1.title} / field ${s1.field})`)
    ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-title')), 'the caret is in the title field')
    ok(s1.docId === s0.docId && s1.collab === s0.collab, 'docId and collab unchanged')
    // one ⌘Z right there, caret still in the title: the whole deck comes back
    await p.keyboard.press(`${MOD}+z`)
    const s2 = await state(p)
    ok(s2.json === s0.json, `one ⌘Z restores the whole deck (${s2.slides} slides, "${s2.title}")`)
    ok(s2.field === s0.title, `…and the title field (${s2.field})`)
    await p.keyboard.press(`${MOD}+Shift+z`)
    // a palette edit, in the Tokens tab, repaints the new slide
    const before = await slidePaint(p)
    await p.locator('[role=tab]', { hasText: 'Tokens' }).click()
    await p.locator('.ed-token-builtin[data-slot=bg1] .ed-token-value').click()
    await p.keyboard.press(`${MOD}+a`)
    await p.keyboard.type('204060')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(150)
    const after = await slidePaint(p)
    ok(before !== after && after === 'rgb(32, 64, 96)', `changing Background in Tokens repaints the slide (${before} → ${after})`)
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }

  // ------------------------------------------------------------ blank
  console.log('\nBlank')
  {
    const { ctx, p, errors } = await boot(browser, 'en-US')
    const s0 = await state(p)
    if (await openFromMenu(p)) await p.locator('.ed-scratch-choice[data-choice=blank]').click()
    const s1 = await state(p)
    ok(s1.slides === 1 && !s0.slideIds.includes(s1.slideIds[0]), 'one new slide')
    ok(s1.tokens === 0, `no tokens (${s0.tokens} before)`)
    ok(s1.layouts === 0, 'no saved layouts')
    ok(s1.unreferenced.length === 0, `no unreferenced asset${s1.unreferenced.length ? ': ' + s1.unreferenced.join(', ') : ''}`)
    ok(s1.themeBg === '#FFFFFF' && s1.bg === '#FFFFFF', 'the default white theme')
    ok(await slidePaint(p) === 'rgb(255, 255, 255)', 'the slide paints white')
    ok(s1.title === 'Untitled deck', `the Showcase title becomes "Untitled deck" (${s1.title})`)
    ok(s1.docId === s0.docId && s1.collab === s0.collab, 'docId and collab unchanged')
    // leave the title field, then one ⌘Z on the canvas
    await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
    await p.keyboard.press(`${MOD}+z`)
    const s2 = await state(p)
    ok(s2.json === s0.json, `one ⌘Z restores the whole deck, title included (${s2.slides} slides, "${s2.title}", ${s2.tokens} tokens)`)
    // a title someone typed is kept
    await p.locator('.ed-topbar .ed-title').click()
    await p.keyboard.press(`${MOD}+a`)
    await p.keyboard.type('Q3 review')
    await p.keyboard.press('Enter')
    await p.locator('.ed-stage-scale').click({ position: { x: 4, y: 4 }, force: true })
    if (await openFromMenu(p)) await p.locator('.ed-scratch-choice[data-choice=blank]').click()
    const s3 = await state(p)
    ok(s3.title === 'Q3 review' && s3.slides === 1, `a title someone typed is kept (${s3.title})`)
    ok(!(await p.evaluate(() => document.activeElement?.classList.contains('ed-title'))), 'and the caret is not moved to it')
    ok(s3.docId === s0.docId && s3.collab === s0.collab, 'docId and collab unchanged')
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }

  // ------------------------------------------------------------ German
  console.log('\nIn German')
  {
    const { ctx, p, errors } = await boot(browser, 'de-DE')
    if (await openFromMenu(p)) {
      const text = await p.evaluate(() => document.querySelector('.bkd-card').innerText)
      ok(text.includes('Von vorne beginnen') && text.includes('Dieses Aussehen behalten') && text.includes('Abbrechen'), 'the dialog is German')
      await p.locator('.ed-scratch-choice[data-choice=keep]').click()
    }
    const s = await state(p)
    ok(s.title === 'Unbenannte Präsentation', `the untitled name is German (${s.title})`)
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
