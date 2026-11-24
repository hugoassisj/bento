#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Built-in layouts and new elements follow the deck theme.
//
//   node scripts/test-slides-layout-theme.ts
//
// WHAT THIS PROVES. Every built-in layout binds its colours to the palette
// (`themeRefs`, the mechanism the format already has: no new key) and its
// text to the theme font (the empty family), so changing the theme's
// Background, Text and Accent 1 recolours a slide built from it. Each colour
// is written as the literal the reference resolves to IN THE DECK it lands in
// (a shell that predates references shows that literal, so it must be right).
// Placeholder text reads at 4.5:1 or better on its backdrop in the default
// theme and in a dark one. A slide made from the OLD layouts (literals, no
// references) and the shipped decks are left exactly as they were: nothing
// guesses a binding for a colour somebody already has.
//
// It failed before the change: no layout carried a reference, so every
// "follows" row below was red and the usage counter read zero.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  builtinLayouts, instantiateLayout, applyLayout, newDoc, FONT_STACK,
  type BentoDoc, type Slide, type SlideElement, type TextElement, type ShapeElement,
} from '../slides/src/model.ts'
import * as palette from '../slides/src/palette.ts'
import { derive, deriveMemory } from '../slides/src/derive.ts'
import { expandDoc } from '../slides/src/compact.ts'
import { starterDoc } from '../slides/src/starterdeck.ts'

const { paletteOf, resolveThemeRefs, resolveRef, eachRef, _readPath: readPath } = palette
const contrastRatio = (palette as Record<string, unknown>).contrastRatio as ((a: string, b: string) => number | null) | undefined
const readableSlot = (palette as Record<string, unknown>).readableSlot as ((bg: string, p: palette.Palette) => string | null) | undefined

let failures = 0
let checks = 0
function ok(cond: boolean, msg: string) {
  checks++
  if (!cond) { failures++; console.log(`  FAIL  ${msg}`) }
  else console.log(`  ok    ${msg}`)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f: string) => readFileSync(join(root, f), 'utf8')
type Holder = { themeRefs?: Record<string, string> } & Record<string, unknown>
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const lower = (v: unknown) => String(v).toLowerCase()

// WCAG contrast, written out here so the rig does not trust the code it grades
const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

function deckWith(theme: Partial<BentoDoc['theme']>): BentoDoc {
  const d = newDoc()
  Object.assign(d.theme, theme)
  return d
}
const DARK = { background: '#101418', color: '#F5F7FA' }
const BRAND = { background: '#FBF7EF', color: '#2B1D3A', accent: '#0E7C66' }

console.log('every built-in layout is bound to the theme\n')
const layouts = builtinLayouts({ width: 1280, height: 720 })
for (const ly of layouts) {
  const sref = (ly as unknown as Holder).themeRefs?.background
  ok(sref === (ly.id === 'layout-section' ? 'tx1' : 'bg1'), `${ly.id}: the slide background follows ${ly.id === 'layout-section' ? 'Text (the divider inverts)' : 'Background'} (${sref ?? 'unbound'})`)
  for (const el of ly.elements) {
    const refs = (el as unknown as Holder).themeRefs ?? {}
    if (el.type === 'text') {
      ok(!!refs.color, `${ly.id}/${el.id}: placeholder colour is bound (${refs.color ?? 'unbound'})`)
      ok((el as TextElement).fontFamily === '', `${ly.id}/${el.id}: placeholder uses the theme font`)
    } else if (el.type === 'shape') {
      ok(!!refs.fill, `${ly.id}/${el.id}: ${el.id.includes('bg') ? 'card' : 'bar'} fill is bound (${refs.fill ?? 'unbound'})`)
    }
  }
}
const bars = layouts.flatMap((l) => l.elements).filter((e) => e.type === 'shape' && !e.id.includes('-bg'))
ok(bars.length > 0 && bars.every((e) => (e as unknown as Holder).themeRefs?.fill === 'accent1'), `every accent bar follows Accent 1 (${bars.length})`)
const titles = layouts.flatMap((l) => l.elements.filter((e) => e.role === 'title' && l.id !== 'layout-section'))
ok(titles.every((e) => (e as unknown as Holder).themeRefs?.color === 'tx1'), `every title outside the divider follows Text (${titles.length})`)
{
  const maps = builtinLayouts().flatMap((l) => [l, ...l.elements]).map((h) => (h as unknown as Holder).themeRefs).filter(Boolean)
  ok(new Set(maps).size === maps.length, `each slide and element owns its references object, none shared through a helper (${maps.length})`)
}

