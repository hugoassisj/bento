// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
// The speaker view's timer: elapsed time that can pause, or the time left
// against a target. Presenter chrome only: none of it enters the document.
import { t } from './i18n'

// The target outlives a show, like the speaker layout: set it once, rehearse,
// present. It lasts as long as this page and is never stored anywhere.
let target: number | null = null

export type TimerState = 'normal' | 'warn' | 'over'

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

/** What the timer shows after `elapsed` ms, with or without a target (ms).
 *  With one: the time left, amber in its last 10 %, red once a whole second
 *  over, then the overrun counting up with a minus sign (00:00 until then). */
export function timerFace(elapsed: number, goal: number | null): { text: string; state: TimerState } {
  if (!goal) return { text: mmss(Math.floor(elapsed / 1000)), state: 'normal' }
  const left = goal - elapsed
  if (left <= -1000) return { text: `−${mmss(Math.floor(-left / 1000))}`, state: 'over' }
  return { text: mmss(Math.ceil(Math.max(0, left) / 1000)), state: left <= goal * 0.1 ? 'warn' : 'normal' }
}

/** Set a control's tooltip. While the pointer rests on it the app's hints
 *  have borrowed the title (editor/hints.ts), so the change goes there. */
function tip(el: HTMLElement, text: string) {
  if (el.dataset.hint === undefined) { el.title = text; return }
  el.dataset.hint = text
  if (el.dataset.hintAria === 'aria-description') el.setAttribute('aria-description', text)
}

/** Wire the timer in a freshly written speaker body. A click on the time
 *  pauses or resumes it, the small button beside it resets it, and View gets
 *  a target in minutes. Returns the teardown. */
export function setupSpeakerTimer(w: Window): () => void {
  const d = w.document
  const face = d.querySelector<HTMLButtonElement>('.sv-timer')!
  const clock = d.querySelector<HTMLElement>('.sv-clock')
  const mode = d.createElement('span')
  mode.className = 'sv-timer-mode'
  face.before(mode)
  const reset = d.createElement('button')
  reset.type = 'button'
  reset.className = 'sv-timer-reset'
  reset.title = t('Reset timer')
  reset.setAttribute('aria-label', t('Reset timer'))
  reset.textContent = '↺'
  face.after(reset)

  // Time is read from this (the opener's) clock, so it keeps counting while
  // the popup sits behind another window.
  let start = performance.now()
  let banked = 0
  let paused = false
  const elapsed = () => banked + (paused ? 0 : performance.now() - start)
  const paint = () => {
    const f = timerFace(elapsed(), target)
    face.textContent = f.text
    face.classList.toggle('sv-timer-warn', f.state === 'warn')
    face.classList.toggle('sv-timer-over', f.state === 'over')
    face.classList.toggle('sv-timer-paused', paused)
    tip(face, paused ? t('Resume timer') : t('Pause timer'))
    mode.hidden = !target
    mode.textContent = f.state === 'over' ? t('Over') : t('Remaining')
    if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  // Repaint just after each whole second of the timer, so the text turns over
  // on the second rather than up to a second late.
  let tick = 0
  const schedule = () => {
    clearTimeout(tick)
    tick = window.setTimeout(() => {
      if (w.closed) return
      paint()
      schedule()
    }, paused ? 1000 : 1001 - (elapsed() % 1000))
  }
  face.addEventListener('click', () => {
    if (paused) { start = performance.now(); paused = false }
    else { banked = elapsed(); paused = true }
    paint()
    schedule()
  })
  reset.addEventListener('click', () => {
    banked = 0
    start = performance.now()
    paint()
    schedule()
  })

  const menu = d.querySelector('.sv-view-menu')
  if (menu) {
    const row = d.createElement('label')
    row.className = 'sv-target-row'
    const input = d.createElement('input')
    input.type = 'number'
    input.className = 'sv-target'
    input.min = '1'
    input.max = '600'
    input.step = '1'
    input.inputMode = 'numeric'
    input.value = target ? String(target / 60000) : ''
    const unit = d.createElement('span')
    unit.textContent = t('minutes')
    row.append(t('Target time'), input, unit)
    menu.appendChild(row)
    input.addEventListener('input', () => {
      const minutes = parseFloat(input.value)
      target = Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, 600) * 60000 : null
      paint()
      schedule()
    })
  }

  paint()
  schedule()
  return () => clearTimeout(tick)
}
