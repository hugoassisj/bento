// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Static checks over a document's JSON, with no browser: the shape the schema
// describes, and the mistakes the eye catches only on a rendered slide —
// colours the renderer cannot read, frames that do not exist, content boxes on
// top of each other, text too faint for its background, literals that
// disagree with the token they are bound to, component copies that cannot
// tell an override from a stale value. Plus the design-system diff an edit is
// held to: content changes, the deck's system does not.
//
// Findings have the app's shape — { code, severity, message, slide?,
// element?, path? } — and where a finding is one window.bento.validate() also
// reports (unknown-key, duplicate-id, token-unknown, theme-ref-stale) the code
// and the message are the app's own (slides/src/validate.ts). Everything here
// is a plain function over JSON; nothing is imported from slides/src.

import { contrastRatio, isColour, keepAlpha, paletteOf, parseColour, resolveRef, parseThemeRef } from './colour.mjs'
import { styleValues } from './inspect.mjs'
import { same } from './deck.mjs'

// ---- the schema (a validator for the keywords schema/slides.json uses) -------

function resolve(schema, root) {
  let s = schema
  for (let i = 0; s && s.$ref && i < 16; i++) {
    const segs = s.$ref.replace(/^#\//, '').split('/')
    s = segs.reduce((o, k) => o?.[k], root)
  }
  return s ?? {}
}
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const typeOk = (v, t) => (Array.isArray(t) ? t : [t]).some((x) => x === typeOf(v) || (x === 'number' && typeof v === 'number' && Number.isFinite(v)))

/** Errors as { ptr: string[], kind, detail }. `elementTypes` collects the oneOf's element kinds. */
function check(v, schema, root, ptr, out) {
  const s = resolve(schema, root)
  if (s.type && !typeOk(v, s.type)) { out.push({ ptr, kind: 'type', detail: `expected ${[].concat(s.type).join(' or ')}, found ${typeOf(v)}` }); return }
  if (s.const !== undefined && !same(v, s.const)) { out.push({ ptr, kind: 'const', detail: `must be ${JSON.stringify(s.const)}` }); return }
  if (s.enum && !s.enum.some((e) => same(e, v))) { out.push({ ptr, kind: 'enum', detail: `must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}, not ${JSON.stringify(v)}` }); return }
  if (typeof v === 'string') {
    if (s.maxLength !== undefined && v.length > s.maxLength) out.push({ ptr, kind: 'maxLength', detail: `longer than ${s.maxLength} characters` })
    if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) out.push({ ptr, kind: 'pattern', detail: `${JSON.stringify(v.slice(0, 40))} does not match ${s.pattern}` })
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) out.push({ ptr, kind: 'minimum', detail: `${v} is below ${s.minimum}` })
    if (s.maximum !== undefined && v > s.maximum) out.push({ ptr, kind: 'maximum', detail: `${v} is above ${s.maximum}` })
  }
  if (Array.isArray(v)) {
    if (s.maxItems !== undefined && v.length > s.maxItems) out.push({ ptr, kind: 'maxItems', detail: `more than ${s.maxItems} items` })
    if (s.minItems !== undefined && v.length < s.minItems) out.push({ ptr, kind: 'minItems', detail: `fewer than ${s.minItems} items` })
    if (s.items) v.forEach((x, i) => check(x, s.items, root, [...ptr, String(i)], out))
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const props = s.properties ?? {}
    for (const r of s.required ?? []) if (!Object.hasOwn(v, r)) out.push({ ptr, kind: 'required', detail: `"${r}" is required` })
    if (s.maxProperties !== undefined && Object.keys(v).length > s.maxProperties) out.push({ ptr, kind: 'maxProperties', detail: `more than ${s.maxProperties} keys` })
    for (const [k, x] of Object.entries(v)) {
      if (Object.hasOwn(props, k)) check(x, props[k], root, [...ptr, k], out)
      else if (s.additionalProperties === false) out.push({ ptr: [...ptr, k], kind: 'unknown-key', detail: k })
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') check(x, s.additionalProperties, root, [...ptr, k], out)
    }
  }
  if (s.anyOf) {
    const runs = s.anyOf.map((b) => { const e = []; check(v, b, root, ptr, e); return e })
    if (!runs.some((e) => e.length === 0)) out.push(...runs.reduce((a, b) => (b.length < a.length ? b : a)))
  }
  if (s.oneOf) {
    // the element union: pick the branch by its `type` constant, so the
    // errors are that element type's, and an unknown type is said as such
    const branches = s.oneOf.map((b) => resolve(b, root))
    const typed = branches.every((b) => b.properties?.type?.const !== undefined)
    if (typed && v && typeof v === 'object') {
      const b = branches.find((x) => x.properties.type.const === v.type)
      if (!b) out.push({ ptr, kind: 'unknown-type', detail: String(v.type), known: branches.map((x) => x.properties.type.const) })
      else check(v, b, root, ptr, out)
    } else {
      const runs = branches.map((b) => { const e = []; check(v, b, root, ptr, e); return e })
      const okCount = runs.filter((e) => e.length === 0).length
      if (okCount !== 1) out.push(okCount ? { ptr, kind: 'oneOf', detail: 'matches more than one form' } : runs.reduce((a, b) => (b.length < a.length ? b : a))[0])
    }
  }
}

