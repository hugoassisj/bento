// SPDX-License-Identifier: MIT
// Copyright (c) 2026 The Bento authors
//
// Play slide: the slide's motion, played on the editor stage — the incoming
// transition from the slide the show arrives from, the entrances, then each
// build step — after which the editor is back as it was, with no key press.
//
// It never touches the live canvas. The two slides are rendered afresh into
// an overlay inside `.ed-stage-scale` (the same box, the same zoom), and every
// tween runs on those throwaway nodes, so Moveable's targets are never hidden
// or restyled, nothing is committed, and stopping anywhere is just removing
// the overlay. The motion itself is the show's own (present.ts runArrivalFx,
// runRevealFx, applyStep, steps.ts StepState); only Reveal's CSS section
// transitions are re-drawn here, from the same data-transition value.

import type { BentoDoc } from '../model'
import { renderSlide } from '../render'
import { anim } from '../anim'
import { StepState } from '../steps'
import { walkSource } from './morph'
import {
  applyRevealSet, applyStep, configureMotion, forgetSlideSymbols, measureSlideSymbols,
  reduceMotionPreferred, runArrivalFx, runRevealFx, sectionTransition, stopFxIn,
} from '../present'

/** Reveal's default section transition (transitionSpeed 'default'). */
const TRANSITION = 0.8
/** How long the slide the show arrives from is shown before it leaves. */
const LEAD_IN = 0.4
/** The beat between one build step and the next. */
const STEP_GAP = 1.1
/** A slide with loops, pan and zoom or svg animation stays up this long after
 *  it arrives, so the motion is seen; any other ends a beat after its last step. */
const AMBIENT_HOLD = 3.5
const END_HOLD = 0.6

export interface SlidePlay { stop(): void }

/**
 * Play slide `index` inside `stage` (the canvas's `.ed-stage-scale`). Ends by
 * itself, on Esc, or on a click; `onEnd` runs once, however it ended.
 */
