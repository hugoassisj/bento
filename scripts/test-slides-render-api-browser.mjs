// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// window.bento.render(): a slide as an image, for anything that can open the
// file in a browser (AI-06).
//
//   npm run build:single --prefix slides && node scripts/test-slides-render-api-browser.mjs
//
// WHAT THIS PROVES, on the built shell. A fixture deck has a known solid-colour
// region per slide and per build step. render() is called and its image is
// DECODED (an <img> drawn to a canvas, getImageData) and sampled — pixels, not
// DOM or style values:
//   1. render(1) is a PNG whose decoded size is doc.size at scale 1, and its
//      pixels are the slide's;
//   2. step 0 leaves out what a later click reveals, step 1 shows step 1 only;
//   3. a missing id or index resolves { ok: false, err: 'no-such-slide' } and
//      bad options 'bad-option' — never a throw;
//   4. a state slide renders by id; renderAll() is the show's slides in order;
//   5. the document, the selection, the undo stack and the canvas are the same
//      before and after;
//   6. an image that cannot be read back resolves { ok: false, err: 'tainted' };
//   7. jpeg, scale and a document that is not loaded (opts.doc) work.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const rect = (id, x, fill, step) => ({ id, type: 'shape', shape: 'rect', x, y: 100, w: 200, h: 200, fill, ...(step ? { fx: { step } } : {}) })
const deck = {
  compact: true, format: 'bento/slides', version: 1, title: 'Render me', size: { width: 1280, height: 720 },
  slides: [
    { id: 's1', background: '#ffffff', elements: [rect('red', 100, '#ff0000'), rect('green', 500, '#00ff00', 1), rect('blue', 900, '#0000ff', 2)] },
    { id: 's2', background: '#000000', elements: [rect('yellow', 100, '#ffff00')] },
    { id: 's3', background: '#00ffff', stateOf: 's1', elements: [rect('magenta', 100, '#ff00ff')] },
    { id: 's4', background: '#808080', hidden: true, elements: [] },
  ],
}
const other = {
  compact: true, format: 'bento/slides', version: 1, title: 'Not loaded', size: { width: 1280, height: 720 },
  slides: [{ id: 'o1', background: '#ff8000', elements: [rect('o-black', 100, '#000000')] }],
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  // never the network: no http(s), no WebSocket, and the app's own offline switch
  await ctx.route(/^https?:/, (r) => r.abort())
  if (ctx.routeWebSocket) await ctx.routeWebSocket(/.*/, (ws) => ws.close())
  await ctx.addInitScript(() => { try { localStorage.setItem('bento-offline', 'on') } catch {} })
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc)
  ok(await p.evaluate(() => typeof window.bento.render === 'function' && typeof window.bento.renderAll === 'function'), 'window.bento has render() and renderAll()')
  const loaded = await p.evaluate((j) => !!window.bento.loadDoc(j), JSON.stringify(deck))
  ok(loaded, 'the fixture deck loads')
  await p.waitForTimeout(300)

  // decode a data URL and read pixels at slide coordinates (scaled)
  await p.evaluate(() => {
    window.__decode = async (url, points) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth; c.height = img.naturalHeight
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const px = points.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)))
      return { w: img.naturalWidth, h: img.naturalHeight, px }
    }
  })
  const call = (expr, points = []) => p.evaluate(async ({ expr, points }) => {
    try {
      // eslint-disable-next-line no-new-func
      const r = await new Function('return ' + expr)()
      const one = async (x) => (x && x.ok ? { ...x, dataUrl: x.dataUrl.slice(0, 22), img: await window.__decode(x.dataUrl, points) } : x)
      return Array.isArray(r) ? Promise.all(r.map(one)) : one(r)
    } catch (e) { return { threw: String(e) } }
  }, { expr, points })
  const near = (got, want) => got && got.every((v, i) => Math.abs(v - want[i]) <= 8)
  const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255]
  const S1 = [[200, 200], [600, 200], [1000, 200], [10, 10]]

  console.log('\nrender(1)\n')
  const r1 = await call('window.bento.render(1)', S1)
  ok(r1?.ok === true && r1.dataUrl.startsWith('data:image/png'), `resolves ok with a PNG data URL (${r1?.dataUrl ?? JSON.stringify(r1)})`)
  ok(r1?.img?.w === 1280 && r1?.img?.h === 720 && r1.width === 1280 && r1.height === 720, `its decoded size is doc.size at scale 1 (${r1?.img?.w}×${r1?.img?.h}, says ${r1?.width}×${r1?.height})`)
  ok(r1?.slideId === 's1', `it names the slide (${r1?.slideId})`)
  ok(near(r1?.img?.px[0], RED) && near(r1?.img?.px[1], GREEN) && near(r1?.img?.px[2], BLUE) && near(r1?.img?.px[3], WHITE),
    `every step revealed by default: red, green, blue on white (${JSON.stringify(r1?.img?.px)})`)

  console.log('\nbuild steps\n')
  const st0 = await call("window.bento.render('s1', { step: 0 })", S1)
  ok(near(st0?.img?.px[0], RED) && near(st0?.img?.px[1], WHITE) && near(st0?.img?.px[2], WHITE),
    `step 0: the stepped boxes are absent, the background shows where they would be (${JSON.stringify(st0?.img?.px)})`)
  const st1 = await call("window.bento.render('s1', { step: 1 })", S1)
  ok(near(st1?.img?.px[0], RED) && near(st1?.img?.px[1], GREEN) && near(st1?.img?.px[2], WHITE),
    `step 1: step 1 shows, step 2 does not (${JSON.stringify(st1?.img?.px)})`)

  console.log('\nmistakes are results, not throws\n')
  const miss = await call("window.bento.render('missing-id')")
  ok(miss?.ok === false && miss.err === 'no-such-slide' && typeof miss.detail === 'string', `render('missing-id') → no-such-slide (${JSON.stringify(miss)})`)
  const miss2 = await call('window.bento.render(99)')
  ok(miss2?.ok === false && miss2.err === 'no-such-slide', 'render(99) → no-such-slide')
  const bads = await Promise.all(["window.bento.render(1.5)", "window.bento.render(1, { format: 'gif' })", "window.bento.render(1, { scale: -1 })", "window.bento.render(1, { step: -2 })", "window.bento.render({})"].map((e) => call(e)))
  ok(bads.every((b) => b?.ok === false && b.err === 'bad-option'), `a fractional index, an unknown format, a negative scale or step, an object target → bad-option (${bads.map((b) => b?.err ?? b?.threw).join(', ')})`)

  console.log('\nstate slides and renderAll\n')
  const s3 = await call("window.bento.render('s3')", [[10, 10], [200, 200]])
  ok(s3?.ok === true && s3.slideId === 's3' && near(s3.img.px[0], [0, 255, 255]) && near(s3.img.px[1], [255, 0, 255]), `a state slide renders by id (${JSON.stringify(s3?.img?.px)})`)
  const s3i = await call('window.bento.render(3)', [[10, 10]])
  ok(s3i?.slideId === 's3', 'index 3 counts state slides (the doc.slides order)')
  const all = await call('window.bento.renderAll()', [[10, 10]])
  ok(Array.isArray(all) && all.length === 2 && all[0].slideId === 's1' && all[1].slideId === 's2' && near(all[1].img.px[0], [0, 0, 0]),
    `renderAll(): the shown slides in show order, state and hidden left out (${Array.isArray(all) ? all.map((a) => a.slideId).join(',') : JSON.stringify(all)})`)

  console.log('\nread-only\n')
  // the undo stack's depth, measured by walking it and back (this clears the
  // selection, so it runs before the click and after the second snapshot)
  const depth = () => p.evaluate(() => {
    const at = () => JSON.stringify(window.bento.doc)
    const start = at()
    let n = 0
    for (; n < 200; n++) { const before = at(); window.bento.undo(); if (at() === before) break }
    for (let i = 0; i < n; i++) window.bento.redo()
    return { n, back: at() === start }
  })
  const snap = () => p.evaluate(() => ({ doc: JSON.stringify(window.bento.doc), sel: JSON.stringify(window.bento.selection), canvas: document.querySelector('.ed-stage-scale')?.innerHTML.length }))
  const d0 = await depth()
  // a real selection: click the red box on the canvas
  const box = await p.evaluate(() => { const r = document.querySelector('.ed-stage-scale [data-el-id="red"]')?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  if (box) await p.mouse.click(box.x, box.y)
  await p.waitForTimeout(200)
  const before = await snap()
  await call("window.bento.render(1)"); await call("window.bento.render('s3', { step: 0, scale: 2 })"); await call('window.bento.renderAll()')
  const after = await snap()
  const d1 = await depth()
  ok(JSON.parse(before.sel).includes('red'), `a selection to keep (${before.sel})`)
  ok(before.doc === after.doc, 'window.bento.doc is the same before and after')
  ok(before.sel === after.sel, `the selection is the same (${after.sel})`)
  ok(d0.n === d1.n && d0.back && d1.back && d0.n > 0, `the undo stack is the same depth (${d0.n} → ${d1.n})`)
  ok(before.canvas === after.canvas, 'the canvas is untouched')

  console.log('\nan image that cannot be read back\n')
  const taint = await p.evaluate(async () => {
    const real = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function () { throw new DOMException('The canvas has been tainted by cross-origin data.', 'SecurityError') }
    try { return await window.bento.render(1) } catch (e) { return { threw: String(e) } } finally { HTMLCanvasElement.prototype.toBlob = real }
  })
  ok(taint?.ok === false && taint.err === 'tainted', `a canvas that refuses to export resolves tainted (${JSON.stringify(taint)})`)

  console.log('\nformat, scale, a document that is not loaded\n')
  const jp = await call("window.bento.render(2, { format: 'jpeg', scale: 2 })", [[400, 400]])
  ok(jp?.ok === true && jp.dataUrl.startsWith('data:image/jpeg') && jp.img.w === 2560 && jp.img.h === 1440 && near(jp.img.px[0], [255, 255, 0]),
    `jpeg at scale 2 is 2560×1440 and the box lands at twice its coordinates (${jp?.img?.w}×${jp?.img?.h} ${JSON.stringify(jp?.img?.px)})`)
  const snapped = await call('window.bento.render(1, { scale: 2.2 })')
  ok(snapped?.width === 2560, `a scale between the export's steps snaps to the nearest (2.2 → ${snapped?.width / 1280})`)
  const docBefore = await p.evaluate(() => JSON.stringify(window.bento.doc))
  const od = await call(`window.bento.render(1, { doc: ${JSON.stringify(other)} })`, [[10, 10], [200, 200]])
  ok(od?.ok === true && od.slideId === 'o1' && near(od.img.px[0], [255, 128, 0]) && near(od.img.px[1], [0, 0, 0]), `opts.doc renders a document that is not loaded (${JSON.stringify(od?.img?.px ?? od)})`)
  ok(docBefore === (await p.evaluate(() => JSON.stringify(window.bento.doc))), '…and the open deck is unchanged')
  const odBad = await call("window.bento.render(1, { doc: { hello: 'world' } })")
  ok(odBad?.ok === false && odBad.err === 'bad-option', `a doc that is not a deck → bad-option (${odBad?.err})`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`)
} finally { await browser.close() }

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
