---
id: DT-13
title: "New chart and table defaults: centred placement, readable axis text, content layouts"
epic: 7-data
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:data"]
depends_on: []
related: [AI-09, F-01, DT-03, DT-09]
upstream: []
---
## Summary

A newly inserted chart lands off-centre and flush against the bottom of the slide, with axis text too small to read from the back of a room. There is no built-in layout that holds a title plus a chart or a table, so every data slide starts with manual placement. Fix the defaults and add two content layouts.

## What the user experiences

They press Chart. It appears to the right of centre, touching the bottom edge, covering whatever was there. Tick labels are 11–12px on a 1280×720 slide. They want "title on top, chart below"; the layout picker offers Title, Title + content, Two columns, Section divider, Three cards, Quote, Image left, Image right and Blank, none of which reserves a place for a chart or table.

## Reproduce

1. Fresh load. File ▸ Start from scratch (or any blank slide). Toolbar ▸ Chart.
2. `window.bento.doc.slides[i].elements.at(-1)` shows `x: 400, y: 190, w: 800, h: 520`. On the 1280×720 slide the box spans x 400–1200 (centre 800, not 640) and y 190–710 (10px from the bottom).
3. Look at the axis labels at 100% zoom: about 11–12px.
4. Toolbar ▸ Table: `x: 240, y: 220, w: 800, h: 260` (horizontally centred; fine).
5. Open the layout picker (slide inspector ▸ Layout): no layout with a chart or table region.

## Evidence

- Seen in the running 1.3.0 app during the data journey (placement, small axis text, missing layouts).
- Code, verified now:
  - `slides/src/model.ts:1100-1110` `defaultChart`: `x: 400, y: 190, w: 800, h: 520`.
  - `slides/src/model.ts:1155` `defaultTable`: `x: 240, y: 220, w: 800, h: 260`; `defaultCode` (`model.ts:1116`): `x: 235, y: 95, w: 800, h: 520`.
  - Insert command: `slides/src/editor/editor.ts:3838` `canvas.insert(defaultChart(applyChartPalette(CHART_PRESETS.bar(), theme)))`. The constants ignore `doc.size`, so a 4:3 or 9:16 deck gets the same numbers.
  - Engine text sizes: `kernel/src/charts.ts:480` and `483` draw axis names at a literal 11; presets set `grid` margins but no font size (`kernel/src/charts.ts:33-54`). `textStyle` is an allowed top-level key (`slides/src/validate.ts:75`). Unverified: exactly which sizes `textStyle.fontSize` controls.
  - Built-in layouts: `slides/src/model.ts:1357-1444` `builtinLayouts`: `layout-title`, `layout-title-content`, `layout-two-col`, `layout-section`, `layout-three-cards`, `layout-quote`, `layout-image-left`, `layout-image-right`, `layout-blank`.
- Unverified: how `canvas.insert` adjusts position (it may already offset or keep constants); read `slides/src/editor/canvas.ts:3000` onward before changing.

## How others do it

- PowerPoint: every content layout has a placeholder with icons for Table, Chart, SmartArt, Picture; inserting fills the placeholder.
- Keynote: a new chart is centred on the slide; themes include "Title & Chart"-style layouts through placeholders.
- Google Slides: inserted objects are centred.

## Proposed change

1. **Placement helper** in `slides/src/model.ts` or `slides/src/editor/canvas.ts`: `placeNew(size, w, h, slide)` returning a box centred on the slide, scaled down to fit inside a margin when the slide is smaller than the default, and nudged (for example by 24px steps) when an element already sits at exactly that position, so repeated inserts do not stack invisibly. Use it for chart, table, code and media inserts. Keep `default*` factories as they are for callers that pass explicit geometry (agents, fixtures, the starter deck).
   - If the slide has an empty content placeholder (role `body`, or the new roles below), fill its box instead.
2. **Readable chart text.** New charts are created with `textStyle: { fontSize: 16 }` (or whatever the engine's unit for tick and legend text is; verify) in the option the editor inserts, not by changing the engine's defaults, so existing charts and other apps are untouched. If the engine has hard-coded sizes that ignore `textStyle` (the literal 11 for axis names), list them in this issue and raise them through DT-09's serialized kernel steps rather than here.
3. **Two built-in layouts** in `builtinLayouts`: "Title + chart" and "Title + table": the Title + content title and rule, plus one large placeholder with a new role (`chart`, `table`). Clicking the placeholder inserts the element into its box (see how the image placeholder is planned in FH-07; share the mechanism if it exists by then, otherwise make the placeholder a hint box that the insert command fills).
   - Follow F-01: new layouts must take their colours and fonts from the theme, not literals. If F-01 has not landed, copy the existing literal pattern and leave a note; do not block on it.
   - Layout picker thumbnails and names need strings in all catalogs.
4. Agents: AI-09 adds agent-facing layouts (stats, timeline, big number, chart with figures). Use the same role names so compact input can address `chart` and `table` regions. Coordinate naming with AI-09 before merging either.

No format change: roles are existing string values on elements; confirm the gate accepts new role names (`slides/src/untrusted.ts`) and that `scripts/test-slides-compact-layouts.ts` and the layout table in `AGENTS.md` are updated together (the rig checks them against each other).

## Acceptance criteria

- [ ] A chart inserted on an empty 1280×720 slide is horizontally and vertically centred within 1px and lies inside a visible margin.
- [ ] On 4:3 and 9:16 decks an inserted chart, table and code block lie entirely inside the slide.
- [ ] Two consecutive inserts do not land at the identical position.
- [ ] A new chart's tick and legend text renders at 16px or more at 100% zoom; charts in existing files are unchanged.
- [ ] The layout picker offers Title + chart and Title + table; applying one and pressing Chart or Table fills the placeholder's box.
- [ ] An empty placeholder is hidden in the show and print, like the existing ones.
- [ ] `scripts/test-slides-compact-layouts.ts` and `scripts/test-slides-layout.ts` pass with the new layouts listed.
- [ ] The Showcase deck renders identically (it sets explicit geometry).

## Tests

- Extend `scripts/test-slides-layout.ts` and `scripts/test-slides-compact-layouts.ts` for the two layouts and roles.
- New node rig or case for `placeNew`: three deck sizes, the nudge, the placeholder fill.
- Extend `scripts/test-slides-paste-position-browser.mjs` or add a small browser case asserting the inserted chart's `getBoundingClientRect` is inside the slide.

## Out of scope

- Chart capabilities (DT-09), the data sheet (DT-08).
- Theme-following for all layouts (F-01).
- A "new slide" command in ⌘K (F-05).

## Notes for the implementer

- `builtinLayouts(size)` scales to the deck size; read the comment at `slides/src/model.ts:1323` about a layout that overflowed before it took `size`.
- Kernel zone: do not edit `kernel/src/charts.ts` in this issue.
- Small as it is, this touches i18n catalogs and `model.ts`; do not run it in parallel with F-01 or AI-09.
