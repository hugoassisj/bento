// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * Build order — the slide's reveal steps as one list, in the Animate tab
 * when nothing is selected, as Keynote's Build Order and PowerPoint's
 * Animation Pane show them. The order used to exist only as numbers typed one
 * element at a time and as badges on the canvas.
 *
 * One group per press of →, in order ("Click 1", "Click 2" …), holding the
 * elements revealed on it in the order they enter; elements shown with the
 * slide are counted in a first line that does not move. A row drags between
 * groups (its own step there) or onto a group (revealed with it); Alt+↑/↓
 * moves the focused row a place, Delete shows it with the slide again. Every
 * change is one reveal.ts verb, so the steps stay 1..k, and one applySteps
 * call, so it is one undo step. Nothing new in the file: `fx.step` as
 * always, and `fx.order` (the show's stagger within a step) for Stagger.
 *
 * The panel rebuilds on every store event, so a drag keeps its state here,
 * not in the rows, and finds its drop target from the rows on screen when it
 * lands.
 */

import type { PropsPanel } from '../panels'
import type { Slide, SlideElement } from '../../model'
import { section, number } from './fields'
import { ICONS } from '../../icons'
import { t } from '../../i18n'
import { stepOf } from '../../steps'
import { stepGroups, moveStep, joinStep, removeStep, staggered, hasSteps, type StepPatch } from '../reveal'
import { applySteps } from './animate'
import { labelIn } from '../layerrows'
import { GLYPH } from '../layers'
import { endPreview, peekElement } from '../fxpreview'
import { lsJson, lsSet } from '../../../../kernel/src/storage.ts'

type Enter = NonNullable<NonNullable<SlideElement['fx']>['enter']>
/** The entrances, named as the single element's Entrance and Direction rows name them. */
const ENTERS: Array<[Enter | 'none', string]> = [
  ['none', 'None'], ['fade', 'Fade'], ['fade-up', 'Fade up'], ['fade-down', 'Fade down'],
  ['slide-left', 'Fly in from right'], ['slide-right', 'Fly in from left'], ['slide-up', 'Fly in from below'], ['slide-down', 'Fly in from above'],
]

/** A compact entrance picker; 'mixed' (a selection that disagrees) shows Mixed until a choice is made. */
export function enterPicker(value: Enter | undefined | 'mixed', onPick: (v: Enter | undefined) => void): HTMLSelectElement {
  const sel = document.createElement('select')
  const add = (v: string, label: string) => {
    const o = document.createElement('option')
    o.value = v
    o.textContent = label
    sel.appendChild(o)
    return o
  }
  if (value === 'mixed') add('', t('Mixed')).disabled = true
  for (const [v, label] of ENTERS) add(v, t(label))
  sel.value = value === 'mixed' ? '' : value ?? 'none'
  sel.setAttribute('aria-label', t('Entrance'))
  sel.addEventListener('change', () => onPick(sel.value === 'none' ? undefined : sel.value as Enter))
  return sel
}

/** Give every element in `ids` the entrance, in one undo step. None also
 *  drops a duration set for the old one, as the Entrance row does. */
export function setEnter(p: PropsPanel, ids: string[], v: Enter | undefined) {
  endPreview()
  p.edit(() => {
    for (const id of ids) {
      const el = p.store.element(id)
      if (!el) continue
      const fx = { ...(el.fx ?? {}) }
      if (v) fx.enter = v
      else { delete fx.enter; delete fx.enterDur }
      if (!fx.enter && !fx.countUp && !fx.ambient && !fx.loop && !fx.step && !fx.typeWriter) delete el.fx
      else el.fx = fx
    }
  }, true)
}

/** "Show build order": nothing selected, the section open, its first row focused. */
export function showBuildOrder(p: PropsPanel) {
  const open = lsJson<Record<string, boolean>>('bento-panel-open', {})
  open[t('Build order')] = true
  lsSet('bento-panel-open', JSON.stringify(open))
  p.store.select([])
  const first = p.host.querySelector<HTMLElement>('.ed-build-row')
  first?.focus({ preventScroll: true })
  first?.scrollIntoView({ block: 'nearest' })
}

/** The Build order section of the slide panel; nothing when no element has a step. */
export function buildBuildOrder(p: PropsPanel) {
  const slide = p.store.slide
  if (!hasSteps(slide.elements)) return
  section(p, t('Build order'))
  const list = document.createElement('div')
  list.className = 'ed-build'
  list.setAttribute('role', 'list')
  list.setAttribute('aria-label', t('Build order'))
  const still = slide.elements.filter((e) => !stepOf(e)).length
  if (still) {
    const line = document.createElement('div')
    line.className = 'ed-build-still'
    line.textContent = t('With the slide ({n})', { n: still })
    list.appendChild(line)
  }
  const byId = new Map(slide.elements.map((e) => [e.id, e]))
  const groups = stepGroups(slide.elements)
  // Stagger has a column of its own whenever a step is shared, so every
  // row's entrance picker stays in one column down the list
  const beat = groups.some((g) => g.length > 1)
  list.classList.toggle('ed-build-beats', beat)
  groups.forEach((ids, k) => {
    // the press it comes on: a hand-written 2, 5, 9 is pressed 1, 2, 3
    const name = t('Click {n}', { n: k + 1 })
    const group = document.createElement('div')
    group.className = 'ed-build-group'
    group.setAttribute('role', 'listitem')
    group.setAttribute('aria-label', name)
    group.dataset.index = String(k)
    group.dataset.step = String(stepOf(byId.get(ids[0])!))
    const head = document.createElement('div')
    head.className = 'ed-build-head'
    head.setAttribute('aria-hidden', 'true')
    const title = document.createElement('span')
    title.textContent = name
    head.appendChild(title)
    if (ids.length > 1) {
      // the Stagger fields' visible caption, over their column
      const cap = document.createElement('span')
      cap.className = 'ed-build-beat-cap'
      cap.textContent = t('Stagger')
      head.appendChild(cap)
    }
    const rows = document.createElement('div')
    rows.setAttribute('role', 'list')
    const members = staggered(ids.map((id) => byId.get(id)!))
    for (const { el, at } of members) rows.appendChild(buildRow(p, slide, el, members.length > 1 ? at : null, beat))
    group.append(head, rows)
    list.appendChild(group)
  })
  p.host.appendChild(list)
}

function buildRow(p: PropsPanel, slide: Slide, el: SlideElement, stagger: number | null, beatColumn: boolean): HTMLElement {
  const row = document.createElement('div')
  row.className = 'ed-build-row'
  row.dataset.id = el.id
  row.tabIndex = 0
  row.setAttribute('role', 'listitem')
  const label = labelIn(slide, el, t)
  row.setAttribute('aria-label', label)
  row.title = label
  const glyph = document.createElement('span')
  glyph.className = 'ed-layer-glyph'
  glyph.innerHTML = GLYPH[el.type] ?? ''
  const name = document.createElement('span')
  name.className = 'ed-layer-label'
  name.textContent = label
  row.append(glyph, name, enterPicker(el.fx?.enter, (v) => setEnter(p, [el.id], v)))
  if (stagger !== null) {
    // the beat it enters on within its step (present.ts runEnterFx); equal beats enter together
    const beat = number(stagger, 1, (v, fin) => {
      if (fin) p.mutate(el.id, (e) => { e.fx = { ...(e.fx ?? {}), order: Math.max(0, Math.floor(v)) } }, true)
    }, { min: 0 })
    beat.title = t('Stagger')
    beat.setAttribute('aria-label', t('Stagger'))
    row.appendChild(beat)
  } else if (beatColumn) row.appendChild(document.createElement('span')) // the column, empty
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'ed-btn ed-btn-icon ed-build-remove'
  remove.innerHTML = ICONS.minus
  remove.title = t('Show with the slide again')
  remove.setAttribute('aria-label', t('Remove'))
  remove.addEventListener('click', () => applySteps(p, removeStep(p.store.slide.elements, el.id)))
  row.appendChild(remove)

  // pointing at a row, or focusing it, outlines its element on the canvas
  const peek = () => { if (!drag) peekElement(el.id) }
  row.addEventListener('pointerenter', peek)
  row.addEventListener('focus', peek)
  row.addEventListener('pointerleave', endPreview)
  row.addEventListener('blur', endPreview)
  row.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || (ev.target as Element).closest('select, input, button')) return
    startDrag(p, el.id, ev)
  })
  row.addEventListener('keydown', (ev) => {
    if (ev.target !== row) return // the picker's and the field's keys are theirs
    if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      ev.preventDefault(); ev.stopPropagation()
      nudge(p, el.id, ev.key === 'ArrowUp' ? -1 : 1)
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault(); ev.stopPropagation()
      const rows = [...p.host.querySelectorAll<HTMLElement>('.ed-build-row')]
      const i = rows.indexOf(row)
      const next = (rows[i + 1] ?? rows[i - 1])?.dataset.id
      applySteps(p, removeStep(p.store.slide.elements, el.id))
      if (next) focusRow(p, next)
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault(); ev.stopPropagation()
      p.store.select([el.id])
    } else if (ev.key.startsWith('Arrow')) ev.stopPropagation() // not a slide walk from inside the list
  })
  return row
}

