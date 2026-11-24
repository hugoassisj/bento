// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The context menu: one floating list, opened at a point, dismissed by
// anything. Deliberately dumb — it renders items and reports clicks. What the
// items ARE is decided by whoever opens it (editor.ts), because that is where
// the selection, the store and the panels live.
//
// Only ONE can be open at a time, and it is a module-level singleton rather
// than a per-caller instance: a second right-click anywhere must replace the
// first menu, including one opened by a different part of the editor.
//
// A row may open a submenu (`items`): one level deep, shown beside its row on
// hover, a click or tap, or Right arrow (Left arrow or Escape closes it
// again). Where neither side of the menu has room (a phone), it takes the
// menu's place instead, headed by a row back — and only on a click, tap or
// key, never on hover, because it would land under the pointer. A click
// never shuts it (that is the hover-then-click every mouse makes), and a
// submenu row runs only for a press that started on the submenu, so the tap
// that opened it can never also run what appeared under the finger. It is
// part of the same singleton — closing the menu closes it, and a press inside
// it is a press inside the menu. It mounts on the body, not inside the list,
// because a list that scrolls (a long menu on a short screen) clips both axes.

import { ICONS } from '../icons'

/** A separator, or a row. `hint` is the shortcut shown greyed on the right. */
export type CtxItem =
  | 'sep'
  | {
      label: string
      /** absent on a row that opens `items` */
      run?: () => void
      hint?: string
      /** the command (editor/commands.ts) this row runs — its id lands on data-cmd */
      cmd?: string
      disabled?: boolean
      /** destructive — rendered in red, and always placed last by convention */
      danger?: boolean
      /** a glyph before the label (trusted svg markup from icons.ts or a preview) */
      icon?: string
      /** the row that is the current value (a picker menu) */
      checked?: boolean
      /** the row's tooltip — on a disabled row, why it cannot apply */
      title?: string
      /** a submenu, opened from this row */
      items?: CtxItem[]
    }

let open: HTMLElement | null = null
let detach: (() => void) | null = null
/** the open submenu and the row that opened it; `inPlace`: it stands where
 *  the menu was (no room beside it), and the menu is hidden until it closes */
let sub: { menu: HTMLElement; row: HTMLElement; inPlace: boolean } | null = null
/** each submenu row's items, for the keyboard to open */
const subItems = new WeakMap<HTMLElement, CtxItem[]>()
/** hover intent: leaving the row for a sibling closes the submenu only after
 *  a moment, so a diagonal run at a lower submenu row does not lose it */
let closeTimer = 0
const cancelClose = () => { clearTimeout(closeTimer); closeTimer = 0 }

/** Close the open menu, if any. Safe to call when nothing is open. */
export function closeCtxMenu() {
  detach?.()
  detach = null
  closeSub()
  open?.remove()
  open = null
}

/** Close the submenu; `refocus` hands the keyboard back to its row. */
function closeSub(refocus = false) {
  cancelClose()
  if (!sub) return
  const { menu, row, inPlace } = sub
  sub = null
  menu.remove()
  if (inPlace && open) open.style.visibility = ''
  row.setAttribute('aria-expanded', 'false')
  row.classList.remove('open')
  if (refocus) row.focus({ preventScroll: true })
}

/** Open `row`'s submenu — beside it, or in the menu's place when neither side
 *  has room, which a hover never does. Already open: stays open. */
function openSub(row: HTMLElement, items: CtxItem[], focusFirst: boolean, via: 'hover' | 'press') {
  cancelClose()
  if (sub?.row === row) { if (focusFirst) rowsOf(sub.menu)[sub.inPlace ? 1 : 0]?.focus({ preventScroll: true }); return }
  if (!open) return
  const menu = build(items, true)
  menu.id = 'ed-ctxmenu-sub'
  menu.style.visibility = 'hidden'
  document.body.appendChild(menu)
  const r = row.getBoundingClientRect()
  const rtl = getComputedStyle(row).direction === 'rtl'
  const w = menu.offsetWidth, pad = 8, vw = window.innerWidth
  const after = rtl ? r.left - 4 - w : r.right + 4, before = rtl ? r.right + 4 : r.left - 4 - w
  const fits = (x: number) => x >= pad && x + w <= vw - pad
  const inPlace = !fits(after) && !fits(before)
  if (inPlace && via === 'hover') { menu.remove(); closeSub(); return }
  closeSub()
  if (inPlace) {
    // a row back first: the menu it stands in for is hidden meanwhile
    const back = document.createElement('button')
    back.className = 'ed-ctxmenu-item ed-ctxmenu-back'
    back.setAttribute('role', 'menuitem')
    back.innerHTML = `<span class="ed-ctxmenu-icon" aria-hidden="true">${ICONS.chevron}</span>`
    const label = document.createElement('span')
    label.className = 'ed-ctxmenu-label'
    label.textContent = row.querySelector('.ed-ctxmenu-label')?.textContent ?? ''
    back.appendChild(label)
    back.addEventListener('click', () => closeSub(true))
    menu.prepend(back)
    const m = open.getBoundingClientRect()
    const x = Math.max(pad, Math.min(m.left, vw - pad - menu.offsetWidth))
    place(menu, x, m.top, x)
    open.style.visibility = 'hidden'
  } else {
    // beside the row, on the reading side, flipped to the other when it would
    // hang off the screen; its first row level with the row that opened it.
    // Never over the row: the pointer is on it.
    place(menu, fits(after) ? after : before, r.top - 5, fits(after) ? after : before)
  }
  menu.style.visibility = ''
  menu.addEventListener('mouseenter', cancelClose)
  row.setAttribute('aria-controls', menu.id)
  row.setAttribute('aria-expanded', 'true')
  row.classList.add('open')
  sub = { menu, row, inPlace }
  if (focusFirst) rowsOf(menu)[inPlace ? 1 : 0]?.focus({ preventScroll: true })
}

