// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// The gate a document kept in THIS BROWSER passes before it replaces the space
// that is open: the "Unsaved changes from a previous session" snapshot and
// every entry in History. Like slides' restoregate.ts, for the same reason.
//
// WHY IT IS A GATE AT ALL. Those snapshots are not the file. They live in
// IndexedDB under the space's docId, and on file:// every local .bento.html
// shares one origin — so the store is shared too, readable and writable by any
// other local document. A snapshot is therefore foreign input that arrives
// behind the most trusting prompt in the app ("restore YOUR changes"), and it
// used to go straight from JSON.parse into store.replaceDoc.
//
// So it is held to what an arriving file is held to, and to a little more:
//   · bounded and prototype-safe before it is parsed at all;
//   · it must name THIS space — a snapshot whose docId is not the open
//     space's is refused, whatever key it was filed under;
//   · `parseDoc` is the format, version and shape check a file open runs, and
//     a snapshot this build would open frozen (newer version, unknown policy)
//     is refused: a restore cannot open read-only, so it must not happen;
//   · every block's html goes through `sanitizeInline`, the gate importSpace
//     and the Markdown import put on arriving blocks — render sanitizes the
//     same html again, so what a reader SEES is what a file open shows;
//   · identity and capability (store.ts FROM_LIVE: docId, collab, readonly,
//     template) are the OPEN space's, never the snapshot's. That is decided by
//     ONE call — the kernel's `applyRestore` over store.ts rulesFor(direction) —
//     inside store.replaceDoc, AFTER this gate has run. `gateRestored` runs the
//     same call only to SHOW what would be installed (the recovery check
//     compares that); `restoreInto` hands the gated, not-yet-merged document
//     to replaceDoc, so nothing is merged twice.
//
// THE DIRECTION is the caller's, and each entry point below names its own:
//   · recoverInto     — the crash-recovery banner: 'recover', timed by the
//                       snapshot (history reconciled; trail unioned by day);
//   · restoreVersion  — either version timeline: 'back' (history kept live);
//   · replaceFromJson — Replace from JSON and bento.loadDoc: 'back'.
//
// What it deliberately does NOT do that slides' gate does: drop unknown keys.
// The spaces format is additive — a file open keeps every field it does not
// understand and writes it back untouched — and a restore that silently lost
// them would be the one path that broke that promise.
//
// Deliberately free of the editor, so the rig runs it in node.

import { parseDoc, docContentKey, type SpacesDoc } from './model.ts'
import { sanitizeInline } from './sanitize.ts'
import { rulesFor, restoreAt, type Store } from './store.ts'
import { applyRestore, type RestoreDirection } from '../../kernel/src/docfields.ts'

/**
 * The largest snapshot the gate will parse, in UTF-16 code units of JSON.
 * Far above any space a person writes (a 200-page handbook is ~2.5 MB) and
 * above a space carrying a dozen embedded clips, but bounded: a foreign entry
 * must not be able to make opening a space parse a gigabyte.
 */
export const MAX_RESTORE_CHARS = 128 * 1024 * 1024

export type GateRefusal = 'size' | 'json' | 'proto' | 'format' | 'frozen' | 'docId'

type Gated = { ok: true; doc: SpacesDoc } | { ok: false; why: GateRefusal }

/**
 * Gate a snapshot's JSON against the open space. Returns the document to
 * install — content from the snapshot, identity (and, by direction, history)
 * from `live`, exactly as replaceDoc would merge it — or why it was refused. A
 * refusal is never applied and never deletes the entry.
 */
export function gateRestored(
  json: unknown, live: SpacesDoc, direction: RestoreDirection, incomingAt?: number,
): Gated {
  const g = gateOnly(json, live)
  if (!g.ok) return g
  return { ok: true, doc: applyRestore(live, g.doc, direction, rulesFor(direction), restoreAt(live, incomingAt)) }
}

/** The gate itself — bounded, prototype-safe, this space's docId, parseDoc,
 *  sanitized — WITHOUT the keep-live merge, which replaceDoc does. */
