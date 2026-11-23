---
id: DS-14
title: "Proposal: frame children placed absolutely, per-child alignment, grid spans, max size"
epic: 5-design-system
type: proposal
priority: P3
size: L
evidence: code
labels: [proposal, "priority:P3", "size:L", "evidence:code", "area:design-system", "format-change"]
depends_on: [DS-01]
related: [AI-10, DS-02, DS-03]
upstream: []
---
## Summary

Bento's auto layout covers row, column and a uniform grid with gap, padding, alignment, hug, fill and wrap. Four things Figma and Penpot have are missing: a child that ignores the layout (a badge pinned to a card's corner), a child that aligns differently from its siblings, a grid cell that spans columns or rows, and a maximum size. This is a format proposal to agree before any code.

## What the user experiences

- A "New" badge on the corner of a card inside a row: today the badge becomes a sibling in the flow and pushes the card's content, or must live outside the frame and no longer moves with it.
- One short child in a stretched row cannot be centred on its own.
- A grid of six tiles where the first should be double width cannot be expressed; `cols` is a single number.
- A text column that fills the row cannot be capped at a readable width.

## Reproduce

Not a defect. Select a frame's child: the inspector offers Fixed / Fill (and Hug for a nested frame) and, in a wrapping frame, Min. Select a grid frame: Direction, Gap, Columns. Nothing else.

## Evidence

