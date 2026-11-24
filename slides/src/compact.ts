// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * The compact document — an authoring shape for agents (issue #422,
 * discussion #411 by benedictjohannes, whose bentoUtils.ts POC is the idea
 * this follows).
 *
 * A full bento/slides element carries a dozen fields no author chose:
 * rotation 0, opacity 1, the font stack, weight 400, centre/middle, line
 * height 1.25 … An agent writing a hundred-element deck spends most of its
 * output on that boilerplate. The compact form is the same document with
 * every field that equals what the editor would have inserted LEFT OUT, and
 * three conveniences on top:
 *
 *   - `"compact": true` at the top level says "expand me". Without it a
 *     document is taken as full, exactly as today — so a full file that
 *     happens to lack an optional field keeps its meaning (a text box with
 *     no `fontFamily` renders in the THEME font; the expanded default is the
 *     editor's font stack, and those are not the same thing).
 *   - `elements` may nest arrays: `[title, [cardBg, cardTitle, cardBody]]`.
 *     A factory helper that returns a group is the natural way to write a
 *     card, and flattening it here means the helper needs no spread at the
 *     call site (the POC's `BentoElement | BentoElement[]`).
 *   - `id` may be omitted. A missing id is minted DETERMINISTICALLY as
 *     `${slideId}-${type}-${n}` (n = the element's index on that slide), so
 *     re-running the same generator yields the same ids, morph pairing across
 *     slides still works when the author repeats an id on purpose, and a
 *     round-trip through the editor never changes an id it did not mint.
 *
 * Round two, still compact-input only (the saved file is unchanged):
 *
 *   - A text element may OMIT `h`, or say `h: "auto"`: the box is sized to
 *     its text — the same measurement the panel's "Fit height to text" makes,
 *     on the deck's real fonts. An agent cannot know how tall three lines of
 *     24 pt Inter at 800 px are; the runtime can. Measuring needs the DOM, so
 *     this module (pure, node-importable) writes a PROVISIONAL one-line h and
 *     lists the element in `autoHeight`; compactload.ts (browser) measures and
 *     writes the real number before the document reaches the store.
 *   - A text element may carry `md` instead of `html`: markdown, converted by
 *     the SAME function the editor uses for pasted plain text
 *     (editor/markdown.ts markdownToHtml — bold, italic, code, strike, bullets
 *     and indented sub-bullets, [caption](url)). When both are present `html`
 *     wins and `md` is dropped; `md` never reaches the document.
 *
 * Round three — placement by layout and role, so an agent never writes a
 * coordinate it did not choose:
 *
 *   - A compact slide may say `"layout": "<layout id>"` (a built-in, or one
 *     of the compact document's own `layouts`). Its elements may then omit
 *     geometry and typography and carry a `role` instead — `title`, `body`,
 *     `subtitle`, `kicker`, `quote`, `attribution`, `image`, `card1`…: the
 *     layout is instantiated the way the picker does it (element ids KEPT, so
 *     slides born from the same layout still morph their chrome) and each
 *     role'd element's content is laid onto the layout's slot with that role
 *     through model.ts applyLayout — the same matching "Apply layout" in the
 *     editor uses. An element WITH explicit `x y w h` is placed as given, on
 *     top, role or not. A role the layout has no slot for falls back to the
 *     body slot (or, with no body either, to the editor's default frame) and
 *     the load report says so. `left`/`right` name the first and second
 *     `body` slot of a two-column layout. More `body` elements than body slots
 *     STACK into the slot top-to-bottom: an equal share of the slot's height
 *     each here (pure); compactload.ts then measures each and restacks with a
 *     gap so a title and three paragraphs lay out as a reader expects.
 *
 * Round four — the deck's design system is the shortest thing to write
 * (00-READ-FIRST §6: what the deck defines wins over the editor's defaults):
 *
 *   - Names as values. `"fill": "accent1"`, `"color": "tx1 -20%"`,
 *     `"background": "bg2"` name a palette slot; `"radius": "$radius.md"`,
 *     `"fontFamily": "$font.body"` name a token. Expansion writes the resolved
 *     literal AND the `themeRefs` entry, the pair palette.ts / tokens.ts keep,
 *     so the two cannot disagree. A `themeRefs` entry whose property is left
 *     out is read the same way. A name that does not resolve is reported (with
 *     the names that do exist) and the property takes its default.
 *   - `{ "use": "<component id or name>", x, y, over }` is a copy of a
 *     component's main: its members with `component.key`, `off` and the
 *     main's current `sig`, so it follows later edits to the main, and only
 *     the keys `over` lists overridden.
 *   - `"like": "<slide id>"` starts a slide from an EARLIER one: its
 *     background, slide-level `themeRefs`, transition and recurring furniture
 *     (elements whose ids recur on other slides, role'd slots excepted).
 *   - Theme-first defaults: a text element's omitted `fontFamily` stays
 *     ABSENT (it renders in the theme font, as in a full document), a shape's
 *     omitted `fill` is bound to `accent1`, and a slide's omitted background
 *     is bound to `bg1`. compactDoc strips such a pair only when both halves
 *     match, so the round-trip still holds.
 *   - A `$token` binding written beside a literal that disagrees with the
 *     token is reported: the open-time rule (tokens.ts syncTokenRefs) drops it.
 *
 * Every other default comes from the SAME functions model.ts's editor paths use
 * (defaultText, defaultShape, …), never a second table — a second table is
 * what drifts. Where the editor derives a value from the deck (text colour
 * from the slide background via readableInk, a table's style from the theme,
 * a slide's background from the theme), expansion consults the same thing.
 *
 * Contract: `expandDoc(compactDoc(d))` deep-equals `d` for every valid full
 * document (scripts/test-slides-compact.ts holds the starter deck and the
 * gallery decks to it), and `compactDoc` never removes a field whose value
 * differs from the default. The FILE on disk is always full: nothing here
 * touches save, so no shipped shell ever meets a compact document.
 */

import { markdownToHtml } from './editor/markdown.ts'
import {
  FORMAT, FORMAT_VERSION, FONT_STACK,
  defaultText, defaultShape, defaultImage, defaultChart, defaultCode, defaultTable, defaultMedia,
  readableInk, isLightBg, newDoc, builtinLayouts, applyLayout, slotTakes, textHasContent,
  type BentoDoc, type Slide, type SlideElement, type ShapeKind,
} from './model.ts'
import { PALETTE_SLOTS, paletteOf, parseThemeRef, resolveRef, formatThemeRef, keepAlpha, type Palette } from './palette.ts'
import { layoutSlide } from './layout.ts'
import { tokenName, tokenValue, bindToken, tokenAgrees } from './tokens.ts'
import { TOKEN_KEYS, SLIDE_TOKEN_KEYS } from './untrusted.ts'
import { components, mainSig, type ComponentInfo } from './components.ts'

/** Marker on a compact document. Consumed by expandDoc; never stored. */
export const COMPACT_FLAG = 'compact'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
  const ka = Object.keys(a as Obj), kb = Object.keys(b as Obj)
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Obj)[k], (b as Obj)[k]))
}

/**
 * What the editor would insert for this element type on this slide, with the
 * author's fields laid over it. `x y w h` and the type's required content are
 * never defaulted here in a way an author would keep — the defaults' geometry
 * is a fixed spot on the canvas, so compactDoc keeps geometry always.
 */
function elementDefaults(el: Obj, slide: Obj, doc: Obj): Obj | null {
  const theme = (doc.theme ?? {}) as BentoDoc['theme']
  const bg = typeof slide.background === 'string' ? slide.background : (theme?.background ?? '#FFFFFF')
  const ink = readableInk(bg)
  switch (el.type) {
    case 'text': {
      // no fontFamily: absent follows the theme font, as in a full document
      const d = defaultText({ id: '', html: '', color: ink }) as unknown as Obj
      delete d.fontFamily
      return d
    }
    case 'shape': {
      // fill is a binding (boundDefaults), never the editor's own orange
      const d = defaultShape((el.shape as ShapeKind) ?? 'rect', { id: '' }) as unknown as Obj
      delete d.fill
      return d
    }
    case 'image': return defaultImage('', { id: '' }) as unknown as Obj
    case 'chart': return defaultChart({}, { id: '' }) as unknown as Obj
    case 'code': return defaultCode({ id: '', content: '', color: ink }) as unknown as Obj
    case 'table': {
      // editor.newTable(): themed style, adapted for a dark slide
      const tbl = defaultTable({ id: '' }, theme) as unknown as Obj
      if (!isLightBg(bg)) {
        const style = { ...(tbl.style as Obj) }
        style.color = ink
        style.zebra = 'rgba(255,255,255,0.06)'
        style.borderColor = 'rgba(255,255,255,0.16)'
        tbl.style = style
      }
      return tbl
    }
    case 'media': return defaultMedia((el.kind as 'video' | 'audio') ?? 'video', '', { id: '' }) as unknown as Obj
    default: return null // svg, embed: no insert helper, nothing to default
  }
}

/** Keys compactDoc never strips even when equal to the default: identity,
 *  geometry and the type's own content. Absent = the element is unplaced. */
const KEEP = new Set(['id', 'type', 'x', 'y', 'w', 'h', 'html', 'shape', 'kind', 'src', 'option', 'content', 'columns', 'rows'])

/** A slide's plain defaults. Its background is a binding (slideBound). */
function slideDefaults(): Obj {
  return { transition: 'fade', notes: '', elements: [] }
}

type Bound = Record<string, [unknown, string]>
const themeOf = (doc: Obj) => (isObj(doc.theme) ? doc.theme : {}) as { background?: string; accent?: string }

/** Defaults that are a BINDING: the literal and the palette ref expansion
 *  writes together when the author leaves the key out. */
const elementBound = (el: Obj, doc: Obj): Bound =>
  el.type === 'shape' ? { fill: [themeOf(doc).accent ?? '#F7A600', 'accent1'] } : {}
const slideBound = (doc: Obj): Bound => ({ background: [themeOf(doc).background ?? '#FFFFFF', 'bg1'] })

/** compactDoc's half: drop a bound pair only when the literal AND the ref
 *  match, so expansion puts back exactly what was there. */
function stripBound(src: Obj, out: Obj, bound: Bound): void {
  for (const [k, [v, ref]] of Object.entries(bound)) {
    const refs = isObj(src.themeRefs) ? src.themeRefs : {}
    if (!deepEqual(src[k], v) || refs[k] !== ref) continue
    delete out[k]
    const rest = { ...refs }
    delete rest[k]
    if (Object.keys(rest).length) out.themeRefs = rest; else delete out.themeRefs
  }
}

function docDefaults(): Obj {
  const d = newDoc() as unknown as Obj
  // docId and modified are minted per document; never a default to strip or fill
  return { format: FORMAT, version: FORMAT_VERSION, title: d.title, size: d.size, theme: d.theme }
}

// ---------------------------------------------------------------------------

/** Strip every field equal to what expandDoc would put back. Pure; the input
 *  is not mutated. The result carries `compact: true`. */
export function compactDoc(full: BentoDoc): Obj {
  const doc = full as unknown as Obj
  const out: Obj = { [COMPACT_FLAG]: true }
  const dd = docDefaults()
  for (const [k, v] of Object.entries(doc)) {
    if (k === 'slides' || k === COMPACT_FLAG) continue
    if (k in dd && deepEqual(v, dd[k])) continue
    out[k] = v
  }
  // theme: strip the slots that equal newDoc's theme, keep the rest
  if (isObj(doc.theme)) {
    const base = dd.theme as Obj
    const th: Obj = {}
    for (const [k, v] of Object.entries(doc.theme)) if (!(k in base && deepEqual(v, base[k]))) th[k] = v
    if (Object.keys(th).length) out.theme = th; else delete out.theme
  }
  out.slides = ((doc.slides ?? []) as Obj[]).map((slide) => {
    const sd = slideDefaults()
    const s: Obj = {}
    for (const [k, v] of Object.entries(slide)) {
      if (k === 'elements') continue
      if (k in sd && deepEqual(v, sd[k])) continue
      s[k] = v
    }
    stripBound(slide, s, slideBound(doc))
    const els = ((slide.elements ?? []) as Obj[]).map((el, i) => {
      const defaults = elementDefaults(el, slide, doc)
      const e: Obj = {}
      const minted = el.id === mintId(slide, el, i)
      for (const [k, v] of Object.entries(el)) {
        if (k === 'id' && minted) continue
        if (KEEP.has(k) || !defaults || !(k in defaults)) { e[k] = v; continue }
        if (deepEqual(v, defaults[k])) continue
        e[k] = v
      }
      stripBound(el, e, elementBound(el, doc))
      return e
    })
    if (els.length) s.elements = els
    return s
  })
  return out
}

const mintId = (slide: Obj, el: Obj, i: number) => `${slide.id}-${el.type}-${i}`

/** Is the author's doc-level value the shape the editor will dereference?
 *  format/version must be ours; size a {width,height} of numbers; theme an
 *  object; title a string. */
const usableDocField = (k: string, v: unknown, dd: Obj): boolean =>
  k === 'size' ? isObj(v) && typeof v.width === 'number' && typeof v.height === 'number' && v.width > 0 && v.height > 0
  : k === 'theme' ? isObj(v)
  : k === 'title' ? typeof v === 'string'
  : k === 'format' || k === 'version' ? v === dd[k]
  : true

/** Is this JSON a compact document? The flag decides; nothing is inferred. */
export const isCompact = (doc: unknown): boolean => isObj(doc) && doc[COMPACT_FLAG] === true

/** What expansion did, for the load report. `autoHeight` names the text
 *  elements (slide id + element id) whose `h` is provisional. */
export interface ExpandStats {
  /** fields filled in from defaults (doc, slide and element level) */
  expanded: number
  /** ids minted for elements that had none */
  minted: number
  /** text elements converted from `md` */
  fromMarkdown: number
  /** text elements whose h is provisional — the browser measures these */
  autoHeight: Array<{ slide: string; id: string }>
  /** slides laid out from a layout by role */
  laidOut: number
  /** role'd elements the layout had no slot for, and where they went */
  notes: Array<{ path: string; reason: string }>
  /** body elements stacked into one slot; compactload.ts restacks these by
   *  measured height (ids in stacking order, the slot's frame) */
  stacks: Array<{ slide: string; ids: string[]; slot: { x: number; y: number; w: number; h: number } }>
}

/** The gap between stacked body elements, in slide px. */
export const STACK_GAP = 16

/** A layout's role → slot map (first slot per role wins; `left`/`right` are
 *  the first and second `body` slot). Exported for AGENTS.md's table rig. */
export function layoutRoles(layout: Slide): Record<string, string> {
  const roles: Record<string, string> = {}
  const bodies: string[] = []
  for (const el of layout.elements) {
    if (!el.role) continue
    if (!(el.role in roles)) roles[el.role] = el.id
    if (el.role === 'body') bodies.push(el.id)
  }
  if (bodies.length >= 2) { roles.left = bodies[0]; roles.right = bodies[1] }
  return roles
}

/** The compact `layout` name resolved to a layout for this deck: a built-in
 *  (by id, with or without the `layout-` prefix) or one of the document's. */
export function findLayout(name: string, doc: Obj): Slide | undefined {
  const size = doc.size as { width: number; height: number } | undefined
  const own = Array.isArray(doc.layouts) ? (doc.layouts as Slide[]) : []
  const all = [...builtinLayouts(size), ...own]
  const key = LAYOUT_ALIASES[name] ?? name
  return all.find((l) => l.id === key) ?? all.find((l) => l.id === `layout-${key}`) ?? all.find((l) => l.name?.toLowerCase() === name.toLowerCase())
}

/** The names an agent says for a built-in, beside the ids themselves. */
export const LAYOUT_ALIASES: Record<string, string> = {
  'title-body': 'layout-title-content',
  'two-column': 'layout-two-col',
  'cards': 'layout-three-cards',
  'statistics': 'layout-stats',
  'big-stat': 'layout-big-number',
  'roadmap': 'layout-timeline',
  'chart': 'layout-chart-figures',
}

const hasFrame = (el: Obj) => ['x', 'y', 'w', 'h'].every((k) => typeof el[k] === 'number')

/** The prefix of every placement note, so a reader of the load report (and
 *  the findings built on it) can tell "where your content went" from a drop. */
export const LAYOUT_NOTE = 'layout: '

/**
 * Lay a compact slide's elements onto a layout. `els` are the expanded
 * elements (full defaults, md converted); `raw` the author's originals, to
 * know which carried a frame. Returns the slide's element list.
 *
 * The NAME decides the slot. Each slot's first donor is given the slot's own
 * id, so applyLayout matches it by id and never by position (by position,
 * `right` written before `left` swapped the columns, and an unknown role
 * routed to the body slot pushed the left column's text into the right one
 * and lost the right column's). The slot's further donors stack under it;
 * an unknown role stacks AFTER the slot's named content. Invariant: every
 * element that carried content comes out exactly once — what cannot sit in a
 * slot keeps its own (default) frame, with a note.
 */
function layOut(layout: Slide, els: Obj[], raw: Obj[], slideId: string, si: number, stats: ExpandStats, palette: Palette): Obj[] {
  const roles = layoutRoles(layout)
  const have = Object.keys(roles).join(', ') || 'none'
  const extras: Obj[] = []
  const named = new Map<string, Obj[]>(), fallback = new Map<string, Obj[]>()
  const push = (m: Map<string, Obj[]>, slot: string, d: Obj) => m.set(slot, [...(m.get(slot) ?? []), d])
  const index = new Map<Obj, number>()
  const note = (d: Obj, reason: string) => stats.notes.push({ path: `/slides/${si}/elements/${index.get(d)}/role`, reason: LAYOUT_NOTE + reason })
  const aside = (d: Obj, reason: string) => { note(d, reason); extras.push(d) }
  els.forEach((el, i) => {
    const role = typeof el.role === 'string' ? el.role : ''
    if (!role || hasFrame(raw[i])) { extras.push(el); return }
    if (el.type === 'text' && !textHasContent(el as unknown as SlideElement)) return // nothing to place
    index.set(el, i)
    const slot = roles[role]
    if (slot) push(named, slot, el)
    else if (roles.body) { note(el, `no \`${role}\` slot in layout \`${layout.id}\` (its roles: ${have}); placed after the body slot's content`); push(fallback, roles.body, el) }
    else aside(el, `no \`${role}\` slot in layout \`${layout.id}\` (its roles: ${have}) and no body slot; placed at the default frame`)
  })
  const firsts: Obj[] = []
  const rests = new Map<string, Obj[]>()
  for (const slotEl of layout.elements) {
    const list = [...(named.get(slotEl.id) ?? []), ...(fallback.get(slotEl.id) ?? [])]
    const fit = list.filter((d) => slotTakes(slotEl, d as unknown as SlideElement))
    for (const d of list) if (!fit.includes(d)) aside(d, `a ${d.type} element cannot fill the \`${slotEl.role}\` slot of \`${layout.id}\`; placed at the default frame`)
    if (!fit.length) continue
    firsts.push({ ...fit[0], id: slotEl.id, role: slotEl.role })
    rests.set(slotEl.id, fit.slice(1))
  }
  const known = new Set(layout.elements.map((e) => e.id))
  const slideForApply = { id: slideId, elements: firsts as unknown as SlideElement[] } as unknown as Slide
  // every first donor carries its slot's id, so applyLayout takes each by id
  const out = applyLayout(slideForApply, layout, known) as unknown as Obj[]
  for (const [slot, rest] of rests) {
    if (!rest.length) continue
    const slotEl = out.find((e) => e.id === slot)
    if (!slotEl || slotEl.type !== 'text' || rest.some((d) => d.type !== 'text')) {
      for (const d of rest) aside(d, `the \`${slotEl?.role ?? slot}\` slot of \`${layout.id}\` holds one ${slotEl?.type ?? 'element'}; this one is placed at the default frame`)
      continue
    }
    // more than one body for a slot: stack them in it
    const htmls = [slotEl.html, ...rest.map((d) => d.html)]
    const n = htmls.length
    const frame = { x: slotEl.x as number, y: slotEl.y as number, w: slotEl.w as number, h: slotEl.h as number }
    const share = Math.floor((frame.h - STACK_GAP * (n - 1)) / n)
    const ids: string[] = []
    htmls.forEach((html, k) => {
      const id = k === 0 ? slot : `${slot}-${k + 1}`
      const copy: Obj = { ...slotEl, id, y: frame.y + k * (share + STACK_GAP), h: Math.max(1, share), html }
      if (k === 0) Object.assign(slotEl, copy)
      else out.splice(out.indexOf(slotEl) + k, 0, copy)
      ids.push(id)
      stats.autoHeight.push({ slide: slideId, id })
    })
    stats.stacks.push({ slide: slideId, ids, slot: frame })
  }
  let laid = out
  if (out.some(isFrameEl)) {
    // a frame layout: an item whose slots all stayed empty goes, and the frame reflows, leaving no hole
    const filled = new Set([...firsts.map((f) => f.id as string), ...stats.stacks.filter((st) => st.slide === slideId).flatMap((st) => st.ids)])
    const byId = new Map(out.map((e) => [e.id, e]))
    const subtree = (e: Obj): Obj[] => [e, ...out.filter((k) => k.parentId === e.id).flatMap(subtree)]
    const drop = new Set<Obj>()
    for (const e of out) {
      if (!isFrameEl(byId.get(e.parentId) ?? {})) continue
      const t = subtree(e)
      const slots = t.filter((x) => typeof x.role === 'string')
      if (slots.length && !slots.some((x) => filled.has(x.id as string))) t.forEach((x) => drop.add(x))
    }
    laid = out.filter((e) => !drop.has(e))
    layoutSlide({ elements: laid } as unknown as Slide)
  }
  // the layout's own palette refs, resolved against this deck now rather than at open
  for (const e of laid) resolveOwnRefs(e, palette)
  stats.laidOut++
  return [...laid, ...extras]
}

const isFrameEl = (e: Obj) => e.type === 'shape' && isObj(e.layout)

/** Write the literal of each top-level palette ref on `holder` from `palette`. */
function resolveOwnRefs(holder: Obj, palette: Palette): void {
  for (const [k, tok] of Object.entries(isObj(holder.themeRefs) ? holder.themeRefs : {})) {
    if (k.includes('.') || typeof tok !== 'string' || typeof holder[k] !== 'string') continue
    const lit = resolveRef(tok, palette)
    if (lit !== null) holder[k] = keepAlpha(holder[k], lit)
  }
}

// --- round four: the deck's own names ------------------------------------------

/** Element properties a palette slot may name: it writes a colour. */
const SLOT_KEYS = new Set(['fill', 'stroke', 'color'])
/** A value that is TRYING to name a slot (`accent9`, `Accent 1`, `primary -20%`):
 *  any bare word is a CSS colour to the gate, so only these read as names. */
const SLOT_LIKE = /^\s*(?:accent|bg|tx|hlink|folhlink)[A-Za-z0-9 ]*(?:[+-]\s*\d{1,3}\s*%)?\s*$/i
const SHIFTED = /^\s*[A-Za-z][A-Za-z0-9]*\s*[+-]\s*\d{1,3}\s*%\s*$/
const nameList = (names: readonly string[]): string =>
  names.length ? names.slice(0, 12).map((n) => `\`${n}\``).join(', ') + (names.length > 12 ? ` … (${names.length} in all)` : '') : 'none'

/**
 * A name written as `holder[key]`, resolved in place: the literal goes in,
 * the ref goes into `themeRefs` (which the caller has made the holder's own).
 * true = bound; false = a name that does not resolve (reported, the caller
 * restores the default); null = a plain literal, left to the gate.
 */
function bindName(holder: Obj, key: string, doc: BentoDoc, path: string, stats: ExpandStats): boolean | null {
  const v = holder[key]
  if (typeof v !== 'string') return null
  const slide = Array.isArray(holder.elements)
  const note = (reason: string) => { stats.notes.push({ path, reason }); return false }
  if (v.trim().startsWith('$')) {
    if (!(slide ? SLIDE_TOKEN_KEYS : TOKEN_KEYS).has(key)) return null
    const name = tokenName(v.trim())
    const set = doc.theme.tokens?.set ?? {}
    if (!name || tokenValue(doc, name) === undefined) return note(`unknown token \`${v.trim()}\`; tokens in this deck: ${nameList(Object.keys(set).map((k) => `$${k}`))}`)
    if (!bindToken(doc, holder as never, key, name)) return note(`token \`$${name}\` (${set[name].type ?? 'color'}) cannot set \`${key}\``)
    return true
  }
  if (!(slide ? key === 'background' : SLOT_KEYS.has(key))) return null
  const ref = parseThemeRef(v)
  if (!ref) return SLOT_LIKE.test(v) || SHIFTED.test(v) ? note(`unknown palette slot \`${v.trim()}\`; slots: ${nameList(PALETTE_SLOTS)}, optionally with a shift like \`accent1 -20%\``) : null
  const token = formatThemeRef({ slot: ref.slot, shift: ref.shift })
  const literal = resolveRef(token, paletteOf(doc))
  if (literal === null) return note(`palette slot \`${ref.slot}\` is not set in this deck`)
  holder[key] = literal
  ;(holder.themeRefs as Obj)[key] = token
  return true
}

/**
 * Resolve every name on one expanded holder (an element or a slide) and fill
 * its bound defaults. `given` is what the author wrote; `out` the expanded
 * holder; `plain` its unbound defaults. Mutates `out`.
 */
function bindNames(given: Obj, out: Obj, plain: Obj, bound: Bound, doc: BentoDoc, base: string, stats: ExpandStats): void {
  out.themeRefs = { ...(isObj(given.themeRefs) ? given.themeRefs : {}) }
  const refs = out.themeRefs as Obj
  // a ref on a property the author left out names that property's value
  const named = Object.keys(given).filter((k) => k !== 'themeRefs')
  for (const [k, r] of Object.entries(refs)) if (!k.includes('.') && !(k in given) && typeof r === 'string') { out[k] = r; named.push(k) }
  const bindings = new Set<string>()
  for (const k of named) {
    const r = bindName(out, k, doc, `${base}/${k}`, stats)
    if (r === true) { bindings.add(k); continue }
    if (r === null) continue
    delete out[k]
    delete refs[k]
    if (k in plain) out[k] = plain[k]
  }
  for (const [k, [v, ref]] of Object.entries(bound)) {
    if (k in out) continue
    out[k] = v
    refs[k] = ref
    stats.expanded++
  }
  // a $token ref beside a literal it disagrees with is dropped on open
  // (tokens.ts syncTokenRefs): say so now, while the author can fix it
  for (const [k, r] of Object.entries(refs)) {
    const name = typeof r === 'string' ? tokenName(r) : null
    if (name && !bindings.has(k) && !tokenAgrees(doc, out as never, k, name)) {
      stats.notes.push({ path: `${base}/themeRefs/${k}`, reason: `\`${k}\` differs from token \`${r}\`, so this binding is dropped on load; write \`"${k}": "${r}"\` to bind it` })
    }
  }
  if (!Object.keys(refs).length) delete out.themeRefs
}

/** Keys a `use` override cannot set: they are the copy's identity. */
const USE_OWN = new Set(['id', 'type', 'groupId', 'component', 'parentId'])

/** A component copy for `{ use }`, the way components.ts instanceOf makes
 *  one — ids minted deterministically from the use's id (or its position). */
function useCopies(comp: ComponentInfo, raw: Obj, slideId: string, i: number, path: string, doc: BentoDoc, stats: ExpandStats): Obj[] {
  const main = comp.main as unknown as Obj[]
  const left = Math.min(...main.map((m) => m.x as number)), top = Math.min(...main.map((m) => m.y as number))
  const dx = typeof raw.x === 'number' ? raw.x - left : 0
  const dy = typeof raw.y === 'number' ? raw.y - top : 0
  const gid = typeof raw.id === 'string' && raw.id ? raw.id : `${slideId}-use-${i}`
  const sig = mainSig(comp.main)
  const key = (m: Obj) => String((m.component as Obj).key)
  const ids = new Map(main.map((m) => [m.id, `${gid}-${key(m)}`]))
  const copies = main.map((m) => {
    const el = JSON.parse(JSON.stringify(m)) as Obj
    el.id = ids.get(m.id)
    if (typeof el.parentId === 'string' && ids.has(el.parentId)) el.parentId = ids.get(el.parentId)
    else { delete el.parentId; delete el.sizing }
    el.groupId = gid
    el.x = (m.x as number) + dx
    el.y = (m.y as number) + dy
    delete el.morphId
    el.component = { id: comp.id, key: key(m), off: [dx, dy], sig }
    return el
  })
  for (const [k, props] of Object.entries(isObj(raw.over) ? raw.over : {})) {
    const j = main.findIndex((m) => key(m) === k || m.id === k || m.name === k)
    if (j < 0 || !isObj(props)) {
      stats.notes.push({ path: `${path}/over/${k}`, reason: `no member \`${k}\` in component \`${comp.id}\`; members: ${nameList(main.map((m) => String(m.name ?? key(m))))}` })
      continue
    }
    const el = copies[j]
    const over = new Set<string>()
    el.themeRefs = { ...(isObj(el.themeRefs) ? el.themeRefs : {}) }
    for (const [p, v] of Object.entries(props)) {
      if (p === 'md' && el.type === 'text' && typeof v === 'string') {
        if (typeof props.html !== 'string') { el.html = markdownToHtml(v); over.add('html') }
        continue
      }
      if (USE_OWN.has(p)) { stats.notes.push({ path: `${path}/over/${k}/${p}`, reason: `\`${p}\` belongs to the copy itself and cannot be overridden` }); continue }
      el[p] = v
      const r = bindName(el, p, doc, `${path}/over/${k}/${p}`, stats)
      if (r === false) { el[p] = JSON.parse(JSON.stringify(main[j][p] ?? null)); if (main[j][p] === undefined) delete el[p]; continue }
      over.add(p)
      if (r === true) over.add('themeRefs')
    }
    if (!Object.keys(el.themeRefs as Obj).length) delete el.themeRefs
    if (over.size) (el.component as Obj).over = [...over].sort()
  }
  return copies
}

/**
 * Fill every omitted field, flatten nested element arrays, mint missing ids.
 * Pure; returns a new object. A document without the flag is returned as is
 * (so callers can pass everything through). Slides without an id get
 * `s${n}` (1-based); elements without one get `${slideId}-${type}-${index}`.
 */
export function expandDoc(input: unknown): BentoDoc {
  return expandDocWithStats(input).doc
}

/** One line of the text at its font size — the provisional `h` for a text
 *  element that asked to be fitted (compactload.ts replaces it). */
export const provisionalHeight = (fontSize: number, lineHeight: number): number =>
  Math.ceil(fontSize * lineHeight)

/** expandDoc, and what it did. */
export function expandDocWithStats(input: unknown): { doc: BentoDoc; stats: ExpandStats } {
  const stats: ExpandStats = { expanded: 0, minted: 0, fromMarkdown: 0, autoHeight: [], laidOut: 0, notes: [], stacks: [] }
  if (!isCompact(input)) return { doc: input as BentoDoc, stats }
  const src = input as Obj
  const dd = docDefaults()
  const doc: Obj = { ...dd, ...src }
  delete doc[COMPACT_FLAG]
  // The editor dereferences these unconditionally on first render — render.ts
  // reads doc.size.width/height for every thumbnail (rebuildSidebar) and
  // doc.theme.fontFamily for every text box; the About dialog reads
  // doc.title — and parseDoc only checks format and a non-empty slides array,
  // so a document without `size` passes it and throws in the sidebar. A
  // missing one is the default; so is one of the wrong shape (`size: null`,
  // `title: 3`): an author who wrote that meant "I don't care", not "break".
  for (const k of Object.keys(dd)) {
    if (!(k in src) || !usableDocField(k, src[k], dd)) { doc[k] = dd[k]; stats.expanded++ }
  }
  doc.theme = { ...(dd.theme as Obj), ...(isObj(src.theme) ? src.theme : {}) }
  for (const k of Object.keys(dd.theme as Obj)) if (typeof (doc.theme as Obj)[k] !== 'string') { (doc.theme as Obj)[k] = (dd.theme as Obj)[k]; stats.expanded++ }
  const slidesIn = Array.isArray(src.slides) ? (src.slides as unknown[]) : []
  const built: Obj[] = [] // slides expanded so far: what `like` may name
  const uses: Array<{ marker: Obj; raw: Obj; slide: Obj; si: number; i: number }> = []
  const bdoc = doc as unknown as BentoDoc
  doc.slides = slidesIn.map((raw, si) => {
    const s0 = isObj(raw) ? raw : {}
    const sd = slideDefaults()
    // a layout supplies the slide's background/transition unless the author set them
    const layout = typeof s0.layout === 'string' ? findLayout(s0.layout, doc) : undefined
    if (typeof s0.layout === 'string' && !layout) stats.notes.push({ path: `/slides/${si}/layout`, reason: `unknown layout \`${s0.layout}\`; elements placed as given` })
    // …and `like` the named earlier slide's, over the layout's
    const like = typeof s0.like === 'string' ? built.find((b) => b.id === s0.like) : undefined
    if (typeof s0.like === 'string' && !like) stats.notes.push({ path: `/slides/${si}/like`, reason: `no slide \`${s0.like}\` before this one; slides before it: ${nameList(built.map((b) => String(b.id)))}` })
    // the slide-level bindings of whatever supplied the background (like, else the layout)
    const from = (like ?? layout) as Obj | undefined
    const inheritedRefs: Obj = { ...(from && isObj(from.themeRefs) ? from.themeRefs : {}) }
    if ('background' in s0) delete inheritedRefs.background
    const given: Obj = { ...s0 }
    if (Object.keys(inheritedRefs).length) given.themeRefs = { ...inheritedRefs, ...(isObj(s0.themeRefs) ? s0.themeRefs : {}) }
    const slide: Obj = {
      ...sd,
      ...(layout ? { background: layout.background, transition: layout.transition } : {}),
      ...(like ? { background: like.background, transition: like.transition } : {}),
      ...given,
    }
    delete slide.layout
    delete slide.like
    stats.expanded += Object.keys(sd).filter((k) => !(k in s0)).length
    // names on the slide (a background slot or token), else bg1 when nothing set it
    const inherited: Obj = like ? { background: like.background } : layout ? { background: layout.background } : {}
    bindNames(given, slide, inherited, layout || like ? {} : slideBound(doc), bdoc, `/slides/${si}`, stats)
    if (typeof slide.id !== 'string' || !slide.id) slide.id = `s${si + 1}`
    const flat: Obj[] = []
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (isObj(v)) flat.push(v) }
    walk(s0.elements)
    slide.elements = flat.map((el0, i) => {
      // a component copy: resolved once every slide is expanded (its main may come later)
      if (typeof el0.use === 'string' && el0.type === undefined) {
        const marker: Obj = {}
        uses.push({ marker, raw: el0, slide, si, i })
        return marker as unknown as SlideElement
      }
      // a role'd or text-bearing element with no `type` is a text box
      const el: Obj = (!el0.type && (typeof el0.role === 'string' || typeof el0.md === 'string' || typeof el0.html === 'string')) ? { type: 'text', ...el0 } : el0
      const defaults = elementDefaults(el, slide, doc) ?? {}
      const out: Obj = { ...defaults, ...el }
      stats.expanded += Object.keys(defaults).filter((k) => !(k in el)).length + (el === el0 ? 0 : 1)
      bindNames(el, out, defaults, elementBound(el, doc), bdoc, `/slides/${si}/elements/${i}`, stats)
      if (typeof out.id !== 'string' || !out.id) { out.id = mintId(slide, el, i); stats.minted++ }
      if (el.type === 'text') {
        // md → html by the editor's own paste conversion; html wins when both
        if (typeof el.md === 'string') {
          if (typeof el.html !== 'string') { out.html = markdownToHtml(el.md); stats.fromMarkdown++ }
          delete out.md
        }
        // h omitted or "auto": provisional one line; the browser fits it
        if (el.h === undefined || el.h === 'auto') {
          out.h = provisionalHeight(Number(out.fontSize) || 24, Number(out.lineHeight) || 1.2)
          stats.autoHeight.push({ slide: slide.id as string, id: out.id as string })
        }
      }
      return out as unknown as SlideElement
    })
    if (layout) {
      const before = new Set(stats.autoHeight.filter((a) => a.slide === slide.id).map((a) => a.id))
      const laid = layOut(layout, slide.elements as unknown as Obj[], flat, slide.id as string, si, stats, paletteOf(bdoc))
      // donors that became slot content no longer exist under their own id:
      // their provisional heights are the slot's, not to be measured
      const ids = new Set(laid.map((e) => e.id as string))
      stats.autoHeight = stats.autoHeight.filter((a) => a.slide !== slide.id || !before.has(a.id) || ids.has(a.id))
      slide.elements = laid as unknown as SlideElement[]
    }
    if (like) {
      // recurring furniture: the source's elements whose ids recur on another
      // slide (a logo, a footer), under this slide's own; never a role'd slot,
      // which holds that slide's content
      const elsewhere = new Set(built.filter((b) => b !== like).flatMap((b) => (b.elements as Obj[]).map((e) => e.id)).filter((id) => typeof id === 'string'))
      const have = new Set((slide.elements as unknown as Obj[]).map((e) => e.id))
      const furniture = (like.elements as Obj[]).filter((e) => typeof e.id === 'string' && elsewhere.has(e.id) && !e.role && !have.has(e.id))
      slide.elements = [...JSON.parse(JSON.stringify(furniture)), ...(slide.elements as unknown as Obj[])] as unknown as SlideElement[]
    }
    built.push(slide)
    return slide as unknown as Slide
  })
  if (uses.length) {
    const comps = components(bdoc)
    for (const u of uses) {
      const els = u.slide.elements as Obj[]
      const at = els.indexOf(u.marker)
      const name = u.raw.use as string
      const path = `/slides/${u.si}/elements/${u.i}`
      const comp = comps.find((c) => c.id === name) ?? comps.find((c) => !!c.name && c.name.toLowerCase() === name.toLowerCase())
      if (!comp) {
        stats.notes.push({ path: `${path}/use`, reason: `unknown component \`${name}\`; components in this deck: ${nameList(comps.map((c) => (c.name ? `${c.id} (${c.name})` : c.id)))}` })
        els.splice(at, 1)
        continue
      }
      els.splice(at, 1, ...useCopies(comp, u.raw, u.slide.id as string, u.i, path, bdoc, stats))
    }
  }
  return { doc: doc as unknown as BentoDoc, stats }
}

/** The font stack expansion assumes for text — exported so the rig can state
 *  why a full document without `fontFamily` is NOT auto-expanded. */
export const EXPANDED_TEXT_FONT = FONT_STACK

/** The compact JSON of a document, for "Copy compact JSON" and window.bento.compact(). */
export const compactJson = (doc: BentoDoc): string => JSON.stringify(compactDoc(doc))