/** The rows of a list the keyboard can land on. */
function rowsOf(menu: Element): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>(':scope > .ed-ctxmenu-item:not(:disabled)')]
}

export function ctxMenuIsOpen() {
  return !!open
}

/**
 * Open a menu at a viewport point. Items with no enabled entries are dropped
 * along with any separator that would be left dangling, so callers can build a
 * list unconditionally and let the menu decide what is worth showing.
 */
export function openCtxMenu(x: number, y: number, items: CtxItem[]) {
  closeCtxMenu()
  const rows = tidy(items)
  if (!rows.length) return

  const menu = build(rows, false)

  // Measured off-screen first: the flip below needs a real size, and a menu
  // built from a variable number of rows has no size until it is in the DOM.
  menu.style.visibility = 'hidden'
  document.body.appendChild(menu)
  place(menu, x, y)
  menu.style.visibility = ''
  open = menu

  // Dismissal. Capture phase so a press anywhere closes it before that press
  // does anything else, which is what makes the menu feel modal without being
  // modal. `scroll` is captured too — a menu pinned to the viewport while the
  // canvas moves under it would point at the wrong element.
  const onDown = (ev: Event) => {
    if (menu.contains(ev.target as Node) || sub?.menu.contains(ev.target as Node)) return
    closeCtxMenu()
  }
  // The keyboard walks the rows: ↑↓ within a list (from outside, into the
  // menu), → opens a row's submenu on its first row, ← and Escape close the
  // submenu back onto its row; Escape at the top closes the menu. Every arrow
  // stops here, used or not, so none nudges the selection behind the menu.
  const onKey = (ev: KeyboardEvent) => {
    const at = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inMenu = !!at && (menu.contains(at) || !!sub?.menu.contains(at))
    const rtl = getComputedStyle(menu).direction === 'rtl'
    const into = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft'
    const stop = () => { ev.stopPropagation(); ev.preventDefault() }
    if (ev.key === 'Escape') {
      ev.stopPropagation() // Escape closes THIS, not the selection behind it
      if (sub) closeSub(inMenu)
      else closeCtxMenu()
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      stop()
      // in its place, the submenu is the list (the menu behind it is hidden)
      const rows = rowsOf(sub?.inPlace ? sub.menu : inMenu ? at!.closest('.ed-ctxmenu')! : menu)
      if (!rows.length) return
      const i = at ? rows.indexOf(at) : -1
      const next = ev.key === 'ArrowDown' ? rows[(i + 1) % rows.length] : rows[i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length]
      next.focus({ preventScroll: true })
    } else if (ev.key === into || ev.key === back) {
      stop()
      if (inMenu && ev.key === into && subItems.has(at!)) openSub(at!, subItems.get(at!)!, true, 'press')
      else if (inMenu && ev.key === back && (sub?.inPlace || sub?.menu.contains(at))) closeSub(true)
    } else if (inMenu && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.stopPropagation() // the row's own activation, not a key for the canvas
      if (subItems.has(at!)) {
        ev.preventDefault()
        openSub(at!, subItems.get(at!)!, true, 'press')
      }
    }
  }
  const onScroll = () => closeCtxMenu()
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('wheel', onScroll, true)
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
  document.addEventListener('keydown', onKey, true)
  detach = () => {
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('wheel', onScroll, true)
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onScroll)
    document.removeEventListener('keydown', onKey, true)
  }
}

/** One list of rows. A row with `items` opens them as the submenu (only at
 *  the top level: a submenu's rows run). */