const focusRow = (p: PropsPanel, id: string) =>
  p.host.querySelector<HTMLElement>(`.ed-build-row[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })

/** Alt+↑/↓: one place earlier or later. Alone on its step it trades places
 *  with the group beside it; sharing a step it takes a step of its own just
 *  before or after the group. At either end nothing changes. */
function nudge(p: PropsPanel, id: string, dir: 1 | -1) {
  const els = p.store.slide.elements
  const groups = stepGroups(els)
  const i = groups.findIndex((g) => g.includes(id))
  if (i < 0) return
  const to = dir > 0 ? i + 1 : groups[i].length === 1 ? i - 1 : i
  if (to < 0) return
  applySteps(p, moveStep(els, id, to))
  focusRow(p, id)
}

type Drop = { group: HTMLElement; index: number; step: number; where: 'before' | 'after' | 'into' }

/** The drag in progress, kept off the rows: a rebuild replaces every row. */
let drag: { id: string; x: number; y: number; on: boolean; left: boolean } | null = null

/** How long a finger rests on a row before it picks the row up. Until then a
 *  touch is the panel's: a swipe scrolls it (rows are touch-action: pan-y). */
const HOLD_MS = 350

/**
 * A mouse or pen drags a row once it moves 4px. A finger must rest on the row
 * first (HOLD_MS, moving less than 8px); moving sooner is a scroll, and the
 * drag stands down. Escape ends a drag without dropping, and so does a move
 * that arrives with no button held (the button came up outside the window).
 * Only a release after the pointer has left the row it picked up can drop:
 * a long press let go in place, or a wobble inside the row, changes nothing.
 */
function startDrag(p: PropsPanel, id: string, ev: PointerEvent) {
  const touch = ev.pointerType === 'touch'
  const pid = ev.pointerId
  drag = { id, x: ev.clientX, y: ev.clientY, on: false, left: false }
  const lift = () => {
    if (!drag) return
    drag.on = true
    endPreview()
    mark(p, dropAt(p, drag.y, drag.x)) // the row shows it is picked up; still over itself, no target yet
  }
  const hold = touch ? setTimeout(lift, HOLD_MS) : 0
  const done = () => {
    clearTimeout(hold)
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', cancel)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('touchmove', still)
    window.removeEventListener('contextmenu', still, true)
    const d = drag
    drag = null
    mark(p, null) // with no drag, this only clears
    return d
  }
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== pid) return
    if (!touch && e.buttons === 0) { done(); return } // released outside the window: no drop
    if (!drag.on) {
      const far = Math.hypot(e.clientX - drag.x, e.clientY - drag.y)
      if (touch) { if (far >= 8) done(); return } // a swipe before the hold: the panel scrolls
      if (far < 4) return
      lift()
    }
    e.preventDefault()
    if (!drag.left) {
      const r = p.host.querySelector(`.ed-build-row[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
      drag.left = !r || e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom
    }
    mark(p, dropAt(p, e.clientY, e.clientX))
  }
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pid) return
    const target = dropAt(p, e.clientY, e.clientX)
    const d = done()
    if (!d) return
    if (!d.on) { p.store.select([id]); return } // a click or a tap: select the element
    if (target && d.left) applySteps(p, dropPatches(p.store.slide.elements, id, target))
  }
  const cancel = (e: PointerEvent) => { if (e.pointerId === pid) done() }
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault(); e.stopPropagation()
    done() // the release that follows finds no drag: nothing drops
  }
  // a finger that has picked a row up moves it, not the panel, and its long
  // press opens no menu
  const still = (e: Event) => { if (drag?.on) e.preventDefault() }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', cancel)
  window.addEventListener('keydown', key, true)
  if (touch) {
    window.addEventListener('touchmove', still, { passive: false })
    window.addEventListener('contextmenu', still, true)
  }
}

