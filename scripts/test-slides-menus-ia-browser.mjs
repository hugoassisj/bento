// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The top bar's map: Save saves, File acts on the document, the app cluster
// sets up the app, About is only about.
//
//   npm run build:single --prefix slides && node scripts/test-slides-menus-ia-browser.mjs
//
// WHAT THIS PROVES (docs/DECISIONS.md 2026-10-30, the top bar's three kinds):
//   1. Save ▾ holds only the ways to save: a copy, a new deck, a password.
//   2. The wordmark opens the File menu: new, import, export (print among
//      them), version history, document properties, compress pictures, the
//      document as JSON, About — and its rows work.
//   3. Print stays in sight on the bar, and in File ▸ Export.
//   4. The app cluster — shortcuts, help, preferences — is one group, each
//      with its hint; Preferences holds the app's settings, and they persist.
//   5. About holds no settings and no document properties.
//   6. ⌘K finds every moved command; ⌘, opens Preferences.
//   7. At 1280, 768 and 390 no bar control overlaps another.
//   9. Starting the show (MP-15): the Slideshow menu's "From the beginning"
//      opens on 1 / N from any slide, the pill still starts on this one, F5
//      and ⇧F5 are unchanged, ⌘K lists both starts with their keys, and a
//      thumbnail's "Present from here" (right-click or long press) opens on
//      that slide (a state: its parent; a hidden slide: not offered).
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

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const open = async (width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1') } catch {} })
    await ctx.route(/^https?:/, (r) => r.abort())
    const p = await ctx.newPage()
    const errors = []
    p.on('pageerror', (e) => errors.push(e.message))
    p.on('dialog', (d) => d.dismiss())
    await p.goto('file://' + SHELL)
    await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'))
    await p.waitForTimeout(400)
    return { p, ctx, errors }
  }
  const { p, ctx, errors } = await open(1440)
  const rows = (sel) => p.$$eval(`${sel} > .ed-btn`, (r) => r.map((b) => b.getAttribute('aria-label') ?? b.querySelector('.ed-menu-label')?.textContent?.trim() ?? b.textContent.trim()))

  console.log('\n1. Save ▾ saves\n')
  await run(async () => {
    await p.click('.ed-split-caret'); await p.waitForTimeout(150)
    const save = await rows('.ed-save-menu')
    ok(save.length === 3 && /copy/i.test(save[0]) && /new deck/i.test(save[1]) && /password/i.test(save[2]), `exactly the ways to save (${save.join(' · ')})`)
    ok(!save.some((x) => /JSON|PowerPoint|images|history|scratch/i.test(x)), 'nothing that is not saving')
    await p.click('.ed-split-caret')
  })

  console.log('\n2. File, on the wordmark\n')
  await run(async () => {
    await p.click('.ed-logo'); await p.waitForTimeout(150)
    const cmds = await p.$$eval('.ed-file-menu > .ed-btn', (r) => r.map((b) => b.dataset.cmd))
    const want = ['start-scratch', 'import-pptx', 'export-pdf', 'export-images', 'export-pptx', 'version-history', 'doc-props', 'compress-images', 'copy-json', 'copy-compact-json', 'replace-json', 'about']
    ok(want.every((c) => cmds.includes(c)), `every document command is there (${cmds.join(', ')})`)
    const caps = await p.$$eval('.ed-file-menu > .ed-menu-cap', (r) => r.map((c) => c.textContent))
    ok(caps.includes('Export') && caps.includes('Advanced'), `grouped under captions (${caps.join(', ')})`)
    ok(await p.$eval('.ed-file-menu [data-cmd="export-pdf"]', (b) => /P/.test(b.querySelector('.ed-menu-keys')?.textContent ?? '')), 'Print shows its shortcut there')
    await p.click('.ed-file-menu [data-cmd="doc-props"]'); await p.waitForTimeout(200)
    const props = await p.$eval('.ed-about', (b) => b.innerText)
    ok(/Author/.test(props) && /Keywords/.test(props) && /\{\{author\}\}/.test(props), 'Document properties opens its own dialog with the fields')
    await p.keyboard.press('Escape')
    await p.click('.ed-logo'); await p.click('.ed-file-menu [data-cmd="version-history"]')
    ok(await p.waitForSelector('.ed-version-box', { timeout: 3000 }).then(() => true, () => false), 'Version history opens')
    await p.keyboard.press('Escape')
    await p.evaluate(() => document.querySelectorAll('.ed-about-overlay, .ed-dialog-overlay').forEach((o) => o.remove()))
  })

  console.log('\n3. Print in sight\n')
  await run(async () => {
    const pdf = await p.$('.ed-topbar .ed-group-right > [data-cmd="export-pdf"]')
    ok(!!pdf && await pdf.isVisible(), 'Print is a visible bar button')
    ok(/⌘P|Ctrl\+?P/.test((await pdf.getAttribute('title')) ?? ''), `its hint carries ⌘P (${await pdf.getAttribute('title')})`)
  })

  console.log('\n4. The app cluster and Preferences\n')
  await run(async () => {
    const app = await p.$$eval('.ed-topbar .ed-app > button, .ed-topbar .ed-app > .ed-dropdown > button', (bs) => bs.map((b) => ({ cmd: b.dataset.cmd ?? '', name: b.getAttribute('aria-label') ?? b.title, title: b.title, w: Math.round(b.getBoundingClientRect().width) })))
    ok(app.length === 3, `one group of three (${app.map((a) => a.name).join(' · ')})`)
    ok(app.some((a) => a.cmd === 'help' && /\?/.test(a.title)) && app.some((a) => a.cmd === 'preferences' && /,/.test(a.title)), 'shortcuts (?) and preferences (⌘,) carry their keys')
    ok(new Set(app.map((a) => a.w)).size === 1, `same-size buttons (${app.map((a) => a.w).join('/')})`)
    ok(!(await p.$('.ed-topbar .ed-lang-menu')), 'no loose language button on the bar')
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Comma' : 'Control+Comma'); await p.waitForTimeout(200)
    const prefs = await p.$eval('.ed-about', (b) => ({ text: b.innerText, cls: b.className }))
    ok(/ed-prefs/.test(prefs.cls), '⌘, opens Preferences')
    ok(['Appearance', 'Language', 'automatically', 'Shrink photos', 'Offline'].every((w) => prefs.text.includes(w)), 'Preferences holds the app’s settings')
    ok(!/Author|Keywords|Compress pictures/.test(prefs.text), '…and nothing of the document')
    const was = await p.$eval('.ed-prefs input[type=checkbox]', (c) => c.checked)
    await p.click('.ed-prefs input[type=checkbox]')
    await p.keyboard.press('Escape')
    await p.click('.ed-topbar [data-cmd="preferences"]'); await p.waitForTimeout(150)
    ok(await p.$eval('.ed-prefs input[type=checkbox]', (c) => c.checked) === !was, 'a setting persists across reopening')
    await p.click('.ed-prefs input[type=checkbox]') // put it back
    await p.keyboard.press('Escape')
  })

  console.log('\n5. About is about\n')
  await run(async () => {
    await p.click('.ed-logo'); await p.click('.ed-file-menu [data-cmd="about"]'); await p.waitForTimeout(200)
    const about = await p.$eval('.ed-about', (b) => b.innerText)
    ok(/v\d+\.\d+\.\d+/.test(about) && /Check for updates/.test(about), 'version and the update check')
    ok(!/Appearance|Offline|Shrink photos|Author|Keywords|Compress pictures/.test(about), 'no settings and no document properties')
    await p.keyboard.press('Escape')
  })

  console.log('\n6. ⌘K finds them\n')
  await run(async () => {
    for (const q of ['Preferences', 'Document properties', 'Version history', 'Print', 'Replace from JSON', 'Language', 'Keyboard shortcuts']) {
      await p.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await p.waitForTimeout(150)
      await p.keyboard.type(q); await p.waitForTimeout(150)
      const hit = await p.$$eval('.ed-cmdk-list [role=option], .ed-cmdk-list li, .ed-cmdk-row', (r) => r.map((x) => x.textContent).join(' | '))
      ok(hit.toLowerCase().includes(q.toLowerCase().split(' ')[0]), `⌘K "${q}" finds it`)
      await p.keyboard.press('Escape')
    }
  })
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
  await ctx.close()

  console.log('\n9. Starting the show: from the beginning, from this slide, from a thumbnail\n')
  await run(async () => {
    // no bento-slideshow-started here: the first-run pulse must be on, and
    // retired by whichever entry starts the show
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true })
    await c.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
    if (c.routeWebSocket) await c.routeWebSocket(/.*/, (ws) => ws.close())
    await c.route(/^https?:/, (r) => r.abort())
    const q = await c.newPage()
    const errs = []
    q.on('pageerror', (e) => errs.push(e.message))
    q.on('dialog', (d) => d.dismiss())
    await q.goto('file://' + SHELL)
    await q.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-present-pill'))
    await q.waitForTimeout(400)
    const total = await q.evaluate(() => window.bento.doc.slides.filter((s) => !s.stateOf && !s.hidden).length)
    const counter = async () => {
      await q.waitForSelector('.bento-present-overlay .slide-number', { timeout: 4000 })
      await q.waitForTimeout(500)
      return q.$eval('.bento-present-overlay .slide-number', (e) => e.textContent.replace(/\s+/g, ' ').trim())
    }
    const end = async () => {
      await q.keyboard.press('Escape')
      await q.waitForFunction(() => !document.querySelector('.bento-present-overlay'), null, { timeout: 4000 })
      await q.waitForTimeout(200)
    }
    const current = () => q.evaluate(() => Number(document.querySelector('.ed-thumbs .ed-thumb.active')?.dataset.index))
    const pick = async (i) => { await q.click(`.ed-thumbs .ed-thumb[data-index="${i}"]`); await q.waitForTimeout(150) }
    const thumbMenu = async (i) => {
      // centred first: a thumbnail at the list's edge scrolls when it is
      // pressed, and a scroll closes the menu (as it does for a person)
      await q.$eval(`.ed-thumbs .ed-thumb[data-index="${i}"]`, (e) => e.scrollIntoView({ block: 'center' }))
      await q.click(`.ed-thumbs .ed-thumb[data-index="${i}"]`, { button: 'right' })
      await q.waitForTimeout(150)
      // the row's name only, not its key hint
      return q.$$eval('.ed-ctxmenu > .ed-ctxmenu-item', (r) => r.map((b) => b.querySelector('span:not(.ed-ctxmenu-icon)')?.textContent.trim()))
    }

    ok(await q.$eval('.ed-present-pill', (e) => e.classList.contains('ed-hint-pulse')), 'a newcomer sees the first-run pulse on the Slideshow pill')
    // the pill's tooltip names both starts, with the keys from the command list
    const tip = await q.$eval('.ed-present-pill .ed-pill-main', (b) => b.title)
    ok(/F5/.test(tip.replace(/\(⇧F5\)\s*$/, '')) && /\(⇧F5\)\s*$/.test(tip), `the Slideshow tooltip mentions F5 for the beginning and carries ⇧F5 for this slide (${tip})`)

    await pick(4)
    await q.click('.ed-present-pill .ed-pill-caret'); await q.waitForTimeout(150)
    const menu = await q.$$eval('.ed-present-pill .ed-menu > .ed-btn', (r) => r.map((b) => ({ name: b.querySelector('span')?.textContent.trim(), cmd: b.dataset.cmd ?? '', keys: b.querySelector('.ed-menu-keys')?.textContent ?? '' })))
    ok(menu.map((m) => m.name).join(' · ') === 'From the beginning · Present in this tab · Open speaker view', `the Slideshow menu's rows (${menu.map((m) => m.name).join(' · ')})`)
    ok(menu[0]?.cmd === 'present' && menu[0]?.keys === 'F5', `"From the beginning" shows the present command's key (${menu[0]?.cmd} ${menu[0]?.keys})`)
    await q.click('.ed-present-pill .ed-menu > .ed-btn:first-child')
    ok(await counter() === `1 / ${total}`, `with slide 5 current, "From the beginning" opens on 1 / ${total} (${await counter()})`)
    ok(await q.evaluate(() => localStorage.getItem('bento-slideshow-started') === '1' && !document.querySelector('.ed-hint-pulse')), 'and it retires the first-run pulse')
    await q.keyboard.press('ArrowRight'); await q.keyboard.press('ArrowRight'); await q.waitForTimeout(400)
    await end()
    ok(await current() === 2, `Esc returns the editor to the slide where the show stopped (${await current()})`)

    await pick(4)
    await q.click('.ed-present-pill .ed-pill-main')
    ok(await counter() === `5 / ${total}`, `the pill's main half still starts on the current slide (${await counter()})`)
    await end()

    await pick(4)
    await q.keyboard.press('F5')
    ok(await counter() === `1 / ${total}`, `F5 starts from the beginning (${await counter()})`)
    await end()
    await pick(4)
    await q.keyboard.press('Shift+F5')
    ok(await counter() === `5 / ${total}`, `⇧F5 starts on the current slide (${await counter()})`)
    await end()

    await q.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); await q.waitForTimeout(150)
    await q.keyboard.type('present'); await q.waitForTimeout(150)
    const pal = await q.$$eval('.ed-cmdk-list li', (r) => r.map((li) => ({ id: li.dataset.cmd, name: li.querySelector('span')?.textContent, keys: [...li.querySelectorAll('kbd')].map((k) => k.textContent).join(' ') })))
    const from = pal.find((x) => x.id === 'present'), here = pal.find((x) => x.id === 'slideshow')
    ok(from?.name === 'Present from the beginning' && from.keys === 'F5', `⌘K "present": "Present from the beginning" with F5 (${JSON.stringify(from)})`)
    ok(here?.name === 'Present from this slide' && here.keys === '⇧F5', `⌘K "present": "Present from this slide" with ⇧F5 (${JSON.stringify(here)})`)
    ok(pal.filter((x) => /^(Present|Slideshow)$/.test(x.name ?? '')).length === 0, `no bare "Present" or "Slideshow" entry beside them (${pal.map((x) => x.name).join(' | ')})`)
    await q.keyboard.press('Escape')

    // a thumbnail: Present from here, while another slide is current
    await pick(4)
    const rows = await thumbMenu(2)
    ok(rows.indexOf('Present from here') === rows.indexOf('Duplicate slide') + 1 && rows[0] === 'New slide' && rows.at(-1) === 'Delete slide', `the thumbnail menu offers Present from here after Duplicate slide (${rows.join(' · ')})`)
    await q.click('.ed-ctxmenu > .ed-ctxmenu-item:has-text("Present from here")', { timeout: 2000 })
    ok(await counter() === `3 / ${total}`, `"Present from here" on slide 3 opens on 3 / ${total} while slide 5 is current (${await counter()})`)
    await end()
    ok(await current() === 2, `and returns to where the show stopped (${await current()})`)

    // a state opens on its parent; a hidden slide does not offer it
    const st = await q.evaluate(() => { const s = window.bento.doc.slides; const i = s.findIndex((x) => x.stateOf); return { i, parent: s.findIndex((x) => x.id === s[i].stateOf) } })
    await thumbMenu(st.i)
    await q.click('.ed-ctxmenu > .ed-ctxmenu-item:has-text("Present from here")', { timeout: 2000 })
    const parentNo = await q.evaluate((p) => window.bento.doc.slides.slice(0, p + 1).filter((s) => !s.stateOf && !s.hidden).length, st.parent)
    ok(await counter() === `${parentNo} / ${total}`, `on a state (slide ${st.i + 1}) it opens on the state's parent (${await counter()}, want ${parentNo} / ${total})`)
    await end()
    await pick(6)
    await q.click('label.ed-row:has(> span:text-is("Hide slide"))')
    await q.waitForTimeout(200)
    ok(await q.evaluate(() => window.bento.doc.slides[6].hidden === true), 'slide 7 is hidden for the next check')
    const hid = await thumbMenu(6)
    ok(!hid.includes('Present from here') && hid.includes('Duplicate slide'), `a hidden slide does not offer it (${hid.join(' · ')})`)
    await q.keyboard.press('Escape')

    // touch: a long press on a thumbnail opens the same menu
    await q.$eval('.ed-thumbs .ed-thumb[data-index="1"]', (e) => e.scrollIntoView({ block: 'center' }))
    const box = await (await q.$('.ed-thumbs .ed-thumb[data-index="1"]')).boundingBox()
    const cdp = await c.newCDPSession(q)
    const pt = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt })
    await q.waitForTimeout(700)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await q.waitForTimeout(150)
    const touch = await q.$$eval('.ed-ctxmenu > .ed-ctxmenu-item', (r) => r.map((b) => b.querySelector('span:not(.ed-ctxmenu-icon)')?.textContent.trim()))
    ok(touch.includes('Present from here'), `a long press on a thumbnail offers it too (${touch.join(' · ')})`)
    ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`)
    await c.close()
  })

  console.log('\n8. Menus fit their rows, in every language\n')
  for (const [w, h] of [[1440, 900], [1280, 800]]) for (const lang of ['en', 'pt', 'de']) {
    await run(async () => {
      const c = await browser.newContext({ viewport: { width: w, height: h } })
      await c.addInitScript((l) => { try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-lang', l) } catch {} }, lang)
      await c.route(/^https?:/, (r) => r.abort())
      const q = await c.newPage()
      await q.goto('file://' + SHELL)
      await q.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'))
      await q.waitForTimeout(300)
      const fit = (sel) => q.evaluate((sel) => {
        const m = document.querySelector(sel)
        const rows = [...m.querySelectorAll(':scope > .ed-btn')]
        return {
          rows: rows.length,
          noIcon: rows.filter((b) => !(b.querySelector('svg')?.getBoundingClientRect().width > 0)).length,
          cut: rows.filter((b) => b.scrollWidth > b.clientWidth + 0.5).length,
          xScroll: m.scrollWidth > m.clientWidth + 0.5, yScroll: m.scrollHeight > m.clientHeight + 0.5,
          sameLine: rows.every((b) => { const i = b.querySelector('svg')?.getBoundingClientRect(), l = b.querySelector('span')?.getBoundingClientRect(); return !i || !l || Math.abs((i.top + i.bottom) / 2 - (l.top + l.bottom) / 2) < 4 }),
          // captions all-or-none: every group between separators opens with one, or none does
          caps: (() => { const groups = []; let g = []; for (const ch of m.children) { if (ch.classList.contains('ed-menu-sep')) { groups.push(g); g = [] } else g.push(ch) } groups.push(g); const withCap = groups.filter((x) => x[0]?.classList.contains('ed-menu-cap')).length; return withCap === 0 || withCap === groups.length })(),
        }
      }, sel)
      const tag = `${lang} ${w}×${h}`
      await q.click('.ed-logo'); await q.waitForTimeout(150)
      const file = await fit('.ed-file-menu')
      ok(file.noIcon === 0, `${tag}: every File row has an icon (${file.noIcon} without)`)
      ok(file.caps, `${tag}: File captions are all-or-none`)
      ok(file.cut === 0 && !file.xScroll && !file.yScroll, `${tag}: File fits — no cut row, no scrollbar (cut ${file.cut}, x ${file.xScroll}, y ${file.yScroll})`)
      await q.keyboard.press('Escape'); await q.mouse.click(w / 2, h - 40)
      await q.click('.ed-split-caret'); await q.waitForTimeout(150)
      const save = await fit('.ed-save-menu')
      ok(save.cut === 0 && !save.xScroll && !save.yScroll && save.noIcon === 0, `${tag}: Save fits with its icons`)
      await q.click('.ed-split-caret')
      await q.click('.ed-app > .ed-dropdown > .ed-btn'); await q.waitForTimeout(150)
      const help = await fit('.ed-help-menu')
      ok(help.sameLine && help.noIcon === 0 && help.cut === 0 && !help.xScroll, `${tag}: Help rows are icon and label on one line, none cut`)
      await q.mouse.click(w / 2, h - 40)
      await q.click('.ed-topbar [data-cmd="preferences"]'); await q.waitForTimeout(150)
      const pw = await q.$eval('.ed-prefs', (b) => b.getBoundingClientRect().width)
      ok(pw >= 520, `${tag}: Preferences is wide enough for label and control on one line (${Math.round(pw)}px)`)
      await c.close()
    })
  }

  console.log('\n7. Nothing overlaps on the bar\n')
  for (const w of [1280, 768, 390]) {
    await run(async () => {
      const s = await open(w)
      const n = await s.p.evaluate(() => {
        const rs = [...document.querySelectorAll('.ed-topbar .ed-btn, .ed-topbar .ed-logo, .ed-topbar .ed-title')]
          .filter((e) => !e.closest('.ed-menu') && e.offsetParent && getComputedStyle(e).visibility !== 'hidden')
          .map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height)
        let hits = 0
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], b = rs[j]
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits++
        }
        return hits
      })
      ok(n === 0, `${w}px: no two bar controls overlap (${n})`)
      await s.ctx.close()
    })
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
