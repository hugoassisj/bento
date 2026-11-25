// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Validator findings for what opening a deck changes silently (validate.ts
// calls bindingChecks). The derive pass (derive.ts) runs on every open and
// settles three things an author may have written differently:
//
//   token-stale              a token-bound literal that differs from its token
//                            loses the binding (tokens.ts: with the tokens
//                            unmoved, a disagreement is a hand edit) — info,
//                            beside the palette's theme-ref-stale; slides,
//                            their elements and the deck's own layouts;
//   component-copy-unsynced  a component copy with no `sig` keeps every
//                            difference from its main as a permanent override
//                            (components.ts) — warning;
//   dangling-parent          a `parentId` naming nothing, a non-frame or the
//                            element itself is removed with `sizing`
//                            (layout.ts layoutSlide) — warning.
//
// Each message ends in one instruction, aimed at the property's owner the way
// the load report's is (derivelosses.ts): a frame child's position, or a size
// its frame fills, is the frame's, so the instruction is to remove the
// reference; a copy's property it takes from its main is fixed on the main.
//
// MERGING WITH F-08 (the value-checks branch), which reports `dangling-parent`
// in validate.ts with the same code, severity and path: delete the
// dangling-parent block below and the isFrame import with it; in F-08's block
// skip an empty parentId (`if (el.parentId)` in place of
// `if (el.parentId !== undefined)`: layout ignores ""), and append this block's
// instruction to F-08's message: ` Name a frame on this slide in "parentId",
// or remove "parentId".` scripts/test-validate.ts fails while both report it.
//
// loadDoc's report lists these as they happen (derivelosses.ts); these
// findings are for a file written straight to disk, where no report exists.
// On a deck that has been opened they are silent: the pass already settled
// them. The comparisons are the derive pass's own (tokens.ts tokenDrift, and
// syncComponents run on a copy of the component elements), so the validator
// and the pass cannot disagree. Read-only, like the rest of validate().

import type { BentoDoc, Slide, SlideElement } from './model.ts'
import type { Finding } from './validate.ts'
import { _readPath } from './palette.ts'
import { tokenDrift, tokenName, tokenValue } from './tokens.ts'
import { syncComponents } from './components.ts'
import { isFrame } from './layout.ts'

type El = SlideElement & { groupId?: string; sizing?: Record<string, unknown>; component?: { id: string; key?: string; main?: boolean; sig?: string; over?: string[] } }
type Holder = Record<string, unknown> & { themeRefs?: Record<string, string> }

const show = (v: unknown) => JSON.stringify(v)
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : show(a) === show(b)