console.log('\nthe literal written is the resolved value for the deck\n')
for (const [name, theme] of [['default', {}], ['dark', DARK], ['brand', BRAND]] as const) {
  const d = deckWith(theme)
  const pal = paletteOf(d)
  const ls = builtinLayouts(d.size, pal)
  let bad: string[] = []
  for (const ly of ls) {
    for (const h of [ly, ...ly.elements] as unknown as Holder[]) {
      for (const [path, token] of Object.entries(h.themeRefs ?? {})) {
        const want = resolveRef(token, pal)
        if (want === null || lower(readPath(h, path)) !== lower(want)) bad.push(`${ly.id}/${(h as { id?: string }).id}.${path}=${readPath(h, path)}≠${want}`)
      }
    }
  }
  ok(bad.length === 0, `${name} theme: every literal equals its reference resolved against the deck palette${bad.length ? ` (${bad.slice(0, 3).join(', ')})` : ''}`)
  // the stored JSON after a real insertion, not just the template
  d.slides = [instantiateLayout(ls.find((l) => l.id === 'layout-title')!)]
  const stored = JSON.parse(JSON.stringify(d)) as BentoDoc
  const s = stored.slides[0]
  const title = s.elements.find((e) => e.id === 'lt-title') as TextElement
  const barEl = s.elements.find((e) => e.id === 'lt-bar') as ShapeElement
  ok(lower(s.background) === lower(pal.bg1) && lower(title.color) === lower(pal.tx1) && lower(barEl.fill) === lower(pal.accent1),
    `${name} theme: stored Title slide carries background ${s.background}, title ${title.color}, bar ${barEl.fill} = bg1/tx1/accent1`)
  ok(!resolveThemeRefs(stored), `${name} theme: a derive pass right after insertion changes nothing (already resolved)`)
}

console.log('\nchanging the theme recolours a slide made from a layout\n')
{
  const d = newDoc()
  const ls = builtinLayouts(d.size, paletteOf(d))
  d.slides = ls.map((l) => instantiateLayout(l))
  const before = clone(d)
  d.theme.background = '#0B1020'; d.theme.color = '#EDE6D6'; d.theme.accent = '#3FA7D6'
  const mem = deriveMemory(before) // as opened: palette memory empty, so it resolves
  derive(d, mem)
  const pal = paletteOf(d)
  for (const [i, s] of d.slides.entries()) {
    const ly = ls[i]
    const wantBg = ly.id === 'layout-section' ? pal.tx1 : pal.bg1
    ok(lower(s.background) === lower(wantBg), `${ly.id}: background follows to ${s.background}`)
    for (const el of s.elements) {
      const h = el as unknown as Holder
      for (const [path, token] of Object.entries(h.themeRefs ?? {})) {
        ok(lower(readPath(h, path)) === lower(resolveRef(token, pal)), `${ly.id}/${el.id}.${path} follows ${token} → ${readPath(h, path)}`)
      }
    }
  }
}

console.log('\nthe usage counter sees the layout\n')
{
  const d = newDoc()
  d.slides = [instantiateLayout(builtinLayouts(d.size, paletteOf(d)).find((l) => l.id === 'layout-title')!)]
  const n = new Map<string, number>()
  eachRef(d, ({ token }) => { const slot = token.split(' ')[0]; n.set(slot, (n.get(slot) ?? 0) + 1) })
  ok((n.get('bg1') ?? 0) > 0 && (n.get('tx1') ?? 0) > 0 && (n.get('accent1') ?? 0) > 0,
    `after applying Title, Background/Text/Accent 1 each have uses (${n.get('bg1') ?? 0}/${n.get('tx1') ?? 0}/${n.get('accent1') ?? 0})`)
}

