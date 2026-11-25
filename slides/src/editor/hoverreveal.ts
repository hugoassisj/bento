// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Hover reveal, read the way the show reads it (present.ts wireHoverFocus).
//
// A reveal needs three settings that must agree: the target's `showOnHover`,
// a trigger on the SAME slide whose `group` has that value, and the slide's
// `hover` set to 'reveal'. The inspector's status line, the picker and the
// canvas "Hover set:" bar all ask these functions, so they cannot disagree
// with each other or with the show. (`group` is the hover group, not ⌘G
// grouping, which is `groupId`.)
import type { BentoDoc, Slide, SlideElement } from '../model'
import { flagged } from '../layout'

/**
 * Whether the pointer can ever be on `e` in the show: it is drawn (not hidden,
 * nor inside a hidden frame) and drawn at rest — an element that itself waits
 * on a hover set other than the resting one is invisible and takes no pointer
 * (present.ts applyRevealSet), so it can reveal nothing.
 */
export function reachable(slide: Slide, e: SlideElement, hidden = flagged(slide, 'hidden')): boolean {
  return !hidden.has(e.id) && (!e.showOnHover || e.showOnHover === slide.hover?.default)
}

/** The elements on `slide`, other than `skip`, whose hover group is `set` and
 *  that the pointer can reach — what can reveal `skip`. */
export function triggersOf(slide: Slide, set: string, skip?: string): SlideElement[] {
  const hidden = flagged(slide, 'hidden')
  return slide.elements.filter((e) => e.group === set && e.id !== skip && reachable(slide, e, hidden))
}

/** …and those carrying the group that the pointer can never reach. */
export function unreachableTriggersOf(slide: Slide, set: string, skip?: string): SlideElement[] {
  const hidden = flagged(slide, 'hidden')
  return slide.elements.filter((e) => e.group === set && e.id !== skip && !reachable(slide, e, hidden))
}

/**
 * Why the set `set` cannot show in the show, or null when it can:
 * - 'off'    the slide has no hover, so the set is always visible
 * - 'dim'    the slide's hover dims other groups, so the set is always visible
 * - 'orphan' nothing on the slide carries that group (and it is not the
 *            resting set), so nothing can reveal it
 */
export function hoverIssue(slide: Slide, set: string): 'off' | 'dim' | 'orphan' | null {
  if (!slide.hover) return 'off'
  if (slide.hover.type !== 'reveal') return 'dim'
  if (isOrphan(slide, set)) return 'orphan'
  return null
}

/** Some element waiting on `set` has nothing it can be revealed by — no
 *  other element the pointer can reach carries that group — and `set` is not
 *  the resting set. Decided per member, as the inspector does: an element is
 *  never its own trigger (hidden, it cannot be pointed at). True whatever the
 *  slide's hover is. */
export function isOrphan(slide: Slide, set: string): boolean {
  if (set === slide.hover?.default) return false
  return slide.elements.some((m) => m.showOnHover === set && !triggersOf(slide, set, m.id).length)
}

/** Turn the slide's hover to Switch content, keeping what else it carries. */
export function useReveal(slide: Slide) {
  slide.hover = { ...(slide.hover ?? {}), type: 'reveal' }
}

/**
 * A readable hover group for a trigger that has none: its Layers name, made
 * unique on the slide. Names other triggers carry are taken (two triggers
 * would merge), and so are sets other elements wait on — except the set
 * `target` is in now, so picking a trigger for a hand-typed set completes it
 * for everything waiting on the same name.
 */
export function newGroupName(slide: Slide, trigger: SlideElement, target: SlideElement, label: string): string {
  const taken = new Set<string>()
  for (const e of slide.elements) {
    if (e.id !== trigger.id && e.group) taken.add(e.group)
    if (e.id !== target.id && e.showOnHover && e.showOnHover !== target.showOnHover) taken.add(e.showOnHover)
  }
  const base = label.trim() || 'hover'
  let name = base
  for (let i = 2; taken.has(name); i++) name = `${base} ${i}`
  return name
}

/**
 * Give `trigger` the hover group `group`, and only `trigger`. A component's
 * copies re-derive every key from their main except the ones they override
 * (components.ts), and `group` is not one a copy owns: written on a main it
 * would reach every copy across the deck, on slides where that name means
 * something else or dims what it should not. So a main's copies record
 * `group` as overridden — they keep what they had — and a copy records it for
 * itself, as an edit by hand would. One caller's commit, one undo step.
 */
export function setTriggerGroup(doc: BentoDoc, trigger: SlideElement, group: string) {
  trigger.group = group
  const c = trigger.component
  if (!c) return
  const pin = (e: SlideElement) => {
    const over = e.component!.over ?? []
    if (!over.includes('group')) e.component!.over = [...over, 'group'].sort()
  }
  if (!c.main) { pin(trigger); return }
  for (const s of doc.slides) {
    for (const e of s.elements) {
      if (e !== trigger && e.component?.id === c.id && e.component.key === c.key && !e.component.main) pin(e)
    }
  }
}
