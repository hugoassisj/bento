// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * What a present-only file (Share ▸ Present-only file…) carries.
 *
 * The file is a hand-out: the deck in player mode, no editor, no live session.
 * The document format is readable by design, so whatever goes into the file can
 * be read by whoever receives it — in a text editor, or with S in the show. Three
 * things in a deck are the author's rather than the audience's: speaker notes,
 * review comments and hidden slides. Each is left out unless the author ticks it
 * in the save dialog; a presenter who shows from the sealed file on a borrowed
 * machine keeps the notes for the speaker view.
 *
 * Notes and comments go through the audience projection's slide-level strip
 * (audience.ts `withoutSlideKeys`, keys taken from AUDIENCE_HIDDEN), so the two
 * hand-outs cannot disagree about which fields those are. Hidden slides go with
 * every interactive state that hangs off them, and every element link that
 * pointed at a removed slide is cleared so no click in the show is dead.
 *
 * Node-importable (type-only model import): scripts/test-export-secrets.ts runs it.
 */
import type { BentoDoc, Slide } from './model'
import { AUDIENCE_HIDDEN, withoutSlideKeys } from './audience.ts'

/** What the author chose to include. Everything false is the default. */
export type PresentOnlyChoices = { notes: boolean; comments: boolean; hidden: boolean }

export const PRESENT_ONLY_DEFAULTS: PresentOnlyChoices = { notes: false, comments: false, hidden: false }

/** How much of each private kind the deck holds. */
export type PrivateCounts = { notes: number; comments: number; hidden: number }

/** Slides with notes, comment threads, hidden slides. All zero means there is
 *  nothing to ask about. */
export function privateContent(doc: BentoDoc): PrivateCounts {
  let notes = 0, comments = 0, hidden = 0
  for (const s of doc.slides) {
    if (typeof s.notes === 'string' && s.notes.trim()) notes++
    if (Array.isArray(s.comments)) comments += s.comments.length
    if (s.hidden) hidden++
  }
  return { notes, comments, hidden }
}

/** Ids of the hidden slides and of every state that hangs off one (states of
 *  states included). */
function hiddenClosure(slides: Slide[]): Set<string> {
  const out = new Set(slides.filter((s) => s.hidden).map((s) => s.id))
  for (let grew = true; grew;) {
    grew = false
    for (const s of slides) {
      if (s.stateOf && out.has(s.stateOf) && !out.has(s.id)) { out.add(s.id); grew = true }
    }
  }
  return out
}

/**
 * The present-only document, built from the author's choices. Deep-copies; the
 * open deck is untouched. The caller still sets `readonly` and strips the live
 * session (stripCollabSecrets) — this function decides content only.
 *
 * A deck whose every slide in the walk is hidden keeps its hidden slides: a
 * file with nothing to show is not a hand-out.
 */
export function presentOnlyDoc(doc: BentoDoc, keep: PresentOnlyChoices): BentoDoc {
  const copy: BentoDoc = JSON.parse(JSON.stringify(doc))
  const drop = AUDIENCE_HIDDEN.filter((k) => !(k === 'notes' && keep.notes) && !(k === 'comments' && keep.comments))
  if (!keep.hidden) {
    const removed = hiddenClosure(copy.slides)
    const rest = copy.slides.filter((s) => !removed.has(s.id))
    if (removed.size && rest.some((s) => !s.stateOf)) {
      copy.slides = rest
      for (const s of [...copy.slides, ...(copy.layouts ?? [])]) {
        for (const el of s.elements ?? []) if (el.link && removed.has(el.link)) delete el.link
      }
    }
  }
  if (drop.length) {
    copy.slides = copy.slides.map((s) => withoutSlideKeys(s, drop))
    if (copy.layouts) copy.layouts = copy.layouts.map((s) => withoutSlideKeys(s, drop))
  }
  return copy
}

/** What the built file actually kept, for the message after saving: the
 *  author's choices, except that hidden slides count as kept when the
 *  all-hidden rule above left them in. */
export function keptInFile(out: BentoDoc, keep: PresentOnlyChoices): PresentOnlyChoices {
  return { ...keep, hidden: keep.hidden || out.slides.some((s) => s.hidden) }
}