export function playSlide(stage: HTMLElement, doc: BentoDoc, index: number, onEnd: () => void): SlidePlay {
  const slide = doc.slides[index]
  const src = walkSource(doc, slide)
  const srcIdx = src ? doc.slides.indexOf(src) : -1
  const reduce = reduceMotionPreferred()
  const morphSecs = configureMotion(doc)

  const overlay = document.createElement('div')
  overlay.className = 'ed-play-overlay'
  overlay.style.width = `${doc.size.width}px`
  overlay.style.height = `${doc.size.height}px`
  const surface = (i: number) => {
    const s = doc.slides[i]
    const node = renderSlide(s, doc, { hidePlaceholders: true })
    node.classList.add('ed-play-layer')
    if (s.hover?.type === 'reveal') applyRevealSet(node, s.hover.default ?? null, s.hover.default)
    return node
  }
  const to = surface(index)
  const from = srcIdx >= 0 && !reduce ? surface(srcIdx) : undefined
  // the show arrives with the steps hidden (forward) — StepState decides
  const steps = new StepState<(typeof slide.elements)[number]>()
  steps.enter(slide.elements, true)
  applyStep(to, slide, steps.step)
  if (from) { to.style.visibility = 'hidden'; overlay.append(from) }
  overlay.append(to)
  stage.appendChild(overlay)
  // Focus leaves the control that started it (Enter or Space on ▶ would
  // otherwise start it again) and comes back when the play ends on its own
  // or by Esc or a click on the stage.
  const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
  opener?.blur()

  // One clock for the whole play, on the shared engine: a manual clock
  // (window.bento.anim.setManual) steps it like every tween it starts.
  const clock = {}
  const after = (secs: number, fn: () => void) => { anim.to(clock, { duration: secs, ease: 'none', onComplete: fn }) }

  let done = false
  const finish = (refocus: boolean) => {
    if (done) return
    done = true
    anim.killTweensOf(clock)
    stopFxIn(overlay)
    forgetSlideSymbols()
    overlay.remove()
    window.removeEventListener('keydown', onKey, true)
    for (const t of POINTER) window.removeEventListener(t, onPointer, true)
    if (refocus && opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) opener.focus({ preventScroll: true })
    onEnd()
  }
  const stop = () => finish(false)

  // Esc, Enter, Space and a click on the stage stop it and are spent doing
  // so: the editor never sees them, so the selection survives and no edit
  // starts. Any other key, or a press anywhere else, stops it first and then
  // does what it does (a thumbnail, a field, an arrow) — on the canvas you
  // can see, never on the slide hidden under the play.
  const SPENT = new Set(['Escape', 'Enter', ' ', 'Spacebar'])
  const onKey = (ev: KeyboardEvent) => {
    if (/^(Shift|Control|Alt|AltGraph|Meta|CapsLock|Fn|OS|Hyper|Super)$/.test(ev.key)) return
    if (SPENT.has(ev.key)) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
      finish(true)
      return
    }
    stop()
  }
  const POINTER = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const
  const onPointer = (ev: Event) => {
    if (!overlay.contains(ev.target as Node)) {
      if (ev.type === 'pointerdown' || ev.type === 'touchstart') stop()
      return
    }
    ev.preventDefault()
    ev.stopImmediatePropagation()
    // the rest of the gesture lands on the overlay too, then it goes
    if (ev.type === 'click' || ev.type === 'contextmenu') finish(true)
  }
  window.addEventListener('keydown', onKey, true)
  for (const t of POINTER) window.addEventListener(t, onPointer, { capture: true, passive: false })

  const ambient = slide.elements.some((el) => el.fx?.loop || el.fx?.ambient === 'kenburns')
    || !!to.querySelector('.bento-el-svg animate, .bento-el-svg [style*="animation"], .bento-el-svg style')
  const enters = slide.elements.filter((el) => el.fx?.enter || el.fx?.countUp || el.fx?.typeWriter)

  const arrive = () => {
    if (done) return
    let settle = 0
    if (reduce) {
      // as the show plays under reduced motion: no transition, no fx — the
      // slide at its final frame, the steps still revealed one by one
      to.style.visibility = ''
    } else {
      const morphing = !!from && slide.transition === 'morph'
      if (from) {
        measureSlideSymbols(doc, from, srcIdx) // while it is on screen
        to.style.visibility = ''
        settle = transitionLayers(from, to, sectionTransition(doc, srcIdx), sectionTransition(doc, index), doc.size.width)
      }
      runArrivalFx(doc, from, to, srcIdx, index, morphing, steps.step)
      if (morphing) settle = Math.max(settle, morphSecs + 0.45)
      // the show's stagger: 0.12s, then 0.05s per element; a count-up 1.3s
      if (enters.length) settle = Math.max(settle, 0.12 + Math.min(enters.length, 24) * 0.05 + 0.75)
      if (enters.some((el) => el.fx?.countUp)) settle = Math.max(settle, 1.3)
      if (enters.some((el) => el.fx?.typeWriter)) settle = Math.max(settle, 2.5)
    }
    // seconds since the slide arrived, on the play's own clock
    let since = 0
    const wait = (secs: number, fn: () => void) => { since += secs; after(secs, fn) }
    const next = () => {
      if (done) return
      const r = steps.next()
      if (r.kind === 'step') {
        applyStep(to, slide, r.step)
        if (!reduce) runRevealFx(slide, to, r.reveal)
        wait(STEP_GAP, next)
        return
      }
      wait(ambient && !reduce ? Math.max(END_HOLD, AMBIENT_HOLD - since) : END_HOLD, () => finish(true))
    }
    wait(Math.max(settle, 0.3) + (steps.hasNext() ? 0.4 : 0), next)
  }

  if (from) after(LEAD_IN, arrive)
  else arrive()
  return { stop }
}

/**
 * Reveal's section transitions, drawn on the two layers: the outgoing slide
 * leaves by ITS transition, the incoming one arrives by its own (Reveal reads
 * each section's data-transition for its own side). Returns the seconds taken.
 */
function transitionLayers(from: HTMLElement, to: HTMLElement, outRaw: string, innRaw: string, width: number): number {
  // a value Reveal has no rule for gets the deck's default, fade (present.ts)
  const known = (v: string) => (v === 'none' || v === 'slide' || v === 'zoom' ? v : 'fade')
  const out = known(outRaw), inn = known(innRaw)
  const vars = { duration: TRANSITION, ease: 'power2.out' }
  let took = 0
  if (out === 'fade') { anim.fromTo(from, { opacity: 1 }, { opacity: 0, ...vars }); took = TRANSITION }
  else if (out === 'slide') { anim.fromTo(from, { x: 0 }, { x: -1.5 * width, ...vars }); took = TRANSITION }
  else if (out === 'zoom') { anim.fromTo(from, { scale: 1, opacity: 1 }, { scale: 16, opacity: 0, transformOrigin: '50% 50%', ...vars }); took = TRANSITION }
  else from.style.visibility = 'hidden'
  if (inn === 'fade') { anim.fromTo(to, { opacity: 0 }, { opacity: 1, ...vars }); took = TRANSITION }
  else if (inn === 'slide') { anim.fromTo(to, { x: 1.5 * width }, { x: 0, ...vars }); took = TRANSITION }
  else if (inn === 'zoom') { anim.fromTo(to, { scale: 0.2, opacity: 0 }, { scale: 1, opacity: 1, transformOrigin: '50% 50%', ...vars }); took = TRANSITION }
  return took
}