function gateOnly(json: unknown, live: SpacesDoc): Gated {
  if (typeof json !== 'string' || json.length > MAX_RESTORE_CHARS) return { ok: false, why: 'size' }

  // PROTOTYPE-SAFE: a `__proto__` key anywhere refuses the whole entry. No
  // legitimate snapshot has one (every key is a format field or a minted id),
  // and refusing beats having to prove that no later spread, assign or merge
  // of this object ever treats it as the setter.
  let raw: unknown
  let proto = false
  try {
    raw = JSON.parse(json, function (k, v) { if (k === '__proto__') proto = true; return v })
  } catch { return { ok: false, why: 'json' } }
  if (proto) return { ok: false, why: 'proto' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, why: 'json' }

  // THIS space's snapshot, or nothing. Checked on the RAW docId: parseDoc
  // mints one when it is missing, and a minted id is not this space either.
  if ((raw as { docId?: unknown }).docId !== live.docId) return { ok: false, why: 'docId' }

  const res = parseDoc(json)
  if (!res.ok) return { ok: false, why: 'format' }
  if (res.frozen) return { ok: false, why: 'frozen' }

  const doc = res.doc
  for (const page of doc.pages) {
    for (const b of page.blocks) if (typeof b.html === 'string' && b.html) b.html = sanitizeInline(b.html)
  }

  return { ok: true, doc }
}

/**
 * Should the recovery banner be shown at all? Only for a snapshot that passes
 * the gate AND, compared as it would be restored ('recover', timed by the
 * snapshot), differs from what is open. A forged or junk entry therefore never
 * raises a banner — it cannot be used to keep one on screen, any more than to
 * restore through it.
 */
export function recoveryOffered(json: unknown, live: SpacesDoc, at?: number): boolean {
  const g = gateRestored(json, live, 'recover', at)
  return g.ok && docContentKey(g.doc) !== docContentKey(live)
}

/**
 * THE restore: the recovery banner's Restore and every History entry come
 * through here. Gated against the space as it is NOW — a live session may have
 * been joined, or the space duplicated under a new docId, since the entry was
 * listed — and a refusal applies nothing and deletes nothing. A read-only
 * store (a reading copy, a view-only follower, a frozen file) is never
 * rewritten from this browser's storage.
 *
 * Callers use the named entry points below, which fix the direction.
 */
export function restoreInto(store: Store, json: unknown, direction: RestoreDirection, incomingAt?: number): boolean {
  if (store.readOnly) return false
  const g = gateOnly(json, store.doc)
  if (!g.ok) return false
  // On 'recover' (RECOVER_RULES, a WHOLE snapshot) the kernel removes an
  // absent `revisions` itself (#726): the person cleared it, and cleared stays
  // cleared. Only `trail` opts out (keepLiveWhenAbsent).
  store.replaceDoc(g.doc, direction, restoreAt(store.doc, incomingAt))
  return true
}

/** The crash-recovery banner's Restore: the snapshot is a NEWER copy of this
 *  space, so 'recover' — history reconciled with it, trail unioned by day,
 *  timed by the snapshot's own `at` against the live `modified`. */
export function recoverInto(store: Store, snap: { json: unknown; at?: number }): boolean {
  return restoreInto(store, snap.json, 'recover', snap.at)
}

/** A version restore, from either timeline (this browser's, or the one inside
 *  the file): going BACK — content follows the version, history stays live. */
export function restoreVersion(store: Store, json: unknown): boolean {
  return restoreInto(store, json, 'back')
}

/**
 * Replace from JSON and `window.bento.loadDoc`: the pasted text is parsed
 * (`parseDoc` — the format, version and shape check a file open runs) and
 * applied going BACK, so it brings content and never identity, modes,
 * capability or history — a paste can neither delete this space's history
 * nor install a forged one. Not docId-gated: pasting another space's content
 * into this one is what the command is for. Returns false (applying nothing)
 * for text that is not a bento/spaces document, or on a read-only store.
 */
export function replaceFromJson(store: Store, text: string): boolean {
  if (store.readOnly) return false
  const res = parseDoc(text)
  if (!res.ok) return false
  store.replaceDoc(res.doc, 'back')
  return true
}
