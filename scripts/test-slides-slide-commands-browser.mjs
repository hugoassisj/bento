// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Slide, layout, notes and list actions as commands: keys, ⌘K, the thumbnail menu, the ? sheet.
//
//   npm run build:single --prefix slides && node scripts/test-slides-slide-commands-browser.mjs
//
// WHAT THIS PROVES (real keyboard and mouse, on the packaged document).
//   1. Ctrl+M (⌃M on a Mac) inserts a slide after the current one and lands on
//      it; one undo removes it.
//   2. ⌘D with no element selected duplicates the current slide; with
//      elements selected it still duplicates the elements.
//   3. ⌘↑ / ⌘↓ (Ctrl on Windows and Linux) move the current slide, and a
//      parent's interactive states stay right after it.
//   4. ⌘K finds every new command by its label, and Bulleted list from ⌘K turns
//      the selected text box into a list.
//   5. The thumbnail menu offers New, Duplicate, Move earlier, Move later,
//      Hide/Show and Delete, with the commands' keys; Hide toggles the slide.
//   6. The ? sheet lists the new shortcuts.
//   7. Safety: a bare ⌫ on the canvas with nothing selected deletes no slide
//      (⌫ deletes the slide only from the slide list); none of the new chords
//      fires while a text box, the palette, a menu or a dialog has the keys;
//      a read-only deck offers none of the new commands.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const NEW_IDS = ['slide-new', 'slide-new-layout', 'slide-duplicate', 'slide-delete', 'slide-move-earlier', 'slide-move-later', 'slide-hide', 'layout-apply', 'notes-toggle', 'list-bullets', 'list-numbers']
const SHELL = new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto(SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  // the slides as ids, and the current one (the active thumbnail)
  const deck = () => p.evaluate(() => {
    const slides = window.bento.doc.slides
    const cur = Number(document.querySelector('.ed-thumb.active')?.dataset.index ?? -1)
    return { n: slides.length, ids: slides.map((s) => s.id), cur, curId: slides[cur]?.id, hidden: slides.map((s) => !!s.hidden), stateOf: slides.map((s) => s.stateOf ?? null), els: slides.map((s) => s.elements.map((e) => e.id)) }
  })
  const selection = () => p.evaluate(() => window.bento.selection)
  const settle = () => p.waitForTimeout(250)
  // empty canvas: the grey surround beside the slide, then nothing selected
  const blank = async () => {
    const b = await p.locator('.ed-scroll').boundingBox()
    await p.mouse.click(b.x + 12, b.y + b.height - 12)
    await p.keyboard.press('Escape')
    await settle()
  }
  const paletteIds = async (query) => {
    await p.keyboard.press(`${mod}+k`)
    await p.waitForSelector('.ed-cmdk')
    if (query) await p.keyboard.type(query)
    const ids = await p.$$eval('.ed-cmdk-list li', (l) => l.map((x) => x.dataset.cmd).filter(Boolean))
    return ids
  }
  // a thumbnail scrolled into the list's view, at rest
  const reveal = async (i) => {
    await p.locator(`.ed-thumb[data-index="${i}"]`).scrollIntoViewIfNeeded()
    await p.waitForTimeout(150)
  }
  const thumbMenu = async (i) => {
    await reveal(i)
    const b = await p.locator(`.ed-thumb[data-index="${i}"]`).boundingBox()
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' })
    await p.waitForTimeout(100)
    return p.$$eval('.ed-ctxmenu-item', (l) => l.map((x) => ({ cmd: x.dataset.cmd ?? '', label: x.querySelector('span')?.textContent ?? '', hint: x.querySelector('kbd')?.textContent ?? '' })))
  }

  await blank()
  ok((await selection()).length === 0, 'nothing is selected')

  console.log('\nnew slide\n')
  {
    const s0 = await deck()
    await p.keyboard.press('Control+m')
    await settle()
    const s1 = await deck()
    ok(s1.n === s0.n + 1, `Ctrl+M adds a slide (${s0.n} → ${s1.n})`)
    ok(s1.cur === s0.cur + 1 && !s0.ids.includes(s1.curId), `it lands on the new slide, right after the current one (current ${s0.cur} → ${s1.cur})`)
    await p.keyboard.press(`${mod}+z`)
    await settle()
    const s2 = await deck()
    ok(s2.n === s0.n && s2.ids.join() === s0.ids.join(), `one undo removes it (${s2.n})`)
  }

  console.log('\nduplicate\n')
  {
    await blank()
    const s0 = await deck()
    await p.keyboard.press(`${mod}+d`)
    await settle()
    const s1 = await deck()
    ok(s1.n === s0.n + 1, `⌘D with nothing selected duplicates the slide (${s0.n} → ${s1.n})`)
    ok(s1.cur === s0.cur + 1 && s1.els[s1.cur].join() === s0.els[s0.cur].join(), 'the copy follows the original and keeps its element ids (the morph idiom)')
    await p.keyboard.press(`${mod}+z`)
    await settle()
    ok((await deck()).n === s0.n, 'undo removes the copy')
    await blank()
    await p.keyboard.press(`${mod}+a`)
    const picked = (await selection()).length
    const e0 = (await deck()).els[s0.cur].length
    await p.keyboard.press(`${mod}+d`)
    await settle()
    const s2 = await deck()
    // (a frame's children are copied with it, so the count grows by more than the selection)
    ok(picked > 0 && s2.n === s0.n && s2.els[s0.cur].length >= e0 + picked, `with ${picked} elements selected ⌘D duplicates the elements (${e0} → ${s2.els[s0.cur].length}), not the slide (${s2.n} slides)`)
    await p.keyboard.press(`${mod}+z`)
    await settle()
  }

  console.log('\nmove\n')
  {
    await blank()
    await p.keyboard.press('PageDown')
    await settle()
    const s0 = await deck()
    await p.keyboard.press(`${mod}+ArrowDown`)
    await settle()
    const s1 = await deck()
    ok(s1.ids.indexOf(s0.curId) > s0.cur, `${mod}+↓ moves the current slide later (${s0.cur} → ${s1.ids.indexOf(s0.curId)})`)
    ok(s1.curId === s0.curId, 'the canvas stays on the moved slide')
    await p.keyboard.press(`${mod}+ArrowUp`)
    await settle()
    const s2 = await deck()
    ok(s2.ids.join() === s0.ids.join(), `${mod}+↑ moves it back`)
    // a parent with interactive states: they stay attached
    const parent = s0.stateOf.findIndex((x, i) => !x && s0.stateOf.some((y) => y === s0.ids[i]))
    ok(parent > 0, `the starter deck has a slide with states (${parent})`)
    if (parent > 0) {
      await reveal(parent)
      const b = await p.locator(`.ed-thumb[data-index="${parent}"]`).boundingBox()
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      await blank()
      ok((await deck()).cur === parent, `the parent is the current slide (${(await deck()).cur})`)
      await p.keyboard.press(`${mod}+ArrowUp`)
      await settle()
      const s3 = await deck()
      const pid = s0.ids[parent]
      const pAt = s3.ids.indexOf(pid)
      const states = s3.ids.map((id, i) => (s3.stateOf[i] === pid ? i : -1)).filter((i) => i >= 0)
      ok(pAt < parent, `the parent moved earlier (${parent} → ${pAt})`)
      ok(states.length > 0 && states.every((i, k) => i === pAt + 1 + k), `its states stay right after it (${states.join(', ')})`)
      await p.keyboard.press(`${mod}+z`)
      await settle()
      ok((await deck()).ids.join() === s0.ids.join(), 'one undo puts the order back')
    }
  }

  console.log('\nthe palette\n')
  {
    await blank()
    const want = [['new slide', 'slide-new'], ['duplicate slide', 'slide-duplicate'], ['delete slide', 'slide-delete'], ['move slide', 'slide-move-'],
      ['hide slide', 'slide-hide'], ['apply layout', 'layout-apply'], ['speaker notes', 'notes-toggle']]
    for (const [q, id] of want) {
      const ids = await paletteIds(q)
      ok(ids[0]?.startsWith(id), `⌘K "${q}" → ${ids.slice(0, 3).join(', ') || 'No matching command'}`)
      await p.keyboard.press('Escape')
    }
    // a text box with words in it, selected (not open): Bulleted list
    const s0 = await deck()
    await p.keyboard.press('Control+m')
    await settle()
    const body = await p.evaluate(() => {
      const n = [...document.querySelectorAll('.ed-stage-scale .bento-el-text')].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
      const r = n?.getBoundingClientRect()
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, id: n.dataset.elId } : null
    })
    ok(!!body, 'the new slide has a text box')
    if (body) {
      await p.mouse.click(body.x, body.y)
      await settle()
      await p.keyboard.type('Alpha')
      await p.keyboard.press('Escape')
      await settle()
      ok(JSON.stringify(await selection()) === JSON.stringify([body.id]), 'the text box is selected')
      const ids = await paletteIds('bulleted list')
      ok(ids[0] === 'list-bullets', `⌘K "bulleted list" → ${ids.slice(0, 3).join(', ') || 'No matching command'}`)
      if (ids[0] === 'list-bullets') await p.keyboard.press('Enter'); else await p.keyboard.press('Escape')
      await settle()
      const html = await p.evaluate((id) => window.bento.doc.slides.flatMap((s) => s.elements).find((e) => e.id === id && /Alpha/.test(e.html ?? ''))?.html ?? '', body.id)
      ok(/<ul>\s*<li>[^]*Alpha/.test(html), `Bulleted list made the box a list (${html.slice(0, 60)})`)
    }
    // back to the deck as it was
    for (let i = 0; i < 6 && (await deck()).n !== s0.n; i++) { await p.keyboard.press(`${mod}+z`); await settle() }
    await blank()
    for (let i = 0; i < 6 && (await deck()).n !== s0.n; i++) { await p.keyboard.press(`${mod}+z`); await settle() }
    ok((await deck()).n === s0.n, 'undo walks back to the deck as it was')
  }

  console.log('\nthe thumbnail menu\n')
  {
    await blank()
    const items = await thumbMenu(1)
    const cmds = items.map((x) => x.cmd)
    const need = ['slide-new', 'slide-duplicate', 'slide-move-earlier', 'slide-move-later', 'slide-hide', 'slide-delete']
    ok(need.every((c) => cmds.includes(c)), `it offers New, Duplicate, Move earlier, Move later, Hide, Delete (${items.map((x) => x.label).join(' · ')})`)
    const hint = (c) => items.find((x) => x.cmd === c)?.hint ?? ''
    ok(['slide-new', 'slide-duplicate', 'slide-move-earlier', 'slide-move-later', 'slide-delete'].every((c) => hint(c)), `with the commands' keys (${need.map(hint).join(' ')})`)
    const s0 = await deck()
    if (cmds.includes('slide-hide')) await p.click('.ed-ctxmenu-item[data-cmd="slide-hide"]')
    else await p.keyboard.press('Escape')
    await settle()
    ok((await deck()).hidden[1] && !s0.hidden[1], 'Hide slide hides it')
    const again = await thumbMenu(1)
    const row = again.find((x) => x.cmd === 'slide-hide')
    ok(row?.label === 'Show slide', `the row then reads "${row?.label}"`)
    await p.keyboard.press('Escape')
    if (row) { await p.keyboard.press(`${mod}+z`); await settle() }
    ok(!(await deck()).hidden[1], 'undo shows it again')
  }

  console.log('\nthe ? sheet\n')
  {
    await blank()
    await p.keyboard.press('Shift+Slash')
    await p.waitForTimeout(200)
    const rows = await p.$$eval('.ed-keys-row .ed-keys-name', (l) => l.map((x) => x.textContent))
    const need = ['New slide', 'Duplicate slide', 'Move slide earlier', 'Move slide later', 'Delete slide']
    ok(rows.length > 0 && need.every((r) => rows.includes(r)), `it lists ${need.filter((r) => rows.includes(r)).join(', ') || 'none of them'}`)
    // a dialog has the keys
    const n = (await deck()).n
    await p.keyboard.press('Control+m')
    await settle()
    ok((await deck()).n === n, 'Ctrl+M does nothing while the sheet is open')
    await p.keyboard.press('Escape')
    await settle()
  }

  console.log('\nsafety\n')
  {
    await blank()
    const s0 = await deck()
    await p.keyboard.press('Backspace')
    await p.keyboard.press('Delete')
    await settle()
    ok((await deck()).n === s0.n, 'a bare ⌫ / Delete on the canvas with nothing selected deletes no slide')
    // in the slide list, ⌫ is the slide's: a thumbnail's own button focused
    // (its tools show on hover), or several slides selected there
    await reveal(1)
    await p.hover('.ed-thumb[data-index="1"]')
    await p.evaluate(() => document.querySelector('.ed-thumb[data-index="1"] .ed-thumb-tools button')?.focus())
    ok(await p.evaluate(() => !!document.activeElement?.closest('.ed-thumb')), 'a thumbnail’s button has focus')
    await p.keyboard.press('Delete')
    await settle()
    const s1 = await deck()
    ok(s1.n === s0.n - 1 && !s1.ids.includes(s0.ids[1]), `Delete with the slide list focused deletes that slide (${s0.n} → ${s1.n})`)
    await p.keyboard.press(`${mod}+z`)
    await settle()
    ok((await deck()).ids.join() === s0.ids.join(), 'undo brings it back')
    await blank()
    for (const i of [2, 3]) {
      await reveal(i)
      const b = await p.locator(`.ed-thumb[data-index="${i}"]`).boundingBox()
      await p.keyboard.down(mod)
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
      await p.keyboard.up(mod)
    }
    await p.mouse.move(5, 5)
    await p.evaluate(() => document.activeElement?.blur?.())
    const picked = await p.$$eval('.ed-thumb.selected', (l) => l.length)
    await p.keyboard.press('Backspace')
    await settle()
    const s1b = await deck()
    ok(picked > 1 && s1b.n < s0.n, `Backspace with ${picked} slides selected in the list deletes them (${s0.n} → ${s1b.n})`)
    await p.keyboard.press(`${mod}+z`)
    await settle()
    ok((await deck()).ids.join() === s0.ids.join(), 'undo brings them back')

    // a text box being typed into
    await blank()
    await p.keyboard.press('Control+m')
    await settle()
    const t = await p.evaluate(() => {
      const n = document.querySelector('.ed-stage-scale .bento-el-text')
      const r = n?.getBoundingClientRect()
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
    })
    await p.mouse.click(t.x, t.y)
    await settle()
    await p.keyboard.type('Typing')
    const s2 = await deck()
    ok(await p.evaluate(() => document.activeElement?.isContentEditable), 'the text box is open for typing')
    for (const k of ['Control+m', `${mod}+d`, `${mod}+ArrowUp`, `${mod}+ArrowDown`]) await p.keyboard.press(k)
    await settle()
    const s3 = await deck()
    ok(s3.n === s2.n && s3.ids.join() === s2.ids.join(), 'Ctrl+M, ⌘D and ⌘↑/↓ do nothing to the slides while typing in a text box')
    await p.keyboard.press('Escape')
    await settle()
    for (let i = 0; i < 6 && (await deck()).n !== s0.n; i++) { await p.keyboard.press(`${mod}+z`); await settle() }
    await blank()
    for (let i = 0; i < 6 && (await deck()).n !== s0.n; i++) { await p.keyboard.press(`${mod}+z`); await settle() }

    // the palette has the keys
    await blank()
    const n0 = (await deck()).n
    await paletteIds('')
    await p.keyboard.press('Control+m')
    await settle()
    ok((await deck()).n === n0 && await p.isVisible('.ed-cmdk'), 'Ctrl+M in the palette adds no slide')
    await p.keyboard.press('Escape')
    // a menu has the keys
    await thumbMenu(1)
    await p.keyboard.press('Control+m')
    await p.keyboard.press(`${mod}+d`)
    await settle()
    ok((await deck()).n === n0, 'Ctrl+M and ⌘D with the thumbnail menu open add no slide')
    await p.keyboard.press('Escape')
  }

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)

  console.log('\na read-only deck\n')
  {
    const r = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const rerr = []
    r.on('pageerror', (e) => rerr.push(e.message))
    r.on('dialog', (d) => d.dismiss())
    await r.route(/^https?:/, (x) => x.abort())
    await r.goto(SHELL)
    await r.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
    // a read-only copy of a live session, opened onto the editor
    await r.evaluate(async () => {
      const d = JSON.parse(JSON.stringify(window.bento.doc))
      d.collab = { v: 2, on: false, room: 'wROOM', key: 'room-key', owner: 'OWNERPUB', role: 'reader' }
      const html = `<!doctype html><html><body><script type="application/bento+json" id="bento-doc">${JSON.stringify(d).replace(/</g, '\\u003c')}<` + `/script></body></html>`
      const dt = new DataTransfer()
      dt.items.add(new File([html], 'copy.bento.html', { type: 'text/html' }))
      const target = document.querySelector('.ed-canvas-wrap') ?? document.body
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await new Promise((res) => setTimeout(res, 600))
    })
    await r.waitForTimeout(300)
    ok(await r.evaluate(() => document.body.classList.contains('ed-reader')), 'the deck is read-only')
    const b = await r.locator('.ed-scroll').boundingBox()
    await r.mouse.click(b.x + 12, b.y + b.height - 12)
    await r.keyboard.press('Escape')
    await r.keyboard.press(`${mod}+k`)
    await r.waitForSelector('.ed-cmdk')
    const listed = await r.$$eval('.ed-cmdk-list li', (l) => l.map((x) => x.dataset.cmd).filter(Boolean))
    ok(listed.length > 0 && !NEW_IDS.some((id) => listed.includes(id)), `⌘K offers none of the new commands (${listed.filter((id) => NEW_IDS.includes(id)).join(', ') || 'none'} of ${listed.length})`)
    await r.keyboard.press('Escape')
    const n = await r.evaluate(() => window.bento.doc.slides.length)
    await r.keyboard.press('Control+m')
    await r.keyboard.press(`${mod}+d`)
    await r.keyboard.press(`${mod}+ArrowDown`)
    await r.waitForTimeout(200)
    ok(await r.evaluate(() => window.bento.doc.slides.length) === n, 'Ctrl+M, ⌘D and ⌘↓ change nothing')
    ok(rerr.length === 0, `no page errors${rerr.length ? ': ' + rerr.join(' | ') : ''}`)
    await r.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
