#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Tidy up rig: the arrangement detector and the tidy geometry
// (slides/src/editor/tidy.ts). Given boxes, expect boxes.
//
//   node scripts/test-slides-tidy.ts
//
// WHAT THIS PROVES. Three roughly aligned boxes are a row: they come out on
// the first box's top edge with equal gaps, the median of the gaps they had.
// Three stacked boxes are a column, on the top box's left edge. A 2×3 scatter
// is a grid: two rows and three columns, every column gap equal and every row
// gap equal. A diagonal is not a grid. Overlapping boxes get the 16px gap auto
// layout uses. Sizes never change and the result keeps the input's order. A
// tidied selection is a fixed point (tidying again moves nothing), mixed
// sizes included: gaps are measured between columns and rows, not between
// boxes, and a row is a row by its bands (one band across), not by where its
// centres spread. Nothing is pushed off the slide: a row too long for it
// tightens its gap, then wraps (one to a line turns it into a column), a grid
// too big tightens and is laid out again, and an arrangement past an edge is
// shifted back. Lines keep their own widths, so a title over its cards is two
// lines; when no arrangement fits the slide, nothing moves and fits is false.
// Seeded property checks run thousands of random selections, ordinary slides
// (titles and cards, big photos, title-wide strips) among them, at 1280×720
// and 1920×1080.

import { detect, medianGap, tidy, type Box } from '../slides/src/editor/tidy.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const b = (x: number, y: number, w = 200, h = 120): Box => ({ x, y, w, h })
const SLIDE = { w: 1280, h: 720 }
const near = (a: number, c: number, eps = 1) => Math.abs(a - c) <= eps
const gaps = (bs: Box[], axis: 'x' | 'y') => {
  const [p, s] = axis === 'x' ? ['x', 'w'] as const : ['y', 'h'] as const
  const r = [...bs].sort((m, n) => m[p] - n[p])
  return r.slice(1).map((e, i) => e[p] - (r[i][p] + r[i][s]))
}
const same = (v: number[]) => v.every((g) => near(g, v[0]))
const sizesKept = (a: Box[], c: Box[]) => a.every((x, i) => x.w === c[i].w && x.h === c[i].h)

console.log('\n1. a row\n')
{
  const input = [b(100, 200), b(340, 210), b(610, 195)]
  const r = tidy(input)
  ok(r.kind === 'row', `three roughly aligned boxes are a row (${r.kind})`)
  ok(r.boxes.every((x) => x.y === 200), `a common top edge, the first box's (${r.boxes.map((x) => x.y).join(', ')})`)
  const g = gaps(r.boxes, 'x')
  ok(same(g), `equal gaps (${g.join(', ')})`)
  ok(g[0] === medianGap(input, 'x') && g[0] === 40, `the gap is the median of the gaps they had (${g[0]})`)
  ok(r.boxes[0].x === 100, 'the first box stays where it was')
  ok(sizesKept(input, r.boxes), 'sizes unchanged')
}

console.log('\n2. a row given out of order, mixed sizes\n')
{
  const input = [b(700, 300, 120, 80), b(80, 290, 200, 140), b(380, 310, 160, 100)]
  const r = tidy(input)
  ok(r.kind === 'row', `still a row (${r.kind})`)
  ok(r.boxes[1].x === 80 && r.boxes.every((x) => x.y === 290), 'anchored on the leftmost box, whatever the order given')
  ok(r.boxes[1].x < r.boxes[2].x && r.boxes[2].x < r.boxes[0].x, 'left-to-right order kept, results in input order')
  ok(same(gaps(r.boxes, 'x')), `equal gaps (${gaps(r.boxes, 'x').join(', ')})`)
}

console.log('\n3. a column\n')
{
  const input = [b(400, 100), b(410, 260), b(395, 430)]
  const r = tidy(input)
  ok(r.kind === 'col', `three stacked boxes are a column (${r.kind})`)
  ok(r.boxes.every((x) => x.x === 400), 'a common left edge, the top box\'s')
  ok(same(gaps(r.boxes, 'y')), `equal gaps (${gaps(r.boxes, 'y').join(', ')})`)
}