/** Where a pointer lands: the slide and element ids, and the path inside. */
function locate(doc, ptr) {
  if (ptr[0] !== 'slides' || ptr.length < 2) return { path: ptr.join('.') || undefined }
  const s = doc.slides?.[Number(ptr[1])]
  if (ptr[2] !== 'elements' || ptr.length < 4) return { slide: s?.id, path: ptr.slice(2).join('.') || undefined }
  const el = s?.elements?.[Number(ptr[3])]
  return { slide: s?.id, element: el?.id, path: ptr.slice(4).join('.') || undefined, type: el?.type }
}

export function schemaFindings(doc, schema) {
  const errs = []
  check(doc, schema, schema, [], errs)
  return errs.map((e) => {
    const at = locate(doc, e.ptr)
    const { type, ...where } = at
    if (e.kind === 'unknown-type') {
      return { ...where, code: 'unknown-element-type', severity: 'error', path: 'type',
        message: `"${e.detail}" is not an element type, so this element is dropped when the deck opens. Use one of: ${e.known.join(', ')}.` }
    }
    if (e.kind === 'unknown-key') {
      const k = e.detail
      if (at.element) return { ...where, code: 'unknown-key', severity: 'warning', message: `"${k}" is not a property of a ${type} element — it is ignored, so whatever it was meant to do will not happen.` }
      if (at.slide && e.ptr.length === 3) return { ...where, code: 'unknown-key', severity: 'warning', message: `Slide key "${k}" is not part of the format — it is ignored.` }
      if (e.ptr.length === 1) return { ...where, code: 'unknown-key', severity: 'warning', message: `Document key "${k}" is not part of the bento/slides format — it is ignored at render time.` }
      return { ...where, code: 'unknown-key', severity: 'warning', message: `"${at.path}" is not part of the format — it is ignored.` }
    }
    return { ...where, code: 'schema', severity: 'error', message: `${at.path ?? '(document)'}: ${e.detail} — the value is dropped or replaced when the deck opens. Correct it to what schema/slides.json describes.` }
  })
}

// ---- the checks ------------------------------------------------------------------

