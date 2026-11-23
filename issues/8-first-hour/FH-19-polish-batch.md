---
id: FH-19
title: "Polish batch: hidden-slide thumbnail, toast overprint, layout picker thumbnails, text colour label, fractional sizes"
epic: 8-first-hour
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:editor"]
depends_on: []
related: [F-01, F-06, FH-10, FH-11]
upstream: []
---
## Summary

Five small, independent rough edges found while building a first deck, lettered A to E. They share a file for bookkeeping only: **ship each as its own commit**, and drop any item whose premise does not reproduce.

- **A** A hidden slide's thumbnail does not dim until something else re-renders the list. Defect, cause confirmed.
- **B** The "Backed up in this browser" note covers the end of the deck title. Defect, cause confirmed.
- **C** Layout picker thumbnails are nearly blank. Judgement call.
- **D** Text colour is labelled "Fill". Judgement call that touches a recorded choice.
- **E** Font sizes read as fractions ("45.8 pt"). Judgement call.

## What the user experiences

- **A.** Tick Hide slide. The thumbnail keeps its normal look and its number. It dims and shows the dash only after an unrelated structural change. A slide you believe is hidden looks live; one you un-hid still looks hidden. Skip numbering has the same lag.
- **B.** After an edit a small note fades in over the right-hand end of the title field for about a second and a half. With a long title it sits on the title's last words.
- **C.** New slide and Apply layout open a grid of 104px previews. On a white deck the built-in layouts are pale placeholder prompts: near-identical white rectangles told apart only by their captions.
- **D.** A PowerPoint or Google Slides user selects a text box and looks for "Text colour" or "Font colour". The control is a section called Fill, which reads as the box's background.
- **E.** A title made by a layout shows 45.8 pt. Office users expect whole or half points.

## Reproduce

- **A.** Select slide 2, tick Format ▸ Slide ▸ Hide slide, look at thumbnail 2: unchanged. Add a slide anywhere: thumbnail 2 now dims.
- **B.** Give the deck a title longer than its field. Make any edit and wait for the note.
- **C.** Click New slide at the bottom of the slide list; look at the Built-in grid.
- **D.** Select a text element; read the section names in the Format tab.
- **E.** File ▸ Start from scratch, apply the Title layout, select the title, read the size field.

## Evidence

All five were seen in the running app during the first-deck journey. Confirmed in code now:

- **A.** The toggle writes through `editSlideAttrs` (`slides/src/editor/inspector/slide.ts:38-42`, `slides/src/editor/panels.ts:121-128`), which commits with the store's default event `'doc'` (`slides/src/store.ts:113`). The sidebar's `'doc'` handler is `scheduleThumbs` (`slides/src/editor/editor.ts:234`, body at `2451-2473`), which replaces each thumbnail's rendered surface and comment badge and nothing else. The `ed-thumb-hidden` class (`editor.ts:2206`) and the number's text, class and title (`editor.ts:2108-2130`, inside `makeThumb`) are set only by `rebuildSidebar`, which runs on `'slides'` events (`editor.ts:232`). Skip numbering uses the same path (`inspector/slide.ts:46-50`).
- **B.** `flashSaved` (`editor.ts:3634-3648`) positions `.ed-autosaved` absolutely over the title's right end. The comment at `editor.ts:3641-3644` records why it is an overlay: as a flex item it shifted Undo and Redo on every auto-save and clicks landed on Redo (upstream #546). Style at `slides/src/styles.css:1303-1315` (surface background, opacity 0.85).
- **C.** `openLayoutPicker` (`editor.ts:2222-2262`) renders each layout with `renderThumbnail(ly, doc, 104)` (`editor.ts:2243`); an empty placeholder paints its prompt at `opacity: 0.38` (`slides/src/render.ts:750-757`).
- **D.** `buildTextFill` uses `section(p, t('Fill'), …)` (`slides/src/editor/inspector/text.ts:158-163`). The comment there says it is deliberate: "Figma's: a text fill is a layer like any other".
- **E.** The model stores pixels; the field shows `Math.round(el.fontSize * 0.75 * 10) / 10` (`inspector/text.ts:107`) and writes back `v * 4/3` rounded to two decimals (`inspector/text.ts:109`). 61px is 45.75pt, shown as 45.8. The unit choice is explained at `inspector/text.ts:105-106`.

Not verified: which built-in layout sizes are not whole points (item E asks the implementer to list them); the exact title length at which the note in B starts to overlap.

## How others do it

