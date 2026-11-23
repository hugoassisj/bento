// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The Tokens view's mode chips: adding a mode never moves the side column.
//
//   npm run build:single --prefix slides && node scripts/test-slides-token-modes-browser.mjs
//
// WHAT THIS PROVES: clicking + beside the mode chips opens the name field in
// the header without scrolling the side column sideways. The field used to be
// wider than the room left beside "Tokens", so the header overflowed and
// focusing the field scrolled the whole column 37px left (98px at the
// narrowest width): every section heading lost its first letters, and with
// `overflow-x: hidden` there was no scrollbar to bring it back. Measured as
// geometry: the column's scrollLeft and scrollWidth, and where the section
// headings, the chips and the field actually sit — at the default width and
// at the narrowest the splitter allows, after +, after Esc and after Enter,
// with one mode and with three. Esc closes the field, even after a refused
// name (it used to leave it open: the rebuild it asked for waits while a field
// is focused), and a change to the deck made while it was open (an undo, a
// collaborator's edit) shows as soon as it closes. And the shown mode's chip
// differs from the others by weight, not only by a tint.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

// where things sit, relative to the side column's inner box (inside its border)
const measure = (p) => p.evaluate(() => {
  const s = document.querySelector('.ed-sidebar')
  const b = s.getBoundingClientRect()
  const left = b.left + s.clientLeft
  const right = left + s.clientWidth
  const heads = [...s.querySelectorAll('.ed-side-tokens .ed-section')].filter((e) => e.getClientRects().length)
  const head = s.querySelector('.ed-tokens-head')
  const inHead = head ? [...head.querySelectorAll('.ed-tokens-mode, .ed-tokens-addmode, .ed-token-new, .ed-edit-field')] : []
  const field = s.querySelector('.ed-tokens-head .ed-token-new')
  return {
    scrollLeft: s.scrollLeft,
    overflow: s.scrollWidth - s.clientWidth,
    width: Math.round(b.width),
    headings: heads.length,
    // the leftmost heading's edge against the column's inner edge (≥ 0 is whole)
    headingLeft: heads.length ? Math.min(...heads.map((h) => h.getBoundingClientRect().left - left)) : NaN,
    // the furthest a chip or the field reaches past the header's end (≤ 0 fits)
    pastHead: head && inHead.length ? Math.max(...inHead.map((e) => e.getBoundingClientRect().right)) - Math.min(head.getBoundingClientRect().right, right) : NaN,
    field: field ? (() => { const r = field.getBoundingClientRect(); return { left: r.left - left, right: r.right - right, width: r.width, below: r.top - head.getBoundingClientRect().top } })() : null,
    focused: document.activeElement === field,
  }
})

