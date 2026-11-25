# Data: charts, tables, code, maths, media

Read this when the material has numbers, a grid of values, code, a formula or
a clip. Where the deck already styles one of these (its chart colours, its
table style, its code palette), reuse that style.

## Charts

A chart has a `preset` (`bar`, `line`, `pie`, `scatter`) and an `option`
shaped like an ECharts option. The engine is the app's own charts-lite: it
draws from the keys below and ignores every other key without a word.

```json
{ "id": "c1", "type": "chart", "x": 96, "y": 260, "w": 1088, "h": 380, "rotation": 0, "opacity": 1, "preset": "bar",
  "option": {
    "color": ["#1E2A3A", "#F7A600"],
    "legend": { "bottom": 0 }, "grid": { "left": 72, "right": 56 },
    "xAxis": { "data": ["2022", "2023", "2024", "2025"] },
    "yAxis": [{ "name": "Revenue" }, { "axisLabel": { "formatter": "{value}%" } }],
    "series": [
      { "type": "bar", "name": "Revenue", "data": [420, 780, 1300, 2450] },
      { "type": "line", "name": "Margin", "yAxisIndex": 1, "data": [8, 11, 14, 19] } ],
    "tooltip": { "trigger": "axis" } } }
```

What charts-lite reads:

| Where | Keys |
|---|---|
| top level | `color` (series colours in order), `series`, `xAxis`, `yAxis`, `legend`, `grid` (`left`, `right`, `top`, `bottom`), `tooltip` (`trigger` only), `textStyle` (`fontFamily`), `dataZoom` (a non-empty array turns on wheel zoom) |
| every series | `type`, `name`, `data` |
| bar | `yAxisIndex`, `itemStyle.color`, `itemStyle.borderRadius` |
| line | `yAxisIndex`, `lineStyle.color`, `lineStyle.width`, `smooth`, `symbol` (`"none"` hides the dots), `symbolSize`, `areaStyle` (present fills the area; `areaStyle.color`) |
| scatter | `itemStyle.color`, `symbolSize`; `data` is `[x, y]` pairs and `xAxis` has no `data` |
| pie | `radius`, `label.formatter` (or `label: false`), `label.color`, `itemStyle.borderColor`, `itemStyle.borderWidth`; `data` is `{ "name", "value" }` items |
| `xAxis` | `data` (the categories), `axisLabel` (`color`, `fontSize`, `fontWeight`), `axisLine.lineStyle` (`color`, `width`) |
| `yAxis` (one, or an array of two) | `name`, `min`, `max`, `axisLabel` (`color`, `fontSize`, `fontWeight`, `formatter`); the first axis's `splitLine.lineStyle` (`color`, `width`) |
| `legend` | `top`, `bottom`, `itemWidth`, `itemHeight`, `itemGap`, `textStyle` (`color`, `fontSize`, `fontWeight`); a `legend` key draws a legend whatever it says (`show` is not read) |

- **Data.** Bar and line `data` are JSON numbers; an object or a numeric
  string draws as 0.
- **Colours.** Pie slices take `option.color` in order, and so does every
  series without its own colour (`itemStyle.color` on a bar or scatter,
  `lineStyle.color` on a line). Without `option.color` the chart uses the
  engine's palette, not the deck's: write `theme.chartPalette` (or the
  palette slots) into `option.color`.
- **Formatters** are strings, and only two are read: a pie `label.formatter`
  substitutes `{b}` (name), `{c}` (value) and `{d}` (percent); a y-axis
  `axisLabel.formatter` substitutes `{value}`. A tooltip shows the name and
  value itself; its `formatter` is not read.
- **Two scales**: an array of two `yAxis` entries and `"yAxisIndex": 1` on the
  series that uses the second, as in the example.
- Value labels on bars and lines are not drawn; numbers that must be read go
  in a table or text beside the chart.
