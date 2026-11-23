---
id: DT-09
title: "Chart engine: stacked bars, value labels, title, axis names, number format"
epic: 7-data
type: enhancement
priority: P2
size: L
evidence: mixed
labels: [enhancement, "priority:P2", "size:L", "evidence:mixed", "area:data", "kernel-zone", "format-change"]
depends_on: []
related: [DT-08, DT-13, F-09]
upstream: []
---
## Summary

The in-house chart engine draws bar, line, pie and scatter, and stops there. The things an analyst's chart needs most are missing: stacked bars, value labels on bars and lines, a chart title, an x-axis name, and a number format for values and axis ticks. Each is an option key the engine ignores today. Add them to the engine one at a time, then expose them in the inspector.

## What the user experiences

They set `stack`, a series `label`, a `title` and `xAxis.name` in Advanced (JSON) because the panel has no controls for them. The JSON is accepted, the chart looks the same, and nothing in the editor says the keys did nothing. A revenue chart cannot show "$1.2M" on its bars or its axis.

## Reproduce

1. Fresh load. Insert a chart. Open Advanced (JSON) in the inspector.
2. Replace the option with:
```json
{
  "title": { "text": "Revenue by quarter" },
  "xAxis": { "type": "category", "data": ["Q1", "Q2", "Q3", "Q4"], "name": "Quarter" },
  "yAxis": { "type": "value", "name": "USD" },
  "series": [
    { "type": "bar", "name": "Product", "stack": "total", "label": { "show": true }, "data": [12, 20, 15, 28] },
    { "type": "bar", "name": "Services", "stack": "total", "label": { "show": true }, "data": [8, 14, 19, 21] }
  ]
}
```
3. Blur the textarea. Result: grouped bars (not stacked), no value labels, no title, no "Quarter" under the axis. "USD" does appear above the y axis.
4. Console: `(await window.bento.validate()).findings.filter(f => f.code === 'chart-key-ignored')` lists `option.title`, `series[].stack`, `series[].label`. (Check whether `xAxis.name` is listed: `name` is in the allowed axis keys, so it may be accepted by the validator and still not drawn.)

## Evidence

- Seen in the running 1.3.0 app during the data journey: `stack`, series `label`, `title` and `xAxis.name` had no effect.
- Code, verified now:
  - `slides/src/charts.ts` is a 6-line facade over `kernel/src/charts.ts` (900 lines).
  - The validator's allowlist of implemented keys is `CHART_KEYS` in `slides/src/validate.ts:74-85`: top-level `color, series, xAxis, yAxis, legend, grid, tooltip, textStyle, dataZoom`; series `type, name, data, yAxisIndex, itemStyle` plus per type (`bar: barWidth`; `line: smooth, symbol, symbolSize, lineStyle, areaStyle`; `scatter: symbol, symbolSize`; `pie: radius, label`); axis `type, data, min, max, axisLabel, axisLine, splitLine, name`. `validateChart` (`validate.ts:432-470`) reports everything else as `chart-key-ignored`, with a special message for `label` on non-pie series.
  - `kernel/src/charts.ts` contains no reference to `stack` or to an option `title`. Axis names are drawn for the y axes only (`kernel/src/charts.ts:479-484`). Pie reads `label.formatter` (`kernel/src/charts.ts:648`).
- Unverified: whether `axisLabel.formatter` supports more than the `{value}%` template used by `tableToChart`.

## How others do it

- PowerPoint: Chart Elements (+) toggles Chart Title, Axis Titles, Data Labels; Change Chart Type has Stacked Column; Format Axis ▸ Number.
- Keynote: Format ▸ Chart has Title, Legend, Value Labels with a number format; Axis tab has Axis Name; stacked bar is a chart type.
- Google Sheets charts: Stacking, Data labels, Number format under Customize.

## Proposed change

This is **kernel zone** (`kernel/src/charts.ts`, shared by every Bento app). Serialize: one small change per capability, each reviewed alone, each with its own rig case. Do not batch.

Order, smallest first:

