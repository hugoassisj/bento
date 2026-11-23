// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * Reveal authoring — the decisions behind "Reveal in order", "Reveal
 * together", "Remove reveal" and the canvas step badges. Editor UI only: the
 * format keeps a single number, `fx.step` (steps.ts says what it means while
 * presenting). Nothing here touches the DOM, so scripts/test-slides-reveal-ui.ts
 * drives it without one.
 *
 * READING ORDER. "Reveal in order" numbers a selection the way a reader would
 * scan it: top-to-bottom, then left-to-right within a row. Rows are found by
 * vertical overlap, not by a pixel band — an element joins the row that is
 * open when its vertical centre falls inside the row's extent, so a bullet
 * list numbers down the page while a row of three cards numbers across, and
 * a card that is a few pixels taller than its neighbours is still their
 * neighbour. Ties break by x, then id, so the order is a pure function of the
 * elements and two runs give the same numbers.
 */

import { stepOf, maxStep, stepsOf, type Stepped } from '../steps.ts'

export type Placed = Stepped & { x: number; y: number; w: number; h: number }

/** The selection sorted as a reader scans it. */
export function readingOrder<E extends Placed>(els: ReadonlyArray<E>): E[] {
  const byY = [...els].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const rows: { top: number; bottom: number; items: E[] }[] = []
  for (const el of byY) {
    const cy = el.y + el.h / 2
    const row = rows[rows.length - 1]
    if (row && cy >= row.top && cy <= row.bottom) {
      row.items.push(el)
      row.bottom = Math.max(row.bottom, el.y + el.h)
    } else rows.push({ top: el.y, bottom: el.y + el.h, items: [el] })
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id)))
}

/** One `fx.step` assignment; `step` 0 clears it. */
export type StepPatch = { id: string; step: number }

/**
 * "Reveal in order": the selection gets consecutive steps in reading order,
 * starting AFTER the slide's last step among elements outside the selection —
 * so ordering a second batch continues the sequence rather than restarting it,
 * and re-ordering the same batch renumbers it from the same start.
 */
export function revealInOrder(slide: ReadonlyArray<Placed>, selected: ReadonlyArray<Placed>): StepPatch[] {
  const chosen = new Set(selected.map((e) => e.id))
  const base = maxStep(slide.filter((e) => !chosen.has(e.id)))
  return readingOrder(selected).map((el, i) => ({ id: el.id, step: base + 1 + i }))
}

/** "Reveal together": the whole selection on ONE step — the next one after
 *  the rest of the slide, so it lands as a group at the end of the sequence. */
export function revealTogether(slide: ReadonlyArray<Placed>, selected: ReadonlyArray<Placed>): StepPatch[] {
  const chosen = new Set(selected.map((e) => e.id))
  const step = maxStep(slide.filter((e) => !chosen.has(e.id))) + 1
  return selected.map((el) => ({ id: el.id, step }))
}

/** "Remove reveal": the selection is shown with the slide again. */
export const removeReveal = (selected: ReadonlyArray<Stepped>): StepPatch[] =>
  selected.filter((el) => stepOf(el) > 0).map((el) => ({ id: el.id, step: 0 }))

/**
 * A click on a step badge moves its element one place LATER in the build
 * (`dir` -1, Shift-click: one place earlier). It never lands on a step another
 * element holds — a click that made two things appear on one press, and left
 * a hole later on, read as a broken build:
 *  - alone on its step, the element swaps places with the step after it (one
 *    element, or a whole "together" group, which stays together); from the
 *    last place it goes back to the first and everything else moves one later,
 *    so k clicks on a k-step slide give back the order it started with;
 *  - sharing its step, it leaves the group for a step of its own right after
 *    it (before it, going earlier), and the steps after move up by one.
 * The slide comes out numbered 1..k with no gaps (gaps never meant anything
 * while presenting: they are pressed through in one go), and only elements
 * whose number changes get a patch. Never to 0, never from 0 — adding and
 * removing are verbs, not a click too many. Sharing a step stays a choice:
 * Reveal ▸ Together, or typing the number.
 */
export function advanceStep(slide: ReadonlyArray<Stepped>, el: Stepped, dir: 1 | -1 = 1): StepPatch[] {
  const cur = stepOf(el)
  if (!cur) return []
  const order = stepsOf(slide)
  const groups = order.map((s) => slide.filter((e) => stepOf(e) === s).map((e) => e.id))
  const i = order.indexOf(cur)
  if (i < 0) return []
  if (groups[i].length > 1) {
    groups[i] = groups[i].filter((id) => id !== el.id)
    groups.splice(dir > 0 ? i + 1 : i, 0, [el.id])
  } else if (dir > 0) {
    if (i < groups.length - 1) [groups[i], groups[i + 1]] = [groups[i + 1], groups[i]]
    else groups.unshift(groups.pop()!)
  } else if (i > 0) [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]
  else groups.push(groups.shift()!)
  const next = new Map(groups.flatMap((ids, k) => ids.map((id) => [id, k + 1] as const)))
  return slide.filter((e) => next.has(e.id) && next.get(e.id) !== stepOf(e)).map((e) => ({ id: e.id, step: next.get(e.id)! }))
}

/** Does the canvas show badges for this slide? Only when there is a step to
 *  show — a fresh slide carries no chrome for a feature it does not use. */
export const hasSteps = (slide: ReadonlyArray<Stepped>): boolean => maxStep(slide) > 0
