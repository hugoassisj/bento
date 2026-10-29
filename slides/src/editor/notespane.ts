// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// Speaker notes, in a pane under the canvas — where PowerPoint, Keynote and
// Google Slides keep them. They used to be a section of the slide's own panel,
// which only shows when NOTHING is selected: while you worked on an element,
// the notes for the slide you were looking at were nowhere on screen.
//
// The pane follows the current slide, and folds to its header (remembered).
// Editing matches the field it replaced: typing is one undo burst, closed by
// `change`; the slide is the one that was current when typing began, so a
// slide switch mid-edit cannot write the text onto the next slide.
import type { Store } from '../store'
import { t } from '../i18n'
import { lsGet, lsSet } from '../../../kernel/src/storage.ts'
import { isMacOS } from '../screens'

export function mountNotesPane(store: Store, into: HTMLElement, signal: AbortSignal) {
  const pane = document.createElement('section')
  pane.className = 'ed-notespane'
  const head = document.createElement('button')
  head.type = 'button'
  head.className = 'ed-section ed-sec-toggle ed-notespane-head' // the inspector's own section header
  head.textContent = t('Speaker notes')
  const area = document.createElement('textarea')
  area.className = 'ed-notespane-text'
  area.placeholder = t('Notes for presenter view (press S while presenting)…')
  area.title = t('Shown in the speaker view (Slideshow menu, or S while presenting).') +
    (isMacOS() ? ' ' + t('On macOS, open the speaker view before going fullscreen.') : '')
  pane.append(head, area)
  into.appendChild(pane)

  const setOpen = (open: boolean) => {
    pane.classList.toggle('closed', !open)
    head.classList.toggle('closed', !open)
    head.setAttribute('aria-expanded', String(open))
  }
  setOpen(lsGet('bento-notes-open') !== '0')
  head.addEventListener('click', () => {
    const open = pane.classList.contains('closed')
    setOpen(open)
    lsSet('bento-notes-open', open ? '1' : '0')
  })

  // the slide being typed into, fixed for the length of one burst
  let editing: string | null = null
  const write = (final: boolean) => {
    if (store.readOnly) return
    if (!editing) { editing = store.slide.id; store.checkpoint() }
    const slide = store.slideById(editing)
    if (slide) { slide.notes = area.value; store.touch() }
    if (final) editing = null
  }
  area.addEventListener('input', () => write(false))
  area.addEventListener('change', () => write(true))

  // Follow the slide, and remote edits — but never under a caret.
  const sync = () => {
    area.readOnly = store.readOnly
    if (document.activeElement === area) return
    const v = store.slide?.notes ?? ''
    if (area.value !== v) area.value = v
  }
  area.addEventListener('blur', sync) // a slide may have changed while it held the caret
  const offs = [store.on('current', sync), store.on('doc', sync)]
  signal.addEventListener('abort', () => offs.forEach((off) => off()), { once: true })
  sync()
}
