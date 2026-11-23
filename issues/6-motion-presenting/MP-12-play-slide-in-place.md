---
id: MP-12
title: "Play slide in place"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:motion"]
depends_on: []
related: [MP-02, MP-04, MP-05, MP-01]
upstream: []
---
## Summary

There is no way to watch a slide's motion without entering the show. "Play transition" starts a tab-filling slideshow on the previous slide, steps once, and leaves you in the show until you press Esc. Loops, pan and zoom, and count-up never move on the canvas, and only the Entrance effect previews (on hover over its option). Add a "Play slide" control that runs the incoming transition, entrances and click steps on the editor stage and returns to editing by itself.

## What the user experiences

A speaker tuning a slide wants the Keynote loop: change a value, press Preview, watch, change again. Here:

- Pressing "▶ Play transition" replaces the editor with the slideshow. After the morph plays they are still in the show, on this slide, and must press Esc to get back. Every check costs two extra actions and a context switch.
- A looping element, a pan-and-zoom background and a count-up number sit still on the canvas. The only way to see them is to present.
- Build steps cannot be played in order from the editor at all.

## Reproduce

1. Open the Showcase deck, select slide 4 ("Morph."), deselect everything, open Animate.
2. Click "▶ Play transition". The editor is replaced by a tab-fill show on slide 3, which steps to slide 4 after a pause and stays there.
3. Press Esc to return.
4. Select slide 3 (the count-up numbers). On the canvas the numbers are static; nothing in the Animate tab plays them.
5. Select any element with a Loop animation or Pan & zoom. On the canvas it does not move.
6. Select an element, open Animate, hover an Entrance option: this one does preview on the canvas.

## Evidence

Observed in the running app (audit journey 3): steps 2 to 6; for loop, pan and zoom and count-up the element's `getBoundingClientRect()` and text were unchanged at 300 ms and 600 ms. Typewriter was not exercised.

Confirmed in code at `29b5c80`:

- `playTransition()` (`slides/src/editor/editor.ts:2773-2780`) calls `this.present(false, false, <index of the source slide>)`, a real show in the tab, then `setTimeout(() => show.goTo(here), 700)`. The comment calls the 700 ms "a fixed beat for the show to settle before stepping; a ready event if it ever jumps".
- The same wait is recorded as a known ceiling in `docs/DECISIONS.md:12198-12199`: "Play transition waits a fixed 700ms before stepping, because the show has no ready signal".
- The button is built at `slides/src/editor/inspector/animate.ts:120-129` with the tooltip "Present from the slide before and step into this one"; it is also a command (`play-transition`, `slides/src/editor/editor.ts:3853`) and Shift-click on the Slideshow pill (`slides/src/editor/editor.ts:608`).
- `slides/src/editor/fxpreview.ts` previews exactly two things: a shadow preset and an entrance (`previewEnter`, lines 34-47). There is no preview for loop, ken burns, count-up, typewriter or steps.
- The morph scrub slider exists (`slides/src/editor/inspector/animate.ts:109-118`, "Morph preview") and plays the morph on the canvas by value, so an on-stage morph renderer is already available to reuse.

## How others do it

- **Keynote**: the Animate sidebar has a Preview button that plays the selected build, or the slide's transition, on the canvas and stops.
- **PowerPoint**: Animations ▸ Preview plays the slide's animations in place; "Play From" in the Animation Pane plays from a chosen effect.
- **Figma**: prototype preview opens beside the canvas and does not replace the editor; Smart Animate can be scrubbed.

## Proposed change

Slides app only; no format change.

1. **A stage player.** Add `slides/src/editor/playslide.ts` exporting `playSlide(editor, { from })`. It renders the current slide into an overlay that covers the stage area only (same box as `.ed-stage-scale`), not the tab, and removes itself when finished or on Esc or click.
2. **Sequence**, driven by the shared animation engine (`slides/src/anim.ts`) and the show's own helpers so the editor and the show cannot disagree:
   - incoming transition from the walk source (reuse the morph steppers behind the Morph preview slider; for non-morph transitions run the same transition the show runs);
   - entrances in order (`enterSpec` from `slides/src/present.ts`, already imported by `fxpreview.ts`);
   - then each click step in turn with a short fixed gap (`stepsOf`/`shownAt` from `slides/src/steps.ts`);
   - loops, pan and zoom and count-up run for the duration of the play.
3. **Controls.** Replace the "▶ Play transition" button with "▶ Play slide" in the slide's Animate tab, and add a small ▶ beside the Slideshow pill or keep it in the tab only (decide once, record it). Keep "Play transition" as the Shift-click behaviour or drop it; do not leave two near-identical buttons.
4. **Ready signal.** If the implementation still needs the real show for anything, replace the 700 ms timer with a ready callback from `present()` and delete the ceiling from the comment.
5. **Reduced motion.** With `prefers-reduced-motion`, play as the show plays under reduced motion.

Rejected: playing on the live canvas nodes directly. `fxpreview.ts` does that for one entrance, but steps and transitions would have to hide and restyle nodes Moveable is attached to, and a mid-play edit would commit a transient state.

New strings ("Play slide", its tooltip) go through `t()` and into all eight catalogs; remove the now-unused keys in the same change or the dead-key gate fails.

## Acceptance criteria

- [ ] "Play slide" plays the incoming transition, then entrances, then each build step in order, inside the stage area, and returns to the editor with the selection and scroll position unchanged, with no extra key press.
- [ ] Esc or a click stops the play immediately and restores the editor.
- [ ] Loop, pan and zoom and count-up visibly run during the play (measured by geometry or text change, not by style read-back).
- [ ] The document is byte-identical before and after a play (no undo entry, `window.bento.serialize()` unchanged).
- [ ] On a slide with no walk source the transition part is skipped and the rest plays.
- [ ] The fixed 700 ms wait is gone or no longer on the default path.
- [ ] Works in dark and light chrome and at 66% and 100% zoom.
- [ ] `tsc -b`, `npm run build:single` pass; byte cost recorded.

## Tests

Add `scripts/test-slides-play-slide-browser.mjs` (browser rig, registered in `.github/workflows/ci-slides.yml`). Model it on `scripts/test-slides-reveal-preview-browser.mjs` and `scripts/test-slides-morph-render-browser.mjs`:

- Build a two-slide deck with a morph pair, one entrance, two steps and a count-up.
- Trigger Play slide, step the engine with `window.bento.anim.setManual(true)` and `tick()`, and assert by `getBoundingClientRect` that the morphing element moves, the stepped elements appear in order, and the count-up text changes.
- Assert the player overlay is gone at the end and `serialize()` is unchanged.

## Out of scope

- A build-order list (MP-02) and per-paragraph steps (MP-01).
- Duration and easing controls (MP-04, MP-05).
- A timeline editor.

## Notes for the implementer

- Hot files: `slides/src/editor/editor.ts`, `slides/src/editor/inspector/animate.ts`, `slides/src/present.ts`.
- `docs/DECISIONS.md` lines 12190-12199 describe the Morph preview and Play transition as shipped; append an entry if you change either.
- Read the root `CLAUDE.md` "Testing gotcha" first: a transform on an inline element does nothing, and `requestAnimationFrame` is zero in a hidden tab.
- The size of the show code already in the shell is the budget argument: reuse `present.ts` exports rather than re-implementing sequencing.
