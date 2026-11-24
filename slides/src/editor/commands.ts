// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Commands: one list for the keyboard, the ⌘K palette and the chrome's tooltips.
//
// The editor declares each command ONCE — what it is called, its keys, when it
// applies and what it does — and three readers share that list: the keydown
// handler dispatches through it (in list order, so a more specific chord such
// as ⇧⌘X sits before anything it would shadow), the palette searches it, and a
// button that runs a command borrows its keys for its tooltip. A gesture that
// is not a key press (Shift-drag, Alt-hover) is not a command; the ? sheet
// keeps those as prose.

import { t } from '../i18n'
import { lsJson, lsSetJson } from '../../../kernel/src/storage.ts'

export type Scope = 'canvas' | 'text' | 'path' | 'present' | 'always'

export interface Command {
  id: string
  /** English source string; shown through t() */
  label: string
  /** display chips, e.g. '⌘S' or '⇧⌘G' */
  keys?: string
  /** the key press that runs it; absent = palette only */
  match?: (ev: KeyboardEvent, mod: boolean) => boolean
  scope: Scope
  /** also runs while a text field has focus (save, zoom, present) */
  inField?: boolean
  /** run (keys) only while this holds; the palette lists it greyed otherwise */
  when?: () => boolean
  /** while `when` fails: why, shown (already translated) on the palette's
   *  greyed row; absent or undefined = "Not available right now" */
  why?: () => string | undefined
  /** other tools' words for it ("line up", "tidy"), space-separated. A search
   *  aid in English, never shown and never translated — not a t() string. */
  keywords?: string
  /** while `when` fails, the chord is the browser's again (⌘L with nothing
   *  selected is the address bar, #838) — the exception to owned chords */
  yields?: boolean
  run: (ev?: KeyboardEvent) => void
}

/** ⌘ on a Mac, Ctrl elsewhere — as the ? sheet writes it */
export const MOD = typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'

/** Run the first command this key press matches. Reports whether one ran.
 *  A ⌘/Ctrl chord the editor declares stays the editor's even when its
 *  command does not apply right now: ⌘G with nothing to group must not turn
 *  into the browser's Find next. */
export function dispatch(cmds: Command[], ev: KeyboardEvent, inField: boolean): boolean {
  const mod = ev.metaKey || ev.ctrlKey
  let owned = false
  for (const c of cmds) {
    if (!c.match || (inField && !c.inField) || !c.match(ev, mod)) continue
    if (c.when && !c.when()) { owned ||= mod && !c.yields; continue }
    ev.preventDefault()
    c.run(ev)
    return true
  }
  if (owned) ev.preventDefault()
  return false
}

/** A label with its keys, in the "(⇧⌘G)" form hints.ts turns into chips. */
export function titleFor(cmds: Command[], id: string, label?: string): string {
  const c = cmds.find((x) => x.id === id)
  const text = label ?? (c ? t(c.label) : id)
  return c?.keys ? `${text} (${c.keys})` : text
}

/**
 * Subsequence score: every query character must appear in order; runs and
 * word starts score higher. -1 = no match.
 * ponytail: a scan per command per keystroke — fine for a list of dozens.
 */
export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '')
  const s = text.toLowerCase()
  if (!q) return 0
  let score = 0, at = -1, run = 0
  for (const ch of q) {
    const i = s.indexOf(ch, at + 1)
    if (i < 0) return -1
    run = i === at + 1 ? run + 1 : 0
    score += 1 + run * 2 + (i === 0 || /[\s\-—·(▸/]/.test(s[i - 1]) ? 3 : 0)
    at = i
  }
  return score - s.length * 0.01
}

const RECENT = 'bento-cmd-recent'

/** A keyword match: the query as typed must appear in the keywords (a
 *  subsequence across a list of loose words would find nearly anything). */
const kw = (c: Command, query: string) =>
  c.keywords?.includes(query.trim().toLowerCase()) ? fuzzy(query, c.keywords) - 1 : -1

/** A palette row: the command, and why it cannot run now (unset = it can). */
export interface Ranked { c: Command; off?: string }

/**
 * The palette's order for a query: matches by score, the ones that can run
 * now first, then the rest greyed with their reason — so "align" with nothing
 * selected teaches what align needs instead of saying it does not exist.
 * Empty query: what can run now, recently used first. (Keys never see the
 * greyed ones: dispatch still honours `when`.)
 */
