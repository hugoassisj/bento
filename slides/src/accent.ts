// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Change the deck's accent colour as ONE operation.
//
// The accent is palette slot `accent1`, stored in `theme.accent` (palette.ts).
// Writing that field alone is the right edit, but on its own it leaves the
// document half done: every literal bound to the accent still holds the old
// colour until the next derive pass, and a chart palette that was derived from
// the old accent keeps the old colours. A find-and-replace of the hex is worse:
// it also rewrites places that used the colour on purpose without binding it.
// Both validate alike, so an agent editing the file cannot tell which it made.
//
// setAccent does the whole edit: it sets the accent, runs the same derive pass
// the app runs when it opens a deck (so every bound literal is written back
// from the palette), re-derives `theme.chartPalette` only when it is the one
// the old accent would have derived (a hand-chosen chart palette is the
// user's and stays), and reports what happened. Values that merely LOOK like
// the old accent but are not bound to it are listed, never rewritten.

import type { BentoDoc } from './model.ts'
import { deriveChartPalette } from './model.ts'
import { derive, deriveMemory } from './derive.ts'
import { parseThemeRef } from './palette.ts'

/**
 * What happened to the chart palette:
 * - `follows`: the deck sets none, so new charts derive theirs from the accent;
 * - `rederived`: it was the one the old accent derives, and is now the new one's;
 * - `kept`: it was chosen by hand and is left as set.
 * Charts already on a slide keep the colours they were created with, in every case.
 */
export type ChartPaletteOutcome = 'follows' | 'rederived' | 'kept'

/** An unbound colour close to the old accent: listed for a person to judge, never changed. */
export interface NearAccent {
  /** `theme.…` for a theme value; otherwise relative to the slide or element */
  path: string
  slide?: string
  element?: string
  value: string
  /** RGB distance from the old accent (see NEAR_ACCENT) */
  distance: number
}

export interface AccentReport {
  from: string
  to: string
  /** bound literals the derive pass rewrote to follow the palette */
  followed: number
  chartPalette: ChartPaletteOutcome
  /** unbound values near the old accent, byte-identical in the document */
  nearby: NearAccent[]
  /** the same, in sentences */
  notes: string[]
}

/**
 * The look-alike rule, advisory only: a colour is "near" the old accent when
 * the straight-line distance between the two in 0–255 RGB is at most this
 * (alpha ignored; fully transparent values skipped, as they paint nothing).
 * 64 is a quarter of one channel's range: a lighter or darker tint of the same
 * colour (#FF9E8A → #FFBCA8 is 42, → #ED8266 is 49) is near, a different hue
 * is not.
 */
export const NEAR_ACCENT = 64

/** The accent is a plain opaque hex colour: what the chart palette derivation reads. */
export const isAccentColour = (c: unknown): c is string =>
  typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)

function rgb(c: string): { r: number; g: number; b: number; a: number } | null {
  const h = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim())
  if (h) {
    let s = h[1]
    if (s.length <= 4) s = s.split('').map((x) => x + x).join('')
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1 }
  }
  const m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(c.trim())
  if (!m) return null
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]
  return { r: +m[1], g: +m[2], b: +m[3], a }
}

const sameColours = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((c, i) => typeof c === 'string' && canonicalHex(c).toLowerCase() === canonicalHex(b[i]).toLowerCase())

/**
 * A short hex written out in full (`#0a7` → `#00aa77`, `#0a7c` → `#00aa77cc`),
 * case kept; anything else unchanged. The chart palette derivation reads six
 * hex digits, so a short accent stored as typed derived `#NaNNaNNaN`.
 */
export function canonicalHex(c: string): string {
  const m = /^#([0-9a-f]{3,4})$/i.exec(c.trim())
  return m ? `#${m[1].split('').map((x) => x + x).join('')}` : c
}

/** The opaque `#rrggbb` a hex colour of any length paints with (alpha dropped), or null. */
function hex6(c: unknown): string | null {
  if (typeof c !== 'string') return null
  const m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(canonicalHex(c))
  return m ? `#${m[1]}` : null
}

/**
 * The theme half of the operation: set the accent (a short hex written out in
 * full) and move a derived chart palette with it. The palette is derived from
 * the accent's opaque colour, so an accent with an alpha of its own (a swatch
 * dragged below 100%) still has a palette that follows it. No derive pass (the
 * editor runs its own after the edit); the tokens pane writes the accent
 * through here so a person's edit and an agent's agree.
 */
export function writeAccent(theme: BentoDoc['theme'], colour: string): ChartPaletteOutcome {
  const was = hex6(theme.accent)
  colour = canonicalHex(colour)
  theme.accent = colour
  const cp = theme.chartPalette
  if (!Array.isArray(cp) || !cp.length) return 'follows'
  const now = hex6(colour)
  if (!was || !now || !sameColours(cp, deriveChartPalette(was))) return 'kept'
  theme.chartPalette = deriveChartPalette(now)
  return 'rederived'
}

