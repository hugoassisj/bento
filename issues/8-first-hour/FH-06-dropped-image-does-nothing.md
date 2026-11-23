---
id: FH-06
title: "Dropping an image or media file onto the canvas does nothing"
epic: 8-first-hour
type: bug
priority: P1
size: S
evidence: seen
labels: [bug, "priority:P1", "size:S", "evidence:seen", "area:editor"]
depends_on: []
related: [FH-07, FH-10]
upstream: []
---
## Summary

Dragging a picture from the desktop onto the slide adds nothing. The editor cancels the browser's `dragover` for any file, but its only `drop` handler opens `.bento.html` decks and ignores everything else. A code comment says other files "fall through to the existing image/media drop behaviour"; no such handler exists.

## What the user experiences

The drop cursor says the page will accept the file. On release nothing appears on the slide and no message is shown. Because the `drop` event is not cancelled for non-deck files, a real browser then performs its default action, which is typically to navigate the tab to the dropped image, taking the user out of the editor.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. Note `window.bento.doc.slides[0].elements.length` (44 on the Showcase).
3. Drag any PNG from the file manager and drop it on the slide.
4. The count is still 44; no toast. In a real browser the tab may navigate to the image.

Scripted equivalent used in the audit: build a `DataTransfer` holding a PNG `File`, dispatch `dragover` then `drop` (bubbling, cancelable) on the element under the canvas centre. Result: `dragover.defaultPrevented === true`, `drop.defaultPrevented === false`, element count 44 → 44.

## Evidence

- **Seen (main session, live app):** the scripted drop above, with those exact values.
- **Confirmed in code now:**
  - `slides/src/editor/editor.ts:2841-2847` (`wirePaste`) — the comment "anything else falls through to the existing image/media drop behaviour", a `dragover` listener that calls `preventDefault()` when any dragged item is a file, and the single `drop` listener `void this.openDroppedDeck(ev)`.
  - `slides/src/editor/editor.ts:3277-3281` (`openDroppedDeck`) — returns `false` before `preventDefault()` unless the first file's name matches `/\.bento\.html$/i`.
  - `slides/src/editor/editor.ts:2916-2938` (`pasteImageFile`) — the existing path for a pasted image file: shrink, measure, insert through `canvas.insert` so the picture is interned into `doc.assets`.
  - `slides/src/editor/editor.ts:2860` — the paste handler already routes an image file to `pasteImageFile`.
- **Unverified:** the navigation-away behaviour was not observed in headless Chromium (synthetic events do not trigger it); it is the standard default for an uncancelled file drop.

## How others do it

- **PowerPoint, Keynote, Google Slides, Figma, Penpot, Canva:** dropping an image file places it on the slide at the drop point. Several files drop as several pictures. Keynote and PowerPoint also accept video and audio the same way.

## Proposed change

`slides/src/editor/editor.ts`, in the `drop` listener:

1. If `openDroppedDeck` declines the drop, look at `ev.dataTransfer.files`. For every file whose type starts with `image/`, call `ev.preventDefault()` and insert it.
2. Reuse the image path but place at the drop point, not the slide centre. `pasteImageFile` centres the picture; give it (or a small shared helper) an optional slide-space point. Convert client coordinates to slide coordinates with the canvas's existing conversion (the same one the placement tools use). Clamp so the picture stays on the slide.
3. Several images: offset each by a fixed step so they do not stack exactly.
4. `video/*` and `audio/*`: route to the media embed path the Media button uses, if it accepts a `File`; otherwise leave media to a follow-up and say so. Do not silently swallow the drop: show a toast naming what is not supported.
5. Any other file type: `preventDefault()` too (so the browser does not navigate away) and toast "Only pictures, media and Bento decks can be dropped here".
6. Read-only decks (`store.readOnly`): refuse with the existing read-only wording.
7. Dropping onto the slide list or a panel should behave the same as dropping on the canvas, or be refused explicitly; do not leave a third behaviour.
8. Fix the misleading comment.

A `.pptx` drop is a separate matter: import lives on bento.page by a recorded decision (`convert/` must not be imported by the app). The toast for unsupported files may mention where to import PowerPoint files; do not add an import path here.

New strings: the two toasts, in every catalog.

## Acceptance criteria

- [ ] Dropping one PNG onto the slide adds one `image` element whose `src` is an `asset:` reference, positioned at the drop point (within rounding), in one undo step.
- [ ] `drop.defaultPrevented` is true for every file drop the editor receives.
- [ ] Dropping three images adds three elements that do not coincide.
- [ ] A large photo goes through the same shrink step as a pasted one (same toast).
- [ ] An undecodable image file produces a visible message and no broken element (shared with FH-10).
- [ ] Dropping a non-image, non-deck file shows the explanatory toast and changes nothing.
- [ ] Dropping a `.bento.html` still opens it exactly as before.
- [ ] In a read-only deck nothing is inserted.

## Tests

Add `scripts/test-slides-drop-image-browser.mjs`: in headless Chromium, construct a PNG via a canvas, build a `DataTransfer`, dispatch `dragover` and `drop` at a known client point, then assert the element count, the element's position against the expected slide coordinates, `defaultPrevented`, and the non-image case. It must fail on the parent commit (count unchanged, `defaultPrevented` false). Register in `.github/workflows/ci-slides.yml`. Regression: `scripts/test-slides-shrink.ts`, `scripts/test-clipboard.ts`, and the save/open rigs that cover `openDroppedDeck`.

## Out of scope

- Filling a layout's picture slot on drop (FH-07).
- Importing `.pptx` by drop.
- Replacing an existing picture by dropping onto it.

## Notes for the implementer

- Zone: slides app. Hot file: `slides/src/editor/editor.ts`.
- Insert through `canvas.insert` so the picture is interned into `doc.assets`; an inline data URL cannot be sent over live collaboration (see the comment at `editor.ts:2922-2924`).
- Synthetic `DragEvent`s are fine for this rig because the handlers are plain DOM listeners; the Moveable/Selecto caveat about pointer events does not apply.
- `CHANGELOG.md` `[Unreleased]` fix line.
