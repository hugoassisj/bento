// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// File ▸ Start from scratch…: what each choice leaves of the deck. Pure — no
// DOM — so scripts/test-slides-start-scratch.ts runs it in node; the editor
// asks which choice, then runs this inside ONE store commit, so ⌘Z brings the
// whole deck back and collaborators receive the whole change in one diff.
//
// CONTENT ONLY, in both cases: `docId`, `collab`, size, meta and the present
// settings are never touched. "Duplicate as new deck…" is the action that
// changes identity (docs/PLATFORM.md §3).

import { builtinLayouts, instantiateLayout, newDoc, type BentoDoc, type Slide, type TextElement } from './model.ts'
import { paletteOf, setColor, type PaletteSlot } from './palette.ts'
import { pruneUnusedAssets } from './assets.ts'
import { STARTER_TITLE } from './starterdeck.ts'

/** `keep`: one title slide in the deck's own colours and fonts; theme, tokens,
 *  fonts and saved layouts stay. `blank`: one empty slide on the app's default
 *  theme; tokens, saved layouts and fonts nothing names any more go. */
export type ScratchChoice = 'keep' | 'blank'

/** Titles nobody chose: the Showcase's own and the model's default. A deck
 *  whose title is anything else was named by someone and keeps its name. */
export const unnamedTitle = (title: string): boolean => title === STARTER_TITLE || title === 'Untitled'

type Holder = Record<string, unknown>
const bind = (holder: object, path: string, slot: PaletteSlot, doc: BentoDoc) => {
  const literal = paletteOf(doc)[slot]
  if (literal) setColor(holder as Holder, path, literal, slot)
}

/**
 * The built-in Title layout at the deck's size, with every colour bound to the
 * deck's palette (background → Background, text → Text, the bar → Accent 1) and
 * its text in the theme's faces, so it looks like the deck and a palette edit
 * recolours it. The literals are the resolved colours, so a shell that predates
 * palette references shows exactly the same slide.
 */
export function lookSlide(doc: BentoDoc): Slide {
  const layout = builtinLayouts(doc.size).find((l) => l.id === 'layout-title')!
  const slide = instantiateLayout(layout)
  bind(slide, 'background', 'bg1', doc)
  for (const el of slide.elements) {
    if (el.type === 'shape') bind(el, 'fill', 'accent1', doc)
    if (el.type !== 'text') continue
    bind(el, 'color', 'tx1', doc)
    // the empty family renders as theme.fontFamily in every shell; a title
    // takes the deck's heading face when it has one
    ;(el as TextElement).fontFamily = el.role === 'title' ? doc.theme.headingFamily ?? '' : ''
  }
  return slide
}

/** One empty slide whose background follows the theme's Background colour. */
export function blankSlide(doc: BentoDoc): Slide {
  const slide = instantiateLayout(builtinLayouts().find((l) => l.id === 'layout-blank')!)
  bind(slide, 'background', 'bg1', doc)
  return slide
}

/** Lower-cased family names in a CSS font stack. */
const families = (stack: unknown): string[] =>
  typeof stack === 'string' ? stack.split(',').map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase()).filter(Boolean) : []

/** Drop every `doc.fonts` entry whose family nothing in the deck names: not
 *  the theme's faces, not an element's family, not a font-family in text. */
function pruneUnusedFonts(doc: BentoDoc): void {
  if (!doc.fonts) return
  const used = new Set([doc.theme.fontFamily, doc.theme.headingFamily, doc.theme.codeFontFamily].flatMap(families))
  const html: string[] = []
  for (const s of [...doc.slides, ...(doc.layouts ?? [])]) {
    for (const el of s.elements) {
      families((el as { fontFamily?: unknown }).fontFamily).forEach((f) => used.add(f))
      if (el.type === 'text') html.push(el.html.toLowerCase())
    }
  }
  const text = html.join('\n')
  const kept = doc.fonts.filter((f) => used.has(f.family.trim().toLowerCase()) || text.includes(f.family.trim().toLowerCase()))
  if (kept.length) doc.fonts = kept
  else delete doc.fonts
}

/** Drop every asset (and its blob pointer) nothing references any more — the
 *  rule a save already applies to the written copy (assets.ts), applied to the
 *  live document so the Assets list and the file agree. Undo history keeps
 *  the bytes, so ⌘Z brings them back with the slides that used them. */
function pruneAssetsInPlace(doc: BentoDoc): void {
  const pruned = pruneUnusedAssets(doc)
  if (pruned === doc) return
  if (pruned.assets) doc.assets = pruned.assets
  else delete doc.assets
  if (pruned.blobs) doc.blobs = pruned.blobs
  else delete doc.blobs
}

/**
 * Start the deck over, IN PLACE. `untitled` is the localised name a deck gets
 * when its title was never chosen (unnamedTitle); returns whether it was
 * renamed, so the editor can put the caret in the title field.
 */
export function startOver(doc: BentoDoc, choice: ScratchChoice, untitled: string): { renamed: boolean } {
  if (choice === 'blank') {
    doc.theme = newDoc().theme
    delete doc.layouts
    doc.slides = [blankSlide(doc)]
    pruneUnusedFonts(doc)
  } else {
    doc.slides = [lookSlide(doc)]
  }
  pruneAssetsInPlace(doc)
  const renamed = unnamedTitle(doc.title) && doc.title !== untitled
  if (renamed) doc.title = untitled
  return { renamed }
}
