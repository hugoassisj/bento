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
// boxes. Nothing is pushed off the slide: a row too long for it wraps into a
// grid, and an arrangement past an edge is shifted back.

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

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
