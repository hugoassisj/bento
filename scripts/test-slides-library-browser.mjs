// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The Library view: components as picture tiles, with real input.
//
//   npm run build:single --prefix slides && node scripts/test-slides-library-browser.mjs
//
// WHAT THIS PROVES:
//   1. the side column has a fourth view, Library, and the four tabs fit at
//      the narrowest the panel may be; the Tokens view lists no components;
//   2. ⌥⌘K switches to the Library and points at the new tile, which holds
//      the main drawn by the deck's renderer (its shapes, its fill);
//   3. an edit to one main re-draws its tile on that doc event; another
//      tile's picture is the same node (node identity, not a re-render);
//   4. the search field filters tiles by name; clearing it brings them back;
//   5. a tile dragged onto the slide drops a copy whose box holds the drop
//      point, in one undo step; dropped inside a frame, the copy is the
//      frame's child;
//   6. a click, or Enter on a focused tile, inserts a copy at the centre;
//      arrow keys move between tiles; each tile is a named option;
//   7. the tile menu has Insert, Go to main component, Rename, Delete;
//   8. ⌘K finds Insert component… (search focused) and Show library;
//   9. a deck with no components says how to make one; a deck with fifty
//      opens the view without a stall, drawing only the tiles in view;
//  10. no page error.
import { fileURLToPath } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const SHELL = process.env.SHELL_HTML || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const run = async (fn) => { try { await fn() } catch (e) { ok(false, `threw: ${String(e.message).split('\n')[0]}`) } }
const rect = (id, x, y, w, h, extra = {}) => ({ id, type: 'shape', shape: 'rect', x, y, w, h, rotation: 0, opacity: 1, fill: '#5e7699', stroke: 'transparent', strokeWidth: 0, radius: 0, ...extra })

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  // never the network: no http(s), no WebSocket, and the app told it is offline
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on'); localStorage.setItem('bento-slideshow-started', '1'); localStorage.setItem('bento-side-view', 'layers') } catch {} })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto('file://' + SHELL)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))
  const load = async (slides) => {
    await p.evaluate((slides) => { const d = JSON.parse(JSON.stringify(window.bento.doc)); d.slides = slides; window.bento.loadDoc(JSON.stringify(d)) }, slides)
    await p.waitForTimeout(400)
  }
  const slide = (id, elements) => ({ id, background: '#ffffff', transition: 'none', notes: '', elements })
  const els = () => p.evaluate(() => JSON.parse(JSON.stringify(window.bento.doc.slides[0].elements)))
  const el = async (id) => (await els()).find((e) => e.id === id)
  const sideView = async (v) => { await p.locator(`.ed-side-tabs [data-view="${v}"]`).click(); await p.waitForTimeout(200) }
  const pick = async (id, shift = false) => {
    const b = await p.locator(`.ed-stage-scale [data-el-id="${id}"]`).first().boundingBox()
    if (shift) await p.keyboard.down('Shift')
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(200)
    if (shift) await p.keyboard.up('Shift')
  }
  const tile = (cid) => p.locator(`.ed-side-library .ed-lib-tile[data-component="${cid}"]`)
  const visibleTiles = () => p.$$eval('.ed-side-library .ed-lib-tile', (ts) => ts.filter((t) => !t.hidden && t.offsetParent).map((t) => t.getAttribute('aria-label')))
  // the fills a tile's picture draws, as the renderer wrote them
  const tileFills = (cid) => p.evaluate((cid) => [...document.querySelectorAll(`.ed-lib-tile[data-component="${cid}"] .ed-lib-pic [fill]`)].map((n) => n.getAttribute('fill').toLowerCase()), cid)
  // a slide point → viewport point
  const toScreen = async (x, y) => p.evaluate(([x, y]) => { const h = document.querySelector('.ed-stage-scale'); const r = h.getBoundingClientRect(); const k = r.width / window.bento.doc.size.width; return { x: r.left + x * k, y: r.top + y * k } }, [x, y])
  const dragTile = async (cid, sx, sy) => {
    const b = await tile(cid).locator('.ed-lib-pic').boundingBox()
    const to = await toScreen(sx, sy)
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.mouse.down()
    await p.mouse.move(to.x, to.y, { steps: 12 }); await p.waitForTimeout(60)
    await p.mouse.up(); await p.waitForTimeout(300)
  }

  console.log('\n1. the view\n')
  await run(async () => {
    const views = await p.$$eval('.ed-side-tabs [data-view]', (bs) => bs.map((b) => b.dataset.view))
    ok(views.join() === 'slides,layers,tokens,library', `the side column has four views (${views.join()})`)
    await sideView('library')
    // the narrowest the panel may be: drag its resizer far past its lower bound
    const rz = await p.locator('.ed-resizer').first().boundingBox()
    await p.mouse.move(rz.x + rz.width / 2, rz.y + 200); await p.mouse.down()
    await p.mouse.move(rz.x - 400, rz.y + 200, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(250)
    const fit = await p.evaluate(() => {
      const bar = document.querySelector('.ed-side-tabs')
      const on = bar.querySelector('[aria-selected="true"] .ed-tab-name')
      return { scroll: bar.scrollWidth, client: bar.clientWidth, side: document.querySelector('.ed-sidebar').getBoundingClientRect().width, name: on.scrollWidth <= on.clientWidth + 1 }
    })
    ok(fit.side < 200, `the panel narrowed to its minimum (${Math.round(fit.side)}px)`)
    ok(fit.name, 'the chosen tab still shows its whole name')
    ok(fit.scroll <= fit.client + 1, `at the narrowest panel the four tabs do not overflow their bar (${fit.scroll} ≤ ${fit.client})`)
    const back = await p.locator('.ed-resizer').first().boundingBox()
    await p.mouse.dblclick(back.x + back.width / 2, back.y + 200); await p.waitForTimeout(250)
  })

  console.log('\n2. create component → Library\n')
  await load([slide('s1', [rect('a', 100, 100, 160, 100), rect('b', 300, 100, 160, 100, { fill: '#ee8844' }), rect('c', 100, 400, 120, 120, { fill: '#33aa66', radius: 60 }),
    rect('row', 600, 300, 600, 200, { fill: '#f4f4f4', layout: { dir: 'row', gap: 20, pad: [20, 20, 20, 20] } }), rect('k1', 620, 320, 160, 160, { parentId: 'row' })])])
  await sideView('layers')
  let compA = '', compC = ''
  await run(async () => {
    await pick('a'); await pick('b', true)
    await p.keyboard.press(`${MOD}+Alt+KeyK`); await p.waitForTimeout(350)
    compA = (await el('a')).component?.id
    ok(!!compA, '⌥⌘K made a component')
    const view = await p.evaluate(() => document.querySelector('.ed-side-tabs [aria-selected="true"]')?.dataset.view)
    ok(view === 'library', `…and switched to the Library (${view})`)
    ok(await tile(compA).evaluate((t) => t.classList.contains('ed-flash') && t.getAttribute('aria-selected') === 'true'), '…pointing at its tile (flashed, the active option)')
    await p.waitForFunction((cid) => document.querySelector(`.ed-lib-tile[data-component="${cid}"] .ed-lib-pic .bento-el`), compA, { timeout: 2000 })
    const n = await tile(compA).locator('.ed-lib-pic .bento-el').count()
    ok(n === 2, `the tile holds the main drawn by the renderer (${n} element nodes)`)
    const fills = await tileFills(compA)
    ok(fills.includes('#5e7699') && fills.includes('#ee8844'), `…in its own colours (${fills.join(' ')})`)
    const pic = await tile(compA).locator('.ed-lib-win').boundingBox()
    ok(pic && pic.width > 40 && pic.height > 8 && Math.abs(pic.width / pic.height - 360 / 100) < 0.2, `…scaled to fit, keeping its shape (${pic && Math.round(pic.width)}×${pic && Math.round(pic.height)})`)
    ok(/Library/.test(await p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')), 'the toast names the Library')
    await p.keyboard.press(`${MOD}+z`); await p.waitForTimeout(250)
    ok(!(await el('a')).component, '⌘Z still undoes the make (the tile was not focused)')
    await p.keyboard.press(`${MOD}+Shift+z`); await p.waitForTimeout(250)
    await sideView('layers')
    await p.keyboard.press('Escape')
    await pick('c')
    await p.keyboard.press(`${MOD}+Alt+KeyK`); await p.waitForTimeout(350)
    compC = (await el('c')).component?.id
    ok(await p.locator('.ed-side-library .ed-lib-tile').count() === 2, 'a second component, a second tile')
    await sideView('tokens')
    ok(await p.locator('.ed-side-tokens [data-component], .ed-side-tokens .ed-component-row').count() === 0, 'the Tokens view no longer lists components')
    await sideView('library')
  })

  console.log('\n3. a main edit re-draws its tile only\n')
  await run(async () => {
    await p.waitForFunction(() => [...document.querySelectorAll('.ed-lib-tile')].every((t) => t.querySelector('.ed-lib-win')), null, { timeout: 2000 })
    await p.evaluate(([a, c]) => {
      document.querySelector(`.ed-lib-tile[data-component="${a}"] .ed-lib-pic`).__mark = 'A'
      document.querySelector(`.ed-lib-tile[data-component="${c}"] .ed-lib-pic`).__mark = 'C'
    }, [compA, compC])
    await sideView('layers')
    await p.locator('.ed-side-layers .ed-layer[data-id="a"]').click(); await p.waitForTimeout(250)
    const hex = p.locator('.ed-props .ed-section[data-key="Fill"] + .ed-section-body .ed-color-hex').first()
    await hex.click(); await hex.fill('aa22cc'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
    ok((await el('a')).fill.toLowerCase() === '#aa22cc', 'the main\'s fill was changed in the inspector')
    await sideView('library')
    const fills = await tileFills(compA)
    ok(fills.includes('#aa22cc') && !fills.includes('#5e7699'), `the main's tile shows the new fill (${fills.join(' ')})`)
    const marks = await p.evaluate(([a, c]) => [document.querySelector(`.ed-lib-tile[data-component="${a}"] .ed-lib-pic`).__mark, document.querySelector(`.ed-lib-tile[data-component="${c}"] .ed-lib-pic`).__mark], [compA, compC])
    ok(marks[0] === undefined, 'its picture is a new node')
    ok(marks[1] === 'C', 'the other tile\'s picture is the same node — not re-rendered')
  })

  console.log('\n4. search\n')
  await run(async () => {
    // name them, in place, under the tile
    await tile(compA).locator('.ed-lib-name').click()
    await p.keyboard.press(`${MOD}+a`); await p.keyboard.type('Stat card'); await p.keyboard.press('Enter'); await p.waitForTimeout(300)
    ok((await el('a')).groupName === 'Stat card', 'a tile\'s name renames the component in place')
    const search = p.locator('.ed-side-library .ed-lib-search')
    await search.fill('STAT'); await p.waitForTimeout(150)
    let shown = await visibleTiles()
    ok(shown.length === 1 && shown[0] === 'Stat card', `typing filters by name, any case (${shown.join(', ')})`)
    await search.fill('zzz'); await p.waitForTimeout(150)
    ok((await visibleTiles()).length === 0 && await p.locator('.ed-lib-empty:not([hidden])').count() === 1, 'no match says so')
    await search.fill(''); await p.waitForTimeout(150)
    shown = await visibleTiles()
    ok(shown.length === 2, `clearing it brings every tile back (${shown.length})`)
  })

  console.log('\n5. drag to place\n')
  await run(async () => {
    const before = (await els()).length
    await dragTile(compA, 400, 600)
    const after = await els()
    const copy = after.filter((e) => e.component?.id === compA && !e.component.main)
    const bx = Math.min(...copy.map((e) => e.x)), by = Math.min(...copy.map((e) => e.y)), br = Math.max(...copy.map((e) => e.x + e.w)), bb = Math.max(...copy.map((e) => e.y + e.h))
    ok(after.length === before + 2 && copy.length === 2, `the drop adds a copy (${after.length - before} elements)`)
    ok(bx <= 400 && br >= 400 && by <= 600 && bb >= 600, `its box holds the drop point (${bx},${by} – ${br},${bb})`)
    ok(Math.abs((bx + br) / 2 - 400) <= 1 && Math.abs((by + bb) / 2 - 600) <= 1, 'centred on it')
    const sel = await p.evaluate(() => window.bento.selection.slice().sort().join())
    ok(sel === copy.map((e) => e.id).sort().join(), 'the copy is selected')
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250)
    ok((await els()).length === before, 'one undo removes it')
    // into a frame
    await dragTile(compC, 900, 400)
    const list = await els()
    const cc = list.filter((e) => e.component?.id === compC && !e.component.main)
    ok(cc.length === 1 && cc[0].parentId === 'row', `dropped inside a frame, the copy is its child (${cc[0]?.parentId})`)
    ok(list.filter((e) => e.parentId === 'row').length === 2, 'the frame lays out both children')
    await p.evaluate(() => window.bento.undo()); await p.waitForTimeout(250)
    ok(!(await els()).some((e) => e.component?.id === compC && !e.component.main), 'one undo takes the framed copy back out too')
    // dropped off the canvas: nothing
    const lb = await p.locator('.ed-side-library').boundingBox()
    const t = await tile(compA).locator('.ed-lib-pic').boundingBox()
    const n0 = (await els()).length
    await p.mouse.move(t.x + 10, t.y + 10); await p.mouse.down(); await p.mouse.move(lb.x + 20, lb.y + lb.height - 10, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(250)
    ok((await els()).length === n0, 'a drag dropped back on the panel places nothing')
  })

  console.log('\n6. click, Enter, arrows\n')
  await run(async () => {
    const size = await p.evaluate(() => window.bento.doc.size)
    const pre = await els()
    let n0 = pre.length
    // where Insert put a copy: the slide's centre, stepped 32px down-right while it covers something
    const m = pre.find((e) => e.id === 'c')
    let ex = Math.round((size.width - m.w) / 2), ey = Math.round((size.height - m.h) / 2)
    const hit = (o) => ex < o.x + o.w && o.x < ex + m.w && ey < o.y + o.h && o.y < ey + m.h
    for (let i = 0; i < 24 && pre.some(hit); i++) { ex += 32; ey += 32 }
    await tile(compC).locator('.ed-lib-pic').click(); await p.waitForTimeout(300)
    let cc = (await els()).filter((e) => e.component?.id === compC && !e.component.main)
    ok((await els()).length === n0 + 1 && cc.length === 1, 'a click inserts a copy')
    const c0 = cc[0]
    ok(c0.x === ex && c0.y === ey, `where Insert put it: the slide's centre, clear of what is there (${c0.x},${c0.y}, expected ${ex},${ey})`)
    const role = await p.evaluate(() => { const g = document.querySelector('.ed-lib-grid'); return [g.getAttribute('role'), [...g.querySelectorAll('.ed-lib-tile')].map((t) => `${t.getAttribute('role')}:${t.getAttribute('aria-label')}`)] })
    ok(role[0] === 'listbox' && role[1].every((r) => /^option:.+/.test(r)), `the tiles are named options in a listbox (${role[1].join(' | ')})`)
    await tile(compA).focus()
    await p.keyboard.press('ArrowRight'); await p.waitForTimeout(80)
    let focused = await p.evaluate(() => document.activeElement?.dataset.component)
    ok(focused === compC, 'ArrowRight moves to the next tile')
    await p.keyboard.press('ArrowLeft'); await p.waitForTimeout(80)
    focused = await p.evaluate(() => document.activeElement?.dataset.component)
    ok(focused === compA, 'ArrowLeft moves back')
    const tabbable = await p.$$eval('.ed-lib-tile', (ts) => ts.filter((t) => t.tabIndex === 0).length)
    ok(tabbable === 1, 'one tile is the Tab stop (roving tabindex)')
    n0 = (await els()).length
    await p.keyboard.press('Enter'); await p.waitForTimeout(300)
    ok((await els()).length === n0 + 2, 'Enter on a focused tile inserts a copy')
  })

  console.log('\n7. the tile menu\n')
  await run(async () => {
    await tile(compC).click({ button: 'right' }); await p.waitForTimeout(200)
    const items = await p.$$eval('.ed-ctxmenu .ed-ctxmenu-item', (r) => r.map((x) => x.textContent.trim()))
    ok(['Insert', 'Go to main component', 'Rename', 'Delete'].every((l) => items.some((i) => i.startsWith(l))), `right-click: ${items.join(' | ')}`)
    await p.locator('.ed-ctxmenu .ed-ctxmenu-item', { hasText: /^Go to main/ }).click(); await p.waitForTimeout(250)
    ok(await p.evaluate(() => window.bento.selection.join()) === 'c', 'Go to main component selects the main')
  })

  console.log('\n8. ⌘K\n')
  await run(async () => {
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur())
    await p.keyboard.press(`${MOD}+k`); await p.waitForTimeout(150)
    await p.keyboard.type('insert component'); await p.waitForTimeout(150)
    const rows = await p.$$eval('.ed-cmdk-overlay [role="option"], .ed-cmdk-overlay li', (r) => r.map((x) => x.textContent))
    ok(rows.some((r) => /Insert component…/.test(r)), `⌘K lists Insert component… (${rows.slice(0, 3).join(' | ')})`)
    await p.keyboard.press('Enter'); await p.waitForTimeout(250)
    ok(await p.evaluate(() => document.activeElement?.classList.contains('ed-lib-search')), '…which opens the Library with the search field focused')
    await p.keyboard.press('Escape'); await p.evaluate(() => document.activeElement?.blur())
    await sideView('layers')
    await p.keyboard.press(`${MOD}+k`); await p.waitForTimeout(150)
    await p.keyboard.type('show library'); await p.waitForTimeout(150)
    await p.keyboard.press('Enter'); await p.waitForTimeout(200)
    ok(await p.evaluate(() => document.querySelector('.ed-side-tabs [aria-selected="true"]')?.dataset.view) === 'library', 'Show library opens the view')
  })

  console.log('\n9. empty, and fifty\n')
  await run(async () => {
    await load([slide('s1', [rect('x', 100, 100, 100, 100)])])
    await sideView('library')
    const empty = await p.evaluate(() => { const e = document.querySelector('.ed-lib-empty'); return e && !e.hidden ? e.textContent : '' })
    ok(/Create component/.test(empty) && /K/.test(empty), `an empty Library says how to make one, with the shortcut ("${empty}")`)
    ok(await p.locator('.ed-lib-search:not([hidden])').count() === 0, '…and shows no search field')
    await sideView('layers')
    // fifty mains, each a card and a label
    const many = []
    for (let i = 0; i < 50; i++) {
      const x = 20 + (i % 10) * 120, y = 20 + Math.floor(i / 10) * 130
      many.push(rect(`m${i}`, x, y, 100, 60, { groupId: `g${i}`, groupName: `Card ${i}`, component: { id: `comp${i}`, key: 'k0', main: true } }))
      many.push({ id: `t${i}`, type: 'text', x, y: y + 64, w: 100, h: 30, rotation: 0, opacity: 1, html: `Label ${i}`, fontSize: 14, groupId: `g${i}`, groupName: `Card ${i}`, component: { id: `comp${i}`, key: 'k1', main: true } })
    }
    await load([slide('s1', many)])
    const ms = await p.evaluate(() => {
      const t0 = performance.now()
      document.querySelector('.ed-side-tabs [data-view="library"]').click()
      void document.querySelector('.ed-side-library').offsetHeight
      return performance.now() - t0
    })
    await p.waitForTimeout(300)
    const tiles = await p.locator('.ed-side-library .ed-lib-tile').count()
    const drawn = await p.locator('.ed-side-library .ed-lib-win').count()
    ok(tiles === 50, `fifty components, fifty tiles (${tiles})`)
    ok(ms < 150, `opening the view takes ${ms.toFixed(1)} ms (under 150)`)
    ok(drawn > 0 && drawn < 50, `only the tiles in view are drawn (${drawn} of 50)`)
    await p.locator('.ed-side-library .ed-lib-tile').last().scrollIntoViewIfNeeded(); await p.waitForTimeout(300)
    ok(await p.locator('.ed-side-library .ed-lib-tile').last().locator('.ed-lib-pic .bento-el').count() === 2, 'a tile scrolled into view is drawn')
  })

  ok(errors.length === 0, `no page error${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
