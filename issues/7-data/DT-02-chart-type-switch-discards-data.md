---
id: DT-02
title: "Switching a chart's type discards its data"
epic: 7-data
type: bug
priority: P0
size: S
evidence: seen
labels: [bug, "priority:P0", "size:S", "evidence:seen", "area:data"]
depends_on: []
related: [DT-08, DT-09]
upstream: []
---
## Summary

Choosing a different Type in the chart inspector replaces the whole chart option with that type's sample data. A chart the user has filled with their own series becomes "Trend, Jan–Jun". Undo is the only way back, and nothing warns them.

## What the user experiences

They build a bar chart with five series of real numbers, wonder how it reads as a line chart, click Line, and their data is gone. The chart now shows the built-in sample. If they keep working and notice later, the data is beyond the point they would think to undo to.

## Reproduce

1. Fresh load. Toolbar ▸ Chart (inserts the bar preset: Series A `[12, 20, 15, 28]`, Series B `[8, 14, 19, 21]`, categories `Q1…Q4`).
2. In the inspector, Add series three times, rename the five series `North, South, East, West, Online`, and type values into the Data grid, for example row Q1: `101, 102, 103, 104, 105`.
3. In Chart ▸ Type, click Line.
4. Result: one series named `Trend` with data `[4, 7, 6, 11, 14, 18]` over `Jan…Jun`. `window.bento.doc` confirms the user's series are gone from `option`.

## Evidence

- Seen in the running 1.3.0 app during the data journey.
- Code, verified now: `slides/src/editor/inspector/chart.ts:40-48`. The Type control's handler does `c.preset = v; c.option = applyChartPalette(CHART_PRESETS[v](), p.store.doc.theme)`. `CHART_PRESETS` (`kernel/src/charts.ts:33` onward) are factory functions returning sample options. The per-series Bar/Line control lower in the same file (`chart.ts:116-118`) already converts in place by setting `series[i].type`, which shows the intended shape of the fix.

## How others do it

- PowerPoint: Change Chart Type keeps the data sheet and redraws.
- Keynote: the chart type menu keeps the data.
- Google Slides: chart type is edited in the linked sheet, data untouched.

## Proposed change

Convert in place in `slides/src/editor/inspector/chart.ts`, with a small pure helper (put it in `slides/src/model.ts` next to `syncLinkedChart`, or a new `slides/src/chartconvert.ts`, so a node rig can test it):

`convertChart(option, from, to): option`

- **bar ↔ line**: set every series `type`; drop keys that only apply to the old type (`barWidth`; `smooth`, `areaStyle`, `lineStyle`, `symbol`); keep `name`, `data`, `yAxisIndex`, colours; keep axes, legend, grid.
- **bar or line → pie**: one pie series from the first data series: `data = categories.map((name, i) => ({ name, value: series[0].data[i] ?? 0 }))`; remove `xAxis`, `yAxis`, `dataZoom`; `tooltip.trigger = 'item'`. Stash nothing in the document: the remaining series are lost by this conversion, so when there is more than one series show a toast "Pie shows the first series: North" (undo restores).
- **pie → bar or line**: categories from slice names, one series from slice values; add the preset's axes and grid.
- **anything ↔ scatter**: scatter data is `[x, y]` pairs and has no categories. To scatter: pair series 0 as x with series 1 as y when two series exist, else `[index, value]`. From scatter: categories `1…n`, one series of the y values. Toast the simplification.
- Seed from `CHART_PRESETS[v]()` **only** when the chart is untouched, meaning its option deep-equals `applyChartPalette(CHART_PRESETS[el.preset ?? 'bar'](), theme)`.
- Apply the preset's type-specific defaults that are not data (for example `smooth: true` on a new line series) without touching data.
- A chart linked to a table (`el.source`) converts the same way; the next table edit keeps feeding it (`syncLinkedChart` handles pie).

New strings (all catalogs): the two toasts.

Alternatives rejected: a confirm dialog before replacing (still loses data on Yes); keeping the old option in a hidden key (adds state to the format for no user benefit).

## Acceptance criteria

- [ ] Bar with 5 named series → Line → Bar: series names, values, order and colours are identical to the start.
- [ ] Bar → Pie → Bar: categories and the first series survive; a toast names the series that the pie shows.
- [ ] An untouched preset chart still switches to the target preset's sample (today's behaviour for a fresh chart).
- [ ] Each switch is exactly one undo step.
- [ ] No key that `validate()` reports as `chart-key-ignored` is introduced by a conversion.
- [ ] A linked chart keeps its `source` and still updates when the table changes.
- [ ] The helper is pure, with no DOM access.

## Tests

- New node rig `scripts/test-slides-chart-convert.ts` over the pure helper: every pair of types, multi-series, empty series, a pie with zero slices, untouched-preset detection, round trips. Assert `validateDoc` yields no `chart-key-ignored` on each result. Register in `.github/actions/validate-slides/action.yml`.
- The rig must fail on the parent commit when driven through the same entry point the inspector uses (extract the handler body into the helper first, then show the old behaviour returns the sample option).
- Optional browser check extending `scripts/test-chart-tooltip-browser.mjs` is not required.

## Out of scope

- New chart types or stacked bars (DT-09).
- The data sheet (DT-08).
- Changing what the presets contain.

## Notes for the implementer

- `CHART_PRESETS` lives in `kernel/src/charts.ts` (kernel zone). This fix does not need to change it: keep all new code in `slides/src`.
- Chart options are pure JSON: no functions, no class instances.
- `chart.ts` is a hot file; DT-07 and DT-08 edit the same panel. Land this first.
- The `preset` key on the element records the last chosen type; keep writing it.
