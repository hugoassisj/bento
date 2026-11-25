// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Print or save as PDF — the options sheet, end to end in the built shell.
//
//   npm run build:single --prefix slides && node scripts/test-slides-print-steps-browser.mjs
//
// WHAT THIS PROVES (window.print stubbed; the pages are read from #bento-print,
// and from Chromium's own PDF where size and pagination are the question).
//   1. Lighter file: on the starter deck the PDF is at most half the size of
//      the full-quality one, with text still text; only full-bleed svg and
//      pictures are re-drawn.
//   2. ⌘P opens a sheet, not the browser's dialog: it traps Tab, closes on
//      Escape, and hands focus back to the button that opened it.
//   3. The default (Slides, Full quality) is the page sequence the export
//      always produced: one page per linear slide, every step revealed, the
//      same @page rule. States and hidden slides stay out of every mode.
//   4. One page per click step: a slide with steps 1, 2, 3 is four pages —
//      none revealed, then one more step per page — hidden in print media by
//      computed visibility, and every step page keeps the slide's number; a
//      slide with no steps is one page.
//   5. Slides with notes: a page per slide carrying the slide and its notes
//      (as text, never markup); empty notes still get the page; a long note
//      runs on to a continuation page.
//   6. The choice is remembered per browser: ⇧⌘P and a Shift-click on the
//      File menu row print with it, with no sheet. Nothing reaches the
//      document — the #bento-doc block serialize() writes is the same before
//      and after every export.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  // never reach the network: no relay, no fonts, no http(s) at all
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => {
    try { localStorage.setItem('bento-offline', 'on') } catch {}
    window.__printed = 0
    window.print = () => { window.__printed++ }
  })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(process.env.SHELL_HTML ? 'file://' + process.env.SHELL_HTML : new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.waitForTimeout(500)

  const sheetOpen = () => p.evaluate(() => !!document.querySelector('.bkd-card'))
  /** Print through the sheet with these choices; resolves once print() ran. */
  const printVia = async (pages, backgrounds) => {
    const before = await p.evaluate(() => window.__printed)
    await p.keyboard.press('Control+p')
    await p.waitForSelector('.bkd-card select', { timeout: 3000 })
    await p.selectOption('.bkd-card select >> nth=0', pages)
    await p.selectOption('.bkd-card select >> nth=1', backgrounds)
    await p.click('.bkd-card .ed-btn-primary')
    await p.waitForFunction((n) => window.__printed > n, before, { timeout: 60000 })
  }
  const pdfBytes = async () => (await p.pdf({ preferCSSPageSize: true, printBackground: true }))
  /** The document block of serialize() — the shell around it re-renders its
   *  first-page preview each time (fresh gradient ids), the document must not move. */
  const docBlock = () => p.evaluate(() => {
    const html = window.bento.serialize()
    const m = /<script[^>]*id="bento-doc"[^>]*>([\s\S]*?)<\/script>/.exec(html)
    return m ? m[1] : null
  })

  console.log('\n1. Lighter file, on the starter deck\n')
  const starterBefore = await docBlock()
  await printVia('slides', 'full')
  const fullPdf = await pdfBytes()
  await printVia('slides', 'light')
  // read the pages before page.pdf(): its afterprint takes them down
  const redrawn = await p.evaluate(() => {
    const doc = window.bento.doc
    const out = { bleed: 0, png: 0, small: 0, smallSvg: 0 }
    for (const surface of document.querySelectorAll('#bento-print .bento-slide')) {
      const slide = doc.slides.find((s) => s.id === surface.dataset.slideId)
      for (const el of slide.elements) {
        if (el.type !== 'svg') continue
        const src = surface.querySelector(`[data-el-id="${CSS.escape(el.id)}"] img`)?.getAttribute('src') ?? ''
        // the part of the box on the slide covers half of it or more
        const W = doc.size.width, H = doc.size.height
        const onW = Math.max(0, Math.min(el.x + el.w, W) - Math.max(el.x, 0))
        const onH = Math.max(0, Math.min(el.y + el.h, H) - Math.max(el.y, 0))
        const bleed = onW * onH >= 0.5 * W * H
        if (bleed) { out.bleed++; if (src.startsWith('data:image/png')) out.png++ }
        else { out.small++; if (src.startsWith('data:image/svg')) out.smallSvg++ }
      }
    }
    return out
  })
  const lightPdf = await pdfBytes()
  const pdfText = (b) => b.toString('latin1')
  const pdfPages = (b) => (pdfText(b).match(/\/Type\s*\/Page\b/g) ?? []).length
  ok(pdfPages(fullPdf) === pdfPages(lightPdf) && pdfPages(lightPdf) > 0, `the same pages either way (${pdfPages(fullPdf)}, ${pdfPages(lightPdf)})`)
  ok(lightPdf.length * 2 <= fullPdf.length, `Lighter file is at most half the size (${(fullPdf.length / 1e6).toFixed(1)} MB → ${(lightPdf.length / 1e6).toFixed(1)} MB)`)
  ok(/\/Type\s*\/Font\b/.test(pdfText(lightPdf)) && /\/ToUnicode\b/.test(pdfText(lightPdf)), 'its text is still text (fonts with a Unicode map, not a picture)')
  ok(redrawn.bleed > 0 && redrawn.png === redrawn.bleed, `every full-bleed svg is drawn as a bitmap (${redrawn.png}/${redrawn.bleed})`)
  ok(redrawn.small > 0 && redrawn.smallSvg === redrawn.small, `small svg stays vector (${redrawn.smallSvg}/${redrawn.small})`)
  ok(starterBefore && await docBlock() === starterBefore, 'exporting wrote nothing into the document')

  // the deck the page-plan checks run on
  const text = (id, x, y, html, extra = {}) => ({ id, type: 'text', x, y, w: 300, h: 60, rotation: 0, opacity: 1, html, fontSize: 24, fontFamily: 'Inter, sans-serif', fontWeight: 400, color: '#111111', align: 'left', valign: 'top', lineHeight: 1.25, ...extra })
  const LONG = Array.from({ length: 90 }, (_, i) => `Line ${i + 1} of a long speaker note that has to run on.`).join('\n')
  await p.evaluate(([els, LONG]) => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    const s = (id, elements, extra = {}) => ({ id, background: '#ffffff', notes: '', transition: 'none', elements, ...extra })
    d.slides = [
      s('s1', [els.t, els.n, els.a, els.b, els.c], { notes: 'Open with <b>the</b> question & wait.' }),
      s('s2', [els.plain]),
      s('s1x', [els.t], { stateOf: 's1' }),
      s('sh', [els.plain2], { hidden: true }),
      s('s3', [els.plain3], { notes: LONG }),
    ]
    delete d.compact
    window.bento.loadDoc(JSON.stringify(d))
  }, [{
    t: text('t', 40, 40, 'Title'),
    n: text('n', 40, 600, '{{page}}'),
    a: text('a', 40, 140, 'First', { fx: { step: 1 } }),
    b: text('b', 40, 240, 'Second', { fx: { step: 2 } }),
    c: text('c', 40, 340, 'Third', { fx: { step: 3 } }),
    plain: text('p1', 40, 40, 'No steps here'),
    plain2: text('p2', 40, 40, 'Hidden slide'),
    plain3: text('p3', 40, 40, 'Last'),
  }, LONG])
  await p.waitForTimeout(400)
  const linear = ['s1', 's2', 's3']
  const docBefore = await docBlock()

  console.log('\n2. The sheet\n')
  const btn = '.ed-topbar [data-cmd="export-pdf"]'
  await p.click(btn)
  await p.waitForSelector('.bkd-card', { timeout: 3000 })
  ok(await p.evaluate(() => window.__printed) === 2, 'the bar button opens the sheet; nothing printed yet')
  ok(await p.evaluate(() => document.querySelector('.bkd-card').contains(document.activeElement)), 'focus moves into the sheet')
  let trapped = true
  for (let i = 0; i < 8; i++) {
    await p.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab')
    if (!await p.evaluate(() => document.querySelector('.bkd-card').contains(document.activeElement))) trapped = false
  }
  for (let i = 0; i < 5; i++) {
    await p.keyboard.press('Tab')
    if (!await p.evaluate(() => document.querySelector('.bkd-card').contains(document.activeElement))) trapped = false
  }
  ok(trapped, 'Tab and Shift+Tab never leave it')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(100)
  ok(!await sheetOpen(), 'Escape closes it')
  ok(await p.evaluate((sel) => document.activeElement === document.querySelector(sel), btn), 'focus returns to the button that opened it')
  ok(await p.evaluate(() => window.__printed) === 2, 'Escape printed nothing')
  await p.keyboard.press('Control+p')
  await p.waitForSelector('.bkd-card', { timeout: 3000 })
  ok(await p.evaluate(() => [...document.querySelectorAll('.bkd-card select')].map((s) => s.value).join(',')) === 'slides,light',
    'it opens on the last choice (Slides, Lighter file)')
  // ⇧⌘P over the open sheet must not print behind it
  const n1 = await p.evaluate(() => window.__printed)
  await p.keyboard.press('Control+Shift+p')
  await p.waitForTimeout(600)
  ok(await p.evaluate(() => window.__printed) === n1 && await sheetOpen(), '⇧⌘P while the sheet is up prints nothing; the sheet stays')
  // and if pages and a dialog ever are up together, print media shows only the pages
  await p.evaluate(() => { const b = document.createElement('div'); b.id = 'bento-print'; b.innerHTML = '<div class="bp-page"></div>'; document.body.appendChild(b) })
  await p.emulateMedia({ media: 'print' })
  const shown = await p.evaluate(() => [...document.body.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.id || c.className))
  await p.emulateMedia({ media: null })
  await p.evaluate(() => document.getElementById('bento-print')?.remove())
  ok(shown.length === 1 && shown[0] === 'bento-print', `print media shows #bento-print alone, never the sheet (${shown.join(', ')})`)
  await p.keyboard.press('Escape')

  console.log('\n3. The default: one page per linear slide\n')
  await printVia('slides', 'full')
  const plain = await p.evaluate(() => ({
    pages: [...document.querySelectorAll('#bento-print > .bp-page')].map((pg) => pg.querySelector('.bento-slide')?.dataset.slideId),
    hidden: document.querySelectorAll('#bento-print .bento-step-hidden').length,
    css: document.querySelector('#bento-print > style')?.textContent,
    notes: document.querySelectorAll('#bento-print .bp-notes-text').length,
    classes: [...document.querySelectorAll('#bento-print > .bp-page')].map((pg) => pg.className),
  }))
  ok(plain.pages.join(',') === linear.join(','), `one page per linear slide, in order; the state and the hidden slide stay out (${plain.pages.join(',')})`)
  ok(plain.hidden === 0, 'every step is revealed')
  ok(plain.css === '@page { size: 1600px 900px; margin: 0; } #bento-print .bp-page { height: 900px; }', 'the page rule is the one it always was')
  ok(plain.notes === 0 && plain.classes.every((c) => c === 'bp-page'), 'no notes, plain pages')

  console.log('\n4. One page per click step\n')
  await printVia('steps', 'full')
  await p.emulateMedia({ media: 'print' })
  const steps = await p.evaluate(() => [...document.querySelectorAll('#bento-print > .bp-page')].map((pg) => {
    const sl = pg.querySelector('.bento-slide')
    const vis = (id) => { const n = sl.querySelector(`[data-el-id="${id}"]`); return n ? getComputedStyle(n).visibility : 'absent' }
    return {
      slide: sl.dataset.slideId,
      hidden: [...sl.querySelectorAll('.bento-step-hidden')].map((n) => n.dataset.elId).sort().join(''),
      vis: ['t', 'a', 'b', 'c'].map(vis).join(','),
      number: sl.querySelector('[data-el-id="n"]')?.textContent?.trim() ?? '',
    }
  }))
  // back to no emulation: page.pdf() renders in whatever media is emulated
  await p.emulateMedia({ media: null })
  ok(steps.map((s) => s.slide).join(',') === 's1,s1,s1,s1,s2,s3', `a slide with steps 1, 2, 3 is four pages; a slide with none is one (${steps.map((s) => s.slide).join(',')})`)
  ok(steps.slice(0, 4).map((s) => s.hidden).join('|') === 'abc|bc|c|', `none revealed, then one more step per page (${steps.slice(0, 4).map((s) => s.hidden || '∅').join(' | ')})`)
  ok(steps[0].vis === 'visible,hidden,hidden,hidden' && steps[2].vis === 'visible,visible,visible,hidden' && steps[3].vis === 'visible,visible,visible,visible',
    `print media hides them by computed visibility (${steps.slice(0, 4).map((s) => s.vis).join(' | ')})`)
  ok(steps.slice(0, 4).every((s) => s.number === '1'), `every step page keeps the slide's number (${steps.slice(0, 4).map((s) => s.number).join(',')})`)
  ok(steps[4].hidden === '' && steps[5].hidden === '', 'the slides without steps show everything')

  console.log('\n5. Slides with notes\n')
  await printVia('notes', 'full')
  const notes = await p.evaluate(() => [...document.querySelectorAll('#bento-print > .bp-page')].map((pg) => ({
    cls: pg.className,
    slide: pg.querySelector('.bp-slide > .bento-slide')?.dataset.slideId,
    text: pg.querySelector('.bp-notes-text')?.textContent ?? null,
    markup: !!pg.querySelector('.bp-notes-text *'),
  })))
  ok(notes.map((n) => n.slide).join(',') === linear.join(','), `a page per linear slide, each with the slide on it (${notes.map((n) => n.slide).join(',')})`)
  ok(notes[0].text === 'Open with <b>the</b> question & wait.' && !notes[0].markup, 'the notes print as text, never as markup')
  ok(notes[1].text === '' && notes[1].cls.includes('bp-notes'), 'a slide with empty notes still gets its page')
  ok(notes[2].text?.startsWith('Line 1 ') && notes[2].text?.endsWith('run on.'), 'a long note is printed whole')
  ok(await p.evaluate(() => /size: 1600px 2263px/.test(document.querySelector('#bento-print > style').textContent)), 'notes pages are portrait')
  const notesPdf = await pdfBytes()
  ok(pdfPages(notesPdf) > notes.length, `the long note runs on to a continuation page (${notes.length} slides → ${pdfPages(notesPdf)} pages)`)

  console.log('\n6. Remembered per browser, never in the document\n')
  await printVia('steps', 'full')
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem('bento-print-options') ?? '{}').pages) === 'steps', 'the last choice is kept in this browser')
  await p.evaluate(() => document.getElementById('bento-print')?.remove())
  let n0 = await p.evaluate(() => window.__printed)
  await p.keyboard.press('Control+Shift+p')
  await p.waitForFunction((n) => window.__printed > n, n0, { timeout: 10000 }).catch(() => {})
  ok(!await sheetOpen() && await p.evaluate(() => document.querySelectorAll('#bento-print > .bp-page').length) === 6, '⇧⌘P prints with it, no sheet (6 step pages)')
  await p.evaluate(() => document.getElementById('bento-print')?.remove())
  await p.click('.ed-logo'); await p.waitForTimeout(150)
  n0 = await p.evaluate(() => window.__printed)
  await p.click('.ed-file-menu [data-cmd="export-pdf"]', { modifiers: ['Shift'] })
  await p.waitForFunction((n) => window.__printed > n, n0, { timeout: 10000 }).catch(() => {})
  ok(!await sheetOpen() && await p.evaluate(() => document.querySelectorAll('#bento-print > .bp-page').length) === 6, 'so does a Shift-click on the File menu row')
  await p.click('.ed-logo'); await p.waitForTimeout(150)
  await p.click('.ed-file-menu [data-cmd="export-pdf"]')
  ok(await p.waitForSelector('.bkd-card', { timeout: 3000 }).then(() => true, () => false), 'a plain click on the row opens the sheet')
  await p.keyboard.press('Escape')
  await p.waitForTimeout(100)
  ok(await p.evaluate(() => document.activeElement === document.querySelector('.ed-logo')), `closing it hands focus to the File menu button (${await p.evaluate(() => document.activeElement?.className || document.activeElement?.tagName)})`)
  ok(docBefore && await docBlock() === docBefore, 'the document serialize() writes is unchanged by every export')
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} catch (e) {
  // a step that cannot run at all (no sheet to drive, say) is a failure, not a crash
  ok(false, `the rig ran to the end (${String(e?.message ?? e).split('\n')[0]})`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
