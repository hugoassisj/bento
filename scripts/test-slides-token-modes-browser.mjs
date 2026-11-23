// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Theme colours and token modes in the packaged editor, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-token-modes-browser.mjs
//
// Tokens hold one value per mode; the deck's theme colours hold one value for
// every mode. The Tokens view lists both in one Colors group, so it has to say
// which is which, or a person who adds a Dark mode and recolours Background
// has changed Default too without knowing it.
//
// WHAT THIS PROVES:
//   1. with one mode the Theme sub-heading carries no badge;
//   2. after + adds a mode it shows "Same in every mode", with an accessible
//      name and a title that explains it;
//   3. editing a theme colour while the second mode is showing says, in a
//      toast, that the first mode changed too, and its Undo puts the previous
//      colour back (and what follows it) in one step;
//   4. that toast comes once per session for a deck, not on every edit;
//   5. "Make a color token from this" (the row's ⋯) adds a colour token with
//      the slot's value in every mode and binds nothing by itself;
//   6. the mode switch's summary counts the properties that follow a theme
//      colour as not changed;
//   7. no page error.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  await ctx.addInitScript(() => localStorage.setItem('bento-side-view', 'tokens'))
  const p = await ctx.newPage()
  p.setDefaultTimeout(5000) // a missing control fails its check, not the whole run
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  await p.locator('.ed-side-tabs [data-view="tokens"]').click(); await p.waitForTimeout(250)

  const theme = () => p.locator('.ed-side-tokens .ed-tokens-sub').first()
  const badge = () => theme().locator('.ed-tokens-shared')
  const doc = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc)))
  const toastText = () => p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')
  const clearToast = () => p.evaluate(() => document.querySelector('.ed-toast')?.remove())
  // every property in the deck that follows a theme colour (a slot ref, not a `$token`)
  const slotRefs = () => p.evaluate(() => {
    let n = 0
    for (const s of window.bento.doc.slides) for (const h of [s, ...s.elements]) for (const r of Object.values(h.themeRefs ?? {})) if (!String(r).startsWith('$')) n++
    return n
  })
  const allRefs = () => p.evaluate(() => JSON.stringify(window.bento.doc.slides.map((s) => [s.themeRefs ?? null, s.elements.map((e) => e.themeRefs ?? null)])))
  const typeHex = async (slot, hex) => {
    await p.locator(`.ed-side-tokens .ed-token-builtin[data-slot="${slot}"] .ed-token-value`).click()
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type(hex); await p.keyboard.press('Enter')
    await p.waitForTimeout(300)
  }

  console.log('\none mode\n')
  ok((await doc()).theme.tokens?.modes === undefined || (await doc()).theme.tokens.modes.length < 2, 'the starter deck has a single mode')
  ok(await theme().count() === 1 && (await theme().locator('span').first().textContent()) === 'Theme', 'the Theme sub-heading is there')
  ok(await badge().count() === 0, 'with one mode it carries no "Same in every mode" badge')

  console.log('\nadd a mode\n')
  await p.locator('.ed-side-tokens .ed-tokens-addmode').click()
  await p.keyboard.type('Dark'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
  ok((await doc()).theme.tokens.mode === 'Dark', '+ adds Dark and shows it')
  ok(await badge().count() === 1, 'the Theme sub-heading now shows the badge')
  const shown = await badge().textContent().catch(() => '')
  ok(shown === 'Same in every mode', `its text reads "Same in every mode" (got "${shown}")`)
  const name = await badge().evaluate((b) => b.getAttribute('aria-label') || '').catch(() => '')
  const title = await badge().evaluate((b) => b.title || '').catch(() => '')
  ok(name === 'Same in every mode' && (await badge().getAttribute('role').catch(() => '')) === 'note', `it has an accessible name and a role (name "${name}")`)
  ok(/every mode/.test(title) && /token/.test(title), `its title explains that a colour token varies by mode ("${title}")`)

  console.log('\nedit a theme colour in the second mode\n')
  await clearToast()
  const before = await doc()
  const bgFollowers = before.slides.filter((s) => (s.themeRefs?.background ?? '').split(' ')[0] === 'bg1').length
  await typeHex('bg1', '101418')
  const after = await doc()
  ok(after.theme.background.toLowerCase() === '#101418', 'the edit lands on theme.background')
  const said = await toastText()
  ok(said.startsWith('Theme colors are shared by every mode, so this changed Default too.'), `a toast says Default changed too ("${said}")`)
  const undo = p.locator('.ed-toast .ed-toast-act')
  ok(await undo.count() === 1 && (await undo.textContent().catch(() => '')) === 'Undo', 'the toast offers Undo')
  if (await undo.count()) await undo.click()
  await p.waitForTimeout(300)
  const undone = await doc()
  ok(undone.theme.background === before.theme.background, `Undo puts the previous Background back (${undone.theme.background})`)
  ok(bgFollowers > 0 && JSON.stringify(undone.slides.map((s) => s.background)) === JSON.stringify(before.slides.map((s) => s.background)), `and the ${bgFollowers} slide backgrounds that follow it`)
  await p.keyboard.press(`${MOD}+z`); await p.waitForTimeout(300)
  ok((await doc()).theme.background.toLowerCase() === '#101418', 'Undo was one step: ⌘Z then steps back to the edit itself')
  await p.keyboard.press(`${MOD}+Shift+z`); await p.waitForTimeout(300)
  ok((await doc()).theme.background === before.theme.background, '⌘⇧Z comes back to the undone colour')

  console.log('\nonce per session\n')
  await clearToast()
  await typeHex('tx1', '223344')
  ok((await doc()).theme.color.toLowerCase() === '#223344', 'a second theme edit in Dark lands')
  ok(!(await toastText()).startsWith('Theme colors are shared'), `and says nothing this time ("${await toastText()}")`)

  console.log('\nmake a color token from this\n')
  const refsBefore = await allRefs()
  const bg = (await doc()).theme.background
  await p.locator('.ed-side-tokens .ed-token-builtin[data-slot="bg1"]').hover()
  await p.locator('.ed-side-tokens .ed-token-builtin[data-slot="bg1"] .ed-token-more').click().catch(() => {}); await p.waitForTimeout(150)
  const item = p.locator('.ed-ctxmenu .ed-ctxmenu-item', { hasText: 'Make a color token from this' })
  ok(await item.count() === 1, 'the Background row\'s ⋯ offers "Make a color token from this"')
  const setBefore = Object.keys((await doc()).theme.tokens.set)
  if (await item.count()) await item.click()
  await p.waitForTimeout(300)
  const d5 = await doc()
  const made = Object.keys(d5.theme.tokens.set).filter((k) => !setBefore.includes(k))
  const tok = made.length === 1 ? d5.theme.tokens.set[made[0]] : null
  ok(!!tok && tok.type === 'color', `one colour token is added (${made.join(', ')})`)
  ok(!!tok && d5.theme.tokens.modes.every((m) => tok.values[m] === bg), `it carries Background's value in every mode (${JSON.stringify(tok?.values)})`)
  ok(await allRefs() === refsBefore, 'and nothing was rebound to it')
  ok(!!tok && await p.locator(`.ed-side-tokens [data-token="${made[0]}"]`).count() === 1, 'its row is listed under Yours')

  console.log('\nswitch mode\n')
  await clearToast()
  const k = await slotRefs()
  await p.locator('.ed-side-tokens .ed-tokens-mode', { hasText: 'Default' }).click(); await p.waitForTimeout(300)
  const sw = await toastText()
  ok((await doc()).theme.tokens.mode === 'default', 'the Default chip switches back')
  ok(k > 0 && sw.includes(`${k} follow theme colors, which are the same in every mode`), `the summary counts the ${k} theme-colour properties as not changed ("${sw}")`)

  ok(errors.length === 0, `no page error${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
