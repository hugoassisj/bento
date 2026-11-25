// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The deck as an agent reads it before an edit: window.bento.outline() and
// stats(). Ported from the addressed outline in nyblnet's Assistant (upstream
// PR #532, editor/assistant/material.ts) and brought up to the 1.3.0 format:
// design tokens, palette bindings, components, auto-layout frames and steps.
//
// WHY A TEXT OUTLINE. The document block of the starter deck is ~150 KB, so
// an agent that wants to retitle one slide must read ~40k tokens of
// geometry, defaults and inline svg it will never touch. The outline is the
// cheapest FAITHFUL view: every text, table cell, chart series, picture and
// note, each addressed `<slide>/<element id>` so a patch (ops.ts) can name
// it, plus what an edit must respect — the roles, the frames a child sits
// in, the component a member belongs to, the reveal step, the link, and
// which values are bound to a palette slot or a token. Decoration (svg
// textures, plain shapes with no words) is counted per slide, not listed;
// `outline({ slide: n })` lists one slide in full, every element as compact
// JSON, for a precise `set`.
//
// Never in an outline: `collab` (sharing keys), the embedded documents of
// embeds, review comments (reviewers' words, addressed to the author), and
// asset bytes — a data: URI or a long svg is elided to its size, and an
// elided value written back by a patch is refused (ops.ts).
//
// NUMBERING. Slides are numbered by their position in `doc.slides`, 1-based,
// interactive states and hidden slides INCLUDED and marked — the same
// numbers patch() takes. "Slide 3" in the show can be another slide; the
// outline's numbers are the only ones an address uses.
//
// Pure: no DOM, no store. scripts/test-slides-ops.ts drives it in node.

import type { BentoDoc, Slide, SlideElement } from './model.ts'
import { inLinearFlow } from './model.ts'
import { compactDoc } from './compact.ts'
import { markdownToHtml } from './editor/markdown.ts'
import { paletteOf, PALETTE_SLOTS, slotIsSet } from './palette.ts'
import { activeMode, modesOf, tokenValue } from './tokens.ts'
import { components } from './components.ts'
import { maxStep, stepOf } from './steps.ts'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Text per element in the deck view; the slide view carries it whole. */
export const OUTLINE_TEXT_MAX = 300
/** Speaker notes in the deck view (the slide view carries them whole). */
export const OUTLINE_NOTES_MAX = 64
/** The deck view stops adding slides past this many characters and says where it stopped. */
export const OUTLINE_MAX = 34000
/** A string longer than this that is markup or bytes is elided in the slide view. */
const ELIDE_OVER = 400
/** What an elided value reads as. A patch that writes one back is refused. */
export const ELIDED = /^@@elided /
const elided = (what: string, len: number) => `@@elided ${what} ${len > 2048 ? `${Math.round(len / 1024)} KB` : `${len} B`}@@`

/** The built-in layouts' names, for the header (compact.ts findLayout reads them). */
export const BUILTIN_LAYOUT_NAMES = ['title', 'title-content', 'two-col', 'section', 'three-cards', 'quote', 'image-left', 'image-right', 'blank']

/** The words in html: tags gone, entities read, whitespace folded. */
export function words(s: unknown): string {
  return typeof s === 'string'
    ? s.replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr)>/gi, ' ').replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ').trim()
    : ''
}

const cap = (s: string, max: number) => s.length <= max ? s : `${s.slice(0, max)}…(+${s.length - max} chars)`
/** A text the outline cut: an edit that sends it back is refused (ops.ts). */
export const CUT = /…\(\+\d+ chars\)$/
const q = (s: string, max = OUTLINE_TEXT_MAX) => JSON.stringify(cap(s, max))

/** `{color=tx1 fill=$color.card}`: what an element's values are bound to. */
function refs(el: SlideElement, usual?: Map<string, string>): string {
  const r = el.themeRefs ?? {}
  // what this element's kind usually binds: by role, else by type
  const expect = (k: string) => usual?.get(`${el.role} ${k}`) ?? usual?.get(`${el.type} ${k}`)
  const parts = Object.entries(r).map(([k, v]) => [k, bare(v)])
    .filter(([k, v]) => !usual || (HEADLINE_REFS.has(k) && expect(k) !== v))
    .map(([k, v]) => `${k}=${v}`)
  // a usual binding this element does NOT carry: its literal, so a line with
  // nothing on it always means "bound as usual"
  if (usual) for (const k of HEADLINE_REFS) {
    const lit = (el as unknown as Obj)[k]
    if (expect(k) && !r[k] && (typeof lit === 'string' || typeof lit === 'number')) parts.push(`${k}=${String(lit)}`)
  }
  return parts.length ? ` {${parts.join(' ')}}` : ''
}
/** A ref as an agent writes it: the " /a" own-alpha mark is the runtime's, not an author's. */
const bare = (v: string) => v.replace(/\s*\/a\s*$/, '').trim()