/** Where a drag at (x, y) would land, read off the groups on screen: onto a
 *  group in its middle, before or after it near its top or bottom edge; above
 *  the first group is before it, below the last after it. */
function dropAt(p: PropsPanel, y: number, x: number): Drop | null {
  const list = p.host.querySelector<HTMLElement>('.ed-build')
  if (!list) return null
  const lb = list.getBoundingClientRect()
  if (x < lb.left - 24 || x > lb.right + 24 || y < lb.top - 24 || y > lb.bottom + 24) return null
  const groups = [...list.querySelectorAll<HTMLElement>('.ed-build-group')]
  for (const [k, group] of groups.entries()) {
    const b = group.getBoundingClientRect()
    if (y > b.bottom && k < groups.length - 1) continue
    const edge = Math.min(10, b.height / 4)
    const where = y < b.top + edge ? 'before' : y > b.bottom - edge ? 'after' : 'into'
    return { group, index: Number(group.dataset.index), step: Number(group.dataset.step), where }
  }
  return null
}

/** Show the drag: the row picked up, and a target only where a release would
 *  change something (never while the pointer is still over its own row). */
function mark(p: PropsPanel, d: Drop | null) {
  for (const n of p.host.querySelectorAll('.ed-build .drop-before, .ed-build .drop-after, .ed-build .drop-into, .ed-build .dragging')) n.classList.remove('drop-before', 'drop-after', 'drop-into', 'dragging')
  if (!drag?.on) return
  p.host.querySelector(`.ed-build-row[data-id="${CSS.escape(drag.id)}"]`)?.classList.add('dragging')
  if (d && drag.left && dropPatches(p.store.slide.elements, drag.id, d).length) d.group.classList.add(`drop-${d.where}`)
}

/** A drop as reveal.ts verbs: onto a group joins its step; before or after
 *  it is a step of its own there, counted among the groups the row leaves.
 *  A drop that leaves the groups as they were writes nothing — not even the
 *  renumbering of a slide whose steps skip (2, 5, 9), which nobody asked for. */
function dropPatches(els: SlideElement[], id: string, d: Drop): StepPatch[] {
  let patches: StepPatch[]
  if (d.where === 'into') patches = joinStep(els, id, d.step)
  else {
    const others = stepGroups(els)[d.index]?.filter((x) => x !== id) ?? []
    if (!others.length) return [] // its own group, alone: it is already there
    const remaining = stepGroups(els).map((g) => g.filter((x) => x !== id)).filter((g) => g.length)
    const at = remaining.findIndex((g) => g[0] === others[0])
    patches = moveStep(els, id, d.where === 'before' ? at : at + 1)
  }
  const step = new Map(patches.map((q) => [q.id, q.step]))
  const after = els.map((e) => (step.has(e.id) ? { id: e.id, fx: { step: step.get(e.id) } } : e))
  const same = (g: string[][]) => g.map((ids) => ids.join('+')).join('|')
  return same(stepGroups(after)) === same(stepGroups(els)) ? [] : patches
}
