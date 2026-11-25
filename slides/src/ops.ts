// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The patch: how an agent changes one thing in a deck without handing the
// deck back — window.bento.patch(ops). Ported from the ops language of
// nyblnet's Assistant (upstream PR #532, editor/assistant/ops.ts: the verbs,
// "content first by the outline's numbers, then structure on the original
// slides", every refusal named and never fatal) and moved from the compact
// copy to the live document, so it now speaks the 1.3.0 format: design
// tokens and palette slots as values, frames, components and steps.
//
// The reasoning is the PR's (docs/DECISIONS.md, 2026-09-18): a model reads
// the deck whole and writes it surgically. A re-emitted deck is as long as
// the input, every slide in it is at risk of a careless rewrite, undo
// collapses to one step over everything, and anything a person typed while
// the model was thinking is overwritten. A patch is a few hundred bytes and
// touches what it names.
//
// A patch is an ordered LIST of ops, `[{op: "edits", id, text}, …]`, run in
// that order (later ops may name what earlier ones created), or — the form
// PR #532's extension writes — one object whose keys are verbs, each a list:
//   edits   [{id, text}]                 the words of a text (markdown) or a code element
//   notes   [{slide, text}]              speaker notes
//   cells   [{id, row, col, text}]       one table cell, 1-based
//   chart   [{id, series:[{name?, data}], categories?}]   a chart's numbers
//   style   [{id, size?, weight?, align?}]  bigger|smaller, bold|normal, left|center|right
//   set     [{id, …fields, detach?, at?}]   merge fields onto an element
//   insert  [{slide, type, …fields, id?, parentId?, at?}]  a new element
//           [{slide, use: "<component>", x?, y?, texts?, parentId?}]  a component copy
//   delete  ["n/id"]                     an element, with everything inside it
//   slide   [{slide, background?, transition?, hidden?, unnumbered?, name?, notes?, layout?}]
//   add     [{after, from?, layout?, id?, title?, subtitle?, body?, …, notes?, elements?}]
//   remove  [slide]                      a slide, with its states
//   move    [{slide, to}]                put slide N where slide M is
//
// ADDRESSES are the outline's (outline.ts): `<slide>/<element id>`, the slide
// a 1-based position in doc.slides (states and hidden slides included) or a
// slide id. A bare element id resolves when exactly one slide has it. A
// slide NUMBER always means the position in the deck the patch was written
// against — the outline the agent read — however earlier ops in the same
// patch moved things, so "add after 3, remove 5, move 7 to 2" means what it
// read as; a slide the patch added is named by its id. The object form runs
// its content verbs first, then add, remove, move.
//
// ALL OR NOTHING (Google Slides' batchUpdate contract). Every op is run on a
// copy and every result gated before anything is committed; if any op is
// refused, nothing changes and every op still gets its reply — index-aligned,
// each saying what it resolved to, or why it was refused and what to do
// instead. `{ partial: true }` applies what passes (the Assistant's old
// behaviour), and a refused op leaves nothing behind (patchDoc re-runs the
// patch without it). New element and slide ids may be the caller's own (checked
// unique across the deck), so later ops can name them. `{ base }` takes the
// hash outline() printed: a deck that changed since is refused as stale.
// Re-applying an op that is already true is a no-op (`unchanged`); re-adding
// an id is refused by name.
//
// VALUES. A paint or type field may name the deck's design system instead of
// a literal: `"$color.card"` (a token) or `"accent1"`, `"accent2 -20%"` (a
// palette slot, colours only). The literal and the binding are written
// together, so the value follows the token or slot from then on. A field
// that is bound already is never silently overwritten by a literal — the op
// says `"detach": true` for that, or names a slot/token to rebind. Objects
// merge one level (`set {fx: {step: 2}}` keeps `fx.enter`); null deletes.
//
// TRUST. The result passes the same element and slide gate a pasted clip
// meets (untrusted.ts), element by element: a field the gate drops is named
// in `skipped` with the address and the reason, an element the gate would
// drop entirely is left as it was. Markup the patch wrote (text html, cell
// html, svg markup and css, links) is cleaned once on the way in (security
// conditions A–G of PR #532 hold unchanged). Ops never reach docId, collab,
// readonly, the theme, tokens, layouts, assets or fonts — only slides.
//
// Pure apart from the injected sanitizers and measurer: scripts/test-slides-
// ops.ts drives it in node; main.ts is the only caller in the shell.

import { markdownToHtml } from './editor/markdown.ts'
import { expandDocWithStats, findLayout, type ExpandStats } from './compact.ts'
import { applyLayout, isWebUrl, layoutElementIds, type BentoDoc, type Slide, type SlideElement } from './model.ts'
import { paletteOf, parseThemeRef, resolveRef, formatThemeRef } from './palette.ts'
import { tokenName, tokenValue } from './tokens.ts'
import { adoptComponents, components, instanceOf } from './components.ts'
import { isFrame, moveInFrame, moveIntoFrame, withDescendants } from './layout.ts'
import { sanitizeElement, sanitizeSlide, withDropReport, TOKEN_KEYS, SLIDE_TOKEN_KEYS } from './untrusted.ts'
import { deriveMemory, derive } from './derive.ts'
import type { Finding, ValidateResult } from './validate.ts'
import { CUT, ELIDED, deckHash, slideOutline, textForm } from './outline.ts'
import { moveBlock, parentOf, unitOf } from './editor/slidesel.ts'

type Obj = Record<string, unknown>
type El = SlideElement & Obj
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export const VERBS = ['edits', 'notes', 'cells', 'chart', 'style', 'set', 'insert', 'delete', 'slide', 'add', 'remove', 'move'] as const
export const TEXT_EDIT_MAX = 20000
export const OPS_MAX = 500        // ops one patch may carry, all verbs together
export const SET_MAX = 200
export const INSERT_MAX = 40
export const ADD_MAX = 20
export const SERIES_MAX = 500
export const DEFAULT_FONT_SIZE = 32
/** introduced findings a report lists, errors first */
export const FINDINGS_MAX = 20
const SIZE_STEP = 1.25

/** Fields a patch never writes: identity and type, the review thread, the
 *  bindings and component membership (written only through values: a slot
 *  or token name, `use`), and an embed's document, render and live opt-in. */
