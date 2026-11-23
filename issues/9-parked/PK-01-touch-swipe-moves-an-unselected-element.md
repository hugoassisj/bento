---
id: PK-01
title: "Touch: a one-finger swipe moves an unselected element"
epic: 9-parked
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:touch", parked]
depends_on: []
related: [PK-02, FH-03, MP-19]
upstream: []
---
## Summary

On a touch screen, a single one-finger drag that starts on an element moves it, even if the element was not selected. A swipe meant to scroll or to look around the slide displaces content. Combined with PK-02 (Undo is off-screen on a phone), someone fixing a typo before a talk can shift a title by hundreds of pixels and not find the way to put it back. Phone editing as a whole is parked, but this one is a cheap safety fix worth doing anyway.

## What the user experiences

On a phone or tablet they put a finger on the slide and drag, expecting the view to move or nothing to happen. The element under the finger gets selected and travels with the finger in the same gesture. Nothing announces that something moved. On a phone the Undo button is scrolled out of the top bar (PK-02), so the damage is hard to reverse.

Google Slides and Canva on mobile require a tap to select first; only a selected object can be dragged.

## Reproduce

Touch emulation (Chromium, iPhone 13 profile; repeated at iPad Pro 11):

1. Open the Showcase deck. Do not tap anything.
2. Put one finger on the title text ("The file is the software.") and drag about 250 px in one motion, then lift.
3. Observe: the title is now selected and has moved by about the drag distance.
4. Check `window.bento.doc.slides[0].elements` for the title's `x`/`y`: changed.

## Evidence

Observed in the running app (audit journey 4, emulated touch via `page.touchscreen` and CDP touch events): one drag on the unselected title moved it 245 px on the phone profile; the same on the iPad profile.

**Not verified on a real device.** Emulated touch differs from a real finger in timing and in which synthesized mouse events follow. Reproduce on hardware before fixing.

Confirmed in code at `29b5c80`:

- Select-and-move in one press is deliberate for the Move tool. Selecto's `dragStart` handler (`slides/src/editor/canvas.ts:2004` onward) selects what the press lands on and then hands the same input event to Moveable: `this.moveable.dragStart(e.inputEvent, …)` at `slides/src/editor/canvas.ts:2068` and again, after waiting for the target change, at `slides/src/editor/canvas.ts:2130`. The long comment between explains the timing work that made a press-drag reliable.
- The decision is recorded: "In Move, a press-drag moves what it starts on" (`docs/DECISIONS.md:12308`).
- Nothing in that path distinguishes a touch from a mouse.
- The touch-specific code on the canvas is the pinch handling (`slides/src/editor/canvas.ts:298-326`) and the tap recogniser that opens editing (`slides/src/editor/canvas.ts:461-500`). The tap recogniser already records the fact this fix needs: `wasSelected`, computed at `touchstart` "because Selecto selects on the press" (`slides/src/editor/canvas.ts:470-474`).

## How others do it

- **Google Slides and Canva mobile**: tap selects; a drag on an unselected object pans or does nothing; a drag on a selected object moves it.
- **Keynote on iPhone and iPad**: touch-and-hold lifts an object before it can be dragged; a plain swipe scrolls.
- **Figma mobile** is view-only.

## Proposed change

`slides/src/editor/canvas.ts` only; no format change. Desktop mouse behaviour must not change.

1. In the Selecto `dragStart` path, detect a touch-originated press (the input event is a `TouchEvent`, or a pointer event with `pointerType === 'touch'`; check what Gesto actually passes on the supported browsers).
2. For a touch press on an element that was **not** already selected when the finger went down: select it, and do not hand the gesture to Moveable. The drag then does nothing further (or pans the view, if panning with one finger is wanted; decide and state it).
3. For a touch press on an element that **was** selected: move it as today.
4. Reuse the `wasSelected` logic from the tap recogniser instead of adding a second source of truth, or lift it into one small helper both use.
5. After any touch move of an element, show a toast "Moved *Title* · Undo" using the existing toast-with-action support, so the move is visible and reversible in one tap even when the Undo button is off-screen.
6. Resize and rotate handles are only present on a selected element, so they need no change.

Rejected: requiring a long-press to move. Long-press already opens the context menu (`LONG_PRESS_MS` in `slides/src/editor/editor.ts`).

New string: the toast text, through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] With touch input, a one-finger drag starting on an unselected element leaves its `x`/`y` unchanged and leaves it selected.
- [ ] With touch input, a one-finger drag on an already selected element moves it as before.
- [ ] After a touch move, a toast names the element and offers Undo; tapping it restores the position.
- [ ] With a mouse, press-drag on an unselected element still selects and moves it in one gesture (the Move tool behaviour recorded in `docs/DECISIONS.md:12308`).
- [ ] Two-finger pinch and pan still work.
- [ ] Tap, then tap again on a text box still opens editing.
- [ ] Verified on at least one real touch device, named in the change description.

## Tests

- Browser rig `scripts/test-slides-touch-move-browser.mjs`: a context with `hasTouch: true`; drive real touch sequences through CDP `Input.dispatchTouchEvent` (touchStart, several touchMove, touchEnd); assert element coordinates in `window.bento.doc` before and after for the unselected and selected cases; assert the toast. Add a mouse case that asserts the desktop behaviour is unchanged (`page.mouse`). Register in `.github/workflows/ci-slides.yml`.
- The rig must fail on the parent commit for the unselected-touch case.
- Existing rigs to keep green: `scripts/test-slides-select-tool-browser.mjs` and the press-drag rigs in the editor browser job.

## Out of scope

- The rest of phone editing (PK-02 to PK-04).
- One-finger canvas panning as a feature.
- Caret placement when entering text editing (FH-03).

## Notes for the implementer

- Parked epic: do this only as a safety fix; do not grow it.
- Hot file: `slides/src/editor/canvas.ts` (3,000 lines). The press-drag hand-over is fragile and heavily commented; read the comments at `canvas.ts:2072-2134` before touching it.
- Synthetic `PointerEvent`s and `MouseEvent`s dispatched in-page do not reproduce this; use a touch-enabled context.
