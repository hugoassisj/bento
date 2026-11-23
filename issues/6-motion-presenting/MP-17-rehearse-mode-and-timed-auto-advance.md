---
id: MP-17
title: "Rehearse mode and timed auto-advance"
epic: 6-motion-presenting
type: enhancement
priority: P3
size: M
evidence: code
labels: [enhancement, "priority:P3", "size:M", "evidence:code", "area:present", "format-change"]
depends_on: [MP-10]
related: [MP-10, MP-18, MP-01]
upstream: ["nyblnet/bento discussion #822"]
---
## Summary

Two related gaps in presenting. First, a deck cannot play by itself: there is no per-slide timer, no loop, no kiosk mode (upstream discussion #822, "Standalone slideshow", no maintainer reply yet). Second, a speaker cannot rehearse against the clock: the speaker view has one elapsed timer and no record of how long each slide took. Add an optional per-slide auto-advance time, and a rehearse mode that records per-slide times in the browser, not in the file.

## What the user experiences

- Someone wants a deck to run unattended on a screen at a booth. Every slide needs a key press.
- A speaker preparing a 20-minute talk runs through it and at the end knows only the total. They cannot see that slide 7 took four minutes.

## Reproduce

1. Open any deck, deselect, and look through the slide's Format and Animate tabs: no "advance after" control.
2. Start the show and wait: nothing advances.
3. Open the speaker view: one timer (click resets it), a clock, a slide counter. No per-slide time, no pause, no target.
4. Search the source for an auto-advance key: none.

## Evidence

Read in code at `29b5c80`; this issue is about absent behaviour, and nothing here was "seen" beyond the absence:

- `Slide` (`slides/src/model.ts:646-703`) and `doc.present` (`slides/src/model.ts:790` onward: `numberHidden`, `slideNumber`, `controls`, `progress`, and timing keys for morph and typewriter) have no auto-advance, loop or timing field.
- Reveal's own auto-slide is compiled out of the shell: `slides/reveal-lite.ts:89-90` ("autoSlide: 0 — the play/pause ring is never built"), and its playback controller is on the stub list (`slides/reveal-lite.ts:120`). Using it would mean un-stubbing it first, which `docs/DECISIONS.md` ("The slides shell diet") says to avoid. Do not use Reveal's auto-slide.
- Navigation in the show goes through `goNext`/`goPrev`/`hasNext` (`slides/src/present.ts:199-216`); slide changes arrive on `deck.on('slidechanged', …)` (`slides/src/present.ts:1355`).
- The speaker timer is a single start time: `let speakerStart = 0` (`slides/src/present.ts:777`), set when the speaker view opens and on click (`slides/src/present.ts:1087-1088`), rendered as mm:ss (`slides/src/present.ts:1092-1094`).

Upstream: discussion #822 asks for "an optional setting to make the deck play without needing to advance the slides", with a timer per page.

## How others do it

- **PowerPoint**: Transitions ▸ Advance Slide ▸ "After: 00:05"; Slide Show ▸ Rehearse Timings records per-slide times and offers to keep them as the advance times; Set Up Slide Show ▸ "Browsed at a kiosk" and "Loop continuously".
- **Keynote**: per-slide "Start Transition: Automatically" with a delay; Document ▸ Slideshow type "Self-Playing" with a default delay, and "Loop slideshow"; Play ▸ Rehearse Slideshow.
- **Google Slides**: auto-advance only when published to the web, with a fixed interval and loop.

## Proposed change

Two parts that can land separately. Part 1 needs no format change and should go first.

### Part 1: rehearse mode (no format change)

In `slides/src/present.ts` and the speaker view:

1. Record, per show session, the time spent on each slide (by slide id) and the total. Keep it in memory and in `localStorage` keyed by `docId`, never in the document.
2. Speaker view additions next to the timer: time on this slide, and after the first rehearsal, the previous run's time for this slide with an over or under indication.
3. A "Rehearse" entry in the Slideshow menu that opens the speaker view alone (no audience window needed) and shows a summary table at the end: slide, title, time, share of total.
4. Timer pause and a target duration belong to MP-10; build on that, do not duplicate it.

### Part 2: timed auto-advance (format change)

Proposed optional keys:

- `Slide.advanceAfter?: number` — seconds. Absent means manual, as today.
- `doc.present.autoAdvance?: number` — a deck-wide default for slides without their own value. Absent means manual.
- `doc.present.loop?: boolean` — after the last slide, start again at the first.

Behaviour to specify in the change:

- The timer drives the same "next" as the arrow key, so a slide with click steps reveals a step per interval and then moves on. (PowerPoint's "After" also waits for animations.)
- Any manual navigation restarts the timer for the new position. A visible pause control (and the Space key convention, if free) pauses and resumes; say which key.
- Hidden slides and state slides are skipped exactly as manual navigation skips them.
- With a live audience, only the presenter's timer advances; followers follow as today.
- Reduced motion does not disable auto-advance; it only affects transitions.
- An older shell ignores the keys and the deck is simply manual.

UI: a "Advance after … s" number field in the slide's Animate tab under Transition; "Play automatically" and "Loop" in the Deck section. After a rehearsal, offer "Use these times for auto-advance" which writes `advanceAfter` per slide in one undo step.

Mechanics for the keys: `slides/src/model.ts` doc comments, `node scripts/build-modelkeys.mjs`, `node scripts/build-schema.mjs`, gate in `slides/src/untrusted.ts` (finite number, sensible bounds), `docs/format.md`, `docs/agents.md`.

Rejected: a URL parameter only (`?autoSlide=N` is what Reveal reads). It does not survive mailing the file and cannot be set per slide.

## Acceptance criteria

Part 1:
- [ ] After a rehearsal the speaker view shows the time spent on each slide and the total; values survive a reload in the same browser.
- [ ] Nothing about timings appears in `window.bento.serialize()`.
- [ ] A second rehearsal shows the previous run's time per slide for comparison.

Part 2:
- [ ] A slide with `advanceAfter: 3` moves on after 3 seconds (±0.3 s) with no input; a slide without it waits when no deck default is set.
- [ ] On a slide with two click steps and `advanceAfter: 2`, both steps reveal at 2 s intervals before the slide changes.
- [ ] `present.loop` returns to the first linear slide after the last.
- [ ] Manual navigation and the pause control behave as specified; pausing is visible to the presenter.
- [ ] The document opens and presents manually in the 1.3.0 shell.
- [ ] `build-modelkeys --check`, `build-schema --check` and `test-schema-frozen` pass.

## Tests

- Node rig `scripts/test-slides-autoadvance.ts`: the pure scheduling function (given slide, steps, defaults and loop, what happens after each interval). Register in `.github/actions/validate-slides/action.yml`.
- Browser rig `scripts/test-slides-autoadvance-browser.mjs`: present a three-slide fixture with short times, drive time with `window.bento.anim.setManual(true)`/`tick()` if the timer runs on the engine, otherwise use real time with generous tolerances; assert the show's counter. Keep the tab visible: timers and `requestAnimationFrame` are throttled when hidden.
- Rehearse: assert the recorded per-slide times against scripted navigation.

## Out of scope

- Recording narration or exporting video (upstream discussion #570).
- A countdown or pace colour on the timer (MP-10).
- Audience view in its own window (MP-18).
- Per-step delays or "after previous" sequencing (MP-02).

## Notes for the implementer

- Part 2 is a `format-change`: write the keys, defaults and old-shell behaviour into the change, and expect upstream to want the keys proposed first. #822 has no maintainer reply.
- Hot file: `slides/src/present.ts`. MP-07 to MP-11 also edit it.
- Do not un-stub Reveal's auto-slide; implement the timer in `present.ts`.