- PowerPoint dims a hidden slide and strikes its number the moment it is hidden; Keynote greys a skipped slide at once.
- PowerPoint's layout gallery draws schematic placeholders (title bar, content boxes), not the prompt text.
- PowerPoint and Keynote say "Font Color" / "Text Color"; Figma and Penpot say "Fill" for text, which is the precedent the current label follows.
- PowerPoint and Keynote sizes are whole or half points; Figma shows pixels.

## Proposed change

- **A.** In `scheduleThumbs`, also reconcile state that depends on slide attributes: toggle `ed-thumb-hidden` and refresh the number element's text, class and title for every thumbnail. Factor the number logic out of `makeThumb` into one helper used by both. Do not switch the toggle to a `'slides'` commit: that clears the slide selection (`editor.ts:232`).
- **B.** Keep the overlay; do not reintroduce #546. In order of preference: skip the note while the title field has focus; when the title's text is wider than the field minus the note, place the note outside the field's right edge if there is free space before the next control, otherwise below the field. No top-bar control may move.
- **C.** For the picker only, render placeholders as solid schematic blocks (a filled bar for a title, lighter bars for body lines, a tinted rectangle for an image slot), through a render option beside `hidePlaceholders` (`render.ts:28`) or by post-processing the picker's nodes. Canvas rendering is unchanged. Use theme-derived colours so F-01's themed layouts show through. If F-01 lands first, re-evaluate whether this is still needed.
- **D.** Do not rename unilaterally; the wording was chosen in the 1.3.0 inspector work (`docs/DECISIONS.md`, entries from about line 12000). Cheap options that keep the model: a tooltip or sub-label "Text colour" on that section for text elements, and "text colour" / "font colour" as palette keywords once F-06 lands. Decide with the owner; if the answer is "keep Fill as is", close the item.
- **E.** Do not change stored values or the display rounding (that would misreport existing decks). Fix the sources: make built-in layouts and `defaultText` use pixel sizes that are whole points (multiples of 4px are multiples of 3pt), and make the size field's step and scrub land on 0.5pt.

New strings (all catalogs): only item D, if a sub-label or tooltip is added.

## Acceptance criteria

- [ ] **A** Ticking Hide slide dims that thumbnail and updates its number within the existing 150ms refresh, with no other edit; un-ticking restores it.
- [ ] **A** Toggling Skip numbering updates that thumbnail's marker and the numbers of all following thumbnails.
- [ ] **B** With a title that overflows its field, the note never overlaps title text, and no note appears over a focused title field.
- [ ] **B** Undo and Redo do not move by a pixel while the note shows (compare `getBoundingClientRect` before, during and after).
- [ ] **C** Title, two-column, three-card and section layouts are visibly different shapes in the picker; canvas and slide-list placeholder rendering is unchanged.
- [ ] **C** Preview colours pass through the existing colour gate.
- [ ] **D** A text element's colour control can be found by the words "text colour" (tooltip, sub-label or palette keyword), in every catalog; or the item is closed with the owner's decision recorded here.
- [ ] **E** Every text size in the built-in layouts and `defaultText` displays as a whole number of points; stepping the size field lands on values that redisplay unchanged.
- [ ] **E** Opening an existing deck alters none of its sizes.

## Tests

- **A, B:** extend `scripts/test-slides-ui-fixes-browser.mjs` or `scripts/test-slides-chrome-polish-browser.mjs` (both registered in `.github/workflows/ci-slides.yml`): hide a slide through the inspector toggle and assert the thumbnail's class and number text after 300ms; show the backup note with a long title and assert rectangle non-overlap and an unchanged Undo rectangle. Both cases must fail on the parent commit.
- **C:** a browser assertion that two built-in layout previews differ (bounding boxes of the schematic blocks).
- **E:** extend the layouts rig (find it with `ls scripts | grep -i layout`) to assert whole-point sizes for every built-in layout.

## Out of scope

- Themed layouts (F-01), toast announcements and failure actions (FH-10), slide list keyboard support (FH-11), palette keywords themselves (F-06).
- Renaming any inspector section without the owner's decision.

## Notes for the implementer

- Zone: slides app. Hot files: `slides/src/editor/editor.ts`, `slides/src/styles.css`, catalogs (item D only), `CHANGELOG.md`.
- One commit per item. A and B are bug fixes; C to E are polish and may not need changelog lines.
- Item B: read upstream #546 before touching `flashSaved`.
- Item E: built-in layout sizes are also read by the compact-form tests (`scripts/test-slides-compact-layouts.ts`); run it.
