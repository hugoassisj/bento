---
id: MP-09
title: "Jump to a slide from the audience window: grid overlay, number then Enter"
epic: 6-motion-presenting
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:present"]
depends_on: [MP-08]
related: [MP-10, MP-07]
upstream: []
---
## Summary

During questions a speaker needs to jump straight to "slide 12". The all-slides grid exists only in the speaker window. In the main show window, typing a number and Enter does nothing, G shows nothing, and O opens Reveal's bare overview. Give the show window the same grid the speaker view has, and make "number, Enter" jump to that slide.

## What the user experiences

Presenting on one screen (no speaker view), someone asks to go back to the chart. The speaker's options are to hold ← through every slide and build, or to leave the show, click the thumbnail in the editor, and start presenting again. PowerPoint and Keynote habits (type 8, press Enter; or G for the grid) do nothing.

## Reproduce

1. Fresh load of the Showcase. Start the slideshow. Do not open the speaker view.
2. Type `3` then Enter. Nothing happens; the counter stays put.
3. Press `G`. Nothing visible happens.
4. Press `O`. A raw strip of slides appears (Reveal's overview); Esc closes it.
5. Press `S` to open the speaker view, then press `G` **in the speaker window**: a proper grid of numbered thumbnails appears, and clicking one jumps the show.

## Evidence

- Seen in the running app during the motion and presenting journey: G and "3 Enter" did nothing in the audience window (the G screenshot was re-checked in the main session: an unchanged slide); O showed an unstyled overview strip.
- Confirmed in code now:
  - The grid lives only inside `openSpeaker`: `thumb()` builds a numbered, clickable render of a slide, the rail and grid iterate `railIndices` (linear-flow slides only), and `toggleGrid` builds lazily (`slides/src/present.ts:1101-1130`). The speaker window binds G to it (`present.ts:1162`).
  - The audience window's key handler has no G and no digit handling (`present.ts:1281-1329`).
  - G in the audience window therefore reaches Reveal, whose keyboard controller toggles its own jump-to-slide box when `config.jumpToSlide` is on (`slides/node_modules/reveal.js/js/controllers/keyboard.js:365-368`); the show's config does not set that option, and a comment in `slides/reveal-lite.ts` (the location stub, ≈51) says the "jump-to-slide box" is meant to keep working. The audit saw **nothing** appear. Why is not established: either the box renders without usable styling, or it never opens. Find out before building.
  - O reaches Reveal's overview (`keyboard.js:394-399`); the show styles state slides in it (`slides/src/styles.css:1754-1756`) and lets Reveal close it on Esc (`present.ts:1283`), so the overview is a known, kept feature that simply looks raw.
  - Helpers that already respect states and hidden slides: `railIndices`, `visibleIndex`, `goFirst`, `goLast` (`present.ts:233-239`), `goTo` (`≈1472`).

## How others do it

- **PowerPoint**: type a slide number then Enter; G (or the minus key) opens See All Slides; Ctrl+S lists slide titles.
- **Keynote**: typing a number opens the slide navigator with thumbnails; Enter jumps.

## Proposed change

In `slides/src/present.ts`:

1. **Share the thumbnail builder.** Lift `thumb()` and the grid construction out of `openSpeaker` into a function that takes the target document and a "jump" callback, so the speaker window and the show overlay use one implementation. The speaker version imports nodes into the popup's document (`d.importNode`); the overlay version can append directly.
2. **Grid overlay in the show.** G toggles a full-stage grid of numbered thumbnails inside `.bento-present-overlay`, above the slide and below the laser. Current slide highlighted and scrolled into view. Arrow keys move a focus ring, Enter or click jumps, Esc or G closes **without** ending the show (the Esc branch at `present.ts:1282` must check the grid first, as it already does for Reveal's overview). Build lazily, as the speaker grid does. Reuse the `.sv-grid` / `.sv-thumb` styles by moving them to selectors both documents share, or add overlay-scoped copies.
3. **Number then Enter.** Digits typed in the show accumulate in a small on-screen chip ("Go to 12", bottom centre) that clears after about 1.5 s of inactivity or on Esc; Enter jumps to the slide whose **visible number** is that value (the number shown in the counter and on thumbnails, via `visibleIndex`), clamped to the deck; an out-of-range number shakes the chip and does nothing. Backspace edits.
4. **Replace O.** Once the grid exists, map O to it as well and stop exposing Reveal's overview (MP-08 turns Reveal's keyboard off; do this there or here, not both).
5. **Not for the audience.** The grid and chip are local chrome. They must not be streamed to a live audience (only the resulting `nav` is), and an audience copy that is locked to the presenter must not offer them (check `FollowState` in `slides/src/follow.ts`).
6. A jump lands on the slide with **no** steps revealed when going forward and all steps shown when going backward, matching `StepState.enter` (`slides/src/steps.ts:56-60`).

Strings in every catalog: "All slides", "Go to {n}", and the grid's accessible name. "All slides (G)" already exists for the speaker button; reuse the key where the text matches.

Rejected: styling Reveal's overview (it lays out real sections with inline transforms, includes state slides, and cannot show slide numbers); Reveal's jump-to-slide box (matches on Reveal's raw indices, which count state slides).

## Acceptance criteria

- [ ] In the show without a speaker view, G opens a grid containing exactly the linear-flow slides (no state slides), each showing its visible number.
- [ ] Clicking thumbnail n, or focusing it and pressing Enter, closes the grid and the counter reads `n / total`.
- [ ] Esc with the grid open closes the grid and keeps presenting; a second Esc ends the show.
- [ ] Typing `1`, `2`, Enter on a deck with at least 12 visible slides shows a "Go to 12" chip and lands on visible slide 12, even when hidden or state slides precede it.
- [ ] A number larger than the deck does not navigate.
- [ ] The grid and chip do not appear on a live audience copy or in the speaker window's audience preview, and are not available while an audience copy is locked.
- [ ] The grid is keyboard-operable with visible focus and has an accessible name; thumbnails are buttons.
- [ ] The speaker window's grid still works, now through the shared builder.

## Tests

- Add `scripts/test-slides-show-jump-browser.mjs` (register in `.github/workflows/ci-slides.yml`): on the Showcase (19 slides, 15 in the linear flow) press G, count thumbnails (15), click the eighth, read the counter; type digits plus Enter and read the counter; Esc semantics; out-of-range input.
- `scripts/test-slides-speaker-layout-browser.mjs` and `scripts/test-slides-speaker-links-browser.mjs` exercise the speaker window: run them to prove the refactor kept it working.

## Out of scope

- Jumping by slide title or search.
- A zoomed "summary" slide type.
- Step-aware thumbnails (MP-10 covers step awareness in the speaker previews).

## Notes for the implementer

- Slides app only; no format change. Depends on MP-08 only for the keyboard ownership decision; if MP-08 has not landed, intercept G, O and digits in `onKeydown` and `stopPropagation` so Reveal never sees them.
- Thumbnails are full slide renders: on a 100-slide deck build them lazily and consider rendering only what scrolls into view.
- `present.ts` is about 2,700 lines and a conflict magnet; extracting the grid into its own small module (for example `slides/src/showgrid.ts`) reduces future collisions.