// Every placeholder against what it sits on: the card under it, else the slide.
function legibility(name: string, slides: Slide[]) {
  for (const ly of slides) {
    const cards = ly.elements.filter((e) => e.type === 'shape' && e.id.includes('-bg')) as ShapeElement[]
    for (const el of ly.elements) {
      if (el.type !== 'text') continue
      const t = el as TextElement
      const under = cards.find((c) => t.x >= c.x && t.y >= c.y && t.x + t.w <= c.x + c.w && t.y + t.h <= c.y + c.h)
      const back = under ? under.fill : ly.background
      const r = contrast(t.color, back)
      ok(r >= 4.5, `${name}: ${ly.id}/${el.id} ${t.color} on ${back} = ${r.toFixed(2)}:1`)
    }
  }
}

console.log('\nplaceholder text reads on its backdrop\n')
for (const [name, theme] of [['default', {}], ['dark', DARK]] as const) {
  const d = deckWith(theme)
  legibility(name, builtinLayouts(d.size, paletteOf(d)))
}

// The issue's own journey: the layouts go in under one theme, THEN the theme
// changes. Whatever was decided when the layout was built must still read
// after the switch, so the slides are re-derived through the real path.
console.log('\nplaceholder text still reads after the theme is switched\n')
const SWITCH_TO: Array<[string, Partial<BentoDoc['theme']>]> = [
  ['dark', DARK],
  ['dark, peach accent', { background: '#101418', color: '#F5F7FA', accent: '#FF9E8A' }],
  ['brand', BRAND],
  ['slate on white', { background: '#FFFFFF', color: '#4A5560', accent: '#E4572E' }],
  ['brown on cream', { background: '#FFF4E0', color: '#3D2B1F', accent: '#D9822B' }],
  ['ink on paper, coral', { background: '#F4F1EA', color: '#1F3B4D', accent: '#FF6B5B' }],
  ['night, cream text', { background: '#0B1020', color: '#EDE6D6', accent: '#3FA7D6' }],
]
for (const [from, fromTheme] of [['default', {}], ['starter', starterDoc().theme]] as const) {
  for (const [to, theme] of SWITCH_TO) {
    const d = deckWith(fromTheme)
    d.slides = builtinLayouts(d.size, paletteOf(d)).map((l) => instantiateLayout(l))
    const mem = deriveMemory(d)
    derive(d, mem) // as opened
    Object.assign(d.theme, { palette: undefined }, theme)
    derive(d, mem) // the palette moved: every bound literal follows
    legibility(`${from} → ${to}`, d.slides.map((s, i) => ({ ...s, id: builtinLayouts()[i].id })))
  }
}

console.log('\napplying a layout carries its references\n')
{
  const d = deckWith(BRAND)
  const ls = builtinLayouts(d.size, paletteOf(d))
  const donor: Slide = { id: 's', background: '#FFFFFF', transition: 'fade', notes: '', elements: [
    { id: 'old', type: 'text', x: 0, y: 0, w: 100, h: 40, rotation: 0, opacity: 1, html: 'Hello', fontSize: 20, fontFamily: FONT_STACK, fontWeight: 400, color: '#123456', align: 'left', valign: 'top', lineHeight: 1.2, role: 'title' } as TextElement,
  ] }
  const out = applyLayout(donor, ls.find((l) => l.id === 'layout-title-content')!, new Set())
  const t = out.find((e) => e.id === 'ltc-title') as TextElement
  ok(t.html === 'Hello' && (t as unknown as Holder).themeRefs?.color === 'tx1' && lower(t.color) === lower(BRAND.color), `the title's content rides into a bound slot (${t.color})`)
}

