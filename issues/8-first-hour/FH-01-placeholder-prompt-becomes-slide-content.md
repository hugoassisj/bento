---
id: FH-01
title: "Placeholder prompt text becomes real slide content"
epic: 8-first-hour
type: bug
priority: P0
size: S
evidence: mixed
labels: [bug, "priority:P0", "size:S", "evidence:mixed", "area:text"]
depends_on: []
related: [FH-03, FH-05, F-01]
upstream: []
---
## Summary

A layout placeholder ("Click to add title") is drawn by writing the prompt into the text node. Opening the box for editing never removes it, so leaving the box without typing, or clicking to place a caret before typing, saves the prompt as the element's real `html`. The audience then sees "Click to add title" in the show.

## What the user experiences

- Double-click a placeholder, change their mind, press Esc: the slide now really contains the words "Click to add title", at full opacity after the next render, and present mode shows them.
- Double-click, click once more to place the caret, type: the words land inside the prompt ("Click to add Funnel improvedcontent").
- While typing, the text stays at ghost opacity (0.38) until the edit is committed.

The only path that works is the one where the user types immediately, because opening the box selects everything and the first key replaces the prompt. That select-all is masking the bug (see FH-03).

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. File menu (the wordmark) → Start from scratch → confirm. In the inspector open Layout and apply **Title** (any layout with a placeholder).
3. Double-click "Click to add title". Press Esc.
4. Read `window.bento.doc.slides[0].elements.find(e => e.placeholder).html` → `"Click to add title"`. Expected: `""`.
5. Start the slideshow: the prompt text is on screen. Expected: an empty placeholder is hidden in the show.
6. Undo. Double-click the placeholder, click once in the middle of the prompt, type `Funnel improved`. The html is the prompt with the typed words spliced in.

## Evidence

- **Seen (journey 1, first deck from scratch):** steps 3–6, with the resulting html values quoted above and the show screenshot.
- **Confirmed in code now:**
  - `slides/src/render.ts:750-758` — when `el.placeholder` is set and the content is empty, the renderer sets `inner.textContent = el.placeholder` and `inner.style.opacity = '0.38'` (or hides the node when `opts.hidePlaceholders`).
  - `slides/src/editor/canvas.ts:2187-2238` (`startTextEdit`) — nothing clears that prompt or the inline opacity before `inner.contentEditable = 'true'`; it only calls `selectAllChildren(inner)` (`:2236`).
  - `slides/src/editor/canvas.ts:2340-2358` (`commitTextEdit`) — the saved html is `inner.innerHTML` after sanitising, compared with `el.html` (`''`), so the prompt is committed as content.
- **Unverified:** nothing; the mechanism is fully visible in code.

## How others do it

- **PowerPoint, Keynote, Google Slides:** the prompt is never text. Clicking a placeholder opens an empty box with the caret in it; the prompt disappears while the box has focus and returns if it is left empty.
- **Figma Slides:** placeholder text is real default text, but it is visibly normal text and is selected on first edit; there is no ghost state to leak.

## Proposed change

Make the prompt presentation-only, so it can never be read back as content.

1. `render.ts`: stop writing the prompt into the text node. Mark the node instead (for example `inner.dataset.placeholder = el.placeholder` plus a class) and leave `inner` empty. Keep the `hidePlaceholders` branch as is.
2. `slides/src/styles.css`: paint the prompt with `.bento-text-inner[data-placeholder]:empty::before { content: attr(data-placeholder); opacity: .38 }`. A `:empty` rule stops the moment the first character is typed, which also fixes the ghost opacity while typing. Check thumbnails, the speaker view and print, which share the renderer: thumbnails should keep showing the prompt, print and present should not (they already pass `hidePlaceholders`).
3. `canvas.ts` `startTextEdit`: for an element whose model html is empty and which has a placeholder, make sure `inner` is truly empty before it becomes editable (a contenteditable needs a caret position: an empty text node or `<br>` is fine as long as commit normalises it back to `''`).
4. `canvas.ts` `commitTextEdit`: an edit that ends with no text and no image must write `''`, not a stray `<br>`, so the prompt comes back.
5. `typeIntoText` in `slides/src/editor/editor.ts:4008-4022` already documents "fills an empty placeholder"; verify it still works with an empty node.

No model change. No new strings.

Alternative rejected: stripping the prompt string from the html at commit. It breaks the moment a user really types the same words, and it leaves the caret-inside-prompt case broken.

## Acceptance criteria

- [ ] Double-click a placeholder then Esc leaves `html === ''` and creates no undo step.
- [ ] Double-click, click to place the caret, type `abc` gives `html` containing only `abc`.
- [ ] While typing in a former placeholder the text renders at full opacity.
- [ ] An emptied placeholder shows its prompt again in the editor and in thumbnails.
- [ ] Present mode and print never show a prompt (unchanged behaviour, still covered).
- [ ] An element with a placeholder and real content is unaffected.
- [ ] `window.bento.read()` and a saved file never contain a prompt string in `html`.

## Tests

Add `scripts/test-slides-placeholder-browser.mjs` (headless Chromium, real mouse and keyboard). Assert each acceptance criterion against `window.bento.doc`, and assert `getComputedStyle(inner).opacity === '1'` after the first typed character. Register it in `.github/workflows/ci-slides.yml` with the other editor browser rigs; `scripts/test-ci-registered.ts` must pass. The rig must fail on the parent commit (expected: the Esc case and the caret case both red).

Also run the layout rigs (`ls scripts | grep layout`) and `scripts/test-slides-empty-fold-browser.mjs` as regression.

## Out of scope

- Where the caret lands on opening (FH-03).
- What Start from scratch opens on (FH-05).
- Layout colours following the theme (F-01).

## Notes for the implementer

- Zone: slides app only. Hot files: `slides/src/render.ts`, `slides/src/editor/canvas.ts`, `slides/src/styles.css`.
- `render.ts` is shared by the canvas, thumbnails, present, print and `measure.ts`. `validate.ts` skips text with empty html when measuring overflow; keep that true.
- An old shell opening a file saved after this fix sees `html: ''` plus `placeholder`, which is exactly today's format. Files already damaged by this bug keep the prompt as content; do not try to repair them.
- Add a `CHANGELOG.md` `[Unreleased]` line under fixes.
