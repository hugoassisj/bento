# Driving the app

Read this when you can run a headless browser: it gives you the compact form,
layouts and roles, text fitted to its box, the validator and pictures of every
slide, all in one call per round.

## `drive.cjs`: load, check, look, save in one call

Save this as `drive.cjs` and run `node drive.cjs deck.bento.html doc.json
shots/` (the document and the folder are each optional). It needs the
`playwright` package and works with no network: the app's offline switch is
on, so a deck with `collab` keys does not join its live room.

```js
// node drive.cjs deck.bento.html [doc.json] [shots-dir]   (any order; -h, --help)
// Opens the deck in headless Chromium with the app's network switched off,
// loads doc.json (full or compact) when given, prints the load report and
// validate() findings as JSON, writes one PNG per slide in the show plus
// sheet.png (every slide on one image) to shots-dir when given, and saves the
// deck back to its path after a load. Arguments go by kind: a .json file is
// the document, a .html file the deck, anything else the folder for pictures.
// Needs the playwright package. MARGIN=64 sets validate()'s side margin
// (1280-wide units).
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')
const args = process.argv.slice(2)
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).join('\n'))
  process.exit(args.length ? 0 : 2)
}
const deck = args.find((a) => /\.html?$/i.test(a))
const json = args.find((a) => /\.json$/i.test(a))
const shots = args.find((a) => a !== deck && a !== json)
const margin = process.env.MARGIN === undefined ? undefined : Number(process.env.MARGIN)
if (!deck) { console.error('no .bento.html given'); process.exit(2) }
if (margin !== undefined && !(margin >= 0)) { console.error(`MARGIN must be a number of 0 or more, not "${process.env.MARGIN}"`); process.exit(2) }
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctx.addInitScript(() => localStorage.setItem('bento-offline', 'on'))
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.route(/^https?:/, (r) => r.abort())
  const page = await ctx.newPage()
  await page.goto(pathToFileURL(resolve(deck)).href)
  await page.waitForFunction(() => window.bento && window.bento.loadDoc)
  const out = {}
  if (json) {
    out.load = await page.evaluate((j) => {
      const r = window.bento.loadDoc(j)
      return r && { dropped: r.dropped, expanded: r.expanded, fitted: r.fitted, laidOut: r.laidOut }
    }, readFileSync(json, 'utf8'))
    if (!out.load) throw new Error('not a bento/slides document: nothing was loaded')
  }
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300) // boxes measured before the fonts settled are fitted again
  const v = await page.evaluate((m) => window.bento.validate(undefined, m === null ? undefined : { margin: m }), margin ?? null)
  out.counts = v.counts
  out.findings = v.findings.filter((f) => f.code !== 'collab-secrets-present')
    .map((f) => [f.severity, f.code, f.slide, f.element, f.message].filter(Boolean).join(' | '))
  if (shots) {
    mkdirSync(shots, { recursive: true })
    const file = (i) => join(shots, `slide-${String(i + 1).padStart(2, '0')}.png`)
    // a shell with window.bento.renderAll draws the slides themselves; older
    // ones are photographed in the editor view, one arrow key at a time
    let urls = await page.evaluate(async () => typeof window.bento.renderAll === 'function'
      ? (await Promise.all(await window.bento.renderAll())).map((r) => (r && r.ok ? r.dataUrl : `failed: ${r ? r.err : 'no result'}`)) : null)
    out.shots = urls ? 'slides' : 'editor view'
    if (!urls) {
      urls = []
      const n = await page.evaluate(() => window.bento.doc.slides.filter((s) => !s.stateOf && !s.hidden).length)
      await page.keyboard.press('Escape')
      for (let i = 0; i < n; i++) {
        if (i) await page.keyboard.press('ArrowDown')
        await page.waitForTimeout(250)
        urls.push('data:image/png;base64,' + (await page.locator('.ed-stage').screenshot()).toString('base64'))
      }
    }
    const failed = urls.map((u, i) => (u.startsWith('failed') ? `slide ${i + 1}: ${u}` : null)).filter(Boolean)
    if (failed.length) out.renderFailed = failed
    urls.forEach((u, i) => { if (!u.startsWith('failed')) writeFileSync(file(i), Buffer.from(u.split(',')[1], 'base64')) })
    // one contact sheet, four slides to a row, drawn on a canvas in the page
    const sheet = await page.evaluate(async (list) => {
      const imgs = await Promise.all(list.filter((u) => u.startsWith('data:')).map((u) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = u })))
      const ims = imgs.filter(Boolean)
      if (!ims.length) return null
      const tw = 400, th = Math.round(tw * ims[0].height / ims[0].width), gap = 8, cols = Math.min(4, ims.length), rows = Math.ceil(ims.length / cols)
      const c = document.createElement('canvas')
      c.width = cols * tw + (cols + 1) * gap; c.height = rows * th + (rows + 1) * gap
      const g = c.getContext('2d')
      g.fillStyle = '#888888'; g.fillRect(0, 0, c.width, c.height)
      ims.forEach((im, i) => g.drawImage(im, gap + (i % cols) * (tw + gap), gap + Math.floor(i / cols) * (th + gap), tw, th))
      return c.toDataURL('image/png')
    }, urls)
    if (sheet) { writeFileSync(join(shots, 'sheet.png'), Buffer.from(sheet.split(',')[1], 'base64')); out.sheet = join(shots, 'sheet.png') }
  }
  if (json) writeFileSync(deck, await page.evaluate(() => window.bento.serialize()))
  await browser.close()
  console.log(JSON.stringify(out, null, 1))
})().catch((e) => { console.error(e.message); process.exit(1) })
```

- `doc.json` is a whole document, full or compact (`"compact": true`): it
  replaces the deck's content and keeps its `docId` and `collab`, so start an
  edit from the deck's own document (`window.bento.read({ compact: true })` in
  the page, or the block itself).
- `load` and `findings` are the report `SKILL.md` section 3 describes, minus
  the sharing-key notice.
- The pictures are the slides in the show, in order, without hidden and state
  slides, and `sheet.png` holds all of them in one image: view that one, and
  open a single slide only to look closer. A shell with
  `window.bento.renderAll` draws the slides themselves (a slide it cannot
  draw is listed in `renderFailed`); an older one is photographed in the
  editor view (`shots: "editor view"`).
- Leave out `doc.json` to check and photograph a deck without changing it.

## The page's API (`window.bento`)

| Call | Returns |
|---|---|
| `read()` / `read({ compact: true })` | the document, without its `collab` keys |
| `loadDoc(json)` | the load report (`dropped`, `expanded`, `fitted`, `laidOut`, `findings`), or `false` when the JSON is not a document |
| `validate(undefined, { margin })` | `{ ok, counts, findings }`; each finding `{ code, severity, message, slide, element, path }` |
| `measure({ html, w, fontSize, lineHeight, h })` | `{ height, width, lines }`, plus `fits` and `overflow` when you pass `h` |
| `compact()` | the open deck as compact JSON |
| `schema()` | the format as JSON Schema |
| `serialize()` | the whole file, `collab` keys included: write it to disk, do not print it |
