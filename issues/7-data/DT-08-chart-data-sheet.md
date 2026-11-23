---
id: DT-08
title: "Chart data sheet: a wide grid docked under the canvas; scatter data UI"
epic: 7-data
type: enhancement
priority: P2
size: M
evidence: mixed
labels: [enhancement, "priority:P2", "size:M", "evidence:mixed", "area:data"]
depends_on: [DT-01, DT-02]
related: [DT-07, DT-09]
upstream: []
---
## Summary

A chart's numbers are edited in a grid squeezed into the right-hand panel. With five series the category column collapses to about 12px, later series scroll out of view, Enter does not move down, and nothing can be pasted. A scatter chart has no data UI at all. Add an "Edit data" sheet docked under the canvas: wide, keyboard-navigable, paste-aware, and able to edit scatter points.

## What the user experiences

They add a fifth series and can no longer read the category names. They type a value and press Enter expecting to move to the next row; nothing moves. They switch to Scatter and find only "Advanced (JSON)". Entering twenty data points means twenty clicks or hand-editing JSON.

## Reproduce

1. Fresh load at 1440×900. Insert a chart. In the inspector press Add series until there are five.
2. Look at Data: the first (category) column is a few pixels wide; the grid scrolls horizontally inside a roughly 239px-wide panel.
3. Click a value field, type `42`, press Enter: focus stays; nothing moves down. Tab moves across (browser default).
4. Paste a copied block of cells into a field: it lands in that one field (see DT-01).
5. Set Type to Scatter: the Series and Data sections disappear; only Advanced (JSON) remains.

## Evidence

- Seen in the running 1.3.0 app during the data journey (239px grid, 12px category column at five series, Enter inert, scatter JSON-only).
- Code, verified now:
  - `slides/src/editor/inspector/chart.ts:50-51`: `if (!isPie && !isScatter) buildChartCartesian(...) else if (isPie) buildChartPie(...)`. Scatter gets neither.
  - `buildChartGrid` (`chart.ts:184-254`) builds a `<table>` of `<input>`s with `input` and `change` listeners only; no `keydown` for Enter or arrows, no `paste`.
  - CSS: `slides/src/styles.css:1369-1383`: the wrap scrolls (`overflow-x: auto`) and inputs have `min-width: 52px`; the header cells have no minimum, which is how the label column collapses.
  - The scatter preset's data shape is pairs: `kernel/src/charts.ts:67` onward.
  - A dock under the canvas already exists for speaker notes: `slides/src/editor/notespane.ts`.

## How others do it

- PowerPoint: Edit Data opens a spreadsheet window beside the chart; Chart Elements (+) is a checklist of title, labels, legend, axes.
- Keynote: Edit Chart Data opens a floating grid with row and column headers, paste support and "Plot rows/columns as series".
- Google Slides: data lives in a linked sheet.

## Proposed change

1. **Entry point.** An "Edit data" button in the chart inspector's Data section and on double-click of a chart (check that double-click is free for charts). Keep the compact grid in the panel for quick single-value edits, or replace it with a summary line plus the button; decide by what fits the panel without horizontal scroll.
2. **The sheet** (`slides/src/editor/chartsheet.ts`, new): a panel docked at the bottom of the centre column, the same slot and resize behaviour as the notes pane (read `notespane.ts` and the layout code that hosts it). One open at a time; notes pane and data sheet do not stack.
   - Grid: row header = category, column header = series name (both editable in place), body = numbers. Sticky headers; column minimum width about 88px; horizontal scroll inside the sheet only.
   - Keyboard: arrows move between cells when the caret is at the edge or the cell is not in text-edit mode; Enter commits and moves down; Shift+Enter up; Tab/Shift+Tab across; Escape cancels the cell edit; typing replaces.
   - Structure: "+" at the end of the header row adds a series, "+" under the last row adds a category; a small menu on a header deletes that series or category.
   - Paste: use `parseGrid` from DT-01. A grid pasted with the top-left cell selected replaces the data; pasted elsewhere fills from that cell and grows.
   - Every change goes through the same `editOption` path as today (`chart.ts:14-16`), live while typing and one undo step on commit.
   - Honour DT-07: when the chart is linked to a table the sheet is read-only and says where the data comes from.
3. **Pie.** Same sheet with two columns: slice name, value.
4. **Scatter.** Same sheet with columns `x`, `y` per series (series side by side, or a series picker). Data is written as `[x, y]` pairs, the shape the engine already draws.
5. **Number entry.** Accept `1,204`, `27%`, `$3k` through the shared reader from DT-03, store plain numbers.
6. New strings in all catalogs.

No format change: the chart `option` shape is unchanged.

## Acceptance criteria

- [ ] "Edit data" opens a sheet under the canvas; the chart stays visible above it and redraws as values change.
- [ ] With five series and eight categories every header is readable without resizing the browser at 1440×900.
- [ ] Enter moves down, Shift+Enter up, Tab across, arrows navigate, Escape cancels.
- [ ] Pasting a 5×4 block copied from a spreadsheet into the top-left cell replaces categories, series names and values in one undo step.
- [ ] A scatter chart's points can be added, edited and removed in the sheet; `option.series[i].data` is an array of `[x, y]` pairs.
- [ ] A pie's slices are editable in the sheet.
- [ ] A chart linked to a table shows a read-only sheet.
- [ ] Closing the sheet restores the previous layout; the notes pane still opens and closes as before.
- [ ] The sheet is keyboard reachable and its inputs have accessible names (row and column header text).
- [ ] No sheet content appears in thumbnails, the show, print or export.

## Tests

- Browser rig `scripts/test-slides-chart-sheet-browser.mjs`: open, navigate with keys, paste a grid through a `ClipboardEvent`, edit scatter pairs, linked chart read-only; assert on `window.bento.doc`. Register in `.github/workflows/ci-slides.yml`.
- Keep `scripts/test-chart-tooltip-browser.mjs` green, and `scripts/test-slides-notes-pane-browser.mjs`, which guards the dock this shares.

## Out of scope

- New chart capabilities such as stacking, value labels, titles (DT-09). The sheet may host their toggles later.
- Formulas, sorting, or a general spreadsheet.
- Linking to external files.

## Notes for the implementer

- Depends on DT-01 (grid parser) and DT-02 (type switch must not discard what the sheet just accepted).
- Shell size matters: this is new UI in every file. Measure `slides/dist-single/Bento_Slides.bento.html` before and after and report it. Reuse the existing number-field and menu helpers in `slides/src/editor/inspector/` rather than adding new widgets.
- Hot files: `inspector/chart.ts`, `styles.css`, the centre-column layout in `editor.ts`, i18n catalogs.