export function rank(cmds: Command[], query: string): Ranked[] {
  const recent = lsJson<string[]>(RECENT, [])
  const rows = cmds.map((c): Ranked => (!c.when || c.when() ? { c } : { c, off: c.why?.() ?? t('Not available right now') }))
  if (!query.trim()) {
    const r = (x: Ranked) => { const i = recent.indexOf(x.c.id); return i < 0 ? 1e9 : i }
    return rows.filter((x) => !x.off).sort((a, b) => r(a) - r(b))
  }
  return rows
    // the id and the keywords too, a little lower: they hold the other tools'
    // words ("distribute-x" for "Space evenly across", "line up" for align),
    // so a Figma or PowerPoint habit finds the command
    .map((x) => ({ ...x, s: Math.max(fuzzy(query, t(x.c.label)), fuzzy(query, x.c.label), fuzzy(query, x.c.id.replace(/-/g, ' ')) - 1, kw(x.c, query)) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => Number(!!a.off) - Number(!!b.off) || b.s - a.s)
}

/** ⌘K: search every command, ↑↓ to choose, Enter runs, Esc closes. */
export function openPalette(cmds: Command[]) {
  document.querySelector('.ed-cmdk-overlay')?.remove()
  const opener = document.activeElement as HTMLElement | null
  const overlay = document.createElement('div')
  overlay.className = 'ed-cmdk-overlay'
  const box = document.createElement('div')
  box.className = 'ed-cmdk'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', t('Command palette'))
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'ed-cmdk-input'
  input.placeholder = t('Type a command…')
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-controls', 'ed-cmdk-list')
  const list = document.createElement('ul')
  list.className = 'ed-cmdk-list'
  list.id = 'ed-cmdk-list'
  list.setAttribute('role', 'listbox')
  box.append(input, list)
  overlay.appendChild(box)

  let shown: Ranked[] = []
  let at = 0
  const paint = () => {
    shown = rank(cmds, input.value)
    at = Math.min(at, Math.max(0, shown.length - 1))
    list.replaceChildren(...shown.map(({ c, off }, i) => {
      const li = document.createElement('li')
      li.id = `ed-cmdk-${i}`
      li.setAttribute('role', 'option')
      li.setAttribute('aria-selected', String(i === at))
      li.dataset.cmd = c.id
      const name = document.createElement('span')
      name.textContent = t(c.label)
      li.appendChild(name)
      if (off) {
        // greyed, with the reason inside the option, so it is part of its name
        li.setAttribute('aria-disabled', 'true')
        const why = document.createElement('span')
        why.className = 'ed-cmdk-why'
        why.textContent = off
        li.appendChild(why)
      }
      if (c.keys) {
        const keys = document.createElement('span')
        keys.className = 'ed-tip-keys'
        for (const k of c.keys.split(/\s*(?:·|or)\s*/)) {
          const kbd = document.createElement('kbd')
          kbd.textContent = k
          keys.appendChild(kbd)
        }
        li.appendChild(keys)
      }
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); runAt(i) })
      return li
    }))
    // nothing matched: the place for a fall-through row (ask the assistant,
    // find in the deck) once one exists; until then, say so
    if (!shown.length) {
      const li = document.createElement('li')
      li.className = 'ed-cmdk-empty'
      li.textContent = t('No matching command')
      list.appendChild(li)
    }
    input.setAttribute('aria-activedescendant', shown.length ? `ed-cmdk-${at}` : '')
    list.children[at]?.scrollIntoView?.({ block: 'nearest' })
  }
  // Esc and a run hand focus back to where ⌘K was pressed; a click elsewhere keeps its own
  const close = (restore = false) => { overlay.remove(); if (restore && opener?.isConnected) opener.focus({ preventScroll: true }) }
  // a greyed row never runs, and the palette stays open on it
  const runAt = (i: number) => {
    const { c, off } = shown[i] ?? {}
    if (!c || off) return
    close(true)
    lsSetJson(RECENT, [c.id, ...lsJson<string[]>(RECENT, []).filter((x) => x !== c.id)].slice(0, 8))
    c.run()
  }
  input.addEventListener('input', () => { at = 0; paint() })
  input.addEventListener('keydown', (e) => {
    e.stopPropagation() // the editor's own keys stay out of the palette
    if (e.isComposing || e.keyCode === 229) return // Enter ends an IME composition, it does not run
    if (e.key === 'Escape') { e.preventDefault(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % Math.max(1, shown.length); paint() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + shown.length) % Math.max(1, shown.length); paint() }
    else if (e.key === 'Enter') { e.preventDefault(); runAt(at) }
  })
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) close() }, 0))
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close() })
  document.body.appendChild(overlay)
  paint()
  input.focus()
}
