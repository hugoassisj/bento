// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Auto layout presets: one click to the three results people reach for —
// equal columns, equal rows, an even grid. A preset only writes keys a frame
// already has (`layout`, a child's `sizing`); the solver (layout.ts) does the
// sharing out, so a child deleted or duplicated later re-shares the room.

import type { FrameLayout, ShapeElement, SlideElement } from './model'

export type LayoutPreset = 'columns' | 'rows' | 'grid'

type Frame = ShapeElement & { layout: FrameLayout }

/** The direction a preset lays its frame out in. */
export const presetDir = (preset: LayoutPreset): FrameLayout['dir'] =>
  preset === 'columns' ? 'row' : preset === 'rows' ? 'col' : 'grid'

/** Runs of elements whose spans overlap on one axis, in order along it: the
 *  columns a loose arrangement forms ('x') or its rows ('y'). */
function runs(els: readonly SlideElement[], axis: 'x' | 'y'): SlideElement[][] {
  const size = axis === 'x' ? 'w' : 'h'
  const out: SlideElement[][] = []
  let end = -Infinity
  for (const e of [...els].sort((m, n) => m[axis] - n[axis])) {
    // more than a pixel of overlap joins the run; touching edges do not
    if (!out.length || e[axis] >= end - 1) { out.push([e]); end = e[axis] + e[size] }
    else { out[out.length - 1].push(e); end = Math.max(end, e[axis] + e[size]) }
  }
  return out
}

/** Reading order: row by row from the top, each row left to right. */
export function readingOrder(els: readonly SlideElement[]): SlideElement[] {
  return runs(els, 'y').flatMap((r) => [...r].sort((m, n) => m.x - n.x))
}

/** The grid a loose arrangement already is: as many columns as it forms
 *  (elements whose horizontal spans overlap share one) and the spacing
 *  between them. One column, or one per element, is no grid yet: then the
 *  squarest, ceil(√n), and no spacing of its own. */
export function gridShape(els: readonly SlideElement[]): { cols: number; gap?: number } {
  const n = els.length
  const cols = runs(els, 'x')
  if (cols.length < 2 || cols.length >= n) return { cols: Math.max(1, Math.ceil(Math.sqrt(n))) }
  const gaps = cols.slice(1).map((c, i) => Math.min(...c.map((e) => e.x)) - Math.max(...cols[i].map((e) => e.x + e.w))).sort((m, n) => m - n)
  const median = Math.round(gaps[Math.floor((gaps.length - 1) / 2)])
  return { cols: cols.length, gap: median > 0 ? median : undefined }
}

/**
 * Turn frame `f` into a preset, its children `kids` in the order given:
 *  - columns: a row, every child filling an equal share of the width;
 *  - rows: a column, every child filling an equal share of the height;
 *  - grid: `cols` equal columns (else the arrangement's own, gridShape).
 * The frame stops hugging; the cross axis stretches. A frame that did not
 * hug keeps its size and place: its children share the room it has, so
 * switching from one preset to another never moves it. A hugging frame (a
 * fresh ⇧A wrap among them) was only ever as big as its children, so it
 * grows right and down where they would not fit at their OWN sizes — a size
 * a fill or a stretch gave them does not count — and stays inside `bounds`
 * (the slide): shifted back up or left, at most the slide's size. Each child
 * is put where the solver will read its slot from, so the order is the one
 * given whatever the old layout was.
 */
export function applyPreset(f: Frame, kids: readonly SlideElement[], preset: LayoutPreset, cols?: number, bounds?: { w: number; h: number }): void {
  const L = f.layout
  // which sizes are the children's own, read under the layout they had
  const { dir: was, align: wasAlign } = L // read before the preset rewrites them
  const stretched = (k: 'w' | 'h') => wasAlign === 'stretch' && (was === 'grid' || (was === 'row' ? k === 'h' : k === 'w'))
  const own = (e: SlideElement, k: 'w' | 'h') => e.sizing?.[k] === 'fill' || stretched(k) ? 0 : e[k]
  const hugged = !!L.hug
  L.dir = presetDir(preset)
  delete L.hug
  delete L.wrap
  L.align = 'stretch'
  const padW = L.pad[1] + L.pad[3], padH = L.pad[0] + L.pad[2]
  const sum = (k: 'w' | 'h') => kids.reduce((a, e) => a + own(e, k), 0)
  const max = (k: 'w' | 'h') => Math.max(0, ...kids.map((e) => own(e, k)))
  const c = preset === 'grid' ? Math.min(64, Math.max(1, Math.round(cols ?? gridShape(kids).cols))) : 1
  const rows = Math.max(1, Math.ceil(kids.length / c))
  const gaps = L.gap * Math.max(0, kids.length - 1)
  if (hugged) {
    const [w, h] = preset === 'grid' ? [padW + c * max('w') + L.gap * (c - 1), padH + rows * max('h') + L.gap * (rows - 1)]
      : preset === 'columns' ? [padW + sum('w') + gaps, padH + max('h')]
      : [padW + max('w'), padH + sum('h') + gaps]
    const grow = (k: 'w' | 'h', v: number) => {
      if (!(Number.isFinite(v) && v > f[k])) return
      const room = bounds?.[k] ?? Infinity
      f[k] = Math.min(v, Math.max(f[k], room))
      // grown past the slide's edge: back inside it, as far as the slide allows
      const P = k === 'w' ? 'x' : 'y'
      if (f[P] + f[k] > room) f[P] = Math.max(0, room - f[k])
    }
    grow('w', w); grow('h', h)
  }
  const [x0, y0] = [f.x + L.pad[3], f.y + L.pad[0]]
  if (preset === 'grid') {
    L.cols = c
    const cw = Math.max(1, (f.w - padW - L.gap * (c - 1)) / c)
    const ch = Math.max(1, (f.h - padH - L.gap * (rows - 1)) / rows)
    kids.forEach((k, i) => {
      // stretch sizes every child to its cell: a fill left from a row or column is not needed
      setFill(k, 'w', false); setFill(k, 'h', false)
      k.x = x0 + (i % c) * (cw + L.gap); k.y = y0 + Math.floor(i / c) * (ch + L.gap)
      k.w = cw; k.h = ch
    })
    return
  }
  const M = preset === 'columns' ? 'w' : 'h'
  kids.forEach((k, i) => {
    setFill(k, M, true)
    setFill(k, M === 'w' ? 'h' : 'w', false) // the cross axis is stretched
    // a strictly rising start along the main axis: the solver's order is position
    if (M === 'w') k.x = x0 + i; else k.y = y0 + i
  })
}

/** Set or clear `sizing[k] = 'fill'`, dropping an emptied `sizing`. */
function setFill(e: SlideElement, k: 'w' | 'h', on: boolean) {
  const s = { ...e.sizing }
  if (on) s[k] = 'fill'
  else delete s[k]
  if (Object.keys(s).length) e.sizing = s
  else delete e.sizing
}
