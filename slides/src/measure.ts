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
//
// FIELDS. A field token ({{page:2}}, {{title}}, …) is measured as the value it
// renders, never as its own characters: pass the FieldContext of the slide the
// text lives on and the renderer resolves it exactly as it does on screen.
// Date and time fields are measured with the context the renderer would use
// now — this viewer's locale, this moment — not a worst case.

import type { BentoDoc, TableElement, TextElement } from './model.ts'
import { defaultText, visiblePaint } from './model.ts'
import { renderElement, type FieldContext } from './render.ts'

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
export function measureText(spec: TextMeasureSpec, doc: BentoDoc, fields?: FieldContext): TextMeasurement {
  return withHost((host) => measureInto(host, spec, doc, fields))
}

/** One measurement inside an already-open host. `fields` resolves any field
 *  tokens to their values; without it a token measures as its own text. */
function measureInto(host: HTMLElement, spec: TextMeasureSpec, doc: BentoDoc, fields?: FieldContext): TextMeasurement {
  const el = defaultText({
    ...spec,
    id: 'bento-measure',
    x: 0,
    y: 0,
    w: spec.w,
    h: spec.h ?? 10,
  })
  const node = renderElement(el, doc, { fields })
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
 * more DOM churn on a long deck. Each element comes with the field context of
 * the slide it lives on, so its fields measure as that slide shows them.
 */
export function measureElements(els: Array<{ el: TextElement; fields?: FieldContext }>, doc: BentoDoc): TextMeasurement[] {
  if (!els.length) return []
  return withHost((host) => els.map(({ el, fields }) => measureInto(host, specOf(el), doc, fields)))
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

/** Where an element paints, in slide px (left/top/right/bottom). */
export interface InkBox { left: number; top: number; right: number; bottom: number }

/** Whitespace CSS collapses under white-space normal / nowrap / pre-line. */
const COLLAPSIBLE = /[ \t\n\r\f]+/g

/**
 * A box that contains everything a text element paints, in slide px, rendered
 * at the element's own size through `renderElement` and in one host. What the
 * out-of-canvas check uses to tell a deliberate bleed (box past the edge,
 * everything drawn inside) from cropped words. Exactly what goes in it:
 *
 *   - glyph ink, MEASURED: the run on each line shaped by canvas measureText
 *     (see HOW), placed by the DOM's layout of that run;
 *   - an inline element's painted box, MEASURED: its border box as laid out,
 *     padding included (the background chip of inline code);
 *   - decoration lines, BOUNDED: the DOM does not report where an underline,
 *     strike or overline is drawn, so each gets a band across its fragment's
 *     width, placed from the baseline with a margin that contains it;
 *   - an outline stroke, shadows and blur, BOUNDED: the glyph box grown by
 *     twice the stroke width (a mitred corner), and by each shadow's offset
 *     plus three times its blur (see `spread`).
 *
 * The measured parts land within about 1px of the faintest drawn pixel; the
 * bounded parts are wider than what is drawn by up to a fifth of the font
 * size, so a decorated or outlined bleed has to sit further inside the edge
 * before it reads as one. Both are checked against screenshots in
 * scripts/test-slides-starter-clean-browser.mjs.
 *
 * HOW. A line of text is measured as a RUN, never character by character: a
 * flag is two code points and one glyph, a Thai or combining mark stacks on
 * the letter before it, Arabic letters change shape with their neighbours,
 * and a ligature or a kerned pair is not the sum of its parts. Grapheme
 * clusters (Intl.Segmenter) are only used to find where each line of a text
 * node starts and ends (a Range per cluster gives its line box); the run on
 * that line is then shaped by a canvas measureText in the same computed font,
 * which reports how far its ink reaches from its origin and baseline.
 *
 * TRUST. Two cross-checks decide whether canvas and DOM shaped the same run:
 * the run's advance must equal the width the DOM laid it out at, and the
 * line box the Range reports must be the font's ascent plus descent (what
 * places the baseline). Either failing, or anything this cannot attribute — a
 * rotated or mirrored element, a list's markers, a picture or formula, text
 * transforms or font features, an inline box-shadow or outline, no
 * Intl.Segmenter or no glyph metrics — gives `null`, "not measured", which a
 * caller must never read as "inside".
 */
export function measureInk(els: Array<{ el: TextElement; fields?: FieldContext }>, doc: BentoDoc): Array<InkBox | null> {
  if (!els.length) return []
  const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<{ segment: string; index: number }> } }).Segmenter
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx || !Segmenter) return els.map(() => null)
  const graphemes = new Segmenter(undefined, { granularity: 'grapheme' })
  const c2 = ctx as CanvasRenderingContext2D & { letterSpacing?: string; fontKerning?: string }
  return withHost((host) => els.map(({ el, fields }) => {
    if (el.rotation || el.flipX || el.flipY) return null
    const node = renderElement({ ...el, x: 0, y: 0 }, doc, { fields })
    host.appendChild(node)
    try {
      const glyphs = glyphBox(node, c2, graphemes)
      if (!glyphs) return null
      return spread(glyphs, visiblePaint(el), el.x, el.y)
    } finally {
      node.remove()
    }
  }))
}

