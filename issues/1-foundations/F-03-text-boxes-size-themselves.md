---
id: F-03
title: "Text boxes size themselves: click hugs, drag fixes the width, overflow badge with Shrink to fit"
epic: 1-foundations
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:text"]
depends_on: []
related: [F-04, AI-10, F-09, F-10]
upstream: []
---
## Summary

A new text box is always 600×120, centre-aligned, centred on the click. It does not follow its text in width, it grows downward without limit, and nothing tells you when it has left the slide. Make a clicked text box hug its text, keep a dragged one at the dragged width, and show overflow in the editor with a one-click fix.

## What the user experiences

- Press T and click near the left edge: the box is centred on the click, so it starts off the slide (x = −93 in the audit).
- Three short "stat" labels become three overlapping 600px-wide boxes; Align and Distribute then act on the invisible 600px boxes, not on the words, and the result looks wrong.
- A caption under a picture overlaps the picture, because its box is 120px tall whatever it says.
- Typing a long list grows the box down past the slide (bottom at y = 1078 on a 720px slide in the audit) with no warning and no shrink.

## Reproduce

1. Fresh load. Press T, click at about x = 200 on the slide. Type `Q3`. Press Esc.
2. Select the box: W is 600, H is 120, the text is centred. `window.bento.doc.slides[i].elements.at(-1)` shows `x` negative or near zero, `w: 600`.
3. Repeat twice more for `Q4` and `FY`. Select all three, Alt+A (align left): the words do not line up on their left edges, because the boxes are aligned, not the text.
4. In one box type 30 lines. The selection box extends below the slide. No badge, no toast.

## Evidence

- Observed in the running app during the audit (first-deck journey: off-slide placement, overlapping stat boxes, caption over image, list grown to y = 1078).
- Confirmed in code now:
  - `slides/src/model.ts:975` `defaultText()`: `x: 340, y: 300, w: 600, h: 120`, `align: 'center'`, `valign: 'middle'`.
  - `slides/src/editor/canvas.ts:2888` `armPlace()`: a click (movement under 4 screen px) sets `el.x = a.x - el.w / 2; el.y = a.y - el.h / 2`; a drag sets `el.w` to the dragged width and leaves text height alone ("a text box sizes its own height").
  - `slides/src/editor/canvas.ts:2341` on commit, height becomes `max(current, inner.scrollHeight)`: it only ever grows.
  - `slides/src/editor/inspector/text.ts:19` "Fit height to text" exists as a manual button; there is no shrink-to-fit of the font size and no overflow indicator on the canvas.
- Not verified: behaviour inside auto-layout frames (a frame child is placed by its frame); keep that path unchanged.

## How others do it

- Figma: a click creates an **auto-width** text layer at the click point; a drag creates a **fixed-width, auto-height** box. Both are explicit modes in the panel.
- PowerPoint: AutoFit offers "Shrink text on overflow" and "Resize shape to fit text"; a red overflow is impossible to miss.

## Proposed change

1. **Click placement** (`canvas.ts` `armPlace`, the click branch): create the box at the click point (top-left at the click, not centred), `align: 'left'`, `valign: 'top'`, and mark it as hugging its text.
2. **Hug state.** Decide the representation carefully:
   - Preferred, no format change: keep `w`/`h` as plain numbers and re-measure on every text commit while the element is "hugging". The hug intent then has to live somewhere. An optional key (suggest `autoSize: 'width' | 'height'`, absent = fixed as today) is a format addition: write it up as such (old shells ignore it and show the last measured box, which is correct at rest). Label the PR `format-change` if you take this route.
   - Without a key: hug only at creation and on each commit until the user resizes the box by a handle. This is weaker (state is lost on reload) but ships without touching the format. Start here if upstream has not agreed the key.
3. **Measurement** goes through `slides/src/measure.ts` (the same path as `window.bento.measure()` and the validator), never a second implementation. Width hugging needs a width measurement; add it to `measure.ts` rather than reading the DOM in `canvas.ts`.
4. **Overflow badge.** When a text element's measured height exceeds its box, or the box leaves the slide, draw a small badge on the selection (reuse the step-badge layer, `editor/stepbadges.ts`) with two actions: **Fit box to text** (existing behaviour) and **Shrink text to fit** (step the font size down until it fits, floor at a sensible minimum, one undo step).
5. Strings for the badge and actions in every catalog.

Rejected: changing `defaultText()` defaults globally. Paste, layouts and the compact loader depend on them; change the tool's call site instead.

## Acceptance criteria

- [ ] T then click at (200, 300): the new box's top-left is at the click and it is left-aligned.
- [ ] After typing `Q3` and committing, the box width is within 4px of the measured text width.
- [ ] T then drag a 400px-wide rectangle: width stays 400 while height follows the text.
- [ ] Three clicked labels aligned left have text left edges within 1px of each other (measure rendered text rects, not `x`).
- [ ] A box whose text needs more height than the box, or that extends past the slide edge, shows the badge while selected; the badge disappears once it fits.
- [ ] Shrink text to fit reduces `fontSize` until `measure()` reports it fits, never below the floor, as one undo step.
- [ ] Resizing a hugging box by a side handle stops width hugging.
- [ ] Text boxes inside an auto-layout frame behave exactly as before.

## Tests

`scripts/test-slides-text-autosize-browser.mjs` (headless Chromium, real mouse events): click placement position and alignment; hug width after typing; drag keeps width; badge appears for a 30-line box and for a box pushed past the right edge; shrink-to-fit result fits per `window.bento.measure(id).fits`. Measure with `getBoundingClientRect`. Register in `.github/workflows/ci-slides.yml` under `slides-editor-browser`.

## Out of scope

- Pasted text onto the slide (F-04).
- Agent-side `h: "auto"` and text inside frames (AI-10).
- Per-run text styling (FH-04).

## Notes for the implementer

- `docs/DECISIONS.md` (2026-08-02, "not a layout engine") required any auto-height to be an additive flag and geometry to stay pure. Measuring at edit time and writing plain numbers respects that; do not make rendering depend on measurement.
- Text editing currently opens with everything selected (`canvas.ts` `selectAllChildren`); FH-03 changes that. Avoid editing the same lines in both.
- Hot files: `editor/canvas.ts`, `measure.ts`, i18n catalogs.
