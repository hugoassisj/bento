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
//   9. The element menu's Arrange ▸ submenu (DS-10): every align, distribute
//      and size action and Tidy up in words, each with its icon and keys; it
//      opens and closes by mouse and by keyboard (→ ← Esc) and its rows are
//      menu items; a click never shuts what a hover opened; on a 390px phone,
//      by touch or mouse, it takes the menu's place and the tap that opened it
//      runs nothing; ← → never nudge the selection behind a menu; rows that
//      cannot apply are disabled and say why; Tidy up
//      squares a row and a 2×3 scatter in one undo step with no frame, its
//      toast's Use auto layout wraps exactly as ⇧A does, a title over its cards
//      settles on the slide in one run, a selection too big for the slide does
//      not move and the toast says so, and a frame's children are never moved
//      by it.
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
  console.log('\n9. Arrange ▸ in the element menu\n')
  // several run() blocks, so one failure does not hide the rest
  {
    // its own contexts, sealed: no WebSocket reaches a host and the deck stays
    // offline (a loaded deck may carry a live session), every http(s) aborted
    const sealed = async (width, height, touch = false) => {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch })
      await ctx.addInitScript(() => { try { localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-offline', 'on') } catch {} })
      if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
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
    let s = null
    let q = null
    let blank = { x: 250, y: 600 } // the grey surround; the toast docks at the canvas top
    // a desktop page, opened once and reopened if a block before lost it
    const desk = async () => { if (!q || q.isClosed()) { s = await sealed(1440, 900); q = s.p; blank = { x: 250, y: 600 } } }
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
    const rect = (id, x, y, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w: 200, h: 120, fill: '#88aadd', ...extra })
    const load = async (elements) => {
      await q.evaluate((els) => window.bento.loadDoc(JSON.stringify({ compact: true, slides: [{ id: 's1', elements: els }] })), elements)
      await q.waitForTimeout(300)
      await q.mouse.click(blank.x, blank.y); await q.keyboard.press('Escape'); await q.keyboard.press('Escape')
    }
    const els = () => q.evaluate(() => window.bento.doc.slides[0].elements.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, parentId: e.parentId, layout: !!e.layout })))
    const centre = (id) => q.evaluate((id) => { const r = document.querySelector(`.ed-stage-scale [data-el-id="${id}"]`).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, id)
    // shift-clicks, a frame apart (a selection change re-targets the control
    // box a frame later); checked, and tried once more if a click went astray
    const pick = async (ids) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        await q.mouse.click(blank.x, blank.y); await q.keyboard.press('Escape'); await q.waitForTimeout(150)
        for (const [i, id] of ids.entries()) {
          const c = await centre(id)
          if (i) await q.keyboard.down('Shift')
          await q.mouse.click(c.x, c.y)
          if (i) await q.keyboard.up('Shift')
          await q.waitForTimeout(80)
        }
        await q.waitForTimeout(100)
        if ((await q.evaluate(() => window.bento.selection)).sort().join() === [...ids].sort().join()) return
      }
    }
    const menuOn = async (id) => {
      const c = await centre(id)
      await q.mouse.click(c.x, c.y, { button: 'right' }); await q.waitForTimeout(150)
    }
    const subRows = () => q.$$eval('#ed-ctxmenu-sub .ed-ctxmenu-item', (bs) => bs.map((b) => ({ cmd: b.dataset.cmd ?? '', role: b.getAttribute('role'), text: b.querySelector('.ed-ctxmenu-label')?.textContent ?? '', icon: !!b.querySelector('.ed-ctxmenu-icon svg'), keys: b.querySelector('kbd')?.textContent ?? '', off: b.disabled, title: b.title })))
    const hoverArrange = async () => {
      const b = await q.$('.ed-ctxmenu-parent')
      const r = await b.boundingBox()
      await q.mouse.move(r.x + 12, r.y + r.height / 2); await q.waitForTimeout(150)
    }
    const closeAll = async () => { await q.mouse.move(5, 895); await q.keyboard.press('Escape'); await q.keyboard.press('Escape') }

    const three = [rect('a', 100, 200), rect('b', 340, 210), rect('c', 610, 195)]
    await run(async () => {
    await desk()
    // a. three rough boxes: every action, in words, with icon and keys
    await load(three)
    await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
    await menuOn('b')
    const parent = await q.$eval('.ed-ctxmenu-parent', (b) => ({ text: b.textContent, pop: b.getAttribute('aria-haspopup'), exp: b.getAttribute('aria-expanded'), role: b.getAttribute('role') }))
    ok(/Arrange/.test(parent.text) && parent.pop === 'menu' && parent.exp === 'false' && parent.role === 'menuitem', `the menu has an Arrange row that opens a submenu (${JSON.stringify(parent)})`)
    await hoverArrange()
    ok(await q.$eval('#ed-ctxmenu-sub', (m) => m.getAttribute('role')) === 'menu' && await q.$eval('.ed-ctxmenu-parent', (b) => b.getAttribute('aria-expanded')) === 'true', 'hover opens it, as a menu, and the row says it is expanded')
    await q.click('.ed-ctxmenu-parent'); await q.waitForTimeout(100)
    ok(!!(await q.$('#ed-ctxmenu-sub')), 'a click after the hover keeps it open (a click only opens)')
    const side = await q.evaluate(() => { const r = document.querySelector('.ed-ctxmenu-parent').getBoundingClientRect(), m = document.querySelector('#ed-ctxmenu-sub').getBoundingClientRect(); return { rowRight: r.right, subLeft: m.left } })
    ok(side.subLeft >= side.rowRight, `beside the row, never over it (${Math.round(side.rowRight)} → ${Math.round(side.subLeft)})`)
    const rows = await subRows()
    const want = ['align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-x', 'distribute-y', 'match-width', 'match-height', 'tidy-up']
    ok(want.every((c) => rows.some((r) => r.cmd === c)), `every align, distribute and size action and Tidy up (${rows.map((r) => r.cmd).join(', ')})`)
    ok(rows.every((r) => r.role === 'menuitem' && r.icon && r.text.length > 3), 'each row is a menu item with an icon and words')
    ok(['Distribute horizontally', 'Distribute vertically', 'Same width', 'Same height', 'Tidy up'].every((w) => rows.some((r) => r.text === w)), 'in the words of the issue')
    ok(rows.find((r) => r.cmd === 'align-left').keys === '⌥A' && rows.find((r) => r.cmd === 'distribute-x').keys === '⌃⌥H', 'rows show their shortcut from the command list')
    ok(rows.every((r) => !r.off), 'three free boxes: every row enabled')
    const tips = await q.$$eval('.ed-layer-block .ed-toolbar button', (bs) => bs.map((b) => b.title || b.dataset.hint || ''))
    ok(['Distribute horizontally', 'Distribute vertically', 'Same width', 'Same height', 'Align left'].every((w) => tips.some((x) => x.startsWith(w))), 'the Format tab’s icons carry the same words')

    // b. the keyboard: Esc closes the submenu first; ↓ walks, → opens, ← closes
    await q.keyboard.press('Escape'); await q.waitForTimeout(80)
    ok(!(await q.$('#ed-ctxmenu-sub')) && !!(await q.$('.ed-ctxmenu')), 'Escape closes the submenu, not the menu')
    await q.keyboard.press('Escape'); await q.waitForTimeout(80)
    ok(!(await q.$('.ed-ctxmenu')), '…and a second Escape the menu')
    await menuOn('b')
    // ← and → with nothing focused, then on a row that opens nothing: swallowed
    await q.keyboard.press('ArrowRight'); await q.keyboard.press('ArrowLeft')
    await q.keyboard.press('ArrowDown'); await q.keyboard.press('ArrowRight'); await q.keyboard.press('ArrowLeft'); await q.keyboard.press('ArrowUp')
    ok(!!(await q.$('.ed-ctxmenu')) && JSON.stringify((await els()).map((e) => [e.x, e.y])) === JSON.stringify(three.map((e) => [e.x, e.y])), '← and → that open nothing do not nudge the selection either')
    let steps = 0
    while (steps++ < 30 && !(await q.evaluate(() => document.activeElement?.classList.contains('ed-ctxmenu-parent')))) await q.keyboard.press('ArrowDown')
    ok(steps < 30, `↓ walks the rows to Arrange (${steps} presses)`)
    const before = await els()
    ok(JSON.stringify(before.map((e) => [e.x, e.y])) === JSON.stringify(three.map((e) => [e.x, e.y])), 'the arrows did not nudge the selection behind the menu')
    await q.keyboard.press('ArrowRight'); await q.waitForTimeout(80)
    ok(await q.evaluate(() => document.activeElement?.dataset.cmd) === 'align-left', '→ opens the submenu on its first row')
    await q.keyboard.press('ArrowLeft'); await q.waitForTimeout(80)
    ok(!(await q.$('#ed-ctxmenu-sub')) && await q.evaluate(() => document.activeElement?.classList.contains('ed-ctxmenu-parent')), '← closes it, back on Arrange')
    await q.keyboard.press('ArrowRight')
    steps = 0
    while (steps++ < 20 && await q.evaluate(() => document.activeElement?.dataset.cmd) !== 'tidy-up') await q.keyboard.press('ArrowDown')
    const n0 = (await els()).length
    await q.keyboard.press('Enter'); await q.waitForTimeout(250)

    // c. Tidy up on a rough row
    const after = await els()
    const ys = after.map((e) => e.y)
    const sorted = [...after].sort((m, n) => m.x - n.x)
    const gaps = sorted.slice(1).map((e, i) => e.x - (sorted[i].x + sorted[i].w))
    ok(!(await q.$('.ed-ctxmenu')), 'Enter on Tidy up ran it and closed the menu')
    ok(ys.every((y) => y === ys[0]), `a common top edge (${ys.join(', ')})`)
    ok(gaps.every((g) => Math.abs(g - gaps[0]) <= 1), `equal gaps within 1px (${gaps.join(', ')})`)
    ok(after.length === n0 && !after.some((e) => e.layout || e.parentId), 'no frame was created')
    const toast = await q.$eval('.ed-toast', (t) => t.textContent).catch(() => '')
    ok(/Tidied\. Keep it tidy\?/.test(toast) && /Use auto layout/.test(toast), `the toast offers auto layout (${toast})`)
    await q.keyboard.press(`${mod}+z`); await q.waitForTimeout(150)
    ok(JSON.stringify((await els()).map((e) => [e.x, e.y])) === JSON.stringify(three.map((e) => [e.x, e.y])), 'one ⌘Z puts all three back')
    await q.keyboard.press(`${mod}+Shift+z`); await q.waitForTimeout(150)

    })

    await run(async () => {
    await desk()
    await load(three)
    // d. the toast's Use auto layout is ⇧A on the same elements
    const norm = (list) => JSON.stringify(list.map((e) => ({ ...e, id: e.layout ? 'F' : e.id, parentId: e.parentId ? 'F' : undefined })))
    await pick(['a', 'b', 'c'])
    const sel3 = (await q.evaluate(() => window.bento.selection)).sort().join()
    await q.keyboard.press(`${mod}+k`); await q.keyboard.type('Tidy up'); await q.keyboard.press('Enter')
    await q.waitForSelector('.ed-toast.show .ed-toast-act', { timeout: 3000 }); await q.waitForTimeout(300) // let it settle in
    await q.click('.ed-toast-act', { timeout: 5000 }); await q.waitForTimeout(250)
    const viaToast = await els()
    ok(viaToast.some((e) => e.layout) && viaToast.filter((e) => e.parentId).length === 3, `Use auto layout wrapped the three in a frame (selected ${sel3})`)
    await q.keyboard.press(`${mod}+z`); await q.waitForTimeout(150)
    await pick(['a', 'b', 'c'])
    await q.keyboard.press('Shift+A'); await q.waitForTimeout(250)
    ok(norm(await els()) === norm(viaToast), 'exactly as ⇧A wraps the same selection')

    })

    await run(async () => {
    await desk()
    // e. rows that cannot apply say why
    await load(three)
    await pick(['a', 'b'])
    await menuOn('a'); await hoverArrange()
    let two = await subRows()
    const dx = two.find((r) => r.cmd === 'distribute-x')
    ok(dx.off && /3 or more/.test(dx.title), `two selected: Distribute is disabled and says why (${dx.title})`)
    ok(!two.find((r) => r.cmd === 'match-width').off && !two.find((r) => r.cmd === 'tidy-up').off, '…Same width and Tidy up are not')
    await closeAll()
    await pick(['a'])
    await menuOn('a'); await hoverArrange()
    two = await subRows()
    const mw = two.find((r) => r.cmd === 'match-width')
    ok(mw.off && /2 or more/.test(mw.title) && !two.find((r) => r.cmd === 'align-left').off, `one selected: Same width disabled (${mw.title}), align to the slide still on`)
    await closeAll()

    })

    await run(async () => {
    await desk()
    // f. a 2×3 scatter becomes a 2×3 grid, by mouse
    await load([rect('g1', 100, 100), rect('g2', 345, 112), rect('g3', 610, 95), rect('g4', 108, 285), rect('g5', 330, 300), rect('g6', 598, 290)])
    await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
    await menuOn('g2'); await hoverArrange()
    await q.click('#ed-ctxmenu-sub [data-cmd="tidy-up"]'); await q.waitForTimeout(250)
    const g = Object.fromEntries((await els()).map((e) => [e.id, e]))
    const rowsY = new Set(Object.values(g).map((e) => e.y)), colsX = new Set(Object.values(g).map((e) => e.x))
    ok(rowsY.size === 2 && colsX.size === 3, `a 2×3 grid (${rowsY.size} rows × ${colsX.size} columns)`)
    const colGaps = [g.g2.x - (g.g1.x + g.g1.w), g.g3.x - (g.g2.x + g.g2.w), g.g5.x - (g.g4.x + g.g4.w), g.g6.x - (g.g5.x + g.g5.w)]
    const rowGaps = [g.g4.y - (g.g1.y + g.g1.h), g.g5.y - (g.g2.y + g.g2.h), g.g6.y - (g.g3.y + g.g3.h)]
    ok(colGaps.every((v) => Math.abs(v - colGaps[0]) <= 1) && rowGaps.every((v) => Math.abs(v - rowGaps[0]) <= 1), `equal column gaps (${colGaps.join(', ')}) and row gaps (${rowGaps.join(', ')})`)

    })

    await run(async () => {
    await desk()
    // f2. an ordinary slide — a title over three cards — tidies into two lines
    // on the slide by the menu, and a second run moves nothing; two photos too
    // big for any arrangement do not move, and the toast says so
    const box = (id, x, y, w, h) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, fill: '#88aadd' })
    await load([box('t', 90, 50, 1100, 90), box('c1', 80, 175, 340, 440), box('c2', 465, 190, 340, 440), box('c3', 870, 182, 340, 440)])
    await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
    await menuOn('c2'); await hoverArrange()
    await q.click('#ed-ctxmenu-sub [data-cmd="tidy-up"]'); await q.waitForTimeout(250)
    const t1 = await els()
    const onSlide = (list) => list.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 1280 && e.y + e.h <= 720)
    ok(onSlide(t1) && t1.slice(1).every((e) => e.y === t1[1].y) && t1[0].y + t1[0].h < t1[1].y, `a title over three cards: two lines, on the slide (${t1.map((e) => `${e.x},${e.y}`).join(' · ')})`)
    await q.keyboard.press(`${mod}+k`); await q.keyboard.type('Tidy up'); await q.keyboard.press('Enter'); await q.waitForTimeout(250)
    ok(JSON.stringify(await els()) === JSON.stringify(t1), 'a second Tidy up moves nothing')
    const photos = [box('p1', 100, 50, 800, 600), box('p2', 380, 80, 800, 600)]
    await load(photos)
    await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
    await q.keyboard.press(`${mod}+k`); await q.keyboard.type('Tidy up'); await q.keyboard.press('Enter')
    await q.waitForSelector('.ed-toast.show', { timeout: 3000 })
    const said = await q.$eval('.ed-toast', (t) => ({ text: t.textContent, act: !!t.querySelector('.ed-toast-act') }))
    ok(/Too much to tidy on this slide/.test(said.text) && !/Tidied/.test(said.text) && !said.act, `two 800×600 photos: the toast says there is too much (${said.text})`)
    ok(JSON.stringify((await els()).map((e) => [e.x, e.y])) === JSON.stringify(photos.map((e) => [e.x, e.y])), '…and nothing moved')
    })

    await run(async () => {
    await desk()
    // g. a frame's children are the frame's: never moved by Tidy up
    await load([
      { id: 'f', type: 'shape', shape: 'rect', x: 100, y: 150, w: 700, h: 160, fill: '#eeeeee', layout: { dir: 'row', gap: 24, pad: [16, 16, 16, 16], hug: true } },
      rect('k1', 116, 166, { parentId: 'f' }), rect('k2', 340, 166, { parentId: 'f' }), rect('k3', 564, 166, { parentId: 'f' }),
      rect('loose', 300, 450),
    ])
    const kids0 = JSON.stringify((await els()).filter((e) => e.parentId))
    for (const [i, id] of ['k1', 'k2'].entries()) {
      const c = await centre(id)
      await q.keyboard.down(mod); if (i) await q.keyboard.down('Shift')
      await q.mouse.click(c.x, c.y)
      if (i) await q.keyboard.up('Shift'); await q.keyboard.up(mod)
    }
    await q.waitForTimeout(100)
    const picked = await q.evaluate(() => window.bento.selection)
    ok(picked.length >= 1 && picked.every((id) => /^k/.test(id)), `frame children selected (${picked.join(', ')})`)
    await menuOn(picked[0]); await hoverArrange()
    const fr = await subRows()
    ok(fr[0].off && /Placed by its frame/.test(fr[0].text) && fr[1].text === 'Select the frame' && !fr[1].off, 'the submenu opens with the frame’s explanation and Select the frame')
    ok(fr.filter((r) => r.cmd).every((r) => r.off && /frame/.test(r.title)), 'every action row is disabled, saying the frame places it')
    const box = await q.$eval('#ed-ctxmenu-sub', (m) => { const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight } })
    ok(box.top >= 0 && box.bottom <= box.h, `the long submenu stays on the screen (${Math.round(box.top)}–${Math.round(box.bottom)} of ${box.h})`)
    await closeAll()
    await q.keyboard.press(`${mod}+k`); await q.keyboard.type('Tidy up'); await q.waitForTimeout(100)
    ok(!(await q.$$eval('.ed-cmdk-list li', (l) => l.map((x) => x.dataset.cmd))).includes('tidy-up'), '⌘K does not offer Tidy up for them')
    await q.keyboard.press('Escape')
    ok(JSON.stringify((await els()).filter((e) => e.parentId)) === kids0, 'the frame’s children did not move')

    })
    await run(async () => {
      ok(!!s && s.errors.length === 0, `no page errors${s?.errors.length ? ': ' + s.errors.join(' | ') : ''}`)
      if (q && !q.isClosed()) await s.ctx.close()
    })

    // h. a phone: no room beside the menu, so the submenu takes its place —
    // on a tap or click only, and the gesture that opened it runs nothing
    for (const touch of [true, false]) await run(async () => {
      const how = touch ? '390px, touch' : '390px, mouse'
      s = await sealed(390, 844, touch)
      q = s.p
      blank = await q.evaluate(() => { const r = document.querySelector('.ed-scroll').getBoundingClientRect(); return { x: r.left + 10, y: r.bottom - 120 } })
      const row3 = [rect('a', 100, 200), rect('b', 400, 210), rect('c', 700, 195)]
      await load(row3)
      await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
      const tap = (x, y) => (touch ? q.touchscreen.tap(x, y) : q.mouse.click(x, y))
      const arrangeRect = async () => (await q.$('.ed-ctxmenu-parent')).boundingBox()
      for (const where of ['right', 'left']) {
        await menuOn('b')
        const r = await arrangeRect()
        const x = where === 'right' ? r.x + r.width - 12 : r.x + 12
        if (!touch) { await q.mouse.move(x, r.y + r.height / 2); await q.waitForTimeout(120) }
        if (!touch) ok(!(await q.$('#ed-ctxmenu-sub')), `${how}: hovering Arrange opens nothing over the pointer`)
        await tap(x, r.y + r.height / 2); await q.waitForTimeout(200)
        const st = await q.evaluate(() => {
          const m = document.querySelector('#ed-ctxmenu-sub'), root = document.querySelector('.ed-ctxmenu:not(#ed-ctxmenu-sub)')
          const b = m?.getBoundingClientRect()
          return { open: !!m, back: m?.querySelector('.ed-ctxmenu-back')?.textContent ?? '', rootHidden: root ? getComputedStyle(root).visibility === 'hidden' : null, onScreen: !!b && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight }
        })
        ok(st.open && st.rootHidden && /Arrange/.test(st.back) && st.onScreen, `${how}, tap on the ${where} of Arrange: the submenu takes the menu's place, headed by a row back (${JSON.stringify(st)})`)
        ok(JSON.stringify((await els()).map((e) => [e.x, e.y])) === JSON.stringify(row3.map((e) => [e.x, e.y])), `${how}: the tap that opened it ran nothing`)
        const back = await (await q.$('.ed-ctxmenu-back')).boundingBox()
        await tap(back.x + 20, back.y + back.height / 2); await q.waitForTimeout(150)
        ok(!(await q.$('#ed-ctxmenu-sub')) && await q.evaluate(() => getComputedStyle(document.querySelector('.ed-ctxmenu')).visibility) !== 'hidden', `${how}: the row back brings the menu back`)
        await closeAll()
      }
      await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
      await menuOn('b')
      const r = await arrangeRect()
      await tap(r.x + r.width / 2, r.y + r.height / 2); await q.waitForTimeout(200)
      const al = await (await q.$('#ed-ctxmenu-sub [data-cmd="align-top"]')).boundingBox()
      await tap(al.x + al.width / 2, al.y + al.height / 2); await q.waitForTimeout(200)
      ok(!(await q.$('.ed-ctxmenu')) && (await els()).every((e) => e.y === 195), `${how}: a tap on a row of it runs that row (Align top: y ${(await els()).map((e) => e.y).join(', ')})`)
      // a title over its cards, tidied from the submenu by tap: on the slide, settled
      await load([rect('t', 90, 50, { w: 1100, h: 90 }), rect('c1', 80, 175, { w: 340, h: 440 }), rect('c2', 465, 190, { w: 340, h: 440 }), rect('c3', 870, 182, { w: 340, h: 440 })])
      await q.keyboard.press(`${mod}+a`); await q.waitForTimeout(100)
      await menuOn('c2')
      const ar = await arrangeRect()
      await tap(ar.x + ar.width / 2, ar.y + ar.height / 2); await q.waitForTimeout(200)
      const td = await (await q.$('#ed-ctxmenu-sub [data-cmd="tidy-up"]')).boundingBox()
      await tap(td.x + td.width / 2, td.y + td.height / 2); await q.waitForTimeout(250)
      const tl = await els()
      ok(tl.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.w <= 1280 && e.y + e.h <= 720) && tl.slice(1).every((e) => e.y === tl[1].y), `${how}: Tidy up by tap puts a title over its cards on the slide (${tl.map((e) => `${e.x},${e.y}`).join(' · ')})`)
      await q.keyboard.press(`${mod}+k`); await q.keyboard.type('Tidy up'); await q.keyboard.press('Enter'); await q.waitForTimeout(250)
      ok(JSON.stringify(await els()) === JSON.stringify(tl), `${how}: …settled in one run`)
      ok(s.errors.length === 0, `${how}: no page errors${s.errors.length ? ': ' + s.errors.join(' | ') : ''}`)
      await s.ctx.close()
    })
  }
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
