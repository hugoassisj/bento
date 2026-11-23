---
id: DT-12
title: "Fields and maths render inside table cells"
epic: 7-data
type: enhancement
priority: P3
size: S
evidence: mixed
labels: [enhancement, "priority:P3", "size:S", "evidence:mixed", "area:data"]
depends_on: []
related: [DT-05, F-07]
upstream: []
---
## Summary

Dynamic fields (`{{date}}`, `{{page}}`, `{{title}}`…) and `$…$` maths render in text boxes and nowhere else. Typed into a table cell they show as raw source in the editor, the show and print. Run the same two resolvers on cell content.

## What the user experiences

A summary table with "As of {{date}}" in its caption row, or a formula column, shows the braces and dollar signs literally to the audience. The same text in a text box renders correctly, so it reads as a bug.

## Reproduce

1. Fresh load. Insert a table.
2. Double-click cells and enter: `{{date}}`, `{{page}}`, `$a^2+b^2$`. Commit with Escape.
3. Result: each cell shows exactly what was typed.
4. Put the same three strings into a text box: the date, the page number and a rendered formula appear.
5. Start the slideshow: the table cells are still raw.

## Evidence

- Seen in the running 1.3.0 app during the data journey.
- Code, verified now:
  - Text elements: `slides/src/render.ts:749` `inner.innerHTML = resolveMath(sanitizeHtml(resolveFields(el.html, opts.fields)), opts.mathHint)`.
  - Table cells: `slides/src/render.ts:631-663` `renderTableHtml`: each cell is `sanitizeHtml(String(cell.html ?? '')) || '<br>'` with neither resolver. The function takes `(el, doc)` and no render options, so it has no field context today.
  - `resolveFields` (`render.ts:77-94`) returns its input unchanged when called without a context.
  - Cell editing does not need a raw-source swap today because nothing is resolved; text boxes do swap (`slides/src/editor/canvas.ts:2193-2215`).
  - `renderTableHtml` is deliberately string-based so that `scripts/test-sanitize.ts` can run it in node with no DOM (the comment above the function).

## How others do it

- Keynote: table cells take data formats (date, number) and can hold equations.
- PowerPoint: slide-number and date fields can be inserted into a table cell.

## Proposed change

1. Give `renderTableHtml` an optional third parameter `opts?: { fields?: FieldContext; mathHint?: … }` and apply, per cell, the same pipeline as text: `resolveMath(sanitizeHtml(resolveFields(html, opts?.fields)), opts?.mathHint)`. Pass the options from the call site at `slides/src/render.ts:768`, which already has the slide's render options (`renderSlide` computes `fields` at `render.ts:1054`).
2. With no options the output must be identical to today, so the node sanitize rig and any other caller keep working.
3. **Editing**: when a cell whose model html contains `{{`, `$`, `\(` or `\[` enters editing (`editCellAt`, `slides/src/editor/canvas.ts:2490`), show the raw source, as `startTextEdit` does for text boxes, and re-render the resolved view on commit even if the text did not change. Reuse the existing logic rather than copying it; note the security comment there: the raw swap must go through `sanitizeHtml`.
4. **Measurement and validation**: `measureTables` (`slides/src/measure.ts:139-149`) renders through `renderElement`, so it will pick the resolved content up once a field context is passed. Check `F-07` (field tokens measured as literal text) and make the table path consistent with whatever it decides: a `{{page:2}}` cell should be measured as `02`.
5. **Chart link**: `tableChartColumns` (`slides/src/model.ts:1050`) reads raw cell html. A `{{…}}` or `$…$` cell is not a number and stays skipped; no change, but add a rig case so it is deliberate.
6. Check the other renderers of tables: thumbnails and present mode share `renderElement`; print and image export too. Confirm PowerPoint export (`convert/`) either resolves or leaves the raw text and reports it; do not change `convert/` in this issue, just state what it does.

No format change, no new strings.

## Acceptance criteria

- [ ] A cell containing `{{page}}` shows the slide's page number in the editor, thumbnails, the show and print.
- [ ] A cell containing `{{date:YYYY-MM-DD}}` shows the pinned-format date.
- [ ] A cell containing `$a^2+b^2$` shows rendered maths; an invalid formula is left as typed and marked as it is in text boxes.
- [ ] Double-clicking such a cell shows the raw source; committing without changes restores the rendered view and makes no document change.
- [ ] `renderTableHtml(el, doc)` with two arguments returns byte-identical output to the parent commit for the Showcase table.
- [ ] Hostile cell content (`<img onerror=…>`, a `javascript:` link, `</td><script>`) is still neutralised: `scripts/test-sanitize.ts` stays green and gains a cell-with-field case.
- [ ] A table cell holding a field does not produce a false `table-overflow`.

## Tests

- Extend `scripts/test-slides-fields.ts` (node) with table cases through `renderTableHtml` with a field context; extend `scripts/test-sanitize.ts` for the hostile cases with the new parameter.
- Extend `scripts/test-slides-fields-browser.mjs` with a table cell on a real slide (page number changes when the slide moves), and one maths cell. Both rigs are already registered; confirm in `.github/actions/validate-slides/action.yml` and `.github/workflows/ci-slides.yml`.
- Related rigs to keep green: `scripts/test-slides-math-delims.ts`, `scripts/test-maths-lite.ts`.

## Out of scope

- Count-up in cells.
- Number formats (DT-05 step C).
- Formulas that compute from other cells.

## Notes for the implementer

- Order matters: fields first, then sanitise, then maths, exactly as the text path does. The maths resolver emits markup that must not be re-sanitised away, and field values are escaped by `escapeFieldText`.
- Performance: `resolveFields` short-circuits when there is no `{{`; keep a cheap check before calling the maths resolver so plain tables cost nothing extra.
- Hot file: `render.ts` is the single renderer for every surface. Keep the change to the table function and its one call site.
