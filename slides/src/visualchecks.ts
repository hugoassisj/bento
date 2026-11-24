// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The validator's visual checks — what a person notices at a glance and the
// structural checks cannot see: text that cannot be read against what is
// behind it, text boxes drawn over each other, frame children hanging out of
// their frame, and chart labels cut off at the chart's edge.
//
// ADVICE, NEVER FIXES. Every finding is a warning or an info that states the
// number it measured; nothing here changes the document (the frame check lays
// out a COPY of the slide). The deck's own design wins: a finding says what a
// reader will see, the person or agent decides.
//
// FALSE POSITIVES ARE THE RISK. One wrong warning on the starter deck and
// nobody trusts the list, so every check stays quiet where it cannot be sure:
//  - contrast is judged only against a backdrop it can compute (the slide
//    colour and the shapes beneath, with colours it can read). Text over a
//    picture, a chart, a table or a blended layer is not judged at all;
//  - text with an opacity, or a colour alpha, under DECORATIVE (a ghost
//    numeral, a watermark) is taken as decoration, and the messages say so;
//    so, for contrast, is slide furniture made only of fields ({{page:2}},
//    {{date}}): a muted page number is a design decision, not a defect;
//  - two texts that are never on screen together (different hover sets) do
//    not overlap, and nor do two copies of the same words (a shadow or an
//    outline layer is stacked on purpose).
// With a DOM, text is judged on the boxes its glyphs fill (measure.ts
// glyphAreas, the same reading the Export section shows), so a tall, mostly
// empty box neither fails contrast in its empty corner nor overlaps the box
// below it. Without one, whole boxes are used and the chart check — which
// needs the real renderer — is skipped, as overflow is.

import type { BentoDoc, Slide, SlideElement, TableElement, TextElement } from './model.ts'
import { visiblePaint } from './model.ts'
import { measureContrast, type Area } from './contrast.ts'
import { parseColor } from './colorvalue.ts'
import { flagged, isFrame, layoutSlide } from './layout.ts'
import { measureChartText, measureGlyphs } from './measure.ts'
import type { Finding } from './validate.ts'

/** Opacity (or colour alpha) under which text is decoration, not reading matter. */
export const DECORATIVE = 0.15
/** Overlap, as a share of the smaller of the two, that counts as text on text. */
const OVERLAP = 0.1
/** The share of a glyph run's box, top and bottom, that is ascent and descent room. */
const INK = 0.25

type Box = { x: number; y: number; w: number; h: number }

/** The axis-aligned box a (possibly turned) element covers on the slide. */
function extent(el: Box & { rotation?: number }): Box {
  const a = ((el.rotation || 0) % 360) * Math.PI / 180
  if (!a) return { x: el.x, y: el.y, w: el.w, h: el.h }
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a))
  const w = el.w * c + el.h * s, h = el.w * s + el.h * c
  return { x: el.x + el.w / 2 - w / 2, y: el.y + el.h / 2 - h / 2, w, h }
}
const meet = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/** The words a text element shows (tags and entities out). */
const words = (html: unknown) =>
  typeof html === 'string' ? html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&[a-z]+;/g, 'x').trim() : ''

let ink: CanvasRenderingContext2D | null | undefined
/**
 * A colour in a notation contrast.ts reads (hex, comma rgb()/rgba(),
 * transparent), or undefined when it cannot be read. Plain hex and comma rgb
 * are read as they are; anything else — a name, hsl(), space-separated rgb —
 * is handed to the browser's own colour parser through a canvas, which writes
 * it back as hex or rgba(). Without a DOM those stay unread, and an element
 * that depends on one is not judged.
 */
function readable(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined
  const s = c.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || s === 'transparent' || s === 'none') return s
  if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)$/i.test(s)) return s
  if (typeof document === 'undefined') return undefined
  ink ??= document.createElement('canvas').getContext('2d')
  if (!ink) return undefined
  ink.fillStyle = '#010203'
  ink.fillStyle = s
  const out = String(ink.fillStyle)
  if (out === '#010203' && s.toLowerCase() !== '#010203') return undefined
  return /^#|^rgba?\(/i.test(out) ? out : undefined
}

/** A gradient with every stop readable, or undefined. */
function readableGradient<G extends { stops: Array<{ color: string }> }>(g: G | undefined): G | undefined | false {
  if (!g) return undefined
  const stops = g.stops.map((st) => ({ ...st, color: readable(st.color) }))
  return stops.every((st) => st.color) ? { ...g, stops } as G : false
}

/**
 * The shape as contrast.ts should see it — its paint in readable notation —
 * or null when some colour it paints cannot be read (then nothing above it is
 * judged: guessing a backdrop is how a contrast check lies).
 */