/** The glyphs' box relative to the element's origin, or null (see measureInk). */
function glyphBox(
  node: HTMLElement,
  ctx: CanvasRenderingContext2D & { letterSpacing?: string; fontKerning?: string },
  graphemes: { segment(s: string): Iterable<{ segment: string; index: number }> },
): InkBox | null {
  const inner = node.querySelector<HTMLElement>('.bento-text-inner')
  if (!inner || inner.querySelector('li, img, svg, math, canvas, video, iframe, object, table')) return null
  const origin = node.getBoundingClientRect()
  const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let box: InkBox | null = null
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    const cs = getComputedStyle(t.parentElement!)
    if (cs.textTransform !== 'none' || cs.fontVariant !== 'normal' || cs.fontFeatureSettings !== 'normal'
      || cs.writingMode !== 'horizontal-tb' || (cs.hyphens === 'auto')) return null
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontStretch === '100%' ? '' : cs.fontStretch} ${cs.fontSize} ${cs.fontFamily}`
    const spacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing
    if ('letterSpacing' in ctx) ctx.letterSpacing = spacing
    else if (parseFloat(spacing)) return null
    if ('fontKerning' in ctx) ctx.fontKerning = cs.fontKerning === 'none' ? 'none' : cs.fontKerning === 'normal' ? 'normal' : 'auto'
    ctx.direction = cs.direction === 'rtl' ? 'rtl' : 'ltr'
    ctx.textAlign = 'left'
    const collapse = /^(normal|nowrap|pre-line)$/.test(cs.whiteSpace)
    // one line at a time: consecutive clusters that share a line box
    type Cluster = { start: number; end: number; ws: boolean; r: DOMRect }
    const lines: Cluster[][] = []
    for (const { segment, index } of graphemes.segment(t.data)) {
      range.setStart(t, index)
      range.setEnd(t, index + segment.length)
      const r = range.getBoundingClientRect()
      const ws = /^\s+$/.test(segment)
      if (!r.width && !r.height) {
        if (ws) continue // collapsed away
        return null // ink with no box: nothing to attribute it to
      }
      const line = lines[lines.length - 1]
      const last = line?.[line.length - 1]
      if (last && Math.abs(last.r.top - r.top) < 0.5 && Math.abs(last.r.height - r.height) < 0.5) line.push({ start: index, end: index + segment.length, ws, r })
      else lines.push([{ start: index, end: index + segment.length, ws, r }])
    }
    for (const line of lines) {
      while (line.length && line[0].ws) line.shift()
      while (line.length && line[line.length - 1].ws) line.pop()
      if (!line.length) continue
      let text = t.data.slice(line[0].start, line[line.length - 1].end)
      if (collapse) text = text.replace(COLLAPSIBLE, ' ')
      const m = ctx.measureText(text)
      if (typeof m.actualBoundingBoxAscent !== 'number' || typeof m.fontBoundingBoxAscent !== 'number') return null
      let left = Infinity
      let right = -Infinity
      for (const c of line) { left = Math.min(left, c.r.left); right = Math.max(right, c.r.right) }
      const laid = right - left
      // canvas and DOM must have shaped the same run in the same font
      if (Math.abs(m.width - laid) > Math.max(0.75, laid * 0.002)) return null
      const r0 = line[0].r
      if (Math.abs(r0.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) > 1) return null
      const baseline = r0.top + m.fontBoundingBoxAscent
      const g = {
        left: left - m.actualBoundingBoxLeft, right: left + m.actualBoundingBoxRight,
        top: baseline - m.actualBoundingBoxAscent, bottom: baseline + m.actualBoundingBoxDescent,
      }
      box = box
        ? { left: Math.min(box.left, g.left), top: Math.min(box.top, g.top), right: Math.max(box.right, g.right), bottom: Math.max(box.bottom, g.bottom) }
        : g
    }
  }
  if (!box) return null
  // Paint inline elements add around the glyphs: a chip's background and
  // padding (inline code), and decoration lines (underline, strike, a link's
  // underline). Neither is in a glyph's ink, so neither came out of
  // measureText above.
  const add = (g: InkBox) => {
    box = { left: Math.min(box!.left, g.left), top: Math.min(box!.top, g.top), right: Math.max(box!.right, g.right), bottom: Math.max(box!.bottom, g.bottom) }
  }
  for (const e of Array.from(inner.querySelectorAll<HTMLElement>('*'))) {
    const cs = getComputedStyle(e)
    if (cs.boxShadow !== 'none' || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0)) return null
    const frags = Array.from(e.getClientRects()).filter((r) => r.width || r.height)
    // a painted box: its border box, padding included, exactly as laid out
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((k) =>
      parseFloat(cs.getPropertyValue(`border-${k.toLowerCase()}-width`)) > 0 && cs.getPropertyValue(`border-${k.toLowerCase()}-style`) !== 'none')
    if (!/^(transparent|rgba\([^)]*,\s*0\))$/.test(cs.backgroundColor) || cs.backgroundImage !== 'none' || bordered) {
      for (const r of frags) add({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    const deco = cs.textDecorationLine
    if (!deco || deco === 'none') continue
    // The DOM does not report where a decoration line is drawn, so each one
    // is given a band that contains it: across the fragment's whole width,
    // and placed from the baseline with room to spare (a font's underline
    // sits about 0.1-0.15em below the baseline, about 0.07em thick; a strike
    // about 0.3em above it). Measured against screenshots in the rig.
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontStretch === '100%' ? '' : cs.fontStretch} ${cs.fontSize} ${cs.fontFamily}`
    const m = ctx.measureText('H')
    if (typeof m.fontBoundingBoxAscent !== 'number') return null
    const fs = parseFloat(cs.fontSize) || 0
    const thick = parseFloat(cs.textDecorationThickness)
    const t = Number.isFinite(thick) ? thick : 0.1 * fs
    const off = parseFloat(cs.textUnderlineOffset)
    const under = Math.max(0, Number.isFinite(off) ? off : 0) + 0.18 * fs + t + 1
    for (const r of frags) {
      if (Math.abs(r.height - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) > 1) return null
      const baseline = r.top + m.fontBoundingBoxAscent
      if (deco.includes('underline')) add({ left: r.left, right: r.right, top: baseline, bottom: baseline + under })
      if (deco.includes('line-through')) add({ left: r.left, right: r.right, top: baseline - 0.45 * fs - t, bottom: baseline - 0.15 * fs + t })
      if (deco.includes('overline')) add({ left: r.left, right: r.right, top: r.top - t - 1, bottom: r.top + t + 1 })
    }
  }
  return { left: box.left - origin.left, top: box.top - origin.top, right: box.right - origin.left, bottom: box.bottom - origin.top }
}

