// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Check deck, in the packaged shell, driven by real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-check-deck-browser.mjs
//
// validate() found overflowing tables, dead links and missing pictures, and
// nothing in the editor ever said so. The Check deck chip and panel
// (slides/src/editor/checkdeck.ts) show them. Decks are set up through
// window.bento.loadDoc; everything a person does is page.mouse / page.keyboard.
//
// WHAT THIS PROVES:
//   1. a table whose rows run past the slide shows a chip with the count and a
//      row "Slide N · Table · Rows run past the box"; the chip's accessible
//      name says the count ("1 warning, check deck");
//   2. clicking a row goes to its slide and selects the element;
//   3. "Fit box to text" and "Fit box to rows" each resolve their finding,
//      and one ⌘Z puts the height back; "Remove link" removes a dead link;
//   4. a clean deck shows no chip, and the panel says it has no issues;
//      info findings (a deliberate bleed) are never counted and sit folded
//      under Tips;
//   5. with the panel closed, typing in a text box runs no check (the run
//      counter does not move), and the counter does move once the edit
//      commits — so the counter is live, not stuck;
//   6. the panel works from the keyboard: Enter on the chip opens it with
//      focus on the first row, ↓ moves, Enter jumps, Escape closes and puts
//      focus back on the chip; the panel is a labelled region;
//   7. File ▸ Replace from JSON… opens the panel on the findings the loaded
//      JSON brought in, instead of "see console";
//   8. a read-only viewer sees the findings without fix buttons;
//   9. no page errors.
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const SHELL = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href
const text = (id, y, h, html, extra = {}) => ({ id, type: 'text', x: 160, y, w: 600, h, html, fontSize: 24, color: '#1E2A3A', ...extra })
const rows = (n) => Array.from({ length: n }, (_, i) => ({ cells: [{ html: `Row ${i + 1}` }, { html: String(i * 10) }] }))
const table = (id, n) => ({ id, type: 'table', x: 160, y: 360, w: 600, h: 120, columns: [{ w: 1 }, { w: 1 }], header: true, rows: rows(n) })
const deck = (slides) => JSON.stringify({ compact: true, title: 'Check', slides })
const CLEAN = deck([{ id: 's1', background: '#F2F0EA', elements: [text('a', 120, 100, '<p>Hello</p>')] }])

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  // the read-only copy below carries a live session: no socket may leave the
  // page (route() does not see WebSockets), and the app is told it is offline
  await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch { /* no storage */ } })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.evaluate(() => document.fonts.ready)
  await p.waitForFunction(() => document.querySelector('#ed-check')?.dataset.runs, null, { timeout: 5000 })

  const runs = () => p.evaluate(() => Number(document.querySelector('#ed-check').dataset.runs || 0))
  // measured, not read back: what the page DRAWS (a button whose [hidden] a
  // display rule overrides still takes room and a tab stop), and whether
  // anything in the cluster is a focusable chip at all
  const chip = () => p.evaluate(() => {
    const c = document.querySelector('.ed-corner-br .ed-check-chip')
    const r = c?.getBoundingClientRect()
    return { shown: !!r && r.width > 0 && r.height > 0 && getComputedStyle(c).display !== 'none', name: c?.getAttribute('aria-label'), text: c?.textContent }
  })
  /** load a deck and wait for the check that follows it (a replaced deck re-checks at once) */
  let lastLoadMs = 0
  const load = async (json) => {
    const before = await runs()
    const t0 = Date.now()
    await p.evaluate((j) => window.bento.loadDoc(j), json)
    await p.waitForFunction((n) => Number(document.querySelector('#ed-check').dataset.runs) > n, before, { timeout: 6000 })
    lastLoadMs = Date.now() - t0
    await p.waitForTimeout(50)
  }
  const panelRows = () => p.evaluate(() => [...document.querySelectorAll('#ed-check .ed-check-jump')]
    .filter((b) => b.offsetParent).map((b) => ({ where: b.querySelector('.ed-check-where')?.textContent, what: b.querySelector('.ed-check-what')?.textContent, key: b.dataset.key })))
  const openPanel = async () => {
    if (!(await p.evaluate(() => !document.querySelector('#ed-check').hidden))) {
      if ((await chip()).shown) {
        const box = await p.locator('.ed-corner-br .ed-check-chip').boundingBox()
        await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      } else {
        // no chip without errors or warnings: the File menu is the way in
        await clickIn('.ed-logo')
        await p.locator('.ed-file.open .ed-menu-row[data-cmd="check-deck"]').click()
      }
    }
    await p.waitForSelector('#ed-check:not([hidden])')
  }
  const closePanel = async () => {
    if (await p.evaluate(() => !document.querySelector('#ed-check').hidden)) {
      const box = await p.locator('#ed-check .ed-check-close').boundingBox()
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    }
  }
  const clickIn = async (selector) => {
    const box = await p.locator(selector).first().boundingBox()
    await p.mouse.click(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2)
  }
  const elH = (id) => p.evaluate((id) => window.bento.doc.slides.flatMap((s) => s.elements).find((e) => e.id === id)?.h, id)
  const codesNow = () => p.evaluate(() => window.bento.validate().findings.map((f) => f.code))

  // 4. a clean deck --------------------------------------------------------
  console.log('clean deck')
  await load(CLEAN)
  ok(!(await chip()).shown, 'a clean deck shows no chip (nothing drawn in the cluster)')
  ok(lastLoadMs < 1500, `a loaded deck is re-checked at once, not after the 2s settle (${lastLoadMs}ms)`)
  ok(await p.evaluate(() => [...document.querySelectorAll('.ed-corner-br button')].every((b) => b.getBoundingClientRect().width > 0 && b.getAttribute('aria-label') !== null || b.textContent.trim())), 'no empty or unnamed button is left in the cluster')
  // opened from the File menu, as a person finds it
  await clickIn('.ed-logo')
  const fileItem = p.locator('.ed-file.open .ed-menu-row[data-cmd="check-deck"]')
  await fileItem.waitFor({ timeout: 3000 }).catch(() => {})
  ok(await fileItem.count() === 1, 'File menu has a Check deck item')
  await fileItem.click()
  await p.waitForSelector('#ed-check:not([hidden])')
  const empty = await p.evaluate(() => document.querySelector('#ed-check .ed-check-empty')?.textContent)
  ok(empty === 'No issues found in this deck', `the panel says the deck has no issues ("${empty}")`)
  const region = await p.evaluate(() => { const r = document.querySelector('#ed-check'); return { role: r.getAttribute('role'), label: document.getElementById(r.getAttribute('aria-labelledby'))?.textContent } })
  ok(region.role === 'region' && region.label === 'Check deck', 'the panel is a region labelled "Check deck"')
  await closePanel()

  // info only: a bleed is a tip, never counted -------------------------------
  await load(deck([{ id: 's1', background: '#F2F0EA', elements: [text('a', 120, 100, '<p>Hello</p>'),
    { id: 'bleed', type: 'shape', shape: 'rect', x: 1100, y: 500, w: 400, h: 400, fill: '#E0DDD5' }] }]))
  ok((await codesNow()).includes('out-of-canvas'), 'the bleeding shape is an out-of-canvas (info) finding')
  ok(!(await chip()).shown, 'an info finding is not counted: no chip')
  await openPanel()
  const tips = await p.evaluate(() => {
    const tg = document.querySelector('#ed-check .ed-check-tips')
    const list = document.querySelector('#ed-check .ed-check-tiplist')
    return { label: tg?.textContent, expanded: tg?.getAttribute('aria-expanded'), hidden: list?.hidden, empty: !!document.querySelector('#ed-check .ed-check-empty') }
  })
  ok(/^Tips \(\d+\)$/.test(tips.label ?? '') && tips.expanded === 'false' && tips.hidden === true, `info findings sit folded under "${tips.label}" (aria-expanded ${tips.expanded})`)
  ok(tips.empty, 'with only tips, the panel still says there are no issues')
  await clickIn('#ed-check .ed-check-tips')
  ok(await p.evaluate(() => !document.querySelector('#ed-check .ed-check-tiplist').hidden), 'the Tips toggle unfolds them')
  await closePanel()

  // 1 + 2. the table that runs off the slide ---------------------------------
  console.log('table overflow')
  await load(deck([
    { id: 's1', background: '#F2F0EA', elements: [text('a', 120, 100, '<p>Intro</p>')] },
    { id: 's2', background: '#F2F0EA', elements: [text('b', 120, 100, '<p>Numbers</p>'), table('tbl', 12)] },
  ]))
  const c1 = await chip()
  ok(c1.shown && Number(c1.text) >= 1, `the overflowing table shows a chip (${c1.text})`)
  ok(/^\d+ warnings?, check deck$/.test(c1.name ?? ''), `the chip's accessible name says the count ("${c1.name}")`)
  await openPanel()
  const r1 = await panelRows()
  const tableRow = r1.find((r) => r.what === 'Rows run past the box')
  ok(tableRow && tableRow.where === 'Slide 2 · Table · ', `a row reads "${tableRow ? tableRow.where + tableRow.what : r1.map((r) => r.where + r.what).join(' | ')}"`)
  // jump
  await p.evaluate(() => window.bento.selection) // settle
  const before = await p.evaluate(() => document.querySelector('.ed-stage-scale [data-el-id="tbl"]') !== null)
  ok(!before, 'the table is not on the slide in view before the click')
  const rowBox = await p.locator('#ed-check .ed-check-row[data-code="table-overflow"] .ed-check-jump').boundingBox()
  await p.mouse.click(rowBox.x + 30, rowBox.y + rowBox.height / 2)
  await p.waitForTimeout(150)
  const jumped = await p.evaluate(() => ({ sel: window.bento.selection, onCanvas: !!document.querySelector('.ed-stage-scale [data-el-id="tbl"]') }))
  ok(jumped.onCanvas && jumped.sel.length === 1 && jumped.sel[0] === 'tbl', `clicking the row goes to slide 2 and selects the table (${JSON.stringify(jumped)})`)
  ok(await p.evaluate(() => !document.querySelector('#ed-check').hidden), 'the panel stays open after a jump')
  // Delete pressed in the panel is the panel's, never the selected table's
  await p.keyboard.press('Delete')
  ok(await p.evaluate(() => window.bento.doc.slides[1].elements.some((e) => e.id === 'tbl')), 'Delete pressed in the panel does not delete the element it selected')
  await p.keyboard.press('Control+Backspace')
  ok(await p.evaluate(() => window.bento.doc.slides[1].elements.some((e) => e.id === 'tbl')), 'nor does Ctrl+Backspace')

  // 3. Fit box to rows + undo
  const hBefore = await elH('tbl')
  const fixRows = '#ed-check .ed-check-row[data-code="table-overflow"] .ed-check-fix'
  ok(await p.locator(fixRows).textContent() === 'Fit box to rows', 'the table row offers "Fit box to rows"')
  ok(/^Sets the box to \d+px tall/.test(await p.locator(fixRows).getAttribute('title') ?? ''), 'the fix says what it will do')
  await clickIn(fixRows)
  await p.waitForTimeout(100)
  const hAfter = await elH('tbl')
  ok(hAfter > hBefore && !(await codesNow()).includes('table-overflow'), `Fit box to rows resolves the finding (h ${hBefore} → ${hAfter})`)
  ok(!(await p.evaluate(() => !!document.querySelector('#ed-check .ed-check-row[data-code="table-overflow"]'))), 'its row is gone from the panel')
  await p.keyboard.press('Control+z')
  await p.waitForTimeout(100)
  ok(await elH('tbl') === hBefore, `one ⌘Z puts the height back (${await elH('tbl')})`)
  await closePanel()

  // 3. Fit box to text + undo; Remove link ------------------------------------
  console.log('fixes')
  await load(deck([{ id: 's1', background: '#F2F0EA', elements: [
    text('tall', 120, 40, '<p>This sentence is long enough to wrap over several lines in a six hundred pixel box at this size.</p>'),
    text('lnk', 420, 100, '<p>Go</p>', { link: 'nowhere' }),
  ] }]))
  await openPanel()
  const fixText = '#ed-check .ed-check-row[data-code="text-overflow"] .ed-check-fix'
  ok(await p.locator(fixText).count() === 1 && await p.locator(fixText).textContent() === 'Fit box to text', 'the text-overflow row offers "Fit box to text"')
  const t0 = await elH('tall')
  await clickIn(fixText)
  await p.waitForTimeout(100)
  const t1 = await elH('tall')
  ok(t1 > t0 && !(await codesNow()).includes('text-overflow'), `Fit box to text resolves the finding (h ${t0} → ${t1})`)
  ok(await p.evaluate(() => document.activeElement?.closest('#ed-check') !== null), 'focus stays in the panel after the fix')
  await p.keyboard.press('Control+z')
  await p.waitForTimeout(100)
  ok(await elH('tall') === t0, 'one ⌘Z puts the text box back')
  await p.keyboard.press('Control+Shift+z')
  await p.waitForTimeout(100)
  const fixLink = '#ed-check .ed-check-row[data-code="broken-link"] .ed-check-fix'
  ok(await p.locator(fixLink).textContent() === 'Remove link', 'the broken-link row offers "Remove link"')
  await clickIn(fixLink)
  await p.waitForTimeout(100)
  ok(await p.evaluate(() => !window.bento.doc.slides[0].elements.find((e) => e.id === 'lnk').link) && !(await codesNow()).includes('broken-link'), 'Remove link takes the dead link off')
  await closePanel()

  // 5. typing with the panel closed runs nothing -------------------------------
  console.log('no run while typing')
  await load(deck([{ id: 's1', background: '#F2F0EA', elements: [text('typed', 120, 200, '<p>Start</p>')] }]))
  const node = await p.locator('.ed-stage-scale [data-el-id="typed"]').boundingBox()
  await p.mouse.dblclick(node.x + 40, node.y + 20)
  await p.waitForFunction(() => document.querySelector('.ed-stage-scale [contenteditable="true"]'))
  const n0 = await runs()
  await p.keyboard.type(' and then a good many more words typed one by one', { delay: 15 })
  await p.waitForTimeout(2600)
  const n1 = await runs()
  ok(n1 === n0, `typing in a text box with the panel closed runs no check (counter ${n0} → ${n1})`)
  await p.keyboard.press('Escape')
  await p.waitForFunction((n) => Number(document.querySelector('#ed-check').dataset.runs) > n, n1, { timeout: 6000 }).catch(() => {})
  ok(await runs() > n1, 'once the edit commits, the check runs again (the counter is live)')

  // 6. keyboard ---------------------------------------------------------------
  console.log('keyboard')
  await load(deck([
    { id: 's1', background: '#F2F0EA', elements: [text('k1', 120, 40, '<p>One long line of words that cannot fit in a forty pixel tall box at all, surely.</p>')] },
    { id: 's2', background: '#F2F0EA', elements: [text('k2', 120, 40, '<p>Another long line of words that cannot fit in a forty pixel tall box either.</p>')] },
  ]))
  await p.evaluate(() => document.querySelector('.ed-check-chip').focus())
  await p.keyboard.press('Enter')
  await p.waitForSelector('#ed-check:not([hidden])')
  const f1 = await p.evaluate(() => document.activeElement?.classList.contains('ed-check-jump') && document.activeElement.dataset.key)
  ok(!!f1, 'Enter on the chip opens the panel with focus on the first row')
  await p.keyboard.press('ArrowDown')
  const f2 = await p.evaluate(() => document.activeElement?.classList.contains('ed-check-jump') && document.activeElement.dataset.key)
  ok(f2 && f2 !== f1, '↓ moves focus to the next row')
  await p.keyboard.press('Enter')
  await p.waitForTimeout(150)
  const k = await p.evaluate(() => ({ sel: window.bento.selection, onCanvas: !!document.querySelector('.ed-stage-scale [data-el-id="k2"]') }))
  ok(k.sel[0] === 'k2' && k.onCanvas, 'Enter on a row jumps to its element')
  await p.keyboard.press('Tab')
  ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-check-fix')), 'Tab reaches the row\'s fix button')
  await p.keyboard.press('Escape')
  const esc = await p.evaluate(() => ({ hidden: document.querySelector('#ed-check').hidden, focus: document.activeElement?.classList.contains('ed-check-chip'), expanded: document.querySelector('.ed-check-chip').getAttribute('aria-expanded') }))
  ok(esc.hidden && esc.focus && esc.expanded === 'false', `Escape closes the panel and returns focus to the chip (${JSON.stringify(esc)})`)
  ok(k.sel.length === 1 && (await p.evaluate(() => window.bento.selection))[0] === 'k2', 'Escape in the panel did not also clear the canvas selection')
  // Home / End
  await p.evaluate(() => document.querySelector('.ed-check-chip').focus())
  await p.keyboard.press('Enter')
  await p.waitForSelector('#ed-check:not([hidden])')
  await p.keyboard.press('End')
  const endKey = await p.evaluate(() => { const r = [...document.querySelectorAll('#ed-check .ed-check-jump')].filter((b) => b.offsetParent); return document.activeElement === r[r.length - 1] && r.length > 1 })
  await p.keyboard.press('Home')
  const homeKey = await p.evaluate(() => document.activeElement === [...document.querySelectorAll('#ed-check .ed-check-jump')].find((b) => b.offsetParent))
  ok(endKey && homeKey, 'End and Home go to the last and first row')
  // a row's jump, then a click on the canvas: the keys are the canvas's again
  await clickIn('#ed-check .ed-check-row[data-code="text-overflow"] .ed-check-jump')
  await p.waitForTimeout(150)
  const selId = (await p.evaluate(() => window.bento.selection))[0]
  const elBox = await p.locator(`.ed-stage-scale [data-el-id="${selId}"]`).boundingBox()
  await p.mouse.click(elBox.x + elBox.width / 2, elBox.y + elBox.height / 2)
  await p.waitForTimeout(150)
  const x0 = await p.evaluate((id) => window.bento.doc.slides.flatMap((s) => s.elements).find((e) => e.id === id).x, selId)
  await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(100)
  const x1 = await p.evaluate((id) => window.bento.doc.slides.flatMap((s) => s.elements).find((e) => e.id === id).x, selId)
  const nudge = await p.evaluate(() => ({ open: !document.querySelector('#ed-check').hidden, inPanel: !!document.activeElement?.closest('#ed-check') }))
  ok(nudge.open && !nudge.inPanel && x1 === x0 + 1, `after a row jump, a click on the canvas gives the keys back: → nudges the element (x ${x0} → ${x1}), the panel still open`)
  await closePanel()

  // 7. Replace from JSON opens the panel on what the load brought in ------------
  console.log('replace from JSON')
  await load(CLEAN)
  await clickIn('.ed-logo')
  await p.locator('.ed-file.open .ed-menu-row[data-cmd="replace-json"]').click()
  await p.waitForSelector('.ed-about-json')
  const replaced = deck([{ id: 'r1', background: '#F2F0EA', elements: [text('r', 120, 100, '<p>Back</p>'), table('rt', 14)] }])
  await p.locator('.ed-about-json').fill(replaced)
  await p.locator('.ed-about .ed-btn-primary').click()
  await p.waitForSelector('#ed-check:not([hidden])', { timeout: 3000 }).catch(() => {})
  const rj = await p.evaluate(() => ({
    open: !document.querySelector('#ed-check').hidden,
    filter: document.querySelector('#ed-check .ed-check-filter')?.hidden === false,
    codes: [...document.querySelectorAll('#ed-check .ed-check-row')].map((r) => r.dataset.code),
    toast: document.querySelector('.ed-toast')?.textContent ?? '',
  }))
  ok(rj.open && rj.filter && rj.codes.includes('table-overflow'), `Replace from JSON opens the panel on the findings it brought in (${rj.codes.join(', ')})`)
  ok(!/see console/.test(rj.toast), `no "see console" toast for findings ("${rj.toast}")`)
  await clickIn('#ed-check .ed-check-link')
  ok(await p.evaluate(() => document.querySelector('#ed-check .ed-check-filter').hidden), '"Show all" clears the filter')
  await closePanel()

  // 8. a read-only viewer ---------------------------------------------------------
  console.log('read-only viewer')
  await load(deck([{ id: 's1', background: '#F2F0EA', elements: [text('ro', 120, 40, '<p>Words that overflow a forty pixel box for certain, across lines.</p>')] }]))
  const html = await p.evaluate(() => {
    const d = window.bento.doc
    d.collab = { ...(d.collab ?? {}), role: 'reader' }
    delete d.collab.writerPriv
    delete d.collab.ownerPriv
    return window.bento.serialize()
  })
  const file = join(mkdtempSync(join(tmpdir(), 'bento-check-')), 'reader.bento.html')
  writeFileSync(file, html)
  const rp = await ctx.newPage()
  rp.on('pageerror', (e) => errors.push(e.message))
  await rp.goto('file://' + file)
  await rp.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await rp.waitForFunction(() => document.body.classList.contains('ed-reader') && document.querySelector('#ed-check')?.dataset.runs, null, { timeout: 6000 })
  const rbox = await rp.locator('.ed-check-chip').boundingBox()
  ok(!!rbox, 'the read-only viewer shows the chip')
  // from the keyboard: the reader banner, centred at the window's foot, lies
  // over the cluster's start at this width (over the notes toggle and the
  // Slideshow pill too — older than the chip, and not this rig's concern)
  await rp.evaluate(() => document.querySelector('.ed-check-chip').focus())
  await rp.keyboard.press('Enter')
  await rp.waitForSelector('#ed-check:not([hidden])')
  const ro = await rp.evaluate(() => ({ rows: document.querySelectorAll('#ed-check .ed-check-row[data-code="text-overflow"]').length, fixes: document.querySelectorAll('#ed-check .ed-check-fix').length }))
  ok(ro.rows === 1 && ro.fixes === 0, `a read-only viewer sees the finding without fix buttons (${JSON.stringify(ro)})`)
  await rp.close()

  // 9. ---------------------------------------------------------------------------
  ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
