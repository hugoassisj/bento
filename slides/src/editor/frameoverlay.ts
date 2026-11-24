// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// A selected auto-layout frame shows its padding and gaps on the canvas as
// pink bands (Figma's), and dragging a band changes that padding or gap, one
// undo step per drag. Lives in the scaled stage host, so its coordinates are
// slide px; only the bands take the pointer.
//
// Also here: which frame adopts what is drawn on the slide (adoptingFrame),
// and the "Draw or drop here" hint an empty frame shows on the editor canvas
// (drawFrameHints) — editor chrome, never an element, never in the document.

import type { Store } from '../store'
import { isLightBg, type ShapeElement, type Slide, type SlideElement } from '../model'
import { flagged, frameChildren, isFrame } from '../layout'
import { t } from '../i18n'

type Frame = ShapeElement & { layout: NonNullable<ShapeElement['layout']> }

/** Part of a component (its main or a copy): carries component info, or sits
 *  in a component's group. What such a frame lays out is the component's, so
 *  nothing drawn joins it — a copy would reflow and split from its main. */
function inComponent(slide: Slide, f: SlideElement): boolean {
  return !!f.component || (!!f.groupId && slide.elements.some((e) => e.groupId === f.groupId && !!e.component))
}

/** The frame that takes an element drawn (or dropped) with its start point at
 *  slide point `pt`: the innermost visible auto-layout frame whose box holds
 *  it (a hidden frame, or one inside a hidden frame, is passed over). Among
 *  frames as deep as each other, `prefer` (the frame the selection is in)
 *  wins, then the one painted on top. When that frame is locked in effect
 *  (layout.ts flagged) or part of a component, nothing takes the element: it
 *  is drawn on top, never handed to the frame around it. */
export function adoptingFrame(slide: Slide, pt: { x: number; y: number }, prefer?: string): Frame | undefined {
  const hidden = flagged(slide, 'hidden')
  const byId = new Map(slide.elements.map((e) => [e.id, e]))
  const depth = (e: SlideElement) => {
    let d = 0
    for (let up = e.parentId, seen = new Set<string>(); up && !seen.has(up); up = byId.get(up)?.parentId) { seen.add(up); d++ }
    return d
  }
  let best: Frame | undefined, bestDepth = -1
  // topmost first, so a tie keeps the one painted on top
  for (const f of [...slide.elements].reverse()) {
    if (!isFrame(f) || hidden.has(f.id)) continue
    if (pt.x < f.x || pt.x > f.x + f.w || pt.y < f.y || pt.y > f.y + f.h) continue
    const d = depth(f)
    if (d > bestDepth || (d === bestDepth && f.id === prefer)) { best = f; bestDepth = d }
  }
  if (!best || flagged(slide, 'locked').has(best.id) || inComponent(slide, best)) return undefined
  return best
}

/** "Draw or drop here", dimmed and centred in every visible, unlocked frame
 *  that has no children yet and is not part of a component. Each hint goes
 *  into the canvas surface right after its frame's node, so whatever is
 *  painted above the frame covers the hint too. `view` as for
 *  drawFrameOverlay. The canvas keeps --hint-k (1 / zoom) on the stage host. */
export function drawFrameHints(surface: HTMLElement | null, store: Store, view?: Slide) {
  if (!surface) return
  surface.querySelectorAll(':scope > .ed-frame-hint').forEach((n) => n.remove())
  const slide = view ?? store.slide
  const hidden = flagged(slide, 'hidden'), locked = flagged(slide, 'locked')
  for (const f of slide.elements) {
    if (!isFrame(f) || hidden.has(f.id) || locked.has(f.id) || frameChildren(slide, f).length || inComponent(slide, f)) continue
    const node = surface.querySelector<HTMLElement>(`:scope > [data-el-id="${CSS.escape(f.id)}"]`)
    if (!node || node.style.display === 'none') continue // a hover set not being previewed
    const hint = document.createElement('div')
    hint.className = 'ed-frame-hint'
    hint.dataset.frame = f.id
    hint.textContent = t('Draw or drop here')
    // dark words on a light frame, light on a dark one (a fill that is not a
    // plain colour reads by the slide behind it)
    const bg = /^#[0-9a-f]{6}/i.test(f.fill) ? f.fill : String(slide.background ?? '')
    hint.style.color = isLightBg(bg) ? '#1E2A3A' : '#F5F7FA'
    Object.assign(hint.style, { left: `${f.x}px`, top: `${f.y}px`, width: `${f.w}px`, height: `${f.h}px` })
    if (f.rotation) hint.style.transform = `rotate(${Number(f.rotation) || 0}deg)`
    node.after(hint)
  }
}

/** `view` draws from a laid-out copy of the slide instead of the model: the
 *  canvas passes its live copy while a frame is dragged, so the bands follow. */
export function drawFrameOverlay(host: HTMLElement, store: Store, scale: () => number, busy: boolean, view?: Slide) {
  host.querySelector(':scope > .ed-frame-layer')?.remove()
  const slide = view ?? store.slide
  const sel = store.selection.length === 1 ? slide.elements.filter((e) => e.id === store.selection[0]) : []
  const f = sel[0]
  if (busy || !isFrame(f)) return
  const layer = document.createElement('div')
  layer.className = 'ed-frame-layer'
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none'
  const L = f.layout
  const band = (x: number, y: number, w: number, h: number, axis: 'x' | 'y', name: string, get: () => number, put: (v: number) => void, sign = 1) => {
    if (w <= 0 || h <= 0) return
    const b = document.createElement('div')
    b.className = 'ed-frame-band'
    b.dataset.axis = axis
    b.title = t(name)
    Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
    b.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return
      ev.preventDefault(); ev.stopPropagation()
      const start = axis === 'x' ? ev.clientX : ev.clientY
      const v0 = get()
      let moved = false
      const move = (e: PointerEvent) => {
        const v = Math.max(0, Math.round(v0 + sign * ((axis === 'x' ? e.clientX : e.clientY) - start) / (scale() || 1)))
        if (v === get()) return
        if (!moved) { store.checkpoint(); moved = true } // one undo step for the whole drag
        put(v)
        store.touch()
      }
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    })
    layer.appendChild(b)
  }
  const [pt, pr, pb, pl] = L.pad
  const live = () => store.element(f.id) as typeof f | undefined
  const pad = (i: number) => [() => live()?.layout.pad[i] ?? 0, (v: number) => { const e = live(); if (e) e.layout.pad[i] = v }] as const
  band(f.x, f.y, f.w, pt, 'y', 'Top padding', ...pad(0))
  band(f.x + f.w - pr, f.y, pr, f.h, 'x', 'Right padding', ...pad(1), -1)
  band(f.x, f.y + f.h - pb, f.w, pb, 'y', 'Bottom padding', ...pad(2), -1)
  band(f.x, f.y, pl, f.h, 'x', 'Left padding', ...pad(3))
  if (L.dir !== 'grid' && L.gap > 0) {
    const kids = frameChildren(slide, f)
    const gap = [() => live()?.layout.gap ?? 0, (v: number) => { const e = live(); if (e) e.layout.gap = v }] as const
    for (let i = 0; i + 1 < kids.length; i++) {
      const a = kids[i], b = kids[i + 1]
      if (L.dir === 'row') band(a.x + a.w, f.y + pt, b.x - a.x - a.w, f.h - pt - pb, 'x', 'Gap', ...gap)
      else band(f.x + pl, a.y + a.h, f.w - pl - pr, b.y - a.y - a.h, 'y', 'Gap', ...gap)
    }
  }
  host.appendChild(layer)
}
