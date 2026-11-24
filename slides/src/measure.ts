// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Text measurement — `window.bento.measure()`.
//
// WHY THIS EXISTS. The format is absolute pixels, which is what lets morph, the
// editor's drag handles and the renderer all work from one representation. The
// cost lands on whoever is generating a deck without a screen: the rendered
// height of a string, for a given font, size, weight and lineHeight, is
// unknowable without a render. So every card, caption and two-line heading is a
// guess, and overflow and collisions are downstream of that one gap.
//
// This closes it. Give it text and a width, get back the height that text needs
// — before the element exists, so an agent can size a box rather than guess it
// and correct later.
//
// It measures by RENDERING, through `renderElement`, the same path the editor,
// present mode and thumbnails use. A reimplementation — canvas measureText, a
// line-count estimate — would drift from the renderer the moment anything about
// text layout changed, and drift in a measuring tool is worse than no tool: it
// reads as authoritative and is quietly wrong.

import type { Area } from './contrast.ts'
import type { SlideElement } from './model.ts'
import type { BentoDoc, TableElement, TextElement } from './model.ts'
import { defaultText } from './model.ts'
import { renderElement } from './render.ts'

/** What to measure. Anything omitted falls back to the deck's text defaults. */
export interface TextMeasureSpec {
  html: string
  /** box width in slide px — the thing that decides where lines wrap */
  w: number
  /** box height, if you have one and want `fits`/`overflow` computed */
  h?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
}

export interface TextMeasurement {
  /** height this content needs at this width, in slide px, rounded up */
  height: number
  /** the width it was measured at, echoed back */
  width: number
  /** how many lines it wrapped to */
  lines: number
  /** only when `h` was supplied: does the content fit the box? */
  fits?: boolean
  /** only when `h` was supplied: px of overflow (0 when it fits) */
  overflow?: number
}

/**
 * A hidden host that is in the document (so layout runs) but paints nothing.
 *
 * visibility:hidden rather than display:none — a display:none subtree has no
 * layout at all and every height would read 0. Marked transient so
 * `serializeBody` strips it if a save ever races a measurement.
 */
function withHost<T>(fn: (host: HTMLElement) => T): T {
  const host = document.createElement('div')
  host.setAttribute('data-bento-transient', '')
  host.style.cssText =
    'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:strict;'
  document.body.appendChild(host)
  try {
    return fn(host)
  } finally {
    host.remove()
  }
}

/**
 * Measure one text element as the renderer would lay it out.
 *
 * `doc` supplies the theme font and the embedded faces, so measuring against
 * the deck the text will live in is the whole point — the same string in
 * Fraunces and in a system stack are different heights.
 */
export function measureText(spec: TextMeasureSpec, doc: BentoDoc): TextMeasurement {
  return withHost((host) => measureInto(host, spec, doc))
}

/** One measurement inside an already-open host. */
function measureInto(host: HTMLElement, spec: TextMeasureSpec, doc: BentoDoc): TextMeasurement {
  const el = defaultText({
    ...spec,
    id: 'bento-measure',
    x: 0,
    y: 0,
    w: spec.w,
    h: spec.h ?? 10,
  })
  const node = renderElement(el, doc)
  // The box height is what we are trying to find, so it must not constrain the
  // measurement — let the inner text take whatever height it needs.
  node.style.height = 'auto'
  host.appendChild(node)
  const inner = node.querySelector<HTMLElement>('.bento-text-inner') ?? node
  const height = Math.ceil(inner.getBoundingClientRect().height)
  // lineHeight is unitless in the model, so one line is fontSize * lineHeight
  const per = (el.fontSize ?? 16) * (el.lineHeight ?? 1.2)
  const lines = Math.max(1, Math.round(height / Math.max(per, 1)))
  node.remove()
  const out: TextMeasurement = { height, width: spec.w, lines }
  if (typeof spec.h === 'number') {
    out.fits = height <= spec.h
    out.overflow = Math.max(0, height - spec.h)
  }
  return out
}

/**
 * Measure many elements through ONE host — what `validate()` uses to check a
 * whole deck. Opening a host per element would be the same answer and a lot
 * more DOM churn on a long deck.
 */
export function measureElements(els: TextElement[], doc: BentoDoc): TextMeasurement[] {
  if (!els.length) return []
  return withHost((host) => els.map((el) => measureInto(host, specOf(el), doc)))
}

/** How tall a table's rows actually render, and how far past its box. */
export interface TableMeasurement {
  /** height the rows need at the element's width, in slide px, rounded up */
  height: number
  /** px the rows run past the element's `h` (0 when they fit) */
  overflow: number
}

