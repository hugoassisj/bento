// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * Print or save as PDF — the sheet and the pages. Which pages, in which order
 * and showing which steps is decided in ../printplan.ts; this file draws them
 * into `#bento-print` and hands them to the browser's print pipeline, which
 * keeps text vector (generating the PDF in script would need a dependency and
 * lose that).
 *
 * Every page is `renderSlide` in the mode thumbnails use (`svgAsImage`,
 * `hidePlaceholders`) — the one renderer, never a fork. A step page hides the
 * elements not yet revealed AFTER rendering, by the same class the show uses
 * (`bento-step-hidden`), with a rule of its own scoped to print.
 *
 * "Lighter file" re-draws only what paints most of the slide (printplan
 * `coversSlide`): an svg element, or a picture larger than it prints, becomes a
 * bitmap at the page's own pixel size. Measured on the starter deck in
 * Chromium: its film grain, a full-slide feTurbulence svg, is rasterised by the
 * PDF writer at 300 ppi with an alpha mask — 5002×2815, 3.5 MB on each of nine
 * pages, 33 MB of a 36 MB file. Text, shapes and charts are not touched.
 */

import { renderSlide } from '../render'
import { createDialog, type Dialog } from '../../../kernel/src/ui/dialog.ts'
import '../../../kernel/src/ui/dialog.css'
import { lsGet, lsSet } from '../../../kernel/src/storage.ts'
import { t } from '../i18n'
import type { BentoDoc, Slide } from '../model'
import { shownAt, stepOf } from '../steps'
import {
  PRINT_BACKGROUNDS, PRINT_PAGES, PRINT_PREFS_KEY, coversSlide, printPlan, readPrintOptions,
  type PrintBackgrounds, type PrintOptions, type PrintPages,
} from '../printplan'

/** Print width every page is normalised to, in CSS px. */
const PAGE_W = 1600
/** A notes page is portrait, at A4's proportions. */
const NOTES_H = Math.round((PAGE_W * 297) / 210)
/** The slide on a notes page, inset by the page's side margin. */
const NOTES_SLIDE_W = 1440

export const lastPrintOptions = (): PrintOptions => readPrintOptions(lsGet(PRINT_PREFS_KEY))

function div(cls: string): HTMLElement {
  const d = document.createElement('div')
  d.className = cls
  return d
}

/** Hide what the show has not revealed yet at `step` (present.ts applyStep). */
function hideUnrevealed(surface: HTMLElement, slide: Slide, step: number) {
  for (const el of slide.elements) {
    if (!stepOf(el) || shownAt(el, step)) continue
    surface.querySelector<HTMLElement>(`[data-el-id="${CSS.escape(el.id)}"]`)?.classList.add('bento-step-hidden')
  }
}

/** A slide rendered and scaled to `width` print px. */
function surfaceFor(doc: BentoDoc, slide: Slide, width: number): HTMLElement {
  const surface = renderSlide(slide, doc, { svgAsImage: true, hidePlaceholders: true })
  const s = width / doc.size.width
  surface.style.transformOrigin = '0 0'
  if (s !== 1) surface.style.transform = `scale(${s})`
  return surface
}

/**
 * Build `#bento-print` for these options. "Slides" (the default) is the page
 * sequence the export always produced: one exact page per linear slide.
 */
export function buildPrintBox(doc: BentoDoc, opts: PrintOptions): HTMLElement {
  const box = div('')
  box.id = 'bento-print'
  // page geometry follows the deck's aspect (width normalised to 1600)
  const pageH = Math.round((PAGE_W * doc.size.height) / doc.size.width)
  const notes = opts.pages === 'notes'
  const pageCss = document.createElement('style')
  pageCss.textContent = notes
    ? `@page { size: ${PAGE_W}px ${NOTES_H}px; margin: 96px 0; } #bento-print .bp-notes .bp-slide { height: ${Math.round((NOTES_SLIDE_W * doc.size.height) / doc.size.width)}px; }`
      // paper around the notes, not the editor's backdrop (a slide page covers it)
      + ' @media print { html, body { background: #fff !important; } }'
    : `@page { size: ${PAGE_W}px ${pageH}px; margin: 0; } #bento-print .bp-page { height: ${pageH}px; }`
  box.appendChild(pageCss)
  for (const { slide, step } of printPlan(doc.slides, opts.pages)) {
    if (notes) {
      // the slide in the top half, its notes below; a long text runs on to a
      // continuation page (the page box grows, the browser breaks it)
      const page = div('bp-page bp-notes')
      const frame = div('bp-slide')
      frame.appendChild(surfaceFor(doc, slide, NOTES_SLIDE_W))
      const text = div('bp-notes-text')
      // the deck's body face, through the style property (an invalid value is
      // dropped by the CSSOM, as render.ts does for text elements)
      text.style.fontFamily = doc.theme.fontFamily
      text.textContent = typeof slide.notes === 'string' ? slide.notes : ''
      page.append(frame, text)
      box.appendChild(page)
      continue
    }
    const page = div('bp-page')
    const surface = surfaceFor(doc, slide, PAGE_W)
    if (step !== null) hideUnrevealed(surface, slide, step)
    page.appendChild(surface)
    box.appendChild(page)
  }
  return box
}