function readableShape(e: SlideElement): SlideElement | null {
  const v = visiblePaint(e) as SlideElement & Record<string, any>
  const out: Record<string, any> = { ...v }
  if (v.fills?.length) {
    out.fills = []
    for (const f of v.fills) {
      if (f.hidden) continue
      const color = readable(f.color), gradient = readableGradient(f.gradient)
      if (gradient === false || (!gradient && !color)) return null
      out.fills.push({ ...f, color: color ?? 'transparent', gradient: gradient || undefined })
    }
  } else {
    const g = readableGradient(v.fillGradient)
    if (g === false) return null
    out.fillGradient = g
    if (!g) {
      // a paint server, url(#id), draws markup that cannot be sampled
      const fill = readable(v.fill ?? 'transparent')
      if (!fill) return null
      out.fill = fill
    }
  }
  return out as SlideElement
}

/**
 * The slide a text is judged against: its background and the shapes beneath
 * it that reach its box, all in readable colours, then the text. null when
 * the backdrop cannot be computed: something beneath that is not a plain
 * shape (a picture, chart, table, embed, code block, or anything blended),
 * or a colour that cannot be read.
 */
function backdrop(doc: BentoDoc, slide: Slide, el: TextElement, hidden: Set<string>): Slide | null {
  const background = readable(slide.background || doc.theme?.background || '#ffffff')
  if (!background) return null
  if ((el as any).blend) return null
  const area = extent(el)
  const below: SlideElement[] = []
  for (const e of slide.elements) {
    if (e.id === el.id) break
    if (hidden.has(e.id) || e.type === 'text' || !(e.w > 0 && e.h > 0) || !meet(area, extent(e))) continue
    if (e.type !== 'shape' || (e as any).blend) return null
    if (e.shape === 'line') continue
    const shape = readableShape(e)
    if (!shape) return null
    below.push(shape)
  }
  const own = readableGradient(el.colorGradient)
  if (own === false) return null
  const color = own ? 'transparent' : readable(el.color ?? doc.theme?.color)
  if (!own && !color) return null
  return { ...slide, background, elements: [...below, { ...el, color: color ?? el.color, colorGradient: own || undefined }] } as Slide
}

/** Slide furniture: a text that is nothing but fields — a page number, a running date. */
const furniture = (w: string) => /^(?:\{\{[^{}]+\}\}\s*)+$/.test(w)

/** Text an agent or a person meant to be read: visible, with words, not decoration. */
function readingText(el: SlideElement, hidden: Set<string>): el is TextElement {
  if (el.type !== 'text' || hidden.has(el.id) || !words(el.html)) return false
  if ((el.opacity ?? 1) < DECORATIVE) return false
  if (el.textStroke?.fill === 'none') return false // outline text: its colour is the stroke's
  const c = readable(el.color)
  return !(c && parseColor(c).a < DECORATIVE)
}