export function bindingChecks(doc: BentoDoc, add: (f: Finding) => void): void {
  // ---- token-stale --------------------------------------------------------
  const mains = new Map<string, El>()
  for (const s of doc.slides) for (const e of s.elements as El[]) if (e.component?.main) mains.set(`${e.component.id}|${e.component.key}`, e)
  const lists: Array<{ kind: 'slide' | 'layout'; list: Slide[] }> = [{ kind: 'slide', list: doc.slides }, { kind: 'layout', list: doc.layouts ?? [] }]
  for (const { kind, list } of lists) for (const s of list) {
    const byId = new Map(s.elements.map((e) => [e.id, e]))
    for (const h of [s as unknown as Holder, ...(s.elements as unknown as Holder[])]) {
      const isSlide = h === (s as unknown as Holder)
      const el = h as unknown as El
      for (const [path, ref] of Object.entries(h.themeRefs ?? {})) {
        const name = tokenName(ref)
        if (!name) continue
        const d = tokenDrift(doc, h, path, name)
        if (!d) continue // agrees, or the token has no value (token-unknown says so)
        const raw = tokenValue(doc, name)
        const holds = same(d.want, raw) ? `its token "${name}" holds ${show(raw)}` : `its token "${name}" holds ${show(raw)} (${show(d.want)} at this colour's own opacity)`
        const head = d.have === undefined
          ? `There is no value at "${path}" for ${holds.replace(/^its /, '')}, so opening the deck drops the binding.`
          : `"${path}" is ${show(d.have)} but ${holds}, so opening the deck drops the binding and keeps ${show(d.have)}.`
        const top = path.split('.')[0]
        const frame = !isSlide && el.parentId ? byId.get(el.parentId) : undefined
        const main = !isSlide && el.component && !el.component.main ? mains.get(`${el.component.id}|${el.component.key}`) : undefined
        let fix: string
        if (isFrame(frame) && (top === 'x' || top === 'y' || ((top === 'w' || top === 'h') && el.sizing?.[top] === 'fill'))) {
          fix = `The frame "${frame.id}" sets "${top}" when the deck opens, so no token can hold it. Remove themeRefs["${path}"].`
        } else if (main && !(el.component!.over ?? []).includes(top) && same(_readPath(main as unknown as Holder, path), d.have)) {
          fix = `This copy takes "${top}" from its main "${main.id}". Write ${show(d.want)} at "${path}" on the main to keep it bound.`
        } else fix = `Write ${show(d.want)} at "${path}" to keep it bound${d.have === undefined ? '' : `, or remove themeRefs["${path}"] if ${show(d.have)} is meant`}.`
        add({ slide: s.id, ...(isSlide ? {} : { element: el.id }), code: 'token-stale', severity: 'info', path,
          message: `${kind === 'layout' ? `In layout "${s.id}": ` : ''}${head} ${fix}` })
      }
    }
  }

  // ---- component-copy-unsynced -------------------------------------------
  // the component elements alone, copied, through the pass's own sync: a copy
  // whose instance has no sig and comes out with new overrides is reported.
  // Its own token bindings, and a property it holds bound to a token, are its
  // own on purpose: not reported.
  const slides = doc.slides.map((s) => ({ ...s, elements: (s.elements as El[]).filter((e) => e.component).map((e) => structuredClone(e)) }))
  if (slides.some((s) => s.elements.some((e) => !(e as El).component!.main))) {
    const inst = (s: Slide, e: El) => `${s.id}|${e.groupId ?? e.id}|${e.component!.id}`
    const signed = new Set<string>()
    const before = new Map<El, Set<string>>()
    for (const s of slides) for (const e of s.elements as El[]) {
      if (e.component!.main) continue
      if (e.component!.sig) signed.add(inst(s, e))
      before.set(e, new Set(e.component!.over ?? []))
    }
    syncComponents({ ...doc, slides } as BentoDoc)
    for (const s of slides) for (const e of s.elements as El[]) {
      const was = before.get(e)
      if (!was || signed.has(inst(s, e))) continue
      const h = e as unknown as Holder
      const added = (e.component!.over ?? []).filter((k) => {
        if (was.has(k) || k === 'themeRefs') return false
        const own = tokenName(h.themeRefs?.[k])
        return !(own && !tokenDrift(doc, h, k, own))
      })
      if (!added.length) continue
      const main = mains.get(`${e.component!.id}|${e.component!.key}`)
      const values = added.map((k) => `${show(k)}: ${main && (main as unknown as Holder)[k] !== undefined ? show((main as unknown as Holder)[k]) : 'none (remove it)'}`).join(', ')
      add({ slide: s.id, element: e.id, code: 'component-copy-unsynced', severity: 'warning', path: 'component.sig',
        message: `This copy of component "${e.component!.id}" has no sig, so opening the deck keeps its ${added.map((k) => `"${k}"`).join(', ')} as overrides and it stops following the main there. Write the main's values on this copy (${values}) to follow it there; leave them if the difference is meant.` })
    }
  }

  // ---- dangling-parent ----------------------------------------------------
  for (const s of doc.slides) {
    const byId = new Map(s.elements.map((e) => [e.id, e]))
    for (const el of s.elements) {
      if (!el.parentId) continue // "" is no link: the gate keeps it, layout ignores it
      const p = byId.get(el.parentId)
      const why = el.parentId === el.id ? 'names the element itself'
        : !p ? `names "${el.parentId}", which is not an element on this slide`
        : !isFrame(p) ? `names "${el.parentId}", which is not a frame (a rect with layout)`
        : ''
      if (!why) continue
      add({ slide: s.id, element: el.id, code: 'dangling-parent', severity: 'warning', path: 'parentId',
        message: `parentId ${why}, so opening the deck removes it (and sizing) and the element stays where it is written. Name a frame on this slide in "parentId", or remove "parentId".` })
    }
  }
}
