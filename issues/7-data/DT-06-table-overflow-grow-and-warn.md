---
id: DT-06
title: "Table overflow: grow the box with its content; warn when it leaves the slide"
epic: 7-data
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:data"]
depends_on: []
related: [F-10, F-09, DT-04]
upstream: []
---
## Summary

A table's box does not follow its content. Add rows, or type a long cell, and the rows run past the selection box and off the slide with no warning in the editor, although the validator already knows how to measure it. Grow the box to the measured height when content changes, and show a visible warning with actions when the table no longer fits the slide.

## What the user experiences

They add rows until the table has twelve. The selection outline stays at 260px while the rows continue below it and past the bottom of the slide. Handles, alignment and distribute all work on the 260px box, so the table overlaps whatever is under it. In the show the bottom rows are cut off by the slide edge. Nothing in the editor says so.

## Reproduce

1. Fresh load. Insert a table (default `x 240, y 220, w 800, h 260`, 3×3).
2. Set Rows to 12 in the inspector.
3. In one body cell type about 200 characters so it wraps to several lines.
4. Result: rendered rows extend well past the 260px box and below `y = 720`. `window.bento.doc` still has `h: 260`. No badge, no toast.
5. In the browser console: `(await window.bento.validate()).findings.filter(f => f.code === 'table-overflow')` returns a finding for this table. The editor shows it nowhere.
6. Try to drag a row boundary to resize a row: the table moves.

## Evidence

- Seen in the running 1.3.0 app during the data journey (steps 1–4, 6).
- Code, verified now:
  - Default table box: `slides/src/model.ts:1155` (`x: 240, y: 220, w: 800, h: 260`).
  - The measurement exists: `slides/src/measure.ts:139-149` `measureTables` renders the table off-screen and returns `{ height, overflow }`.
  - The finding exists: `slides/src/validate.ts:511` emits `table-overflow` with a message telling an agent to make the box taller.
  - Rendering already avoids clipping the overflow (the comment at `slides/src/render.ts:669-672` about #494), which is why the rows are visible past the box.
  - Text boxes do grow on commit: `slides/src/editor/canvas.ts:2341` computes `grownH` from `inner.scrollHeight`. `commitCellEdit` (`canvas.ts:2538` onward) has no equivalent.
  - Only column boundaries have handles (`canvas.ts:1620-1634`); there is no row handle.

## How others do it

- PowerPoint and Keynote: the table's frame is its content; adding a row makes the object taller, and row height follows text.
- Google Slides: the same, and a table past the slide edge is visibly outside the page.

## Proposed change

1. **Grow to fit.** A helper `fitTableHeight(el, doc): number` (in `slides/src/measure.ts` or beside it) returns the measured height. Call it and write `h` when it exceeds the current `h`:
   - after a cell edit commits (`commitCellEdit`),
   - after rows or columns are added or removed (inspector steppers in `slides/src/editor/inspector/table.ts`, Tab-append in `moveCell`, and DT-04's operations),
   - after a table-wide style change that affects height (font size, padding),
   - after a column resize ends (`startColResize`'s commit).
   Write it in the same `store.commit` as the edit so it is one undo step. Never shrink a box the user made taller on purpose: only grow, unless the user invokes "Fit height".
2. **A "Fit height" action** in the table inspector that sets `h` to the measured height (grows or shrinks).
3. **Off-slide warning.** When `el.y + measuredHeight > slideHeight` (use `store.doc.size`), draw a badge on the table's bottom edge in the editor overlay with a short label ("Runs off the slide") and a popover with two actions:
   - **Shrink text**: step `style.fontSize` and padding down until it fits, with a floor (for example 12px); if the floor is reached, say it does not fit.
   - **Move rows to a new slide**: duplicate the slide after this one, keep the header row, move the rows that do not fit to the copy's table.
   The badge is editor chrome: not in thumbnails, the show, print or export.
4. When F-10's Check deck panel exists, the same condition appears there through the existing `table-overflow` finding; do not add a second detector.
5. Frames: a table inside an auto-layout frame should report its new height to the layout pass (`slides/src/layout.ts`, `slides/src/derive.ts`); verify the frame reflows.
6. New strings in all catalogs.

No format change.

## Acceptance criteria

- [ ] Setting Rows from 3 to 12 increases `h` so that `measureTables` reports `overflow ≤ 1`.
- [ ] Typing a wrapping paragraph into a cell and committing grows `h` in the same undo step as the text change.
- [ ] A table the user dragged taller than its content keeps its height after a cell edit.
- [ ] "Fit height" sets `h` to the measured height.
- [ ] When the table's bottom passes the slide's bottom edge, a badge appears; it disappears when the table fits again.
- [ ] "Shrink text" never goes below the floor and reports when it cannot fit.
- [ ] "Move rows to a new slide" produces two slides whose tables together hold every original row exactly once, each with the header.
- [ ] `window.bento.validate()` reports no `table-overflow` for a table after auto-grow.
- [ ] No badge or overlay appears in a thumbnail, the show, print or exported PNG.
- [ ] A linked chart still tracks the table after rows move to a new slide (or the limitation is stated: the link is per slide).

## Tests

- Browser rig `scripts/test-slides-table-fit-browser.mjs`: rows 3→12 grows `h`; long cell grows `h`; user-enlarged box is kept; the off-slide badge appears and clears; assert through `window.bento.doc` and `getBoundingClientRect`, not style read-back. Register in `.github/workflows/ci-slides.yml`.
- Node rig for the split-rows helper (pure): `scripts/test-slides-table-split.ts`, registered in `.github/actions/validate-slides/action.yml`.
- Keep `scripts/test-slides-table-radius-browser.mjs` green: it guards the clipping behaviour from #494.

## Out of scope

- Manual row-height handles (a fixed row height needs a format key; propose separately if wanted).
- Automatic pagination while typing.
- Text boxes' overflow (F-03).

## Notes for the implementer

- Measurement renders off-screen through the real renderer with the deck's fonts; call it after fonts are ready, and do not call it on every keystroke. On commit is enough.
- A collaborator's edit can also change the content height. Decide whether a remote edit grows the box locally (it should, deterministically, since both sides measure the same content) and say so in the change.
- Hot files: `canvas.ts`, `inspector/table.ts`. Sequence after DT-04 if both are in flight.
