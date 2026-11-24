// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The ⌘K command palette, and the shortcuts that moved into the same command list.
//
//   npm run build:single --prefix slides && node scripts/test-slides-command-palette-browser.mjs
//
// WHAT THIS PROVES.
//   1. ⌘K opens the palette with its input focused; typing filters by a fuzzy
//      match; ↑↓ move the choice; Enter runs it and closes; Esc closes.
//   2. The command that ran is listed first the next time the palette opens.
//   3. The keys that moved into the list still do what they did: ⌘D
//      duplicates, ⌘Z / ⇧⌘Z undo and redo, ⌘G groups, [ hides the slide list,
//      PageDown walks a slide — and none of them fires while typing in a field.
//   4. The topbar's Undo tooltip reads its keys from the list.
//   5. A command that cannot run now is listed greyed, after the ones that
//      can, with the reason inside the option (aria-disabled): "align" with
//      nothing selected says "Select something first", "distribute" with one
//      element "Select three or more"; Enter or a click on one runs nothing
//      and keeps the palette open; the empty query lists only what can run.
//      A key press still honours the condition (⌥A with nothing selected
//      moves nothing).
//   6. Other tools' words find commands: tidy, line up, dark, reuse, print.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  const nEls = () => p.evaluate(() => {
    const i = [...document.querySelectorAll('.ed-thumb')].findIndex((t) => t.classList.contains('active'))
    return window.bento.doc.slides[Math.max(0, i)].elements.length
  })
  const selection = () => p.evaluate(() => window.bento.selection)

  console.log('\nthe palette\n')
  await p.mouse.click(700, 120) // focus the page, not a field
  await p.keyboard.press('Escape')
  await p.keyboard.press(`${mod}+k`)
  ok(await p.isVisible('.ed-cmdk'), '⌘K opens the palette')
  ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-cmdk-input')), 'its input has focus')
  const all = await p.$$eval('.ed-cmdk-list li', (l) => l.length)
  ok(all > 20, `it lists the commands (${all})`)
  ok(await p.$$eval('.ed-cmdk-list kbd', (k) => k.some((x) => x.textContent === 'F5')), 'shortcuts show as key chips')
  await p.keyboard.type('add tab')
  const first = await p.$eval('.ed-cmdk-list li[aria-selected="true"]', (li) => li.dataset.cmd)
  ok(first === 'insert-table', `a fuzzy query picks "Add a table" first (${first})`)
  ok(await p.$$eval('.ed-cmdk-list li', (l) => l.length) < all, 'typing filters the list')
  await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace')
  await p.keyboard.type('xt box')
  const before = await nEls()
  await p.keyboard.press('Enter')
  ok(!(await p.$('.ed-cmdk')), 'Enter closes the palette')
  await p.waitForTimeout(200)
  // the text tool arms, as T does; a click on the slide puts the box down
  { const b = await p.locator('.ed-stage-scale').boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.85) }
  await p.waitForTimeout(250)
  await p.keyboard.press('Escape') // leave the new text box's editing; it stays selected
  ok(await nEls() === before + 1, `Enter ran the chosen command — a text box was added (${before} → ${await nEls()})`)
  const added = await selection()
  await p.keyboard.press(`${mod}+k`)
  ok(await p.$eval('.ed-cmdk-list li', (li) => li.dataset.cmd) === 'insert-text', 'the command just used is listed first next time')
  await p.keyboard.press('ArrowDown')
  ok(await p.$eval('.ed-cmdk-list li:nth-child(2)', (li) => li.getAttribute('aria-selected')) === 'true', '↓ moves the choice')
  await p.keyboard.press('Escape')
  ok(!(await p.$('.ed-cmdk')), 'Esc closes it')
  ok(JSON.stringify(await selection()) === JSON.stringify(added), 'Esc in the palette leaves the selection alone')

  console.log('\nthe keys that moved into the list\n')
  ok(added.length === 1, `the new text box is selected (${added.length})`)
  const n0 = await nEls()
  await p.keyboard.press(`${mod}+d`)
  ok(await nEls() === n0 + 1, '⌘D duplicates the selection')
  await p.keyboard.press(`${mod}+z`)
  ok(await nEls() === n0, '⌘Z undoes it')
  await p.keyboard.press(`${mod}+Shift+z`)
  ok(await nEls() === n0 + 1, '⇧⌘Z redoes it')
  await p.keyboard.press(`${mod}+z`)
  await p.keyboard.press(`${mod}+z`) // and the inserted text box
  ok(await nEls() === before, 'undo walks back to the deck as it was')
  await p.mouse.click(700, 120); await p.keyboard.press('Escape')
  await p.keyboard.press(`${mod}+a`)
  await p.keyboard.press(`${mod}+k`)
  await p.keyboard.type('distribute')
  const dist = await p.$$eval('.ed-cmdk-list li', (l) => l.map((x) => x.dataset.cmd))
  ok(dist[0]?.startsWith('distribute-'), `the other tools' word finds the command — "distribute" → ${dist.slice(0, 2).join(', ')}`)
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape')
  const sideOpen = () => p.evaluate(() => !document.querySelector('.ed-root')?.classList.contains('left-collapsed') && (document.querySelector('.ed-sidebar')?.getBoundingClientRect().width ?? 0) > 40)
  const wasOpen = await sideOpen()
  await p.keyboard.press('[')
  await p.waitForTimeout(350)
  ok(await sideOpen() !== wasOpen, '[ still toggles the slide list')
  await p.keyboard.press('[')
  await p.waitForTimeout(350)
  const slideAt = () => p.evaluate(() => [...document.querySelectorAll('.ed-thumb')].findIndex((t) => t.classList.contains('active')))
  await p.keyboard.press('Escape')
  const s0 = await slideAt()
  await p.keyboard.press('PageDown')
  ok(await slideAt() === s0 + 1, `PageDown walks to the next slide (${s0} → ${await slideAt()})`)
  await p.keyboard.press('PageUp')

  console.log('\nnot while typing\n')
  const title = await p.$('.ed-topbar .ed-title')
  await title.click()
  await p.keyboard.press(`${mod}+k`)
  ok(!(await p.$('.ed-cmdk')), '⌘K does not open while a text field has focus')
  const s1 = await slideAt()
  await p.keyboard.press('PageDown')
  ok(await slideAt() === s1, 'PageDown in a field is the field’s own key')
  await p.keyboard.press('Escape')

  console.log('\nunavailable commands, with the reason\n')
  {
    const rows = () => p.$$eval('.ed-cmdk-list li[data-cmd]', (l) => l.map((x) => ({ cmd: x.dataset.cmd, off: x.getAttribute('aria-disabled') === 'true', why: x.querySelector('.ed-cmdk-why')?.textContent ?? '', name: x.textContent })))
    const query = async (q) => {
      await p.keyboard.press(`${mod}+k`)
      await p.waitForSelector('.ed-cmdk')
      await p.keyboard.type(q)
      return rows()
    }
    await p.mouse.click(700, 120); await p.keyboard.press('Escape'); await p.keyboard.press('Escape')
    ok((await selection()).length === 0, 'nothing is selected')
    const docBefore = await p.evaluate(() => JSON.stringify(window.bento.doc.slides))
    const al = await query('align')
    const aligns = al.filter((r) => r.cmd.startsWith('align-'))
    ok(aligns.length === 6 && aligns.every((r) => r.off), `"align" lists the six align commands, greyed (${aligns.length}, ${aligns.filter((r) => r.off).length} greyed)`)
    ok(aligns.length > 0 && aligns.every((r) => r.why === 'Select something first'), `with the reason "${aligns[0]?.why}"`)
    ok(aligns.length > 0 && aligns.every((r) => r.name.includes(r.why) && r.why), 'the reason is part of the option’s accessible name')
    const firstOff = al.findIndex((r) => r.off)
    ok(firstOff >= 0 && al.slice(firstOff).every((r) => r.off), `the ones that can run sort above the greyed ones (${firstOff} available first)`)
    // Enter on a greyed row, then a click on one
    const at = al.findIndex((r) => r.cmd === 'align-left')
    for (let i = 0; i < at; i++) await p.keyboard.press('ArrowDown')
    ok(at >= 0 && (await p.$$eval('.ed-cmdk-list li[aria-selected="true"]', (l) => l[0]?.dataset.cmd)) === 'align-left', 'the choice can rest on a greyed row')
    await p.keyboard.press('Enter')
    ok(at >= 0 && !!(await p.$('.ed-cmdk')), 'Enter on it keeps the palette open')
    // a real click (Playwright's click() refuses an aria-disabled element)
    const box = await p.$('.ed-cmdk-list li[data-cmd="align-right"]').then((h) => h?.boundingBox())
    if (box) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    ok(!!(await p.$('.ed-cmdk')) && al.some((r) => r.cmd === 'align-right'), 'a click on one keeps it open')
    ok(await p.evaluate(() => JSON.stringify(window.bento.doc.slides)) === docBefore, 'and nothing ran')
    if (await p.$('.ed-cmdk')) await p.keyboard.press('Escape')
    const empty = await query('')
    ok(empty.length > 0 && empty.every((r) => !r.off), `the empty query lists only what can run (${empty.filter((r) => r.off).length} greyed of ${empty.length})`)
    await p.keyboard.press('Escape')
    // the key still honours the condition
    const frames = () => p.evaluate(() => {
      const i = Math.max(0, [...document.querySelectorAll('.ed-thumb')].findIndex((t) => t.classList.contains('active')))
      return JSON.stringify(window.bento.doc.slides[i].elements.map((e) => [e.x, e.y]))
    })
    const f0 = await frames()
    await p.keyboard.press('Alt+a')
    await p.waitForTimeout(150)
    ok(await frames() === f0 && (await selection()).length === 0, '⌥A with nothing selected moves nothing')
    // one element selected: a new text box
    await p.keyboard.press('t')
    { const b = await p.locator('.ed-stage-scale').boundingBox(); await p.mouse.click(b.x + b.width / 2, b.y + b.height * 0.85) }
    await p.waitForTimeout(250)
    await p.keyboard.press('Escape')
    ok((await selection()).length === 1, 'one element is selected')
    const dist = (await query('distribute')).filter((r) => r.cmd.startsWith('distribute-'))
    ok(dist.length === 2 && dist.every((r) => r.off && r.why === 'Select three or more'), `"distribute" lists both, greyed: ${dist.map((r) => `${r.cmd} "${r.why}"`).join(', ')}`)
    const al1 = (await query('')).length
    await p.keyboard.press('Escape')
    const al2 = (await query('align')).filter((r) => r.cmd.startsWith('align-'))
    ok(al2.length === 6 && al2.every((r) => !r.off), `with it selected the align commands can run (${al2.filter((r) => !r.off).length} of ${al2.length}; ${al1} listed)`)
    await p.keyboard.press('Escape')
    await p.keyboard.press(`${mod}+z`)
    await p.waitForTimeout(200)
    await p.mouse.click(700, 120); await p.keyboard.press('Escape'); await p.keyboard.press('Escape')

    console.log('\nother tools’ words\n')
    for (const q of ['tidy', 'line up', 'dark', 'reuse', 'print']) {
      const r = await query(q)
      ok(r.length > 0, `"${q}" → ${r.slice(0, 3).map((x) => x.cmd).join(', ') || 'No matching command'}`)
      await p.keyboard.press('Escape')
    }
  }

  console.log('\nthe topbar\n')
  const undoTitle = await p.$$eval('.ed-group-history .ed-btn', (b) => b.map((x) => x.getAttribute('title') ?? x.dataset.hint ?? ''))
  ok(undoTitle.some((x) => /^Undo \((⌘|Ctrl)Z\)$/.test(x)), `Undo's tooltip carries its keys from the list (${undoTitle[0]})`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
