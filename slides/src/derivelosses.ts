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
//   - a `parentId` naming no frame on the slide is removed, with `sizing`.
//
// The rules stay as they are. This only DIFFS around the pass: a snapshot
// before, a comparison after, one `dropped` entry per change with a path and
// a reason that names the fix. Nothing is added inside syncTokenRefs,
// syncComponents or layoutSlide, which run on every replica on every edit.

import type { BentoDoc, Slide, SlideElement } from './model'
import type { Dropped } from './untrusted'
import { derive, deriveMemory } from './derive'
import { tokenDrift, tokenName } from './tokens'
import { frameChildren, isFrame } from './layout'

type Holder = Record<string, unknown> & { themeRefs?: Record<string, string> }
type El = SlideElement & { component?: { main?: boolean; sig?: string; over?: string[] } }

interface Before {
  path: string
  /** token refs that disagree with their token: syncTokenRefs drops these */
  drift: Array<{ path: string; name: string; have: unknown; want: unknown }>
  over?: Set<string>
  unsigned?: boolean
  parentId?: string
  x?: number
  y?: number
}

const show = (v: unknown) => (v === undefined ? 'missing' : JSON.stringify(v))

/** Run the derive pass a freshly loaded document gets (the editor's memory on
 *  `replace`) and return what it changed that the author wrote. */
export function deriveReported(doc: BentoDoc): Dropped[] {
  const groups: Array<{ base: string; holder: Slide }> = [
    ...doc.slides.map((s, i) => ({ base: `/slides/${i}`, holder: s })),
    ...(doc.layouts ?? []).map((s, i) => ({ base: `/layouts/${i}`, holder: s })),
  ]
  const before = new Map<object, Before>()
  // instances whose copy carries a sig on some member (components.ts reads the instance)
  const signed = new Set<string>()
  for (const { holder: s } of groups) for (const el of s.elements as El[]) {
    const c = el.component
    if (c && !c.main && c.sig) signed.add(`${s.id}|${(el as { groupId?: string }).groupId ?? el.id}|${(c as { id?: string }).id}`)
  }
  const snap = (h: Holder, path: string, s: Slide) => {
    const b: Before = { path, drift: [] }
    for (const [p, ref] of Object.entries(h.themeRefs ?? {})) {
      const name = tokenName(ref)
      const d = name ? tokenDrift(doc, h, p, name) : null
      if (name && d) b.drift.push({ path: p, name, ...d })
    }
    if (h !== (s as unknown as Holder)) {
      const el = h as unknown as El
      const c = el.component
      if (c && !c.main) {
        b.over = new Set(c.over ?? [])
        b.unsigned = !signed.has(`${s.id}|${(el as { groupId?: string }).groupId ?? el.id}|${(c as { id?: string }).id}`)
      }
      if (el.parentId !== undefined) b.parentId = el.parentId
      b.x = el.x
      b.y = el.y
    }
    before.set(h, b)
  }
  for (const { base, holder: s } of groups) {
    snap(s as unknown as Holder, base, s)
    s.elements.forEach((el, j) => snap(el as unknown as Holder, `${base}/elements/${j}`, s))
  }
  // the frame a dangling parentId named, judged on the document as written
  const why = new Map<object, string>()
  for (const { holder: s } of groups) {
    const byId = new Map(s.elements.map((e) => [e.id, e]))
    for (const el of s.elements) {
      if (el.parentId === undefined) continue
      const p = byId.get(el.parentId)
      why.set(el, !p ? 'no element on this slide has that id'
        : !isFrame(p) ? 'that element is not a rect with layout'
        : 'the frames it names lead back to this element')
    }
  }

  derive(doc, deriveMemory(doc))

  const out: Dropped[] = []
  for (const { holder: s } of groups) {
    for (const h of [s as unknown as Holder, ...(s.elements as unknown as Holder[])]) {
      const b = before.get(h)
      if (!b) continue
      for (const d of b.drift) {
        if (h.themeRefs?.[d.path]) continue
        out.push({ path: `${b.path}/themeRefs/${d.path}`,
          reason: `binding dropped: value ${show(d.have)} differs from token "${d.name}" (${show(d.want)}). Write the token's value, or omit the literal and it is filled from the token` })
      }
      if (h === (s as unknown as Holder)) continue
      const el = h as unknown as El
      if (b.over && b.unsigned) {
        for (const k of el.component?.over ?? []) {
          if (b.over.has(k)) continue
          out.push({ path: `${b.path}/${k}`,
            reason: `override added: "${k}" differs from the main and this copy has no sig, so it stays the copy's own and no longer follows the main. Write component.sig "reset" on the copy to follow the main, or leave it if the difference is meant` })
        }
      }
      if (b.parentId !== undefined && el.parentId === undefined) {
        out.push({ path: `${b.path}/parentId`,
          reason: `parent removed: "${b.parentId}" is not a frame on this slide (${why.get(el) ?? 'unknown'}), so parentId and sizing were dropped and the element stays where it is written. Name a frame on this slide, or leave parentId out` })
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
      out.push({ path: before.get(f)!.path,
        reason: `children reordered: frame "${f.id}" lays out its children by each one's ${axis}, not by array order: ${names}. To keep array order, write the children at the same ${same} (the frame's own is fine)` })
    })
  }
  return out
}
