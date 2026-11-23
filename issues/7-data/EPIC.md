---
id: EPIC-7
title: "Epic 7 · Data: paste, tables, charts"
labels: [epic, "area:data"]
---
## Goal

Someone who builds data-heavy decks can bring numbers in from a spreadsheet, shape them in a table, chart them, and change their mind, without losing data and without leaving the slide. Code, count-ups and formulas, which ride along in the same decks, stop fighting the keyboard.

## Why it matters

The audit's data journey (an analyst persona: tables copied from Excel or Google Sheets, a few charts, some code and formulas) found the deepest hole in the product here. Two things lose work outright: switching a chart's type replaces the user's data with sample data (DT-02), and a chart made from a table silently drops any column written as currency or in accounting brackets (DT-03). Spreadsheet paste, the first thing this persona does, is wrong at every target (DT-01). Tables cannot be restructured or formatted cell by cell although the document format already has the keys (DT-04, DT-05).

What already delights and must not regress: a table edit updates its linked chart instantly; charts are live while presenting (tooltips, wheel zoom, drag pan); bar, pie and scatter morph in place through state slides; code and formulas morph token by token; `$…$` maths renders on commit and restores its source on re-edit; Tab off the last table cell appends a row.

## Children, in recommended order

- [ ] **DT-02** Switching a chart's type discards its data (P0, S). First: it loses data.
- [ ] **DT-03** Chart from table: parse real-world numbers, say what was charted, fit the placement (P1, S).
- [ ] **DT-10** Code blocks: Tab indents; paste detects code; language guess (P1, S).
- [ ] **DT-01** One spreadsheet-paste pipeline: canvas, cell, chart grid (P1, M).
- [ ] **DT-06** Table overflow: grow the box with its content; warn when it leaves the slide (P1, M).
- [ ] **DT-04** Table structure editing: header strips; insert, delete and move rows and columns anywhere (P1, M).
- [ ] **DT-05** Cell and range selection; a Cell section in the inspector (P1, L).
- [ ] **DT-07** Linked chart: lock the data grid; add a data-source picker (P2, S).
- [ ] **DT-11** Count-up keeps formatting and counts only the chosen number (P2, S).
- [ ] **DT-08** Chart data sheet: a wide grid docked under the canvas; scatter data UI (P2, M).
- [ ] **DT-09** Chart engine: stacked bars, value labels, title, axis names, number format (P2, L, kernel zone).
- [ ] **DT-12** Fields and maths render inside table cells (P3, S).
- [ ] **DT-13** New chart and table defaults: centred placement, readable axis text, content layouts (P3, S).
- [ ] **DT-14** Maths: show the reason for invalid LaTeX (P3, S).

## Dependencies

- DT-01 defines the shared grid parser (`parseGrid`); DT-08's data sheet reuses its chart-grid target, and DT-05's range selection reuses its "fill from the anchor cell" path. Land DT-01 before both.
- DT-03 should move number parsing into the one shared function in `slides/src/model.ts` (`tableChartColumns`); DT-07 builds on the same link.
- DT-04 (structure) lands before DT-05 (cell and range selection): both touch table editing in `slides/src/editor/canvas.ts`, so do not run them in parallel.
- DT-09 is the only child in the kernel zone (`kernel/src/charts.ts`). It is serialized: one small step per capability, each with its own review. DT-08's "Elements" controls depend on whichever DT-09 steps have landed.
- Outside this epic: F-10 (Check deck panel) is where DT-06's warning should also appear; F-09 (validator) is where clipped chart labels are reported; AI-09 adds agent-facing chart layouts that overlap DT-13.

## Hot files (do not edit in parallel)

`slides/src/editor/canvas.ts` (table cell editing, code editing), `slides/src/editor/paste.ts`, `slides/src/editor/editor.ts` (document paste handler, `syncLinkedCharts`), `slides/src/editor/inspector/chart.ts`, `slides/src/editor/inspector/table.ts`, every catalog under `slides/src/i18n/`, `CHANGELOG.md`.

## Definition of done

- Every child is closed with a rig registered in CI, and each bug's rig is recorded failing on its parent commit.
- A 4×4 block copied from Google Sheets or Excel becomes a correct table on the canvas, fills cells from the anchor inside a table, and replaces a chart's data in the data sheet.
- No chart operation offered by the inspector discards user data without an undoable, announced step.
- A table can gain or lose a row or column anywhere, and a cell can be aligned, filled and coloured from the inspector, writing only keys the format already has.
- The Showcase deck still validates as it did before, the linked-chart demo still updates live, and code and formula morphs are unchanged.
