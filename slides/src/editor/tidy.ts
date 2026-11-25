// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Tidy up: a loose selection put into even lines, a row, a column or a grid
// where it stands, as Figma's Tidy Up does — no frame is made, sizes are
// kept, only positions change. Pure geometry on boxes (no DOM, no store), so
// scripts/test-slides-tidy.ts runs it directly; inspector/arrange.ts applies
// the result to the elements in one undo step.

export interface Box { x: number; y: number; w: number; h: number }
/** 'lines': rows of their own widths stacked down (a title over its cards);
 *  'none': nothing fits the slide, so nothing moved */
export type Arrangement = 'row' | 'col' | 'grid' | 'lines' | 'none'
export interface Tidied { kind: Arrangement; boxes: Box[]; fits: boolean }

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
 * wider: a row when wider than tall, else a column. tidy() takes only the
 * grid from this; everything else it lays out as lines (stack, below).
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
const least = (g: number) => Math.min(g, MIN_GAP)

type Bounds = { w: number; h: number }
const copy = (bs: Box[]) => bs.map((b) => ({ ...b }))
const flip = (b: Box): Box => ({ x: b.y, y: b.x, w: b.h, h: b.w })
const extent = (bs: Box[]) => ({
  x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)),
  w: Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x)),
  h: Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y)),
})
const sameAt = (a: Box[], b: Box[]) => a.every((x, i) => Math.abs(x.x - b[i].x) < 1e-6 && Math.abs(x.y - b[i].y) < 1e-6)

/**
 * Lines: each line left to right at gap `gx` from x0, its boxes top-aligned;
 * the lines stacked down at gap `gy` from y0, each as tall as its tallest
 * box. Every line keeps its own widths — a wide title does not widen the
 * cards under it. A row is one line, a column a line per box.
 */
function stack(boxes: Box[], lines: number[][], gx: number, gy: number, x0: number, y0: number): Box[] {
  const out = copy(boxes)
  let y = y0
  for (const line of lines) {
    let x = x0, tall = 0
    for (const i of line) { out[i].x = x; out[i].y = y; x += boxes[i].w + gx; tall = Math.max(tall, boxes[i].h) }
    y += tall + gy
  }
  return out
}

/** The lines the boxes already form: their bands across, top to bottom,
 *  each left to right — reading order. */
function linesOf(boxes: Box[]): number[][] {
  const rows = bands(boxes, 'y')
  const lines = Array.from({ length: Math.max(...rows) + 1 }, () => [] as number[])
  boxes.forEach((_, i) => lines[rows[i]].push(i))
  for (const l of lines) l.sort((a, b) => boxes[a].x - boxes[b].x || a - b)
  return lines
}

/** The gaps the lines already have: the median along them and the median
 *  between them (track to track); where there is only one kind, both. */
function lineGaps(boxes: Box[], lines: number[][]): [number, number] {
  const along: number[] = []
  for (const l of lines) for (let j = 1; j < l.length; j++) along.push(boxes[l[j]].x - (boxes[l[j - 1]].x + boxes[l[j - 1]].w))
  const top = lines.map((l) => Math.min(...l.map((i) => boxes[i].y)))
  const foot = lines.map((l) => Math.max(...l.map((i) => boxes[i].y + boxes[i].h)))
  const down = top.slice(1).map((t, k) => t - foot[k])
  const gx = along.length ? keep(median(along)) : down.length ? keep(median(down)) : 16
  const gy = down.length ? keep(median(down)) : gx
  return [gx, gy]
}

/** Each line broken into as many as `room` holds across (next fit). */
function wrap(boxes: Box[], lines: number[][], gap: number, room: number): number[][] {
  const out: number[][] = []
  for (const l of lines) {
    let cur: number[] = [], at = 0
    for (const i of l) {
      if (cur.length && at + gap + boxes[i].w > room) { out.push(cur); cur = []; at = 0 }
      at += (cur.length ? gap : 0) + boxes[i].w
      cur.push(i)
    }
    if (cur.length) out.push(cur)
  }
  return out
}

/**
 * The layouts to try, in rows (the caller flips the boxes for columns), in
 * order: the lines as they stand at their own gaps; with the gaps tightened
 * to fit (down to MIN_GAP); each line wrapped where it runs too long, at its
 * gaps, then at the smallest; everything in reading order wrapped at the
 * smallest; shelves, tallest first, at the smallest. `lines` is the reading.
 */
function rowLayouts(boxes: Box[], lines: number[][], room: Bounds): Box[][] {
  const [gx, gy] = lineGaps(boxes, lines)
  const first = boxes[lines[0][0]]
  const at = (ls: number[][], ax: number, ay: number) => stack(boxes, ls, ax, ay, first.x, first.y)
  const out = [at(lines, gx, gy)]
  // tightened: the widest line and the stack just fit, where MIN_GAP allows
  let tx = gx, ty = gy
  for (const l of lines) if (l.length > 1) tx = Math.min(tx, Math.floor((room.w - l.reduce((a, i) => a + boxes[i].w, 0)) / (l.length - 1)))
  if (lines.length > 1) ty = Math.min(ty, Math.floor((room.h - lines.reduce((a, l) => a + Math.max(...l.map((i) => boxes[i].h)), 0)) / (lines.length - 1)))
  out.push(at(lines, Math.max(least(gx), tx), Math.max(least(gy), ty)))
  out.push(at(wrap(boxes, lines, gx, room.w), gx, gy))
  const lx = least(gx), ly = least(gy)
  out.push(at(wrap(boxes, lines, lx, room.w), lx, ly))
  out.push(at(wrap(boxes, [lines.flat()], lx, room.w), lx, ly))
  const tallest = lines.flat().sort((a, b) => boxes[b].h - boxes[a].h)
  out.push(at(wrap(boxes, [tallest], lx, room.w), lx, ly))
  return out
}

