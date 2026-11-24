// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Document validation — `window.bento.validate()`.
//
// WHY THIS EXISTS. Almost everything that goes wrong in a generated deck fails
// SILENTLY. A typo'd property is ignored, so the styling just does not apply. A
// dash-march loop on a solid stroke animates nothing. An entrance on a morph
// arrival never runs. Text overflows its box and the JSON looks perfect. An
// agent authoring a deck has no way to see any of it without rendering the
// result and looking at every slide — which is exactly what nobody does.
//
// So this reports, in one structured pass, the things the runtime would
// otherwise swallow. It only READS: it never mutates the document, and a
// finding is advice, not a refusal. `parseDoc` remains the thing that decides
// whether a document is loadable at all.
//
// Text overflow needs real layout, so it goes through measure.ts — the same
// path `window.bento.measure()` uses, which renders off-screen with the SAME
// renderer the editor and present mode use. One path means the validator and
// the measuring tool cannot disagree about whether a box fits its text. Without
// a DOM (node tooling) the measured checks are skipped and `measured` reports
// false, rather than guessing.
//
// VALUES. An element of a type the format does not have (`unknown-type`), a
// value its property does not take (`invalid-value`: a string where a number
// belongs, a word that is not a colour, an enum value that is not one of its
// words) and a `parentId` naming no frame (`dangling-parent`) are judged by the
// paste gate's own per-property checks (untrusted.ts `checkElementProp`), so
// the validator and the gate cannot disagree about what a valid value is.
// Colour syntax is the browser's to decide (`CSS.supports`); node tooling does
// not guess at it. An element whose type or geometry is invalid skips the
// geometry and measured checks, which would only report nonsense derived from it.
//
// WHAT PEOPLE SEE. visualchecks.ts adds the defects a person notices at a
// glance: `low-contrast` (text against what is behind it, WCAG thresholds),
// `text-overlap` (two texts drawn over each other), `outside-frame` (a frame
// child that, laid out, runs past its frame) and `chart-label-clipped` (chart
// text cut off at the chart's edge). Advice only — warnings and infos with the
// measured number. With a DOM, text is judged on its glyphs and the chart is
// rendered; without one, whole boxes are used and the chart check is skipped.

import type { BentoDoc, CodeElement, Slide, SlideElement, TableElement, TextElement } from './model.ts'
import { isWebUrl } from './model.ts'
import { MODEL_KEYS } from './modelkeys.generated.ts'
import { isRemoteUrl } from '../../kernel/src/net.ts'
import { measureElements, measureTables } from './measure.ts'
import { fieldContext, type FieldContext } from './render.ts'
import { BUILTIN_FONTS } from './fonts.ts'
import { eachRef, keepAlpha, paletteOf, parseThemeRef, resolveRef, _readPath } from './palette.ts'
import { tokenName } from './tokens.ts'
import { checkElementProp, ELEMENT_CHECKS, type JsonSchema } from './untrusted.ts'
import { isFrame } from './layout.ts'
import { REQUIRED_ELEMENT_KEYS } from './model.ts'
import { visualChecks } from './visualchecks.ts'

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  /** stable machine-readable code, e.g. 'text-overflow' */
  code: string
  severity: Severity
  /** one line, written to be actionable on its own */
  message: string
  /** slide id, when the finding belongs to a slide */
  slide?: string
  /** element id, when it belongs to an element */
  element?: string
  /** property path within the element/document, e.g. 'option.series[0].label' */
  path?: string
}

export interface ValidateResult {
  ok: boolean
  /** false when there was no DOM, so overflow was not checked */
  measured: boolean
  counts: Record<Severity, number>
  findings: Finding[]
}

export interface ValidateOpts {
  /** measure text overflow (needs a DOM). Default true when one exists. */
  measure?: boolean
  /** side margin in px on a 1280-wide canvas; scaled to the deck. 0 disables. */
  margin?: number
}

/**
 * Chart option keys charts-lite implements (kernel/src/charts.ts). Anything
 * else in an `option` is ignored at render time with no warning — the engine
 * reads the ECharts option SHAPE, it is not ECharts.
 *
 * Kept deliberately close to the renderer: `label` is listed for pie only,
 * because `renderPie` is the sole reader of it and a `label` on a bar or line
 * series genuinely does nothing.
 */
const CHART_KEYS = {
  top: ['color', 'series', 'xAxis', 'yAxis', 'legend', 'grid', 'tooltip', 'textStyle', 'dataZoom'],
  series: ['type', 'name', 'data', 'yAxisIndex', 'itemStyle'],
  seriesByType: {
    bar: ['barWidth'],
    line: ['smooth', 'symbol', 'symbolSize', 'lineStyle', 'areaStyle'],
    scatter: ['symbol', 'symbolSize'],
    pie: ['radius', 'label'],
  } as Record<string, string[]>,
  axis: ['type', 'data', 'min', 'max', 'axisLabel', 'axisLine', 'splitLine', 'name'],
  legend: ['show', 'top', 'bottom', 'textStyle', 'itemWidth', 'itemHeight', 'itemGap', 'data'],
}