/** Per kind of element (its role, else its type) and headline key, the
 *  binding most of them carry — said once in the header and left off every
 *  line that matches it. Keys are `<kind> <key>`. */
function usualRefs(doc: BentoDoc): Map<string, string> {
  const tally = new Map<string, Map<string, number>>()
  const holders = new Map<string, number>() // elements of the kind that have the key at all
  for (const s of doc.slides) for (const e of s.elements) for (const k of HEADLINE_REFS) {
    if ((e as unknown as Obj)[k] === undefined) continue
    const v = e.themeRefs?.[k]
    for (const g of [...(e.role ? [`${e.role} ${k}`] : []), `${e.type} ${k}`]) {
      holders.set(g, (holders.get(g) ?? 0) + 1)
      if (!v) continue
      const m = tally.get(g) ?? new Map<string, number>()
      m.set(bare(v), (m.get(bare(v)) ?? 0) + 1); tally.set(g, m)
    }
  }
  const out = new Map<string, string>()
  for (const [g, m] of tally) {
    const [v, c] = [...m].sort((a, b) => b[1] - a[1])[0]
    if (c >= 3 && c / (holders.get(g) ?? c) >= 0.5) out.set(g, v)
  }
  return out
}
/** The bindings the deck view names; the rest are counted (`+3`) and listed
 *  in the slide view. Spacing, radii and gradient stops follow the system
 *  without an agent having to read them to change words. */
const HEADLINE_REFS = new Set(['color', 'fill', 'stroke', 'fontFamily', 'fontSize'])

/** A token value as one short word or phrase. */
function tokenText(v: unknown): string {
  if (isObj(v)) return [v.x ?? 0, v.y ?? 0, v.blur ?? 0, v.color ?? ''].join(' ')
  return String(v)
}

// --- text as an agent writes it back -----------------------------------------
//
// An outline that flattened `<br>` and `<b>` to spaces invited an edit that
// destroyed them: retitling with the outline's own words turned a three-line
// title into one line. So a text is printed in the markdown `edits` accepts
// (**bold**, *italic*, `code`, ~~strike~~, [links](https://…), line breaks as
// \n, bullets as typed) — and only when that markdown converts back to the
// very html stored. Anything markdown cannot say (a list, a heading, an
// attribute) is printed as `html "…"`, which `edits {id, html}` takes back.
// Either way, sending the outline's text unchanged is a no-op.

const MARKS: Record<string, string> = { b: '**', strong: '**', i: '*', em: '*', s: '~~', strike: '~~', del: '~~', code: '`' }
const decode = (t: string) => t.replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
/** html and markdownToHtml's output compared: an NBSP is one character however it is spelled */
const sameHtml = (a: string, b: string) => a.replace(/&nbsp;/g, '\u00a0').replace(/<br\s*\/?>/gi, '<br>') === b.replace(/&nbsp;/g, '\u00a0').replace(/<br\s*\/?>/gi, '<br>')

