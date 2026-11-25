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
//                            beside the palette's theme-ref-stale;
//   component-copy-unsynced  a component copy with no `sig` keeps every
//                            difference from its main as a permanent override
//                            (components.ts) — warning;
//   dangling-parent          a `parentId` naming nothing, a non-frame or the
//                            element itself is removed with `sizing`
//                            (layout.ts layoutSlide) — warning.
//
// dangling-parent is the code, severity, path and set of conditions the
// value-checks branch (F-08) gives the same check (it also flags an empty
// parentId, which layout ignores and this skips), so the two merge to ONE:
// whichever lands second deletes its own block (keeping this message's last
// sentence, the instruction), and scripts/test-validate.ts fails while both
// report it.
//
// loadDoc's report lists these as they happen (derivelosses.ts); these
// findings are for a file written straight to disk, where no report exists.
// On a deck that has been opened they are silent: the pass already settled
// them. The comparisons are the derive pass's own (tokens.ts tokenDrift, and
// syncComponents run on a copy of the component elements), so the validator
// and the pass cannot disagree. Read-only, like the rest of validate().

import type { BentoDoc, Slide, SlideElement } from './model.ts'
import type { Finding } from './validate.ts'
import { eachRef } from './palette.ts'
import { tokenDrift, tokenName } from './tokens.ts'
import { syncComponents } from './components.ts'

type El = SlideElement & { groupId?: string; component?: { id: string; main?: boolean; sig?: string; over?: string[] } }
type Holder = Record<string, unknown> & { themeRefs?: Record<string, string> }

import { isFrame } from './layout.ts'

const show = (v: unknown) => JSON.stringify(v)

export function bindingChecks(doc: BentoDoc, add: (f: Finding) => void): void {
  // ---- token-stale --------------------------------------------------------
  eachRef(doc, ({ slide, element, path, token }) => {
    const name = tokenName(token)
    if (!name) return
    const d = tokenDrift(doc, (element ?? slide) as unknown as Holder, path, name)
    if (!d) return // agrees, or the token has no value (token-unknown says so)
    const at = { slide: slide.id, ...(element ? { element: element.id } : {}) }
    add({ ...at, code: 'token-stale', severity: 'info', path,
      message: d.have === undefined
        ? `There is no value at "${path}" for token "${name}" (${show(d.want)}), so opening the deck drops the binding. Write ${show(d.want)} at "${path}" to keep it bound.`
        : `"${path}" is ${show(d.have)} but its token "${name}" holds ${show(d.want)}, so opening the deck drops the binding and keeps ${show(d.have)}. Write ${show(d.want)} at "${path}" to keep it bound, or remove themeRefs["${path}"] if ${show(d.have)} is meant.` })
  })

  // ---- component-copy-unsynced -------------------------------------------
  // the component elements alone, copied, through the pass's own sync: a copy
  // whose instance has no sig and comes out with new overrides is reported
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
      const added = (e.component!.over ?? []).filter((k) => !was.has(k))
      if (!added.length) continue
      add({ slide: s.id, element: e.id, code: 'component-copy-unsynced', severity: 'warning', path: 'component.sig',
        message: `This copy of component "${e.component!.id}" has no sig, so opening the deck keeps its ${added.map((k) => `"${k}"`).join(', ')} as overrides and it stops following the main there. Set component.sig to "reset" on this copy if it should follow the main.` })
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
