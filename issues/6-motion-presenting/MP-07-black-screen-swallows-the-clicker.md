---
id: MP-07
title: "Black screen swallows the clicker"
epic: 6-motion-presenting
type: bug
priority: P1
size: S
evidence: mixed
labels: [bug, "priority:P1", "size:S", "evidence:mixed", "area:present"]
depends_on: []
related: [MP-08, MP-10]
upstream: []
---
## Summary

While the screen is blacked out (B), the advance and back keys still navigate. The audience sees black, the presenter (on one screen) sees black, and each press of the clicker silently moves the deck. When the screen is woken the talk is several slides ahead. An advance or back press while black should wake the screen and not navigate.

## What the user experiences

The speaker presses B to hold the room's attention, talks, then clicks the remote to continue. Nothing appears to happen, so they click again. They press B: the deck is two slides further on, or halfway through a build. With a single screen there is no way to see that the counter moved, because the blackout covers it.

## Reproduce

1. Fresh load of the Showcase deck. Start the slideshow on slide 2 ("Everything ships inside.", counter 2 / 15).
2. Press **B**: the screen goes black.
3. Press **→** once. The screen stays black.
4. Press **B** again.
5. Observe: slide 3 is showing (counter 3 / 15). The press in step 3 advanced the deck.

## Evidence

- Seen in the running app during the motion and presenting journey: B then →, the screen stayed black while the counter moved 2 → 3.
- Confirmed in code now:
  - The capture-phase key handler calls `toggleBlack()` for B (`slides/src/present.ts:1313-1318`) and `goNext()` / `goPrev()` for →, PageDown, Space, ←, PageUp (`1319-1328`) with no reference to the blackout state.
  - `goNext` and `goPrev` (`present.ts:199-214`) do not read `blacked`.
  - `blacked` is consulted only by the laser paths (`present.ts:500`, `566`, `582`) and by `setBlack` itself (`680-691`).
  - The speaker window has its own key handler that does the same (`present.ts:1156-1166`), and its on-screen navigation buttons call the same functions (`≈1133-1139`).
  - The comment at `present.ts:241` describes the design intent: "audience blackout; presenter keeps notes". That intent makes sense with a speaker view open (the presenter can see where they are); it does not hold on a single screen.
- Clickers send PageDown / PageUp, which take the same path.
- Not verified: behaviour on the audience side of a live broadcast when the presenter navigates under black (frames `nav` and `black` are separate; `present.ts:1554-1558`).

## How others do it

- **PowerPoint**: B or period blacks the screen; pressing any key returns to the slide **without** advancing.
- **Keynote**: B blacks the screen; any key resumes on the same slide.

## Proposed change

In `slides/src/present.ts`:

- Introduce one small helper, for example `wakeIfBlack(): boolean`, that calls `setBlack(false)` and returns true when the screen was black.
- In the **audience window's** key handler (`onKeydown`, ≈1281), call it before `goNext()` / `goPrev()`; when it returns true, consume the key and do not navigate. Apply the same to the touch swipe handler (≈1340) and to clicks on the corner arrows if `present.controls` is on.
- In the **speaker window** (key handler ≈1156 and the nav buttons ≈1133): keep navigation working while black, because the presenter can see the current and next slide there and may want to line up the next slide before waking the room. Make the state impossible to miss instead: the Black button is already toggled `active` (`≈871`); add a visible "Audience screen is black" strip over the current-slide preview.
- Links and state jumps (`[data-link]` clicks) cannot be clicked through the blackout element; confirm it covers the stage and leave them alone.
- Live broadcast: `setBlack(false)` already sends the black frame to the audience (`sendBlackPoint`, inside `setBlack`); no protocol change.

No format change. One new string for the speaker strip, in every catalog.

Rejected: blocking navigation everywhere while black (removes a legitimate speaker-view workflow); waking **and** advancing on the same press (still loses the slide the speaker was on).

## Acceptance criteria

- [ ] In the audience window, with the screen black, pressing →, Space, PageDown, ← or PageUp once hides the blackout (`.bento-blackout` has `hidden`) and leaves `deck.getIndices().h` and the step counter unchanged.
- [ ] The next press after waking navigates normally.
- [ ] The same holds for a swipe on touch.
- [ ] In the speaker window, → while black still navigates, the blackout stays on, and a visible strip states that the audience screen is black.
- [ ] Pressing B toggles as before in both windows.
- [ ] A slide with reveal steps: waking does not consume a step.
- [ ] The new rig fails on the parent commit (index changes while black) and passes with the fix.

## Tests

- Add `scripts/test-slides-black-wake-browser.mjs` (register in `.github/workflows/ci-slides.yml`, beside `test-slides-laser-release-browser.mjs`): start the show on slide 2, press B, press ArrowRight, assert index 1 (zero-based) and blackout hidden; press ArrowRight again, assert index 2. Repeat with PageDown and Space. Open the speaker window (`context.waitForEvent('page')`), press B then ArrowRight there, assert the index advanced and the blackout is still on.
- Read state from `window.bento`-independent DOM: the counter text and the blackout element's `hidden` attribute, not from a style read-back.

## Out of scope

- A white screen (W) and a freeze-frame mode.
- The in-show help sheet (MP-08), which should list B once it exists.

## Notes for the implementer

- Slides app only, one file plus catalogs. `present.ts` is about 2,700 lines and a conflict magnet; keep the diff to the three call sites and the helper.
- Reveal's own keyboard controller is still active for keys Bento does not intercept (see MP-08). Its `B` binding (pause) never fires because Bento stops propagation for B first; do not rely on Reveal's pause state for this fix.
- The blackout must also wake on the audience copy when the presenter wakes it; the existing `black` verb handles that (`present.ts:1555-1558`).
