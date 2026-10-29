// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Hints: one tooltip for the whole editor chrome, the way design tools show
// them — after a short rest, then instantly while you move along a toolbar,
// on keyboard focus as well as hover, with the shortcut set apart as keys.
//
// It reads the `title` every control already carries, so no call site
// changes. The title is BORROWED for as long as the hint shows — moved to
// data-hint, which keeps the browser's own slow, unstyled tooltip from
// doubling it, with the same text standing in as the accessible name (or
// description) the title was providing — and put back on the way out, so the
// DOM is as its author wrote it except under the pointer.
// A trailing "(⇧⌘G)" — the convention the strings already use — becomes key
// chips. The slide itself is content, not chrome: nothing under the stage
// is touched.

const REST_MS = 450
/** moving from one hinted control to the next within this long skips the rest */
const WARM_MS = 300

export function mountHints(root: HTMLElement, signal: AbortSignal) {
  const tip = document.createElement('div')
  tip.className = 'ed-tip'
  tip.setAttribute('role', 'tooltip')
  tip.hidden = true
  document.body.appendChild(tip)
  signal.addEventListener('abort', () => tip.remove(), { once: true })

  let timer = 0
  let current: HTMLElement | null = null
  let coldAt = 0

  /** The hinted control an event reached, adopting its title on the way. */
  const hinted = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || target.closest('.ed-stage-scale, .ed-tip')) return null
    const el = target.closest<HTMLElement>('[title], [data-hint]')
    if (!el || !root.contains(el)) return null
    return el.getAttribute('title')?.trim() || el.dataset.hint ? el : null
  }

  /** Take the title for the length of the hint (see the header). */
  const borrow = (el: HTMLElement) => {
    const text = el.getAttribute('title')?.trim()
    if (!text) return
    el.removeAttribute('title')
    el.dataset.hint = text
    // the title was this control's accessible name (icon-only) or its
    // description (everything else); while it is away, the same text stands in
    if (el.getAttribute('aria-label')) return
    const attr = el.textContent?.trim() ? 'aria-description' : 'aria-label'
    el.setAttribute(attr, attr === 'aria-label' ? text.replace(SHORTCUT, '') : text)
    el.dataset.hintAria = attr
  }
  const giveBack = (el: HTMLElement) => {
    if (el.dataset.hint === undefined) return
    if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.hint)
    delete el.dataset.hint
    if (el.dataset.hintAria) { el.removeAttribute(el.dataset.hintAria); delete el.dataset.hintAria }
  }

  const show = (el: HTMLElement) => {
    const text = el.dataset.hint ?? el.getAttribute('title')?.trim() ?? ''
    const m = SHORTCUT.exec(text)
    tip.replaceChildren(m ? text.slice(0, m.index) : text)
    if (m) {
      const keys = document.createElement('span')
      keys.className = 'ed-tip-keys'
      for (const k of m[1].split(/\s*(?:·|\/)\s*/)) {
        const kbd = document.createElement('kbd')
        kbd.textContent = k
        keys.appendChild(kbd)
      }
      tip.appendChild(keys)
    }
    tip.hidden = false
    const r = el.getBoundingClientRect()
    const t = tip.getBoundingClientRect()
    const below = r.bottom + 8 + t.height < innerHeight
    const x = Math.min(Math.max(r.left + r.width / 2 - t.width / 2, 8), innerWidth - t.width - 8)
    tip.style.left = `${x}px`
    tip.style.top = `${below ? r.bottom + 8 : r.top - 8 - t.height}px`
  }

  /** A hover borrows the title (the browser would show its own tooltip on top);
   *  keyboard focus leaves it alone — browsers show no native tooltip there. */
  const enter = (el: HTMLElement, byPointer: boolean) => {
    if (el === current) return
    clearTimeout(timer)
    if (current) giveBack(current)
    current = el
    if (byPointer) borrow(el)
    if (!tip.hidden || performance.now() - coldAt < WARM_MS) show(el)
    else timer = window.setTimeout(() => current === el && show(el), REST_MS)
  }
  const leave = () => {
    clearTimeout(timer)
    if (!tip.hidden) coldAt = performance.now()
    if (current) giveBack(current)
    current = null
    tip.hidden = true
  }

  const opts = { capture: true, signal }
  document.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return
    const el = hinted(ev.target)
    if (el) enter(el, true)
    else if (current && !current.contains(ev.target as Node)) leave()
  }, opts)
  document.addEventListener('focusin', (ev) => {
    const el = hinted(ev.target)
    if (el && (ev.target as Element).matches(':focus-visible')) enter(el, false)
  }, opts)
  for (const type of ['pointerdown', 'keydown', 'focusout', 'scroll', 'wheel'] as const) {
    document.addEventListener(type, () => { if (current) leave() }, { ...opts, passive: true })
  }
  window.addEventListener('blur', leave, { signal })
}

/** "Group (⌘G)" → "⌘G"; "Undo · redo (⌘Z · ⌘⇧Z)" → "⌘Z · ⌘⇧Z". */
const SHORTCUT = /\s*\(((?:[⌘⇧⌥⌃⌫]|Ctrl|Alt|Shift|Esc|Tab|Del|F\d)[^()]*)\)\s*$/
