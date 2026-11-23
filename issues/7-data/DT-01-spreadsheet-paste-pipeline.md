---
id: DT-01
title: "One spreadsheet-paste pipeline: canvas, cell, chart grid"
epic: 7-data
type: enhancement
priority: P1
size: M
evidence: seen
labels: [enhancement, "priority:P1", "size:M", "evidence:seen", "area:data"]
depends_on: []
related: [DT-05, DT-08, F-04]
upstream: []
---
## Summary

Rows copied from a spreadsheet arrive wrong at every place they can be pasted: fused into one string inside a table cell, as a text box on top of a selected table, as a text box on an empty slide, and as one blob in a chart's data grid. Add one clipboard-grid parser and route it to three targets: the canvas makes a table, a table cell fills from the anchor, a chart's data grid replaces its data.

## What the user experiences

An analyst copies a 4×4 block from Google Sheets and pastes it. Inside a cell they get `RegionQ1Q2GrowthEMEA1,2041,530…` with no separators. On the slide they get a centred 600×120 System UI text box. With a table selected, the same text box lands on top of the table. In the chart panel, the whole block lands in one category field. Every route ends in retyping.

## Reproduce

Clipboard used in the audit (Google Sheets writes both flavours):

`text/plain`:
```
Region	Q1	Q2	Growth
EMEA	1,204	1,530	27%
APAC	980	1,210	23%
Americas	2,310	2,480	7%
```
`text/html`: `<meta charset="utf-8"><table><tbody><tr><td>Region</td><td>Q1</td><td>Q2</td><td>Growth</td></tr><tr><td>EMEA</td><td>1,204</td><td>1,530</td><td>27%</td></tr><tr><td>APAC</td><td>980</td><td>1,210</td><td>23%</td></tr><tr><td>Americas</td><td>2,310</td><td>2,480</td><td>7%</td></tr></tbody></table>`

1. Fresh load. Insert a table (toolbar Table). Double-click cell A1 and paste. Result: all sixteen values in A1 with no separators.
2. Same, with only the `text/plain` flavour on the clipboard. Result: one cell, values separated by non-breaking spaces.
3. Click the empty canvas (nothing editing) and paste. Result: a centred text box, 600×120, toast "Text pasted".
4. Select the table (not editing) and paste. Result: the same text box, placed over the table.
5. Insert a chart, open Data in the inspector, focus the first category field and paste. Result: the block in that one field.

## Evidence

- Seen in the running 1.3.0 app during the data journey. Pastes were synthetic `ClipboardEvent`s; the app's handlers ran and called `preventDefault`, so this is the app's behaviour. Step 5 emulated the browser default because there is no handler.
- Code, verified now:
  - Cell paste: `slides/src/editor/canvas.ts:2525-2533` takes `clipboardToHtml()` and runs `insertHTML`. `slides/src/editor/paste.ts:36-60` sends the HTML through `sanitizeHtml`, an allowlist that unwraps `table/tr/td`, which is why the values fuse. The plain fallback goes through `markdownToHtml`.
  - Canvas paste: `slides/src/editor/editor.ts:2849-2863` reads an image file or `text/plain` only; `pasteFromText` (`editor.ts:2874-2913`) ends in a `defaultText` box at `width/2 - 300, y 260, w 600`. The HTML flavour is never read here, and a selected table is not considered.
  - Chart grid: `buildChartGrid` in `slides/src/editor/inspector/chart.ts:184-254` builds plain `<input>`s with `input` and `change` listeners and no `paste` listener.

## How others do it

- PowerPoint: pasting cells makes a table and offers Paste Options (use destination styles, keep source formatting, picture, text only).
- Keynote: pasting into a table fills from the selected cell and grows the table; pasting on the canvas makes a table.
- Google Slides: pasting from Sheets makes a table and offers to link it.
- PowerPoint's chart Edit Data sheet and Keynote's Edit Chart Data accept a pasted block.

## Proposed change