1. **x-axis name.** Draw `xAxis.name` centred under the axis; reserve space in the grid. Already an allowed key.
2. **Chart title.** `title: { text, left?: 'left'|'center'|'right' }`; reserve top space; use `textStyle`. Add `title` to `CHART_KEYS.top`.
3. **Value labels.** `series[i].label: { show: true, position?: 'top'|'inside', formatter?: string }` for bar, line and scatter. Template tokens only (`{c}` value, `{b}` category, `{a}` series), matching the pie's existing `{b}`/`{d}`. Skip a label that would collide with its neighbour or leave the plot (do not overlap; the validator item in F-09 covers clipped labels). Extend `CHART_KEYS.seriesByType`.
4. **Stacking.** `series[i].stack: string` on bar (and area lines): series sharing a stack name accumulate; negative values stack downward; axis range from the stacked totals; tooltip lists each part. Morph between stacked and grouped should tween heights; check the chart morph path (`slides/src/present.ts` chart handling) and state the behaviour.
5. **Number format.** A pure-JSON format, no functions: `valueFormat: { style?: 'number'|'currency'|'percent', unit?: string, decimals?: number, compact?: boolean }` at top level (and optionally per axis). Used for axis ticks, value labels and tooltips. `compact: true` gives `1.2M`. Grouping and decimal separators are authored, not locale-driven: follow the rule recorded for count-up in `slides/src/countnumber.ts` (document content must read the same for every viewer).

Then, in `slides/src` (not kernel): an **Elements** block in `slides/src/editor/inspector/chart.ts` with toggles for Title (and its text), Axis names, Value labels, Stacked, and a Number format row. Each toggle only appears once its engine step has landed.

Format: these are new optional keys inside the chart `option`. A shell that predates them draws the chart as today (ignores the keys). State that in each change. Regenerate the schema (`node scripts/build-schema.mjs`) and update `CHART_KEYS` in the same change as each engine step, so `validate()` stops flagging a key exactly when it starts working. Update `docs/format.md` and `docs/agents.md` chart sections.

Alternatives rejected: adopting a chart library (ruled out upstream: "extend charts-lite"); formatter functions (the document is pure data).

## Acceptance criteria

- [ ] The option above renders stacked bars whose totals are 20, 34, 34, 49, with labels, a title and both axis names.
- [ ] `validate()` reports no `chart-key-ignored` for `title`, `stack`, bar/line `label`, `valueFormat` once implemented, and still reports unknown keys.
- [ ] `valueFormat: { style: 'currency', unit: '$', compact: true }` shows `$1.2M` on ticks, labels and tooltips for 1200000.
- [ ] Negative values stack below zero; the axis includes the most negative total.
- [ ] Value labels never overlap each other or leave the plot area; when they cannot fit they are omitted.
- [ ] A chart without the new keys renders pixel-identically to before (compare against the Showcase charts).
- [ ] Bar → pie and bar → scatter state morphs in the Showcase still animate.
- [ ] Options remain pure JSON: no function, no HTML in labels (text is escaped).
- [ ] Each engine step is its own change with its own byte-cost note.

## Tests

- Search `scripts/` for the existing chart engine rigs before starting (`scripts/test-chart-tooltip-browser.mjs` exists; look for a node rig over `kernel/src/charts.ts`). Add `scripts/test-charts-stack-labels.ts` (or extend the existing engine rig): geometry assertions on the produced SVG (bar `y`/`height` for stacks, label text and positions, title present), and the number formatter as a pure table. Register it in the kernel slice of CI, not the slides slice (read `.github/workflows/ci.yml` for where kernel rigs run) and confirm `scripts/test-ci-registered.ts` is satisfied.
- Extend the validate rig so each newly implemented key leaves `CHART_KEYS` in step.
- Browser check of the Showcase chart slides for unchanged rendering.

## Out of scope

- New chart types (area as its own type, combo presets, radar, treemap).
- The data sheet (DT-08).
- Animation of labels.

## Notes for the implementer

- Read `docs/PARALLEL-WORK.md` §1 on the kernel zone before the first line. Dash and other apps consume the same engine; a regression there is not acceptable.
- Text in SVG must be escaped; anything reaching a style goes through the existing gates.
- Shell size: the engine travels in every file of every app. Report bytes per step; if a capability costs more than it is worth, stop and say so.
- `needs-upstream-discussion` is not set, but expect upstream to want each engine step proposed separately.
