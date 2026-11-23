---
id: MP-10
title: "Speaker view: build steps, notes font size, timer pause and countdown"
epic: 6-motion-presenting
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:present"]
depends_on: []
related: [MP-01, MP-07, MP-11]
upstream: []
---
## Summary

The speaker view is where a presenter decides what to say next, and on a slide with click builds it misleads: the "current" preview shows the slide fully built whatever the audience sees, and "Next" always shows the next slide even when the next click only reveals a bullet. Notes are one fixed size. The timer counts up and can be reset, nothing else. Make the previews follow the build, let the presenter size the notes, and give the timer pause and a countdown.

## What the user experiences

- On a slide with four builds the audience sees the title only; the presenter's "current" pane already shows all four items, and "Next" shows a different slide. The presenter cannot see what the next click will do. The only hint is a small counter reading "3 / 15 · 0/4".
- Notes are 24 px. On a laptop a metre away that is too small for some and too large for long notes; there is no A− / A+.
- The timer starts when the speaker view opens. Clicking it resets it. It cannot be paused during a break, and there is no "20 minutes remaining" mode or any pacing signal.

## Reproduce

1. Fresh load. Start from scratch, add three text boxes, select them, Animate ▸ Reveal ▸ In order. Add a second slide.
2. Start the slideshow on slide 1 and press S to open the speaker view.
3. Observe before pressing →: the audience window shows none of the three boxes; the speaker "current" pane shows all three; "Next" shows slide 2.
4. Press → once: the audience shows one box; the speaker panes are unchanged; the counter reads `1 / 2 · 1/3`.
5. Look for a notes size control and a timer pause: there are none. Click the timer: it resets to 00:00.

## Evidence

- Reported by the motion and presenting journey from code reading; not driven in the running app there. One part of the earlier report is **wrong** and is corrected here: the speaker view does show a step counter.
- Confirmed in code now:
  - Step counter exists: `.sv-count` is set to `` `${visibleIndex(cur)} / ${visibleTotal}` + (max ? ` · ${steps.step}/${max}` : '') `` (`slides/src/present.ts:856-860`).
  - Previews ignore steps: `svSlide` renders the whole slide with `renderSlide(doc.slides[idx], doc, { hidePlaceholders: true })` (`present.ts:830-846`), and `updateSpeaker` fills "current" with `svSlide(cur)` and "next" with `svSlide(nextVisibleIndex(cur))` (`present.ts:986-1001`).
  - A step change does not refresh the previews: `revealStep` and `hideStep` call `updateSpeakerControls()` only (`present.ts:175-197`); `updateSpeaker()` runs on slide changes (`present.ts:1168`, `1418`, `1573`).
  - The show hides stepped elements with a class scoped to the show overlay: `.bento-present-overlay .bento-step-hidden { visibility: hidden !important }` (`slides/src/styles.css:1993`), so the speaker document has no equivalent rule.
  - Notes: `.sv-notes { font-size: 24px; line-height: 1.65 }` (`styles.css:1894-1903`); content is set as plain text (`present.ts:999-1000`).
  - Timer: `speakerStart = performance.now()` on open, reset on click, repainted every second with the wall clock beside it (`present.ts:1087-1099`). No pause, no target.

## How others do it

- **PowerPoint Presenter View**: the next pane shows the next **build** ("Next Animation") until the slide is complete; notes have A+ / A− buttons; the timer has pause and restart.
- **Keynote presenter display**: "Next build" indicator and dots for remaining builds, a customisable layout with notes size, a timer that can be elapsed or remaining with a target time, and a ready-to-advance light.

## Proposed change

All in `slides/src/present.ts` and `slides/src/styles.css`; no format change.

