---
id: DT-05
title: "Cell and range selection; a Cell section in the inspector"
epic: 7-data
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:data", "format-change"]
depends_on: [DT-04]
related: [DT-01, DT-12]
upstream: []
---
## Summary

A table is one object: you can move it or edit one cell's text, and nothing in between. There is no way to select a cell or a range, so nothing can be aligned, filled, coloured or formatted per cell, even though the document format already carries per-cell `align`, `bg`, `color` and `bold`. Add a cell-selection state and a Cell section in the inspector that writes those existing keys, plus an optional per-column number format.

## What the user experiences

They want the numbers right-aligned and one row highlighted. Dragging across cells moves the whole table. Clicking a cell then typing does nothing; arrow keys do nothing. The in-cell formatting bar offers bold, headings and lists, no alignment and no fill. The Showcase deck's own table has right-aligned numbers, which a user cannot reproduce with any control.

## Reproduce

1. Fresh load. Go to the Showcase slide "Facts, lined up." Its table has right-aligned number columns.
2. Insert a new table on a blank slide and type `1204` in a body cell.
3. Try to right-align it: the inspector has table-wide Style controls only (preset, header fill, text, grid lines, font, radius, padding). The formatting bar that appears on a text selection has B, I, U, S, code, H1, H2, body, lists, indent, clear.
4. Click a cell once, then type `x`: nothing is entered. Press an arrow key: the table moves or nothing happens.
5. Press the mouse in one cell and drag to another: the table is dragged.

## Evidence

- Seen in the running 1.3.0 app during the data journey (steps 3–5).
- Code, verified now:
  - `slides/src/model.ts:514-521` `TableCell { html, align?, color?, bg?, bold? }`.
  - `slides/src/render.ts:650-653` reads them when drawing a cell.
  - No editor code writes them: a search of `slides/src/editor/` for writes to a cell's `align`, `bg`, `color` or `bold` finds none; `slides/src/editor/inspector/table.ts` edits `el.style` only. The Showcase sets `align: 'right'` by hand in `slides/src/starterdeck.ts:1174-1178`.
  - Cell editing starts only from a double-click or a second click on a selected table: `editCellFromTd` (`slides/src/editor/canvas.ts:2482`), entered from four call sites; `editCellAt` (`canvas.ts:2490`) selects all the cell's text (`canvas.ts:2508`).
  - The formatting bar's commands: `slides/src/editor/richtext.ts:113-129`.

## How others do it

- Keynote: click selects a cell, drag selects a range, typing replaces the cell, Return edits; Format ▸ Cell has Data Format (number, currency, percentage), Fill, Border; Format ▸ Text has alignment.
- PowerPoint: drag selects cells; Table Design has Shading; Layout has alignment.
- Google Slides: the same range selection with a toolbar fill and alignment.

## Proposed change

**A. Selection state** (`slides/src/editor/canvas.ts`):

- New editor state `cellSel: { tableId, anchor: {r,c}, focus: {r,c} } | null`, separate from text editing (`editingCell`).
- With a table already selected: a single click on a cell selects that cell (no text editing yet); Shift+click or a drag that starts **and stays** inside the table's cells extends to a range. A drag that starts on the table's border or its move handle still moves the table. Decide the threshold with care: today any drag moves the table, and that must stay true for an unselected table.
- Arrow keys move the selection; Shift+arrows extend; Enter or F2 or typing a printable character starts editing (typing replaces the content, Enter keeps it with the caret at the end); Escape returns from editing to cell selection, a second Escape to the table.
- Delete/Backspace clears the selected cells' `html`.
- Copy writes the range as TSV and an HTML `<table>`; paste of a grid fills from the anchor (the DT-01 path).
- Draw the selection as an overlay rectangle from cell geometry; exclude it from thumbnails and export.

**B. Inspector** (`slides/src/editor/inspector/table.ts`): when `cellSel` is set, show a Cell section above the table-wide controls:

- Align: left, centre, right → `cell.align`.
- Bold → `cell.bold`.
- Fill → `cell.bg`, Text → `cell.color`, both through the existing colour control (`colorAlpha` in `inspector/color.ts`) so palette and token binding rules apply. Check whether `themeRefs` can address a cell path; if not, write literals and note it.
- "Clear cell formatting" removes the four keys.
- Mixed values across a range show as mixed, as the multi-selection fields do elsewhere.
- Shortcuts for a selected range: ⌘B bold; ⌘⇧L/E/R alignment if free in `shortcuts.ts`.

**C. Number format (optional key, second step):** `columns[i].format?: 'number' | 'currency' | 'percent'` with `decimals?` and `unit?`. Rendering formats a cell only when its text parses as a number (use the reader from DT-03). Absent key = today's behaviour. A shell that predates the key shows the cell text as typed, which is the correct fallback. Regenerate model keys and schema; add the key to the gate in `slides/src/untrusted.ts`. Ship A and B first; C is its own change.

New strings in all catalogs.

## Acceptance criteria

- [ ] Clicking a cell of a selected table selects the cell; the table does not move and text editing does not start.
- [ ] Dragging from B2 to D4 selects a 3×3 range; dragging the table by its frame still moves it; dragging an unselected table still moves it.
- [ ] Arrow keys move the selection, Shift extends, Enter edits, typing replaces, Escape steps back out.
- [ ] Align, Bold, Fill and Text in the Cell section write `align`, `bold`, `bg`, `color` on exactly the selected cells; one undo step per change.
- [ ] A user can reproduce the Showcase table's right-aligned number columns from the UI.
- [ ] Values that reach a style still pass through `cssColor` (the existing render path); a hostile colour string does not reach the DOM.
- [ ] Copy of a range pastes into a spreadsheet as cells.
- [ ] Nothing changes for a document that has no per-cell keys.
- [ ] (Step C) `format: 'currency', unit: '$', decimals: 0` renders `1204` as `$1,204`; an older shell shows `1204`.

## Tests

- Browser rig `scripts/test-slides-cell-select-browser.mjs` (real mouse input through Playwright; the canvas ignores synthetic pointer events): click, drag-range, keyboard, the Cell section writing keys, table still draggable. Register in `.github/workflows/ci-slides.yml`.
- Node rig for step C `scripts/test-slides-cell-format.ts` (pure formatter) registered in `.github/actions/validate-slides/action.yml`; extend `scripts/test-sanitize.ts` if the gate changes.
- Keep `scripts/test-slides-table-nostyle-browser.mjs` and `scripts/test-slides-table-radius-browser.mjs` green.

## Out of scope

- Merged cells, borders per cell, formulas, sorting.
- Structure edits (DT-04), overflow (DT-06), fields and maths in cells (DT-12).

## Notes for the implementer

- The drag-versus-select decision is the risk. Read how selection and Moveable interact in `canvas.ts` (the click handling around the `editCellFromTd` call sites at `canvas.ts:436`, `1089`, `2028`) before changing it, and keep the first click on an unselected table selecting the table.
- Hot files: `canvas.ts`, `inspector/table.ts`, i18n catalogs. Depends on DT-04's overlay being in place; do not run in parallel with DT-04 or DT-01.
