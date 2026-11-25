// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// window.bento.patch(): a patch (ops.ts) applied to the open deck as ONE
// undoable step. The browser half of ops.ts — the real sanitizers, text
// measurement on the deck's fonts, validate() with measurement — kept out of
// main.ts so the scripting surface stays a list of one-liners.
//
// Why store.commit and not replaceDoc (which loadDoc uses): the patch is
// computed against the live document at the moment it is applied, and only
// the slides it touched are new objects — every other slide is the same
// object, untouched. So the commit is an edit like any other: the editor
// keeps its slide and selection, the derive pass keeps its memory (a token
// edited elsewhere still reads as moved, a hand edit as a hand edit), and a
// live session's diff carries only what changed, so a collaborator's edits
// to other slides, made while the agent was thinking, survive. One undo
// restores the document as it was, byte for byte (store.ts checkpoint).

import type { Store } from './store'
import { patchDoc, type PatchError, type PatchOpts, type PatchReport } from './ops'
import { deckHash } from './outline'
import { fitAutoHeights, restack } from './compactload'
import { sanitizeHtml, sanitizeSvgCss, sanitizeSvgMarkup } from './render'
import { validateDoc } from './validate'

/** The last patch this page committed: a retry of it (same ops, same base)
 *  against the deck it produced is answered as already applied, not as stale. */
let last: { base: string; ops: string; hash: string; report: PatchReport } | null = null

export function patchStore(store: Store, ops: unknown, opts: PatchOpts = {}): (PatchReport & { alreadyApplied?: true }) | PatchError {
  const o: PatchOpts = opts && typeof opts === 'object' ? opts : {}
  if (!o.dryRun && (store.readOnly || store.doc.readonly)) {
    return { ok: false, err: 'readonly', detail: 'this copy of the deck is read-only here; nothing was changed (a dry run still reports)' }
  }
  let opsKey = ''
  try { opsKey = typeof ops === 'string' ? ops : JSON.stringify(ops) } catch { /* reported by patchDoc */ }
  if (last && o.base !== undefined && o.base === last.base && opsKey === last.ops && deckHash(store.doc) === last.hash) {
    return { ...last.report, committed: false, alreadyApplied: true }
  }
  const { next, report, fit } = patchDoc(store.doc, ops, o, {
    san: { html: sanitizeHtml, svg: sanitizeSvgMarkup, svgCss: sanitizeSvgCss },
    fit: (doc, stats) => { if (fitAutoHeights(doc, stats)) restack(doc, stats) },
    validate: (doc) => validateDoc(doc),
  })
  if (!next) return report
  const slides = next.slides
  store.commit(() => { store.doc.slides = slides }, 'slides')
  if (report.ok) {
    const done = { ...report, hash: deckHash(store.doc) }
    if (o.base !== undefined) last = { base: o.base, ops: opsKey, hash: done.hash, report: done }
    return done
  }
  // heights measured while a deck font was still loading: fit again once the
  // fonts settle, as loadDoc does (one more undoable step only if one moved)
  if (fit?.autoHeight.length && typeof document !== 'undefined' && document.fonts?.status === 'loading') {
    void document.fonts.ready.then(() => {
      if (store.doc.slides !== slides) return
      if (fitAutoHeights(store.doc, fit)) { restack(store.doc, fit); store.commit(() => {}) }
    })
  }
  return report
}