console.log('\n4. a 2×3 scatter is a grid\n')
{
  const input = [
    b(100, 100), b(345, 112), b(610, 95),
    b(108, 285), b(330, 300), b(598, 290),
  ]
  const d = detect(input)
  ok(d.kind === 'grid', `detected as a grid (${d.kind})`)
  const r = tidy(input)
  const rows = new Set(r.boxes.map((x) => x.y)), cols = new Set(r.boxes.map((x) => x.x))
  ok(rows.size === 2 && cols.size === 3, `two rows and three columns (${rows.size} × ${cols.size})`)
  const top = r.boxes.slice(0, 3), bottom = r.boxes.slice(3)
  const gx = [...gaps(top, 'x'), ...gaps(bottom, 'x')]
  ok(same(gx), `every column gap equal (${gx.join(', ')})`)
  const gy = [0, 1, 2].map((c) => r.boxes[c + 3].y - (r.boxes[c].y + r.boxes[c].h))
  ok(same(gy), `every row gap equal (${gy.join(', ')})`)
  ok(r.boxes[0].x === 100 && r.boxes[0].y === 95, `from the selection's top-left corner (${r.boxes[0].x}, ${r.boxes[0].y})`)
  ok(sizesKept(input, r.boxes), 'sizes unchanged')
}

console.log('\n5. what is not a grid\n')
{
  ok(detect([b(100, 100), b(400, 300), b(700, 500)]).kind !== 'grid', 'a diagonal is not a grid')
  ok(detect([b(100, 100), b(400, 105)]).kind === 'row', 'two side by side are a row')
  ok(detect([b(100, 100), b(110, 400)]).kind === 'col', 'two one above the other are a column')
}

console.log('\n6. overlaps and the fixed point\n')
{
  const input = [b(100, 100), b(124, 124), b(148, 148)] // ⌘D copies: no spacing to keep
  const r = tidy(input)
  const axis = r.kind === 'row' ? 'x' : 'y'
  ok(gaps(r.boxes, axis).every((g) => g === 16), `overlapping copies get the 16px gap (${gaps(r.boxes, axis).join(', ')})`)
  for (const [name, bs] of [['row', [b(100, 200), b(340, 210), b(610, 195)]], ['grid', [b(100, 100), b(345, 112), b(610, 95), b(108, 285), b(330, 300), b(598, 290)]]] as const) {
    const once = tidy([...bs]).boxes
    const twice = tidy(once).boxes
    ok(JSON.stringify(once) === JSON.stringify(twice), `tidying a tidied ${name} moves nothing`)
  }
  ok(tidy([b(5, 5)]).boxes[0].x === 5, 'one box is left alone')
}

