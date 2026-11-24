// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * `window.bento.render()` — a slide as an image, for anything that can open the
 * file in a browser (AI-06). The pixels are Export slides as images' own
 * (`rasterizeSlide`: the shared renderer in its thumbnail/print mode, drawn to
 * a canvas), so an agent looks at what a person exporting the slide would get.
 *
 * Read-only: it draws from the document it is given and touches nothing else —
 * not the store, the selection, the undo stack or the canvas. Results are
 * tagged, never thrown, in the style of the Spaces verbs.
 *
 * What the image holds is what the export holds: a chart is its static
 * snapshot (the still the thumbnails use, not the live chart), video and audio
 * their poster or icon, an embed its placeholder card, and an image whose src
 * is an http(s) URL is blank.
 */

import type { BentoDoc, Slide } from '../model'
import { parseDocInputReport } from '../compactload'
import { derive, deriveMemory } from '../derive'
import { exportableSlides, pixelSize, type ImageFormat, type ImageScale } from '../exportimages'
import { shownAt } from '../steps'
import { rasterizeSlide } from './exportimages'

export interface RenderOpts {
  /** 'png' (default) or 'jpeg' */
  format?: ImageFormat
  /** 1 (default); snapped to the export's scales 0.5, 1, 1.5, 2, 3, 4 */
  scale?: number
  /** the build step to show (0 = before the first click); default every step revealed */
  step?: number
  /** a document that is not loaded, full or compact, as validate() takes one */
  doc?: BentoDoc
}

export type RenderResult =
  | { ok: true; dataUrl: string; width: number; height: number; slideId: string }
  | { ok: false; err: 'no-such-slide' | 'tainted' | 'bad-option' | 'render-failed'; detail: string }

const SCALES: ReadonlyArray<ImageScale> = [0.5, 1, 1.5, 2, 3, 4]

type Bad = { ok: false; err: 'bad-option'; detail: string }
const bad = (detail: string): Bad => ({ ok: false, err: 'bad-option', detail })

/** The options, checked; a tagged refusal names the one that is wrong. */
function readOpts(opts: RenderOpts | undefined): { format: ImageFormat; scale: ImageScale; step: number | null } | Bad {
  const o = opts ?? {}
  if (typeof o !== 'object') return bad('opts must be an object')
  const format = o.format ?? 'png'
  if (format !== 'png' && format !== 'jpeg') return bad(`format must be "png" or "jpeg", not ${JSON.stringify(format)}`)
  const s = o.scale ?? 1
  if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) return bad(`scale must be a positive number, not ${JSON.stringify(s)}`)
  const scale = SCALES.reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best), SCALES[0])
  let step: number | null = null
  if (o.step !== undefined) {
    if (typeof o.step !== 'number' || !Number.isFinite(o.step) || o.step < 0) return bad(`step must be 0 or more, not ${JSON.stringify(o.step)}`)
    step = Math.floor(o.step)
  }
  return { format, scale, step }
}

/** `target`: a slide id, or a 1-based index over doc.slides (state and hidden
 *  slides included); omitted, `fallback` (the open slide). */
function pickSlide(doc: BentoDoc, target: unknown, fallback: Slide | undefined): Slide | Bad | null {
  if (target === undefined || target === null) return fallback ?? doc.slides[0] ?? null
  if (typeof target === 'string') return doc.slides.find((s) => s.id === target) ?? null
  if (typeof target === 'number') {
    if (!Number.isInteger(target)) return bad(`a slide index is a whole number from 1, not ${target}`)
    return doc.slides[target - 1] ?? null
  }
  return bad('target must be a slide id or a 1-based slide index')
}

const dataUrlOf = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const fr = new FileReader()
  fr.onload = () => resolve(fr.result as string)
  fr.onerror = () => reject(fr.error)
  fr.readAsDataURL(blob)
})

async function draw(doc: BentoDoc, slide: Slide, format: ImageFormat, scale: ImageScale, step: number | null): Promise<RenderResult> {
  // a build step hides what is not yet revealed, as the show does
  const hide = step === null ? undefined : new Set(slide.elements.filter((el) => !shownAt(el, step)).map((el) => el.id))
  try {
    const blob = await rasterizeSlide(doc, slide, format, scale, undefined, hide)
    const { width, height } = pixelSize(doc, scale)
    return { ok: true, dataUrl: await dataUrlOf(blob), width, height, slideId: slide.id }
  } catch (e) {
    const name = (e as { name?: string })?.name
    const detail = String((e as Error)?.message ?? e)
    if (name === 'SecurityError') return { ok: false, err: 'tainted', detail: `the slide's image cannot be read back (${detail})` }
    return { ok: false, err: 'render-failed', detail }
  }
}

/** A document handed in rather than loaded passes the same gate loadDoc
 *  uses (it is foreign input: an <img> the renderer builds would fetch its
 *  src) and is derived, as boot derives an opened deck. The open deck's
 *  identity is passed as `live` only so the gate has one; nothing is stored. */
function foreignDoc(raw: unknown, live: BentoDoc): BentoDoc | Bad {
  let json: string
  try { json = typeof raw === 'string' ? raw : JSON.stringify(raw) } catch { return bad('opts.doc is not JSON') }
  const parsed = parseDocInputReport(json, { live })
  if (!parsed) return bad('opts.doc is not a bento/slides document (the same check loadDoc makes)')
  derive(parsed.doc, deriveMemory(parsed.doc))
  return parsed.doc
}

/** One slide as an image. `doc` is the open deck and `current` its open
 *  slide; `opts.doc` renders another document instead. */
export async function renderOne(doc: BentoDoc, current: Slide | undefined, target?: string | number, opts?: RenderOpts): Promise<RenderResult> {
  try {
    const o = readOpts(opts)
    if ('ok' in o) return o
    if (opts?.doc !== undefined) {
      const other = foreignDoc(opts.doc, doc)
      if ('ok' in other) return other
      doc = other
      current = undefined
    }
    const slide = pickSlide(doc, target, current)
    if (!slide) return { ok: false, err: 'no-such-slide', detail: `no slide ${JSON.stringify(target)} — ids and 1-based indexes over ${doc.slides.length} slide(s)` }
    if ('ok' in slide) return slide
    return await draw(doc, slide, o.format, o.scale, o.step)
  } catch (e) {
    return { ok: false, err: 'render-failed', detail: String((e as Error)?.message ?? e) }
  }
}

/** Every slide of the show, in show order (the pages Export slides as images
 *  writes: state and hidden slides left out). No contact sheet: a caller that
 *  wants one composes it from these. */
export async function renderShown(doc: BentoDoc, opts?: RenderOpts): Promise<RenderResult[]> {
  try {
    const o = readOpts(opts)
    if ('ok' in o) return [o]
    if (opts?.doc !== undefined) {
      const other = foreignDoc(opts.doc, doc)
      if ('ok' in other) return [other]
      doc = other
    }
    const out: RenderResult[] = []
    for (const slide of exportableSlides(doc)) out.push(await draw(doc, slide, o.format, o.scale, o.step))
    return out
  } catch (e) {
    return [{ ok: false, err: 'render-failed', detail: String((e as Error)?.message ?? e) }]
  }
}
