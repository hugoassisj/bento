---
id: MP-01
title: "Bullets build one at a time (per-paragraph steps)"
epic: 6-motion-presenting
type: enhancement
priority: P1
size: M
evidence: mixed
labels: [enhancement, "priority:P1", "size:M", "evidence:mixed", "area:motion", format-change]
depends_on: []
related: [MP-02, MP-03, MP-10, MP-14]
upstream: ["nyblnet/bento discussion #282"]
---
## Summary

A reveal step belongs to a whole element. A text box holding a bulleted list can only appear all at once, so "one bullet per click", the most common build in any talk, needs one text box per bullet. Add an optional per-paragraph mode so each top-level paragraph or list item of one text element takes consecutive steps.

## What the user experiences

A speaker types three bullets into the content box of a Title + content slide, opens Animate, presses Reveal ▸ In order, and expects three clicks. The box gets a single badge "1" and the whole list appears on the first press of →. Nothing says why. The workaround is to split the list into three text boxes and align them by hand, which then breaks the list's own spacing, wrapping and nesting.

## Reproduce

1. Fresh load of the dev server. File menu ▸ Start from scratch.
2. Apply the layout "Title + content". Double-click the content box and type `- One`, Enter, `Two`, Enter, `Three`. Press Esc.
3. With the box selected open the Animate tab and press Reveal ▸ **In order**.
4. Observe: one badge "1" at the box's top-left corner; "Appears on click" reads 1.
5. Start the slideshow. Press → once: all three bullets appear together. Press → again: the show leaves the slide.

## Evidence

- Seen in the running app during the motion and presenting journey (steps above; one badge, one step).
- Confirmed in code now: the step is one number per element. `stepOf` reads `el.fx?.step` (`slides/src/steps.ts:28-31`), `stepsOf` collects those numbers (`steps.ts:39-40`), and the show hides or shows the element's whole node by toggling `bento-step-hidden` on `[data-el-id]` (`slides/src/present.ts:167-172`). "In order" numbers selected **elements** in reading order (`slides/src/editor/reveal.ts:48-52`). The model documents `fx.step` as per element (`slides/src/model.ts`, the `fx` block, `step?: number`).
- Text may legitimately contain block structure to step through: the sanitizer allows `P`, `DIV`, `UL`, `OL`, `LI`, `H1`, `H2` (`slides/src/render.ts:394-397`).
- Upstream discussion #282 is where click builds were requested and shipped (1.1.0) as per-element steps.

## How others do it

- **Keynote**: Animate ▸ Build In ▸ Delivery "By Bullet" (also "By Bullet Group", "By Highlighted Bullet").
- **PowerPoint**: Effect Options ▸ "By Paragraph".
- Both treat one text box as N builds and show them as N rows in the build list.

## Proposed change

Add one optional key on the element's `fx`:

```
fx.stepBy?: 'paragraph'   // absent = the whole element (today's behaviour)
```

Meaning: when `fx.step = n` (n ≥ 1) and `fx.stepBy === 'paragraph'` on a **text** element, its top-level blocks appear one per step: block 0 at step n, block 1 at n+1, and so on. A top-level block is a direct child `P`, `DIV`, `H1`, `H2`, or each direct `LI` of a top-level `UL`/`OL`; nested list items appear with their parent item. A text element with one block behaves exactly as today.

- **`slides/src/steps.ts`** (stay DOM-free): add `spanOf(el)` returning how many steps the element occupies (1 unless `stepBy === 'paragraph'`, then the block count) and extend `maxStep`, `stepsOf`, `shownAt` and `StepState.next/prev` to work on (element, block) pairs. The block count needs a pure helper over the stored html string, for example `blockCount(html)` in a new small module, tolerant of the sanitizer's tag set. Do not parse with the DOM here; `scripts/test-slides-steps.ts` drives this file in node.
- **`slides/src/present.ts`**: `applyStep` (≈167) must hide individual blocks inside `.bento-text-inner` as well as whole nodes; `revealStep` (≈175) should run the entrance on the newly shown block, not the whole box; `hideStep` (≈185) the reverse. The speaker counter uses `Math.max(...elements.map(stepOf))` (≈858): switch it to the new `maxStep`.
- **`slides/src/editor/reveal.ts`**: `revealInOrder` and `cycleStep` must advance by `spanOf`, so the element after a three-bullet list starts at n+3.
- **`slides/src/editor/stepbadges.ts`**: a per-paragraph element shows a range ("1–3").
- **`slides/src/editor/inspector/animate.ts`**: under "Appears on click" (≈408) add a segmented control **Whole box | By paragraph**, shown for text elements with more than one block. Pressing "In order" on a single multi-block text element should offer "By paragraph" directly.
- **Format**: add the key to `slides/src/model.ts`, the gate in `slides/src/untrusted.ts`, then regenerate `modelkeys.generated.ts` and the schema.
- **Old shells**: a shell without this key ignores `stepBy` and reveals the whole box at step n. Later elements still appear on their own later steps. Nothing is lost; the build is just coarser. State this in the model comment.
- **Strings (all catalogs)**: "Whole box", "By paragraph", and a hint line.

Rejected: storing one step number per paragraph in the html (pollutes text content and breaks on every edit); auto-splitting into several elements (changes the document the user wrote).

## Acceptance criteria

- [ ] A text element with three top-level list items, `fx.step: 1`, `fx.stepBy: 'paragraph'` needs three presses of → before the show leaves the slide; after press k exactly k items have a non-zero `getBoundingClientRect().height` and are not `visibility:hidden`.
- [ ] ← hides the last revealed item; arriving backward shows all items.
- [ ] An element stepped after that list (`fx.step: 4`) appears on the fourth press.
- [ ] Nested list items appear with their parent item.
- [ ] The step badge reads "1–3"; "In order" on [list, image] gives the image step 4.
- [ ] The speaker view counter reads `· k/3` while stepping through the list.
- [ ] A document without `stepBy` behaves byte-for-byte as before in `scripts/test-slides-steps.ts`.
- [ ] `node scripts/build-modelkeys.mjs --check` and `node scripts/build-schema.mjs --check` pass.

## Tests

- Extend `scripts/test-slides-steps.ts` (registered in `.github/actions/validate-slides/action.yml`): block counting on html fixtures (p, ul/li, nested ul, h1 + p, empty blocks), `stepsOf`/`next`/`prev` with a per-paragraph element, and the unchanged legacy cases.
- Extend `scripts/test-slides-reveal-ui.ts` for `revealInOrder` and `cycleStep` spans and the badge label.
- Add `scripts/test-slides-step-paragraph-browser.mjs` (register in `.github/workflows/ci-slides.yml`): load a deck, present, press → and measure each `li`'s rect.

## Out of scope

- A build-order list (MP-02) and exit or emphasis builds.
- Per-paragraph steps for table rows or chart series.
- One PDF page per step (MP-14) — but tell that issue about `spanOf`.

## Notes for the implementer

- Slides app only; no kernel change. `present.ts` is about 2,700 lines and a conflict magnet: keep the diff inside the step functions.
- The live broadcast sends `step: steps.step` in each nav frame (`present.ts:817`); a viewer on an older shell clamps to its own coarser maximum via `StepState.set`. Check `scripts/test-broadcast-follow.ts` still passes.
- Entrances on a single block: `runEnterFx` takes element ids today; a block-level entrance may need a plain opacity fade. Keep reduced motion (`M`) honoured.
- Measure with rects, never by reading a class or style back.
