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
 * What the boxes already look like, decided by bands first: all in one band
 * across (one y-band) is a row, all in one band down (one x-band) a column —
 * so a tidied row of tall and short boxes, top-aligned, still reads as a row.
 * Two or more of each, every box in a cell of its own and more boxes than
 * the longest line holds, is a grid (a diagonal is not). Anything else — a
 * loose scatter, or a pile all in one spot — goes by where the centres spread
 * wider: a row when wider than tall, else a column.
 */
export function detect(boxes: Box[]): { kind: Arrangement; rows: number[]; cols: number[] } {
  const rows = bands(boxes, 'y'), cols = bands(boxes, 'x')
  const nr = Math.max(-1, ...rows) + 1, nc = Math.max(-1, ...cols) + 1
  if (nr === 1 && nc > 1) return { kind: 'row', rows, cols }
  if (nc === 1 && nr > 1) return { kind: 'col', rows, cols }
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

/** The smallest gap Tidy up tightens to before it wraps (never more than the
 *  gap the boxes already had). */
const MIN_GAP = 8

type Bounds = { w: number; h: number }
const extent = (bs: Box[]) => ({
  w: Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x)),
  h: Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y)),
})
const fitsIn = (bs: Box[], bounds?: Bounds) => { if (!bounds) return true; const e = extent(bs); return e.w <= bounds.w && e.h <= bounds.h }

/**
 * Lines of boxes in `order`: along x for 'row' (lines stacked down), along y
 * for 'col' (lines side by side), as many to a line as `room` holds along it
 * (at least one), every gap `gap`, from the first box's corner.
 * One to a line turns a row into a column and a column into a row.
 */
function flow(boxes: Box[], order: number[], dir: 'row' | 'col', gap: number, room: number): Box[] {
  const s = dir === 'row' ? 'w' : 'h'
  const lineOf = (n: number) => {
    // the longest a line of n gets, each slot as long as its longest box
    const slot = new Array<number>(n).fill(0)
    order.forEach((i, j) => { slot[j % n] = Math.max(slot[j % n], boxes[i][s]) })
    return slot.reduce((a, v) => a + v, 0) + gap * (n - 1)
  }
  let k = order.length
  while (k > 1 && lineOf(k) > room) k--
  const along = new Array<number>(boxes.length), across = new Array<number>(boxes.length)
  order.forEach((i, j) => { along[i] = j % k; across[i] = Math.floor(j / k) })
  const first = boxes[order[0]]
  return dir === 'row' ? place(boxes, across, along, gap, gap, first.x, first.y) : place(boxes, along, across, gap, gap, first.x, first.y)
}

/**
 * Lay `order` out as a row or a column that keeps to `bounds`: one line at
 * the gap it had; else one line with the gap tightened (down to MIN_GAP) —
 * a row that fits stays a row; else wrapped into lines at that gap, then at
 * the smallest, then the other way round, then as shelves tallest first.
 * Null when nothing fits (more box than slide).
 */
function line(boxes: Box[], order: number[], dir: 'row' | 'col', gap: number, bounds?: Bounds): { kind: Arrangement; boxes: Box[] } | null {
  const n = order.length
  const one = flow(boxes, order, dir, gap, Infinity)
  if (!bounds || fitsIn(one, bounds)) return { kind: dir, boxes: one }
  const s = dir === 'row' ? 'w' : 'h'
  const room = dir === 'row' ? bounds.w : bounds.h, cross = dir === 'row' ? bounds.h : bounds.w
  const least = Math.min(gap, MIN_GAP)
  const tight = Math.floor((room - order.reduce((a, i) => a + boxes[i][s], 0)) / (n - 1))
  if (tight >= least) {
    const t = flow(boxes, order, dir, tight, Infinity)
    if (fitsIn(t, bounds)) return { kind: dir, boxes: t }
  }
  const other = dir === 'row' ? 'col' : 'row'
  const kindOf = (bs: Box[]) => detect(bs).kind
  // the other way round reads along its own axis; the last resort packs
  // shelves tallest first (widest first for columns), which fits far more
  const along = (d: 'row' | 'col') => [...order].sort((m, q) => (d === 'row' ? boxes[m].x - boxes[q].x : boxes[m].y - boxes[q].y))
  const shelves = (d: 'row' | 'col') => [...order].sort((m, q) => (d === 'row' ? boxes[q].h - boxes[m].h : boxes[q].w - boxes[m].w))
  const tries: [('row' | 'col'), number, number, number[]][] = [
    [dir, gap, room, order], [dir, least, room, order], [other, gap, cross, along(other)], [other, least, cross, along(other)],
    [dir, least, room, shelves(dir)], [other, least, cross, shelves(other)],
  ]
  for (const [d, g, r, o] of tries) {
    const w = flow(boxes, o, d, g, r)
    if (fitsIn(w, bounds)) return { kind: kindOf(w), boxes: w }
  }
  return null
}