/** A layout's shape, read from where the boxes are (so the same boxes always
 *  get the same name): one line, one column, a grid, or lines. */
function shapeOf(bs: Box[]): Arrangement {
  const ls = linesOf(bs)
  if (ls.length === 1) return 'row'
  if (ls.every((l) => l.length === 1)) return 'col'
  return detect(bs).kind === 'grid' ? 'grid' : 'lines'
}

/**
 * Tidy up, kept on the slide (`bounds`).
 *
 * A selection already tidy — any arrangement this function makes, on the
 * slide — is left exactly where it is, so a second run never moves anything.
 * Otherwise the first layout that fits the slide wins: a detected grid
 * (columns as wide as their widest box, the gaps between tracks it had, then
 * tightened); then the lines the boxes form, in reading order — bands across,
 * top to bottom, each left to right (a diagonal reads as one line along its
 * wider spread) — as they are, tightened, wrapped, re-flowed and finally as
 * shelves tallest first; then the same down the columns. The winner is shifted
 * back inside the slide. When nothing fits, nothing moves: `fits` is false
 * and the caller says so.
 */
export function tidy(boxes: Box[], bounds?: Bounds): Tidied {
  if (boxes.length < 2) return { kind: 'row', boxes: copy(boxes), fits: true }
  const room = bounds ?? { w: Infinity, h: Infinity }
  const inside = (bs: Box[]) => !bounds || bs.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= room.w && b.y + b.h <= room.h)
  const fitsIn = (bs: Box[]) => { const e = extent(bs); return e.w <= room.w && e.h <= room.h }
  const d = detect(boxes)
  const grid = (gx: number, gy: number) => place(boxes, d.rows, d.cols, gx, gy, extent(boxes).x, extent(boxes).y)
  // the arrangement as each reading would leave it, gaps as they are
  const asRows = (bs: Box[]) => rowLayouts(bs, linesOf(bs), room)[0]
  const asCols = (bs: Box[]) => rowLayouts(bs.map(flip), linesOf(bs.map(flip)), { w: room.h, h: room.w })[0].map(flip)
  const asGrid = d.kind === 'grid' ? grid(trackGap(boxes, d.cols, 'x'), trackGap(boxes, d.rows, 'y')) : null
  if (inside(boxes)) {
    if ((asGrid && sameAt(asGrid, boxes)) || sameAt(asRows(boxes), boxes) || sameAt(asCols(boxes), boxes)) return { kind: shapeOf(boxes), boxes: copy(boxes), fits: true }
  }
  // each try: the layout, and the reading that made it
  const tries: [Box[], 'grid' | 'rows' | 'cols'][] = []
  if (asGrid) {
    tries.push([asGrid, 'grid'])
    // tighten the gaps of the axis that overruns, down to MIN_GAP at the least
    const gx = trackGap(boxes, d.cols, 'x'), gy = trackGap(boxes, d.rows, 'y')
    const nc = Math.max(...d.cols) + 1, nr = Math.max(...d.rows) + 1, e = extent(asGrid)
    tries.push([grid(e.w > room.w ? Math.max(least(gx), gx - Math.ceil((e.w - room.w) / (nc - 1))) : gx,
      e.h > room.h ? Math.max(least(gy), gy - Math.ceil((e.h - room.h) / (nr - 1))) : gy), 'grid'])
  }
  // a diagonal — every box a band of its own both ways — is one line along
  // its wider spread (a column, read the other way, comes out of the bands)
  const n = boxes.length
  const diagonal = Math.max(...d.rows) + 1 === n && Math.max(...d.cols) + 1 === n
  const wide = extent(boxes.map((b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2, w: 0, h: 0 })))
  const rowsRead = diagonal && wide.w >= wide.h ? [boxes.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x)] : linesOf(boxes)
  for (const b of rowLayouts(boxes, rowsRead, room)) tries.push([b, 'rows'])
  const fl = boxes.map(flip)
  for (const b of rowLayouts(fl, linesOf(fl), { w: room.h, h: room.w })) tries.push([b.map(flip), 'cols'])
  for (const [bs] of tries) {
    if (!fitsIn(bs)) continue
    if (bounds) {
      // shift back inside: off the far edge first, then never past the near one
      const e = extent(bs)
      const dx = e.x < 0 ? -e.x : e.x + e.w > room.w ? room.w - e.x - e.w : 0
      const dy = e.y < 0 ? -e.y : e.y + e.h > room.h ? room.h - e.y - e.h : 0
      for (const b of bs) { b.x += dx; b.y += dy }
    }
    return { kind: shapeOf(bs), boxes: bs, fits: true }
  }
  return { kind: 'none', boxes: copy(boxes), fits: false }
}
