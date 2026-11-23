---
id: MP-14
title: "PDF export options: a page per click step, notes pages, background quality"
epic: 6-motion-presenting
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:export"]
depends_on: []
related: [MP-01, MP-06, MP-02]
upstream: ["nyblnet/bento#966"]
---
## Summary

"Print or save as PDF…" goes straight to the browser's print dialog with one fixed output: every slide once, with every build step already revealed. There is no way to get one page per click step (upstream issue #966), no notes or handout pages, and a 15-slide deck with rich backgrounds came out at 36 MB in a headless export. Add a short options sheet before printing.

## What the user experiences

- A speaker who built a slide that reveals four points one at a time prints a hand-out and gets one page with all four points. The PDF cannot be used to step through the talk on a machine without the deck.
- Someone preparing speaker notes on paper finds no notes anywhere in the PDF.
- Someone mailing the PDF finds it too large to attach.

## Reproduce

1. Open the Showcase deck. File menu ▸ "Print or save as PDF…" (or ⌘P).
2. The browser print dialog opens at once; there is no Bento dialog.
3. Save as PDF. Result: 15 pages (states and hidden slides are skipped), exact 16:9, vector text.
4. Add click steps to three elements on one slide (Animate ▸ Reveal ▸ In order) and export again: that slide is still one page with all three elements visible.
5. Look for speaker notes in the PDF: none.

## Evidence

Observed in the running app (audit journey 3, with `window.print` stubbed and Chromium's `page.pdf`): 15 exact 16:9 pages, faithful, vector text, **36 MB**. The size comes from headless `page.pdf` on the effects-heavy Showcase, not from the Save-as-PDF dialog of a desktop browser; treat it as an indication and re-measure.

Confirmed in code at `29b5c80`:

- `exportPdf()` (`slides/src/editor/editor.ts:2579-2608`) builds `#bento-print`, renders each slide that passes `inLinearFlow(slide)` (`slides/src/model.ts:1551`) once with `renderSlide(slide, doc, { svgAsImage: true, hidePlaceholders: true })` into a `.bp-page`, then calls `window.print()` after 250 ms. It takes no options.
- Print CSS: `slides/src/styles.css:1762-1781` (`#bento-print .bp-page`, page size 1600×900, `print-color-adjust: exact`).
- The build-step model is pure and already exports what a per-step export needs: `stepsOf(elements)` and `shownAt(el, step)` (`slides/src/steps.ts:39-43`).
- The show hides not-yet-revealed elements by toggling `bento-step-hidden` on each element node (`slides/src/present.ts:171`), and that class is styled only inside the show: `.bento-present-overlay .bento-step-hidden { visibility: hidden !important; … }` (`slides/src/styles.css:1993`). Print needs its own rule.
- The menu row promises exactly today's behaviour: "Every slide on its own page — your browser's print dialog saves a PDF." (`slides/src/editor/editor.ts:1216`); the command is `export-pdf` (`slides/src/editor/editor.ts:3854`).
- A dialog primitive with focus trapping exists and is already used for a similar export sheet: `createDialog` (`kernel/src/ui/dialog.ts:65`), used by Export slides as images (`slides/src/editor/exportimages.ts:189`).

## How others do it

- **Keynote** ▸ Export To ▸ PDF: "Print each stage of builds", "Include presenter notes", slides per page, image quality (Good / Better / Best).
- **PowerPoint** ▸ Print: Full Page Slides, Notes Pages, Handouts (1 to 9 per page). Exporting builds one per page needs an add-in, which is a known complaint.
- **Google Slides** ▸ Print preview: "1 slide with notes", handouts, "Hide background".

Upstream issue #966 asks for exactly the first one: a slide with N steps becomes N+1 pages, and one page per slide stays the default.

## Proposed change

Slides app only; no format change; the export stays on the browser's print pipeline.

1. **Options sheet.** `exportPdf()` opens a small `createDialog` sheet (model: `openExportImages` in `slides/src/editor/exportimages.ts`) with:
   - **Pages**: Slides (default) · Slides with notes · One page per click step.
   - **Backgrounds**: Full quality (default) · Lighter file.
   - Print / Cancel. The last choice is remembered per browser with the existing `lsGet`/`lsSet` helpers, never in the document.
   Shift+⌘P (or holding Shift on the menu row) prints with the remembered options and no sheet.
2. **Page per step.** For each linear slide, emit one page for each value in `[0, ...stepsOf(slide.elements)]`. Render the slide once per page and hide elements where `!shownAt(el, step)` by adding a class to their `[data-el-id]` nodes, with a rule scoped to print: `#bento-print .bento-step-hidden { visibility: hidden !important }`. Page-number fields keep the slide's number on every step page (the steps are one slide).
3. **Slides with notes.** A portrait page per slide: the slide in the top half, the notes text below in the deck's body font at a readable size, overflowing to a continuation page when long. Notes are plain text; escape them.
4. **Lighter file.** Render slide backgrounds and full-bleed pictures at a reduced raster scale for print. Find out first what makes the PDF large: the journey's reading was "backgrounds rasterise at about 28 megapixels per page". Measure with the Showcase and record before and after.
5. Update the menu row's description so it no longer says "Every slide on its own page" unconditionally.

Rejected: generating the PDF in JavaScript. It would need a dependency and would lose the browser's vector text.

New strings go through `t()` into all eight catalogs.

## Acceptance criteria

- [ ] The default export is byte-for-byte the same page sequence as today (one page per linear slide, all steps revealed).
- [ ] "One page per click step" on a slide with steps 1, 2, 3 produces four pages: none revealed, then one more element set per page, in step order.
- [ ] A slide with no steps produces one page in that mode.
- [ ] State slides and hidden slides stay out of every mode, as today.
- [ ] "Slides with notes" produces a page per slide carrying the slide image and its notes; a slide with empty notes still gets its page.
- [ ] "Lighter file" produces a PDF at most half the size of the full-quality one on the Showcase deck, with text still vector.
- [ ] The sheet traps focus, closes on Escape, and returns focus to the opener.
- [ ] No option is written into the document; `window.bento.serialize()` is unchanged by exporting.

## Tests

- Node rig: extend `scripts/test-slides-steps.ts` (registered at `.github/actions/validate-slides/action.yml:303`) with a pure helper test: given elements with steps, the page plan is `[0, 1, 2, 3]` and `shownAt` matches per page.
- Browser rig `scripts/test-slides-print-steps-browser.mjs`: stub `window.print`, run each mode, and assert on the `#bento-print` DOM: number of `.bp-page` nodes, which `[data-el-id]` nodes are hidden on each, presence of notes text. Emulate print media (`page.emulateMedia({ media: 'print' })`) and assert computed `visibility`. Register in `.github/workflows/ci-slides.yml`.
- `scripts/test-slides-pagination.ts` exists for page numbering; check it still passes.

## Out of scope

- Handouts with several slides per page.
- Slide links as PDF anchors.
- Excluding notes from the present-only file (MP-06).
- Per-paragraph steps (MP-01); once that lands this export must follow it.

## Notes for the implementer

- Hot files: `slides/src/editor/editor.ts`, `slides/src/styles.css`, i18n catalogs.
- Upstream #966 has no maintainer reply yet. The author's one stated constraint is that the existing output stays the default.
- `renderSlide` is the single renderer for canvas, thumbnails, show and print; do not fork it. Hide by class after rendering.
- If MP-06's "include notes" choice lands first, reuse its wording.
