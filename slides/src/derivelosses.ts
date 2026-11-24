// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// What the derive pass changes in what the author wrote, for the load report
// (compactload.ts). Four things an agent writes are changed on load, by rules
// that are right for a person editing a deck and invisible to anyone reading
// the JSON back:
//
//   - a token-bound literal that differs from its token loses the binding
//     (tokens.ts: with the tokens unmoved, a disagreement is a hand edit);
//   - a component copy with no `sig` keeps every difference from its main as
//     a permanent override (components.ts: no sig reads as "main unmoved");
//   - frame children are laid out by their written coordinate, not by array
//     order (layout.ts: ties keep array order);
//   - a `parentId` naming no frame (or a cycle of frames) is removed, with
//     `sizing` (layout.ts layoutSlide).
//
// The rules stay as they are. This only DIFFS around the pass: a snapshot
// before, a comparison after, one `dropped` entry per change with a path and
// a reason that names the element and the fix. Nothing is added inside
// syncTokenRefs, syncComponents or layoutSlide, which run on every replica on
// every edit.
//
// PATHS point into the text the author sent, like the gate's own entries: the
// loaded document's indices are not the author's once parseDoc or the gate
// dropped an element or a slide, or a compact deck nested its elements. Each
// holder is found in the input by its id (a compact deck's minted ids are
// minted again the same way); one that cannot be found (an id the input does
// not carry, or carries twice) keeps its loaded-document path, and the reason
// says so.

import type { BentoDoc, Slide, SlideElement } from './model'
import { REQUIRED_ELEMENT_KEYS } from './model'
import type { Dropped } from './untrusted'
import { derive, deriveMemory } from './derive'
import { tokenDrift, tokenName } from './tokens'
import { frameChildren, isFrame } from './layout'
import { isCompact } from './compact'

type Obj = Record<string, unknown>
type Holder = Obj & { themeRefs?: Record<string, string> }
type El = SlideElement & { component?: { id?: string; main?: boolean; sig?: string; over?: string[] } }
type Group = 'slides' | 'layouts'

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const show = (v: unknown) => JSON.stringify(v)

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

/** Run the derive pass a freshly loaded document gets (the editor's memory on
 *  `replace`) and return what it changed that the author wrote. `input` is the
 *  parsed text the author sent, for the paths. */
