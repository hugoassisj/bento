// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * The overflow badge — a small chip beside a selected text box whose text
 * needs more height than the box, or whose box runs past the slide's edge.
 * Neither shows in the numbers, and text past the edge is cropped when
 * presenting. The two tests are the validator's own (validate.ts
 * `text-overflow` and `out-of-canvas`), measured through measure.ts, so the
 * badge and validate() never disagree about a box.
 *
 * Its menu offers the two fixes: Fit height to text (the inspector's button)
 * and Shrink text to fit (the box is cut back to the part of it on the slide
 * and the font steps down until the text fits there, never below
 * SHRINK_FLOOR), each one undo step.
 *
 * EDITOR-ONLY, in the step-badge layer (stepbadges.ts) beside the rendered
 * slide; nothing here reaches render.ts. A frame child is its frame's to size,
 * so it gets no badge.
 */

import type { Store } from '../store'
import { measureElement, shrinkToFit } from '../measure'
import { isFrame } from '../layout'
import { openCtxMenu } from './ctxmenu'
import { t } from '../i18n'

/** Shrink text to fit never goes below this font size (px). */
export const SHRINK_FLOOR = 10

/** The badge for the current selection, or null when it needs none. */
export function fitBadge(store: Store, scale: number, editing: boolean): HTMLElement | null {
  const sel = store.selectedElements
  if (editing || sel.length !== 1 || sel[0].type !== 'text') return null
  const el = sel[0]
  if (el.parentId && isFrame(store.element(el.parentId))) return null
  const { width: W, height: H } = store.doc.size
  // a placeholder with no content measures as one empty line — not overflow
  const short = !!el.html?.trim() && (measureElement(el, store.doc).overflow ?? 0) > 1
  const off = el.x < 0 || el.y < 0 || el.x + el.w > W || el.y + el.h > H
  if (!short && !off) return null
  const why = short ? t('The text needs more room than its box') : t('This text box runs past the edge of the slide')
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'ed-fit-badge'
  b.textContent = '!'
  b.title = why
  b.setAttribute('aria-label', why)
  // beside the box's top-right corner, clear of its handle, held on the slide
  b.style.left = `${Math.min((el.x + el.w) * scale + 8, W * scale - 24)}px`
  b.style.top = `${Math.min(Math.max(el.y * scale - 10, 4), H * scale - 24)}px`
  b.addEventListener('mousedown', (ev) => ev.stopPropagation()) // not a marquee start
  b.addEventListener('click', (ev) => {
    ev.stopPropagation()
    const r = b.getBoundingClientRect()
    openCtxMenu(r.left, r.bottom + 4, [
      { label: t('Fit height to text'), disabled: !short, run: () => fitHeight(store, el.id) },
      { label: t('Shrink text to fit'), disabled: !onSlide(el, W, H), run: () => shrinkText(store, el.id) },
    ])
  })
  return b
}

function fitHeight(store: Store, id: string) {
  const el = store.element(id)
  if (el?.type !== 'text') return
  const h = measureElement(el, store.doc).height
  if (h !== el.h) store.commit(() => { el.h = h })
}

/** The part of a box that is on the slide, or null when none of it is. */
function onSlide(el: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const x = Math.max(el.x, 0), y = Math.max(el.y, 0)
  // a side that is not cut keeps its exact size
  const w = el.x >= 0 && el.x + el.w <= W ? el.w : Math.floor(Math.min(el.x + el.w, W) - x)
  const h = el.y >= 0 && el.y + el.h <= H ? el.h : Math.floor(Math.min(el.y + el.h, H) - y)
  return w >= 1 && h >= 1 ? { x, y, w, h } : null
}

/** The box is cut back to its part on the slide, past any edge, and the font
 *  steps down until the text fits there. One undo step. */
function shrinkText(store: Store, id: string) {
  const el = store.element(id)
  if (el?.type !== 'text') return
  const box = onSlide(el, store.doc.size.width, store.doc.size.height)
  if (!box) return
  const fontSize = shrinkToFit(el, box.w, box.h, store.doc, SHRINK_FLOOR)
  if (fontSize === el.fontSize && box.x === el.x && box.y === el.y && box.w === el.w && box.h === el.h) return
  store.commit(() => { el.fontSize = fontSize; Object.assign(el, box) })
}
