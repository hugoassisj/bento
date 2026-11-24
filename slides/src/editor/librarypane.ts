// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The side column's Library view: the deck's components (components.ts) as
// picture tiles, beside Slides | Layers | Tokens.
//
// One tile per main, drawn by the deck's own renderer (renderSlide, which
// sanitizes) on the main slide's background, scaled to fit. A tile's picture
// is cached by the main's hash (mainSig), so a doc event re-draws only the
// tiles whose main changed, and a tile is first drawn when it scrolls into
// view (a deck with fifty components opens the view without drawing fifty).
// A search field filters by name; the tiles are a listbox. Click or Enter
// drops a copy at the slide's centre; a drag drops it where it lands, inside
// the frame under the pointer if there is one. Every insert is one commit.
import type { Store } from '../store'
import type { Slide } from '../model'
import { uid } from '../model'
import { components, instanceOf, mainSig, type ComponentInfo } from '../components'
import { moveIntoFrame } from '../layout'
import { fieldContext, renderSlide } from '../render'
import { editing } from './tokenspane'
import { openCtxMenu } from './ctxmenu'
import { t } from '../i18n'

export interface LibraryPaneHost {
  /** where a drop at this viewport point lands on the current slide — the
   *  slide point, and the frame there that would take it — or null when the
   *  point is not over the canvas; `preview` outlines that frame meanwhile */
  dropAt(clientX: number, clientY: number, preview: boolean): { x: number; y: number; frame?: string; slot: number } | null
  goToMain(id: string): void
  /** delete the main the way the canvas does (its confirmation included) */
  deleteMain(id: string): void
  /** the Create component shortcut, as the chrome prints it */
  keys(): string
}

const TW = 72, TH = 56 // what a tile's picture is fitted to (px): its box at the narrowest column