function htmlToMd(html: string, escape: boolean): string | null {
  let out = ''
  const href: string[] = []
  for (const tok of html.split(/(<[^>]*>)/)) {
    if (!tok) continue
    if (tok.startsWith('<')) {
      const m = /^<(\/?)([a-z0-9]+)([^>]*)>$/i.exec(tok)
      if (!m) return null
      const [, close, name, attrs] = m
      const tag = name.toLowerCase()
      if (tag === 'br') { out += '\n'; continue }
      if (MARKS[tag] && !attrs.trim()) { out += MARKS[tag]; continue }
      if (tag === 'a' && close) { const h = href.pop(); if (h === undefined) return null; out += `](${h})`; continue }
      const hm = tag === 'a' ? /^\s+href="([^"]*)"\s*$/.exec(attrs) : null
      if (!hm) return null
      href.push(decode(hm[1])); out += '['
      continue
    }
    const t = decode(tok)
    out += escape ? t.replace(/([*_~`])/g, '\\$1') : t
  }
  return href.length ? null : out
}

/** How the outline prints a stored text html, so that sending it back changes nothing. */
export function textForm(html: string): { md: string } | { html: string } {
  for (const esc of [false, true]) {
    const md = htmlToMd(html, esc)
    if (md !== null && sameHtml(markdownToHtml(md), html)) return { md }
  }
  return { html }
}
const showText = (html: string, max: number) => { const f = textForm(html); return 'md' in f ? q(f.md, max) : `html ${q(f.html, max)}` }

/** The content of one element, as the deck view says it. Empty = decoration. */
function content(el: SlideElement, full: boolean): string {
  const e = el as unknown as Obj
  const max = full ? Infinity : OUTLINE_TEXT_MAX
  switch (el.type) {
    case 'text': { const w = words(e.html); return w && (full || !/^(\{\{[^}]*\}\}\s*)+$/.test(w)) ? showText(String(e.html), max) : '' }
    case 'code': { const c = typeof e.content === 'string' ? e.content : ''; return c.trim() ? q(c, max) : '' }
    case 'table': {
      const rows = Array.isArray(e.rows) ? (e.rows as Obj[]) : []
      return rows.map((r, ri) => `r${ri + 1}: ${(Array.isArray(r.cells) ? (r.cells as Obj[]) : [])
        .map((c) => showText(String(c.html ?? ''), full ? Infinity : 80)).join(' | ')}`).join(' / ')
    }
    case 'chart': {
      const opt = isObj(e.option) ? e.option : {}
      const take = full ? 500 : 24
      const series = Array.isArray(opt.series) ? (opt.series as Obj[]).map((s) => {
        const data = Array.isArray(s.data) ? (s.data as unknown[]).slice(0, take).map((d) => isObj(d) ? `${String(d.name ?? '')}=${String(d.value ?? '')}` : String(d)).join(',') : ''
        return `${String(s.type ?? '')} ${JSON.stringify(String(s.name ?? ''))} [${data}]`
      }) : []
      const x = isObj(opt.xAxis) && Array.isArray(opt.xAxis.data) ? ` over [${(opt.xAxis.data as unknown[]).slice(0, take).map(String).join(',')}]` : ''
      return series.join('; ') + x
    }
    case 'image': case 'media': case 'svg': case 'embed': {
      const alt = typeof e.alt === 'string' && e.alt ? q(e.alt, 120) : ''
      const extra = el.type === 'embed' ? ` ${String(e.app ?? '')}` : el.type === 'media' ? ` ${String(e.kind ?? '')}` : ''
      return el.type === 'svg' ? alt : `${alt}${extra}`.trim() || '(no alt)'
    }
    default: return ''
  }
}

/** Frame, component, step, link, visibility — what an edit must respect. */
function flags(el: SlideElement, comps: Map<string, string>): string {
  const e = el as unknown as Obj
  const out: string[] = []
  if (isObj(e.layout)) {
    const L = e.layout
    out.push(`${String(L.dir)}${L.gap ? ` gap ${String(L.gap)}` : ''}${L.hug ? ' hug' : ''}`)
  }
  if (el.component) out.push(`${el.component.main ? 'main' : 'copy'} of ${JSON.stringify(comps.get(el.component.id) ?? el.component.id)}${el.component.over?.length ? ` over ${el.component.over.join(',')}` : ''}`)
  const st = stepOf(el)
  if (st > 0) out.push(`step ${st}`)
  if (typeof el.link === 'string') out.push(`→ ${el.link}`)
  if (el.type === 'chart' && isObj(e.source) && typeof e.source.tableId === 'string') out.push(`← table ${e.source.tableId}`)
  if (el.hidden) out.push('hidden')
  if (el.locked) out.push('locked')
  if (el.showOnHover) out.push(`on hover ${el.showOnHover}`)
  return out.length ? ` (${out.join(', ')})` : ''
}

/** One slide's header line. */
function slideHead(doc: BentoDoc, s: Slide, n: number): string {
  const f: string[] = []
  if (s.name) f.push(JSON.stringify(s.name))
  if (s.stateOf) f.push(`state of ${s.stateOf}`)
  if (s.hidden) f.push('hidden')
  if (s.unnumbered) f.push('unnumbered')
  if (s.transition && s.transition !== 'fade') f.push(s.transition)
  const steps = maxStep(s.elements)
  if (steps) f.push(`${steps} steps`)
  if (s.hover) f.push(`hover ${s.hover.type}`)
  const bgRef = s.themeRefs?.background
  if (bgRef) f.push(`bg=${bare(bgRef)}`)
  else if (s.background && s.background.toLowerCase() !== doc.theme.background.toLowerCase()) f.push(`bg ${cap(s.background, 60)}`)
  return `## ${n} ${s.id}${f.length ? ` · ${f.join(' · ')}` : ''}`
}

const componentNames = (doc: BentoDoc) => new Map(components(doc).map((c) => [c.id, c.name || c.id]))

/** The deck view of one slide: listed content, nested under its frames, and a count of the rest. */
function slideBlock(doc: BentoDoc, s: Slide, n: number, comps: Map<string, string>, usual: Map<string, string>): string[] {
  const lines = [slideHead(doc, s, n)]
  const byId = new Map(s.elements.map((e) => [e.id, e]))
  const kids = new Map<string, SlideElement[]>()
  const top: SlideElement[] = []
  for (const e of s.elements) {
    if (e.parentId && byId.has(e.parentId) && e.parentId !== e.id) kids.set(e.parentId, [...(kids.get(e.parentId) ?? []), e])
    else top.push(e)
  }
  const memo = new Map<string, boolean>()
  const listed = (e: SlideElement, seen = new Set<string>()): boolean => {
    if (memo.has(e.id)) return memo.get(e.id)!
    if (seen.has(e.id)) return false
    seen.add(e.id)
    const yes = !!content(e, false) || typeof e.link === 'string' || stepOf(e) > 0 || (kids.get(e.id) ?? []).some((k) => listed(k, seen))
    memo.set(e.id, yes)
    return yes
  }
  const rest = new Map<string, number>()
  const walk = (e: SlideElement, depth: number, seen: Set<string>) => {
    if (seen.has(e.id)) return
    seen.add(e.id)
    if (!listed(e)) {
      rest.set(e.type, (rest.get(e.type) ?? 0) + 1 + countBelow(e, seen))
      return
    }
    const pad = ' '.repeat(depth + 1)
    const role = e.role ? ` ${e.role}` : ''
    const c = content(e, false)
    // a component copy is one line: what it is, and the words it carries
    // (each addressed — a copy's text is an override, edited like any text)
    const comp = e.component
    const parent = e.parentId ? byId.get(e.parentId) : undefined
    if (comp && !comp.main && !(parent?.component?.id === comp.id && (parent.groupId ?? '') === (e.groupId ?? ''))) {
      const texts: string[] = []
      const gather = (x: SlideElement) => {
        seen.add(x.id)
        const cx = content(x, false)
        if (cx) texts.push(`${n}/${x.id} ${cx}`)
        for (const k of kids.get(x.id) ?? []) if (!seen.has(k.id)) gather(k)
      }
      for (const k of kids.get(e.id) ?? []) gather(k)
      const name = JSON.stringify(comps.get(comp.id) ?? comp.id)
      lines.push(`${pad}${n}/${e.id} copy of ${name}${c ? ` ${c}` : ''}${texts.length ? `: ${texts.join(', ')}` : ''}`)
      return
    }
    const kind = e.type === 'text' ? '' : isObj((e as unknown as Obj).layout) ? ' frame' : ` ${e.type}`
    lines.push(`${pad}${n}/${e.id}${kind}${role}${c ? ` ${c}` : ''}${flags(e, comps)}${refs(e, usual)}`)
    for (const k of kids.get(e.id) ?? []) walk(k, depth + 1, seen)
  }
  const countBelow = (e: SlideElement, seen: Set<string>): number => {
    let k = 0
    for (const c of kids.get(e.id) ?? []) { if (!seen.has(c.id)) { seen.add(c.id); k += 1 + countBelow(c, seen) } }
    return k
  }
  const seen = new Set<string>()
  for (const e of top) walk(e, 0, seen)
  if (rest.size) {
    const total = [...rest.values()].reduce((a, b) => a + b, 0)
    lines.push(`  +${total} more: ${[...rest].map(([t, k]) => `${t} ${k}`).join(', ')}`)
  }
  if (s.notes?.trim()) lines.push(`  notes ${q(s.notes.trim(), OUTLINE_NOTES_MAX)}`)
  return lines
}

/** The deck's design system and the numbering rule, in a few lines. */
function header(doc: BentoDoc): string[] {
  const shown = doc.slides.filter(inLinearFlow).length
  const out = [`# ${JSON.stringify(doc.title ?? '')} · ${doc.slides.length} slides (${shown} in the show) · ${doc.size.width}×${doc.size.height} · hash ${deckHash(doc)}`]
  out.push('# address <slide>/<element id>; slides by position, states and hidden included; outline({slide: n}) shows one in full; patch(ops, {base: hash})')
  const pal = paletteOf(doc)
  const slots = PALETTE_SLOTS.filter((k) => slotIsSet(doc, k) && pal[k]).map((k) => `${k} ${pal[k]}`)
  out.push(`palette: ${slots.join(', ')}`)
  const tk = doc.theme.tokens
  const names = Object.keys(tk?.set ?? {})
  if (names.length) {
    const modes = modesOf(tk)
    // a font token by its first family: an agent binds it by name, not by stack
    const shown = (k: string) => { const v = tokenText(tokenValue(doc, k)); return tk!.set[k].type === 'fontFamily' && v.includes(',') ? `${v.split(',')[0].trim()}…` : v }
    out.push(`tokens (${names.length}${modes.length > 1 ? `; modes ${modes.join('/')}, active ${activeMode(tk)}` : ''}): ${names.map((k) => `$${k} ${shown(k)}`).join(', ')}`)
  }
  const first = (stack: string) => stack.split(',')[0].trim()
  const fonts = [`body ${first(doc.theme.fontFamily)}`]
  if (doc.theme.headingFamily) fonts.push(`headings ${first(doc.theme.headingFamily)}`)
  if (doc.theme.codeFontFamily) fonts.push(`code ${first(doc.theme.codeFontFamily)}`)
  const embedded = [...new Set((doc.fonts ?? []).map((f) => f.family))]
  out.push(`fonts: ${fonts.join('; ')}${embedded.length ? `; embedded ${embedded.join(', ')}` : ''}`)
  const comps = components(doc)
  if (comps.length) {
    const copies = new Map<string, Set<string>>()
    for (const s of doc.slides) for (const e of s.elements) if (e.component && !e.component.main) {
      const set = copies.get(e.component.id) ?? new Set<string>(); set.add(`${s.id}|${e.groupId ?? e.id}`); copies.set(e.component.id, set)
    }
    out.push(`components: ${comps.map((c) => `${JSON.stringify(c.name || c.id)} (${c.id}, main on ${doc.slides.findIndex((s) => s.id === c.slideId) + 1}, ${copies.get(c.id)?.size ?? 0} copies)`).join('; ')}`)
  }
  const own = (doc.layouts ?? []).map((l) => `${JSON.stringify(l.name || l.id)} [${[...new Set(l.elements.map((e) => e.role).filter(Boolean))].join(',')}]`)
  out.push(`layouts: ${own.length ? `deck ${own.join(', ')}; ` : ''}built-in ${BUILTIN_LAYOUT_NAMES.join(', ')}`)
  return out
}

/** Big strings out: data: URIs, long svg markup, an embed's document and render. */
function elide(v: unknown, key = ''): unknown {
  if (typeof v === 'string') {
    if (/^data:/i.test(v) && v.length > 120) return elided(v.slice(5, v.indexOf(';') > 0 ? v.indexOf(';') : 20), v.length)
    if (v.length > ELIDE_OVER && (key === 'markup' || key === 'view' || /^\s*</.test(v) && /<svg[\s>]/i.test(v.slice(0, 200)))) return elided('svg', v.length)
    return v
  }
  if (Array.isArray(v)) return v.map((x) => elide(x, key))
  if (isObj(v)) {
    const out: Obj = {}
    for (const [k, x] of Object.entries(v)) out[k] = elide(x, k)
    return out
  }
  return v
}

/** The slide view: every element as compact JSON on its own addressed line. */
function slideFull(doc: BentoDoc, s: Slide, n: number): string[] {
  const lines = [slideHead(doc, s, n)]
  const c = compactDoc({ ...doc, slides: [s] } as BentoDoc)
  const cs = ((c.slides as Obj[])[0] ?? {}) as Obj
  const els = Array.isArray(cs.elements) ? (cs.elements as Obj[]) : []
  s.elements.forEach((full, i) => {
    const e: Obj = { ...(els[i] ?? {}) }
    delete e.id
    if (full.type === 'embed') { if ('doc' in e) e.doc = elided('document', JSON.stringify(e.doc ?? '').length) }
    if (isObj(e.themeRefs)) {
      // a field bound at the top level is its binding's value: the literal is
      // left out (a field that keeps its own opacity, " /a", keeps it)
      for (const [k, v] of Object.entries(e.themeRefs)) if (!k.includes('.') && !/\/a\s*$/.test(String(v))) delete e[k]
      e.themeRefs = Object.fromEntries(Object.entries(e.themeRefs).map(([k, v]) => [k, bare(String(v))]))
    }
    lines.push(`${n}/${full.id} ${JSON.stringify(elide(e))}`)
  })
  if (s.notes?.trim()) lines.push(`notes ${JSON.stringify(s.notes)}`)
  return lines
}

export interface OutlineOpts {
  /** one slide in full (a number in the outline's numbering, or a slide id) */
  slide?: number | string
  /** the deck view from this slide number on (after a capped outline) */
  from?: number
  /** …up to and including this one */
  to?: number
  /** only the elements and notes whose words contain this (case-insensitive) */
  find?: string
}

/** The slide a number or id names, with its 1-based number. */
export function slideAt(doc: BentoDoc, ref: unknown): { slide: Slide; n: number } | null {
  const n = typeof ref === 'number' ? ref : typeof ref === 'string' && /^\d+$/.test(ref) ? Number(ref) : NaN
  if (Number.isInteger(n)) return n >= 1 && n <= doc.slides.length ? { slide: doc.slides[n - 1], n } : null
  if (typeof ref !== 'string') return null
  const i = doc.slides.findIndex((s) => s.id === ref)
  return i < 0 ? null : { slide: doc.slides[i], n: i + 1 }
}

/**
 * A short content hash of what an outline shows and a patch acts on: the
 * slides (review comments aside), the theme, the layouts and the page size.
 * Computed, never stored. outline() prints it; patch({ base }) compares it.
 */
export function deckHash(doc: BentoDoc): string {
  const s = JSON.stringify([doc.size, doc.theme, doc.layouts ?? null, doc.slides], (k, v) => (k === 'comments' ? undefined : v))
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) }
  return (a >>> 0).toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0')
}

