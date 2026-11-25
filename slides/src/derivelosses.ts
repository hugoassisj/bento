// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// What the derive pass changes in what the author wrote, for the load report
// (compactload.ts). Things an agent writes are changed on load, by rules that
// are right for a person editing a deck and invisible to anyone reading the
// JSON back:
//
//   - a token-bound literal that differs from its token loses the binding
//     (tokens.ts: with the tokens unmoved, a disagreement is a hand edit);
//   - a component copy that follows its main takes the main's bindings in
//     place of its own (components.ts);
//   - a component copy with no `sig` keeps every difference from its main as
//     a permanent override (components.ts: no sig reads as "main unmoved");
//   - frame children are laid out by their written coordinate, not by array
//     order (layout.ts: ties keep array order);
//   - a `parentId` naming no frame (or a cycle of frames) is removed, with
//     `sizing` (layout.ts layoutSlide).
//
// The rules stay as they are. This only DIFFS around the pass: a snapshot
// before (every token binding, every literal it drives, every copy's
// overrides), a comparison after, one `dropped` entry per change with a path,
// a reason that names the element, and one instruction. Nothing is added
// inside syncTokenRefs, syncComponents or layoutSlide, which run on every
// replica on every edit.
//
// THE INSTRUCTION IS TRUE WHEN FOLLOWED ALONE (scripts/test-slides-load-advice*
// follow each one and load again). So it names the property's OWNER: a copy
// that follows its main is fixed on the main, an element a deck's own layout
// made is fixed on the layout, and a property the loader itself sets (a frame
// laying out its children, fill sizing) cannot be bound at all, so the
// instruction is to remove the reference. A fix that makes other entries
// appear (a main changed under copies without a sig) says which, as
// "then also: …". "Leave it out" is offered only where compact expansion fills
// it from the token AND the result equals what writing the value would give
// (a colour's own opacity is not kept by leaving it out), proved by loading
// the input again without those literals.
//
// PATHS point into the text the author sent, like the gate's own entries: the
// loaded document's indices are not the author's once parseDoc or the gate
// dropped an element or a slide, or a compact deck nested its elements. Each
// holder is found in the input by its id (a compact deck's minted ids are
// minted again the same way); one that cannot be found (an id the input does
// not carry, or carries twice) keeps its loaded-document path, and the reason
// says so.

import type { BentoDoc, Slide, SlideElement } from './model'
import type { Dropped } from './untrusted'
import { derive, deriveMemory } from './derive'
import { tokenDrift, tokenName, tokenValue } from './tokens'
import { frameChildren, isFrame } from './layout'
import { OWN } from './components'
import { isCompact } from './compact'
import { _readPath } from './palette'

type Obj = Record<string, unknown>
type Holder = Obj & { themeRefs?: Record<string, string> }
type Comp = { id?: string; key?: string; main?: boolean; sig?: string; over?: string[]; off?: number[] }
type El = SlideElement & { groupId?: string; component?: Comp }
type Group = 'slides' | 'layouts'

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const show = (v: unknown) => JSON.stringify(v)
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : eq(a, b)
/** Properties layout writes on a frame child (and a hugging frame). */
const GEOMETRY = new Set(['x', 'y', 'w', 'h'])

/** Where each slide, layout and element sits in the author's input, by id. */
function inputIndex(input: unknown) {
  const at = new Map<string, { path: string; raw: Obj }>()
  const twice = new Set<string>()
  const put = (k: string, path: string, raw: Obj) => { if (at.has(k)) twice.add(k); else at.set(k, { path, raw }) }
  const compact = isCompact(input)
  for (const group of ['slides', 'layouts'] as const) {
    const list = isObj(input) ? input[group] : undefined
    if (!Array.isArray(list)) continue
    list.forEach((s, si) => {
      if (!isObj(s)) return
      // compact.ts mints a missing slide id as s<n>; parseDoc mints a random one
      const sid = typeof s.id === 'string' && s.id ? s.id : compact && group === 'slides' ? `s${si + 1}` : null
      if (sid === null) return
      put(`${group}|${sid}`, `/${group}/${si}`, s)
      let n = 0 // compact: the flat index a minted id carries
      const walk = (v: unknown, path: string, top: boolean) => {
        if (Array.isArray(v)) { if (compact || top) v.forEach((x, i) => walk(x, `${path}/${i}`, false)); return }
        if (!isObj(v)) return
        const i = n++
        // compact.ts: a role'd or text-bearing element with no type is a text box; a missing id is `${slide}-${type}-${index}`
        const type = !v.type && (typeof v.role === 'string' || typeof v.md === 'string' || typeof v.html === 'string') ? 'text' : v.type
        const id = typeof v.id === 'string' && v.id ? v.id : compact && group === 'slides' ? `${sid}-${type}-${i}` : null
        if (id !== null) put(`${group}|${sid}|${id}`, path, v)
      }
      walk(s.elements, `/${group}/${si}/elements`, true)
    })
  }
  return (k: string) => (twice.has(k) ? undefined : at.get(k))
}