export const LOCKED_FIELDS: ReadonlySet<string> = new Set(['id', 'type', 'comments', 'component', 'themeRefs', 'live', 'doc', 'view', 'collab', 'docId', 'blobs', '__proto__', 'constructor', 'prototype'])
const SLIDE_FIELDS = new Set(['background', 'transition', 'hidden', 'unnumbered', 'name', 'notes', 'hover', 'layout'])
/** the add op's text fields → the role they fill */
const ADD_ROLES = ['title', 'subtitle', 'kicker', 'body', 'left', 'right', 'quote', 'attribution', 'card1', 'card2', 'card3']
const COLOR_KEYS = new Set(['fill', 'stroke', 'color', 'background'])
/** what a token of each type may drive, at the top level of an element */
const TOKEN_FITS: Record<string, readonly string[]> = {
  color: ['fill', 'stroke', 'color', 'background'],
  fontFamily: ['fontFamily'],
  fontSize: ['fontSize', 'letterSpacing', 'lineHeight', 'radius', 'strokeWidth', 'w', 'h'],
  number: ['fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'radius', 'strokeWidth', 'blur', 'backdropFilter', 'opacity', 'w', 'h'],
  opacity: ['opacity'],
  shadow: ['shadow'],
}
const NEW_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/
/** a slide id or an http(s) URL — what a `link` may hold (PR #532 cleanDoc) */
const LINK_ID = /^[A-Za-z0-9._:/-]{1,120}$/

export interface Skip { op: string; reason: string }

export interface Sanitizers { html: (html: string) => string; svg: (markup: string) => string; svgCss: (css: string) => string }

// ---------------------------------------------------------------------------
// values: a slot or token name → the literal and the binding

type RefValue = { literal: unknown; ref: string } | { err: string } | null

/** `"$name"` or a palette slot on a key that takes it; null = a plain literal. */
function refValue(doc: BentoDoc, key: string, v: unknown, slideLevel: boolean): RefValue {
  if (!str(v)) return null
  const keys = slideLevel ? SLIDE_TOKEN_KEYS : TOKEN_KEYS
  if (v.trim().startsWith('$')) {
    const name = tokenName(v.trim())
    if (!name) return { err: `${key}: ${JSON.stringify(v)} is not a token name` }
    if (!keys.has(key)) return { err: `${key} cannot be bound to a token` }
    const tok = doc.theme.tokens?.set?.[name]
    const val = tok && Object.hasOwn(doc.theme.tokens!.set, name) ? tokenValue(doc, name) : undefined
    if (val === undefined) return { err: `${key}: no token named $${name}` }
    const type = tok!.type ?? 'color'
    if (!(TOKEN_FITS[type] ?? []).includes(key)) return { err: `${key}: $${name} is a ${type} token` }
    return { literal: clone(val), ref: `$${name}` }
  }
  if (!COLOR_KEYS.has(key) || !keys.has(key)) return null
  const ref = parseThemeRef(v)
  if (!ref) return null
  if (ref.ownAlpha) return { err: `${key}: write the slot without " /a"` }
  const literal = resolveRef(v, paletteOf(doc))
  if (literal === null) return { err: `${key}: palette slot ${ref.slot} is not set in this deck` }
  return { literal, ref: formatThemeRef(ref) }
}

const refsUnder = (h: { themeRefs?: Record<string, string> }, k: string) =>
  Object.keys(h.themeRefs ?? {}).filter((p) => p === k || p.startsWith(k + '.'))
function dropRefs(h: { themeRefs?: Record<string, string> }, k: string) {
  for (const p of refsUnder(h, k)) delete h.themeRefs![p]
  if (h.themeRefs && !Object.keys(h.themeRefs).length) delete h.themeRefs
}
const sameValue = (a: unknown, b: unknown) => str(a) && str(b) ? a.trim().toLowerCase() === b.trim().toLowerCase() : JSON.stringify(a) === JSON.stringify(b)

/** An edit's text is markdown; a model that saw html writes `<br>` and
 *  `<p>` back (measured in PR #532): those become breaks, any other tag is
 *  text, escaped by the markdown path. */
const mdText = (t: string): string => t.slice(0, TEXT_EDIT_MAX)
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/\s*<\/p>\s*<p[^>]*>\s*/gi, '\n\n')
  .replace(/^\s*<p[^>]*>|<\/p>\s*$/gi, '')
const toHtml = (t: string) => markdownToHtml(mdText(t))

// ---------------------------------------------------------------------------
// the op list

/** One op: a verb and what one list item of that verb holds. */
export interface Op { verb: string; arg: unknown; bad?: string }
const ALIAS: Record<string, string> = { edit: 'edits', note: 'notes', cell: 'cells', charts: 'chart', sets: 'set', inserts: 'insert', slides: 'slide', adds: 'add', removes: 'remove', moves: 'move', deletes: 'delete' }
const verbOf = (k: unknown): string | null => !str(k) ? null : (VERBS as readonly string[]).includes(k) ? k : ALIAS[k] ?? null

/**
 * The patch as an ordered op list. An ARRAY of `{op: '<verb>', …}` runs in
 * its own order — later ops may name what earlier ones created. The OBJECT
 * form (PR #532's, what the Assistant's extension writes) runs its content
 * verbs first, then add, remove, move. A string is the error (bad-patch).
 */
export function normalizeOps(input: unknown): Op[] | string {
  if (Array.isArray(input)) {
    return input.map((item): Op => {
      if (!isObj(item)) return { verb: '?', arg: item, bad: 'each op is an object {op: "<verb>", …}' }
      const keys = Object.keys(item)
      const v = verbOf(item.op) ?? (keys.length === 1 && isObj(item[keys[0]]) ? verbOf(keys[0]) : null)
      if (!v) return { verb: String(item.op ?? keys[0] ?? '?'), arg: item, bad: `unknown op ${JSON.stringify(item.op ?? keys[0] ?? null)}; the verbs are ${VERBS.join(', ')}` }
      const arg = item.op !== undefined ? (({ op: _op, ...rest }) => rest)(item) : item[keys[0]]
      return { verb: v, arg }
    })
  }
  if (!isObj(input)) return `a patch is a list of ops [{op: "<verb>", …}] or one object whose keys are verbs (${VERBS.join(', ')})`
  const out: Op[] = []
  for (const k of Object.keys(input)) {
    if (!verbOf(k)) out.push({ verb: k, arg: input[k], bad: `unknown verb ${JSON.stringify(k)}; the verbs are ${VERBS.join(', ')}` })
    else if (!Array.isArray(input[k])) out.push({ verb: verbOf(k)!, arg: input[k], bad: `${k} takes a list` })
  }
  for (const v of VERBS) for (const k of Object.keys(input)) {
    if (verbOf(k) === v && Array.isArray(input[k])) for (const arg of input[k] as unknown[]) out.push({ verb: v, arg })
  }
  return out
}

/** What became of one op, index-aligned with the op list. */
export interface Reply {
  /** the op, said back with the address it resolved to (`set 3/sd-title`) */
  op: string
  ok: boolean
  /** why it was refused, and what to do instead */
  reason?: string
  /** ids the op created, to name in later ops */
  ids?: string[]
  /** it applied but changed nothing (already so) */
  unchanged?: true
}

export interface OpsOutcome {
  /** the next slide list: untouched slides are the original objects */
  slides: Slide[]
  replies: Reply[]
  /** what the patch did on its own beyond the ops (markup cleaned, a role placed in another slot) */
  notes: string[]
  /** text boxes written without a height — the browser measures them */
  autoHeight: ExpandStats['autoHeight']
  stacks: ExpandStats['stacks']
  /** remote hosts the patch introduced (a picture the deck will now fetch) */
  loads: string[]
}

/**
 * Run the ops against a copy of the document's slides, in order, then gate
 * what changed and clean the markup it wrote. Never throws on any input;
 * never mutates `doc`. Every op gets a reply.
 */