- **Confirmed in code now:**
  - `slides/src/model.ts:220-228` (`ElementSizing`): `w?`, `h?` (`'fixed' | 'fill'`), `minW?`, `minH?`.
  - `model.ts:235-257` (`FrameLayout`): `dir`, `gap`, `pad`, `justify?`, `align?`, `cols?`, `clip?`, `hug?`, `wrap?`. One `gap` for both axes; one `align` for all children; `hug` is one switch for both axes (`slides/src/editor/inspector/layout.ts:72`, "ponytail: hug is one switch for both axes").
  - Solver: `slides/src/layout.ts:172` (`layoutSlide`), `:221` (`hug`), `:261-262` (grid cell size is uniform: the widest and tallest child when hugging, else the inner box divided by `cols` and the row count).
  - Order is the children's current coordinate, ties by array order (`layout.ts:15-17`).
  - Gate: `slides/src/untrusted.ts:546-553`. `layout` and `sizing` are `shape(MODEL_KEYS.frameLayout, …)` and `shape(MODEL_KEYS.sizing, …)`: on intake a 1.3.0 shell keeps only the sub-keys it knows. **A new sub-key of `layout` or `sizing` is dropped by 1.3.0 on paste, Replace from JSON and snapshot restore.** Whether it also drops it on plain file open must be measured.
  - Recorded cost already accepted for frames: `docs/DECISIONS.md:12052-12060`. Older shells read plain positioned elements; "in an old shell, moving a frame leaves its children until a current editor re-lays the slide."
  - The solver is fuzzed for one-pass settling (the RFC's commit message records 2,000 nested layouts; the rig is `scripts/test-slides-layout.ts`).
- **From the AI trial (not re-verified here):** `align: 'stretch'` with `hug` collapsed cards to 100px; equal-height cards were not achievable (AI-10 owns those).

## How others do it

- **Figma:** "Ignore auto layout" (absolute position) with constraints; per-child alignment is not offered on the cross axis in rows except through stretch, but min/max width and height are; grid auto layout (2025) has spans.
- **Penpot:** flex children have align-self, margins, min/max and absolute position; grid layout has named areas and spans, following CSS.
- **CSS:** `position: absolute` inside a relative container, `align-self`, `grid-column: span 2`, `max-width`.

## Proposed format

All additions are optional sub-keys; absent means today's behaviour.

| Key | Where | Meaning | A 1.3.0 shell |
|---|---|---|---|
| `sizing.abs?: true` | child | The frame does not place or size it. It keeps its box, and moves with the frame. | Ignores the key and lays the child out in the flow: **the picture changes** (the badge joins the row). See open question 1. |
| `sizing.off?: [dx, dy]` | child with `abs` | Offset from the frame's top-left, so every replica and a reload put it in the same place after the frame moves (same idea as `component.off`). | Ignored. |
| `sizing.align?: 'start' \| 'center' \| 'end' \| 'stretch'` | child | Cross-axis alignment for this child only. | Ignored; uses the frame's `align`. Boxes on disk are already the laid-out ones, so the picture is right until that shell re-lays the slide. |
| `sizing.maxW?`, `sizing.maxH?` | child | Upper bound for a `fill` child. | Ignored; child fills. |
| `sizing.span?: [cols, rows]` | child of a grid | Cells occupied; default `[1, 1]`. | Ignored; one cell. |
| `layout.gapY?: number` | frame | Cross-axis gap for wrap and grid; absent = `gap`. | Ignored; uses `gap`. |
| `layout.hugW?`, `layout.hugH?: boolean` | frame | Per-axis hug; absent = `hug` for both. | Ignored; uses `hug`. |

Rejected: changing `hug` to `boolean | 'w' | 'h'`. An old shell treats any truthy value as "hug both", which repurposes a key.

### Solver changes

- **Absolute children** are excluded from `frameChildren` ordering and from hug measurement; after the frame's box is settled they are placed at `frame.xy + off`. When the user drags one, `off` is rewritten (derived from the committed x/y, like `component.off`).
- **Per-child align** replaces the frame's `align` for that child in the cross-axis placement step.
- **Max** clamps after free space is shared; the remainder is redistributed among the other `fill` children (iterate until stable; bounded by the child count).
- **Spans** turn the uniform grid into auto-placement: walk children in order, place each at the first free cell that fits its span (CSS grid's sparse auto-placement), then size cells as today. With hugging, cell size is the largest per-cell share.
- **One pass must remain a fixed point.** Every new rule must be expressible from committed inputs only (no dependence on the previous pass's output except through the model). Extend the fuzz in `scripts/test-slides-layout.ts` with the new keys.

### Editor

- Child: "Ignore auto layout" toggle; an Align-self row of four; Max beside Min; Span steppers in a grid.
- Frame: a second gap field when wrapping or in a grid; per-axis hug when DS-01's words land (Hug width / Hug height).
- Canvas overlays (`slides/src/editor/frameoverlay.ts`) should show spans and the second gap.

## Interaction with other machinery

- **Order by coordinate:** an absolute child must never take a slot; dragging it never reorders siblings.
- **Morph:** reads boxes; unaffected. `frameClip` / `morphClip` (`layout.ts:371`, `:399`) should clip absolute children like any other child when `clip` is on.
- **Components:** `parentId` and `sizing` are a copy's own (`slides/src/components.ts:37`); new `sizing` sub-keys follow that rule automatically, but check that `instanceOf` copies them.
- **Collaboration:** layout is derived, not committed; every replica must compute identical boxes. `off` is the one committed fact added; confirm two replicas dragging the frame and the badge concurrently converge.
- **Agents:** these keys let an agent write a card with a corner badge without coordinates; document them in the agent reference (AI-02) when they land.
- **Validator:** flag `span` on a non-grid child, `abs` on an element with no frame, `maxW` below `minW`.

## Open questions

1. **`abs` in an old shell changes the picture** the first time that shell re-lays the slide (the absolute child joins the flow). Options: accept and document (as the existing frame cost is); or keep absolute children **outside** the frame in the model (`parentId` absent) and link them with a different key (for example `pinTo: '<frameId>'` plus `off`), so an old shell leaves them alone and only loses the "moves with the frame" behaviour. The second is more additive. Decide with the maintainer.
2. Does a 1.3.0 shell keep unknown `sizing` / `layout` sub-keys on plain open and save (not paste)? Measure with a released shell before choosing where keys live.
3. Is `gapY` wanted, or is a uniform gap a deliberate simplification?
4. Grid tracks of unequal width (`fr` units) are deliberately not proposed; say so or add them.
5. How much of this should wait for AI-10's fixes to stretch-with-hug and text height, which touch the same solver?

## Acceptance criteria (proposal, then build)

- [ ] Open questions 1 and 2 answered with evidence from a released shell; maintainer agreed the keys.
- [ ] A corner badge on a card in a row stays on its corner when the row reflows, the card resizes, or the frame moves.
- [ ] One child can be centred while its siblings stretch.
- [ ] A `fill` child with `maxW` stops growing and the remaining space goes to the other fill children.
- [ ] A grid child with `span: [2, 1]` occupies two columns; later children flow around it.
- [ ] One derive pass is a fixed point on 2,000 fuzzed layouts using the new keys.
- [ ] A deck using the new keys opens in 1.3.0 with every element present; the PR states exactly what differs there.
- [ ] Model keys and schema regenerated; `scripts/test-schema-frozen.mjs` passes.

## Tests

- `scripts/test-slides-layout.ts`: unit cases per key, plus the fuzz extension.
- `scripts/test-slides-frames-browser.mjs`: the badge case with real input (drag the frame, measure the badge with `getBoundingClientRect`).
- `scripts/test-slides-derive.ts`: fixed point with components that contain absolute children.
- Gate rigs (`scripts/test-slides-gate-keys.ts`, `scripts/test-replace-json-gate.ts`): each new key accepted in range, refused out of range.
- An old-shell rig modelled on `scripts/test-slides-alpha-refs.ts`.

## Out of scope

- Constraints for children of non-layout rectangles (pin left/right on resize).
- Unequal grid tracks.
- Equal-height rows and text fitted after layout (AI-10).

## Notes for the implementer

- Do not build before the format is agreed; append a DECISIONS entry when it is.
- Zone: slides app (`model.ts`, `layout.ts`, `untrusted.ts`, `editor/inspector/layout.ts`, `editor/frameoverlay.ts`, `editor/canvas.ts` drag paths at `:708` and `:785`).
- Split the build: max and align-self first (no old-shell picture change), then spans, then absolute children once question 1 is settled. One concern per PR.