/** The deck view of slide n alone (patch() returns these for what it touched). */
export function slideOutline(doc: BentoDoc, n: number): string {
  const s = doc.slides[n - 1]
  return s ? slideBlock(doc, s, n, componentNames(doc), usualRefs(doc)).join('\n') : ''
}

/** The outline: the deck view, or one slide in full. Never throws. */
export function outlineDoc(doc: BentoDoc, opts: OutlineOpts = {}): string {
  const comps = componentNames(doc)
  if (opts.slide !== undefined) {
    const hit = slideAt(doc, opts.slide)
    if (!hit) return `# no slide ${JSON.stringify(opts.slide)}: the deck has ${doc.slides.length}, numbered by position, or name one by its id`
    return [`# hash ${deckHash(doc)} · each line: <slide>/<element id> and the element as compact JSON; a field named in themeRefs takes its value from that binding`, ...slideFull(doc, hit.slide, hit.n)].join('\n')
  }
  const usual = usualRefs(doc)
  const lines = header(doc)
  if (usual.size) {
    const by = new Map<string, string[]>()
    for (const [g, v] of usual) { const [kind, k] = g.split(' '); by.set(kind, [...(by.get(kind) ?? []), `${k}=${v}`]) }
    lines.push(`usual bindings (not repeated below): ${[...by].map(([kind, kv]) => `${kind} ${kv.join(' ')}`).join('; ')}`)
  }
  let size = lines.join('\n').length
  const from = Math.max(1, Math.floor(opts.from ?? 1))
  const to = Math.min(doc.slides.length, Math.floor(opts.to ?? doc.slides.length))
  const find = typeof opts.find === 'string' && opts.find.trim() ? opts.find.trim().toLowerCase() : ''
  let hits = 0
  for (let n = from; n <= to; n++) {
    let rows = slideBlock(doc, doc.slides[n - 1], n, comps, usual)
    if (find) {
      // a narrowed view: the slide head and the matching lines only
      const m = rows.slice(1).filter((l) => !/^\s*\+\d+ more:/.test(l) && l.toLowerCase().includes(find))
      if (!m.length) continue
      hits += m.length
      rows = [rows[0], ...m]
    }
    const block = rows.join('\n')
    if (size + block.length + 1 > OUTLINE_MAX && n > from) {
      lines.push(`# … slides ${n}–${to} not shown (outline capped at ${OUTLINE_MAX / 1000} KB): outline({ from: ${n} }), or narrow with { find: "<words>" } or { slide: n }`)
      break
    }
    lines.push(block)
    size += block.length + 1
  }
  if (find && !hits) lines.push(`# nothing matches ${JSON.stringify(opts.find)}`)
  return lines.join('\n')
}

