// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A field that follows a token or a theme colour shows the value AND the name.
//
//   npm run build:single --prefix slides && node scripts/test-slides-token-chips-browser.mjs
//
// WHAT THIS PROVES, on the starter deck at the panel's default width:
//   1. a corner radius bound to radius.md reads "14 · radius.md": the value
//      and the whole name show (it read "● ra…": the in-field label's rule,
//      `.ed-mini > span`, cut the pill to 55% of the field), and the pill
//      stays clear of the corners button;
//   2. slide 1's Background, which follows the theme's Text colour, reads
//      "Theme: Text · 0d1b2e": the role is prefixed so it cannot be read as
//      "the background is text", the hex shows, and the chip's dot IS the
//      colour (it was a fixed accent); element chips in paint rows (a Fill, a
//      text colour) keep the role, the whole name and the hex too, at the
//      default width, at the narrowest, and in Japanese;
//   3. a name is never cut below six visible characters at the default
//      width; at the narrowest panel the splitter allows, the number pill
//      falls back to the name alone, the value in its title;
//   4. clicking the name reopens the picker and the detach icon lets go and
//      keeps the value, from both kinds of chip;
//   5. right to left, the value comes first (on the right), a Latin name
//      still reads left to right, and the field's own number paints nothing
//      under the moved corners button;
//   6. the Tokens tab's usage counts read as counts ("39×"), fit their
//      column (100× too) without taking width from the name, and their
//      accessible name says what they count and what a click does.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
import { refusePointerLock } from './lib/rig-no-pointer-lock.mjs'

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