console.log('\nnew text boxes and shapes\n')
ok(typeof contrastRatio === 'function' && typeof readableSlot === 'function', 'palette.ts exposes contrastRatio and readableSlot')
if (readableSlot) {
  const pal = paletteOf(newDoc())
  ok(readableSlot('#FFFFFF', pal) === 'tx1', 'on the theme background, a text box follows Text')
  ok(readableSlot('#1E2A3A', pal) === 'bg1', 'on a slide painted in Text (the divider), it follows Background')
  ok(readableSlot('#7F8C8D', pal) === null, 'on a mid-tone literal neither reads on, it stays an unbound literal')
  ok(readableSlot('linear-gradient(#FFFFFF, #EEEEEE)', pal) === 'tx1', 'a gradient background samples its first colour')
  ok(readableSlot('none', pal) === null, 'a background with no hex colour stays unbound')
}
{
  const ed = read('slides/src/editor/editor.ts')
  ok(/placeTool\(\(\) => defaultText\(this\.newTextInk\(\)\), true\)/.test(ed), 'the Text tool writes the bound ink')
  ok(/placeTool\(\(\) => this\.newShape\('rect'\)\)/.test(ed) && /placeTool\(\(\) => this\.newShape\('ellipse'\)\)/.test(ed), 'the Rectangle and Ellipse tools write a fill bound to Accent 1')
  ok((ed.match(/defaultText\(\{ html: (?:''|esc), \.\.\.this\.newTextInk\(\)/g) ?? []).length === 2, 'both plain-text paste paths write the bound ink')
  ok(/themeRefs: \{ fill: 'accent1' \}/.test(ed) && /themeRefs: \{ color: slot \}/.test(ed), 'the helpers write the reference beside the literal')
  ok(/setColor\([^)]*'background', layout\.background, layout\.themeRefs\?\.background \?\? null\)/.test(ed), 'Apply layout brings the background reference (or clears a stale one)')
  ok(/builtinLayouts\(doc\.size, paletteOf\(doc\)\)/.test(ed), 'the layout picker offers the built-ins resolved for this deck')
}

console.log('\nagents: a compact slide by layout and role follows the theme\n')
{
  const d = expandDoc({ compact: true, theme: DARK, slides: [{ layout: 'title', elements: [{ role: 'title', md: 'Hi' }] }] })
  const s = d.slides[0]
  const t = s.elements.find((e) => e.id === 'lt-title') as TextElement
  ok(lower(s.background) === lower(DARK.background) && (s as unknown as Holder).themeRefs?.background === 'bg1', `the slide takes the theme background, bound (${s.background})`)
  ok(lower(t.color) === lower(DARK.color) && (t as unknown as Holder).themeRefs?.color === 'tx1', `the title is the theme text colour, bound (${t.color})`)
  const own = expandDoc({ compact: true, theme: DARK, slides: [{ layout: 'title', background: '#334455', elements: [] }] }).slides[0]
  ok(own.background === '#334455' && !(own as unknown as Holder).themeRefs, 'a background the author wrote stays theirs, unbound')
}

console.log('\nexisting decks are left exactly as they were\n')
{
  // a slide built by the OLD Title layout: literals, the font stack, no refs
  const old: Slide = { id: 'old', background: '#FFFFFF', transition: 'fade', notes: '', elements: [
    { id: 'lt-bar', type: 'shape', shape: 'rect', x: 128, y: 304, w: 58, h: 6, rotation: 0, opacity: 1, fill: '#F7A600', stroke: 'transparent', strokeWidth: 0, radius: 2 } as ShapeElement,
    { id: 'lt-title', type: 'text', x: 128, y: 323, w: 1024, h: 112, rotation: 0, opacity: 1, html: 'Kept', placeholder: 'Click to add title', fontSize: 61, fontFamily: FONT_STACK, fontWeight: 700, color: '#1E2A3A', align: 'left', valign: 'middle', lineHeight: 1.25, role: 'title' } as TextElement,
  ] }
  const d = newDoc()
  d.slides = [old]
  d.theme.background = '#101418'; d.theme.color = '#F5F7FA'; d.theme.accent = '#3FA7D6'
  const before = JSON.stringify(d)
  derive(d, deriveMemory(d))
  ok(JSON.stringify(d) === before, 'a slide from the old layouts keeps its literal colours and font after a theme change (no guessed bindings)')
}
{
  const decks: Array<[string, BentoDoc]> = [['starter deck', starterDoc()]]
  const dir = join(root, 'scripts/fixtures/compact-decks')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) decks.push([f, JSON.parse(readFileSync(join(dir, f), 'utf8'))])
  for (const [name, doc] of decks) {
    const before = JSON.stringify(doc)
    derive(doc, deriveMemory(doc))
    ok(JSON.stringify(doc) === before, `${name}: opening it serialises byte-identically`)
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) process.exit(1)