/**
 * Measure tables the same way — rendered through `renderElement`, at the
 * element's own width and height, in one host. A table's `height:100%` is a
 * MINIMUM (a table never shrinks below its rows), so the rendered table height
 * is what the rows need. offsetHeight, not the bounding box, so a rotated
 * table measures its own height and not its rotated extent.
 */
export function measureTables(els: TableElement[], doc: BentoDoc): TableMeasurement[] {
  if (!els.length) return []
  return withHost((host) => els.map((el) => {
    const node = renderElement({ ...el, x: 0, y: 0 }, doc)
    host.appendChild(node)
    const table = node.querySelector<HTMLElement>('.bento-table')
    const height = Math.ceil(table ? table.offsetHeight : el.h)
    node.remove()
    return { height, overflow: Math.max(0, height - el.h) }
  }))
}

/**
 * The boxes a rendered text's glyphs fill, one per line run, in slide px of
 * the element's own frame — the areas a reader actually reads, since a text
 * box larger than its words has corners with nothing in them. A turned text's
 * line boxes come back as screen-axis bounds, so the node is measured unturned:
 * its transform is lifted for the read and restored at once (no paint).
 * `fallbackScale` is screen px per slide px when the node's own width cannot
 * say (a zero-width box). Shared by the Export section's contrast reading
 * (on the canvas node) and validate() (on an off-screen render).
 */
export function glyphAreas(node: HTMLElement, el: Pick<SlideElement, 'x' | 'y' | 'w'>, fallbackScale = 1): Area[] | undefined {
  const prev = node.style.transform
  node.style.transform = 'none'
  try {
    const box = node.getBoundingClientRect()
    const k = box.width / (el.w || 1) || fallbackScale
    // text nodes only: a range over the whole node also returns its block
    // wrappers' full-width boxes, which are exactly the empty corners
    const rects: DOMRect[] = []
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent?.trim()) continue
      range.selectNodeContents(t)
      rects.push(...range.getClientRects())
    }
    const areas = rects
      .filter((r) => r.width > 0.5 && r.height > 0.5)
      .map((r) => ({ x: el.x + (r.left - box.left) / k, y: el.y + (r.top - box.top) / k, w: r.width / k, h: r.height / k }))
    return areas.length ? areas : undefined
  } finally {
    node.style.transform = prev
  }
}

/**
 * The glyph areas of many text elements, rendered through ONE host at their
 * own size: every node goes in first and is read after, so the whole batch
 * costs one layout. undefined for a text that draws no glyphs.
 */
export function measureGlyphs(els: TextElement[], doc: BentoDoc): Array<Area[] | undefined> {
  if (!els.length) return []
  return withHost((host) => {
    const nodes = els.map((el) => host.appendChild(renderElement(el, doc)))
    return nodes.map((node, i) => glyphAreas(node, els[i]))
  })
}

/**
 * How far each chart's text runs outside its own box, in slide px — 0 when it
 * all fits. The chart is rendered as the canvas and thumbnails draw it (the
 * static snapshot, whose viewBox is the element's box), and every <text> in it
 * is compared with that box: the svg viewport cuts off whatever lies outside,
 * so an axis label wider than its margin reads ") MWh".
 */
export function measureChartText(els: SlideElement[], doc: BentoDoc): Array<{ px: number; text: string }> {
  if (!els.length) return []
  return withHost((host) => {
    const nodes = els.map((el) => host.appendChild(renderElement({ ...el, x: 0, y: 0, rotation: 0 }, doc)))
    return nodes.map((node, i) => {
      const { w, h } = els[i]
      let worst = { px: 0, text: '' }
      for (const t of node.querySelectorAll<SVGTextElement>('svg text')) {
        if (!t.textContent?.trim()) continue
        const b = t.getBBox()
        const px = Math.max(-b.x, -b.y, b.x + b.width - w, b.y + b.height - h)
        if (px > worst.px) worst = { px: Math.round(px), text: t.textContent.trim() }
      }
      return worst
    })
  })
}

const specOf = (el: TextElement): TextMeasureSpec => ({
  html: el.html,
  w: el.w,
  h: el.h,
  fontSize: el.fontSize,
  fontFamily: el.fontFamily,
  fontWeight: el.fontWeight,
  lineHeight: el.lineHeight,
  letterSpacing: el.letterSpacing,
})

/**
 * The height an existing element's content needs — the number to write into
 * `h` so the box fits its text exactly.
 */
export function measureElement(el: TextElement, doc: BentoDoc): TextMeasurement {
  return measureText(specOf(el), doc)
}