function build(rows: CtxItem[], nested: boolean): HTMLElement {
  const menu = document.createElement('div')
  menu.className = 'ed-ctxmenu'
  menu.setAttribute('role', 'menu')
  if (nested) menu.classList.add('ed-ctxmenu-sub')
  // a submenu row runs only for a press that began on the submenu (or a key):
  // the tap that opened it must not also run whatever appeared under it
  let pressed = false
  if (nested) menu.addEventListener('pointerdown', () => { pressed = true })
  for (const item of rows) {
    if (item === 'sep') {
      const s = document.createElement('div')
      s.className = 'ed-ctxmenu-sep'
      menu.appendChild(s)
      continue
    }
    const b = document.createElement('button')
    b.className = 'ed-ctxmenu-item'
    b.setAttribute('role', 'menuitem')
    if (item.danger) b.classList.add('ed-ctxmenu-danger')
    b.disabled = !!item.disabled
    if (item.cmd) b.dataset.cmd = item.cmd
    if (item.checked !== undefined) { b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(item.checked)) }
    if (item.icon) {
      const g = document.createElement('span')
      g.className = 'ed-ctxmenu-icon'
      g.innerHTML = item.icon
      b.appendChild(g)
    }
    const label = document.createElement('span')
    label.className = 'ed-ctxmenu-label'
    label.textContent = item.label
    b.appendChild(label)
    if (item.title) b.title = item.title
    if (item.hint) {
      const h = document.createElement('kbd')
      h.textContent = item.hint
      b.appendChild(h)
    }
    const kids = !nested && item.items ? tidy(item.items) : null
    if (kids && !kids.length) b.disabled = true // a submenu with nothing in it
    if (kids?.length) {
      b.classList.add('ed-ctxmenu-parent')
      b.setAttribute('aria-haspopup', 'menu')
      b.setAttribute('aria-expanded', 'false')
      const chev = document.createElement('span')
      chev.className = 'ed-ctxmenu-chev'
      chev.setAttribute('aria-hidden', 'true')
      chev.innerHTML = ICONS.chevron
      b.appendChild(chev)
      subItems.set(b, kids)
      // a click only opens: it follows the hover that already did
      b.addEventListener('click', () => openSub(b, kids, false, 'press'))
    } else if (!kids) {
      // click, not pointerdown: the dismiss listener below is on pointerdown, and
      // acting on the press would run the item and then immediately re-close over
      // a menu that had already gone.
      b.addEventListener('click', (ev) => {
        if (nested && ev.detail > 0 && !pressed) return
        closeCtxMenu()
        item.run?.()
      })
    }
    // hover opens a row's submenu; any other row of the same list closes it,
    // after a moment (hover intent)
    if (!nested) b.addEventListener('mouseenter', () => {
      if (kids?.length && !b.disabled) openSub(b, kids, false, 'hover')
      else if (sub && !closeTimer) closeTimer = window.setTimeout(() => closeSub(), 300)
    })
    menu.appendChild(b)
  }

  return menu
}

/** Drop leading, trailing and doubled separators, and empty menus. */
function tidy(items: CtxItem[]): CtxItem[] {
  const out: CtxItem[] = []
  for (const it of items) {
    if (it === 'sep') {
      if (!out.length || out[out.length - 1] === 'sep') continue
      out.push(it)
      continue
    }
    out.push(it)
  }
  while (out.length && out[out.length - 1] === 'sep') out.pop()
  return out.some((i) => i !== 'sep') ? out : []
}

/**
 * Put the menu at (x, y), flipped back inside the viewport when it would hang
 * off an edge. Flipping rather than clamping keeps the pointer OUTSIDE the
 * menu: a clamped menu slides under the finger or cursor, and the first thing
 * that happens is a mis-click on whatever row landed there.
 */
function place(menu: HTMLElement, x: number, y: number, altX?: number) {
  // the layout size, not getBoundingClientRect: the pop-in animation starts
  // scaled down, and a box measured mid-scale is short enough to hang a long
  // menu off the bottom of the screen
  const m = { width: menu.offsetWidth, height: menu.offsetHeight }
  const pad = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = x
  let top = y
  // a submenu (altX: its other side of the row) flips across its row, and
  // slides up rather than flipping: the pointer is beside it, not over it
  if (altX !== undefined) {
    if (left < pad || left + m.width > vw - pad) left = altX
    if (top + m.height > vh - pad) top = vh - pad - m.height
  } else {
    if (left + m.width > vw - pad) left = Math.max(pad, x - m.width)
    if (top + m.height > vh - pad) top = Math.max(pad, y - m.height)
  }
  // Still taller than the screen (a long menu on a short landscape phone):
  // pin it to the top and let it scroll rather than run off the bottom.
  if (m.height > vh - pad * 2) {
    top = pad
    menu.style.maxHeight = `${vh - pad * 2}px`
    menu.style.overflowY = 'auto'
  }
  menu.style.left = `${Math.round(Math.max(pad, left))}px`
  menu.style.top = `${Math.round(Math.max(pad, top))}px`
}
