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
 * Bands along one axis: boxes sorted by their start, each joining the current
 * band while it overlaps the band by at least half of the smaller of the two
 * extents. Overlap, not centres: a narrow box left-aligned in a wide column
 * is in that column, which is what a tidied grid looks like. Returns each
 * box's band index, bands numbered in reading order.
 */
function bands(boxes: Box[], axis: 'x' | 'y'): number[] {
  const lo = (b: Box) => (axis === 'x' ? b.x : b.y)
  const ext = (b: Box) => (axis === 'x' ? b.w : b.h)
  const order = boxes.map((_, i) => i).sort((a, b) => lo(boxes[a]) - lo(boxes[b]))
  const out = new Array<number>(boxes.length)
  let band = -1, from = 0, to = -Infinity
  for (const i of order) {
    const b = boxes[i]
    const a0 = lo(b), a1 = a0 + ext(b)
    const overlap = Math.min(a1, to) - Math.max(a0, from)
    if (band >= 0 && overlap > 0 && overlap >= Math.min(ext(b), to - from) / 2) {
      to = Math.max(to, a1)
    } else {
      band++; from = a0; to = a1
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

/** A gap as a frame would take it: rounded, and 16 where there is none to
 *  keep (overlaps), as auto layout's frame gap does (inspector/layout.ts). */
const keep = (g: number) => (Math.round(g) > 0 ? Math.round(g) : 16)
const median = (v: number[]) => [...v].sort((m, n) => m - n)[Math.floor((v.length - 1) / 2)]

/** The median of the gaps between neighbours along an axis — the spacing the
 *  boxes already have, so one stray does not set it. */
export function medianGap(boxes: Box[], axis: 'x' | 'y'): number {
  const [p, s] = axis === 'x' ? ['x', 'w'] as const : ['y', 'h'] as const
  const run = [...boxes].sort((m, n) => m[p] - n[p])
  const gaps = run.slice(1).map((b, i) => b[p] - (run[i][p] + run[i][s]))
  return keep(gaps.length ? median(gaps) : 0)
}

/** Boxes into cells: each column as wide as its widest box, each row as tall
 *  as its tallest, every box at its cell's top-left corner. */
function place(boxes: Box[], rows: number[], cols: number[], gx: number, gy: number, x0: number, y0: number): Box[] {
  const nr = Math.max(...rows) + 1, nc = Math.max(...cols) + 1
  const colW = new Array<number>(nc).fill(0), rowH = new Array<number>(nr).fill(0)
  boxes.forEach((b, i) => { colW[cols[i]] = Math.max(colW[cols[i]], b.w); rowH[rows[i]] = Math.max(rowH[rows[i]], b.h) })
  const colX: number[] = [], rowY: number[] = []
  for (let k = 0, x = x0; k < nc; k++) { colX.push(x); x += colW[k] + gx }
  for (let k = 0, y = y0; k < nr; k++) { rowY.push(y); y += rowH[k] + gy }
  return boxes.map((b, i) => ({ ...b, x: colX[cols[i]], y: rowY[rows[i]] }))
}

/** The gap between neighbouring tracks (columns or rows) as a band forms
 *  them: from one track's far edge to the next one's near edge — between
 *  TRACKS, not boxes, so a narrow box in a wide column does not read as a
 *  wider gap (which made each run drift). */
function trackGap(boxes: Box[], band: number[], axis: 'x' | 'y'): number {
  const [p, s] = axis === 'x' ? ['x', 'w'] as const : ['y', 'h'] as const
  const n = Math.max(...band) + 1
  const lo = new Array<number>(n).fill(Infinity), hi = new Array<number>(n).fill(-Infinity)
  boxes.forEach((b, i) => { lo[band[i]] = Math.min(lo[band[i]], b[p]); hi[band[i]] = Math.max(hi[band[i]], b[p] + b[s]) })
  const gaps = lo.slice(1).map((l, k) => l - hi[k])
  return keep(gaps.length ? median(gaps) : 0)
}

/**
 * The tidied boxes, in the order given. A row lines up on the top edge of its
 * first (leftmost) box and runs right from it at the median gap; a column on
 * the left edge of its topmost box, running down. A grid snaps to its rows and
 * columns from the top-left corner of the selection: each column as wide as
 * its widest box, each row as tall as its tallest, the gaps between columns
 * and between rows the medians already there.
 *
 * With `bounds` (the slide), the result stays on it: a row or column too long
 * for the slide wraps into a grid of as many per line as fit, and the whole
 * arrangement is shifted back inside. Tidying a tidied selection moves nothing.
 */
export function tidy(boxes: Box[], bounds?: { w: number; h: number }): { kind: Arrangement; boxes: Box[] } {
  if (boxes.length < 2) return { kind: 'row', boxes: boxes.map((b) => ({ ...b })) }
  const d = detect(boxes)
  let kind = d.kind
  let out: Box[]
  if (d.kind === 'grid') {
    out = place(boxes, d.rows, d.cols, trackGap(boxes, d.cols, 'x'), trackGap(boxes, d.rows, 'y'),
      Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y)))
  } else {
    const row = d.kind === 'row'
    const [p, s] = row ? ['x', 'w'] as const : ['y', 'h'] as const
    const gap = medianGap(boxes, p)
    const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][p] - boxes[b][p])
    const first = boxes[order[0]]
    // as many per line as the slide holds — all of them, without bounds
    const room = bounds ? (row ? bounds.w : bounds.h) : Infinity
    const lineOf = (k: number) => {
      // the longest a line of k gets, each slot as long as its longest box
      const slot = new Array<number>(k).fill(0)
      order.forEach((i, j) => { slot[j % k] = Math.max(slot[j % k], boxes[i][s]) })
      return slot.reduce((a, v) => a + v, 0) + gap * (k - 1)
    }
    let k = order.length
    while (k > 1 && lineOf(k) > room) k--
    if (k < order.length && k > 1) kind = 'grid'
    else k = order.length
    const along = new Array<number>(boxes.length), across = new Array<number>(boxes.length)
    order.forEach((i, j) => { along[i] = j % k; across[i] = Math.floor(j / k) })
    out = row ? place(boxes, across, along, gap, gap, first.x, first.y) : place(boxes, along, across, gap, gap, first.x, first.y)
  }
  if (bounds) {
    // shift back inside: off the far edge first, then never past the near one
    const fit = (lo: number, hi: number, room: number) => { let dv = hi > room ? room - hi : 0; if (lo + dv < 0) dv = -lo; return dv }
    const dx = fit(Math.min(...out.map((b) => b.x)), Math.max(...out.map((b) => b.x + b.w)), bounds.w)
    const dy = fit(Math.min(...out.map((b) => b.y)), Math.max(...out.map((b) => b.y + b.h)), bounds.h)
    for (const b of out) { b.x += dx; b.y += dy }
  }
  return { kind, boxes: out }
}
