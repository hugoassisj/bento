// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// window.bento.outline(), patch() and stats() in the packaged shell.
//
// The format side (slides/src/ops.ts, outline.ts) is held by
// scripts/test-slides-ops.ts in node. This holds what only the running
// editor can show: the surface exists; a patch lands as ONE undo step and
// one undo() restores the document byte for byte; a dry run and a refused
// patch change neither the document nor the undo history; the editor keeps
// its slide (a commit, not a document swap) and draws the new words; the
// real DOM sanitizers keep hostile markup out of the stored document and
// nothing executes; text inserted without a height is measured on the
// deck's fonts; a deck carrying sharing keys never shows them in an outline;
// the stale-edit guard and a retried patch.
//
// The network is closed: http(s) aborted, WebSockets answered by a closed
// mock, offline mode on before the page loads.
//
// Run: (cd slides && npm run build:single) && node scripts/test-slides-patch-api-browser.mjs
// (BENTO_SHELL=<path> runs it against another build, e.g. the parent commit's.)
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const shellPath = process.env.BENTO_SHELL || fileURLToPath(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url))
const shell = readFileSync(shellPath, 'utf8')
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'bento-patch-api-')))
const re = /(<script type="application\/bento\+json" id="bento-doc">)([\s\S]*?)(<\/script>)/
if (!re.test(shell)) throw new Error('no bento-doc block in ' + shellPath)
const withDoc = (doc) => shell.replace(re, (_, a, _b, c) => a + JSON.stringify(doc).replace(/</g, '\\u003c') + c)

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
let sockets = 0
async function open(file) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => { sockets++; ws.close() })
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch { /* storage off */ } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('file://' + file)
  await page.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-topbar'), null, { timeout: 30000 })
  await page.waitForTimeout(600)
  return { ctx, page, errors }
}
const snap = (page) => page.evaluate(() => JSON.stringify(window.bento.doc))