interface Box { x: number; y: number; w: number; h: number }
const bounds = (els: Box[]): Box => {
  const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y))
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y }
}
const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export class LibraryPane {
  private host: HTMLElement | null = null
  private search!: HTMLInputElement
  private grid!: HTMLElement
  private empty!: HTMLElement
  /** per component: its tile, and the picture it holds with the key it was drawn from */
  private tiles = new Map<string, { tile: HTMLElement; name: string; named: boolean; key: string; pic: HTMLElement | null }>()
  /** the tile Tab lands on (roving tabindex) */
  private active: string | null = null
  private seen: IntersectionObserver | null = null
  /** a panel folded open again (or resized) catches up on what it skipped while hidden */
  private sized: ResizeObserver | null = null
  private dragged = false
  /** the tile whose name was just entered with the keyboard */
  private refocus: string | null = null

  constructor(private store: Store, private ui: LibraryPaneHost) {}

  mount(into: HTMLElement) {
    this.host = into
    this.tiles.clear()
    this.seen?.disconnect()
    this.seen = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) this.draw((e.target as HTMLElement).dataset.component!) })
      : null
    this.search = document.createElement('input')
    this.search.type = 'search'
    this.search.className = 'ed-lib-search'
    this.search.placeholder = t('Search components')
    this.search.setAttribute('aria-label', t('Search components'))
    this.search.addEventListener('input', () => this.filter())
    this.search.addEventListener('keydown', (e) => {
      e.stopPropagation() // the editor's own keys stay out of the field
      if (e.isComposing) return
      const first = this.shown()[0]
      if (e.key === 'ArrowDown' && first) { e.preventDefault(); this.focusTile(first) }
      else if (e.key === 'Enter' && first) { e.preventDefault(); this.insertCopy(first) }
      else if (e.key === 'Escape' && this.search.value) { e.preventDefault(); this.search.value = ''; this.filter() }
    })
    this.grid = document.createElement('div')
    this.grid.className = 'ed-lib-grid'
    this.grid.setAttribute('role', 'listbox')
    this.grid.setAttribute('aria-label', t('Components'))
    this.grid.addEventListener('keydown', (e) => this.onKey(e))
    this.empty = document.createElement('p')
    this.empty.className = 'ed-hint ed-lib-empty'
    into.replaceChildren(this.search, this.grid, this.empty)
    this.sized?.disconnect()
    this.sized = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.refresh()) : null
    this.sized?.observe(into)
    this.refresh()
  }

  /** Bring the tiles in step with the deck. Skipped while the view is hidden
   *  (the editor refreshes it when it is shown) or a name is being typed. */
  refresh() {
    const host = this.host
    if (!host || !host.offsetParent || host.querySelector('.ed-lib-grid input:focus')) return
    const list = components(this.store.doc)
    const ids = new Set(list.map((c) => c.id))
    for (const [id, x] of this.tiles) if (!ids.has(id)) { this.seen?.unobserve(x.tile); x.tile.remove(); this.tiles.delete(id) }
    const order: HTMLElement[] = []
    list.forEach((c, i) => {
      const name = c.name || t('Component {n}', { n: i + 1 })
      let x = this.tiles.get(c.id)
      if (!x || x.name !== name || x.named !== !!c.name) {
        const tile = this.tile(c, name)
        if (x) { if (x.pic) tile.querySelector('.ed-lib-pic')!.replaceWith(x.pic); this.seen?.unobserve(x.tile); x.tile.replaceWith(tile) }
        x = { tile, name, named: !!c.name, key: x?.key ?? '', pic: x?.pic ?? null }
        this.tiles.set(c.id, x)
        this.seen?.observe(tile)
      }
      // a picture already drawn follows its main now; one never drawn waits to be seen
      if (x.pic && x.key !== this.keyOf(c)) this.draw(c.id, c)
      order.push(x.tile)
    })
    // only reorder when the order changed: moving a node blurs the focused tile
    if (order.some((n, i) => this.grid.children[i] !== n) || this.grid.children.length !== order.length) this.grid.replaceChildren(...order)
    if (!this.seen) for (const c of list) this.draw(c.id, c)
    if (!this.active || !this.tiles.has(this.active)) this.active = list[0]?.id ?? null
    this.filter()
  }

  /** The key a tile's picture is drawn from: the main, the slide it sits on
   *  and the deck's fonts (a text that names none is drawn in them). */
  private keyOf(c: ComponentInfo): string {
    const s = this.store.doc.slides.find((x) => x.id === c.slideId)
    const th = this.store.doc.theme
    return `${mainSig(c.main)}|${JSON.stringify([s?.background ?? '', th.fontFamily, th.codeFontFamily, th.headingFamily])}|${JSON.stringify(c.main.map((m) => m.component))}`
  }

  /** Draw (or re-draw) a tile's picture, unless the one it has is current. */
  private draw(id: string, c = components(this.store.doc).find((x) => x.id === id)) {
    const x = this.tiles.get(id)
    if (!x || !c) return
    const key = this.keyOf(c)
    if (x.pic && x.key === key) return
    const slide = this.store.doc.slides.find((s) => s.id === c.slideId)
    if (!slide) return
    const b = bounds(c.main as unknown as Box[])
    const k = Math.min(1, TW / Math.max(b.w, 1), TH / Math.max(b.h, 1))
    // the main alone on its own slide: the renderer draws background, frame
    // clips and hidden layers as it does everywhere, from the document
    const only: Slide = { ...slide, elements: c.main }
    const surface = renderSlide(only, this.store.doc, { svgAsImage: true, hidePlaceholders: true, fields: fieldContext(this.store.doc, slide) })
    surface.style.transformOrigin = '0 0'
    surface.style.transform = `scale(${k}) translate(${-b.x}px, ${-b.y}px)`
    const pic = document.createElement('div')
    pic.className = 'ed-lib-pic'
    pic.setAttribute('aria-hidden', 'true')
    const win = document.createElement('div')
    win.className = 'ed-lib-win'
    win.style.width = `${b.w * k}px`
    win.style.height = `${b.h * k}px`
    win.appendChild(surface)
    pic.appendChild(win)
    ;(x.pic ?? x.tile.querySelector('.ed-lib-pic')!).replaceWith(pic)
    x.pic = pic
    x.key = key
  }

  private tile(c: ComponentInfo, name: string): HTMLElement {
    const tile = document.createElement('div')
    tile.className = 'ed-lib-tile'
    tile.dataset.component = c.id
    tile.setAttribute('role', 'option')
    tile.setAttribute('aria-selected', 'false')
    tile.setAttribute('aria-label', name)
    tile.title = `${name} — ${t('Click or press Enter to insert a copy; drag it onto the slide to place it')}`
    tile.tabIndex = -1
    // the picture's box from the start, so a tile not yet drawn is already its full height
    const box = document.createElement('div')
    box.className = 'ed-lib-pic'
    box.setAttribute('aria-hidden', 'true')
    tile.appendChild(box)
    const label = editing(name, t('Component name'), () => null, (to) => {
      this.store.commit(() => {
        for (const m of components(this.store.doc).find((x) => x.id === c.id)?.main ?? []) {
          if (to) m.groupName = to
          else delete m.groupName
        }
      })
      // the rename rebuilt the tile: a name typed from the keyboard hands focus to the new one
      if (this.refocus === c.id) this.focusTile(c.id)
      this.refocus = null
    }, undefined, 'ed-lib-name', false, !c.name)
    label.tabIndex = -1 // the tile is the stop; F2 or the menu renames
    tile.appendChild(label)
    // a read-only deck shows names, it never opens them for typing
    tile.addEventListener('click', (e) => { if (this.store.readOnly && label.contains(e.target as Node)) e.stopPropagation() }, true)
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target as HTMLElement).matches('input')) this.refocus = c.id }, true)
    tile.addEventListener('focus', () => this.setActive(c.id))
    tile.addEventListener('click', (e) => {
      if (this.dragged) { this.dragged = false; return }
      if (label.contains(e.target as Node) || (e.target as HTMLElement).closest('input')) return
      this.setActive(c.id)
      this.insertCopy(c.id)
    })
    tile.addEventListener('contextmenu', (e) => { e.preventDefault(); this.menu(c.id, e.clientX, e.clientY) })
    tile.addEventListener('mousedown', (e) => this.startDrag(e, c.id, label))
    return tile
  }

  private menu(id: string, x: number, y: number) {
    const ro = this.store.readOnly
    const label = this.tiles.get(id)?.tile.querySelector<HTMLElement>('.ed-lib-name')
    openCtxMenu(x, y, [
      { label: t('Insert'), disabled: ro, run: () => this.insertCopy(id) },
      { label: t('Go to main component'), run: () => this.ui.goToMain(id) },
      { label: t('Rename'), disabled: ro, run: () => label?.click() },
      'sep',
      { label: t('Delete'), danger: true, disabled: ro, run: () => this.ui.deleteMain(id) },
    ])
  }

  /** A press on a tile: past a few px it is a drag — a ghost follows the
   *  pointer, the frame under it is outlined, and the drop places the copy. */
  private startDrag(down: MouseEvent, id: string, label: HTMLElement) {
    if (down.button !== 0 || this.store.readOnly || label.contains(down.target as Node) || (down.target as HTMLElement).closest('input')) return
    this.settle()
    down.preventDefault() // no text selection, no native drag of the picture
    this.dragged = false
    let ghost: HTMLElement | null = null
    const move = (e: MouseEvent) => {
      if (!ghost) {
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < 4) return
        ghost = document.createElement('div')
        ghost.className = 'ed-lib-ghost'
        const pic = this.tiles.get(id)?.tile.querySelector('.ed-lib-pic')
        if (pic) ghost.appendChild(pic.cloneNode(true))
        document.body.appendChild(ghost)
      }
      ghost.style.transform = `translate(${e.clientX - TW / 2}px, ${e.clientY - TH / 2}px)`
      this.ui.dropAt(e.clientX, e.clientY, true)
    }
    const up = (e: MouseEvent) => {
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', up, true)
      if (!ghost) return
      ghost.remove()
      this.dragged = true
      queueMicrotask(() => setTimeout(() => { this.dragged = false })) // a click that follows on the tile is not an insert
      const at = this.ui.dropAt(e.clientX, e.clientY, false)
      if (at) this.placeAt(id, at)
    }
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  }

  /** End an edit in progress outside the Library (a canvas text box commits
   *  on blur): the press below keeps focus where it is, and the edit's own
   *  undo step must land before the insert's, not after it. */
  private settle() {
    const a = document.activeElement as HTMLElement | null
    if (a && a !== document.body && !this.host?.contains(a)) a.blur()
  }

  /** A copy centred on a slide point; inside `frame` when the point is in one. One commit. */
  private placeAt(id: string, at: { x: number; y: number; frame?: string; slot: number }) {
    const c = components(this.store.doc).find((x) => x.id === id)
    if (!c) return
    this.settle()
    const box = bounds(c.main as unknown as Box[])
    const els = instanceOf(c, () => uid('c'), Math.round(at.x - box.w / 2) - box.x, Math.round(at.y - box.h / 2) - box.y)
    this.store.commit(() => {
      const slide = this.store.slide
      slide.elements.push(...els)
      if (at.frame) moveIntoFrame(slide, els.filter((e) => !e.parentId).map((e) => e.id), at.frame, at.slot)
    })
    this.store.select(els.map((e) => e.id))
  }

  /**
   * A copy of a component on the current slide: centred on the slide, then
   * nudged down-right until it covers nothing already there, and selected.
   * ponytail: the slide's centre, not the scrolled viewport's — the canvas fits
   * the slide by default; a zoomed-in view may still put it off-screen.
   */
  insertCopy(id: string) {
    if (this.store.readOnly) return
    const c = components(this.store.doc).find((x) => x.id === id)
    if (!c) return
    this.settle()
    const box = bounds(c.main as unknown as Box[])
    const { width, height } = this.store.doc.size
    const others = this.store.slide.elements as unknown as Box[]
    let x = Math.round((width - box.w) / 2), y = Math.round((height - box.h) / 2)
    for (let i = 0; i < 24 && others.some((o) => hits({ x, y, w: box.w, h: box.h }, o)); i++) { x += 32; y += 32 }
    if (x + box.w > width || y + box.h > height) { x = Math.round((width - box.w) / 2); y = Math.round((height - box.h) / 2) }
    const els = instanceOf(c, () => uid('c'), x - box.x, y - box.y)
    this.store.commit(() => { this.store.slide.elements.push(...els) })
    this.store.select(els.map((e) => e.id))
  }

  /** The visible tiles' ids, in order. */
  private shown(): string[] {
    return [...this.tiles].filter(([, x]) => !x.tile.hidden).map(([id]) => id)
  }

  private filter() {
    const q = this.search.value.trim().toLowerCase()
    for (const x of this.tiles.values()) x.tile.hidden = !!q && !x.name.toLowerCase().includes(q)
    const none = !this.tiles.size
    this.search.hidden = none
    this.empty.hidden = !none && !!this.shown().length
    this.empty.textContent = none
      ? t('Select something and choose Create component ({keys}) to reuse it.', { keys: this.ui.keys() })
      : t('No components match')
    const shown = this.shown()
    if (this.active && !shown.includes(this.active)) this.active = shown[0] ?? null
    this.setActive(this.active)
  }

  private setActive(id: string | null) {
    this.active = id
    for (const [k, x] of this.tiles) {
      x.tile.tabIndex = k === id ? 0 : -1
      x.tile.setAttribute('aria-selected', String(k === id))
    }
  }

  private focusTile(id: string) {
    this.setActive(id)
    this.tiles.get(id)?.tile.focus()
  }

  private onKey(e: KeyboardEvent) {
    const tile = (e.target as HTMLElement).closest<HTMLElement>('.ed-lib-tile')
    if (!tile || e.target !== tile) return
    const id = tile.dataset.component!
    const shown = this.shown()
    const at = shown.indexOf(id)
    const go = (i: number) => { e.preventDefault(); e.stopPropagation(); const to = shown[Math.max(0, Math.min(shown.length - 1, i))]; if (to) this.focusTile(to) }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(shown.length - 1)
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.insertCopy(id) }
    else if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); tile.querySelector<HTMLElement>('.ed-lib-name')?.click() }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); e.stopPropagation(); const r = tile.getBoundingClientRect(); this.menu(id, r.left, r.bottom) }
  }

  /** Point at a component's tile (after ⌥⌘K made it): it flashes and is the
   *  active tile. Not focused — a focused tile would keep ⌘Z from undoing the make. */
  showComponent(id: string) {
    if (this.search.value) { this.search.value = ''; this.filter() }
    const tile = this.tiles.get(id)?.tile
    if (!tile) return
    this.setActive(id)
    tile.scrollIntoView({ block: 'nearest' })
    tile.classList.remove('ed-flash'); void tile.offsetWidth; tile.classList.add('ed-flash')
  }

  /** ⌘K's Insert component…: the search field, focused. */
  focusSearch() {
    this.search.hidden = false
    this.search.focus()
    this.search.select()
  }
}