/**
 * The tidied boxes, in the order given. A row lines up on the top edge of its
 * first (leftmost) box and runs right from it at the median gap; a column on
 * the left edge of its topmost box, running down. A grid snaps to its rows and
 * columns from the top-left corner of the selection: each column as wide as
 * its widest box, each row as tall as its tallest, the gaps between columns
 * and between rows the medians already there. A loose scatter that is not a
 * grid is put in order along its wider spread (by x for a row) and laid out
 * as a row or column.
 *
 * With `bounds` (the slide), the result keeps to it whenever it can: a row
 * or column too long first tightens its gap (to MIN_GAP at the least), then
 * wraps into lines — one to a line turns it the other way — and a grid
 * too big tightens its gaps, then is laid out again in reading order; the
 * whole is then shifted back inside. Only boxes that cannot fit the slide in
 * any arrangement overrun it, from its top-left corner. Tidying a tidied
 * selection moves nothing.
 */
export function tidy(boxes: Box[], bounds?: Bounds): { kind: Arrangement; boxes: Box[] } {
  // Every arrangement that fits is a fixed point by construction. The loop is
  // a safety net for one that could read differently a second time (an
  // overfull scatter): it is tidied again until it settles, so a second Tidy
  // up never moves anything. 20000 random scatters never needed it.
  let r = once(boxes, bounds)
  for (let i = 0; i < 4; i++) {
    const next = once(r.boxes, bounds)
    if (next.boxes.every((b, j) => b.x === r.boxes[j].x && b.y === r.boxes[j].y)) break
    r = next
  }
  return r
}

function once(boxes: Box[], bounds?: Bounds): { kind: Arrangement; boxes: Box[] } {
  if (boxes.length < 2) return { kind: 'row', boxes: boxes.map((b) => ({ ...b })) }
  const d = detect(boxes)
  let r: { kind: Arrangement; boxes: Box[] }
  if (d.kind === 'grid') {
    let gx = trackGap(boxes, d.cols, 'x'), gy = trackGap(boxes, d.rows, 'y')
    const at = (gx2: number, gy2: number) => place(boxes, d.rows, d.cols, gx2, gy2, Math.min(...boxes.map((b) => b.x)), Math.min(...boxes.map((b) => b.y)))
    let g = at(gx, gy)
    if (bounds && !fitsIn(g, bounds)) {
      // tighten the gaps of the axis that overruns, down to MIN_GAP at the least
      const nc = Math.max(...d.cols) + 1, nr = Math.max(...d.rows) + 1
      const e = extent(g)
      if (e.w > bounds.w) gx = Math.max(Math.min(gx, MIN_GAP), gx - Math.ceil((e.w - bounds.w) / (nc - 1)))
      if (e.h > bounds.h) gy = Math.max(Math.min(gy, MIN_GAP), gy - Math.ceil((e.h - bounds.h) / (nr - 1)))
      g = at(gx, gy)
    }
    if (!bounds || fitsIn(g, bounds)) r = { kind: 'grid', boxes: g }
    else {
      // still too big: the grid again, in reading order, as lines that fit
      // nothing fits at all: the grid stays a grid at its tightest, so a
      // second run finds the same and moves nothing
      const order = boxes.map((_, i) => i).sort((a, b) => d.rows[a] - d.rows[b] || d.cols[a] - d.cols[b])
      r = line(boxes, order, 'row', gx, bounds) ?? { kind: 'grid', boxes: g }
    }
  } else {
    const p = d.kind === 'row' ? 'x' : 'y'
    const order = boxes.map((_, i) => i).sort((a, b) => boxes[a][p] - boxes[b][p])
    const gap = medianGap(boxes, p)
    // nothing fits at all: wrapped at the smallest gap, from the slide's corner
    r = line(boxes, order, d.kind, gap, bounds) ?? (() => {
      const w = flow(boxes, order, d.kind as 'row' | 'col', Math.min(gap, MIN_GAP), d.kind === 'row' ? bounds!.w : bounds!.h)
      return { kind: detect(w).kind, boxes: w }
    })()
  }
  const out = r.boxes
  if (bounds) {
    // shift back inside: off the far edge first, then never past the near one
    const fit = (lo: number, hi: number, room: number) => { let dv = hi > room ? room - hi : 0; if (lo + dv < 0) dv = -lo; return dv }
    const dx = fit(Math.min(...out.map((b) => b.x)), Math.max(...out.map((b) => b.x + b.w)), bounds.w)
    const dy = fit(Math.min(...out.map((b) => b.y)), Math.max(...out.map((b) => b.y + b.h)), bounds.h)
    for (const b of out) { b.x += dx; b.y += dy }
  }
  return r
}
