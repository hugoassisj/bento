// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Tidy up: a loose selection put into an even row, column or grid where it
// stands, as Figma's Tidy Up does — no frame is made, sizes are kept, only
// positions change. Pure geometry on boxes (no DOM, no store), so
// scripts/test-slides-tidy.ts runs it directly; inspector/arrange.ts applies
// the result to the elements in one undo step.

export interface Box { x: number; y: number; w: number; h: number }
export type Arrangement = 'row' | 'col' | 'grid'

/**
 * Bands along one axis: boxes sorted by centre, each joining the current band
 * while its centre is within half the smaller box's extent of the band's mean
 * centre. Returns each box's band index, bands numbered in reading order.
 */
function bands(boxes: Box[], axis: 'x' | 'y'): number[] {
  const c = (b: Box) => (axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2)
  const ext = (b: Box) => (axis === 'x' ? b.w : b.h)
  const order = boxes.map((_, i) => i).sort((a, b) => c(boxes[a]) - c(boxes[b]))
  const out = new Array<number>(boxes.length)
  let band = -1, sum = 0, n = 0, small = Infinity
  for (const i of order) {
    const b = boxes[i]
    if (n && Math.abs(c(b) - sum / n) <= Math.min(small, ext(b)) / 2) {
      sum += c(b); n++; small = Math.min(small, ext(b))
    } else {
      band++; sum = c(b); n = 1; small = ext(b)
    }
    out[i] = band
  }
  return out
}

/**
 * What the boxes already look like: a grid when they fall into two or more
 * rows AND two or more columns, every box in a cell of its own, and there are
 * more boxes than the longest line holds (a diagonal is not a grid);
 * otherwise a row when their centres spread wider than tall, else a column.
 */
export function detect(boxes: Box[]): { kind: Arrangement; rows: number[]; cols: number[] } {
  const rows = bands(boxes, 'y'), cols = bands(boxes, 'x')
  const nr = Math.max(-1, ...rows) + 1, nc = Math.max(-1, ...cols) + 1
  const cells = new Set(boxes.map((_, i) => rows[i] * nc + cols[i]))
  if (nr >= 2 && nc >= 2 && cells.size === boxes.length && boxes.length > Math.max(nr, nc)) return { kind: 'grid', rows, cols }
  const cx = boxes.map((b) => b.x + b.w / 2), cy = boxes.map((b) => b.y + b.h / 2)
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v)
  return { kind: spread(cx) >= spread(cy) ? 'row' : 'col', rows, cols }
}

/** The median of the gaps between neighbours along an axis — the spacing the
 *  boxes already have, so one stray does not set it. Overlaps have none to
 *  keep: 16, as auto layout's frame gap does (inspector/layout.ts spacing). */
export function medianGap(boxes: Box[], axis: 'x' | 'y'): number {
  const [p, s] = axis === 'x' ? ['x', 'w'] as const : ['y', 'h'] as const
  const run = [...boxes].sort((m, n) => m[p] - n[p])
  const gaps = run.slice(1).map((b, i) => b[p] - (run[i][p] + run[i][s])).sort((m, n) => m - n)
  const median = gaps.length ? Math.round(gaps[Math.floor((gaps.length - 1) / 2)]) : 0
  return median > 0 ? median : 16
}

/**
 * The tidied boxes, in the order given. A row lines up on the top edge of its
 * first (leftmost) box and runs right from it at the median gap; a column on
 * the left edge of its topmost box, running down. A grid snaps to its rows and
 * columns from the top-left corner of the selection: each column as wide as
 * its widest box, each row as tall as its tallest, every column gap the median
 * of the gaps along the rows, every row gap the median down the columns.
 */
export function tidy(boxes: Box[]): { kind: Arrangement; boxes: Box[] } {
  if (boxes.length < 2) return { kind: 'row', boxes: boxes.map((b) => ({ ...b })) }
  const d = detect(boxes)
  const out = boxes.map((b) => ({ ...b }))
  if (d.kind === 'grid') {
    const nr = Math.max(...d.rows) + 1, nc = Math.max(...d.cols) + 1
    const line = (band: number[], k: number) => boxes.filter((_, i) => band[i] === k)
    const gapsAlong = (band: number[], n: number, axis: 'x' | 'y') => {
      const all: number[] = []
      for (let k = 0; k < n; k++) {
        const g = line(band, k)
        if (g.length > 1) all.push(medianGap(g, axis))
      }
      all.sort((m, n2) => m - n2)
      return all.length ? all[Math.floor((all.length - 1) / 2)] : 16
    }
    const gx = gapsAlong(d.rows, nr, 'x'), gy = gapsAlong(d.cols, nc, 'y')
    const colW = Array.from({ length: nc }, (_, k) => Math.max(...line(d.cols, k).map((b) => b.w)))
    const rowH = Array.from({ length: nr }, (_, k) => Math.max(...line(d.rows, k).map((b) => b.h)))
    const colX: number[] = [], rowY: number[] = []
    let x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
    for (let k = 0; k < nc; k++) { colX.push(x); x += colW[k] + gx }
    for (let k = 0; k < nr; k++) { rowY.push(y); y += rowH[k] + gy }
    out.forEach((b, i) => { b.x = colX[d.cols[i]]; b.y = rowY[d.rows[i]] })
    return { kind: 'grid', boxes: out }
  }
  const [p, s, q] = d.kind === 'row' ? ['x', 'w', 'y'] as const : ['y', 'h', 'x'] as const
  const gap = medianGap(boxes, p)
  const order = out.map((_, i) => i).sort((a, b) => boxes[a][p] - boxes[b][p])
  const first = boxes[order[0]]
  let at = first[p]
  for (const i of order) {
    out[i][q] = first[q]
    out[i][p] = at
    at += boxes[i][s] + gap
  }
  return { kind: d.kind, boxes: out }
}