console.log('\n7. mixed sizes are a fixed point too\n')
{
  const runs = (bs: Box[], n: number, bounds?: { w: number; h: number }) => {
    const seen = [JSON.stringify(bs)]
    let cur = bs
    for (let i = 0; i < n; i++) { cur = tidy(cur, bounds).boxes; seen.push(JSON.stringify(cur)) }
    return seen
  }
  // a 3×2 grid whose first column holds one wide box: columns are as wide as
  // their widest box, and gaps measured box to box used to grow every run
  const wide = [b(100, 100, 300, 100), b(440, 100, 150), b(630, 100, 150), b(100, 240, 150), b(440, 240, 150), b(630, 240, 150)]
  const w4 = runs(wide, 4, SLIDE)
  ok(tidy(wide, SLIDE).kind === 'grid', 'a 3×2 grid with one wide box is a grid')
  ok(w4.slice(2).every((x) => x === w4[1]), `tidying it again and again moves nothing (x of the second column: ${w4.slice(1).map((x) => (JSON.parse(x) as Box[])[1].x).join(' → ')})`)
  const col0 = [b(0, 0, 200, 100), b(250, 0, 100, 100), b(0, 150, 100, 100), b(250, 150, 100, 100), b(0, 300, 100, 100), b(250, 300, 100, 100)]
  const c4 = runs(col0, 4)
  ok(c4.slice(2).every((x) => x === c4[1]), `a 2×3 grid whose first column is 200, 100, 100 wide settles on the first run (x of the second column: ${c4.slice(1).map((x) => (JSON.parse(x) as Box[])[1].x).join(' → ')})`)
  const scatter = [b(100, 100, 200, 120), b(420, 120, 150, 100), b(700, 90, 220, 140), b(110, 400, 180, 110), b(430, 380, 200, 120), b(690, 410, 200, 100)]
  const s4 = runs(scatter, 3, SLIDE)
  ok(tidy(scatter).kind === 'grid' && s4.slice(2).every((x) => x === s4[1]), 'a jittered 2×3 scatter of mixed sizes is a grid and settles on the first run')
  const tall = [b(100, 100, 200, 160), b(345, 112), b(610, 95), b(108, 300), b(330, 310, 200, 60), b(598, 305)]
  const t4 = runs(tall, 4, SLIDE)
  ok(t4.slice(2).every((x) => x === t4[1]), `a 2×3 scatter of mixed heights settles on the first run (y of the second row: ${t4.slice(1).map((x) => (JSON.parse(x) as Box[])[3].y).join(' → ')})`)
  const narrow = [b(100, 100, 300, 100), b(100, 240, 100, 100), b(440, 100, 150), b(440, 240, 150), b(640, 100, 150)]
  const n4 = runs(narrow, 3, SLIDE)
  ok(n4.slice(2).every((x) => x === n4[1]), 'a narrow box left in a wide column stays in that column')
  const row = [b(80, 290, 200, 140), b(380, 310, 160, 100), b(700, 300, 120, 80)]
  const r4 = runs(row, 3, SLIDE)
  ok(r4.slice(2).every((x) => x === r4[1]), 'a row of mixed sizes is a fixed point')
}

console.log('\n8. it stays on the slide\n')
{
  const onSlide = (bs: Box[]) => bs.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= SLIDE.w && x.y + x.h <= SLIDE.h)
  const five = [0, 1, 2, 3, 4].map((i) => b(900 + 20 * i, 300, 300, 200)) // overlapping, near the right edge
  const r = tidy(five, SLIDE)
  ok(onSlide(r.boxes), `five overlapping 300×200 boxes near the right edge stay on the slide (x ${r.boxes.map((x) => x.x).join(', ')}; y ${r.boxes.map((x) => x.y).join(', ')})`)
  ok(r.kind === 'grid', `too long for one row, they wrap into a grid (${r.kind})`)
  const gx = gaps(r.boxes.filter((x) => x.y === r.boxes[0].y), 'x')
  ok(same(gx), `still with equal gaps (${gx.join(', ')})`)
  ok(JSON.stringify(tidy(r.boxes, SLIDE).boxes) === JSON.stringify(r.boxes), 'and tidying that again moves nothing')
  const edge = tidy([b(1000, 100), b(1100, 110), b(1240, 95)], SLIDE)
  ok(onSlide(edge.boxes) && edge.kind === 'row', `a row that would run off the right edge is shifted back (x ${edge.boxes.map((x) => x.x).join(', ')})`)
  const low = tidy([b(100, 500, 200, 150), b(110, 600, 200, 150), b(95, 640, 200, 150)], SLIDE)
  ok(onSlide(low.boxes), `a column that would run off the bottom stays on the slide (y ${low.boxes.map((x) => x.y).join(', ')})`)
  ok(JSON.stringify(tidy([b(100, 200), b(340, 210), b(610, 195)], SLIDE).boxes) === JSON.stringify(tidy([b(100, 200), b(340, 210), b(610, 195)]).boxes), 'what already fits is not moved by the bounds')
}