1. New pure module `slides/src/editor/gridpaste.ts` exporting `parseGrid(dt: DataTransfer | {html?: string, text?: string}): string[][] | null`.
   - Prefer `text/html` when it contains a `<table>`: parse in an inert `DOMParser` document exactly as `paste.ts` does (never attach untrusted nodes), read `tr > td,th` text, honour `colspan` by padding.
   - Fall back to `text/plain` when it has at least one tab and two or more lines, or two or more tab-separated values on every line. Handle `\r\n` and one trailing newline. Quoted TSV cells with embedded newlines are out of scope.
   - Return `null` for anything that is not a grid (a single value, prose), so existing paths are untouched.
   - Cap at the table limits the editor already enforces (64 rows and 64 columns in `inspector/table.ts`).
2. Canvas target (`editor.ts` document paste handler, before `pasteFromText`): a grid becomes a `defaultTable` sized to the grid, first row as header when no cell in it is numeric, numeric columns right-aligned through the existing `TableCell.align`. Centre it on the slide. Toast: "Pasted a 4×4 table" with an action "Keep as text" that undoes and runs the old text path.
3. Table target: when a table is selected but not being edited, or a cell is being edited and the clipboard is a grid, fill from the anchor cell (selected table: top-left body cell; editing: that cell), growing rows and columns as needed, one undo step. A non-grid paste into a cell keeps today's behaviour.
4. Chart target: a `paste` listener on the data grid in `buildChartGrid`. First column is categories, first row series names when non-numeric, the rest numbers (parse with the shared number reader from DT-03). Replace the chart's data in one undo step.
5. New strings (all catalogs): the two toasts and the action label.

Alternatives rejected: teaching `sanitizeHtml` about tables (it is the single security allowlist and table markup has no meaning inside a text run); a tab-to-`<br>` conversion inside cells (still one cell).

## Acceptance criteria

- [ ] `parseGrid` returns the 4×4 array for both flavours above, and `null` for `hello world`, a single number and a one-line sentence with no tabs.
- [ ] Pasting the block on an empty canvas inserts one table element with 4 columns and 4 rows; no text element is created.
- [ ] Growth and number columns are right-aligned through `cells[].align`; the header row is detected.
- [ ] Pasting with a table selected fills that table from its first body cell and does not create a new element.
- [ ] Pasting while editing cell B2 of a 3×3 table writes B2…E5 and grows the table to fit, as one undo step.
- [ ] Pasting into the chart data grid replaces categories, series names and values; the chart redraws; one undo restores the old data.
- [ ] "Keep as text" restores the previous text-box behaviour.
- [ ] Pasting ordinary rich text into a cell still keeps bold and italic (no regression of discussion #503 behaviour).
- [ ] No pasted node is ever attached to the live document before sanitising.

## Tests

- New node rig `scripts/test-slides-grid-paste.ts`: `parseGrid` cases (HTML table, TSV, CRLF, ragged rows, colspan, non-grids, the 64-limit, hostile HTML such as `<img onerror>` inside a cell returning text only). Register in `.github/actions/validate-slides/action.yml`.
- New browser rig `scripts/test-slides-grid-paste-browser.mjs`: the four targets, driven by a `ClipboardEvent` with a `DataTransfer` carrying both flavours; assert on `window.bento.doc`. Register in `.github/workflows/ci-slides.yml`. Model it on `scripts/test-slides-paste-position-browser.mjs` and `test-slides-paste-spaces-browser.mjs`.
- Keep `scripts/test-slides-paste-spaces.ts` and `scripts/test-clipboard.ts` green.

## Out of scope

- A live link to the source spreadsheet.
- Pasting formulas, merged cells, cell colours from the source.
- CSV files dropped on the canvas.
- The wide chart data sheet itself (DT-08) and range selection (DT-05).

## Notes for the implementer

- `slides/src/editor/paste.ts` documents why untrusted HTML is parsed in a detached document; follow it exactly. Cell text you extract still goes through `sanitizeHtml` before it reaches `cell.html`.
- Hot files: `canvas.ts`, `editor.ts`, `inspector/chart.ts`, the i18n catalogs. Do not run this alongside DT-04, DT-05 or DT-08.
- F-04 changes how plain text pasted on the canvas is boxed; keep the grid check ahead of it so the two do not fight.