const fmt = (m) => `scrollLeft ${m.scrollLeft}, overflow ${m.overflow}px, leftmost heading at ${m.headingLeft.toFixed(1)}px, past header ${m.pastHead.toFixed(1)}px`
const still = (m) => m.scrollLeft === 0 && m.overflow <= 0 && m.headings >= 3 && m.headingLeft >= -0.5 && m.pastHead <= 0.5

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  async function open(modes) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'tokens') } catch {} })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    await p.goto('file://' + SHELL)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-tokens-addmode'))
    if (modes.length > 1) {
      await p.evaluate((ms) => {
        const d = JSON.parse(JSON.stringify(window.bento.doc))
        const tk = (d.theme.tokens ??= { set: {} })
        tk.modes = ms
        tk.mode = ms[0]
        for (const v of Object.values(tk.set)) for (const m of ms) v.values[m] ??= Object.values(v.values)[0]
        window.bento.loadDoc(JSON.stringify(d))
      }, modes)
      await p.waitForFunction((n) => document.querySelectorAll('.ed-tokens-mode').length === n, modes.length)
    }
    await p.waitForTimeout(400)
    return { p, ctx, errors }
  }
  // the narrowest the splitter allows: drag it as far left as it goes
  async function narrowest(p) {
    const r = await p.locator('.ed-sidebar + .ed-resizer').boundingBox()
    await p.mouse.move(r.x + r.width / 2, 450)
    await p.mouse.down()
    await p.mouse.move(10, 450, { steps: 12 })
    await p.mouse.up()
    await p.waitForTimeout(300)
  }
  async function addMode(p) {
    await p.locator('.ed-tokens-addmode').click()
    await p.waitForTimeout(250)
  }

  for (const [label, modes, narrow] of [
    ['one mode, default width', ['default'], false],
    ['one mode, narrowest width', ['default'], true],
    ['three modes, default width', ['default', 'Dark', 'High contrast'], false],
    ['three modes, narrowest width', ['default', 'Dark', 'High contrast'], true],
  ]) {
    console.log(`\n${label}\n`)
    const { p, ctx, errors } = await open(modes)
    if (narrow) await narrowest(p)
    const rest = await measure(p)
    ok(still(rest), `at rest (${rest.width}px column): ${fmt(rest)}`)

    await addMode(p)
    const added = await measure(p)
    ok(added.field && added.focused, 'clicking + opens the mode name field, focused')
    ok(added.scrollLeft === 0, `after +, the column has not scrolled sideways (scrollLeft ${added.scrollLeft})`)
    ok(still(added), `after +: ${fmt(added)}`)
    ok(added.field && added.field.left >= -0.5 && added.field.right <= 0.5, `the field sits inside the column (${added.field ? `${added.field.left.toFixed(1)}px from its start, ${added.field.right.toFixed(1)}px past its end` : 'none'})`)
    if (modes.length > 1) ok(added.field && added.field.below >= 20, `with ${modes.length} modes the header wraps: the field starts a line of its own (${added.field?.below.toFixed(1)}px below the header's top)`)

    await p.keyboard.press('Escape')
    await p.waitForTimeout(250)
    const esc = await measure(p)
    ok(still(esc), `after Esc: ${fmt(esc)}`)
    const back = await p.evaluate(() => ({ field: !!document.querySelector('.ed-tokens-head .ed-token-new'), plus: document.activeElement?.classList.contains('ed-tokens-addmode') }))
    ok(!back.field && back.plus, `Esc closes the field and puts the + back, focused (field still open: ${back.field}, + focused: ${back.plus})`)

    // Enter: the mode is made and the panel rebuilds
    if (!back.field) await addMode(p)
    await p.keyboard.type('Night')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(300)
    const made = await measure(p)
    const chips = await p.evaluate(() => [...document.querySelectorAll('.ed-tokens-mode')].map((c) => c.textContent))
    ok(chips.includes('Night'), `Enter makes the mode (${chips.join(', ')})`)
    ok(still(made), `after Enter: ${fmt(made)}`)
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
    await ctx.close()
  }

  console.log('\nrenaming a mode in place never moves the column either\n')
  {
    const { p, ctx } = await open(['default', 'Dark', 'High contrast'])
    await narrowest(p)
    // the shown chip: a first click on any other switches the mode and rebuilds the header
    await p.locator('.ed-tokens-mode', { hasText: 'High contrast' }).click()
    await p.waitForTimeout(300)
    await p.locator('.ed-tokens-mode[aria-pressed="true"]').dblclick()
    await p.waitForTimeout(250)
    // the double-click turns the chip into text that edits in place; a click on it is the field
    if (!(await p.locator('.ed-tokens-head .ed-edit-field').count())) await p.locator('.ed-tokens-head button.ed-edit').click()
    await p.waitForTimeout(250)
    const m = await measure(p)
    const field = await p.evaluate(() => !!document.querySelector('.ed-tokens-head .ed-edit-field:focus'))
    ok(field, 'a double-click opens the rename field')
    ok(still(m), `while renaming: ${fmt(m)}`)
    await ctx.close()
  }

  console.log('\nEsc after a refused name still closes the field\n')
  {
    const { p, ctx } = await open(['default'])
    await p.locator('.ed-tokens-addmode').click()
    await p.keyboard.type('default')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(200)
    const why = await p.evaluate(() => document.querySelector('.ed-tokens-head .ed-token-why')?.textContent ?? '')
    ok(why.length > 0, `a mode that exists is refused and says why ("${why}")`)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(200)
    const after = await p.evaluate(() => ({ field: !!document.querySelector('.ed-tokens-head .ed-token-new'), why: !!document.querySelector('.ed-tokens-head .ed-token-why'), plus: document.activeElement?.classList.contains('ed-tokens-addmode') }))
    ok(!after.field && !after.why && after.plus, `Esc closes it, its note goes with it, the + is back and focused (${JSON.stringify(after)})`)
    await ctx.close()
  }

  console.log('\na change to the deck while the field is open shows once it closes\n')
  for (const how of ['leaving the field', 'Esc']) {
    const { p, ctx } = await open(['default'])
    await addMode(p)
    await p.keyboard.type('Dark')
    await p.keyboard.press('Enter')
    await p.waitForTimeout(300)
    await addMode(p)
    // the same doc event a collaborator's patch sends; the open field holds the rebuild off
    await p.evaluate(() => window.bento.undo())
    await p.waitForTimeout(200)
    if (how === 'Esc') await p.keyboard.press('Escape')
    else await p.locator('.ed-tokens-head h3').click()
    await p.waitForTimeout(300)
    const after = await p.evaluate(() => ({ chips: [...document.querySelectorAll('.ed-tokens-mode')].map((c) => c.textContent), field: !!document.querySelector('.ed-tokens-head .ed-token-new'), plus: document.activeElement?.classList.contains('ed-tokens-addmode') ?? false }))
    ok(after.chips.join(',') === 'Default' && !after.field, `after an undo with the field open, ${how} shows the deck as it is now (${after.chips.join(', ')}; field open: ${after.field})`)
    if (how === 'Esc') ok(after.plus, `…and the + has the focus (${after.plus})`)
    await ctx.close()
  }

  console.log('\nthe shown mode reads as chosen without colour\n')
  {
    const { p, ctx } = await open(['default', 'Dark', 'High contrast'])
    const chips = await p.evaluate(() => [...document.querySelectorAll('.ed-tokens-mode')].map((c) => {
      const s = getComputedStyle(c)
      return { on: c.getAttribute('aria-pressed') === 'true', weight: Number(s.fontWeight) }
    }))
    const on = chips.filter((c) => c.on)
    const off = chips.filter((c) => !c.on)
    ok(on.length === 1 && off.length === 2, `one chip pressed (${on.length}) of ${chips.length}`)
    ok(on.length === 1 && off.every((c) => on[0].weight - c.weight >= 200), `the pressed chip is set heavier than the others (${on.map((c) => c.weight)} vs ${off.map((c) => c.weight).join('/')})`)
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
