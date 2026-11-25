// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * Print / PDF export — the decisions, DOM-free (editor/printpdf.ts draws them).
 *
 * Which pages a print holds, in what order, and which elements are shown on
 * each. Three page kinds, chosen on the print sheet:
 *
 *   slides  one page per linear slide, every step revealed — the export as it
 *           always was, and the default
 *   notes   the same slides, each on a portrait page above its speaker notes
 *   steps   one page per click step (upstream #966): a slide with steps
 *           1, 2, 3 becomes four pages — nothing revealed, then one more
 *           step per page — so the PDF steps through the talk on its own
 *
 * States and hidden slides stay out of every kind (`inLinearFlow`), as they
 * always have: a state is reached only by interaction, and a hidden slide is
 * material the audience was not meant to be handed. Steps are presentation
 * state, not slides, so every step page of a slide carries that slide's page
 * number.
 *
 * The choice is remembered per browser (localStorage), never in the document.
 */

import { inLinearFlow, type Slide } from './model.ts'
import { stepsOf, type Stepped } from './steps.ts'

export type PrintPages = 'slides' | 'notes' | 'steps'
export type PrintBackgrounds = 'full' | 'light'
export interface PrintOptions { pages: PrintPages; backgrounds: PrintBackgrounds }

export const PRINT_PAGES: readonly PrintPages[] = ['slides', 'notes', 'steps']
export const PRINT_BACKGROUNDS: readonly PrintBackgrounds[] = ['full', 'light']
export const PRINT_DEFAULTS: PrintOptions = { pages: 'slides', backgrounds: 'full' }
/** localStorage key of the last choice (a per-browser convenience). */
export const PRINT_PREFS_KEY = 'bento-print-options'

/** The stored choice, gated: anything unknown falls back to the default. */
export function readPrintOptions(raw: string | null): PrintOptions {
  let v: Partial<Record<keyof PrintOptions, unknown>> = {}
  try { v = raw ? JSON.parse(raw) ?? {} : {} } catch { v = {} }
  const pages = PRINT_PAGES.find((p) => p === v.pages) ?? PRINT_DEFAULTS.pages
  const backgrounds = PRINT_BACKGROUNDS.find((b) => b === v.backgrounds) ?? PRINT_DEFAULTS.backgrounds
  return { pages, backgrounds }
}

/** The steps a slide prints at in "one page per click step": none revealed,
 *  then each step present, in order. A slide with no steps is one page. */
export const pageSteps = (elements: ReadonlyArray<Stepped>): number[] => [0, ...stepsOf(elements)]

/** One printed page: a slide, and the step it shows (`null` = every step
 *  revealed, the slide as it always printed). */
export interface PrintPage { slide: Slide; step: number | null }

/** The page sequence for a print, in deck order. */
export function printPlan(slides: ReadonlyArray<Slide>, pages: PrintPages): PrintPage[] {
  const out: PrintPage[] = []
  for (const slide of slides) {
    if (!inLinearFlow(slide)) continue
    if (pages === 'steps') for (const step of pageSteps(slide.elements)) out.push({ slide, step })
    else out.push({ slide, step: null })
  }
  return out
}

/**
 * "Lighter file": does this element paint (nearly) the whole slide? Those are
 * what make a print heavy — a full-bleed picture, or a texture such as the
 * starter deck's film grain, which the browser's PDF writer rasterises at
 * 300 ppi with an alpha mask (about 3.5 MB a page). Half the slide's area or
 * more counts; a small icon stays vector-sharp.
 */
export function coversSlide(el: { x: number; y: number; w: number; h: number }, size: { width: number; height: number }): boolean {
  const w = Math.max(0, Math.min(el.x + el.w, size.width) - Math.max(el.x, 0))
  const h = Math.max(0, Math.min(el.y + el.h, size.height) - Math.max(el.y, 0))
  return w * h >= 0.5 * size.width * size.height
}