/**
 * Families a viewer's machine can be expected to resolve without the document
 * carrying the bytes — generics, the CSS system keywords, and the faces that
 * ship with mainstream desktop operating systems.
 *
 * Anything else named FIRST in a stack, and not in `doc.fonts`, is a face the
 * document is asking for and does not have. On the author's machine that
 * usually looks fine, because the author is exactly the person who has the
 * typeface installed; everyone else silently gets the next entry in the stack.
 * Two gallery templates shipped that way for months.
 */
const SYSTEM_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica',
  'helvetica neue', 'arial', 'arial black', 'verdana', 'tahoma', 'trebuchet ms',
  'georgia', 'times', 'times new roman', 'palatino', 'garamond', 'book antiqua',
  'courier', 'courier new', 'menlo', 'monaco', 'consolas', 'sf mono',
  'liberation mono', 'lucida console', 'impact', 'comic sans ms', 'cambria',
  'calibri', 'candara', 'optima', 'futura', 'gill sans', 'avenir', 'avenir next',
  'noto sans', 'noto serif', 'dejavu sans', 'pt sans', 'pt serif', 'emoji',
])

/** The first family in a CSS font stack, unquoted and lowercased. */
function firstFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? ''
  return first.replace(/^['"]|['"]$/g, '').trim().toLowerCase()
}

const morphKey = (el: SlideElement) => el.morphId || el.id

/**
 * Small chrome — page numerals, running heads, corner labels. These live in
 * the margin ON PURPOSE, so flagging them for it is pure noise; the margin
 * guideline is about the body content that has to look aligned.
 */
const isFurniture = (el: SlideElement, doc: BentoDoc) =>
  el.w * el.h < doc.size.width * doc.size.height * 0.03

/** Slides reached by a morph transition, forward or backward out of one. */
function morphArrivals(doc: BentoDoc): Map<string, Slide | undefined> {
  const out = new Map<string, Slide | undefined>()
  doc.slides.forEach((s, i) => {
    if (s.transition === 'morph' && i > 0) out.set(s.id, doc.slides[i - 1])
  })
  return out
}

/** Edit distance (insert, delete, substitute), bailing out above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[b.length]
}

/**
 * The one candidate a typo most likely meant: within edit distance 2 (and
 * shorter than the word itself, so `z` never "means" `x`), and strictly closer
 * than any other — a tie suggests nothing rather than the wrong key.
 */
export function nearestName(word: string, candidates: readonly string[]): string | undefined {
  const lower = word.toLowerCase()
  let best: string | undefined
  let bestD = Math.min(2, word.length - 1) + 1
  let tie = false
  for (const c of candidates) {
    const d = editDistance(lower, c.toLowerCase(), 2)
    if (d < bestD) { best = c; bestD = d; tie = false }
    else if (d === bestD) tie = true
  }
  return tie ? undefined : best
}

const didYouMean = (word: string, candidates: readonly string[]) => {
  const near = nearestName(word, candidates)
  return near ? ` Perhaps a typo: did you mean "${near}"?` : ''
}

/** Element geometry: a bad value here makes every check derived from the box nonsense. */
const GEOMETRY = new Set(['x', 'y', 'w', 'h'])

/** What a gate check accepts, in words, read off the schema the check carries. */
function expected(s: JsonSchema | undefined): string {
  if (!s) return 'a value the format accepts'
  if (Array.isArray(s.anyOf)) return (s.anyOf as JsonSchema[]).map(expected).join(', or ')
  if (Array.isArray(s.enum)) return `one of ${(s.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')}`
  if ('const' in s) return JSON.stringify(s.const)
  if (typeof s.description === 'string' && s.type !== 'object') return `a ${s.description.split(';')[0]}`
  switch (s.type) {
    case 'number': {
      const min = s.minimum as number, max = s.maximum as number
      return max - min < 1e5 ? `a finite number from ${min} to ${max}` : 'a finite number'
    }
    case 'boolean': return 'true or false'
    case 'string': return 'a string'
    case 'array': return s.minItems !== undefined && s.minItems === s.maxItems ? `a list of ${s.minItems}` : 'a list'
    case 'object': return Array.isArray(s.required) && s.required.length
      ? `an object with ${(s.required as string[]).join(', ')}` : 'an object'
  }
  return 'a value the format accepts'
}

/** A value, named for a message. */
function described(v: unknown): string {
  if (typeof v === 'string') return `the string ${JSON.stringify(v.length > 40 ? v.slice(0, 40) + '…' : v)}`
  if (Array.isArray(v)) return `a list of ${v.length}`
  if (v === null) return 'null'
  if (typeof v === 'object') return 'an object'
  return String(v)
}

/** The schema branch of an `anyOf` this value is shaped for. */
function branchFor(s: JsonSchema, v: unknown): JsonSchema | undefined {
  const kind = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v
  return (s.anyOf as JsonSchema[]).find((b) => b.type === kind)
}

/**
 * Does the browser parse this as a colour? Asked of the browser's own CSS
 * parser (`CSS.supports`), the thing that decides at draw time — so this is
 * not a second colour parser, and node tooling (no CSS object) does not guess:
 * it returns undefined and the colour is not judged, as overflow is not
 * measured without a DOM.
 */
function browserColour(v: string, paint: boolean): boolean | undefined {
  const css = (globalThis as { CSS?: { supports?: (p: string, v: string) => boolean } }).CSS
  if (typeof css?.supports !== 'function') return undefined
  const s = v.trim()
  // a paint may name a local paint server or none; the gate already judged those
  if (paint && (s === 'none' || /^url\(/i.test(s))) return true
  return css.supports('color', s)
}

interface BadValue { path: string; severity: Severity; message: string }

/**
 * Judge one element property by the paste gate's own check (untrusted.ts
 * `checkElementProp`), read-only, so the validator and the gate cannot
 * disagree about what a valid value is. Reported:
 *  - a value the gate DROPS (the wrong type, out of range, not one of an
 *    enum's words), at the deepest path the gate's output shows it lost;
 *  - a number written as a string, which the gate silently coerces ("10" →
 *    10) but a file opened from disk keeps as a string;
 *  - a colour the browser cannot parse — the gate only keeps CSS out of a
 *    colour, it does not know colour names, so this one asks the browser.
 * Walks the input beside the gate's output and the schema the check carries.
 */
function badValues(type: string, key: string, value: unknown): BadValue[] {
  const out: BadValue[] = []
  const required = REQUIRED_ELEMENT_KEYS[type] ?? []
  const res = checkElementProp(type, key, value)
  const walk = (input: unknown, kept: unknown, schema: JsonSchema | undefined, path: string, top: boolean) => {
    if (!schema) return
    if (kept === undefined) { out.push(drop(input, schema, path, top)); return }
    if (Array.isArray(schema.anyOf)) {
      const branch = branchFor(schema, input)
      if (!branch) return
      schema = branch
    }
    if (schema.type === 'object' && schema.properties && input && typeof input === 'object' && !Array.isArray(input)) {
      const props = schema.properties as Record<string, JsonSchema>
      for (const k of Object.keys(input)) {
        if (Object.hasOwn(props, k)) walk((input as any)[k], (kept as any)?.[k], props[k], `${path}.${k}`, false)
      }
      return
    }
    if (schema.type === 'array' && schema.items && Array.isArray(input) && Array.isArray(kept)) {
      input.forEach((v, i) => walk(v, kept[i], schema!.items as JsonSchema, `${path}[${i}]`, false))
      return
    }
    if (schema.type === 'number' && typeof input === 'string') {
      out.push({ path, severity: top && GEOMETRY.has(key) ? 'error' : 'warning',
        message: `"${path}" must be a finite number, got ${described(input)}. A file keeps it as written, so arithmetic on it concatenates ("10" + 100 = "10100"); a paste or loadDoc() converts it. Write the number without quotes.` })
      return
    }
    const desc = typeof schema.description === 'string' ? schema.description : ''
    if (typeof input === 'string' && desc.startsWith('CSS colour')) {
      if (browserColour(input, desc.includes('url(')) === false) {
        out.push({ path, severity: 'warning',
          message: `"${path}" is ${described(input)}, which is not a colour the browser can parse — it is ignored where it is drawn, so the element paints a default instead (an svg fill turns black, text takes the inherited colour). Use a hex, rgb(), hsl() or named colour.` })
      }
    }
  }
  const drop = (input: unknown, schema: JsonSchema, path: string, top: boolean): BadValue => ({
    path,
    severity: top && (GEOMETRY.has(key) || required.includes(key)) ? 'error' : 'warning',
    message: `"${path}" must be ${expected(schema)}, got ${described(input)}. A paste or loadDoc() drops it${top && required.includes(key) ? ' — and with it the whole element, which cannot render without it' : ''}; a file keeps it, and the renderer cannot use it.`,
  })
  walk(value, res.ok ? res.value : undefined, ELEMENT_CHECKS[key]?.schema, key, true)
  return out
}

/** The document with the given elements left out — for the measured checks. */
const withoutElements = (doc: BentoDoc, skip: Set<SlideElement>): BentoDoc => !skip.size ? doc : {
  ...doc, slides: doc.slides.map((s) => ({ ...s, elements: s.elements.filter((e) => !skip.has(e)) })),
}

export function validateDoc(doc: BentoDoc, opts: ValidateOpts = {}): ValidateResult {
  const findings: Finding[] = []
  const add = (f: Finding) => findings.push(f)

  const hasDom = typeof document !== 'undefined'
  const measure = (opts.measure ?? true) && hasDom
  const marginBase = opts.margin ?? 96
  const margin = marginBase * (doc.size.width / 1280)
  const slideIds = new Set(doc.slides.map((s) => s.id))
  const assets = doc.assets ?? {}
  const arrivals = morphArrivals(doc)
  // Every slide any element can jump to. A hidden slide is reachable ONLY this
  // way, so one with no inbound link is in the file and in nobody's path.
  const linkTargets = new Set<string>()
  for (const sl of doc.slides) for (const el of sl.elements) if (el.link) linkTargets.add(el.link)
  // elements whose type or geometry is invalid: the measured checks skip them
  const skipMeasure = new Set<SlideElement>()

  // ---- document level ------------------------------------------------------
  for (const k of Object.keys(doc)) {
    if (!(MODEL_KEYS.doc as readonly string[]).includes(k)) {
      add({ code: 'unknown-key', severity: 'warning', path: k,
        message: `Document key "${k}" is not part of the bento/slides format — it is ignored at render time.${didYouMean(k, MODEL_KEYS.doc)}` })
    }
  }
  for (const f of doc.fonts ?? []) {
    if (!f.asset || assets[f.asset]) continue
    // A `builtin:` key names a face the shell carries (fonts.ts BUILTIN_FONTS)
    // — a satisfied reference with no bytes in the file. Only an unknown
    // built-in name is broken.
    if (f.asset.startsWith('builtin:')) {
      if (!(f.asset in BUILTIN_FONTS)) {
        add({ code: 'missing-asset', severity: 'error', path: `fonts.${f.family}`,
          message: `Font "${f.family}" names built-in face "${f.asset}", which this app does not carry (known: ${Object.keys(BUILTIN_FONTS).join(', ')}) — the face will not load and text falls back silently.` })
      }
      continue
    }
    add({ code: 'missing-asset', severity: 'error', path: `fonts.${f.family}`,
      message: `Font "${f.family}" points at asset "${f.asset}", which is not in doc.assets — the face will not load and text falls back silently.` })
  }
  // A live-shared deck carries the keys to its own room — that is how opening a
  // copy joins a session with no account and nothing to configure. The file IS
  // the invitation, and that is deliberate.
  //
  // It is also invisible. Nothing on screen and nothing in the JSON's shape says
  // "this document opens a live room for whoever holds it", so anyone handing
  // the file to a chat, a ticket or an agent harness is transferring a
  // capability while believing they are sharing a document.
  //
  // Reported whenever the deck carries ANY sharing key. The room key alone is
  // a capability — it reads the room live (and writes to an unsigned room) —
  // so read-only copies, invite copies and presenter files are reported too,
  // each with what its keys grant. Info, not a warning: carrying these keys in
  // your own working file is correct. read() / Copy document JSON leave them out.
  const c = doc.collab as Record<string, unknown> | undefined
  const held = c ? (['key', 'writerPriv', 'ownerPriv', 'invite', 'audience'] as const).filter((k) => c[k]) : []
  if (c && held.length) {
    const roomName = typeof c.room === 'string' ? (c.room.split('/d/').pop() ?? '') : ''
    const unsigned = !!c.key && !roomName.startsWith('w')
    const grants: string[] = []
    if (c.ownerPriv) grants.push('the owner key (write, invite and remove members)')
    if (c.writerPriv) grants.push('a writer key (write)')
    if (c.invite) grants.push('an invite (join with its role)')
    if (c.audience) grants.push('the audience ticket store (admit audiences to a show)')
    if (c.key) grants.push(unsigned
      ? 'the room key of an unsigned room (read every edit, and write)'
      : c.role === 'audience'
        ? 'a show key (watch the live show)'
        : 'the room key (read every edit live, and what the relay has stored)')
    add({ code: 'collab-secrets-present', severity: 'info', path: 'collab',
      message: `This deck carries live-session keys (${held.join(', ')}): ${grants.join('; ')}. Anything that receives this file or its JSON holds the same access${c.role === 'reader' ? ' — a read-only copy still carries the room key' : ''}. Expected in your own working file; before handing the deck to a chat, a ticket or an agent, use window.bento.read() or Save → Copy document JSON, which leave the keys out.` })
  }

  const embedded = new Set((doc.fonts ?? []).map((f) => f.family.trim().toLowerCase()))
  const seenFallback = new Set<string>()
  const checkFamily = (stack: string | undefined, where: Omit<Finding, 'code' | 'severity' | 'message'>) => {
    if (!stack) return
    const fam = firstFamily(stack)
    if (!fam || embedded.has(fam) || SYSTEM_FAMILIES.has(fam)) return
    // one finding per family — a deck sets the same stack on 40 elements
    if (seenFallback.has(fam)) return
    seenFallback.add(fam)
    add({ ...where, code: 'font-not-embedded', severity: 'info',
      message: `"${stack.split(',')[0].trim()}" is not in doc.fonts, so it renders only for viewers who happen to have it installed — everyone else silently gets the next family in the stack. Embed the woff2 in doc.assets and declare it in doc.fonts.` })
  }
  checkFamily(doc.theme?.fontFamily, { path: 'theme.fontFamily' })
  checkFamily(doc.theme?.codeFontFamily, { path: 'theme.codeFontFamily' })
  checkFamily(doc.theme?.headingFamily, { path: 'theme.headingFamily' })

  // ---- brand palette references --------------------------------------------
  // A `themeRefs` entry says a colour came from a palette slot, so editing the
  // palette rewrites it. Both failures here are silent: a ref nobody can
  // resolve simply never updates, and a literal that disagrees with its ref is
  // about to be overwritten by the next palette edit — which looks like the
  // app changing a colour on its own.
  {
    const palette = paletteOf(doc)
    eachRef(doc, ({ slide, element, path, token }) => {
      const at = { slide: slide.id, ...(element ? { element: element.id } : {}) }
      const name = tokenName(token)
      if (name) {
        if (!(doc.theme.tokens?.set && Object.hasOwn(doc.theme.tokens.set, name))) add({ ...at, code: 'token-unknown', severity: 'warning', path: `themeRefs.${path}`,
          message: `There is no token "${name}" in theme.tokens, so this value will not follow it. Add the token, or drop the reference.` })
        return
      }
      const parsed = parseThemeRef(token)
      if (!parsed) {
        add({ ...at, code: 'theme-ref-malformed', severity: 'warning', path: `themeRefs.${path}`,
          message: `"${token}" is not a palette reference — expected a slot name, optionally with a shift like "accent1 -20%". The colour is left as it is and will not follow the palette.` })
        return
      }
      if (!palette[parsed.slot]) {
        add({ ...at, code: 'theme-ref-unknown-slot', severity: 'warning', path: `themeRefs.${path}`,
          message: `Palette slot "${parsed.slot}" is empty, so this colour will not follow the palette. Set it in the theme, or drop the reference.` })
        return
      }
      const have = _readPath(element ?? slide, path)
      // a reference names the hue; the colour keeps its own opacity (palette.ts keepAlpha)
      const base = resolveRef(token, palette)
      const want = base ? keepAlpha(have, base) : base
      if (typeof have !== 'string') {
        add({ ...at, code: 'theme-ref-dangling', severity: 'warning', path: `themeRefs.${path}`,
          message: `There is no colour at "${path}" for this reference to control — it does nothing. Remove it, or restore the property.` })
      } else if (want && have.toLowerCase() !== want.toLowerCase()) {
        add({ ...at, code: 'theme-ref-stale', severity: 'info', path,
          message: `This colour is ${have} but its reference "${token}" resolves to ${want}, so the next palette change will replace it. If ${have} was deliberate, clear the reference.` })
      }
    })
  }

  for (const slide of doc.slides) {
    const sid = slide.id
    const prev = arrivals.get(sid)
    const isMorphArrival = arrivals.has(sid)
    const partners = new Set((prev?.elements ?? []).map(morphKey))
    const seenIds = new Set<string>()
    const seenMorph = new Map<string, string>()
    const elsOnSlide = new Set(slide.elements.map((e) => e.id))
    const byId = new Map(slide.elements.map((e) => [e.id, e]))

    for (const k of Object.keys(slide)) {
      if (!(MODEL_KEYS.slide as readonly string[]).includes(k)) {
        add({ code: 'unknown-key', severity: 'warning', slide: sid, path: k,
          message: `Slide key "${k}" is not part of the format — it is ignored.${didYouMean(k, MODEL_KEYS.slide)}` })
      }
    }
    if (slide.hidden && !slide.stateOf && !linkTargets.has(sid)) {
      add({ code: 'unreachable-hidden-slide', severity: 'info', slide: sid, path: 'hidden',
        message: `Hidden, and nothing links to it — this slide cannot be reached at all while presenting. Give an element a link to it, or unhide it.` })
    }
    if (slide.stateOf && !slideIds.has(slide.stateOf)) {
      add({ code: 'broken-state-parent', severity: 'error', slide: sid, path: 'stateOf',
        message: `stateOf points at "${slide.stateOf}", which is not a slide in this deck — the state is unreachable.` })
    }

    for (const el of slide.elements) {
      const at = { slide: sid, element: el.id }

      // identity ---------------------------------------------------------
      if (seenIds.has(el.id)) {
        add({ ...at, code: 'duplicate-id', severity: 'error',
          message: `Two elements on this slide share the id "${el.id}" — selection, morph and comment anchors all key off it.` })
      }
      seenIds.add(el.id)
      const mk = morphKey(el)
      const clash = seenMorph.get(mk)
      if (clash && clash !== el.id) {
        add({ ...at, code: 'morph-key-collision', severity: 'error', path: 'morphId',
          message: `Morph key "${mk}" is used by both "${clash}" and "${el.id}" on this slide — morph pairs by that key, so one of them will not tween.` })
      }
      seenMorph.set(mk, el.id)

      // unknown type ---------------------------------------------------------
      // Nothing else about an element this version cannot draw is worth
      // reporting: its keys, geometry and references belong to a type the
      // format does not have, so every derived finding would be noise.
      const types = Object.keys(MODEL_KEYS.element)
      const known = (MODEL_KEYS.element as Record<string, readonly string[]>)[el.type]
      if (!known) {
        add({ ...at, code: 'unknown-type', severity: 'error', path: 'type',
          message: `${described(el.type)} is not an element type (${types.join(', ')}).${didYouMean(String(el.type), types)} An opened file keeps the element and saves it back untouched, but nothing is drawn for it; a paste or loadDoc() drops it.` })
        skipMeasure.add(el)
        continue
      }

      // unknown keys and invalid values --------------------------------------
      let badGeometry = false
      for (const k of Object.keys(el)) {
        if (!known.includes(k)) {
          add({ ...at, code: 'unknown-key', severity: 'warning', path: k,
            message: `"${k}" is not a property of a ${el.type} element — it is ignored, so whatever it was meant to do will not happen.${didYouMean(k, known)}` })
          continue
        }
        // palette and token references have their own findings below
        if (k === 'themeRefs') continue
        for (const bad of badValues(el.type, k, (el as unknown as Record<string, unknown>)[k])) {
          add({ ...at, code: 'invalid-value', ...bad })
          if (bad.path === k && GEOMETRY.has(k)) badGeometry = true
        }
      }
      if (el.fx) {
        for (const k of Object.keys(el.fx)) {
          if (!(MODEL_KEYS.fx as readonly string[]).includes(k)) {
            add({ ...at, code: 'unknown-key', severity: 'warning', path: `fx.${k}`,
              message: `"fx.${k}" is not a known effect property — it is ignored.${didYouMean(k, MODEL_KEYS.fx)}` })
          }
        }
      }

      // frame membership -----------------------------------------------------
      // layout.ts layoutSlide unlinks these silently on the next layout pass
      if (el.parentId !== undefined) {
        const parent = byId.get(el.parentId)
        const why = el.parentId === el.id ? 'names the element itself'
          : !parent ? `names "${el.parentId}", which is not an element on this slide`
          : !isFrame(parent) ? `names "${el.parentId}", which is not a frame (a rectangle with a layout)`
          : ''
        if (why) {
          add({ ...at, code: 'dangling-parent', severity: 'warning', path: 'parentId',
            message: `parentId ${why} — it will be treated as a free element; the layout pass removes the link (and its sizing).` })
        }
      }

      // geometry -----------------------------------------------------------
      // Bleeding a shape or photo off the canvas is a deliberate idiom, and a
      // full-bleed backdrop is SUPPOSED to ignore the margin — so geometry is
      // only a warning for the element types that carry words, where going
      // past an edge means the reader loses some. For everything else it is
      // recorded at 'info' and stays out of the way.
      // A box with a string or out-of-range coordinate has no geometry to
      // judge: report the value (above), not the nonsense derived from it.
      const carriesText = el.type === 'text' || el.type === 'table'
      const right = el.x + el.w
      const bottom = el.y + el.h
      const fullBleed = el.w >= doc.size.width * 0.9 || el.h >= doc.size.height * 0.9
      if (badGeometry) {
        skipMeasure.add(el)
      } else if (right > doc.size.width || bottom > doc.size.height || el.x < 0 || el.y < 0) {
        add({ ...at, code: 'out-of-canvas', severity: carriesText ? 'warning' : 'info',
          message: carriesText
            ? `Extends outside the ${doc.size.width}x${doc.size.height} canvas (x ${el.x}-${right}, y ${el.y}-${bottom}) — the text past the edge is cropped when presenting.`
            : `Extends outside the ${doc.size.width}x${doc.size.height} canvas (x ${el.x}-${right}, y ${el.y}-${bottom}) — fine as a deliberate bleed, cropped either way.` })
      // A few px inside the margin is an optical adjustment, not crowding —
      // large type is routinely nudged left to hang its side bearing. Only
      // flag content that misses the margin by an amount a reader would see.
      } else if (carriesText && !fullBleed && margin > 0 && !isFurniture(el, doc)
        && (el.x < margin * 0.9 || right > doc.size.width - margin * 0.9)) {
        add({ ...at, code: 'past-margin', severity: 'info',
          message: `Reaches past the ${Math.round(margin)}px side margin (x ${el.x}-${right}) — the deck's other content stops short of it.` })
      }

      // effects that will not run -------------------------------------------
      // Only a MORPHING element loses its entrance: it is already travelling
      // from its previous-slide frame, and an entrance tween would fight that.
      // An element with no partner on the previous slide runs its fx.enter
      // normally, so there is nothing to report.
      if (el.fx?.enter && isMorphArrival && partners.has(mk)) {
        add({ ...at, code: 'overridden-enter-fx', severity: 'warning', path: 'fx.enter',
          message: `This element morphs in from the previous slide, so it is already in motion and fx.enter is skipped. Give it a morph key that is new to this slide if you want it to enter instead.` })
      }
      if (el.fx?.enter && el.fx?.loop?.type === 'motion-path') {
        add({ ...at, code: 'entrance-on-motion-path', severity: 'warning', path: 'fx.enter',
          message: `An entrance tween and a motion-path loop fight over the same transform — the element can freeze off its path. Use one or the other.` })
      }
      if (el.fx?.countUp && isMorphArrival && partners.has(mk)) {
        add({ ...at, code: 'inert-countup', severity: 'info', path: 'fx.countUp',
          message: `This element morphs in from the previous slide already showing its number, so the count-up is skipped by design. Give it a morph key that is new to this slide if you want it to count.` })
      }
      if (el.fx?.loop?.type === 'dash-march') {
        const dashed = el.type === 'shape' && (el.strokeStyle === 'dashed' || el.strokeStyle === 'dotted')
        const stroked = el.type === 'shape' && !!el.stroke && el.stroke !== 'transparent' && (el.strokeWidth ?? 0) > 0
        if (!dashed || !stroked) {
          add({ ...at, code: 'dash-march-no-dash', severity: 'warning', path: 'fx.loop',
            message: `A dash-march loop animates strokeDashoffset, so it needs a visible stroke AND strokeStyle "dashed" or "dotted". As set, the tween runs and nothing moves.` })
        }
      }

      // references -----------------------------------------------------------
      // a web address is a link too (model.ts isWebUrl): it opens in a new tab
      if (el.link && !slideIds.has(el.link) && !isWebUrl(el.link)) {
        add({ ...at, code: 'broken-link', severity: 'error', path: 'link',
          message: `Links to slide "${el.link}", which does not exist — clicking it does nothing.` })
      }
      for (const [side, end] of [['from', (el as any).from], ['to', (el as any).to]] as const) {
        if (end?.el && !elsOnSlide.has(end.el)) {
          add({ ...at, code: 'dangling-connector', severity: 'warning', path: side,
            message: `Connector ${side} references element "${end.el}", which is not on this slide — that end is dropped and stops following.` })
        }
      }
      for (const key of ['src', 'asset', 'poster', 'view'] as const) {
        const ref = (el as any)[key]
        if (typeof ref === 'string' && ref.startsWith('asset:') && !assets[ref.slice(6)]) {
          add({ ...at, code: 'missing-asset', severity: 'error', path: key,
            message: `${key} references asset "${ref.slice(6)}", which is not in doc.assets — nothing renders.` })
        }
      }

      // embed -------------------------------------------------
      // The view is the tier that ALWAYS paints: offline, in thumbnails, in
      // print and in an upstream shell that has never heard of `app`. Without
      // it the element is a hole; pointing it at the network breaks the
      // offline guarantee the whole shape exists to keep.
      if (el.type === 'embed') {
        const view = typeof el.view === 'string' ? el.view.trim() : ''
        if (!view) {
          add({ ...at, code: 'embed-missing-view', severity: 'error', path: 'view',
            message: 'Embed has no view. It renders as an empty box offline, in thumbnails and in print. Set view to inline <svg> markup or an "asset:" key holding it.' })
        } else if (!view.startsWith('<') && !view.startsWith('asset:') && isRemoteUrl(view)) {
          // markup and asset refs are judged first: in a browser isRemoteUrl
          // resolves any bare string against the page, and "<svg…" would
          // come back as a relative http url
          add({ ...at, code: 'embed-remote-view', severity: 'warning', path: 'view',
            message: 'Embed view is a URL. It needs the network to show and paints nothing offline. Capture the view into doc.assets instead.' })
        }
        if (el.live && el.app === 'web' && !(typeof el.url === 'string' && /^https?:\/\//i.test(el.url))) {
          add({ ...at, code: 'embed-live-no-url', severity: 'warning', path: 'url',
            message: 'live is on but url is not an http(s) address. No frame is created, only the view shows.' })
        }
      }

      if (el.type === 'text' || el.type === 'code') checkFamily((el as TextElement | CodeElement).fontFamily, at)

      // charts ---------------------------------------------------------------
      if (el.type === 'chart' && el.option) validateChart(el.option as any, at, add)
    }
  }

  // ---- measured checks -----------------------------------------------------
  if (measure) measureOverflow(withoutElements(doc, skipMeasure), add)
  // contrast, text on text, frame children, chart labels (visualchecks.ts):
  // advice about what a person sees, never a fix
  visualChecks(withoutElements(doc, skipMeasure), add, measure)

  const counts = { error: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return { ok: counts.error === 0, measured: measure, counts, findings }
}

/** Report option keys charts-lite does not implement. */
function validateChart(
  option: Record<string, any>,
  at: { slide: string; element: string },
  add: (f: Finding) => void,
) {
  const note = (path: string, what: string) =>
    add({ ...at, code: 'chart-key-ignored', severity: 'warning', path,
      message: `charts-lite does not implement ${what} — it is ignored, with no warning at render time.` })

  for (const k of Object.keys(option)) {
    if (!CHART_KEYS.top.includes(k)) note(`option.${k}`, `the top-level chart option "${k}"`)
  }
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : []
  series.forEach((s: any, i: number) => {
    if (!s || typeof s !== 'object') return
    const allowed = [...CHART_KEYS.series, ...(CHART_KEYS.seriesByType[s.type] ?? [])]
    for (const k of Object.keys(s)) {
      if (allowed.includes(k)) continue
      // the one people reach for most, and the one that reads as a bug
      if (k === 'label') {
        note(`option.series[${i}].label`,
          'value labels on a bar, line or scatter series (label is read for pie only)')
      } else {
        note(`option.series[${i}].${k}`, `"${k}" on a ${s.type ?? 'series'} series`)
      }
    }
  })
  for (const axis of ['xAxis', 'yAxis'] as const) {
    const list = Array.isArray(option[axis]) ? option[axis] : option[axis] ? [option[axis]] : []
    list.forEach((a: any, i: number) => {
      if (!a || typeof a !== 'object') return
      for (const k of Object.keys(a)) {
        if (!CHART_KEYS.axis.includes(k)) note(`option.${axis}[${i}].${k}`, `"${k}" on an axis`)
      }
    })
  }
  if (option.legend && typeof option.legend === 'object') {
    for (const k of Object.keys(option.legend)) {
      if (!CHART_KEYS.legend.includes(k)) note(`option.legend.${k}`, `"${k}" on the legend`)
    }
  }
}

/**
 * Measure every text element and report the ones that do not fit.
 *
 * Goes through measure.ts, the same path `window.bento.measure()` uses, so the
 * validator and the measuring tool can never disagree about whether a given
 * box fits its text — which they would within a release if each had its own
 * copy of the arithmetic.
 */
function measureOverflow(doc: BentoDoc, add: (f: Finding) => void) {
  // a placeholder with no content measures as one empty line — not overflow
  const targets: Array<{ slide: string; el: TextElement; fields: FieldContext }> = []
  for (const slide of doc.slides) {
    // fields measure as the value this slide renders ({{page:2}} → "02"), not
    // as the token's own characters
    let fields: FieldContext | undefined
    for (const el of slide.elements) {
      if (el.type === 'text' && el.html?.trim()) targets.push({ slide: slide.id, el, fields: (fields ??= fieldContext(doc, slide)) })
    }
  }
  const measured = measureElements(targets, doc)
  measured.forEach((m, i) => {
    const { slide, el } = targets[i]
    if (m.fits !== false || m.overflow! <= 1) return
    add({
      slide, element: el.id, code: 'text-overflow', severity: 'warning', path: 'h',
      message: `Text needs ${m.height}px but the box is ${el.h}px tall — it overflows by ${m.overflow}px (${m.lines} lines) and will collide with whatever is below it.`,
    })
  })
  // Tables the same way: rows that need more height than the box run past
  // its bottom (#494). With a corner radius they used to be clipped instead,
  // silently; they now show, so this is what says the box is too short.
  const tables: Array<{ slide: string; el: TableElement }> = []
  for (const slide of doc.slides) {
    for (const el of slide.elements) if (el.type === 'table' && el.rows.length) tables.push({ slide: slide.id, el })
  }
  measureTables(tables.map((t) => t.el), doc).forEach((m, i) => {
    const { slide, el } = tables[i]
    if (m.overflow <= 1) return
    add({
      slide, element: el.id, code: 'table-overflow', severity: 'warning', path: 'h',
      message: `The table's rows need ${m.height}px but the box is ${el.h}px tall — they run ${m.overflow}px past it and will collide with whatever is below. Make the box taller, or the text or cell padding smaller.`,
    })
  })
}
