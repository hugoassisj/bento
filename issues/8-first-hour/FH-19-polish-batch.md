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
related: [F-01, FH-10, FH-11]
upstream: []
---
## Summary

Five small, independent rough edges found while building a first deck. Each is a few lines and each has its own reproduction and acceptance line. They are batched in one file for bookkeeping; **ship them as separate commits** (or separate PRs if any grows), and drop any item whose premise does not reproduce.

Items A and B are defects with a confirmed cause. Items C, D and E are judgement calls that touch decisions made during the 1.3.0 editor work; each says what to check before changing anything.

---

## A. A hidden slide's thumbnail does not dim until something else re-renders the list

**What the user experiences.** Tick Hide slide. The thumbnail keeps its normal look and its number. It dims and shows the dash only after an unrelated structural change (adding, moving or deleting a slide). A slide you believe is hidden looks live; a slide you un-hid still looks hidden.

**Reproduce.** Select slide 2, tick Format ▸ Slide ▸ Hide slide, and look at thumbnail 2: unchanged. Add a new slide anywhere: thumbnail 2 now dims.

**Evidence.** Seen in the first-deck journey. Cause confirmed in code now: the toggle writes through `editSlideAttrs` (`slides/src/editor/inspector/slide.ts:38-42`, `slides/src/editor/panels.ts:121-128`), which commits with the store's default event `'doc'` (`slides/src/store.ts:113`). The sidebar's `'doc'` handler is `scheduleThumbs` (`slides/src/editor/editor.ts:234`, body at `2451-2473`), which replaces each thumbnail's rendered surface and comment badge and nothing else. The `ed-thumb-hidden` class (`editor.ts:2206`) and the number text and title (`editor.ts:2108-2130` in `makeThumb`) are only set by `rebuildSidebar`, which runs on `'slides'` events (`editor.ts:232`). The same applies to Skip numbering (`inspector/slide.ts:46-50`): the "3·" marker and every later slide's number are stale until a rebuild.

**Proposed change.** In `scheduleThumbs`, also reconcile the per-thumbnail state that depends on slide attributes: toggle `ed-thumb-hidden`, and refresh the number element's text, class and title. Factor the number logic out of `makeThumb` into one helper used by both. Do not switch the toggle to a `'slides'` commit: that clears the slide selection (`editor.ts:232`).

**Acceptance.**
- [ ] Ticking Hide slide dims that thumbnail and updates its number within the existing 150ms refresh, with no other edit.
- [ ] Un-ticking restores it.
- [ ] Toggling Skip numbering updates that thumbnail's marker and the numbers of all following thumbnails.

---

## B. The "Backed up in this browser" note covers the end of the deck title

**What the user experiences.** After an edit, a small note fades in over the right-hand end of the title field for about a second and a half. With a title that fills the field, the note sits on top of the title's last words; while the title is being typed it covers the caret area.

**Reproduce.** Give the deck a long title (longer than the field). Make any edit and wait for the note.

**Evidence.** Seen in the first-deck journey (screenshot showed the note printed over the title). Confirmed in code now: `flashSaved` (`slides/src/editor/editor.ts:3634-3648`) positions `.ed-autosaved` absolutely at the title's right end, `left = max(title.offsetLeft, title.offsetLeft + title.offsetWidth - tag.offsetWidth - 6)`. The comment at `editor.ts:3641-3644` records why it is an overlay and not a flex item: as a slot in the bar it shifted Undo and Redo on every auto-save and clicks landed on Redo (upstream #546). The style is `slides/src/styles.css:1303-1315` (opaque surface background, opacity 0.85).

