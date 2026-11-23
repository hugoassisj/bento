---
id: DT-04
title: "Table structure editing: header strips; insert, delete and move rows and columns anywhere"
epic: 7-data
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:data"]
depends_on: []
related: [DT-05, DT-06, DT-01]
upstream: []
---
## Summary

A table can only grow or shrink at its end. There is no way to insert a row above the one you are in, delete the second column, or reorder rows. Add row and column header strips to a selected table (click to select a track, "+" between tracks to insert, a menu to delete, drag to reorder) and matching entries in the context menu and command list.

## What the user experiences

They realise a row is missing in the middle of a ten-row table. The inspector's Rows field adds one at the bottom. The only path is to retype every row below the gap. Right-clicking the table shows the generic element menu (cut, copy, order), nothing about rows or columns.

## Reproduce

1. Fresh load. Insert a table (3 columns × 3 rows by default). Type `A`, `B`, `C` down the first column.
2. Try to insert a row between `A` and `B`: the inspector offers Columns and Rows number fields only. Raising Rows from 3 to 4 appends an empty row at the bottom.
3. Lower Columns from 3 to 2: the **last** column is removed, whatever it holds.
4. Right-click the table: no row or column actions.
5. In a cell, press Tab on the last cell: a row is appended (this works, and is the only in-canvas structural edit).

## Evidence

- Seen in the running 1.3.0 app during the data journey: end-only steppers, generic context menu.
- Code, verified now:
  - `slides/src/editor/inspector/table.ts:13-29`: the `count()` helper grows with `columns.push` / `rows.push` and shrinks with `pop()`.
  - `slides/src/editor/canvas.ts:2569-2596` `moveCell`: Tab past the last cell pushes a new row (`canvas.ts:2585-2591`).
  - Column **resize** handles already exist: `canvas.ts:1620-1634` builds `.bento-col-handle` elements between columns and `startColResize` writes `columns[i].w`. This is the overlay pattern to extend.
- Not re-verified in code: the context-menu contents for a table (observed in the app only).

## How others do it

- Keynote: a selected table shows a column bar on top and a row bar at the left; each has a ▾ menu (Add Row Above/Below, Delete Row, Sort) and drag handles to reorder.
- PowerPoint: Table Layout tab with Insert Above/Below/Left/Right and Delete.
- Figma Slides and Notion: hover "+" between tracks; drag the track handle to move.
- Penpot's grid layout editor: clickable track headers.

## Proposed change

1. **Pure operations** in a new `slides/src/tableops.ts` (DOM-free, so a node rig can pin them):
   `insertRow(tb, at)`, `deleteRow(tb, r)`, `moveRow(tb, from, to)`, `insertColumn(tb, at)`, `deleteColumn(tb, c)`, `moveColumn(tb, from, to)`.
   - Keep `columns[]` and every `rows[].cells[]` in lockstep.
   - A new column takes the average width weight; a deleted column's weight is dropped (the table keeps its box width).
   - Never delete the last row or column; never delete or move the header row out of position 0 while `header` is true.
   - New cells are `{ html: '' }`.
2. **Overlay** in `slides/src/editor/canvas.ts`, built alongside the existing column handles when exactly one table is selected and nothing is being dragged:
   - A column strip above the table and a row strip to its left, one segment per track, sized from the rendered `<col>`/`<tr>` geometry (`getBoundingClientRect`, as the cell editor already queries `td[data-r][data-c]`).
   - Click a segment: track becomes the active track (highlight). Delete/Backspace deletes it.
   - "+" buttons on the boundaries between segments and at both ends: insert there.
   - A ▾ on the active segment opens a small menu: Insert before, Insert after, Delete, Move earlier, Move later.
   - Drag a segment along its strip to reorder (mouse events; see the note on synthetic input in `00-READ-FIRST.md`).
   - Strips are editor chrome: `data-export="omit"` or equivalent so they never reach thumbnails, print or image export. Check how `.bento-col-handle` is excluded and do the same.
3. **Context menu and commands**: when the pointer is over a cell, add Insert row above/below, Insert column left/right, Delete row, Delete column. Register them as commands in the list in `slides/src/editor/editor.ts` (the block around `id: 'insert-chart'`), with `when` requiring a table cell context, so ⌘K finds them.
4. **While editing a cell**: `Alt+↑/↓` moves the row, matching list-item conventions; optional.
5. Keep the inspector's Rows and Columns fields; they keep appending at the end.
6. Linked charts: `syncLinkedCharts` re-derives from the table on every `doc` event (`editor.ts:3003-3019`), so structure edits flow through; verify the chart follows a moved column.
7. New strings in all catalogs (about ten).

No format change.

## Acceptance criteria

- [ ] With a table selected, strips appear on the top and left and track the table through zoom and pan.
- [ ] "+" between row 1 and row 2 inserts an empty row there; existing cells keep their content and per-cell keys.
- [ ] Deleting column 2 of 4 removes exactly that column from `columns` and from every row.
- [ ] Moving row 3 to position 1 (below the header) reorders `rows` and nothing else.
- [ ] The header row cannot be deleted or displaced while Header row is on.
- [ ] Each operation is one undo step.
- [ ] The same six actions exist in the right-click menu over a cell and in ⌘K.
- [ ] Strips do not appear in thumbnails, the show, print, or exported images.
- [ ] A chart linked to the table updates after each structural edit.
- [ ] In a live session a second editor sees the same result (no row/cell count mismatch).

## Tests

- New node rig `scripts/test-slides-table-ops.ts`: every operation, the guards, lockstep invariants (every row has `columns.length` cells) under a few hundred random operations. Register in `.github/actions/validate-slides/action.yml`.
- New browser rig `scripts/test-slides-table-strips-browser.mjs`: strips render, "+" inserts, delete key deletes, strips absent from a thumbnail. Register in `.github/workflows/ci-slides.yml`. Existing table rigs to keep green: `scripts/test-slides-table-nostyle-browser.mjs`, `scripts/test-slides-table-radius-browser.mjs`.

## Out of scope

- Cell and range selection, per-cell formatting (DT-05).
- Sorting, merged cells (merging needs a format addition).
- Row height handles and overflow behaviour (DT-06).
- Spreadsheet paste (DT-01).

## Notes for the implementer

- `rows` is an array in the collaborative document. Check how the CRDT merges concurrent inserts into nested arrays before relying on index-based splices: read `slides/CLAUDE.md` on the sync model and run `node scripts/test-sync.ts` if you touch anything under `sync/`. If two editors inserting rows at once can desynchronise `cells` lengths, say so in the change and add a repair on load, do not ignore it.
- `canvas.ts` is the hottest file in the editor. DT-05 edits the same table code; land this first and do not run them in parallel.