type Holder = Record<string, unknown> & { themeRefs?: Record<string, string> }

/** Every slide, layout and element: the things that carry themeRefs. */
function holders(doc: BentoDoc): Array<{ holder: Holder; slide: string; element?: string }> {
  const out: Array<{ holder: Holder; slide: string; element?: string }> = []
  for (const s of [...doc.slides, ...(doc.layouts ?? [])]) {
    out.push({ holder: s as unknown as Holder, slide: s.id })
    for (const el of s.elements) out.push({ holder: el as unknown as Holder, slide: s.id, element: el.id })
  }
  return out
}

/** The palette-bound literals, keyed by where they live. */
function boundLiterals(doc: BentoDoc): Map<string, unknown> {
  const out = new Map<string, unknown>()
  holders(doc).forEach(({ holder }, i) => {
    for (const [path, token] of Object.entries(holder.themeRefs ?? {})) {
      if (!parseThemeRef(token)) continue
      let cur: unknown = holder
      for (const seg of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[seg] : undefined
      out.set(`${i}\u0000${path}`, cur)
    }
  })
  return out
}

/** Unbound colour values within NEAR_ACCENT of `accent`, in document order. */
export function nearAccent(doc: BentoDoc, accent: string, skipTheme: readonly string[] = []): NearAccent[] {
  const base = rgb(accent)
  if (!base) return []
  const out: NearAccent[] = []
  const visit = (v: unknown, path: string, skip: (p: string) => boolean, at: { slide?: string; element?: string }) => {
    if (skip(path)) return
    if (typeof v === 'string') {
      const c = rgb(v)
      if (!c || c.a <= 0) return
      const distance = Math.round(Math.hypot(c.r - base.r, c.g - base.g, c.b - base.b) * 10) / 10
      if (distance <= NEAR_ACCENT) out.push({ path, ...at, value: v, distance })
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, path ? `${path}.${i}` : String(i), skip, at))
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (!path && (k === 'themeRefs' || k === 'elements')) continue
        visit(x, path ? `${path}.${k}` : k, skip, at)
      }
    }
  }
  const theme = doc.theme as unknown as Record<string, unknown>
  for (const [k, x] of Object.entries(theme)) {
    if (k === 'accent') continue
    visit(x, `theme.${k}`, (p) => skipTheme.some((s) => p === s || p.startsWith(`${s}.`)), {})
  }
  for (const { holder, slide, element } of holders(doc)) {
    const refs = Object.keys(holder.themeRefs ?? {})
    // a bound path (and anything under a bound object, a token-bound shadow) is not a look-alike
    const bound = (p: string) => refs.some((r) => p === r || p.startsWith(`${r}.`))
    visit(holder, '', bound, element ? { slide, element } : { slide })
  }
  return out
}

/**
 * Change the accent as one operation (see the top of this file). MUTATES the
 * document; returns null and changes nothing for a colour that is not
 * `#rgb` or `#rrggbb` (`#rgb` is stored as `#rrggbb`). In the editor, run it
 * inside one `store.commit` so it is one undo step.
 */
export function setAccent(doc: BentoDoc, colour: string): AccentReport | null {
  if (!isAccentColour(colour)) return null
  const from = doc.theme.accent
  const before = boundLiterals(doc)
  const chartPalette = writeAccent(doc.theme, colour)
  colour = doc.theme.accent // as stored: a short hex written out in full
  // the pass the app runs on opening a deck, so a file written now is what
  // opening it and saving again would have written
  derive(doc, deriveMemory(doc))
  let followed = 0
  for (const [k, v] of boundLiterals(doc)) if (before.has(k) && before.get(k) !== v) followed++
  const nearby = nearAccent(doc, from, chartPalette === 'rederived' ? ['theme.chartPalette'] : [])
  const notes = [`${followed} bound value${followed === 1 ? '' : 's'} now follow${followed === 1 ? 's' : ''} ${colour}.`]
  if (chartPalette === 'kept') notes.push('Chart palette left as set: theme.chartPalette was chosen by hand, so it keeps its colours.')
  else if (chartPalette === 'rederived') notes.push(`Chart palette re-derived from ${colour}.`)
  else notes.push(`The deck sets no chart palette, so new charts take theirs from ${colour}.`)
  notes.push('Charts already on a slide keep the colours they were created with.')
  if (nearby.length) notes.push(`${nearby.length} unbound value${nearby.length === 1 ? ' is' : 's are'} close to ${from} and ${nearby.length === 1 ? 'was' : 'were'} left as ${nearby.length === 1 ? 'it is' : 'they are'} (see nearby). Bind one to the accent to make it follow.`)
  return { from, to: colour, followed, chartPalette, nearby, notes }
}
