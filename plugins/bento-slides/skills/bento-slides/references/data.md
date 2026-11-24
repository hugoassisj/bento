# Data: charts, tables, code, maths, media

Read this when the material has numbers, a grid of values, code, a formula or
a clip. Where the deck already styles one of these (its chart colours, its
table style, its code palette), reuse that style.

## Charts

A chart element has a `preset` (`bar`, `line`, `pie`, `scatter`) and an
`option`: pure JSON shaped like an ECharts option. The engine is the app's
own charts-lite, not ECharts: it reads the option's shape and ignores every
key it does not implement, without a warning.

```json
{ "id": "c1", "type": "chart", "x": 96, "y": 260, "w": 1088, "h": 380, "rotation": 0, "opacity": 1, "preset": "bar",
  "option": {
    "color": ["#1E2A3A", "#F7A600"],
    "xAxis": { "type": "category", "data": ["2022", "2023", "2024", "2025"] },
    "yAxis": { "type": "value" },
    "series": [{ "type": "bar", "name": "Revenue", "data": [420, 780, 1300, 2450] }],
    "tooltip": { "trigger": "item", "formatter": "{b}: {c}" } } }
```

- **Data.** Bar and line `data` are JSON numbers; an object or a numeric
  string renders as 0. A pie series takes `{ "name", "value" }` items. Colour
  by series, not per bar.
- **Colours.** Without `option.color` (or a series' `itemStyle.color`) a chart
  draws in the engine's default palette, not the deck's. Take the series
  colours from `theme.chartPalette` when the deck has one, else from its palette
  slots, and write them into `option.color`.
- **Formatters** are templates only: `{b}` (category), `{c}` (value), `{d}`
  (pie percent), not functions.
- **Two scales** (a volume and a percentage): make `yAxis` an array of two
  `{ "type": "value" }` axes and point the second series at the second axis
  with `"yAxisIndex": 1`, drawn as a `line` over the bars.
- **What it honours**:
  - top level: `color`, `series`, `xAxis`, `yAxis`, `legend`, `grid`,
    `tooltip`, `textStyle`, `dataZoom`
  - any series: `type`, `name`, `data`, `yAxisIndex`, `itemStyle.color`
  - bar: `itemStyle.borderRadius`
  - line: `smooth`, `symbol`, `symbolSize`, `lineStyle.color`,
    `lineStyle.width`, `areaStyle.color`
  - pie: `radius`, `label.formatter` (or `label: false`),
    `itemStyle.borderColor`, `itemStyle.borderWidth`
  - axes: `type`, `data`, `min`, `max`, `axisLabel` (`fontSize`,
    `fontWeight`, `color`, `formatter`), `axisLine`, `splitLine`
  - legend: `top`, `bottom`, `itemWidth`, `itemHeight`, `itemGap`,
    `textStyle.color`, `textStyle.fontSize`, `textStyle.fontWeight`. A
    `legend` key draws a legend whatever it says (its `show` is not read), so
    leave the key out for none.
- Value labels on a bar or line series are not drawn (only pie labels are).
  Numbers that must be readable go in a table or text beside the chart.
- Two consecutive chart slides that share the chart's id and morph tween the
  data, so a chart can change with the story.
- `validate()` reports chart keys the engine ignores as `chart-key-ignored`.

## Tables

```json
{ "id": "tbl1", "type": "table", "x": 240, "y": 220, "w": 800, "h": 260, "rotation": 0, "opacity": 1,
  "header": true,
  "columns": [{ "w": 1.4 }, { "w": 1 }, { "w": 1 }],
  "rows": [
    { "cells": [{ "html": "Plan" }, { "html": "Price", "align": "right" }, { "html": "Seats", "align": "right" }] },
    { "cells": [{ "html": "Team" }, { "html": "$29" }, { "html": "5" }] },
    { "cells": [{ "html": "Business" }, { "html": "$79" }, { "html": "25" }] } ],
  "style": { "headerBg": "#1E2A3A", "headerColor": "#FFFFFF", "zebra": "rgba(30,42,58,0.05)",
    "borderColor": "rgba(30,42,58,0.14)", "borderWidth": 1, "cellPadX": 16, "cellPadY": 11,
    "fontSize": 18, "color": "#1E2A3A", "radius": 10 } }
```

- `columns` are relative width weights. A cell takes `html` (the same tags as
  a text box), `align`, `color`, `bg` and `bold`. `header: true` styles the
  first row as the header.
- `style` takes `headerBg`, `headerColor`, `zebra`, `borderColor`,
  `borderWidth`, `cellPadX`, `cellPadY`, `fontSize`, `fontFamily`, `color` and
  `radius`. A deck's `theme.table` holds the style its new tables start from;
  copy it, and bind its colours to the deck's slots or tokens by path
  (`"themeRefs": { "style.headerBg": "tx1" }`).
- Tables suit comparisons, specs and pricing. A numeric trend reads better as
  a chart. `validate()` reports a table taller than its box as
  `table-overflow`.

## Code

A `code` element shows source with syntax colours:
`"content"` is the source text and `"grammarName"` the language:
`js`, `ts`, `py`, `rust`, `go`, `java`, `sh`, `sql`, `c`, `cpp`, `csharp`,
`kotlin`, `swift`, `scala`, `dart`, `zig`, `php`, `ruby`, `perl`, `lua`,
`r`, `julia`, `powershell`, `haskell`, `elixir`, `erlang`, `clojure`,
`ocaml`, `fsharp`, `json`, `yaml`, `toml`, `ini`, `xml`, `html`, `css`,
`graphql`, `proto`, `dockerfile`, `makefile`, `asm`, `elm`, `nim`,
`crystal`, `solidity`, `hcl`, `nix`, `matlab`, `fortran`, `pascal`,
`groovy`, `verilog`, `vhdl`, `latex`, `objc`, `scheme`, `lisp`, `prolog`,
`ada`, `d`, `gleam`, `batch`, `awk`, `tcl`, `vb`, `scss`, `nginx`, `jinja`,
`sparql`, `cypher`, `fish`, `apex`, `purescript`, `odin`, `zsh`,
`diff` or `md`. An unknown name is read as `js`.

- The colours come from `theme.codePalette` (`c` comment, `s` string, `n`
  number, `k` keyword, `f` call, `p` punctuation, `a` diff added, `d` diff
  removed); plain text takes the element's `color`. The face is
  `theme.codeFontFamily` when the deck sets it.
- Consecutive slides with a code element of the same id and
  `"transition": "morph"` move each token from its old place to its new one,
  which shows a refactor as it happens. A slower `present.morphSeconds` (1 to
  1.5) suits these short moves.
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