// How many characters of a pill's name are actually visible: the stem may be
// cut by an ellipsis (its characters past the cut still have layout boxes, so
// count only those ending before the ellipsis), the leaf after it always shows.
const VISIBLE = () => {
  window.__visibleChars = (label) => {
    if (!label) return 0
    const box = label.closest('button').getBoundingClientRect()
    let n = 0
    for (const part of label.children) {
      const tn = part.firstChild
      if (!tn) continue
      const r = part.getBoundingClientRect()
      const cut = part.scrollWidth > part.clientWidth + 0.5
      const end = Math.min(r.right, box.right) - (cut ? 10 : 0) // an ellipsis is ~1ch wide
      for (let i = 0; i < tn.length; i++) {
        const rg = document.createRange(); rg.setStart(tn, i); rg.setEnd(tn, i + 1)
        const c = rg.getBoundingClientRect()
        if (c.width && c.left >= Math.max(r.left, box.left) - 0.5 && c.right <= end + 0.5) n++
      }
    }
    return n
  }
  // what a colour chip shows, measured: its role (the word "Theme:" whole, or
  // the palette glyph), the slot's name uncut, the hex whole, each inside the
  // chip's button and the chip inside the panel
  window.__chip = (chip) => {
    if (!chip) return null
    const btn = chip.querySelector('.ed-color-token-name'), b = btn.getBoundingClientRect()
    const panel = document.querySelector('.ed-props').getBoundingClientRect(), c = chip.getBoundingClientRect()
    const inside = (e) => { if (!e || !e.offsetWidth) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5 }
    const whole = (e) => inside(e) && e.scrollWidth <= e.clientWidth + 0.5
    return {
      role: whole(chip.querySelector('.ed-color-token-pre')) || inside(chip.querySelector('.ed-color-token-glyph')),
      name: whole(chip.querySelector('.ed-color-token-slot')),
      hex: whole(chip.querySelector('.ed-color-token-hex')),
      inPanel: c.left >= panel.left - 0.5 && c.right <= panel.right + 0.5,
      label: btn.getAttribute('aria-label'),
    }
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
  // never reach the network: no relay, no pack, nothing
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch { /* private mode */ } })
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  await refusePointerLock(ctx)
  await ctx.addInitScript(VISIBLE)
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
  await p.waitForTimeout(300)
  const width = await p.evaluate(() => Math.round(document.querySelector('.ed-props').getBoundingClientRect().width))
  ok(width >= 258 && width <= 270, `measured at the default panel width (${width}px)`)

  // ---- 1. a bound number field: 14 · radius.md --------------------------------
  const tile = await p.evaluate(() => {
    for (const [i, s] of window.bento.doc.slides.entries()) {
      const e = s.elements.find((x) => x.themeRefs?.radius && x.type === 'shape' && x.shape === 'rect')
      if (e) return { slide: i, id: e.id, radius: e.radius, token: e.themeRefs.radius.replace(/^\$/, '') }
    }
    return null
  })
  ok(!!tile, `the starter deck has a rectangle whose radius follows a token (${JSON.stringify(tile)})`)
  const selectTile = async () => {
    await p.locator('.ed-sidebar .ed-thumb').nth(tile.slide).evaluate((x) => x.click()); await p.waitForTimeout(150)
    await p.evaluate((id) => document.querySelector(`.ed-layer[data-id="${id}"]`)?.click(), tile.id); await p.waitForTimeout(250)
  }
  await selectTile()
  const radiusPill = () => p.evaluate(() => {
    const field = [...document.querySelectorAll('.ed-props .ed-mini')].find((m) => m.title === 'Corner radius')
    const pill = field?.querySelector('.ed-token-pill')
    if (!pill) return null
    const name = pill.querySelector('.ed-token-pill-name'), value = pill.querySelector('.ed-token-pill-value')
    const label = pill.querySelector('.ed-token-label')
    const r = (e) => e?.getBoundingClientRect() ?? { left: NaN, right: NaN }
    const corners = field.querySelector('.ed-corners-btn')
    const shown = (e) => !!e && e.offsetWidth > 0 && r(e).right <= r(name).right + 0.5 && r(e).left >= r(name).left - 0.5
    return {
      text: name.textContent, title: name.title,
      valueShown: shown(value), visible: window.__visibleChars(label),
      inField: r(pill).left >= r(field).left && r(pill).right <= r(field).right,
      clearOfCorners: !corners || r(pill).right <= r(corners).left + 0.5 || r(corners).right <= r(pill).left + 0.5,
      valueFirst: value && label ? r(value).left < r(label).left : null,
      headLeftOfTail: r(pill.querySelector('.ed-token-label-head')).left <= r(pill.querySelector('.ed-token-label-tail')).left,
    }
  })
  let rp = await radiusPill()
  ok(!!rp, 'the bound corner radius shows a pill')
  ok(rp && rp.text.includes(String(tile.radius)) && rp.text.includes(tile.token), `the pill reads the value and the token's name (${JSON.stringify(rp?.text)})`)
  ok(rp && rp.valueShown && rp.visible >= tile.token.length, `both are visible at the default width: the value, and ${rp?.visible}/${tile.token.length} characters of the name`)
  ok(rp && rp.inField && rp.clearOfCorners, 'the pill stays inside its field and clear of the corners button')
  ok(rp && rp.title.includes(String(tile.radius)) && rp.title.includes(tile.token), `its title carries the value and the full name (${JSON.stringify(rp?.title)})`)

  // ---- 2. a bound colour field: Theme: Text · 0d1b2e ----------------------------
  const selectSlide1 = async () => {
    await p.locator('.ed-sidebar .ed-thumb').nth(0).evaluate((x) => x.click()); await p.waitForTimeout(150)
    await p.keyboard.press('Escape'); await p.waitForTimeout(150)
    await p.keyboard.press('Escape'); await p.waitForTimeout(250)
  }
  await selectSlide1()
  const slide1 = await p.evaluate(() => ({ bg: window.bento.doc.slides[0].background, ref: window.bento.doc.slides[0].themeRefs?.background }))
  const bgChip = () => p.evaluate(() => {
    const row = [...document.querySelectorAll('.ed-props .ed-row, .ed-props .ed-field, .ed-props label, .ed-props div')].find((d) => d.firstElementChild?.textContent === 'Background' && d.querySelector('.ed-color-token'))
    const chip = row?.querySelector('.ed-color-token') ?? document.querySelector('.ed-props .ed-color-token')
    if (!chip) return null
    const name = chip.querySelector('.ed-color-token-name'), hex = chip.querySelector('.ed-color-token-hex')
    const b = name.getBoundingClientRect(), h = hex?.getBoundingClientRect()
    return {
      text: name.textContent, title: name.title,
      hexShown: !!h && h.width > 0 && h.top >= b.top - 0.5 && h.bottom <= b.bottom + 0.5 && h.right <= b.right + 0.5,
      dot: getComputedStyle(chip, '::before').backgroundColor,
      roleCut: (() => { const r = chip.querySelector('.ed-color-token-role'); return r ? [r, ...r.children].some((c) => c.scrollWidth > c.clientWidth + 0.5) : null })(),
    }
  })
  const bc = await bgChip()
  ok(slide1.ref === 'tx1', `slide 1's background follows the theme's Text colour (${JSON.stringify(slide1)})`)
  ok(!!bc && /^Theme: Text\b/.test(bc.text), `the chip names the role as a theme colour, not as the property (${JSON.stringify(bc?.text)})`)
  const hex6 = slide1.bg.replace(/^#/, '').toLowerCase()
  ok(!!bc && bc.text.includes(hex6) && bc.hexShown && bc.roleCut === false, `and shows the hex whole beside the whole name (${hex6}, shown: ${bc?.hexShown})`)
  const rgb = `rgb(${parseInt(hex6.slice(0, 2), 16)}, ${parseInt(hex6.slice(2, 4), 16)}, ${parseInt(hex6.slice(4, 6), 16)})`
  ok(bc?.dot === rgb, `the chip's dot is the colour itself (${bc?.dot}, want ${rgb})`)

  // element chips too, in their paint rows (swatch · chip · %): slide 2's
  // Background-filled tile and its title, whose text follows Text. Every one
  // keeps its role, its whole name and its hex (the row gives a chip that
  // does not fit a line of its own, and at the narrowest the hex goes under
  // the name) — "FILL ○ Backgro…" was the bug the role is there to prevent.
  const colourChips = (page) => page.evaluate(async () => {
    const pick = async (s, id) => {
      document.querySelectorAll('.ed-sidebar .ed-thumb')[s].click(); await new Promise((r) => setTimeout(r, 150))
      if (id) document.querySelector(`.ed-layer[data-id="${id}"]`)?.click()
      else { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) }
      await new Promise((r) => setTimeout(r, 250))
    }
    const out = {}
    await pick(0, null)
    out.background = window.__chip(document.querySelector('.ed-props .ed-color-token'))
    for (const id of ['sd-tile-c', 'sd-title']) {
      await pick(1, id)
      out[id] = window.__chip(document.querySelector('.ed-props .ed-paintrow .ed-color-token')) // the first paint row: Fill
    }
    return out
  })
  const allShow = (cs) => Object.entries(cs).filter(([, c]) => !(c && c.role && c.name && c.hex && c.inPanel)).map(([k, c]) => `${k}: ${JSON.stringify(c)}`)
  let cs = await colourChips(p)
  let bad = allShow(cs)
  ok(bad.length === 0 && cs['sd-tile-c']?.label === 'Theme: Background · eeece4', `at the default width every colour chip shows its role, whole name and hex, in a paint row too (${cs['sd-tile-c']?.label})${bad.length ? ': ' + bad.join(' | ') : ''}`)

  // every chip on every showcase slide: never fewer than six characters of the name
  const short = await p.evaluate(async () => {
    const bad = []
    const n = window.bento.doc.slides.length
    for (let s = 0; s < n; s++) {
      document.querySelectorAll('.ed-sidebar .ed-thumb')[s].click()
      await new Promise((r) => setTimeout(r, 80))
      for (const id of [null, ...window.bento.doc.slides[s].elements.map((e) => e.id)]) {
        if (id) document.querySelector(`.ed-layer[data-id="${id}"]`)?.click()
        await new Promise((r) => setTimeout(r, 40))
        // what is painted: the chips settle their form before a frame is drawn (a ResizeObserver)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        for (const chip of document.querySelectorAll('.ed-props .ed-token-pill, .ed-props .ed-color-token')) {
          if (!chip.offsetParent) continue
          // a theme colour's name is the slot's ("Theme: " may give way before it)
          const label = chip.querySelector('.ed-token-label, .ed-color-token-slot') ?? chip.querySelector('button')
          const full = label.textContent
          // a cut-in-the-middle name counts its characters; plain text, by the share that shows before the ellipsis
          const seen = label.querySelector('.ed-token-label-head')
            ? window.__visibleChars(label)
            : (label.scrollWidth > label.clientWidth + 0.5 ? Math.floor(full.length * (label.clientWidth - 10) / label.scrollWidth) : full.length)
          if (seen < Math.min(6, full.length)) bad.push(`slide ${s + 1} ${id ?? 'slide'}: ${full} (${seen})`)
        }
      }
    }
    return bad
  })
  ok(short.length === 0, `no chip on any slide shows fewer than six characters of its name${short.length ? ': ' + short.join(' | ') : ''}`)

  // ---- 4. re-pick and detach, from both chips ----------------------------------
  await selectTile()
  await p.locator('.ed-props .ed-token-pill .ed-token-pill-name').first().click(); await p.waitForTimeout(200)
  ok(await p.locator('.ed-tokpick').count() === 1, 'clicking the number pill reopens the token picker')
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await p.evaluate(() => document.querySelector('.ed-tokpick')?.remove())
  const pill = p.locator('.ed-props .ed-token-pill').first()
  await pill.hover(); await p.waitForTimeout(100)
  await pill.locator('.ed-color-detach').click(); await p.waitForTimeout(250)
  const after = await p.evaluate((id) => { for (const s of window.bento.doc.slides) { const e = s.elements.find((x) => x.id === id); if (e) return { radius: e.radius, ref: e.themeRefs?.radius ?? null } } }, tile.id)
  ok(after.ref === null && after.radius === tile.radius, `the pill's detach lets go and keeps the value (${JSON.stringify(after)})`)
  ok(await p.evaluate(() => { const f = [...document.querySelectorAll('.ed-props .ed-mini')].find((m) => m.title === 'Corner radius'); return !!f && !f.querySelector('.ed-token-pill') && f.querySelector('input').value }) === String(tile.radius), 'and the field is a number again')
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await p.waitForTimeout(250)

  await selectSlide1()
  await p.locator('.ed-props .ed-color-token .ed-color-token-name').first().click(); await p.waitForTimeout(200)
  ok(await p.locator('.ed-tokpick').count() === 1, 'clicking the colour chip reopens the picker')
  await p.keyboard.press('Escape'); await p.waitForTimeout(150)
  await p.evaluate(() => document.querySelector('.ed-tokpick')?.remove())
  const chip = p.locator('.ed-props .ed-color-token').first()
  await chip.hover(); await p.waitForTimeout(100)
  await chip.locator('.ed-color-detach').click(); await p.waitForTimeout(250)
  const s1 = await p.evaluate(() => ({ bg: window.bento.doc.slides[0].background, ref: window.bento.doc.slides[0].themeRefs?.background ?? null }))
  ok(s1.ref === null && s1.bg.toLowerCase() === slide1.bg.toLowerCase(), `the colour chip's detach lets go and keeps the colour (${JSON.stringify(s1)})`)
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z'); await p.waitForTimeout(250)

  // ---- 5. right to left ---------------------------------------------------------
  await selectTile()
  await p.evaluate(() => { document.documentElement.dir = 'rtl' }); await p.waitForTimeout(150)
  rp = await radiusPill()
  ok(rp && rp.valueFirst === false && rp.headLeftOfTail, `RTL: the value comes first, on the right, and the name still reads left to right (${JSON.stringify(rp && { valueFirst: rp.valueFirst, ltr: rp.headLeftOfTail })})`)
  // the field's own number, under the pill, must paint nothing: right to left
  // it sits at the left, where the corners button now is, and printed under it
  // ("1⛶4"). Measured in pixels: the field drawn with its number and without
  // it (the corners button hidden both times, nothing focused) must be the same picture.
  {
    const field = p.locator('.ed-props .ed-mini[title="Corner radius"]')
    const shot = async (v) => {
      // at rest: a focused input paints its own text (the pill steps aside for typing)
      await field.evaluate((f, v) => { document.activeElement?.blur(); f.querySelector('.ed-corners-btn').style.visibility = 'hidden'; f.querySelector('input').value = v }, v)
      return field.screenshot()
    }
    const withNum = await shot(String(tile.radius)), without = await shot('')
    await field.evaluate((f, v) => { f.querySelector('.ed-corners-btn').style.visibility = ''; f.querySelector('input').value = v }, String(tile.radius))
    ok(withNum.equals(without), 'RTL: the bound field\'s own number paints nothing beside the pill or under the corners button')
    const lap = await field.evaluate((f) => { const a = f.querySelector('.ed-token-pill').getBoundingClientRect(), b = f.querySelector('.ed-corners-btn').getBoundingClientRect(); return !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5) })
    ok(!lap, 'RTL: the pill and the corners button do not overlap')
  }
  await p.evaluate(() => { document.documentElement.dir = 'ltr' }); await p.waitForTimeout(150)

  // ---- 3. the narrowest panel ---------------------------------------------------
  // dragged by its real splitter as far as it goes (Editor.panelMin)
  const grip = await p.evaluate(() => {
    const left = document.querySelector('.ed-props').getBoundingClientRect().left
    const h = [...document.querySelectorAll('.ed-resizer')].map((x) => x.getBoundingClientRect()).sort((a, b) => Math.abs(a.right - left) - Math.abs(b.right - left))[0]
    return { x: h.left + h.width / 2, y: h.top + 60 }
  })
  await p.mouse.move(grip.x, grip.y); await p.mouse.down(); await p.mouse.move(grip.x + 800, grip.y, { steps: 10 }); await p.mouse.up(); await p.waitForTimeout(250)
  const narrow = await p.evaluate(() => Math.round(document.querySelector('.ed-props').getBoundingClientRect().width))
  rp = await radiusPill()
  // the six-character floor is the default width's; here the radius field
  // shares its half row with the corners button, so the value steps aside
  // first and the name keeps its leaf whole (r…md at worst)
  ok(narrow < 240 && rp && !rp.valueShown && rp.visible >= 3 && rp.inField && rp.clearOfCorners, `at the narrowest panel (${narrow}px) the pill falls back to the name alone (${rp?.visible} characters, the leaf whole), inside its field`)
  ok(rp && rp.title.includes(String(tile.radius)), 'and the value is still in its title')
  cs = await colourChips(p)
  bad = allShow(cs)
  ok(bad.length === 0, `at the narrowest panel too, every colour chip keeps its role, whole name and hex (the slide's Background, a Fill, a text colour)${bad.length ? ': ' + bad.join(' | ') : ''}`)
  await p.mouse.dblclick(grip.x + 264 - narrow, grip.y); await p.waitForTimeout(150) // reset the panel

  // ---- 6. the usage counts ------------------------------------------------------
  await p.locator('.ed-side-tabs [data-view="tokens"]').click(); await p.waitForTimeout(300)
  const uses = await p.$$eval('.ed-side-tokens .ed-token-uses:not(.ed-token-unused)', (bs) => bs.map((b) => ({ text: b.textContent, label: b.getAttribute('aria-label') ?? '' })))
  ok(uses.length >= 5, `the Tokens tab lists usage counts (${uses.length})`)
  const badText = uses.filter((u) => !/^\d+×$/.test(u.text))
  ok(badText.length === 0, `each reads as a count, like "${uses[0]?.text}"${badText.length ? ': ' + badText.map((u) => u.text).join(' ') : ''}`)
  const badName = uses.filter((u) => !(u.label.startsWith(u.text.replace('×', '') + ' ') && /follows? .* click to select/.test(u.label)))
  ok(badName.length === 0, `each is named for what it counts and what a click does (${JSON.stringify(uses[0]?.label)})${badName.length ? ': ' + badName.map((u) => u.label).join(' | ') : ''}`)

  // the count's column holds it, up to three digits, inside the panel
  const fit = await p.evaluate(() => {
    const side = document.querySelector('.ed-side-tokens').getBoundingClientRect()
    const bs = [...document.querySelectorAll('.ed-side-tokens .ed-token-uses:not(.ed-token-unused)')]
    // whole, inside the panel, clear of the value before it
    const over = (b) => {
      const r = b.getBoundingClientRect(), val = b.parentElement.querySelector('.ed-token-value')
      const textEnd = val ? val.getBoundingClientRect().right - parseFloat(getComputedStyle(val).paddingRight) : -Infinity
      return b.scrollWidth > b.clientWidth || r.right > side.right + 0.5 || r.left < textEnd - 0.5
    }
    const bad = bs.filter(over).map((b) => b.textContent)
    const b = bs[0], keep = b.textContent
    b.textContent = '100×'
    if (over(b)) bad.push('100×')
    b.textContent = keep
    return bad
  })
  ok(fit.length === 0, `every count fits its column, 100× included${fit.length ? ': ' + fit.join(' ') : ''}`)

  // Japanese: the longer slot names and the wide characters still fit, role and hex
  {
    const jctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ja-JP' })
    await jctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-lang', 'ja') } catch { /* private mode */ } })
    if (jctx.routeWebSocket) await jctx.routeWebSocket(/.*/, (ws) => ws.close())
    await jctx.route(/^https?:/, (r) => r.abort())
    await refusePointerLock(jctx)
    await jctx.addInitScript(VISIBLE)
    const jp = await jctx.newPage()
    jp.on('pageerror', (e) => errors.push(`[ja] ${e.message}`))
    await jp.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
    await jp.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-props .ed-tabs'))
    await jp.waitForTimeout(300)
    const jcs = await colourChips(jp)
    const jbad = allShow(jcs)
    ok(jbad.length === 0 && /^テーマ/.test(jcs.background?.label ?? ''), `[ja] at the default width every colour chip shows its role, whole name and hex (${jcs.background?.label})${jbad.length ? ': ' + jbad.join(' | ') : ''}`)
    await jctx.close()
  }

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