1. **Step-aware previews.**
   - Give `svSlide` an optional `step` argument. After rendering, hide the nodes of elements where `!shownAt(el, step)` (import `shownAt` from `slides/src/steps.ts`; hide by setting `visibility: hidden` through a class that exists in the speaker document's stylesheet).
   - "Current" renders at `steps.step`.
   - "Next" renders the **same slide at the next step** while `steps.hasNext()`, labelled "Next click", with the element(s) about to appear outlined; once the slide is fully built it shows the next slide as today, labelled "Next slide".
   - Call a light refresh from `revealStep` and `hideStep`. Re-rendering both panes per click is acceptable; if it flickers, toggle the hiding class on the existing nodes instead of rebuilding.
   - Replace the bare `· 1/3` with dots or "Click 1 of 3" next to the counter.
   - If MP-01 has landed, hide per paragraph using its helper.
2. **Notes size.** A−, A+ and reset buttons in the notes pane header changing a CSS variable on `.sv-notes` in steps (for example 16–48 px). Persist per browser in localStorage (the speaker layout already persists pane sizes: follow `slides/src/speakerlayout.ts`). Keyboard: `-` and `=` in the speaker window.
3. **Timer.**
   - Click toggles pause/resume (elapsed time is kept across pauses); a small reset button replaces click-to-reset; update the tooltip.
   - A "Target" entry in the speaker view's View menu sets a duration in minutes for this browser session; with a target the timer shows remaining time, turns amber in the last 10% and red past zero (then counts up with a minus sign). No target stored in the document.
   - Space must keep advancing the show, so the timer control is a button that does not take Space when unfocused.
4. Keep everything working when the speaker window is adopted from the editor (`speakerAdopted`) and when the deck is not ready yet (`deckReady`).

Strings in every catalog: "Next click", "Next slide", "Click {n} of {m}", "Smaller notes", "Larger notes", "Pause timer", "Resume timer", "Reset timer", "Target time", "Remaining".

Rejected: storing a per-slide target time in the document (belongs to a rehearse feature, MP-17); a second popup for the timer.

## Acceptance criteria

- [ ] On a slide with three builds at step 0, the speaker "current" pane shows none of the three stepped elements (their rects in the speaker document have `visibility: hidden` ancestors or zero rendered presence; assert via `getComputedStyle(node).visibility === 'hidden'` on the cloned nodes plus a screenshot diff, not a class read-back alone).
- [ ] After one →, exactly one stepped element is visible in "current", and "Next" shows the same slide with two visible, labelled "Next click".
- [ ] After the last build, "Next" shows the following slide, labelled "Next slide".
- [ ] ← restores the previous state in both panes.
- [ ] A+ three times increases the computed font size of `.sv-notes`; reopening the speaker view keeps it.
- [ ] Pause stops the timer text changing for 3 s; resume continues from the paused value; reset returns to 00:00.
- [ ] With a 1-minute target the timer counts down and changes colour state at the thresholds (assert the state class and the text at mocked times).
- [ ] The speaker window's existing keys (→, ←, B, G, L, M, Home, End) still work.

## Tests

- Add `scripts/test-slides-speaker-steps-browser.mjs` (register in `.github/workflows/ci-slides.yml` next to `test-slides-speaker-layout-browser.mjs`): build the three-step slide, open the speaker popup via `context.waitForEvent('page')`, assert pane contents at each step, the labels, notes sizing persistence, and timer pause using a controllable clock (`page.clock` or an injected `performance.now`).
- Run `scripts/test-slides-speaker-layout-browser.mjs` and `scripts/test-slides-speaker-links-browser.mjs` unchanged.

## Out of scope

- Laser pointer from the speaker view (MP-11).
- Rehearsal timings and auto-advance (MP-17).
- A second-monitor audience window (MP-18).
- Black-screen behaviour (MP-07).

## Notes for the implementer

- Slides app only. The speaker view is a separate window whose document is written by `openSpeaker`; styles reach it through whatever that function injects, so check the new class is present there.
- `present.ts` is about 2,700 lines and a conflict magnet; MP-07, MP-08, MP-09 and MP-11 touch the same file. Sequence them or keep each diff inside its own functions.
- The audience on a live broadcast follows steps through `nav` frames (`present.ts:817`); nothing here changes what is sent.
