---
id: DT-07
title: "Linked chart: lock the data grid; add a data-source picker"
epic: 7-data
type: bug
priority: P2
size: S
evidence: mixed
labels: [bug, "priority:P2", "size:S", "evidence:mixed", "area:data"]
depends_on: [DT-03]
related: [DT-02, DT-08]
upstream: []
---
## Summary

A chart that is live-linked to a table still shows an editable data grid. Values typed there are accepted, drawn, and then silently overwritten the next time the table changes. And the link can only be made at creation time: an existing chart cannot be pointed at a table. Lock the grid while linked, and add a Data source control.

## What the user experiences

They make a chart from a table, then correct one number in the chart's Data grid, because that is where the chart's numbers are shown. The chart updates. Later they fix a typo in the table and the chart quietly reverts their correction. In the other direction: they have a styled chart and a table with the right numbers on the same slide, and no way to connect the two except deleting the chart and making a new one from the table, losing the styling.

## Reproduce

1. Fresh load. Insert a table, fill three body rows with a label and a number each (`A 10`, `B 20`, `C 30`), select it, press "Make a chart from this table →".
2. Select the new chart. The inspector shows "🔗 Live-linked to a table" with an Unlink button, and below it the normal Data grid.
3. Type `5000` into the first value field of the grid. The chart redraws with 5000.
4. Edit any cell of the table and commit. The chart's first value returns to 10. No message.
5. Insert a second chart with the toolbar. Look for a way to link it to the table: there is none.

## Evidence

- Seen in the running 1.3.0 app during the data journey (5000 accepted, then reverted).
- Code, verified now:
  - Banner and Unlink: `slides/src/editor/inspector/chart.ts:26-38`.
  - The grid is built regardless of `el.source`: `buildChartGrid` (`chart.ts:184-254`) is called from `buildChartCartesian` (`chart.ts:179`) with no linked check; pie slices likewise (`buildChartPie`).
  - The overwrite: `syncLinkedCharts` (`slides/src/editor/editor.ts:3003-3019`) runs on every `doc` event, guarded by a signature of the slide's **tables** only, and calls `syncLinkedChart` (`slides/src/model.ts:1075-1087`), which replaces `xAxis.data` and each series' `data`. A grid edit does not change the table signature, so it survives until the next table edit.
  - The link is only ever written in `tableToChart` (`slides/src/editor/inspector/table.ts:153`, `source: { tableId: el.id }`). The model key is `ChartElement.source?: { tableId: string }` (`slides/src/model.ts:510`).

## How others do it

- Google Slides: a chart linked to Sheets is read-only in Slides, with an Update button and an Unlink option.
- PowerPoint: a linked chart's Edit Data opens the source workbook.
- Keynote has no cross-object link; its Edit Chart Data is the single source.

## Proposed change

In `slides/src/editor/inspector/chart.ts`:

1. **Locked grid.** When `el.source?.tableId` resolves to a table on the slide, render the data grid (and pie slice values, series add/remove, row add/remove) read-only: inputs `readOnly`/`disabled`, remove buttons hidden. Above it, one line: "Data comes from the table" with two actions, **Edit table** (select the table and focus it) and **Unlink** (existing behaviour). Series names, colours, type, axes and legend stay editable, because `syncLinkedChart` preserves styling.
   - When the linked table is missing ("Linked table not on this slide", already detected at `chart.ts:30`), keep the grid editable and offer Unlink and Relink.
2. **Data source control**, shown for every chart: a select with "Own data" and one entry per table on the current slide (by the table's `name`, falling back to "Table 1, 2…").
   - Choosing a table sets `source = { tableId }` and immediately runs the same derivation as `syncLinkedChart`, in one undo step. If the chart has fewer series than the table has numeric columns, add series; if more, leave the extra series and say so.
   - Choosing "Own data" deletes `source` (same as Unlink), keeping current data.
3. **Stale state.** If a locked grid ever disagrees with the table (file edited by hand, or an agent wrote both), the next `doc` event already re-derives. No extra work, but add a rig case.
4. New strings in all catalogs: the info line, "Edit table", "Data source", "Own data".

No format change: `source.tableId` already exists and passes the gate (`slides/src/untrusted.ts:581`).

## Acceptance criteria

- [ ] In a linked chart the value, category and slice inputs cannot be edited, and no add/remove row or series control is active.
- [ ] The panel states that data comes from the table and offers Edit table and Unlink.
- [ ] Edit table selects the linked table.
- [ ] After Unlink the grid is editable and holds the last table-derived data.
- [ ] A chart inserted from the toolbar can be linked to a table on the same slide through Data source; its values match the table immediately.
- [ ] Linking preserves the chart's colours, type, legend and axis settings.
- [ ] Linking and unlinking are each one undo step.
- [ ] With the linked table deleted, the panel says so and the grid is editable again.

## Tests

- Browser rig `scripts/test-slides-chart-link-browser.mjs`: make a chart from a table, assert the grid inputs are read-only, try to type (value unchanged in `window.bento.doc`), unlink, link a second chart through the picker and compare series data to the table. Register in `.github/workflows/ci-slides.yml`.
- Extend the node rig from DT-03 (`scripts/test-slides-table-chart.ts`) with a "link an existing chart" case for the pure derivation.
- For the bug half, the rig must show on the parent commit that a grid edit is accepted and then lost.

## Out of scope

- Linking to a table on another slide or in another file.
- Choosing which columns map to which series (possible follow-up once the picker exists).
- The wide data sheet (DT-08), which must honour the same lock.

## Notes for the implementer

- Depends on DT-03 so that creation and live link share one parser before more UI is built on the link.
- `inspector/chart.ts` is a hot file shared with DT-02 and DT-08. Land DT-02 first.
- The emoji in the existing banner strings is upstream's; do not add more.