// svg is artwork (bokeh, dots, ornaments) and sits under text by design
const CONTENT = new Set(['text', 'image', 'chart', 'table', 'code', 'media', 'embed'])
/** A ghost: a translucent element (a watermark numeral, a tint) is decoration, not content. */
const faint = (e) => (e.opacity ?? 1) < 0.5 || (e.type === 'text' && (parseColour(e.color)?.a ?? 1) < 0.5)
const box = (e) => ({ x: Number(e.x) || 0, y: Number(e.y) || 0, w: Number(e.w) || 0, h: Number(e.h) || 0 })
const area = (b) => Math.max(0, b.w) * Math.max(0, b.h)
function intersect(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), w, h } : null
}
const stepOf = (e) => { const s = e.fx?.step; return typeof s === 'number' && s > 0 ? Math.floor(s) : 0 }
const readPath = (obj, p) => p.split('.').reduce((o, k) => (o == null || typeof o !== 'object' ? undefined : o[k]), obj)
const plainText = (html) => String(html ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()

function colourChecks(doc, add) {
  const bad = (v) => typeof v === 'string' && !(isColour(v) || /^url\(#[-\w.:]+\)$/.test(v.trim()))
  const say = (v, key) => `"${v}" is not a colour the renderer accepts, so ${key} falls back to its default. Write a hex (#RRGGBB), rgb() / hsl(), or a CSS colour name.`
  const t = doc.theme ?? {}
  for (const k of ['background', 'color', 'accent']) if (bad(t[k])) add({ code: 'invalid-colour', severity: 'error', path: `theme.${k}`, message: say(t[k], `theme.${k}`) })
  for (const [k, v] of Object.entries(t.palette ?? {})) if (bad(v)) add({ code: 'invalid-colour', severity: 'error', path: `theme.palette.${k}`, message: say(v, `theme.palette.${k}`) })
  for (const [name, tok] of Object.entries(t.tokens?.set ?? {})) {
    if ((tok?.type ?? 'color') !== 'color') continue
    for (const [m, v] of Object.entries(tok?.values ?? {})) if (bad(v)) add({ code: 'invalid-colour', severity: 'error', path: `theme.tokens.set.${name}.values.${m}`, message: say(v, `token "${name}"`) })
  }
  for (const s of doc.slides ?? []) {
    const bg = s.background
    if (typeof bg === 'string' && !/gradient\(|url\(/i.test(bg) && bad(bg)) add({ code: 'invalid-colour', severity: 'error', slide: s.id, path: 'background', message: say(bg, 'the slide background') })
    for (const el of s.elements ?? []) {
      const at = { slide: s.id, element: el.id }
      for (const k of ['color', 'fill', 'stroke']) if (bad(el[k])) add({ ...at, code: 'invalid-colour', severity: 'error', path: k, message: say(el[k], k) })
      ;(el.fillGradient?.stops ?? []).forEach((st, i) => { if (bad(st?.color)) add({ ...at, code: 'invalid-colour', severity: 'error', path: `fillGradient.stops.${i}.color`, message: say(st.color, 'a gradient stop') }) })
      for (const [i, sh] of [].concat(el.shadow ?? []).entries()) if (bad(sh?.color)) add({ ...at, code: 'invalid-colour', severity: 'error', path: Array.isArray(el.shadow) ? `shadow.${i}.color` : 'shadow.color', message: say(sh.color, 'the shadow colour') })
    }
  }
}

/** What a text box sits on: the topmost solid shape under its centre, else the slide. Null when that cannot be known (a picture, a gradient, a translucent paint). */
function backdropOf(slide, idx, doc) {
  const el = slide.elements[idx]
  const b = box(el)
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  for (let i = idx - 1; i >= 0; i--) {
    const u = slide.elements[i]
    if (u.hidden) continue
    const ub = box(u)
    if (cx < ub.x || cx > ub.x + ub.w || cy < ub.y || cy > ub.y + ub.h) continue
    if (u.type === 'image' || u.type === 'svg' || u.type === 'chart' || u.type === 'media' || u.type === 'embed') return null
    if (u.type !== 'shape' || u.shape === 'line') continue
    if (u.fillGradient || (u.opacity ?? 1) < 1) return null
    const c = parseColour(u.fill)
    if (!c) return null
    if (c.a === 0) continue
    return c.a < 1 ? null : { c, from: u.id }
  }
  const bg = slide.background ?? doc.theme?.background
  if (typeof bg !== 'string' || /gradient\(|url\(/i.test(bg)) return null
  const c = parseColour(bg)
  return c && c.a === 1 ? { c, from: 'slide' } : null
}

export function lintDoc(doc, { schema } = {}) {
  const findings = []
  const add = (f) => findings.push(f)
  const compact = doc.compact === true
  if (schema && !compact) findings.push(...schemaFindings(doc, schema))
  else if (compact) {
    add({ code: 'compact-not-schema-checked', severity: 'info', message: 'A compact document: the schema describes the full form, so its shape is not checked here. `bento render` or `bento apply` expands it through the deck\'s own runtime and reports what was dropped.' })
  }
  colourChecks(doc, add)

  const palette = paletteOf(doc)
  const tokens = doc.theme?.tokens?.set ?? {}
  const modes = Array.isArray(doc.theme?.tokens?.modes) && doc.theme.tokens.modes.length ? doc.theme.tokens.modes : ['default']
  const mode = doc.theme?.tokens?.mode && modes.includes(doc.theme.tokens.mode) ? doc.theme.tokens.mode : modes[0]
  const tokenValue = (name) => { const v = tokens[name]?.values ?? {}; for (const m of [mode, ...modes]) if (v[m] !== undefined) return v[m]; return undefined }
  const sameValue = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : same(a, b))

  const slideIds = new Set()
  for (const s of doc.slides ?? []) {
    if (slideIds.has(s.id)) add({ code: 'duplicate-slide-id', severity: 'error', slide: s.id, message: `Two slides share the id "${s.id}" — links, states and morph pairing key off it. Give one of them a new id.` })
    slideIds.add(s.id)
  }

  for (const s of doc.slides ?? []) {
    const els = s.elements ?? []
    const ids = new Set(els.map((e) => e.id))
    const seen = new Set()
    const refHolders = [[s, null], ...els.map((e) => [e, e])]
    for (const [holder, el] of refHolders) {
      const at = el ? { slide: s.id, element: el.id } : { slide: s.id }
      for (const [p, token] of Object.entries(holder.themeRefs ?? {})) {
        const have = readPath(holder, p)
        if (String(token).startsWith('$')) {
          const name = String(token).slice(1)
          if (!Object.hasOwn(tokens, name)) {
            add({ ...at, code: 'token-unknown', severity: 'warning', path: `themeRefs.${p}`, message: `There is no token "${name}" in theme.tokens, so this value will not follow it. Add the token, or drop the reference.` })
            continue
          }
          let want = tokenValue(name)
          if (typeof want === 'string' && (tokens[name].type ?? 'color') === 'color') want = keepAlpha(have, want)
          if (want !== undefined && have !== undefined && !sameValue(have, want)) {
            add({ ...at, code: 'token-stale', severity: 'warning', path: p,
              message: `This value is ${JSON.stringify(have)} but its token "$${name}" is ${JSON.stringify(want)}; the deck rewrites it to the token's value when it opens. Write the token's value, or drop the reference if ${JSON.stringify(have)} is what you meant.` })
          }
          continue
        }
        if (!parseThemeRef(token) || typeof have !== 'string') continue // malformed / dangling: validate() says so
        const base = resolveRef(token, palette)
        const want = base ? keepAlpha(have, base) : base
        if (want && have.toLowerCase() !== want.toLowerCase()) {
          add({ ...at, code: 'theme-ref-stale', severity: 'info', path: p,
            message: `This colour is ${have} but its reference "${token}" resolves to ${want}, so the next palette change will replace it. If ${have} was deliberate, clear the reference.` })
        }
      }
    }

    els.forEach((el, i) => {
      const at = { slide: s.id, element: el.id }
      if (seen.has(el.id)) add({ ...at, code: 'duplicate-id', severity: 'error', message: `Two elements on this slide share the id "${el.id}" — selection, morph and comment anchors all key off it.` })
      seen.add(el.id)
      if (el.parentId !== undefined && !ids.has(el.parentId)) {
        add({ ...at, code: 'dangling-parent', severity: 'warning', path: 'parentId', message: `parentId "${el.parentId}" names no element on this slide, so this element is not inside any frame. Fix the id, or remove parentId.` })
      }
      if (el.component && !el.component.main && !el.component.sig) {
        add({ ...at, code: 'copy-without-sig', severity: 'warning', path: 'component.sig',
          message: `This copy of component "${el.component.id}" has no sig, so every way it differs from the main is read as an override and it stops following the main there. Copy the sig from a copy the app wrote, or copy the main again in the editor.` })
      }
      // text too faint for what it sits on (WCAG 2.x: 4.5:1, 3:1 for large text)
      if (el.type === 'text' && !el.hidden && plainText(el.html ?? el.md)) {
        const ink = parseColour(el.color ?? doc.theme?.color)
        const under = backdropOf(s, i, doc)
        if (ink && ink.a === 1 && under) {
          const ratio = contrastRatio(ink, under.c)
          const size = Number(el.fontSize) || 24
          const large = size >= 24 || (size >= 18.66 && Number(el.fontWeight) >= 700)
          const need = large ? 3 : 4.5
          if (ratio < need) {
            add({ ...at, code: 'low-contrast', severity: 'warning', path: 'color',
              message: `Text ${el.color ?? doc.theme?.color} on ${under.from === 'slide' ? 'the slide background' : `"${under.from}"`} is ${ratio.toFixed(2)}:1; ${large ? 'large ' : ''}text needs ${need}:1 to be read. Use a darker or lighter colour (the deck's text slots are a good start).` })
          }
        }
      }
    })

    // content on top of content: two boxes that cover each other
    const content = els.map((e, i) => ({ e, i })).filter(({ e }) => CONTENT.has(e.type) && !e.hidden && !e.rotation && !faint(e))
    for (let a = 0; a < content.length; a++) for (let b = a + 1; b < content.length; b++) {
      const A = content[a].e, B = content[b].e
      if (A.parentId === B.id || B.parentId === A.id) continue
      if (A.groupId && A.groupId === B.groupId) continue
      if (stepOf(A) !== stepOf(B)) continue
      if (A.type !== 'text' && B.type !== 'text') continue // pictures and charts on each other are a design move
      const ia = intersect(box(A), box(B))
      if (!ia) continue
      const smaller = Math.min(area(box(A)), area(box(B)))
      if (smaller > 0 && area(ia) / smaller > 0.1) {
        add({ slide: s.id, element: B.id, code: 'overlap', severity: 'warning', path: 'y',
          message: `This ${B.type} covers ${Math.round((area(ia) / smaller) * 100)}% of "${A.id}" (${A.type}); one hides the other. Move or resize one of them, or put them in a frame with auto layout.` })
      }
    }
  }
  const counts = { error: 0, warning: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  return { findings, counts }
}

// ---- the design-system diff --------------------------------------------------------

const brief = (v) => { const t = JSON.stringify(v); return t === undefined ? undefined : t.length > 80 ? t.slice(0, 77) + '…' : t }
function diffMap(area, a = {}, b = {}, out) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!Object.hasOwn(b, k)) out.push({ area, name: k, change: 'removed', before: brief(a[k]) })
    else if (!Object.hasOwn(a, k)) out.push({ area, name: k, change: 'added', after: brief(b[k]) })
    else if (!same(a[k], b[k])) out.push({ area, name: k, change: 'changed', before: brief(a[k]), after: brief(b[k]) })
  }
}
function mains(doc) {
  const m = {}
  for (const s of doc.slides ?? []) for (const el of s.elements ?? []) {
    if (!el.component?.main) continue
    ;(m[el.component.id] ??= []).push(Object.fromEntries(Object.entries(el).filter(([k]) => k !== 'component')))
  }
  return m
}

/**
 * What an edit changed in the deck's design system — theme, tokens, modes,
 * component mains, layouts, fonts — and the unbound style literals it
 * introduced. Empty `changes` is what a content-only edit looks like.
 */
export function designDiff(base, next) {
  const changes = []
  const { tokens: ta, ...themeA } = base.theme ?? {}
  const { tokens: tb, ...themeB } = next.theme ?? {}
  diffMap('theme', themeA, themeB, changes)
  diffMap('tokens', ta?.set, tb?.set, changes)
  if (!same(ta?.modes ?? null, tb?.modes ?? null)) changes.push({ area: 'modes', name: 'modes', change: 'changed', before: brief(ta?.modes), after: brief(tb?.modes) })
  if (!same(ta?.mode ?? null, tb?.mode ?? null)) changes.push({ area: 'modes', name: 'mode', change: 'changed', before: brief(ta?.mode), after: brief(tb?.mode) })
  diffMap('components', mains(base), mains(next), changes)
  const byId = (list) => Object.fromEntries((list ?? []).map((l, i) => [l.id ?? `#${i}`, l]))
  diffMap('layouts', byId(base.layouts), byId(next.layouts), changes)
  const fonts = (list) => Object.fromEntries((list ?? []).map((f) => [`${f.family} ${f.weight ?? ''}`.trim(), f]))
  diffMap('fonts', fonts(base.fonts), fonts(next.fonts), changes)

  const key = (v) => `${v.slide}|${v.element ?? ''}|${v.key}|${JSON.stringify(v.value)}`
  const had = new Set(styleValues(base).filter((v) => !v.bound).map(key))
  const introduced = styleValues(next).filter((v) => !v.bound && !had.has(key(v)))
    .map(({ slide, element, key: k, value }) => ({ slide, element, key: k, value }))
  return { changes, introduced }
}
