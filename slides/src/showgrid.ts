// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
/**
 * The all-slides grid, one implementation for the speaker window and the show
 * itself (present.ts): numbered slide thumbnails that are buttons, built
 * lazily on first open, closed by a click on the backdrop. The caller brings
 * the render and what a pick does; nothing here knows about Reveal.
 */

/** A clickable thumbnail in document `d`: a slide render inside a button,
 *  badged with the slide's visible number. A render made in another document
 *  (the speaker popup) is imported; one made in `d` is used as it is. */
export function slideThumb(d: Document, render: HTMLElement, idx: number, n: number, pick: (idx: number) => void): HTMLButtonElement {
  const b = d.createElement('button')
  b.className = 'sv-thumb'
  b.dataset.idx = String(idx)
  b.appendChild(render.ownerDocument === d ? render : d.importNode(render, true))
  const num = d.createElement('span')
  num.className = 'sv-thumb-n'
  num.textContent = String(n)
  b.appendChild(num)
  b.addEventListener('click', () => pick(idx))
  return b
}

export interface SlideGrid {
  readonly open: boolean
  /** Open, close, or (no argument) flip it; returns whether it is open now. */
  toggle(on?: boolean): boolean
}

/** Grid behaviour over `grid`, an element holding a `.sv-grid-inner`: the
 *  first open fills it with `thumb(idx)` for each of `indices` (a big deck
 *  pays for the renders only if someone asks); `onOpen` runs on every open. */
export function slideGrid(grid: HTMLElement, indices: readonly number[], thumb: (idx: number) => HTMLElement, onOpen?: () => void): SlideGrid {
  const inner = grid.querySelector('.sv-grid-inner')!
  let built = false
  const toggle = (on?: boolean) => {
    const show = on ?? grid.hidden
    if (show && !built) { for (const idx of indices) inner.appendChild(thumb(idx)); built = true }
    grid.hidden = !show
    if (show) onOpen?.()
    return show
  }
  grid.addEventListener('click', (ev) => { if (ev.target === grid) toggle(false) })
  return { get open() { return !grid.hidden }, toggle }
}

/** Move the focus among the grid's thumbnails for an arrow key, Home or End;
 *  false for any other key. The row length is read from the layout, so ↑ and
 *  ↓ follow however many columns fit. */
export function walkGrid(grid: HTMLElement, key: string): boolean {
  const thumbs = [...grid.querySelectorAll<HTMLElement>('.sv-thumb')]
  if (!thumbs.length) return false
  const at = Math.max(0, thumbs.indexOf(grid.ownerDocument.activeElement as HTMLElement))
  const cols = Math.max(1, thumbs.filter((b) => b.offsetTop === thumbs[0].offsetTop).length)
  const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -thumbs.length, End: thumbs.length }
  if (!(key in step)) return false
  thumbs[Math.min(thumbs.length - 1, Math.max(0, at + step[key]))].focus()
  return true
}
