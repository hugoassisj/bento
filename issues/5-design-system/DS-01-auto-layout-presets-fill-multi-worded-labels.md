---
id: DS-01
title: "Auto layout presets (equal columns, equal rows, grid); Fill on a multi-selection; worded sizing labels"
epic: 5-design-system
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:design-system"]
depends_on: []
related: [DS-02, DS-03, DS-10, DS-14, AI-10, F-05, F-06]
upstream: []
---
## Summary

"Make these three boxes equal and evenly spaced, and keep them that way" is the reason a non-designer would reach for auto layout. Today it takes about nine steps and Figma vocabulary. Add one-click presets, let the sizing control work on several children at once, and label it in words.

## What the user experiences

They select three rectangles of different widths and press ⇧A. The frame appears but the rectangles keep their unequal widths and their 92px gap. To equalise them they must: select the frame, find **Hug contents** and untick it, resize the frame, double-click into the first child, find an unlabelled pair of icons under W and H, press the second one, then repeat for each child, because the pair disappears when two children are selected. While Hug is on, the second icon is disabled and only a hover tooltip says why.

## Reproduce

1. `cd slides && npm run dev`, open http://localhost:5173, empty slide.
2. Draw three rectangles with different widths in a rough row (press R, drag; three times).
3. Marquee-select all three, press **⇧A**.
4. Observe: a frame wraps them; widths and gaps are unchanged.
5. Shift-click two of the children (double-click into the frame first). Observe: the Format tab shows no sizing control.
6. Select one child. Observe: under W/H there is a two-icon control with no text; with the frame's Hug on, the second icon is disabled.

## Evidence

- **Seen in the running app (design-features journey):** the sequence above; screenshots `05-autolayout.png`, `07-multi-children.png` in the audit. Deleting a card from the built-in "Three cards" layout leaves a hole (that part is DS-02).
- **Confirmed in code now:**
  - `slides/src/editor/inspector/layout.ts:133` `wrapInFrame`: the new frame is created with `hug: true` (`:183`) and children keep their size; the gap is the median of the existing gaps (`spacing`, `:200`). So ⇧A preserves the arrangement by design.
  - `slides/src/editor/inspector/arrange.ts:233`: `if (els.length === 1) childResizing(p, els[0])`. The sizing rows are built for a single selection only.
  - `inspector/layout.ts:57` (`childResizing`) and `:62` (`resizing`): the control is `segmented(['fixed','fill'] or ['hug','fixed','fill'], ...)` with glyphs. `slides/src/editor/inspector/fields.ts:187-205`: when every option has a glyph the buttons show the icon only and put the label in `title` and `aria-label`.
  - `inspector/layout.ts:78-81`: with the parent hugging, the Fill button is `disabled` and the reason is its `title`.
  - `inspector/layout.ts:72`: "ponytail: hug is one switch for both axes".

## How others do it

- **Figma:** ⇧A wraps; the sizing dropdown reads "Fixed / Hug / Fill" in words and applies to a multi-selection; "Suggest auto layout" infers direction and spacing.
- **Penpot:** flex and grid layouts; child sizing is worded Fix / Fill / Fit.
- **PowerPoint:** Designer and SmartArt give equal boxes in one click; Arrange has "Distribute Horizontally".
- **Keynote:** Arrange ▸ Distribute Objects ▸ Evenly.

## Proposed change

**A. Presets (one click to the common results).**
Add three commands and offer them in the Auto layout section header menu, the element context menu (see DS-10), and ⌘K:

| Command id | Label | Result |
|---|---|---|
| `layout-equal-columns` | Equal columns | Row frame, not hugging; every child `sizing.w = 'fill'`; cross axis `align: 'stretch'` |
| `layout-equal-rows` | Equal rows | Column frame, not hugging; every child `sizing.h = 'fill'`; `align: 'stretch'` |
| `layout-grid` | Grid | `dir: 'grid'`, `cols` = the number of columns the selection already forms (cluster by x), else `ceil(sqrt(n))`; not hugging |

On a selection of free elements: wrap them (reuse `wrapInFrame`'s card detection), then apply the preset; the frame takes the selection's bounding box plus padding. On a selected frame: apply the preset to its existing children. One undo step. The gap is kept from `spacing()`.

**B. Sizing on a multi-selection.**
In `arrange.ts:233`, when every selected element has the same frame as parent, build the sizing rows for the group: a mixed state shows no option pressed; choosing one writes to all, in one `p.edit`.

**C. Words.**
In `resizing`, render the control as text when it fits (`ed-seg-text`): **Fixed / Fill** and **Hug / Fixed / Fill**. Short labels need new strings ("Hug", "Fill"; "Fixed" exists). Keep the long forms as the accessible names.

**D. Say why Fill is unavailable, where the user is looking.**
Replace the hover-only reason with a one-line hint under the control: "The frame hugs its contents, so there is nothing to fill." plus a link button **Turn off Hug** that clears `layout.hug` on the parent and gives the frame its current size.

No format change: only existing keys (`layout`, `sizing`) are written.

## Acceptance criteria

- [ ] Three free rectangles + "Equal columns" produces a frame whose three children have equal width (within 1px) and equal gaps, in one undo step.
- [ ] Deleting one child makes the other two share the width equally; duplicating one makes four equal.
- [ ] "Equal rows" and "Grid" behave the same on their axes.
- [ ] With two or more children of one frame selected, the sizing control is shown and writes to all of them.
- [ ] The sizing control shows words at the default panel width; icons only when the panel is too narrow, with the words as accessible names.
- [ ] With the parent hugging, the hint and "Turn off Hug" are visible without hovering; pressing it enables Fill and does not move the frame.
- [ ] All three presets appear in ⌘K and in the context menu, and are hidden or disabled with a reason when nothing suitable is selected.
- [ ] `window.bento.validate()` reports no new findings on the result.

## Tests

- Node: extend `scripts/test-slides-layout.ts` with the three preset outcomes as pure layout inputs (equal widths after `layoutSlide`, fixed point on a second pass).
- Browser: extend `scripts/test-slides-frames-browser.mjs`: draw three rectangles with `MouseEvent`s, run each preset through the command, measure the children with `getBoundingClientRect`; then delete one and re-measure. Add the multi-selection sizing case and the "Turn off Hug" case.
- Both rigs are already registered; confirm with `node scripts/test-ci-registered.ts`.

## Out of scope

- Per-axis hug, per-child alignment, grid spans (DS-14).
- Equal-height rows where children hold text of different lengths (AI-10 covers the solver work).
- Rebuilding the built-in layouts (DS-02).

## Notes for the implementer

- Slides app only. Hot files: `slides/src/editor/inspector/layout.ts`, `inspector/arrange.ts`, `slides/src/editor/editor.ts` (command list near `:3795-3815`, `elementMenuItems`), the eight i18n catalogs, `CHANGELOG.md`.
- Register the commands in the one command list so the shortcut sheet, the palette and tooltips pick them up; F-06 adds the synonyms ("same size", "even", "tidy").
- A frame's child is aligned by its frame, not by the Align buttons (`arrange.ts:91-105` already says so); the presets are the answer to that hint, so link them from it.
- Every string in all eight catalogs; record the byte cost.