console.log('\n9. when not even two fit on a line, it turns the other way\n')
{
  const onSlide = (bs: Box[]) => bs.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= SLIDE.w && x.y + x.h <= SLIDE.h)
  const settled = (bs: Box[]) => JSON.stringify(tidy(bs, SLIDE).boxes) === JSON.stringify(bs)
  // two overlapping photos read as a column, but two 400-tall ones never fit down a 720 slide
  const photos = tidy([b(300, 20, 500, 400), b(320, 300, 500, 400)], SLIDE)
  ok(onSlide(photos.boxes) && photos.kind === 'row' && photos.boxes[0].y === photos.boxes[1].y, `two 500×400 photos go side by side, on the slide (${photos.boxes.map((x) => `${x.x},${x.y}`).join(' · ')})`)
  ok(settled(photos.boxes), '…and stay there')
  const texts = tidy([b(100, 300, 700, 120), b(300, 310, 700, 120), b(500, 305, 700, 120)], SLIDE)
  ok(onSlide(texts.boxes) && texts.kind === 'col' && texts.boxes.every((x) => x.x === texts.boxes[0].x), `three 700-wide text boxes become a column, on the slide (${texts.boxes.map((x) => `${x.x},${x.y}`).join(' · ')})`)
  ok(settled(texts.boxes), '…and stay one')
  const tall = tidy([b(100, 40, 300, 300), b(110, 360, 300, 300), b(500, 40, 300, 300), b(510, 360, 300, 300), b(100, 680, 300, 300), b(500, 690, 300, 300)])
  const big = tidy(tall.boxes, SLIDE)
  ok(onSlide(big.boxes), `a 2×3 grid taller than the slide is laid out again to fit (${big.kind}: ${big.boxes.map((x) => `${x.x},${x.y}`).join(' · ')})`)
  ok(settled(big.boxes), '…and that is a fixed point')
}

console.log('\n10. a row is a row, a column a column, whatever their sizes\n')
{
  const settled = (bs: Box[]) => { const once = tidy(bs, SLIDE); return JSON.stringify(tidy(once.boxes, SLIDE).boxes) === JSON.stringify(once.boxes) }
  const ts = tidy([b(100, 50, 80, 80), b(220, 60, 80, 600)], SLIDE)
  ok(ts.kind === 'row' && tidy(ts.boxes, SLIDE).kind === 'row' && settled([b(100, 50, 80, 80), b(220, 60, 80, 600)]), 'tall + short side by side: a row, the first run and the second')
  const wn = [b(100, 100, 1000, 80), b(500, 230, 80, 80)]
  ok(tidy(wn, SLIDE).kind === 'col' && settled(wn), 'wide + narrow, one above the other: a column, and it settles')
  const label = [b(100, 300, 200, 60), b(340, 100, 200, 500), b(580, 320, 200, 60)]
  ok(tidy(label, SLIDE).kind === 'row' && settled(label), 'label, tall photo, label: a row, and it settles')
  // fits as a row with its gaps tightened: no wrap
  const four = tidy([b(5, 300, 270, 120), b(285, 300, 270, 120), b(645, 305, 270, 120), b(1005, 298, 270, 120)], SLIDE)
  const g4 = gaps(four.boxes, 'x')
  ok(four.kind === 'row' && four.boxes.every((x) => x.y === four.boxes[0].y) && same(g4) && four.boxes.every((x) => x.x >= 0 && x.x + x.w <= SLIDE.w),
    `four 270-wide boxes that fit stay a row, the gap tightened to fit (${g4.join(', ')})`)
  ok(settled(four.boxes), '…and it settles')
}

