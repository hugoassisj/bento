// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// A file dropped on the editor is either placed, opened or refused out loud;
// the browser never gets to navigate the tab to it.
//
//   npm run build:single --prefix slides && node scripts/test-slides-drop-image-browser.mjs
//
// WHAT THIS PROVES, on the packaged shell (DragEvents carrying real Files —
// the drop handlers are plain DOM listeners, so these are faithful):
//   1. One PNG dropped on the slide becomes one image element, interned as an
//      `asset:` reference, centred on the drop point, in one undo step.
//   2. Every file drop the editor receives is cancelled (`defaultPrevented`),
//      so a real browser does not leave the editor to show the file.
//   3. Three pictures dropped at once land as three elements that do not
//      coincide.
//   4. A drop near the slide's corner keeps the picture on the slide.
//   5. A large photo goes through the insert-time shrink and its toast.
//   6. A file that claims to be a picture but cannot be decoded says so and
//      inserts nothing.
//   7. Audio and video become media elements at the drop point.
//   8. Any other file is refused with a toast and changes nothing.
//   9. A drop on the slide list lands on the current slide, centred.
//  10. A dropped .bento.html still opens as a deck.
//  11. A read-only deck inserts nothing.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')

let checks = 0
let failures = 0
function ok(cond, msg) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  await ctx.route(/^https?:/, (r) => r.abort())
  const p = await ctx.newPage()
  const errors = []
  p.on('pageerror', (e) => errors.push(e.message))
  p.on('dialog', (d) => d.accept())
  await p.goto(new URL('../slides/dist-single/Bento_Slides.bento.html', import.meta.url).href)
  await p.waitForFunction(() => window.bento?.doc && document.querySelector('.ed-stage-scale [data-el-id]'))

  // An empty slide to drop on, so every new element is easy to find.
  await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.slides = [{ id: 's1', background: '#ffffff', notes: '', transition: 'none', elements: [] }]
    window.bento.loadDoc(JSON.stringify(d))
  })
  await p.waitForTimeout(300)

  // Build the files in the page (a canvas makes real PNG/JPEG bytes), then
  // dispatch dragover + drop at a client point, on whatever is under it.
  // `files` is a list of specs: { png: [w, h] } | { jpeg: [w, h] } | { text, name, type }.
  const drop = (files, at) => p.evaluate(async ({ files, at }) => {
    const make = async (f) => {
      if (f.png || f.jpeg) {
        const [w, h] = f.png || f.jpeg
        const c = document.createElement('canvas'); c.width = w; c.height = h
        const g = c.getContext('2d')
        if (f.jpeg) { // photo-like noise, so the shrink classifies it as a photo
          const im = g.createImageData(w, h)
          for (let i = 0; i < im.data.length; i++) im.data[i] = (i * 2654435761 >>> 24) & 255
          g.putImageData(im, 0, 0)
        } else { g.fillStyle = '#3366ff'; g.fillRect(0, 0, w, h) }
        const type = f.jpeg ? 'image/jpeg' : 'image/png'
        const blob = await new Promise((r) => c.toBlob(r, type, 0.95))
        return new File([blob], f.name || (f.jpeg ? 'photo.jpg' : 'picture.png'), { type })
      }
      return new File([f.text], f.name, { type: f.type })
    }
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(await make(f))
    let x = at.x, y = at.y
    const r = document.querySelector('.ed-stage-scale').getBoundingClientRect()
    const k = r.width / window.bento.doc.size.width
    if (at.slide) { x = r.left + at.slide[0] * k; y = r.top + at.slide[1] * k } // slide → client
    if (at.selector) { const b = document.querySelector(at.selector).getBoundingClientRect(); x = b.left + b.width / 2; y = b.top + b.height / 2 }
    // a DragEvent's clientX/Y are whole pixels: aim at one, and say where on
    // the slide that pixel is (a fraction of a slide px off the request)
    x = Math.round(x); y = Math.round(y)
    const point = [(x - r.left) / k, (y - r.top) / k]
    const target = document.elementFromPoint(x, y) || document.body
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }
    const over = new DragEvent('dragover', opts)
    target.dispatchEvent(over)
    const dr = new DragEvent('drop', opts)
    target.dispatchEvent(dr)
    return { over: over.defaultPrevented, drop: dr.defaultPrevented, point }
  }, { files, at })

  const els = () => p.evaluate(() => window.bento.doc.slides[0].elements.map((e) => ({ id: e.id, type: e.type, kind: e.kind, x: e.x, y: e.y, w: e.w, h: e.h, src: String(e.src ?? '').slice(0, 12) })))
  const count = async () => (await els()).length
  const waitCount = async (n, ms = 4000) => { try { await p.waitForFunction((n) => window.bento.doc.slides[0].elements.length >= n, n, { timeout: ms }) } catch {} return count() }
  const toast = () => p.evaluate(() => document.querySelector('.ed-toast')?.textContent ?? '')
  const W = await p.evaluate(() => window.bento.doc.size.width)
  const H = await p.evaluate(() => window.bento.doc.size.height)

  // 1 + 2: one PNG at slide (400, 300)
  let r = await drop([{ png: [300, 200] }], { slide: [400, 300] })
  ok(r.over, `dragover with a file is accepted (${r.over})`)
  ok(r.drop, `the drop of a picture is cancelled — the browser does not navigate to it (${r.drop})`)
  let n = await waitCount(1)
  let list = await els()
  ok(n === 1, `one PNG dropped adds one element (0 → ${n})`)
  const e1 = list[0]
  ok(e1?.type === 'image', `…an image (${e1?.type})`)
  ok(e1?.src.startsWith('asset:'), `…interned into doc.assets (${e1?.src})`)
  const near = (e, pt) => !!e && Math.abs(e.x + e.w / 2 - pt[0]) <= 1 && Math.abs(e.y + e.h / 2 - pt[1]) <= 1
  const centre = (e) => e ? `${e.x + e.w / 2},${e.y + e.h / 2}` : '-'
  ok(near(e1, r.point), `…centred on the drop point (centre ${centre(e1)} vs ${r.point.map(Math.round)})`)
  await p.evaluate(() => window.bento.undo())
  ok(await count() === 0, 'one undo removes it')
  await p.evaluate(() => window.bento.redo())

  // 3: three pictures in one drop
  const before3 = await count()
  r = await drop([{ png: [200, 150], name: 'a.png' }, { png: [200, 150], name: 'b.png' }, { png: [200, 150], name: 'c.png' }], { slide: [800, 400] })
  n = await waitCount(before3 + 3)
  list = (await els()).slice(before3)
  const spots = new Set(list.map((e) => `${e.x},${e.y}`))
  ok(r.drop && n === before3 + 3, `three pictures dropped add three elements (${before3} → ${n})`)
  ok(spots.size === 3, `…that do not coincide (${[...spots].join(' | ')})`)
  ok(list.length === 3 && list.every((e) => e.type === 'image' && e.src.startsWith('asset:')), '…all interned images')

  // 4: near the corner, the picture stays on the slide
  const before4 = await count()
  await drop([{ png: [300, 200] }], { slide: [W - 5, H - 5] })
  n = await waitCount(before4 + 1)
  const corner = (await els())[before4]
  ok(corner && corner.x >= 0 && corner.y >= 0 && corner.x + corner.w <= W + 0.5 && corner.y + corner.h <= H + 0.5,
    `a drop at the corner keeps the picture on the slide (${corner ? [corner.x, corner.y, corner.w, corner.h] : '-'})`)

  // 5: a large photo is shrunk, with the same toast as a pasted one
  const before5 = await count()
  await drop([{ jpeg: [3600, 2400] }], { slide: [640, 360] })
  n = await waitCount(before5 + 1, 15000)
  const t5 = await toast()
  ok(n === before5 + 1, `a large photo lands (${before5} → ${n})`)
  ok(/2560/.test(t5), `…through the insert-time shrink (toast "${t5}")`)

  // 6: undecodable "picture"
  await p.evaluate(() => document.querySelector('.ed-toast')?.remove())
  const before6 = await count()
  r = await drop([{ text: 'this is not a picture', name: 'broken.png', type: 'image/png' }], { slide: [400, 300] })
  await p.waitForTimeout(1200)
  const t6 = await toast()
  ok(r.drop, 'the drop of an undecodable picture is cancelled')
  ok(await count() === before6, `an undecodable picture inserts nothing (${before6} → ${await count()})`)
  ok(t6.includes('broken.png'), `…and says so, naming the file (toast "${t6}")`)

  // 7: audio and video become media elements at the drop point
  const before7 = await count()
  r = await drop([{ text: 'ID3', name: 'clip.mp3', type: 'audio/mpeg' }], { slide: [300, 600] })
  n = await waitCount(before7 + 1)
  const au = (await els())[before7]
  ok(r.drop && au?.type === 'media' && au?.kind === 'audio', `a dropped audio file becomes an audio element (${au?.type}/${au?.kind})`)
  ok(near(au, r.point), `…centred on the drop point (${centre(au)} vs ${r.point.map(Math.round)})`)
  ok(au?.src.startsWith('asset:'), `…embedded through doc.assets (${au?.src})`)
  r = await drop([{ text: 'not really a video', name: 'clip.mp4', type: 'video/mp4' }], { slide: [900, 500] })
  n = await waitCount(before7 + 2)
  const vi = (await els())[before7 + 1]
  ok(vi?.type === 'media' && vi?.kind === 'video', `a dropped video file becomes a video element (${vi?.type}/${vi?.kind})`)
  ok(near(vi, r.point), `…centred on the drop point (${centre(vi)} vs ${r.point.map(Math.round)})`)

  // 8: any other file is refused out loud
  await p.evaluate(() => document.querySelector('.ed-toast')?.remove())
  const before8 = await count()
  const docBefore = await p.evaluate(() => JSON.stringify(window.bento.doc.slides))
  r = await drop([{ text: '%PDF-1.4', name: 'notes.pdf', type: 'application/pdf' }], { slide: [400, 300] })
  await p.waitForTimeout(500)
  const t8 = await toast()
  ok(r.drop, `the drop of an unsupported file is cancelled (${r.drop})`)
  ok(await count() === before8 && docBefore === await p.evaluate(() => JSON.stringify(window.bento.doc.slides)), 'an unsupported file changes nothing')
  ok(t8.length > 0, `…and a toast says what can be dropped ("${t8}")`)

  // 9: dropped on the slide list → the current slide, centred
  const before9 = await count()
  r = await drop([{ png: [300, 200] }], { selector: '.ed-thumbs .ed-thumb' })
  n = await waitCount(before9 + 1)
  const th = (await els())[before9]
  ok(r.drop && n === before9 + 1, `a picture dropped on the slide list lands on the slide (${before9} → ${n})`)
  ok(near(th, [W / 2, H / 2]), `…centred on the slide (${centre(th)})`)

  // 10: a dropped .bento.html still opens as a deck
  const deck = await p.evaluate(() => {
    const d = JSON.parse(JSON.stringify(window.bento.doc))
    d.title = 'Dropped deck'
    d.slides = [{ id: 'z1', background: '#ffffff', notes: '', transition: 'none', elements: [] }, { id: 'z2', background: '#ffffff', notes: '', transition: 'none', elements: [] }]
    delete d.assets
    return '<!doctype html><html><head></head><body><script type="application/bento+json" id="bento-doc">' + JSON.stringify(d).replace(/</g, '\\u003c') + '</scr' + 'ipt></body></html>'
  })
  r = await drop([{ text: deck, name: 'Other.bento.html', type: 'text/html' }], { slide: [400, 300] })
  try { await p.waitForFunction(() => window.bento.doc.slides.length === 2 && window.bento.doc.slides[0].id === 'z1', null, { timeout: 4000 }) } catch {}
  ok(r.drop && await p.evaluate(() => window.bento.doc.slides.map((s) => s.id).join()) === 'z1,z2', 'a dropped .bento.html opens as the deck')

  // 11: a read-only deck inserts nothing
  await p.evaluate(() => {
    // a reader's copy of a live session (loadDoc keeps the open deck's
    // session block, so the role goes on the live one, then any doc event)
    window.bento.doc.collab = { ...(window.bento.doc.collab || {}), role: 'reader' }
    window.bento.loadDoc(JSON.stringify(window.bento.doc))
  })
  await p.waitForTimeout(300)
  const reader = await p.evaluate(() => document.body.classList.contains('ed-reader'))
  ok(reader, 'the deck is in read-only mode')
  const before11 = await count()
  r = await drop([{ png: [300, 200] }], { slide: [400, 300] })
  await p.waitForTimeout(1000)
  ok(r.drop, 'a drop on a read-only deck is cancelled')
  ok(await count() === before11, `…and inserts nothing (${before11} → ${await count()})`)

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`)
} finally {
  await browser.close()
}
console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