const readRaw = (o: unknown, path: string): unknown => {
  let cur: unknown = o
  for (const sg of path.split('.')) cur = isObj(cur) && Object.hasOwn(cur, sg) ? cur[sg] : undefined
  return cur
}

interface Before {
  group: Group
  slide: Slide
  /** the path to report, and what the author wrote there (when found) */
  path: string
  raw?: Obj
  /** the holder's key in inputIndex, to find it again in a reloaded document */
  key: string
  /** "element "x" on slide "s1"", for every reason */
  who: string
  /** every token binding, the literal it drove, and whether it disagreed */
  refs: Map<string, { ref: string; name: string; literal: unknown; drift: { have: unknown; want: unknown } | null }>
  over?: Set<string>
  unsigned?: boolean
  /** the copy's sig as written (the pass rewrites it) */
  sig?: string
  parentId?: string
  x?: number
  y?: number
}

/** Run the derive pass a freshly loaded document gets (the editor's memory on
 *  `replace`) and return what it changed that the author wrote. `input` is the
 *  parsed text the author sent, for the paths. `reload` loads an input the way
 *  this one was loaded (without text fitting: no offer depends on it), to prove
 *  the offers to leave a literal out. */
export function deriveReported(doc: BentoDoc, input: unknown, reload?: (input: unknown) => BentoDoc | null): Dropped[] {
  const compact = isCompact(input)
  const find = inputIndex(input)
  const groups: Array<{ group: Group; i: number; holder: Slide }> = [
    ...doc.slides.map((s, i) => ({ group: 'slides' as const, i, holder: s })),
    ...(doc.layouts ?? []).map((s, i) => ({ group: 'layouts' as const, i, holder: s })),
  ]
  const before = new Map<object, Before>()
  // instances whose copy carries a sig on some member (components.ts reads the instance)
  const inst = (s: Slide, el: El) => `${s.id}|${el.groupId ?? el.id}|${el.component?.id}`
  const signed = new Set<string>()
  for (const { holder: s } of groups) for (const el of s.elements as El[]) if (el.component && !el.component.main && el.component.sig) signed.add(inst(s, el))

  for (const { group, i, holder: s } of groups) {
    const where = `${group === 'slides' ? 'slide' : 'layout'} "${s.id}"`
    const snap = (h: Holder, key: string, loaded: string, who: string) => {
      const found = find(key)
      const b: Before = { group, slide: s, path: found?.path ?? loaded, raw: found?.raw, key, who: found ? who : `${who} (path in the loaded document)`, refs: new Map() }
      for (const [p, ref] of Object.entries(h.themeRefs ?? {})) {
        const name = tokenName(ref)
        if (!name) continue
        b.refs.set(p, { ref, name, literal: structuredClone(_readPath(h, p)), drift: tokenDrift(doc, h, p, name) })
      }
      before.set(h, b)
      return b
    }
    snap(s as unknown as Holder, `${group}|${s.id}`, `/${group}/${i}`, where)
    s.elements.forEach((el, j) => {
      const b = snap(el as unknown as Holder, `${group}|${s.id}|${el.id}`, `/${group}/${i}/elements/${j}`, `element "${el.id}" on ${where}`)
      const c = (el as El).component
      if (c && !c.main) { b.over = new Set(c.over ?? []); b.unsigned = !signed.has(inst(s, el as El)); b.sig = c.sig }
      if (el.parentId) b.parentId = el.parentId // "" is no link: the gate keeps it, layout ignores it
      b.x = el.x
      b.y = el.y
    })
  }
  // why a parentId will be let go, judged on the document as written
  const why = new Map<object, string>()
  for (const { group, holder: s } of groups) {
    const on = group === 'slides' ? 'this slide' : 'this layout'
    const byId = new Map(s.elements.map((e) => [e.id, e]))
    for (const el of s.elements) {
      if (!el.parentId) continue
      const p = byId.get(el.parentId)
      why.set(el, !p ? `names no element on ${on}`
        : !isFrame(p) ? `names an element on ${on} that is not a frame (a rect with layout)`
        : `leads back to this element through its frames (a cycle)`)
    }
  }

  derive(doc, deriveMemory(doc))

  // ---- the deck after the pass, for owners and consequences ----------------
  const mainOf = new Map<string, El>() // `${componentId}|${key}` → the main member
  const copiesOf = new Map<string, Array<{ el: El; b: Before }>>()
  for (const { holder: s } of groups) for (const el of s.elements as El[]) {
    const c = el.component
    if (!c?.id) continue
    const k = `${c.id}|${c.key}`
    if (c.main) { if (!mainOf.has(k)) mainOf.set(k, el) }
    else copiesOf.set(k, [...(copiesOf.get(k) ?? []), { el, b: before.get(el)! }])
  }
  const compKey = (el: El) => `${el.component?.id}|${el.component?.key}`
  /** Copies that would keep their own `p` as an override once `holder`'s p is `value`. */
  const consequences = (holder: El, p: string, value: unknown): string[] => {
    const c = holder.component
    if (!c || OWN.has(p.split('.')[0])) return []
    const top = p.split('.')[0]
    if (c.main) {
      return (copiesOf.get(compKey(holder)) ?? [])
        .filter(({ el, b }) => b.unsigned && !(el.component?.over ?? []).includes(top) && !sameValue(_readPath(el as unknown as Holder, p), value))
        .map(({ el }) => el.id)
    }
    const main = mainOf.get(compKey(holder))
    return main && !(c.over ?? []).includes(top) && !sameValue(_readPath(main as unknown as Holder, p), value) ? [holder.id] : []
  }
  const alsoOverride = (ids: string[], p: string) => ids.length
    ? ` Writing it leaves ${ids.map((x) => `"${x}"`).join(', ')} with ${ids.length === 1 ? 'its' : 'their'} own "${p.split('.')[0]}", as an override (then also: override added on ${ids.map((x) => `"${x}"`).join(', ')}).`
    : ''

  /** The author's own layouts in a compact deck, for elements they made. */
  const ownLayoutOf = (b: Before, el: El): { path: string; who: string; raw: Obj } | null => {
    if (b.group !== 'slides' || b.raw) return null
    const rawSlide = find(`slides|${b.slide.id}`)?.raw
    const name = typeof rawSlide?.layout === 'string' ? rawSlide.layout : null
    if (!name || !isObj(input) || !Array.isArray(input.layouts)) return null
    const layout = (input.layouts as unknown[]).find((l) => isObj(l) && (l.id === name || (typeof l.name === 'string' && l.name.toLowerCase() === name.toLowerCase()))) as Obj | undefined
    if (!layout || typeof layout.id !== 'string') return null
    const hit = find(`layouts|${layout.id}|${el.id}`)
    return hit ? { path: hit.path, who: `layout "${layout.id}"'s "${el.id}"`, raw: hit.raw } : null
  }

  const out: Dropped[] = []
  const offers: Array<{ entry: Dropped; b: Before; p: string; ref: string; name: string; want: unknown; text: string }> = []

  for (const { group, holder: s } of groups) {
    const on = group === 'slides' ? 'this slide' : 'this layout'
    for (const h of [s as unknown as Holder, ...(s.elements as unknown as Holder[])]) {
      const b = before.get(h)
      if (!b) continue
      const isSlide = h === (s as unknown as Holder)
      const el = h as unknown as El
      for (const [p, r] of b.refs) {
        if (h.themeRefs?.[p] === r.ref) continue // still bound
        const entry: Dropped = { path: `${b.path}/themeRefs/${p}`, reason: '' }
        out.push(entry)
        const top = p.split('.')[0]
        const raw = tokenValue(doc, r.name)
        const holds = (w: unknown) => sameValue(w, raw) ? `token "${r.name}" holds ${show(raw)}` : `token "${r.name}" holds ${show(raw)} (${show(w)} at this colour's own opacity)`
        const now = _readPath(h, p)
        if (!r.drift) {
          // agreed with its token, and is gone: the copy took its main's bindings
          const sigWhy = b.sig === 'reset' ? 'its component.sig is "reset"' : 'its component.sig is not its main\'s current one'
          const keep = [...new Set([...(el.component?.over ?? []), top, 'themeRefs'])].sort()
          entry.reason = `binding replaced: ${b.who}: "${p}" was bound to token "${r.name}", but this copy follows its main (${sigWhy}), which replaced its bindings with the main's. Write ${show(keep)} at "component.over" to keep it bound.`
          continue
        }
        const want = r.drift.want
        const written = b.raw ? readRaw(b.raw, p) : r.literal
        // a nested property whose parent the author never wrote has nowhere to live
        const parent = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : ''
        if (parent && readRaw(b.raw ?? h, parent) === undefined && _readPath(h, parent) === undefined) {
          entry.reason = `binding dropped: ${b.who} has no "${parent}" for token "${r.name}" to set "${p}" in, so the reference does nothing and was dropped. Remove themeRefs["${p}"].`
          continue
        }
        const what = written === undefined
          ? `has no value at "${p}" for ${holds(want)}${r.literal === undefined ? '' : `, so loading filled ${show(r.literal)}`} and the binding was dropped`
          : `: "${p}" is ${show(r.literal)} but ${holds(want)}, so the binding was dropped as a hand edit`
        const head = `binding dropped: ${b.who}${what.startsWith(':') ? '' : ' '}${what}.`
        const changed = !sameValue(now, r.literal) // the pass itself rewrote it
        const main = el.component && !el.component.main ? mainOf.get(compKey(el)) : undefined
        const followsMain = !isSlide && !!main && changed && !(el.component?.over ?? []).includes(top)
        const fromLayout = !isSlide ? ownLayoutOf(b, el) : null
        if (followsMain) {
          // a copy that follows its main: the main is where the value comes from
          const mb = before.get(main as object)!
          const mainWant = tokenDrift(doc, main as unknown as Holder, p, r.name)?.want ?? want
          const mainBound = (main as unknown as Holder).themeRefs?.[p] === r.ref || mb.refs.get(p)?.ref === r.ref
          const target = `in ${mb.path} (its main "${main!.id}")`
          entry.reason = `${head} This copy takes "${top}" from its main.${alsoOverride(consequences(main!, p, mainWant), p)} ` + (mainBound
            ? `Write ${show(mainWant)} at "${p}" ${target} to keep it bound.`
            : `Write ${show(mainWant)} at "${p}" and ${show(r.ref)} at "themeRefs.${p}" ${target} to keep it bound.`)
        } else if (fromLayout) {
          entry.reason = `${head} The element comes from ${fromLayout.who}. Write ${show(want)} at "${p}" in ${fromLayout.path} (${fromLayout.who}) to keep it bound.`
        } else if (changed && GEOMETRY.has(top) && !isSlide && (el.parentId || isFrame(el as SlideElement))) {
          const owner = el.parentId ? `frame "${el.parentId}"` : 'its own layout (it hugs its children)'
          entry.reason = `${head} The ${owner} sets "${top}" on every load, so no token can hold it. Remove themeRefs["${p}"].`
        } else if (changed) {
          entry.reason = `${head} Loading sets "${top}" itself, so no token can hold it. Remove themeRefs["${p}"].`
        } else {
          const text = `${head}${alsoOverride(isSlide ? [] : consequences(el, p, want), p)} Write ${show(want)} at "${p}" to keep it bound`
          entry.reason = `${text}.`
          // leaving it out: compact expansion fills a slide's (or its element's)
          // top-level property from the token; never a text's measured h, a
          // component member, or a colour whose own opacity would be lost
          const omissible = compact && group === 'slides' && !!b.raw && !p.includes('.') && sameValue(want, raw)
            && !(h.type === 'text' && p === 'h') && !el.component
          if (omissible) offers.push({ entry, b, p, ref: r.ref, name: r.name, want, text })
        }
      }
      if (isSlide) continue
      if (b.over && b.unsigned) {
        const main = mainOf.get(compKey(el))
        for (const k of el.component?.over ?? []) {
          // its own token bindings are its own; a binding it holds is the
          // difference working as meant, not one to report
          if (b.over.has(k) || k === 'themeRefs') continue
          const own = h.themeRefs?.[k]
          if (own && tokenName(own) && !tokenDrift(doc, h, k, tokenName(own)!)) continue
          const mv = k === 'x' || k === 'y'
            ? (main && typeof main[k] === 'number' ? (main[k] as number) + ((el.component?.off ?? [0, 0])[k === 'x' ? 0 : 1] ?? 0) : undefined)
            : main ? (main as unknown as Obj)[k] : undefined
          const fix = mv === undefined
            ? `Remove "${k}" from this copy to follow the main there; leave it if the difference is meant.`
            : `Write ${show(mv)} at "${k}" on this copy to follow the main there; leave it if the difference is meant.`
          out.push({ path: `${b.path}/${k}`,
            reason: `override added: ${b.who}: its "${k}" differs from its main's and this copy has no sig, so it keeps its own "${k}" and no longer follows the main there. ${fix}` })
        }
      }
      if (b.parentId && el.parentId === undefined) {
        out.push({ path: `${b.path}/parentId`,
          reason: `parent removed: ${b.who}: parentId "${b.parentId}" ${why.get(el) ?? 'names no frame'}, so parentId and sizing were dropped and the element stays where it is written. Name a frame on ${on} in parentId (not one inside this element), or remove "parentId".` })
      }
    }
    // frame children laid out in another order than the array, when layout moved them
    s.elements.forEach((f) => {
      if (!isFrame(f)) return
      const kids = s.elements.filter((e) => e.parentId === f.id && e.id !== f.id)
      const moved = kids.some((k) => { const b = before.get(k); return !!b && (b.x !== k.x || b.y !== k.y) })
      if (!moved) return
      const order = frameChildren(s, f)
      if (order.every((k, i) => k === kids[i])) return
      const L = f.layout
      const axis = L.dir === 'grid' ? 'grid cell nearest its written position' : L.wrap ? 'written position, line by line' : `written ${L.dir === 'row' ? 'x' : 'y'}`
      const at = L.dir === 'row' && !L.wrap ? `"x": ${f.x}` : L.dir === 'col' && !L.wrap ? `"y": ${f.y}` : `"x": ${f.x} and "y": ${f.y}`
      const names = order.slice(0, 12).map((k) => k.id).join(', ') + (order.length > 12 ? ', …' : '')
      const b = before.get(f)!
      out.push({ path: b.path,
        reason: `children reordered: ${b.who} is a frame that lays out its children by each one's ${axis}, not by array order: ${names}. Write ${at} on every child to lay them out in array order.` })
    })
  }

  // Prove the offers to leave a literal out: remove them all from a copy of
  // the input, load it the same way (no text fitting), and keep an offer only
  // where the holder is still there, bound, at exactly the value writing it
  // would give. One extra load, only when a compact slide's literal disagrees
  // with its token. The offers are independent: each removes one literal from
  // an element that is no component member, so no other element reads it.
  if (offers.length && reload) {
    const next = structuredClone(input)
    for (const o of offers) {
      let h: unknown = next
      for (const sg of o.b.path.split('/').slice(1)) h = Array.isArray(h) ? h[Number(sg)] : isObj(h) ? h[sg] : undefined
      if (isObj(h)) delete h[o.p]
    }
    const again = reload(next)
    if (again) {
      const at = new Map<string, Holder>()
      for (const sl of again.slides) {
        at.set(`slides|${sl.id}`, sl as unknown as Holder)
        for (const e of sl.elements) at.set(`slides|${sl.id}|${e.id}`, e as unknown as Holder)
      }
      for (const o of offers) {
        const h = at.get(o.b.key)
        if (h && h.themeRefs?.[o.p] === o.ref && sameValue(_readPath(h, o.p), o.want) && !tokenDrift(again, h, o.p, o.name)) {
          o.entry.reason = `${o.text}, or leave "${o.p}" out and it is filled from the token.`
        }
      }
    }
  }
  return out
}
