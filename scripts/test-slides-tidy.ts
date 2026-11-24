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
// tidied selection is a fixed point (tidying again moves nothing).

import { detect, medianGap, tidy, type Box } from '../slides/src/editor/tidy.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) } else console.log(`  ok    ${msg}`)
}
const b = (x: number, y: number, w = 200, h = 120): Box => ({ x, y, w, h })
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

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