try {
  const plain = join(scratch, 'starter.bento.html')
  writeFileSync(plain, shell)

  console.log('\nthe surface')
  {
    const { ctx, page, errors } = await open(plain)
    const has = await page.evaluate(() => ['outline', 'patch', 'stats'].map((k) => typeof window.bento[k]))
    ok(has.every((t) => t === 'function'), `window.bento has outline, patch and stats (${has.join(', ')})`)
    if (has.every((t) => t === 'function')) {
      const o = await page.evaluate(() => window.bento.outline())
      const st = await page.evaluate(() => window.bento.stats())
      ok(Buffer.byteLength(o) < 15000 && o.includes('1/sd-title title'), `outline() of the starter: ${Buffer.byteLength(o)} B, addressed`)
      ok(st.slides === 19 && st.bytes > 100000 && o.includes(`hash ${st.hash}`) && st.outlineBytes === o.length, `stats(): ${st.slides} slides, ${st.bytes} B, the outline's hash`)

      console.log('\none patch, one undo step')
      // a fresh page has no history: undo() is the control
      const j0 = await snap(page)
      await page.evaluate(() => window.bento.undo())
      ok(await snap(page) === j0, 'control: undo() on a fresh deck changes nothing')
      const dry = await page.evaluate(() => window.bento.patch([{ op: 'edits', id: '1/sd-title', text: 'X' }], { dryRun: true }))
      ok(dry.ok && dry.dryRun && !dry.committed && dry.replies[0].ok, 'a dry run reports the edit')
      ok(await snap(page) === j0, 'a dry run leaves the document as it was')
      await page.evaluate(() => window.bento.undo())
      ok(await snap(page) === j0, 'and leaves no undo step behind')
      const refused = await page.evaluate(() => window.bento.patch([{ op: 'edits', id: '1/sd-title', text: 'X' }, { op: 'edits', id: '1/no-such', text: 'Y' }]))
      ok(refused.ok && !refused.committed && refused.skipped.length === 1 && refused.skipped[0].i === 1, 'a patch with a refused op commits nothing and says which op')
      await page.evaluate(() => window.bento.undo())
      ok(await snap(page) === j0, 'a refused patch leaves no undo step either')

      // the editor on slide 5 while the agent edits slide 1: a commit keeps the view
      await page.evaluate(() => document.querySelectorAll('.ed-thumb')[4].click())
      await page.waitForTimeout(200)
      const real = await page.evaluate(() => window.bento.patch([{ op: 'edits', id: '1/sd-title', text: 'X marks the spot' }], { outline: true }))
      ok(real.ok && real.committed && real.dryRun === undefined, 'the patch commits')
      ok(real.replies[0].op === dry.replies[0].op, `the dry run named the same op (${real.replies[0].op})`)
      ok(/1\/sd-title title "X marks the spot"/.test(real.outline ?? ''), 'with { outline: true } the report shows the touched slide after')
      const active = await page.evaluate(() => document.querySelector('.ed-thumb.active')?.dataset.index)
      ok(active === '4', `the editor stays on the slide it was on (active thumb ${active})`)
      const j1 = await snap(page)
      const els = (j) => JSON.parse(j).slides.flatMap((s, si) => s.elements.map((e) => [`${si}/${e.id}`, JSON.stringify(e)]))
      const a = new Map(els(j0)), b = new Map(els(j1))
      const changed = [...a].filter(([k, v]) => b.get(k) !== v).map(([k]) => k)
      ok(changed.length === 1 && changed[0] === '0/sd-title', `only that element changed (${changed.join(', ')})`)
      await page.evaluate(() => document.querySelectorAll('.ed-thumb')[0].click())
      await page.waitForTimeout(300)
      const drawn = await page.evaluate(() => document.querySelector('.ed-stage-scale [data-el-id="sd-title"]')?.textContent ?? '')
      ok(drawn.includes('X marks the spot'), `the canvas draws the new words ("${drawn.slice(0, 30)}")`)
      await page.evaluate(() => window.bento.undo())
      ok(await snap(page) === j0, 'one undo() restores the document byte for byte')
      await page.evaluate(() => window.bento.redo())
      ok(await snap(page) === j1, 'and redo() brings the patch back')
      await page.evaluate(() => window.bento.undo())

      console.log('\nstructure, measurement, the stale guard')
      const base = (await page.evaluate(() => window.bento.stats())).hash
      const add = await page.evaluate((b) => window.bento.patch([
        { op: 'add', after: 2, from: 2, id: 'agent-copy', title: 'Made by a patch' },
        { op: 'insert', slide: 'agent-copy', type: 'text', id: 'agent-note', md: 'One line that wraps onto a second line in a narrow box, measured on the deck fonts.', x: 96, y: 560, w: 260, color: 'tx1', fontFamily: '$font.body' },
      ], { base: b }), base)
      ok(add.ok && add.committed && add.slides === 20, `a slide added after slide 2 (${add.slides} slides)`)
      const thumbs = await page.evaluate(() => document.querySelectorAll('.ed-thumb').length)
      ok(thumbs === 20, `the slide list shows it (${thumbs} thumbnails)`)
      const note = await page.evaluate(() => window.bento.doc.slides[2].elements.find((e) => e.id === 'agent-note'))
      ok(note && note.h > 40 && note.themeRefs?.color === 'tx1', `text inserted without a height is measured (h ${note?.h}) and bound`)
      const stale = await page.evaluate((b) => window.bento.patch([{ op: 'notes', slide: 1, text: 'x' }], { base: b }), base)
      ok(!stale.ok && stale.err === 'stale', 'a patch against the old hash is refused as stale')
      const retry = await page.evaluate((b) => window.bento.patch([
        { op: 'add', after: 2, from: 2, id: 'agent-copy', title: 'Made by a patch' },
        { op: 'insert', slide: 'agent-copy', type: 'text', id: 'agent-note', md: 'One line that wraps onto a second line in a narrow box, measured on the deck fonts.', x: 96, y: 560, w: 260, color: 'tx1', fontFamily: '$font.body' },
      ], { base: b }), base)
      ok(retry.ok && retry.alreadyApplied && !retry.committed, 'the same patch retried with its base is answered as already applied')
      await page.evaluate(() => window.bento.undo())
      ok(await snap(page) === j0, 'one undo removes the added slide and its text')

      console.log('\nthe outline round-trips formatting (real sanitizer)')
      const fmt = await page.evaluate(() => {
        const line = window.bento.outline().split('\n').find((l) => l.startsWith(' 1/sd-title '))
        const text = JSON.parse(line.slice(line.indexOf('"'), line.lastIndexOf('"') + 1))
        const same = window.bento.patch([{ op: 'edits', id: '1/sd-title', text }])
        const one = window.bento.patch([{ op: 'edits', id: '1/sd-title', text: text.replace('file', 'deck') }])
        const html = window.bento.doc.slides[0].elements.find((e) => e.id === 'sd-title').html
        window.bento.undo()
        return { text, same, one, html }
      })
      ok(fmt.text.includes('\n') && fmt.same.replies[0].unchanged && !fmt.same.committed, `the title as printed (${JSON.stringify(fmt.text)}) sent back changes nothing`)
      ok(fmt.one.committed && (fmt.html.match(/<br>/g) ?? []).length === 2 && fmt.html.includes('deck'), `changing one word keeps both line breaks (${fmt.html})`)
      const bold = await page.evaluate(() => {
        const s2 = window.bento.doc.slides[1]
        const el = s2.elements.find((e) => e.type === 'text' && /<b>/.test(e.html))
        const line = window.bento.outline({ find: el.id }).split('\n').find((l) => l.includes(`2/${el.id}`))
        const text = JSON.parse(line.slice(line.indexOf('"'), line.lastIndexOf('"') + 1))
        const r = window.bento.patch([{ op: 'edits', id: `2/${el.id}`, text: text + '\n**One more** — a fifth line' }])
        const after = window.bento.doc.slides[1].elements.find((e) => e.id === el.id).html
        window.bento.undo()
        return { before: el.html, after, r }
      })
      ok(bold.r.committed && bold.after.startsWith(bold.before) && (bold.after.match(/<b>/g) ?? []).length === (bold.before.match(/<b>/g) ?? []).length + 1, 'adding a line keeps every bold lead-in before it')
      ok(await snap(page) === j0, 'both undone')

      console.log('\nchaining patches by the returned hash')
      const chain = await page.evaluate(() => {
        const h0 = window.bento.stats().hash
        const a = window.bento.patch([{ op: 'notes', slide: 1, text: 'first' }], { base: h0 })
        const b = window.bento.patch([{ op: 'notes', slide: 2, text: 'second' }], { base: a.hash })
        window.bento.undo(); window.bento.undo()
        return { a, b }
      })
      ok(chain.a.committed && chain.b.committed && chain.b.hash !== chain.a.hash, 'a patch whose base is the previous report\'s hash applies (the hash is taken after the editor\'s derive pass)')
      ok(await snap(page) === j0, 'both undone')

      console.log('\ntext measured while a font is still loading is fitted again once it lands')
      const late = await page.evaluate(async () => {
        let release
        const ready = new Promise((r) => { release = r })
        Object.defineProperty(document.fonts, 'status', { configurable: true, get: () => 'loading' })
        Object.defineProperty(document.fonts, 'ready', { configurable: true, get: () => ready })
        const r = window.bento.patch([{ op: 'insert', slide: 1, type: 'text', id: 'late-text', md: 'Measured while a font loads, then again once it arrives.', x: 96, y: 560, w: 240 }])
        const el = () => window.bento.doc.slides[0].elements.find((e) => e.id === 'late-text')
        const fitted = el().h
        el().h = 3 // what a fallback face could have measured; no undo step
        delete document.fonts.status; delete document.fonts.ready
        release(document.fonts)
        await new Promise((r) => setTimeout(r, 300))
        const refit = el().h
        window.bento.undo()
        const undone = el()?.h
        window.bento.undo()
        return { r, fitted, refit, undone }
      })
      ok(late.r.committed && late.fitted > 20, `the patch measured the box (h ${late.fitted})`)
      ok(late.refit === late.fitted && late.undone === 3, `once the fonts settle the box is fitted again as its own undo step (h ${late.refit}; undo → ${late.undone})`)
      ok(await snap(page) === j0, 'all undone')

      console.log('\nhostile markup, real sanitizers')
      const h = await page.evaluate(() => window.bento.patch([
        { op: 'set', id: '2/sd-title', html: 'hi <img src=x onerror="window.__pwn=1"> <b onclick="window.__pwn=2">bold</b> <a href="javascript:window.__pwn=3">l</a>' },
        { op: 'insert', slide: 2, type: 'svg', id: 'art', x: 0, y: 100, w: 100, h: 100, markup: '<svg viewBox="0 0 10 10"><script>window.__pwn=4</script><rect width="5" height="5" onclick="window.__pwn=5"/><style>.r{fill:red}</style></svg>', css: '@import url(https://evil.example/x.css); .r{fill:blue}' },
        { op: 'insert', slide: 2, type: 'shape', id: 'hit', shape: 'rect', x: 0, y: 0, w: 10, h: 10, link: 'javascript:window.__pwn=6' },
      ]))
      ok(h.ok && h.committed, 'the patch applied')
      await page.evaluate(() => document.querySelectorAll('.ed-thumb')[1].click())
      await page.waitForTimeout(400)
      const stored = await page.evaluate(() => JSON.stringify(window.bento.doc.slides[1]))
      const s1 = JSON.parse(stored).elements
      const t = s1.find((e) => e.id === 'sd-title'), sv = s1.find((e) => e.id === 'art'), hit = s1.find((e) => e.id === 'hit')
      ok(!/<img|onerror|onclick|javascript:/i.test(t.html) && /<b>bold<\/b>/.test(t.html), `text html cleaned, bold kept (${t.html})`)
      ok(!/<script|onclick/i.test(sv.markup) && /<rect/.test(sv.markup) && /\.r\{fill:red\}/.test(sv.markup) && !/data-el-id/.test(sv.markup), 'svg markup: script and handler gone, the drawing and its style kept unscoped')
      ok(!/@import|evil\.example/.test(sv.css ?? ''), 'svg css: the @import is gone')
      ok(!('link' in hit), 'the javascript: link was dropped')
      ok(await page.evaluate(() => window.__pwn === undefined), 'nothing ran')
      await page.evaluate(() => window.bento.undo())
      const lo = await page.evaluate(() => {
        const r = window.bento.patch([{ op: 'insert', slide: 2, type: 'svg', id: 'remote-art', x: 0, y: 0, w: 10, h: 10, markup: '<svg viewBox="0 0 10 10"><image href="https://tracker.example/p.gif" width="10" height="10"/></svg>' }])
        const kept = window.bento.doc.slides[1].elements.find((e) => e.id === 'remote-art')?.markup ?? ''
        return { r, kept }
      })
      ok(lo.r.committed && (!/tracker\.example/.test(lo.kept) || (lo.r.loads ?? []).some((u) => u.startsWith('tracker.example'))), `a remote image inside svg markup is named in loads when it is kept (${JSON.stringify(lo.r.loads)})`)
      await page.evaluate(() => window.bento.undo())
    }
    ok(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`)
    await ctx.close()
  }

  console.log('\na shared deck: the outline never shows its keys')
  {
    const { ctx, page } = await open(plain)
    const doc = JSON.parse(await snap(page))
    await ctx.close()
    const KEY = 'room-key-SECRET-0123456789abcdef', PRIV = 'writer-priv-SECRET-fedcba'
    doc.collab = { room: 'ws://127.0.0.1:1/d/rPATCHAPI', key: KEY, writerPub: 'pub', writerPriv: PRIV, on: false }
    const shared = join(scratch, 'shared.bento.html')
    writeFileSync(shared, withDoc(doc))
    const s = await open(shared)
    const outs = await s.page.evaluate(() => typeof window.bento.outline === 'function' ? [window.bento.outline(), ...window.bento.doc.slides.map((_, i) => window.bento.outline({ slide: i + 1 })), JSON.stringify(window.bento.stats())].join('\n') : '')
    ok(outs.length > 1000 && !outs.includes(KEY) && !outs.includes(PRIV) && !outs.includes('rPATCHAPI'), 'no outline view and no stats carry a sharing key or the room')
    const p = await s.page.evaluate(() => typeof window.bento.patch === 'function' ? window.bento.patch([{ op: 'set', id: '1/sd-title', collab: { key: 'evil' }, docId: 'evil' }, { op: 'edits', id: '1/sd-title', text: 'ok' }], { partial: true }) : null)
    const after = await s.page.evaluate(() => ({ key: window.bento.doc.collab?.key, docId: window.bento.doc.docId }))
    ok(p && p.committed && after.key === KEY && after.docId === doc.docId, 'a patch naming collab or docId changes neither')
    await s.ctx.close()
  }
  ok(sockets === 0, `no WebSocket was opened (${sockets})`)
} finally {
  await browser.close()
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