console.log('\n11. seeded property check: random rows, columns, grids and scatters\n')
{
  let seed = 20261125
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const R = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo))
  const gen = (kind: number): Box[] => {
    const n = R(2, 9)
    if (kind === 0) { let x = R(0, 120); const y = R(60, 420); return Array.from({ length: n }, () => { const w = R(40, 220), h = R(30, 260), bx = b(x, y + R(-15, 15), w, h); x += w + R(-10, 50); return bx }) }
    if (kind === 1) { let y = R(0, 60); const x = R(60, 900); return Array.from({ length: n }, () => { const w = R(40, 300), h = R(25, 140), bx = b(x + R(-15, 15), y, w, h); y += h + R(-10, 30); return bx }) }
    if (kind === 2) { const r = R(2, 3), c = R(2, 4), out: Box[] = []; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out.push(b(60 + j * R(220, 280) + R(-10, 10), 40 + i * R(200, 230) + R(-10, 10), R(60, 180), R(50, 150))); return out }
    return Array.from({ length: n }, () => { const w = R(30, 360), h = R(30, 280); return b(R(0, SLIDE.w - w), R(0, SLIDE.h - h), w, h) })
  }
  const off = (bs: Box[]) => bs.some((x) => x.x < 0 || x.y < 0 || x.x + x.w > SLIDE.w || x.y + x.h > SLIDE.h)
  const N = 4000
  let moved = 0, offSlide = 0, resized = 0, example = ''
  for (let i = 0; i < N; i++) {
    const bs = gen(i % 4)
    const r1 = tidy(bs, SLIDE).boxes, r2 = tidy(r1, SLIDE).boxes
    const fail = (what: string) => { if (!example) example = `${what}: ${JSON.stringify(bs.map((x) => [x.x, x.y, x.w, x.h]))}` }
    if (JSON.stringify(r1) !== JSON.stringify(r2)) { moved++; fail('moved') }
    if (!off(bs) && off(r1)) { offSlide++; fail('off') }
    if (r1.some((x, j) => x.w !== bs[j].w || x.h !== bs[j].h)) { resized++; fail('resized') }
  }
  ok(moved === 0, `${N} random selections: a second run moves nothing (${moved} moved)`)
  ok(offSlide === 0, `…none that started on the slide leaves it (${offSlide} off)`)
  ok(resized === 0, `…and no size changes (${resized})${example ? ' — first: ' + example : ''}`)
}

console.log('\n12. ordinary slides: a title over its cards, big photos\n')
{
  // a title over three cards is two lines, each its own widths, and stays put
  const titled = [b(80, 40, 1120, 90), b(80, 180, 340, 440), b(470, 180, 340, 440), b(860, 180, 340, 440)]
  const t1 = tidy(titled, SLIDE)
  ok(t1.fits && t1.kind === 'lines' && JSON.stringify(t1.boxes) === JSON.stringify(titled), `a title over three even cards is already tidy: nothing moves (${t1.kind})`)
  const messy = [b(90, 50, 1100, 90), b(80, 175, 340, 440), b(465, 190, 340, 440), b(870, 182, 340, 440)]
  const m1 = tidy(messy, SLIDE)
  const cards = m1.boxes.slice(1)
  ok(m1.fits && cards.every((x) => x.y === cards[0].y) && m1.boxes[0].y + 90 < cards[0].y && m1.boxes.every((x) => x.x + x.w <= SLIDE.w && x.y + x.h <= SLIDE.h),
    `a rough title and cards become two lines on the slide (title ${m1.boxes[0].x},${m1.boxes[0].y}; cards x ${cards.map((x) => x.x).join(', ')})`)
  ok(JSON.stringify(tidy(m1.boxes, SLIDE).boxes) === JSON.stringify(m1.boxes), '…and a second run moves nothing')
  const page = [b(80, 40, 1120, 100), b(80, 170, 560, 450), b(680, 170, 520, 450), b(80, 650, 400, 30), b(1150, 650, 50, 30)]
  const p1 = tidy(page, SLIDE)
  ok(p1.fits && p1.boxes.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= SLIDE.w && x.y + x.h <= SLIDE.h) && JSON.stringify(tidy(p1.boxes, SLIDE).boxes) === JSON.stringify(p1.boxes),
    'title, body, image, footer and page number: on the slide, and settled')
  // two 800×600 photos fit a 1280×720 slide no way at all: nothing moves, and it says so
  const two = [b(100, 50, 800, 600), b(380, 80, 800, 600)]
  const p2 = tidy(two, SLIDE)
  ok(!p2.fits && p2.kind === 'none' && JSON.stringify(p2.boxes) === JSON.stringify(two), 'two 800×600 photos: nothing fits, so nothing moves (fits: false)')
  ok(JSON.stringify(tidy(p2.boxes, SLIDE)) === JSON.stringify(p2), '…the same the second time')
}

