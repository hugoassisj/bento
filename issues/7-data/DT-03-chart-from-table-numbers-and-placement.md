---
id: DT-03
title: "Chart from table: parse real-world numbers, say what was charted, fit the placement"
epic: 7-data
type: bug
priority: P1
size: S
evidence: seen
labels: [bug, "priority:P1", "size:S", "evidence:seen", "area:data"]
depends_on: []
related: [DT-07, DT-11, DT-13]
upstream: []
---
## Summary

"Make a chart from this table" silently drops every column whose numbers are written the way finance writes them (`$1,204`, `(300)`, `€9.4M`), charts whatever is left without saying so, and places the chart so its lower part hangs off the slide. Parse real-world number formats, tell the user which columns were charted, and place the chart inside the slide.

## What the user experiences

A table has Revenue (`$1,204`), Costs (`(300)`) and Margin (`27%`). They press Make a chart. The chart shows Margin only. The toast says "Chart created — it updates live with the table". Nothing mentions that two of three columns were ignored, so the chart looks authoritative and is wrong. Its axis labels and legend sit below the slide's bottom edge.

## Reproduce

1. Fresh load. Insert a table. Fill it (double-click cells; Tab moves across):

| Quarter | Revenue | Costs | Margin |
|---|---|---|---|
| Q1 | $1,204 | (300) | 27% |
| Q2 | $1,530 | (410) | 31% |
| Q3 | $2,310 | (520) | 33% |

2. Select the table. Inspector ▸ "Make a chart from this table →".
3. Result: a bar chart with a single series, Margin. No message about Revenue or Costs.
4. With the table at its default position (`y 220, h 260`), the chart is created at `y 480, h 300`: its box ends at 780 on a 720-high slide.

## Evidence

- Seen in the running 1.3.0 app during the data journey (columns vanished; chart at y=480, h=300).
- Code, verified now:
  - `slides/src/editor/inspector/table.ts:92-158` `tableToChart`: `strip()` removes tags, entities and commas, then `num = parseFloat(strip(html))`. `parseFloat('$1204')` and `parseFloat('(300)')` are `NaN`, and a column with fewer than half its rows numeric is skipped (`table.ts:105`).
  - The same logic is **duplicated** for the live link in `slides/src/model.ts:1046-1067` (`stripCell`, `tableChartColumns`), used by `syncLinkedChart` (`model.ts:1075-1087`). Fixing only one leaves creation and live updates disagreeing.
  - Placement: `table.ts:151` `y: Math.min(el.y + el.h + 24, 480), w: Math.max(el.w, 640), h: 300`. On the default 1280×720 slide, 480 + 300 = 780.
  - Only-toast-on-empty: `table.ts:115` shows "No numeric column found to chart" when **no** column parses; a partial result is silent.
  - `slides/src/countnumber.ts` already has the project's ruled-on number reader (`readNumber`, `isCountable`), covering grouping and decimal separators.

## How others do it

- Excel to PowerPoint, and Numbers to Keynote: currency, accounting brackets and percent are numbers, because the cell has a number format.
- Google Sheets charts: non-numeric columns are listed as ignored in the chart editor's data range.

## Proposed change

1. One shared parser in `slides/src/model.ts`: `readCellNumber(text: string): { value: number, unit?: string, pct?: boolean } | null`.
   - Strip tags and entities as `stripCell` does.
   - Accounting negative: `(300)` → −300. Leading sign or Unicode minus `−`.
   - Currency symbol or code before or after the number (`$ € £ ¥`, `USD`, `EUR`…): remember as `unit`.
   - Percent sign: `pct: true`.
   - Magnitude suffix `k`, `K`, `M`, `B`, `bn`, `m` directly after the number: multiply. Keep the suffix out of `unit`.
   - Separators: delegate to `countnumber.ts` `readNumber` so `1,204`, `1.204,5` and `1 204` follow the rule the maintainer already settled (2026-10-15, #584). Do not invent a second rule.
   - Anything else returns `null`.
2. `tableChartColumns` uses it and additionally returns `skipped: string[]` (header names of columns not charted) and a per-column `unit`. Delete the duplicate in `inspector/table.ts` and call `tableChartColumns`.
3. `tableToChart`: when a column has one consistent unit, put it in the axis label formatter (`axisLabel.formatter`, a template string such as `${value}`, the same way the percent case does today at `table.ts:137`). Toast: "Charted 2 of 3 columns — Notes is not numeric" (new string, all catalogs). Keep the existing success toast when everything charted.
4. Placement: compute a box that fits the slide. Prefer below the table when `el.y + el.h + 24 + h ≤ slideHeight − margin`; otherwise beside it when there is room; otherwise centred with `h` reduced, never extending past the slide. Use `store.doc.size`, not constants.

No format change: `source: { tableId }` is unchanged.

## Acceptance criteria

- [ ] The table above produces a chart with three series: Revenue `[1204, 1530, 2310]`, Costs `[-300, -410, -520]`, Margin `[27, 31, 33]`.
- [ ] `€9.4M`, `1.2k`, `−15`, `12 %`, `USD 3,000` parse to 9400000, 1200, −15, 12 (pct), 3000 (unit USD).
- [ ] `1.2.3`, `192.168.1.1`, `Q1`, `n/a` are not numbers.
- [ ] A table with a text column produces a toast naming the column that was not charted.
- [ ] The created chart's box lies entirely within the slide for a table at the default position, at the bottom of the slide, and on a 4:3 and a 9:16 deck.
- [ ] Editing a `$1,204` cell to `$2,000` updates the linked chart (creation and live link share one parser).
- [ ] There is exactly one implementation of cell-to-number in the codebase.

## Tests

- New node rig `scripts/test-slides-table-chart.ts`: `readCellNumber` table of cases; `tableChartColumns` on the fixture above (series, `skipped`, units); `syncLinkedChart` round trip. Register in `.github/actions/validate-slides/action.yml`. It must fail on the parent commit for the `$1,204` and `(300)` columns.
- Extend `scripts/test-slides-countup-number.ts` only if `readNumber` itself changes (it should not).
- Placement: a pure function `chartBoxFor(table, size)` asserted in the same rig for the three deck sizes.

## Out of scope

- Charting more than the body rows (totals, grouping).
- Choosing columns by hand (that is DT-07's data-source picker).
- Number formatting of the cells themselves (DT-05).

## Notes for the implementer

- The starter deck has a live-linked chart (`slides/src/starterdeck.ts:1226`, `source: { tableId: 'sd-table' }`). Its rendering must not change; check the starter-deck rig stays green.
- `model.ts` is shared by every part of the app; keep the new function pure and small.
- `syncLinkedChart` maps series to numeric columns **by position**. If a previously skipped column now parses, an existing linked chart gains data in a different series slot. Decide and document: keep position mapping but only for charts created after this change is not possible to detect, so prefer mapping by series `name` to header name when names match, falling back to position.
