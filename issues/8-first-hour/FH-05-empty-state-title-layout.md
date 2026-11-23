---
id: FH-05
title: "Empty state: open on a Title layout with the title focused; typing must not arm tools"
epic: 8-first-hour
type: enhancement
priority: P1
size: S
evidence: mixed
labels: [enhancement, "priority:P1", "size:S", "evidence:mixed", "area:editor"]
depends_on: [FH-01]
related: [F-02, SC-05, F-05, FH-14]
upstream: []
---
## Summary

"Start from scratch" replaces the deck with one bare white slide: no placeholders, no hint, nothing selected. A newcomer who simply starts typing arms drawing tools, because single letters are tool shortcuts. Open on a Title layout with the title placeholder ready to receive typing, as every presentation tool does.

## What the user experiences

- After Start from scratch there is one white slide. Double-clicking it does nothing.
- Typing `Hello` does not produce text. `L` arms the Line tool and `O` arms the Ellipse tool (`H` and `E` are unbound), so the cursor ends up as a shape tool and the next click draws an ellipse.
- Nothing on the canvas says "press T", "double-click to add text" or "pick a layout".

Related symptoms handled elsewhere: the deck keeps the Showcase title, tokens and components (SC-05, FH-14) and the built-in layouts ignore the theme (F-01, F-02).

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173.
2. File menu (the wordmark) → Start from scratch… → confirm.
3. `window.bento.doc.slides` is one slide with `elements: []`.
4. Double-click the slide: nothing.
5. Type `Hello`: the Ellipse tool is armed (its toolbar button is active); no text was created.

## Evidence

- **Seen (journey 1):** steps 2–5, with a screenshot of the armed Ellipse tool.
- **Confirmed in code now:**
  - `slides/src/editor/editor.ts:1308-1317` (`startFromScratch`) — a `window.confirm`, then `this.store.doc.slides = [instantiateLayout(blank)]` where `blank` is the built-in `layout-blank`.
  - `slides/src/editor/editor.ts:3777-3787` — tool commands bound to bare letters: `V` Move, `S` Select only, `F` Frame, `R` Rectangle, `O` Ellipse, `L` Line, `P` Pen, `T` text; matcher `tool(k)` at `:3767` (no modifier, not while editing).
  - `slides/src/editor/editor.ts:4008-4022` (`typeIntoText`) — typing goes into text only when exactly one text element is selected; its comment already says it "fills an empty placeholder".
  - `slides/src/model.ts:1357` (`builtinLayouts`) and `ph()` at `:1283-1300` — the Title layout exists with placeholders.
- **Unverified:** which hint, if any, the canvas shows on a slide with zero elements (the journey saw none; `slides/src/editor/hints.ts` was not read line by line).

## How others do it

- **PowerPoint, Google Slides:** a new deck opens on a Title Slide with "Click to add title" and "Click to add subtitle"; typing with a placeholder selected goes into it.
- **Keynote:** opens a theme chooser, then a title slide with editable placeholder text.
- **Figma Slides:** opens a template picker; a blank slide shows "Type / to add" style hints.

## Proposed change

`slides/src/editor/editor.ts`:

1. `startFromScratch` instantiates the built-in **Title** layout (not Blank) as the first slide, then selects the title placeholder (`store.select([id])`). With one text element selected, `typeIntoText` already routes the first printable key into it, so `Hello` becomes the title. Keep "Blank" available as a layout for people who want it.
2. Keep the whole thing one undo step, as today (`store.commit(..., 'slides')`).
3. Replace `window.confirm` only if the same PR is taking SC-05's "blank or keep this look" choice; otherwise leave it.
4. Empty-slide hint: when the current slide has no elements and nothing is being drawn, show one quiet line on the canvas ("Double-click to add text · T for a text box · pick a layout in the panel"). It must not be part of the document, must not render in thumbnails, present, print or export, and must disappear as soon as the slide has an element. Double-click on an empty slide should create a text box at that point (the Text tool's own placement path).
5. Do **not** change the letter shortcuts. They are correct for people who know them; the fix is that a newcomer's first keystrokes have somewhere sensible to go.

New strings: the hint line, in every catalog.

Depends on FH-01: selecting a placeholder and typing must not save the prompt as content.

## Acceptance criteria

- [ ] After Start from scratch the deck has one slide built from the Title layout, with the title placeholder selected.
- [ ] Typing `Hello` immediately afterwards yields a title whose `html` is `Hello`; no tool is armed.
- [ ] One undo restores the previous deck.
- [ ] A slide with zero elements shows the hint in the editor only: not in thumbnails, the show, print, exported images or `window.bento.read()`.
- [ ] Double-clicking an empty slide creates a text box at the pointer and opens it for typing.
- [ ] The hint string exists in all eight catalogs; `scripts/test-slides-i18n-literals.mjs` passes.
- [ ] Letter tool shortcuts still work when nothing is selected on a non-empty slide.

## Tests

Add `scripts/test-slides-empty-state-browser.mjs`: run Start from scratch (stub `window.confirm` to true), type with real keyboard input, assert the doc and that no tool button is active; assert the hint's presence on an empty slide and its absence in a thumbnail node and in present mode. Register in `.github/workflows/ci-slides.yml`. Regression: `scripts/test-slides-empty-fold-browser.mjs`, `scripts/test-slides-starterdeck.ts`, `scripts/test-slides-command-palette-browser.mjs` (the `start-scratch` command).

## Out of scope

- Theme presets on Start from scratch (F-02).
- Resetting the title and clearing Showcase tokens and components (SC-05).
- Asking for a file name on first save (FH-14).

## Notes for the implementer

- Zone: slides app. Hot files: `slides/src/editor/editor.ts`, `slides/src/editor/canvas.ts`, `slides/src/styles.css`, catalogs.
- The first slide of a deck is what `kernel` uses for the file preview; a Title layout with empty placeholders renders as an empty white slide there, which is fine, but check the preview path does not print prompts.
- Coordinate with F-02 and SC-05: all three edit `startFromScratch`. Land them in the order FH-05, SC-05, F-02, or as one branch if a single owner takes all three.