export function applyOps(doc: BentoDoc, list: Op[], san: Sanitizers): OpsOutcome {
  const work = clone(doc.slides) as Slide[]
  const start = [...work] // slide NUMBERS mean positions in the deck the patch was written against
  const origById = new Map(doc.slides.map((s) => [s.id, s]))
  const replies: Reply[] = list.map((o) => ({ op: o.verb, ok: true }))
  const notes: string[] = []
  const autoHeight: ExpandStats['autoHeight'] = []
  const stacks: ExpandStats['stacks'] = []
  let i = 0
  const name = (s: string) => { replies[i].op = s }
  const refuse = (reason: string, at = i) => { const r = replies[at]; r.ok = false; r.reason = r.reason ? `${r.reason}; ${reason}` : reason; delete r.unchanged }
  const writers = new Map<object, Set<number>>()
  const wrote = (o: object) => { const s = writers.get(o) ?? new Set<number>(); s.add(i); writers.set(o, s) }
  const keyBy = new Map<object, Map<string, number>>()
  const wroteKey = (o: object, k: string) => { const m = keyBy.get(o) ?? new Map<string, number>(); m.set(k, i); keyBy.set(o, m) }
  const view = (): BentoDoc => ({ ...doc, slides: work }) as BentoDoc
  const counts: Record<string, number> = {}
  const over = (verb: string, max: number) => (counts[verb] = (counts[verb] ?? 0) + 1) > max

  // ids: unique across the whole deck — a new element sharing an id with one
  // on another slide would morph with it (the morph idiom pairs by id)
  const taken = new Set<string>()
  for (const s of [...work, ...(doc.layouts ?? [])]) { taken.add(s.id); for (const e of s.elements) taken.add(e.id) }
  const freshId = (base: string) => { let k = 1; while (taken.has(`${base}-${k}`)) k++; const id = `${base}-${k}`; taken.add(id); return id }
  /** a caller's id: null = none given, false = unusable (the reason is refused) */
  const ownId = (want: unknown): string | null | false => {
    if (want === undefined) return null
    if (!str(want) || !NEW_ID.test(want)) { refuse(`id ${JSON.stringify(want)} is not an id: a letter, then letters, digits, . _ : - (64 at most)`); return false }
    if (taken.has(want)) { refuse(`id ${JSON.stringify(want)} is taken in this deck; choose another, or leave id out to have one minted`); return false }
    taken.add(want)
    return want
  }

  // ---- addressing
  /** how a reply names a slide: its number in the deck as read, or (new) its id */
  const num = (s: Slide) => { const k = start.indexOf(s); return k >= 0 ? String(k + 1) : s.id }
  const slideRef = (v: unknown): Slide | string => {
    const n = int(v) ? v : str(v) && /^\d+$/.test(v) ? Number(v) : NaN
    if (Number.isInteger(n)) {
      const s = n >= 1 && n <= start.length ? start[n - 1] : undefined
      if (!s) return `no slide ${n}: the deck has ${start.length} (numbered by position in the outline you read)`
      return work.includes(s) ? s : `slide ${n} was removed earlier in this patch`
    }
    if (str(v)) return work.find((s) => s.id === v) ?? `no slide ${JSON.stringify(v)} (a slide is its number in the outline, or its id)`
    return `name a slide by its number in the outline or its id (got ${JSON.stringify(v ?? null)})`
  }
  type Hit = { slide: Slide; el: El; addr: string }
  const worded = (s: Slide) => s.elements.filter((e) => e.type !== 'shape' && e.type !== 'svg').slice(0, 8).map((e) => e.id)
  const elRef = (a: unknown): Hit | string => {
    if (!str(a) || !a) return 'name an element as "<slide>/<element id>", as the outline does'
    for (let k = a.indexOf('/'); k > 0; k = a.indexOf('/', k + 1)) {
      const s = slideRef(a.slice(0, k))
      if (typeof s === 'string') { if (/^\d+$/.test(a.slice(0, k))) return s; continue }
      const id = a.slice(k + 1)
      const el = s.elements.find((e) => e.id === id) as El | undefined
      if (el) return { slide: s, el, addr: `${num(s)}/${id}` }
      const w = worded(s)
      return `no element ${JSON.stringify(id)} on slide ${num(s)}${w.length ? ` (with words there: ${w.join(', ')}; outline({ slide: ${num(s)} }) lists every element)` : ''}`
    }
    const homes = work.filter((s) => s.elements.some((e) => e.id === a))
    if (homes.length === 1) return { slide: homes[0], el: homes[0].elements.find((e) => e.id === a) as El, addr: `${num(homes[0])}/${a}` }
    if (homes.length > 1) return `${JSON.stringify(a)} is on ${homes.length} slides (${homes.slice(0, 6).map(num).join(', ')}…); write <slide>/${a}`
    return `no element ${JSON.stringify(a)} in the deck; addresses are "<slide>/<element id>" from the outline`
  }
  const said = (verb: string, o: unknown, key = 'id') => `${verb} ${isObj(o) && o[key] !== undefined ? String(o[key]) : str(o) || int(o) ? String(o) : '?'}`
  const ADD_LAYOUT_DEFAULT = 'title-content'
  const lastAdded = new Map<Slide | null, Slide>()

  /** Write `fields` onto a holder (element or slide): refs, the bound-value
   *  guard, one-level merge, null deletes. Returns how many fields changed. */
  const writeFields = (holder: Obj & { themeRefs?: Record<string, string> }, fields: Obj, slideLevel: boolean, detach: boolean): number => {
    let did = 0
    for (const [k, v] of Object.entries(fields)) {
      wroteKey(holder, k)
      if (LOCKED_FIELDS.has(k)) { refuse(`${k} cannot be changed by a patch`); continue }
      if (str(v) && ELIDED.test(v)) { refuse(`${k}: that is the outline's placeholder for a long value; leave the field out to keep it`); continue }
      const r = refValue(doc, k, v, slideLevel)
      if (r && 'err' in r) { refuse(r.err); continue }
      if (r) {
        if (sameValue(holder[k], r.literal) && holder.themeRefs?.[k] === r.ref) continue
        holder[k] = r.literal
        dropRefs(holder, k)
        ;(holder.themeRefs ??= {})[k] = r.ref
        did++; continue
      }
      const bound = refsUnder(holder, k)
      if (bound.length && !detach) {
        if (sameValue(holder[k], v)) continue
        refuse(`${k} is bound to ${bound.map((p) => holder.themeRefs![p]).join(', ')}: name a slot or token to rebind (e.g. "${k}": "${holder.themeRefs![bound[0]]}"), or add "detach": true to write a literal`)
        continue
      }
      if (v === null) { if (k in holder) { delete holder[k]; dropRefs(holder, k); did++ } continue }
      if (isObj(v) && isObj(holder[k])) {
        const merged: Obj = { ...(holder[k] as Obj) }
        for (const [sk, sv] of Object.entries(v)) { if (sk === '__proto__') continue; if (sv === null) delete merged[sk]; else merged[sk] = clone(sv) }
        if (JSON.stringify(merged) === JSON.stringify(holder[k])) continue
        holder[k] = merged
      } else {
        if (JSON.stringify(holder[k]) === JSON.stringify(v)) continue
        holder[k] = clone(v)
      }
      if (bound.length) dropRefs(holder, k)
      did++
    }
    return did
  }

  /** compact fields with slot/token values → the literal and the binding */
  const literals = (fields: Obj, skipKeys: string[] = []): Obj | null => {
    const el: Obj = {}
    const refs: Record<string, string> = {}
    let bad = false
    for (const [k, v] of Object.entries(fields)) {
      if (skipKeys.includes(k)) continue
      if (LOCKED_FIELDS.has(k) && k !== 'type' && k !== 'id') { refuse(`${k} cannot be written by a patch`); bad = true; continue }
      if (str(v) && ELIDED.test(v)) { refuse(`${k}: the outline's placeholder is not a value`); bad = true; continue }
      const r = refValue(doc, k, v, false)
      if (r && 'err' in r) { refuse(r.err); bad = true; continue }
      if (r) { el[k] = r.literal; refs[k] = r.ref } else if (v !== null) el[k] = clone(v)
    }
    if (Object.keys(refs).length) el.themeRefs = refs
    return bad ? null : el
  }

  /** a slide's unit — it and its interactive states (editor/slidesel.ts):
   *  states live right after their parent and move with it (discussion #514) */
  const unitEnd = (s: Slide): number => { const u = unitOf(work, parentOf(work, work.indexOf(s))); return Math.max(...u) }
  const parentSlide = (s: Slide): Slide => work[parentOf(work, work.indexOf(s))] ?? s

  /** refuse the fields a verb does not take, naming the ones it does */
  const only = (a: unknown, verb: string, allowed: readonly string[]): boolean => {
    if (!isObj(a)) return true
    const bad = Object.keys(a).filter((k) => !allowed.includes(k))
    if (bad.length) refuse(`${verb} does not take ${bad.map((k) => JSON.stringify(k)).join(', ')}; its fields are ${allowed.join(', ')}`)
    return !bad.length
  }
  /** the new html for a text the outline printed: unchanged when the text is the outline's own */
  const newHtml = (o: Obj, old: string, addr: string): string | null => {
    if (str(o.html)) return o.html
    if (!str(o.text)) { refuse('give text (markdown, as the outline prints it) or html'); return null }
    if (CUT.test(o.text)) { refuse(`that text was cut short in the outline; read outline({ slide: ${addr.split('/')[0]} }) for the whole of it`); return null }
    const was = textForm(old)
    if ('md' in was && was.md === o.text) return old
    if ('html' in was) notes.push(`${addr}: its old formatting had no markdown form and was replaced; send {id, html} to keep markup`)
    return toHtml(o.text)
  }

  // ---- the verbs, one op at a time
  const run: Record<string, (a: unknown) => void> = {
    edits(e) {
      const h = isObj(e) ? elRef(e.id) : 'an edit is {id: "<slide>/<element id>", text}'
      if (typeof h === 'string') { name(said('edit', e)); refuse(h); return }
      name(`edit ${h.addr}`)
      if (!only(e, 'edits', ['id', 'text', 'html'])) return
      const o = e as Obj
      const before = JSON.stringify(h.el)
      if (h.el.type === 'text') { const html = newHtml(o, String(h.el.html ?? ''), h.addr); if (html === null) return; h.el.html = html }
      else if (h.el.type === 'code') {
        if (!str(o.text)) { refuse('a code element takes text'); return }
        if (CUT.test(o.text)) { refuse(`that text was cut short in the outline; read outline({ slide: ${h.addr.split('/')[0]} }) for the whole of it`); return }
        h.el.content = o.text.slice(0, TEXT_EDIT_MAX)
      } else { refuse(`${h.addr} is a ${h.el.type}; edits change text and code elements (cells for a table, chart for a chart, set for anything else)`); return }
      if (JSON.stringify(h.el) === before) replies[i].unchanged = true
      wrote(h.el); wroteKey(h.el, h.el.type === 'code' ? 'content' : 'html')
    },
    notes(n) {
      const s = isObj(n) ? slideRef(n.slide) : 'notes are {slide, text}'
      if (typeof s === 'string') { name(said('notes', n, 'slide')); refuse(s); return }
      name(`notes ${num(s)}`)
      if (!only(n, 'notes', ['slide', 'text'])) return
      const text = (n as Obj).text
      if (!str(text)) { refuse('text must be a string'); return }
      if (CUT.test(text)) { refuse(`those notes were cut short in the outline; read outline({ slide: ${num(s)} }) for the whole of them`); return }
      if (s.notes === text.slice(0, TEXT_EDIT_MAX)) { replies[i].unchanged = true; return }
      s.notes = text.slice(0, TEXT_EDIT_MAX)
      wrote(s); wroteKey(s, 'notes')
    },
    cells(c) {
      const h = isObj(c) ? elRef(c.id) : 'a cell is {id, row, col, text} (1-based)'
      if (typeof h === 'string') { name(said('cell', c)); refuse(h); return }
      const o = c as Obj
      name(`cell ${h.addr} r${String(o.row)}c${String(o.col)}`)
      if (!only(c, 'cells', ['id', 'row', 'col', 'text', 'html'])) return
      if (h.el.type !== 'table') { refuse(`${h.addr} is a ${h.el.type}, not a table`); return }
      const rows = Array.isArray(h.el.rows) ? (h.el.rows as unknown as Obj[]) : []
      const width = rows[0] && Array.isArray(rows[0].cells) ? (rows[0].cells as unknown[]).length : 0
      const row = int(o.row) && o.row >= 1 && o.row <= rows.length ? rows[o.row - 1] : null
      const cells = row && Array.isArray(row.cells) ? (row.cells as Obj[]) : []
      const cell = int(o.col) && o.col >= 1 && o.col <= cells.length ? cells[o.col - 1] : null
      if (!cell) { refuse(`the table has ${rows.length} rows × ${width} columns, numbered from 1`); return }
      const html = newHtml(o, String(cell.html ?? ''), h.addr)
      if (html === null) return
      if (cell.html === html) { replies[i].unchanged = true; return }
      cell.html = html
      wrote(h.el); wroteKey(h.el, 'rows')
    },
    chart(ch) {
      const h = isObj(ch) ? elRef(ch.id) : 'a chart op is {id, series: [{name, data}], categories?}'
      if (typeof h === 'string') { name(said('chart', ch)); refuse(h); return }
      name(`chart ${h.addr}`)
      if (!only(ch, 'chart', ['id', 'series', 'categories'])) return
      if (h.el.type !== 'chart') { refuse(`${h.addr} is a ${h.el.type}, not a chart`); return }
      const src = isObj(h.el.source) ? h.el.source.tableId : undefined
      if (src) { refuse(`the chart follows table ${String(src)} on its slide; change that table's cells instead`); return }
      const before = JSON.stringify(h.el)
      const opt = isObj(h.el.option) ? h.el.option : {}
      const o = ch as Obj
      let did = 0
      const series = Array.isArray(opt.series) ? (opt.series as Obj[]) : []
      for (const s of Array.isArray(o.series) ? o.series : []) {
        if (!isObj(s) || !Array.isArray(s.data)) { refuse('each series is {name, data: [numbers]}'); continue }
        const target = series.find((x) => str(s.name) && x.name === s.name) ?? (series.length === 1 ? series[0] : undefined)
        if (!target) { refuse(`no series ${JSON.stringify(s.name ?? null)}; the series are ${series.map((x) => JSON.stringify(x.name ?? '')).join(', ')}`); continue }
        const nums = (s.data as unknown[]).slice(0, SERIES_MAX).map((d) => typeof d === 'number' && Number.isFinite(d) ? d : 0)
        // a pie keeps its slice names; the numbers land by position
        target.data = target.type === 'pie' && Array.isArray(target.data)
          ? (target.data as unknown[]).map((d, k) => isObj(d) ? { ...d, value: nums[k] ?? d.value } : (nums[k] ?? d))
          : nums
        did++
      }
      if (Array.isArray(o.categories)) {
        if (isObj(opt.xAxis)) { opt.xAxis.data = (o.categories as unknown[]).slice(0, SERIES_MAX).map(String); did++ }
        else refuse('this chart has no category axis')
      }
      if (!did && replies[i].ok) refuse('nothing to change: give series [{name, data}] or categories')
      if (JSON.stringify(h.el) === before && replies[i].ok) replies[i].unchanged = true
      wrote(h.el); wroteKey(h.el, 'option')
    },
    style(st) {
      const h = isObj(st) ? elRef(st.id) : 'a style op is {id, size?: "bigger"|"smaller", weight?: "bold"|"normal", align?: "left"|"center"|"right"}'
      if (typeof h === 'string') { name(said('style', st)); refuse(h); return }
      name(`style ${h.addr}`)
      if (!only(st, 'style', ['id', 'size', 'weight', 'align'])) return
      if (h.el.type !== 'text') { refuse(`${h.addr} is a ${h.el.type}; style changes text (set for anything else)`); return }
      const o = st as Obj
      const before = JSON.stringify(h.el)
      let asked = 0
      const guard = (k: string) => { if (refsUnder(h.el, k).length) { refuse(`${k} is bound to ${h.el.themeRefs![k]}; use set with a token name, or set with "detach": true`); return false } return true }
      if (o.size === 'bigger' || o.size === 'smaller') {
        asked++
        if (guard('fontSize')) { const cur = typeof h.el.fontSize === 'number' ? h.el.fontSize : DEFAULT_FONT_SIZE; h.el.fontSize = Math.round(o.size === 'bigger' ? cur * SIZE_STEP : cur / SIZE_STEP) }
      }
      if (o.weight === 'bold' || o.weight === 'normal') { asked++; if (guard('fontWeight')) h.el.fontWeight = o.weight === 'bold' ? 700 : 400 }
      if (o.align === 'left' || o.align === 'center' || o.align === 'right') { asked++; h.el.align = o.align }
      if (!asked) { refuse('nothing to change: size bigger|smaller, weight bold|normal, align left|center|right'); return }
      if (JSON.stringify(h.el) === before && replies[i].ok) replies[i].unchanged = true
      wrote(h.el)
    },
    set(e) {
      const h = isObj(e) ? elRef(e.id) : 'a set op is {id: "<slide>/<element id>", …fields}'
      if (typeof h === 'string') { name(said('set', e)); refuse(h); return }
      name(`set ${h.addr}`)
      if (over('set', SET_MAX)) { refuse(`over the limit of ${SET_MAX} set ops in one patch; send the rest in another`); return }
      const o = { ...(e as Obj) }
      const detach = o.detach === true
      const at = o.at
      delete o.id; delete o.detach; delete o.at
      let did = 0
      if (str(o.md) && h.el.type === 'text') { o.html = toHtml(o.md); delete o.md }
      if ('parentId' in o) {
        const p = o.parentId
        delete o.parentId
        if (p === null) { if (h.el.parentId) { delete h.el.parentId; delete h.el.sizing; did++ } }
        else if (str(p) && h.el.parentId === p.replace(/^[^/]+\//, '')) { /* already there */ }
        else if (str(p) && moveIntoFrame(h.slide, [h.el.id], p.replace(/^[^/]+\//, ''), int(at) ? at : Infinity)) did++
        else refuse(`parentId: ${JSON.stringify(p)} is not an unlocked auto-layout frame on slide ${num(h.slide)} that can take ${h.el.id}`)
      } else if (int(at)) {
        if (!h.el.parentId) refuse('at: the element is not in a frame (set parentId to put it in one)')
        else if (moveInFrame(h.slide, h.el.id, at)) did++
      }
      did += writeFields(h.el, o, false, detach)
      if (!did && replies[i].ok) replies[i].unchanged = true
      wrote(h.el)
    },
    insert(e) {
      const s = isObj(e) ? slideRef(e.slide) : 'an insert is {slide, type, …fields} or {slide, use: "<component>"}'
      if (typeof s === 'string') { name(said('insert on', e, 'slide')); refuse(s); return }
      const o = { ...(e as Obj) }
      name(`insert on ${num(s)}`)
      if (over('insert', INSERT_MAX)) { refuse(`over the limit of ${INSERT_MAX} inserts in one patch; send the rest in another`); return }
      const parent = str(o.parentId) ? o.parentId.replace(/^[^/]+\//, '') : undefined
      const frame = parent !== undefined ? s.elements.find((x) => x.id === parent) : undefined
      if (parent !== undefined && !(isFrame(frame) && !frame.locked)) { refuse(`parentId: ${JSON.stringify(o.parentId)} is not an unlocked auto-layout frame on slide ${num(s)}`); return }
      const at = int(o.at) ? o.at : Infinity
      if (o.use !== undefined) {
        if (!only(e, 'insert (use)', ['slide', 'use', 'x', 'y', 'texts', 'parentId', 'at'])) return
        // a copy of a component: its main's elements, fresh ids, the main's sig
        const all = components(view())
        const comp = all.find((c) => c.id === o.use || c.name === o.use)
        if (!comp) { refuse(`no component ${JSON.stringify(o.use)}; the components are ${all.map((c) => JSON.stringify(c.name || c.id)).join(', ') || 'none'}`); return }
        const bx = Math.min(...comp.main.map((m) => m.x)), by = Math.min(...comp.main.map((m) => m.y))
        const dx = typeof o.x === 'number' ? o.x - bx : 0, dy = typeof o.y === 'number' ? o.y - by : 0
        const els = instanceOf(comp, () => freshId('c'), dx, dy) as El[]
        name(`insert copy of ${JSON.stringify(comp.name || comp.id)} on ${num(s)}`)
        if (isObj(o.texts)) {
          for (const [mainId, text] of Object.entries(o.texts)) {
            const k = comp.main.findIndex((x) => x.id === mainId || x.component?.key === mainId)
            const t = k >= 0 ? els[k] : undefined
            if (!t || !str(text) || (t.type !== 'text' && t.type !== 'code')) { refuse(`texts: ${JSON.stringify(mainId)} is not a text of the component's main (its texts: ${comp.main.filter((x) => x.type === 'text').map((x) => x.id).join(', ')})`); continue }
            if (t.type === 'text') t.html = toHtml(text); else t.content = text
          }
        }
        s.elements.push(...els)
        for (const x of els) wrote(x)
        if (parent) moveIntoFrame(s, els.filter((x) => !x.parentId || !els.some((y) => y.id === x.parentId)).map((x) => x.id), parent, at)
        replies[i].ids = els.map((x) => `${num(s)}/${x.id}`)
        return
      }
      if (!str(o.type) && (str(o.md) || str(o.html) || str(o.text))) o.type = 'text'
      if (!str(o.type)) { refuse('type is required: text, shape, image, chart, table, code, svg, media or embed (or use: "<component>" for a component copy)'); return }
      const id = ownId(o.id)
      if (id === false) return
      const elId = id ?? freshId(o.type)
      name(`insert ${num(s)}/${elId}`)
      if (str(o.text)) { if (o.type === 'code') o.content = o.text; else if (!str(o.md) && !str(o.html)) o.md = o.text; delete o.text }
      const fields = literals(o, ['slide', 'use', 'at', 'parentId', 'texts'])
      if (!fields) return
      fields.id = elId
      const { doc: x, stats } = expandDocWithStats({ compact: true, size: doc.size, theme: doc.theme, slides: [{ id: s.id, background: s.background, elements: [fields] }] })
      const el = x.slides[0]?.elements[0] as El | undefined
      if (!el) { refuse('not an element'); return }
      el.id = elId
      if (stats.autoHeight.length) autoHeight.push({ slide: s.id, id: elId })
      for (const k of Object.keys(fields)) wroteKey(el, k)
      s.elements.push(el)
      wrote(el)
      if (parent) moveIntoFrame(s, [elId], parent, at)
      replies[i].ids = [`${num(s)}/${elId}`]
    },
    delete(d) {
      const h = elRef(isObj(d) ? d.id : d)
      if (typeof h === 'string') { name(said('delete', d)); refuse(h); return }
      if (!only(d, 'delete', ['id'])) return
      const gone = new Set(withDescendants(h.slide, [h.el]).map((e) => e.id))
      name(gone.size > 1 ? `delete ${h.addr} (+${gone.size - 1} inside)` : `delete ${h.addr}`)
      h.slide.elements = h.slide.elements.filter((e) => !gone.has(e.id))
      wrote(h.slide)
    },
    slide(e) {
      const s = isObj(e) ? slideRef(e.slide) : 'a slide op is {slide, background?, transition?, hidden?, unnumbered?, name?, notes?, layout?}'
      if (typeof s === 'string') { name(said('slide', e, 'slide')); refuse(s); return }
      name(`slide ${num(s)}`)
      const o = { ...(e as Obj) }
      const detach = o.detach === true
      delete o.slide; delete o.detach
      let did = 0
      if (o.layout !== undefined) {
        const ly = str(o.layout) ? findLayout(o.layout, view() as unknown as Obj) : undefined
        if (!ly) refuse(`no layout ${JSON.stringify(o.layout)}; the outline's header lists the layouts`)
        else {
          // "Apply layout" (editor.ts applyLayoutToCurrent): content matched by id, then role
          s.elements = applyLayout(s, ly, layoutElementIds(view()))
          s.background = ly.background
          dropRefs(s as unknown as Obj, 'background')
          did++
        }
        delete o.layout
      }
      for (const k of Object.keys(o)) if (!SLIDE_FIELDS.has(k)) { refuse(`${k} is not a slide field a patch sets (${[...SLIDE_FIELDS].join(', ')})`); delete o[k] }
      if (str(o.notes)) o.notes = o.notes.slice(0, TEXT_EDIT_MAX)
      did += writeFields(s as unknown as Obj, o, true, detach)
      if (!did && replies[i].ok) replies[i].unchanged = true
      wrote(s)
    },
    remove(r) {
      const s = slideRef(isObj(r) ? r.slide : r)
      if (typeof s === 'string') { name(said('remove', isObj(r) ? r.slide : r)); refuse(s); return }
      if (!only(r, 'remove', ['slide'])) return
      const states = work.filter((x) => x.stateOf === s.id)
      name(states.length ? `remove ${num(s)} (+${states.length} states)` : `remove ${num(s)}`)
      for (const x of [s, ...states]) work.splice(work.indexOf(x), 1)
      if (!work.length) { refuse('a deck keeps at least one slide'); work.push(s, ...states) }
    },
    add(a) {
      if (!isObj(a)) { name('add'); refuse('an add is {after, from?|layout?, id?, title?, body?, …, notes?, elements?}'); return }
      const anchor = a.after === 0 || a.after === undefined ? null : slideRef(a.after)
      if (typeof anchor === 'string') { name(`add after ${String(a.after)}`); refuse(anchor); return }
      name(`add after ${anchor ? num(anchor) : 0}`)
      if (!only(a, 'add', ['after', 'from', 'layout', 'id', 'notes', 'elements', 'background', 'transition', 'hidden', 'unnumbered', 'name', ...ADD_ROLES])) return
      if (over('add', ADD_MAX)) { refuse(`over the limit of ${ADD_MAX} new slides in one patch; send the rest in another`); return }
      const id = ownId(a.id)
      if (id === false) return
      const sid = id ?? freshId('slide')
      const roleTexts = ADD_ROLES.filter((r) => str(a[r]) && (a[r] as string).trim())
      let slide: Slide
      if (a.from !== undefined) {
        // a duplicate (editor.ts duplicateSlide): element ids kept, so it
        // morphs with its source; a component main arrives as a copy
        const src = slideRef(a.from)
        if (typeof src === 'string') { refuse(`from: ${src}`); taken.delete(sid); return }
        slide = clone(src)
        slide.id = sid
        delete slide.comments
        delete slide.stateOf
        adoptComponents(slide.elements, view())
        for (const r of roleTexts) {
          const bodies = slide.elements.filter((x) => x.role === 'body')
          const t = (r === 'left' ? bodies[0] : r === 'right' ? bodies[1] : slide.elements.find((x) => x.role === r)) as El | undefined
          if (!t || t.type !== 'text') { refuse(`${r}: slide ${num(src)} has no text with role ${r === 'left' || r === 'right' ? 'body' : r}; its roles are ${[...new Set(slide.elements.map((x) => x.role).filter(Boolean))].join(', ') || 'none'} (or edit its texts by id in a later op)`); continue }
          t.html = toHtml(a[r] as string)
        }
      } else {
        const raw: Obj[] = roleTexts.map((r) => ({ type: 'text', role: r, md: (a[r] as string).slice(0, TEXT_EDIT_MAX) }))
        for (const x of Array.isArray(a.elements) ? (a.elements as unknown[]).slice(0, INSERT_MAX) : []) {
          if (!isObj(x)) { refuse('elements: each is a compact element object'); continue }
          const el = literals(x)
          if (!el) continue
          if (str(el.id) && ownId(el.id) === false) continue
          raw.push(el)
        }
        const layout = str(a.layout) ? a.layout : roleTexts.length ? ADD_LAYOUT_DEFAULT : undefined
        if (layout && !findLayout(layout, view() as unknown as Obj)) { refuse(`no layout ${JSON.stringify(layout)}; the outline's header lists the layouts (or use from: <slide> to duplicate one of this deck's slides)`); taken.delete(sid); return }
        const { doc: x, stats } = expandDocWithStats({ compact: true, size: doc.size, theme: doc.theme, layouts: doc.layouts, slides: [{ id: sid, ...(layout ? { layout } : {}), elements: raw }] })
        slide = x.slides[0]
        for (const n of stats.notes) notes.push(`add ${sid}: ${n.reason}`)
        autoHeight.push(...stats.autoHeight)
        stacks.push(...stats.stacks)
        for (const el of slide.elements) taken.add(el.id)
      }
      if (!replies[i].ok) { taken.delete(sid); return }
      if (str(a.notes)) slide.notes = a.notes.slice(0, TEXT_EDIT_MAX)
      const fields: Obj = {}
      for (const k of ['background', 'transition', 'hidden', 'unnumbered', 'name']) if (a[k] !== undefined) fields[k] = a[k]
      writeFields(slide as unknown as Obj, fields, true, true)
      // after its anchor's unit (never between a slide and its states), and
      // after the slides this patch already put there
      const key = anchor ? parentSlide(anchor) : null
      const prev = lastAdded.get(key)
      const at = prev && work.includes(prev) ? work.indexOf(prev) + 1 : key ? unitEnd(key) + 1 : 0
      work.splice(at, 0, slide)
      lastAdded.set(key, slide)
      wrote(slide)
      name(`add ${sid} after ${anchor ? num(anchor) : 0}`)
      replies[i].ids = [sid]
    },
    move(m) {
      const s = isObj(m) ? slideRef(m.slide) : 'a move is {slide, to}'
      const t = isObj(m) ? slideRef(m.to) : 'a move is {slide, to}'
      name(isObj(m) ? `move ${String(m.slide)}→${String(m.to)}` : 'move')
      if (typeof s === 'string' || typeof t === 'string') { refuse(typeof s === 'string' ? s : t as string); return }
      name(`move ${num(s)}→${num(t)}`)
      if (!only(m, 'move', ['slide', 'to'])) return
      // units move whole (editor/slidesel.ts moveBlock): a parent carries its
      // states; a state never leaves its parent
      if (s.stateOf && parentSlide(s) !== s) { refuse(`slide ${num(s)} is a state of slide ${num(parentSlide(s))} and moves with it; move slide ${num(parentSlide(s))}`); return }
      const tp = parentSlide(t)
      if (tp === s) { replies[i].unchanged = true; return }
      const si = work.indexOf(s), ti = work.indexOf(tp)
      const drop = ti > si ? unitEnd(tp) + 1 : ti
      const next = moveBlock(work, [si], drop)
      if (next === work) { replies[i].unchanged = true; return }
      work.splice(0, work.length, ...next)
    },
  }

  for (i = 0; i < list.length; i++) {
    const o = list[i]
    if (i >= OPS_MAX) { refuse(`over the limit of ${OPS_MAX} ops in one patch; send the rest in another`); continue }
    if (o.bad) { refuse(o.bad); continue }
    try { run[o.verb](o.arg) } catch (err) { refuse(`could not apply: ${String((err as Error)?.message ?? err)}`) }
  }

  // ---- gate and clean what changed; keep the original object for what did not
  const before = remoteUrls(doc.slides)
  const loads = new Set<string>()
  const refuseAll = (o: object, reason: string) => { for (const k of writers.get(o) ?? []) refuse(reason, k) }
  const next = work.map((s) => {
    const o = origById.get(s.id)
    if (o && JSON.stringify(o) === JSON.stringify(s)) return o
    const label = num(s)
    const origEls = new Map((o?.elements ?? []).map((e) => [e.id, e]))
    const els: SlideElement[] = []
    for (const el of s.elements) {
      const was = origEls.get(el.id)
      if (was && JSON.stringify(was) === JSON.stringify(el)) { els.push(was); continue }
      const { result, dropped } = withDropReport(() => sanitizeElement(clone(el)))
      if (!result) {
        refuseAll(el, `${label}/${el.id} would not be a valid ${el.type} (${dropped.map((d) => `${d.path.replace(/^\//, '') || 'element'}: ${d.reason}`).join('; ')})`)
        if (was) els.push(was)
        continue
      }
      for (const d of dropped) {
        const top = d.path.split('/')[1] ?? ''
        const k = keyBy.get(el)?.get(top)
        const why = `${label}/${el.id} ${d.path.replace(/^\//, '')}: ${d.reason}`
        if (k !== undefined) refuse(why, k); else refuseAll(el, why)
      }
      const cleaned = clean(result as El, was as El | undefined, san)
      if (cleaned.length) notes.push(`${label}/${el.id} ${cleaned.join(', ')}: markup the format does not keep was removed`)
      for (const u of remoteUrls(result)) if (!before.has(u)) loads.add(u)
      els.push(result)
    }
    // slide-level fields, each through the slide gate
    const ns: Obj = {}
    for (const [k, v] of Object.entries(s)) {
      if (k === 'elements') continue
      const ov = o ? (o as unknown as Obj)[k] : undefined
      if (o && JSON.stringify(ov) === JSON.stringify(v)) { ns[k] = ov; continue }
      if (k === 'id') { ns.id = v; continue }
      const { result, dropped } = withDropReport(() => sanitizeSlide({ id: s.id, [k]: v }))
      if (dropped.length || !result || !(k in result)) {
        const at = keyBy.get(s)?.get(k)
        const why = `slide ${label} ${k}: ${dropped[0]?.reason ?? 'refused by the slide gate'}`
        if (at !== undefined) refuse(why, at); else refuseAll(s, why)
        if (ov !== undefined) ns[k] = ov
        continue
      }
      ns[k] = (result as unknown as Obj)[k]
    }
    ns.elements = els
    const res = ns as unknown as Slide
    return o && JSON.stringify(o) === JSON.stringify(res) ? o : res
  })
  return { slides: next, replies, notes, autoHeight, stacks, loads: [...loads] }
}

/** Clean the markup an element's patch wrote (only values that changed). */
function clean(el: El, was: El | undefined, san: Sanitizers): string[] {
  const did: string[] = []
  if (el.type === 'text' && str(el.html) && el.html !== was?.html) { const c = san.html(el.html); if (c !== el.html) { el.html = c; did.push('html') } }
  if (el.type === 'table' && Array.isArray(el.rows)) {
    const wr = Array.isArray(was?.rows) ? (was!.rows as unknown as Obj[]) : []
    ;(el.rows as unknown as Obj[]).forEach((r, ri) => (Array.isArray(r.cells) ? (r.cells as Obj[]) : []).forEach((c, ci) => {
      const old = (wr[ri]?.cells as Obj[] | undefined)?.[ci]?.html
      if (str(c.html) && c.html !== old) { const x = san.html(c.html); if (x !== c.html) { c.html = x; if (!did.includes('cells')) did.push('cells') } }
    }))
  }
  if (el.type === 'svg') {
    if (str(el.markup) && el.markup !== was?.markup) { const c = san.svg(el.markup); if (c !== el.markup) { el.markup = c; did.push('markup') } }
    if (str(el.css) && el.css !== was?.css) { const c = san.svgCss(el.css); if (c !== el.css) { el.css = c; did.push('css') } }
  }
  if (el.link !== undefined && el.link !== was?.link && !(isWebUrl(el.link) || (str(el.link) && LINK_ID.test(el.link)))) { delete el.link; did.push('link') }
  return did
}

/** Every http(s) host+path a value refers to, wherever in a string it sits
 *  (PR #532 condition F: the fetches a patch introduces are named, never
 *  added silently). */
export function remoteUrls(v: unknown, out = new Set<string>()): Set<string> {
  if (str(v)) {
    // anywhere in a string: a src, but also an <image href> inside svg
    // markup, a css url(), a link inside text html
    for (const m of v.matchAll(/https?:\/\/[^\s"'<>()\\]{1,2040}/gi)) {
      try { const u = new URL(m[0].replace(/&amp;/g, '&')); out.add(u.host + (u.pathname === '/' ? '' : u.pathname)) } catch { /* not a URL */ }
    }
  } else if (Array.isArray(v)) { for (const x of v) remoteUrls(x, out) }
  else if (isObj(v)) { for (const [k, x] of Object.entries(v)) if (k !== 'comments') remoteUrls(x, out) }
  return out
}

// ---------------------------------------------------------------------------
// the whole patch: validate every op, then apply all or nothing

export interface PatchOpts {
  /** report what would happen; change nothing */
  dryRun?: boolean
  /** the hash outline() (or the last patch) gave: refused if the deck has changed since */
  base?: string
  /** apply the ops that pass even when some are refused (default: all or nothing) */
  partial?: boolean
  /** return the outline of the slides the patch touched, after it */
  outline?: boolean
}

export interface PatchReport {
  ok: true
  /** whether the document changed (one undo step) */
  committed: boolean
  dryRun?: true
  /** one per op, in op order (the object form: content verbs, then add, remove, move) */
  replies: Reply[]
  /** the refused ops alone, with their index in `replies` */
  skipped: Array<Skip & { i: number }>
  /** when ops were refused and nothing changed: what to do */
  hint?: string
  /** validate() findings the patch introduced (not ones the deck already had), errors first */
  findings: Finding[]
  /** introduced findings past the first FINDINGS_MAX (validate() lists them all) */
  moreFindings?: number
  /** findings the deck had that the patch made go away */
  fixed: number
  /** what the patch did on its own: markup cleaned, a role placed in another slot */
  notes?: string[]
  /** remote hosts the deck will now load from */
  loads?: string[]
  /** the slide count, after */
  slides: number
  /** the deck's hash as it now stands: pass it as `base` to the next patch */
  hash: string
  /** with { outline: true }: the touched slides, after */
  outline?: string
}

export type PatchError = { ok: false; err: 'bad-patch' | 'stale' | 'readonly' | 'failed'; detail: string; hash?: string }

export interface PatchEnv {
  san: Sanitizers
  /** measure text boxes written without a height (browser only) */
  fit?: (doc: BentoDoc, stats: Pick<ExpandStats, 'autoHeight' | 'stacks'>) => void
  validate?: (doc: BentoDoc) => ValidateResult
}

const findingKey = (f: Finding) => [f.code, f.slide ?? '', f.element ?? '', f.path ?? ''].join('\u001f')

/**
 * Run a patch against `doc`: the next document (null when nothing should
 * change) and the report. Never throws, never mutates `doc`.
 */
export function patchDoc(doc: BentoDoc, input: unknown, opts: PatchOpts, env: PatchEnv): { next: BentoDoc | null; report: PatchReport | PatchError; fit?: Pick<ExpandStats, 'autoHeight' | 'stacks'> } {
  try {
    const now = deckHash(doc)
    let ops = input
    if (str(ops)) { try { ops = JSON.parse(ops) } catch (e) { return { next: null, report: { ok: false, err: 'bad-patch', detail: `the patch is not JSON (${(e as Error).message}); send a list of ops or an object of verbs`, hash: now } } } }
    const list = normalizeOps(ops)
    if (typeof list === 'string') return { next: null, report: { ok: false, err: 'bad-patch', detail: list, hash: now } }
    if (opts.base !== undefined && opts.base !== now) {
      return { next: null, report: { ok: false, err: 'stale', detail: `the deck changed since the outline this patch was written against (base ${String(opts.base)}, now ${now}); read outline() again and rebuild the patch`, hash: now } }
    }
    let r = applyOps(doc, list, env.san)
    if (opts.partial) {
      // a refused op must leave nothing behind, not even the fields it wrote
      // before it was refused: run again from the document with the refused
      // ops held back, until no op is newly refused (each round drops one at
      // least, so this ends). Every round starts from `doc`, so a relative
      // op (style bigger) applies once.
      const held = new Map<number, Reply>()
      for (let round = 0; round < list.length + 1; round++) {
        const fresh = r.replies.map((x, k) => ({ x, k })).filter(({ x, k }) => !x.ok && !held.has(k))
        if (!fresh.length) break
        for (const { x, k } of fresh) held.set(k, x)
        r = applyOps(doc, list.map((o, k) => held.has(k) ? { ...o, bad: 'held back' } : o), env.san)
      }
      for (const [k, x] of held) r.replies[k] = x
    }
    const refused = r.replies.filter((x) => !x.ok).length
    const changed = r.slides.length !== doc.slides.length || r.slides.some((s, k) => s !== doc.slides[k])
    const usable = changed && (!refused || !!opts.partial)
    const next = { ...doc, slides: r.slides } as BentoDoc
    if (usable && env.fit && (r.autoHeight.length || r.stacks.length)) env.fit(next, r)
    let findings: Finding[] = []
    let fixed = 0
    let more = 0
    if (usable && env.validate) {
      const had = env.validate(doc).findings
      const cand = clone(next)
      derive(cand, deriveMemory(doc))
      const after = env.validate(cand).findings
      const hadKeys = new Set(had.map(findingKey))
      const nowKeys = new Set(after.map(findingKey))
      const rank: Record<string, number> = { error: 0, warning: 1, info: 2 }
      const fresh = after.filter((f) => !hadKeys.has(findingKey(f))).sort((a, b) => rank[a.severity] - rank[b.severity])
      findings = fresh.slice(0, FINDINGS_MAX)
      more = fresh.length - findings.length
      fixed = had.filter((f) => !nowKeys.has(findingKey(f))).length
    }
    const commit = usable && !opts.dryRun
    const skipped = r.replies.map((x, k) => ({ x, k })).filter(({ x }) => !x.ok).map(({ x, k }) => ({ i: k, op: x.op, reason: x.reason ?? 'refused' }))
    const report: PatchReport = {
      ok: true, committed: commit, ...(opts.dryRun ? { dryRun: true as const } : {}),
      replies: r.replies, skipped,
      ...(refused && !opts.partial ? { hint: `nothing was changed: ${refused} of ${r.replies.length} ops were refused (see skipped). Fix them and send the whole patch again, or pass { partial: true } to apply the others.` } : {}),
      findings, ...(more ? { moreFindings: more } : {}), fixed,
      ...(r.notes.length ? { notes: r.notes } : {}),
      ...(r.loads.length && usable ? { loads: r.loads } : {}),
      slides: (commit ? r.slides : doc.slides).length,
      hash: commit ? deckHash(next) : now,
    }
    if (opts.outline && usable) {
      const was = new Set<Slide>(doc.slides)
      report.outline = r.slides.map((s, k) => (was.has(s) ? '' : slideOutline(next, k + 1))).filter(Boolean).join('\n')
    }
    return { next: commit ? next : null, report, fit: { autoHeight: r.autoHeight, stacks: r.stacks } }
  } catch (e) {
    return { next: null, report: { ok: false, err: 'failed', detail: `the patch could not be run (${String((e as Error)?.message ?? e)}); nothing was changed` } }
  }
}