/**
 * Grow the glyph box by everything else the element paints around its
 * glyphs, then place it on the slide. An outline stroke paints half its
 * width outside a smooth outline and up to twice its width at a mitred corner
 * (miter limit 4), so it counts as twice its width. Each drop shadow is the box so far, offset and
 * blurred — CSS filters chain, so a second shadow shadows the first — and a
 * blur spreads the result. A blur is taken to reach three times its value
 * (three standard deviations, reading the value as the larger of the two
 * conventions), past which nothing visible is left.
 */
function spread(b: InkBox, el: TextElement, x: number, y: number): InkBox {
  const grow = (k: number) => { b = { left: b.left - k, top: b.top - k, right: b.right + k, bottom: b.bottom + k } }
  // half the width along a smooth outline, but a mitred corner spikes out to
  // the miter limit (4, Skia's) times half the width: twice the width
  if (el.textStroke?.width) grow(2 * Math.abs(el.textStroke.width))
  const shadows = Array.isArray(el.shadow) ? el.shadow : el.shadow ? [el.shadow] : []
  for (const s of shadows) {
    const dx = Number(s.x) || 0
    const dy = Number(s.y) || 0
    const k = 3 * Math.max(0, Number(s.blur) || 0) + 1
    b = {
      left: Math.min(b.left, b.left + dx - k), top: Math.min(b.top, b.top + dy - k),
      right: Math.max(b.right, b.right + dx + k), bottom: Math.max(b.bottom, b.bottom + dy + k),
    }
  }
  if (el.blur) grow(3 * Math.max(0, Number(el.blur) || 0) + 1)
  return { left: x + b.left, top: y + b.top, right: x + b.right, bottom: y + b.bottom }
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
 * `h` so the box fits its text exactly. Pass its slide's field context so a
 * field measures as its value.
 */
export function measureElement(el: TextElement, doc: BentoDoc, fields?: FieldContext): TextMeasurement {
  return measureText(specOf(el), doc, fields)
}
