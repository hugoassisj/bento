---
id: MP-02
title: "Build order list in the Animate tab"
epic: 6-motion-presenting
type: enhancement
priority: P1
size: L
evidence: mixed
labels: [enhancement, "priority:P1", "size:L", "evidence:mixed", "area:motion"]
depends_on: [MP-03]
related: [MP-01, MP-12]
upstream: []
---
## Summary

The order in which a slide builds exists only as numbers typed into "Appears on click" and as small badges on the canvas. There is no place to see the whole sequence, reorder it by dragging, or set what plays with what. Add a Build order list to the slide's Animate tab: one row per step, draggable, with the element's entrance on the row.

## What the user experiences

A speaker with six stepped elements wants the fourth to come first. Today that means selecting elements one at a time and retyping numbers, or clicking badges and watching numbers cycle (see MP-03). With several elements selected the Animate tab offers only the three Reveal buttons; the Entrance picker disappears, so entrances must also be set one element at a time. There is no exit animation, no emphasis, no "with previous / after previous", and no delay. The model already has a stagger field (`fx.order`) that no control writes.

## Reproduce

1. Fresh load. Start from scratch. Add three text boxes ("Works offline", "Nothing to install", "Yours forever").
2. Select all three, Animate ▸ Reveal ▸ **In order**. Badges 1, 2, 3 appear.
3. Try to make the third box appear first. The only tools are: click its badge (it cycles, see MP-03) or select it and type 1 into "Appears on click", then renumber the other two the same way.
4. Select all three again. Observe the Animate tab: Reveal buttons only, no Entrance row.
5. Look for a list of the slide's builds anywhere in the panel with nothing selected: there is none.

## Evidence

- Seen in the running app during the motion and presenting journey (steps above).
- Confirmed in code now:
  - The format keeps one number per element; the editor's verbs are `revealInOrder`, `revealTogether`, `removeReveal`, `cycleStep` in `slides/src/editor/reveal.ts:48-76`. There is no reorder or swap operation.
  - The multi-selection panel renders only the reveal button row (`slides/src/editor/inspector/animate.ts:669-693`, "The three reveal verbs as a captioned button row (multi panel + Presenting)"); Entrance (`row(p, 'Entrance', fxPick)` at ≈388) is in the single-element path.
  - `fx.order` ("stagger step within the entrance sequence; equal values enter together") is declared in `slides/src/model.ts` (the `fx` block) and has no reference in `editor/inspector/animate.ts` (grep for `fx.order` and `order:` returns nothing there).
- Not verified: whether `fx.order` is honoured for elements revealed on the same step (read `runEnterFx` in `present.ts` before relying on it).

## How others do it

- **Keynote**: Animate ▸ Build Order, a floating list of every build on the slide. Rows drag to reorder; each row has Start "On Click / With Build N / After Build N" and a Delay.
- **PowerPoint**: Animation Pane with the same three start modes, a delay, and drag reorder; rows highlight the object.
- **Figma Slides**: an animation list per slide in the right panel.

## Proposed change

Phase 1 (this issue): the list, on today's format.

- **Where**: `slides/src/editor/inspector/animate.ts`, in the **slide** panel of the Animate tab (nothing selected), a new section "Build order" below Transition. Also reachable from a "Show build order" link in the element panel's Reveal hint.
- **Rows**: one group per step, in step order. A group holds the elements on that step (elements sharing a step are indented under one header "Click 2"). Each row shows the element's type icon and layer name, its entrance as a compact picker, and a remove button. Elements with no step are summarised in a first, non-draggable row "With the slide (N)".
- **Interactions**:
  - Drag a row to another position: renumber steps so the sequence stays contiguous 1..k. Dragging onto a group joins that step (reveal together). Use the existing pointer-drag list code from the layers panel (`slides/src/editor/layers.ts`, `layerrows.ts`) rather than HTML5 drag; it already supports keyboard reordering.
  - Hover or focus a row: highlight the element on the canvas (reuse whatever the layers panel uses).
  - Click a row: select the element.
  - Keyboard: Alt+↑/↓ moves the focused row.
- **Pure logic** goes into `slides/src/editor/reveal.ts` beside the existing verbs: `moveStep(slide, id, toIndex)`, `joinStep(slide, id, step)`, `compactSteps(slide)`. All return `StepPatch[]` so the existing commit path (`animate.ts` ≈659-663) applies them in one undo step.
- **Multi-selection**: show the Entrance picker for a multi-selection too (apply to all; show "Mixed" when they differ).
- **Stagger**: when a group has more than one element, expose `fx.order` as "Stagger" (0, 1, 2 …) only after confirming the show honours it for step reveals.

Phase 2 (separate issues, each a format addition): exit builds (`fx.exitStep`), a per-element delay, auto-advance "after previous". Do not build them here.

Strings (all catalogs): "Build order", "With the slide", "Click {n}", "Stagger", "Show build order".

## Acceptance criteria

- [ ] With nothing selected, the Animate tab lists every stepped element of the current slide grouped by step, in step order.
- [ ] Dragging the row on step 3 above step 1 yields steps 1 (moved), 2, 3 with no duplicates and no gaps, as one undo step; `window.bento.doc` confirms.
- [ ] Dropping a row onto another group puts both on the same step.
- [ ] Removing a row clears `fx.step` and compacts later steps.
- [ ] The whole list is operable by keyboard (focus, Alt+↑/↓, Delete) and rows have accessible names.
- [ ] Hovering a row highlights the element; clicking selects it.
- [ ] With three elements selected, Entrance can be set once for all three.
- [ ] The canvas badges update in the same frame as the list.
- [ ] No change to the saved format in phase 1 (`node scripts/build-modelkeys.mjs --check` unchanged).

## Tests

- Extend `scripts/test-slides-reveal-ui.ts` (node, registered in `.github/actions/validate-slides/action.yml`) with `moveStep`, `joinStep`, `compactSteps`: contiguity, stability, idempotence, elements sharing a step.
- Add `scripts/test-slides-build-order-browser.mjs` (register in `.github/workflows/ci-slides.yml`, the `slides-editor-browser` job): build three stepped elements, drag a row with real mouse events, assert `window.bento.doc` steps and the badge texts; assert keyboard reorder.

## Out of scope

- Per-paragraph builds (MP-01); the list must render a per-paragraph element as a row with a "by paragraph" mark once MP-01 lands.
- Exit and emphasis builds, delays, auto-advance.
- A timeline with durations.

## Notes for the implementer

- Slides app only. The Animate inspector is already long; put the list in its own module (`slides/src/editor/inspector/buildorder.ts`) and call it from `animate.ts`.
- Synthetic `PointerEvent`s do not drive the canvas, and the layers list uses mouse events: use `page.mouse` in the rig.
- The inspector re-renders on every store event; keep drag state outside the rendered DOM or the drag dies mid-gesture (the layers panel solves this already).
- Land MP-03 first: it fixes the badge semantics this list makes visible.