export function visualChecks(doc: BentoDoc, add: (f: Finding) => void, measured: boolean) {
  // glyph areas for every text on every slide, in one rendered batch
  const texts: TextElement[] = []
  for (const s of doc.slides) for (const e of s.elements) if (e.type === 'text' && words(e.html)) texts.push(e)
  const glyphs = new Map<SlideElement, Area[] | undefined>()
  if (measured) measureGlyphs(texts, doc).forEach((g, i) => glyphs.set(texts[i], g))
  const charts: SlideElement[] = []
  const chartSlide = new Map<SlideElement, string>()

  for (const slide of doc.slides) {
    const hidden = flagged(slide, 'hidden')
    const at = (el: SlideElement) => ({ slide: slide.id, element: el.id })

    // ---- low contrast ------------------------------------------------------
    for (const el of slide.elements) {
      // furniture is muted on purpose and repeated on every slide; its words are the deck's, not the author's
      if (!readingText(el, hidden) || furniture(words(el.html))) continue
      const areas = measured ? glyphs.get(el) : undefined
      if (measured && !areas) continue // draws no glyphs: nothing to read
      const judged = backdrop(doc, slide, el, hidden)
      if (!judged) continue
      const reading = measureContrast(judged.elements[judged.elements.length - 1], judged, 5, areas)
      if (!reading) continue
      const size = el.fontSize ?? 16
      const bold = (el.fontWeight ?? 400) >= 700
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
      if (reading.ratio >= need) continue
      const r = Math.floor(reading.ratio * 10) / 10
      add({ ...at(el), code: 'low-contrast', severity: 'warning', path: 'color',
        message: `Text is ${r}:1 against what is behind it (needs ${need}:1 at ${size}px${bold ? ' bold' : ''}), measured on its ${areas ? 'glyphs' : 'whole box'} — hard to read for many people. Darken or lighten the text or what is under it. Not judged: decoration (an opacity or colour alpha under ${DECORATIVE}) and furniture made only of fields such as {{page}}.` })
    }

    // ---- text over text ----------------------------------------------------
    const readers = slide.elements.filter((e): e is TextElement | TableElement =>
      (e.type === 'table' ? !hidden.has(e.id) && (e.opacity ?? 1) >= DECORATIVE : readingText(e, hidden)))
    // A text's glyph runs, narrowed to their ink band: a run's box is the
    // font's whole ascent-to-descent, and its top and bottom quarters are
    // mostly air (a capital title has no descenders) — two lines whose boxes
    // only touch there are not drawn over each other. A slightly turned text
    // (a playful tilt) is judged unturned; a steeply turned one by its extent.
    const areasOf = (e: TextElement | TableElement): Box[] => {
      const turn = Math.abs((((e.rotation || 0) % 360) + 540) % 360 - 180) // degrees off level, 0..180
      const g = e.type === 'text' && turn <= 10 ? glyphs.get(e) : undefined
      return g ? g.map((r) => ({ x: r.x, y: r.y + r.h * INK, w: r.w, h: r.h * (1 - 2 * INK) })) : [extent(e)]
    }
    const total = (bs: Box[]) => bs.reduce((n, b) => n + b.w * b.h, 0)
    for (let j = 1; j < readers.length; j++) {
      const upper = readers[j]
      for (let i = 0; i < j; i++) {
        const lower = readers[i]
        // a hover reveal swaps sets: two texts in different sets are never shown together
        if ((upper.showOnHover || lower.showOnHover) && upper.showOnHover !== lower.showOnHover) continue
        // the same words stacked on purpose: a shadow, outline or offset copy is an effect
        if (upper.type === 'text' && lower.type === 'text' && words(upper.html) === words(lower.html)) continue
        if (!meet(extent(upper), extent(lower))) continue
        const a = areasOf(upper), b = areasOf(lower)
        let shared = 0
        for (const p of a) for (const q of b) shared += meet(p, q)
        const smaller = Math.min(total(a), total(b))
        if (!smaller || shared / smaller <= OVERLAP) continue
        add({ ...at(upper), code: 'text-overlap', severity: 'warning', path: 'y',
          message: `Overlaps ${lower.type === 'table' ? 'table' : 'text'} "${lower.id}" by ${Math.round((shared / smaller) * 100)}% of the smaller of the two (${measured ? 'measured on the glyphs' : 'by their boxes'}) — they are drawn over each other. Move one, or make room.` })
      }
    }

    // ---- frame children outside their frame ---------------------------------
    // Positions come from the layout pass, so this runs on a laid-out COPY: a
    // document passed in raw (an agent's, before load) is judged as it will
    // be drawn, and the document itself is not touched.
    if (slide.elements.some(isFrame)) {
      const copy: Slide = JSON.parse(JSON.stringify(slide))
      layoutSlide(copy)
      const byId = new Map(copy.elements.map((e) => [e.id, e]))
      const hiddenCopy = flagged(copy, 'hidden')
      for (const e of copy.elements) {
        const f = e.parentId ? byId.get(e.parentId) : undefined
        if (!isFrame(f) || hiddenCopy.has(e.id)) continue
        const past = { left: f.x - e.x, top: f.y - e.y, right: e.x + e.w - (f.x + f.w), bottom: e.y + e.h - (f.y + f.h) }
        const side = (Object.keys(past) as Array<keyof typeof past>).reduce((m, k) => (past[k] > past[m] ? k : m), 'left')
        const px = Math.round(past[side])
        if (px < 1) continue
        add({ slide: slide.id, element: e.id, code: 'outside-frame', severity: f.layout.clip ? 'warning' : 'info', path: 'parentId',
          message: f.layout.clip
            ? `After layout this runs ${px}px past the ${side} of its frame "${f.id}", which clips — the part outside is cut off. Make the frame bigger, the element smaller, or let the frame hug its content.`
            : `After layout this runs ${px}px past the ${side} of its frame "${f.id}" and shows outside it. Fine if deliberate; otherwise make room in the frame.` })
      }
    }

    for (const el of slide.elements) {
      if (el.type === 'chart' && !hidden.has(el.id)) { charts.push(el); chartSlide.set(el, slide.id) }
    }
  }

  // ---- chart text cut off at the chart's edge (measured) ----------------------
  if (measured) {
    measureChartText(charts, doc).forEach((m, i) => {
      if (m.px <= 1) return
      const el = charts[i]
      add({ slide: chartSlide.get(el)!, element: el.id, code: 'chart-label-clipped', severity: 'warning', path: 'option.grid',
        message: `Chart text "${m.text}" runs ${m.px}px past the chart's edge and is cut off. Give the axis more room (option.grid left/right/bottom), shorten the labels, or widen the chart.` })
    })
  }
}