// --- stats -------------------------------------------------------------------

/** Paint and type values: what "bound vs literal" counts. */
const STYLE_KEYS = ['fill', 'stroke', 'color', 'fontFamily', 'fontSize', 'radius', 'strokeWidth', 'shadow'] as const
const unset = (v: unknown) => v === undefined || v === null || v === '' || v === 'transparent' || v === 'none' || v === 0

export interface DeckStats {
  slides: number
  /** slides in the show (states and hidden slides left out) */
  shown: number
  elements: number
  byType: Record<string, number>
  /** the document JSON an agent would otherwise read (sharing keys left out) */
  bytes: number
  /** the outline of the whole deck */
  outlineBytes: number
  /** the largest assets first (inline bytes, or an offloaded blob's size) */
  assets: Array<{ key: string; bytes: number }>
  /** embedded font faces */
  fonts: Array<{ family: string; bytes: number; builtin?: true }>
  tokens: number
  components: number
  /** paint and type values (fill, stroke, color, fontFamily, fontSize, radius,
   *  strokeWidth, shadow; a slide's background) bound to a slot or token */
  bound: number
  /** …and the same values written as literals */
  literal: number
  /** slides with speaker notes */
  notes: number
}

/** A tiny summary of the deck. Pure; `bytes` is measured on `agentJson`. */
export function docStats(doc: BentoDoc, agentJson: string): DeckStats {
  const byType: Record<string, number> = {}
  let elements = 0, bound = 0, literal = 0
  const count = (holder: { themeRefs?: Record<string, string> }, keys: readonly string[]) => {
    const r = holder.themeRefs ?? {}
    for (const k of keys) {
      const v = (holder as Obj)[k]
      if (unset(v)) continue
      if (Object.keys(r).some((p) => p === k || p.startsWith(k + '.'))) bound++
      else literal++
    }
  }
  for (const s of doc.slides) {
    count(s, ['background'])
    for (const e of s.elements) { elements++; byType[e.type] = (byType[e.type] ?? 0) + 1; count(e, STYLE_KEYS) }
  }
  const assets = new Map<string, number>()
  for (const [k, v] of Object.entries(doc.assets ?? {})) if (typeof v === 'string') assets.set(k, v.length)
  for (const [k, b] of Object.entries(doc.blobs ?? {})) if (isObj(b) && typeof b.size === 'number') assets.set(k, Math.max(assets.get(k) ?? 0, b.size))
  const fontBytes = (asset: string) => assets.get(asset.replace(/^asset:/, '')) ?? 0
  return {
    slides: doc.slides.length,
    shown: doc.slides.filter(inLinearFlow).length,
    elements,
    byType,
    bytes: agentJson.length,
    outlineBytes: outlineDoc(doc).length,
    assets: [...assets].map(([key, bytes]) => ({ key, bytes })).sort((a, b) => b.bytes - a.bytes).slice(0, 10),
    fonts: (doc.fonts ?? []).map((f) => /^builtin:/.test(f.asset) ? { family: f.family, bytes: 0, builtin: true as const } : { family: f.family, bytes: fontBytes(f.asset) }),
    tokens: Object.keys(doc.theme.tokens?.set ?? {}).length,
    components: components(doc).length,
    bound,
    literal,
    notes: doc.slides.filter((s) => s.notes?.trim()).length,
  }
}