export function deriveReported(doc: BentoDoc, input: unknown): Dropped[] {
  const compact = isCompact(input)
  const find = inputIndex(input)
  const groups: Array<{ group: Group; i: number; holder: Slide }> = [
    ...doc.slides.map((s, i) => ({ group: 'slides' as const, i, holder: s })),
    ...(doc.layouts ?? []).map((s, i) => ({ group: 'layouts' as const, i, holder: s })),
  ]
  interface Before {
    /** the path to report, and what the author wrote there (when found) */
    path: string
    raw?: Obj
    /** "element "x" on slide "s1"", for every reason */
    who: string
    drift: Array<{ path: string; name: string; have: unknown; want: unknown }>
    over?: Set<string>
    unsigned?: boolean
    parentId?: string
    x?: number
    y?: number
  }
  const before = new Map<object, Before>()
  // instances whose copy carries a sig on some member (components.ts reads the instance)
  const inst = (s: Slide, el: El) => `${s.id}|${(el as { groupId?: string }).groupId ?? el.id}|${el.component?.id}`
  const signed = new Set<string>()
  for (const { holder: s } of groups) for (const el of s.elements as El[]) if (el.component && !el.component.main && el.component.sig) signed.add(inst(s, el))

  for (const { group, i, holder: s } of groups) {
    const where = `${group === 'slides' ? 'slide' : 'layout'} "${s.id}"`
    const snap = (h: Holder, key: string, loaded: string, who: string) => {
      const found = find(key)
      const b: Before = { path: found?.path ?? loaded, raw: found?.raw, who: found ? who : `${who} (path in the loaded document)`, drift: [] }
      for (const [p, ref] of Object.entries(h.themeRefs ?? {})) {
        const name = tokenName(ref)
        const d = name ? tokenDrift(doc, h, p, name) : null
        if (name && d) b.drift.push({ path: p, name, ...d })
      }
      before.set(h, b)
      return b
    }
    snap(s as unknown as Holder, `${group}|${s.id}`, `/${group}/${i}`, where)
    s.elements.forEach((el, j) => {
      const b = snap(el as unknown as Holder, `${group}|${s.id}|${el.id}`, `/${group}/${i}/elements/${j}`, `element "${el.id}" on ${where}`)
      const c = (el as El).component
      if (c && !c.main) { b.over = new Set(c.over ?? []); b.unsigned = !signed.has(inst(s, el as El)) }
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

  /** Would leaving the literal out have kept the binding? compact.ts fills a
   *  top-level property from its token; a full document is taken as written,
   *  so only an element's optional top-level key is filled (compactload.ts),
   *  and parseDoc fills a table's missing style with a default first. */
  const omissible = (h: Holder, slide: boolean, path: string) => {
    if (path.includes('.')) return false
    if (compact) return true
    if (slide) return false
    const type = String(h.type)
    return !(REQUIRED_ELEMENT_KEYS[type] ?? []).includes(path) && !(type === 'table' && path === 'style')
  }
  const readRaw = (o: Obj | undefined, path: string): unknown => {
    let cur: unknown = o
    for (const sg of path.split('.')) cur = isObj(cur) && Object.hasOwn(cur, sg) ? cur[sg] : undefined
    return cur
  }

  const out: Dropped[] = []
  for (const { group, holder: s } of groups) {
    const on = group === 'slides' ? 'this slide' : 'this layout'
    for (const h of [s as unknown as Holder, ...(s.elements as unknown as Holder[])]) {
      const b = before.get(h)
      if (!b) continue
      const slide = h === (s as unknown as Holder)
      for (const d of b.drift) {
        if (h.themeRefs?.[d.path]) continue
        // what the author wrote there: unknown when the holder was not found in the input
        const written = b.raw ? readRaw(b.raw, d.path) : d.have
        const reason = written === undefined
          ? `binding dropped: ${b.who} has no value at "${d.path}" for token "${d.name}" (${show(d.want)})${d.have === undefined ? '' : `, so loading filled ${show(d.have)}, which differs`}. Write the token's value there`
          : `binding dropped: ${b.who}: value ${show(d.have)} at "${d.path}" differs from token "${d.name}" (${show(d.want)}). Write the token's value${omissible(h, slide, d.path) ? ', or leave the literal out and it is filled from the token' : ''}`
        out.push({ path: `${b.path}/themeRefs/${d.path}`, reason })
      }
      if (slide) continue
      const el = h as unknown as El
      if (b.over && b.unsigned) {
        for (const k of el.component?.over ?? []) {
          if (b.over.has(k)) continue
          out.push({ path: `${b.path}/${k}`,
            reason: `override added: ${b.who}: "${k}" differs from the main and this copy has no sig, so it stays the copy's own and no longer follows the main. Write component.sig "reset" on the copy to follow the main, or leave it if the difference is meant` })
        }
      }
      if (b.parentId && el.parentId === undefined) {
        out.push({ path: `${b.path}/parentId`,
          reason: `parent removed: ${b.who}: parentId "${b.parentId}" ${why.get(el) ?? 'names no frame'}, so parentId and sizing were dropped and the element stays where it is written. Name a frame on ${on} that does not contain this element, or leave parentId out` })
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
      const same = L.dir === 'row' ? 'x' : L.dir === 'col' ? 'y' : 'x and y'
      const names = order.slice(0, 12).map((k) => k.id).join(', ') + (order.length > 12 ? ', …' : '')
      const b = before.get(f)!
      out.push({ path: b.path,
        reason: `children reordered: ${b.who} is a frame that lays out its children by each one's ${axis}, not by array order: ${names}. To keep array order, write the children at the same ${same} (the frame's own is fine)` })
    })
  }
  return out
}