**Proposed change.** Keep it an overlay (do not reintroduce #546). Options, in order of preference: (1) skip the note while the title field has focus; (2) when the title's text is wider than the field minus the note's width, place the note just outside the field's right edge if there is free space before the next control, else below the field; (3) fade the title's own overflow instead of covering it. Whatever is chosen must not move any top-bar control.

**Acceptance.**
- [ ] With a title that overflows its field, the note never overlaps title text.
- [ ] While the title field is focused, no note appears over it.
- [ ] Undo and Redo do not move by a pixel when the note shows (measure their `getBoundingClientRect` before, during and after).

---

## C. Layout picker thumbnails are nearly blank

**What the user experiences.** New slide and Apply layout open a grid of small previews. On a white deck the built-in layouts are pale placeholder prompts at 38% opacity, 104px wide: seven near-identical white rectangles told apart only by their captions.

**Reproduce.** Click New slide at the bottom of the slide list and look at the Built-in grid.

**Evidence.** Seen in the first-deck journey. Confirmed in code now: `openLayoutPicker` (`slides/src/editor/editor.ts:2222-2262`) renders each layout with `renderThumbnail(ly, doc, 104)` (`editor.ts:2243`); an empty placeholder renders its prompt at `opacity: 0.38` (`slides/src/render.ts:750-757`).

**Proposed change.** For the picker only, render placeholders as solid schematic blocks: a filled bar where a title goes, lighter bars for body lines, a tinted rectangle for an image slot. Do this by passing a render option (alongside `hidePlaceholders`, `render.ts:28`) or by post-processing the picker's thumbnail nodes; do not change how placeholders look on the canvas. Use theme-derived colours so F-01's themed layouts show through.

**Acceptance.**
- [ ] Each built-in layout is recognisable from its preview without reading the caption (title, two columns, three cards and section are visibly different shapes).
- [ ] Canvas and slide-list rendering of placeholders is unchanged.
- [ ] Colours in the previews pass through the existing colour gate (no raw document strings into styles).

**Check first.** F-01 changes what built-in layouts look like; if it lands first, re-evaluate whether this is still needed.

---

## D. Text colour is labelled "Fill"

**What the user experiences.** A PowerPoint or Google Slides user selects a text box and looks for "Text colour" or "Font colour". The control is a section called Fill, which they read as the box's background.

**Evidence.** Seen in the first-deck journey. Confirmed in code now: `buildTextFill` uses `section(p, t('Fill'), …)` (`slides/src/editor/inspector/text.ts:158-163`). The comment there says this is deliberate: "Figma's: a text fill is a layer like any other".

**Proposed change.** This is a wording decision made in the 1.3.0 inspector work (`docs/DECISIONS.md`, the inspector entries from about line 12000). Do not rename unilaterally. Cheap options that keep the model: add a tooltip or sub-label "Text colour" on the section header for text elements, and add "text colour", "font colour" as palette keywords once F-06 lands. Decide with the owner; if the answer is "keep Fill", close this item.

**Acceptance.**
- [ ] A text element's colour control can be found by the words "text colour" (tooltip, sub-label, or palette keyword), in every catalog.

---

## E. Font sizes read as fractions ("45.8 pt")

**What the user experiences.** A title created by a layout or pasted from elsewhere shows 45.8 pt. Office users expect whole or half points.

**Evidence.** Seen in the first-deck journey. Confirmed in code now: the model stores pixels; the field shows `Math.round(el.fontSize * 0.75 * 10) / 10` (`slides/src/editor/inspector/text.ts:107`) and writes back `v * 4/3` rounded to two decimals (`text.ts:109`). A 61px title is 45.75pt, shown as 45.8. The comment at `text.ts:105-106` explains the unit choice.

**Proposed change.** Do not change stored values or the display rounding (that would misreport existing decks). Fix it at the sources: make built-in layouts and defaults use pixel sizes that are whole points (multiples of 4px map to multiples of 3pt), and make the size field's step and scrub snap to 0.5pt. List the built-in sizes that are not whole points before changing them.

**Acceptance.**
- [ ] Every text size in the built-in layouts and `defaultText` displays as a whole number of points.
- [ ] Scrubbing or arrow-stepping the size field moves in 0.5pt or 1pt steps and lands on values that redisplay unchanged.
- [ ] An existing deck's sizes are not altered by opening it.

---

## How others do it

PowerPoint dims and strikes the number of a hidden slide the moment it is hidden; its layout gallery draws schematic placeholders; it says "Font Color"; sizes are whole or half points. Keynote's navigator greys a skipped slide at once. Figma calls text colour "Fill", which is the precedent the current label follows.

## Tests

- A and B: extend `scripts/test-slides-ui-fixes-browser.mjs` or `scripts/test-slides-chrome-polish-browser.mjs` (both registered in `.github/workflows/ci-slides.yml`) with: hide a slide through the inspector toggle and assert the thumbnail's class and number text after 300ms; show the backup note with a long title and assert rectangle non-overlap and that Undo's rectangle is unchanged. Both must fail on the parent commit.
- C: a browser assertion that two built-in layout previews differ in rendered pixels (compare canvas snapshots or bounding boxes of the schematic blocks).
- E: extend the layouts rig (find it with `ls scripts | grep layouts`) to assert whole-point sizes.

## Out of scope

- Themed layouts (F-01), toast announcements and failure actions (FH-10), slide list keyboard support (FH-11).
- Renaming any inspector section without the owner's decision.

## Notes for the implementer

- Zone: slides app. Hot files: `slides/src/editor/editor.ts`, `slides/src/styles.css`, catalogs (item D only), `CHANGELOG.md`.
- One commit per item, each with its own changelog line or none (A and B are bug fixes; C to E are polish).
- Item B: read upstream #546 before touching `flashSaved`.