console.log('\n13. seeded property check: titled slides, wide elements and big photos, at 1280×720 and 1920×1080\n')
for (const room of [{ w: 1280, h: 720 }, { w: 1920, h: 1080 }]) {
  const k = room.w / 1280
  let seed = 99
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const R = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * k)
  const off = (bs: Box[]) => bs.some((x) => x.x < 0 || x.y < 0 || x.x + x.w > room.w || x.y + x.h > room.h)
  // a shelf packing (tallest first, 8px apart): when it fits, Tidy up must
  const shelf = (bs: Box[]) => {
    const o = bs.map((_, i) => i).sort((m, n) => bs[n].h - bs[m].h)
    let x = 0, y = 0, rh = 0
    for (const i of o) { if (bs[i].w > room.w) return false; if (x > 0 && x + bs[i].w > room.w) { y += rh + 8; x = 0; rh = 0 } x += bs[i].w + 8; rh = Math.max(rh, bs[i].h) }
    return y + rh <= room.h
  }
  const gen = (kind: number): Box[] => {
    if (kind === 0) { // a slide's title and its cards, maybe a footer: select all
      const n = Math.max(1, Math.round(1 + rnd() * 4))
      const out = [b(R(40, 100), R(20, 60), R(900, 1180), R(60, 120))]
      const top = out[0].y + out[0].h + R(10, 40), cw = Math.floor((room.w - R(60, 120)) / n) - R(10, 30)
      for (let i = 0; i < n; i++) out.push(b(R(40, 80) + i * (cw + R(15, 30)), top + R(-10, 10), cw, Math.min(room.h - top - R(10, 40), R(150, 500))))
      if (rnd() < 0.5) out.push(b(R(40, 100), room.h - R(40, 50), R(200, 400), R(24, 32)))
      return out
    }
    if (kind === 1) { // two to four big photos, overlapping
      const n = 2 + Math.floor(rnd() * 3)
      return Array.from({ length: n }, () => { const w = R(400, 900), h = R(300, 650); return b(Math.floor(rnd() * (room.w - w)), Math.floor(rnd() * (room.h - h)), w, h) })
    }
    // title-width strips among small boxes
    const n = Math.round(2 + rnd() * 6)
    return Array.from({ length: n }, (_, i) => { const w = i % 3 === 0 ? R(700, 1200) : R(60, 300), h = R(30, 160); return b(Math.floor(rnd() * (room.w - w)), Math.floor(rnd() * (room.h - h)), w, h) })
  }
  const N = 3000
  let started = 0, moved = 0, offSlide = 0, resized = 0, missed = 0, wrongNone = 0, example = ''
  for (let i = 0; i < N; i++) {
    const bs = gen(i % 3)
    if (off(bs)) continue
    started++
    const r1 = tidy(bs, room), r2 = tidy(r1.boxes, room)
    const fail = (what: string) => { if (!example) example = `${what}: ${JSON.stringify(bs.map((x) => [x.x, x.y, x.w, x.h]))}` }
    if (JSON.stringify(r1.boxes) !== JSON.stringify(r2.boxes)) { moved++; fail('moved') }
    if (off(r1.boxes)) { offSlide++; fail('off') }
    if (r1.boxes.some((x, j) => x.w !== bs[j].w || x.h !== bs[j].h)) { resized++; fail('resized') }
    if (!r1.fits && shelf(bs)) { missed++; fail('a shelf fits, Tidy up gave up') }
    if (!r1.fits && JSON.stringify(r1.boxes) !== JSON.stringify(bs)) { wrongNone++; fail('gave up but moved') }
  }
  const tag = `${room.w}×${room.h}`
  ok(started > N * 0.9 && moved === 0, `${tag}, ${started} selections: a second run moves nothing (${moved} moved)`)
  ok(offSlide === 0, `${tag}: nothing leaves the slide (${offSlide})`)
  ok(missed === 0, `${tag}: whenever a shelf packing fits, Tidy up fits too (${missed} gave up)`)
  ok(wrongNone === 0 && resized === 0, `${tag}: giving up moves nothing, and no size changes (${wrongNone}, ${resized})${example ? ' — first: ' + example : ''}`)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
