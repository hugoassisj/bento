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
import type { Slide, SlideElement } from '../model'

/** The elements on `slide` whose hover group is `set`. */
export function triggersOf(slide: Slide, set: string, skip?: string): SlideElement[] {
  return slide.elements.filter((e) => e.group === set && e.id !== skip)
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

/** Nothing on the slide carries the group `set`, and it is not the resting
 *  set — true whatever the slide's hover is. */
export function isOrphan(slide: Slide, set: string): boolean {
  return set !== slide.hover?.default && !triggersOf(slide, set).length
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