const loaded = (src: string): Promise<HTMLImageElement> => {
  const img = new Image()
  img.src = src
  return img.decode().then(() => img)
}

/**
 * "Lighter file": re-draw each full-bleed svg or oversized picture in `box`
 * as a bitmap at the size it prints. Resolves when every replacement is
 * decoded. One source drawn at one size is encoded once, so a texture that
 * repeats on every slide is the same image on every page.
 */
export async function lightenPrintBox(box: HTMLElement, doc: BentoDoc): Promise<number> {
  const width = box.querySelector('.bp-notes') ? NOTES_SLIDE_W : PAGE_W
  const s = width / doc.size.width
  const cache = new Map<string, Promise<string | null>>()
  const jobs: Promise<boolean>[] = []
  for (const surface of box.querySelectorAll<HTMLElement>('.bento-slide')) {
    const slide = doc.slides.find((sl) => sl.id === surface.dataset.slideId)
    if (!slide) continue
    for (const el of slide.elements) {
      if (!coversSlide(el, doc.size)) continue
      const svg = el.type === 'svg'
      // a cropped picture is drawn larger than its box: leave it as it is
      if (!svg && !(el.type === 'image' && !el.crop)) continue
      const img = surface.querySelector<HTMLImageElement>(`[data-el-id="${CSS.escape(el.id)}"] img`)
      const src = img?.getAttribute('src')
      if (!img || !src || !src.startsWith('data:')) continue
      const bw = Math.max(1, Math.round(el.w * s))
      const bh = Math.max(1, Math.round(el.h * s))
      const key = `${bw}x${bh}:${src}`
      if (!cache.has(key)) cache.set(key, raster(src, bw, bh, svg))
      jobs.push(cache.get(key)!.then(async (out) => {
        if (!out) return false
        img.src = out
        await img.decode().catch(() => {})
        return true
      }))
    }
  }
  return (await Promise.all(jobs)).filter(Boolean).length
}

/**
 * An svg data URI's own proportions (width/height, else its viewBox), and the
 * same markup pinned to an exact pixel size. An svg loaded as an image with
 * only a viewBox has no natural size (the browser reports 300×150), so it is
 * sized before it is drawn: at the box `object-fit: contain` gives it, which is
 * where the original <img> painted it.
 */
function svgSource(src: string): { ratio: number | null; at(w: number, h: number): string } | null {
  const head = /^data:image\/svg\+xml(;charset=[^,;]*)?,/i.exec(src)
  if (!head) return null
  let markup: string
  try { markup = decodeURIComponent(src.slice(head[0].length)) } catch { return null }
  const open = /<svg\b[^>]*>/i.exec(markup)
  if (!open) return null
  const tag = open[0]
  const attr = (name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(tag)
    return m ? parseFloat(m[1]) : 0
  }
  let w = attr('width'), h = attr('height')
  if (!(w > 0 && h > 0)) {
    const vb = /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag)
    ;[w, h] = vb ? [parseFloat(vb[1]), parseFloat(vb[2])] : [0, 0]
  }
  const bare = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '')
  return {
    ratio: w > 0 && h > 0 ? w / h : null,
    at: (pw, ph) => head[0] + encodeURIComponent(markup.slice(0, open.index) + bare.replace(/^<svg\b/i, `<svg width="${pw}" height="${ph}"`) + markup.slice(open.index + tag.length)),
  }
}

/** `src` drawn at the size it prints: an svg at its contain box, a picture
 *  scaled down to cover the box, never up. Null = leave it as it is. */