- Consecutive slides sharing a chart's id with `"transition": "morph"` tween
  its data.
- `validate()`'s `chart-key-ignored` names an unknown key at the top level, on
  a series, an axis or the legend only. It passes some keys charts-lite does
  not draw (an axis `type`, a bar's `barWidth`, `legend.show`): the table
  above is what draws.

## Tables

```json
{ "id": "tbl1", "type": "table", "x": 240, "y": 220, "w": 800, "h": 260, "rotation": 0, "opacity": 1,
  "header": true,
  "columns": [{ "w": 1.4 }, { "w": 1 }, { "w": 1 }],
  "rows": [
    { "cells": [{ "html": "Plan" }, { "html": "Price", "align": "right" }, { "html": "Seats", "align": "right" }] },
    { "cells": [{ "html": "Team" }, { "html": "$29", "align": "right" }, { "html": "5", "align": "right" }] },
    { "cells": [{ "html": "Business" }, { "html": "$79", "align": "right" }, { "html": "25", "align": "right" }] } ],
  "style": { "headerBg": "#1E2A3A", "headerColor": "#FFFFFF", "zebra": "rgba(30,42,58,0.05)",
    "borderColor": "rgba(30,42,58,0.14)", "borderWidth": 1, "cellPadX": 16, "cellPadY": 11,
    "fontSize": 18, "color": "#1E2A3A", "radius": 10 } }
```

- `columns` are relative width weights. A cell takes `html` (the same tags as
  a text box), `align`, `color`, `bg` and `bold`; alignment is per cell, so
  right-align a number column in every row. `header: true` styles the first
  row as the header.
- `style` takes `headerBg`, `headerColor`, `zebra`, `borderColor`,
  `borderWidth`, `cellPadX`, `cellPadY`, `fontSize`, `fontFamily`, `color` and
  `radius`. A deck's `theme.table` holds the style its new tables start from;
  copy it, and bind its colours to the deck's slots or tokens by path
  (`"themeRefs": { "style.headerBg": "tx1" }`).
- Tables suit comparisons, specs and pricing. A numeric trend reads better as
  a chart. `validate()` reports a table taller than its box as
  `table-overflow`.

## Code

A `code` element shows `content` with syntax colours. `grammarName` is the
language id: `js`, `ts`, `py`, `go`, `rust`, `java`, `c`, `cpp`, `csharp`,
`sql`, `sh`, `json`, `yaml`, `html`, `css` and 60 more of the usual short
ids, plus `diff` and `md`; an unknown id is read as `js`.

- The colours come from `theme.codePalette` (`c` comment, `s` string, `n`
  number, `k` keyword, `f` call, `p` punctuation, `a` diff added, `d` diff
  removed); plain text takes the element's `color`. The face is
  `theme.codeFontFamily` when the deck sets it.
- Consecutive slides with a code element of the same id and
  `"transition": "morph"` move each token to its new place, which shows a
  refactor as it happens; a slower `present.morphSeconds` suits these short
  moves.
- `"fx": { "typeWriter": true }` types the code in when the slide appears.

## Maths

Formulas go in a text box's `html`: `$…$` or `\(…\)` inline, `$$…$$` or
`\[…\]` on their own line. They are LaTeX; `$typst: …$` writes Typst instead.
The inline `$` form wants no space just inside the delimiters and no digit
straight after the closing one, so prose such as "costs $5 and $10" stays
prose. An older shell shows the source text as typed.

## Media

A `media` element plays a clip: `kind` is `video` or `audio`, `src` a data URI
(embedded, travels in the file), an `asset:<key>`, or a URL (keeps the file
small, needs the network when it plays; give a linked video a `poster`).
`controls`, `autoplay`, `loop` and `muted` are the playback flags; autoplay
runs only while presenting, and a browser autoplays video only when it is
`muted`. A clip of more than a few MB makes the file slow to open and save,
so link long recordings instead of embedding them.