async function raster(src: string, bw: number, bh: number, svg: boolean): Promise<string | null> {
  try {
    let draw: string, cw: number, ch: number
    if (svg) {
      const sv = svgSource(src)
      if (!sv) return null
      const r = sv.ratio
      ;[cw, ch] = r ? (bw / bh > r ? [bh * r, bh] : [bw, bw / r]) : [bw, bh]
      cw = Math.max(1, Math.round(cw)); ch = Math.max(1, Math.round(ch))
      draw = sv.at(cw, ch)
    } else {
      if (/^data:image\/svg/i.test(src)) return null // a vector picture is not what weighs
      const probe = await loaded(src)
      const nw = probe.naturalWidth, nh = probe.naturalHeight
      if (!nw || !nh) return null
      const k = Math.max(bw / nw, bh / nh)
      if (k >= 1) return null // already no larger than it prints
      cw = Math.max(1, Math.round(nw * k)); ch = Math.max(1, Math.round(nh * k))
      draw = src
    }
    const img = await loaded(draw)
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    canvas.getContext('2d')!.drawImage(img, 0, 0, cw, ch)
    // a photo stays a JPEG; anything else keeps its transparency
    return /^data:image\/jpe?g[;,]/i.test(src) ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png')
  } catch {
    return null // undecodable or tainted: the original prints
  }
}

/** Build the pages, print them, and remove them again afterwards. */
export function printDeck(doc: BentoDoc, opts: PrintOptions) {
  document.getElementById('bento-print')?.remove()
  const box = buildPrintBox(doc, opts)
  document.body.appendChild(box)
  const cleanup = () => {
    box.remove()
    window.removeEventListener('afterprint', cleanup)
  }
  window.addEventListener('afterprint', cleanup)
  const ready = opts.backgrounds === 'light' ? lightenPrintBox(box, doc) : Promise.resolve(0)
  // give the freshly-inserted images a beat to decode before printing
  void ready.then(() => setTimeout(() => window.print(), 250))
}

let sheet: Dialog | null = null

/** The print sheet: which pages, which backgrounds, then the browser's
 *  dialog. The choice is remembered in this browser, never in the deck. */
export function openPrintSheet(doc: BentoDoc, shortcut: string) {
  if (sheet?.isOpen) return
  const saved = lastPrintOptions()
  const body = div('ed-print-sheet')
  const select = <V extends string>(label: string, pairs: Array<[V, string]>, value: V) => {
    const row = document.createElement('label')
    row.className = 'ed-row'
    const span = document.createElement('span')
    span.textContent = label
    const sel = document.createElement('select')
    for (const [v, text] of pairs) {
      const o = document.createElement('option')
      o.value = v; o.textContent = text; o.selected = v === value
      sel.appendChild(o)
    }
    row.append(span, sel)
    body.appendChild(row)
    return sel
  }
  const pageNames: Record<PrintPages, string> = { slides: t('Slides'), notes: t('Slides with notes'), steps: t('One page per click step') }
  const bgNames: Record<PrintBackgrounds, string> = { full: t('Full quality'), light: t('Lighter file') }
  const pages = select(t('Pages'), PRINT_PAGES.map((p) => [p, pageNames[p]]), saved.pages)
  const bgs = select(t('Backgrounds'), PRINT_BACKGROUNDS.map((b) => [b, bgNames[b]]), saved.backgrounds)
  const hint = document.createElement('p')
  hint.className = 'ed-hint'
  hint.textContent = t('Hidden slides and states stay out. {keys} prints again with these choices, without this sheet.', { keys: shortcut })
  body.appendChild(hint)

  const cancel = document.createElement('button')
  cancel.className = 'ed-btn'
  cancel.textContent = t('Cancel')
  const go = document.createElement('button')
  go.className = 'ed-btn ed-btn-primary'
  go.textContent = t('Print')
  const dlg = createDialog({ title: t('Print or save as PDF'), content: body, actions: [cancel, go] })
  sheet = dlg
  cancel.addEventListener('click', () => dlg.close())
  go.addEventListener('click', () => {
    const opts = readPrintOptions(JSON.stringify({ pages: pages.value, backgrounds: bgs.value }))
    lsSet(PRINT_PREFS_KEY, JSON.stringify(opts))
    dlg.close()
    printDeck(doc, opts)
  })
  dlg.open()
}
